import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import pool from '@/lib/db'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const client = await pool.connect()

  try {
    // Load the primary customer record
    const primary = await client.query(
      `SELECT id, full_name, email, phone, source_channel, total_spent, purchase_count,
              address_street, address_number, address_complement,
              address_city, address_state, address_zipcode,
              first_purchase_date, last_purchase_date, is_active, created_at
       FROM customers WHERE id = $1`,
      [id]
    )

    if (primary.rows.length === 0) {
      return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 })
    }

    const c = primary.rows[0]

    // Find all customer IDs sharing the same email (deduplication siblings)
    const siblingIds = c.email
      ? (await client.query(
          `SELECT id FROM customers WHERE LOWER(email) = LOWER($1)`,
          [c.email]
        )).rows.map((r: { id: string }) => r.id)
      : [id]

    if (!siblingIds.includes(id)) siblingIds.push(id)

    // Aggregate totals across all sibling records
    const agg = await client.query(
      `SELECT
         SUM(total_spent)::numeric    AS total_spent,
         SUM(purchase_count)::int     AS purchase_count,
         MIN(first_purchase_date)     AS first_purchase_date,
         MAX(last_purchase_date)      AS last_purchase_date
       FROM customers WHERE id = ANY($1)`,
      [siblingIds]
    )

    // All purchases from all sibling customer IDs — deduplicated.
    // Duplicates arise from two sources:
    //   1. Ghost R$0.00 wBuy records → filtered with total_amount > 0
    //   2. Same purchase imported twice with MM/DD vs DD/MM date confusion:
    //      the time-of-day (HH:MM:SS) is identical on both rows, so we use
    //      DISTINCT ON (amount, time-of-day, status) to keep only one copy.
    const purchases = await client.query(
      `WITH deduped AS (
         SELECT DISTINCT ON (
           p.total_amount::numeric,
           p.purchase_date::time,
           p.status
         )
           p.id,
           p.purchase_date,
           p.total_amount,
           p.status,
           p.source_channel,
           c.source_channel AS customer_channel
         FROM purchases p
         JOIN customers c ON c.id = p.customer_id
         WHERE p.customer_id = ANY($1)
           AND p.total_amount::numeric > 0
         ORDER BY
           p.total_amount::numeric,
           p.purchase_date::time,
           p.status,
           p.purchase_date DESC
       )
       SELECT
         d.id,
         d.purchase_date,
         d.total_amount,
         d.status,
         d.source_channel,
         d.customer_channel,
         COALESCE(
           JSON_AGG(
             JSON_BUILD_OBJECT(
               'product_name', pi.product_name,
               'quantity',     pi.quantity,
               'unit_price',   pi.unit_price,
               'total_price',  pi.total_price
             ) ORDER BY pi.id
           ) FILTER (WHERE pi.id IS NOT NULL),
           '[]'
         ) AS items
       FROM deduped d
       LEFT JOIN purchase_items pi ON pi.purchase_id = d.id
       GROUP BY d.id, d.purchase_date, d.total_amount, d.status, d.source_channel, d.customer_channel
       ORDER BY d.purchase_date DESC`,
      [siblingIds]
    )

    // Collect all unique addresses across sibling records
    const addressRows = await client.query(
      `SELECT DISTINCT
         TRIM(SPLIT_PART(address_street, '|', 1))     AS street,
         TRIM(SPLIT_PART(address_number, '|', 1))     AS number,
         TRIM(SPLIT_PART(address_complement,'|',1))   AS complement,
         TRIM(SPLIT_PART(address_city,  '|', 1))      AS city,
         TRIM(SPLIT_PART(address_state, '|', 1))      AS state,
         TRIM(SPLIT_PART(address_zipcode,'|',1))      AS zipcode
       FROM customers
       WHERE id = ANY($1)
         AND (address_city IS NOT NULL OR address_street IS NOT NULL)`,
      [siblingIds]
    )

    // Collect all unique emails and phones
    const contactRows = await client.query(
      `SELECT DISTINCT email, phone, source_channel FROM customers
       WHERE id = ANY($1) AND (email IS NOT NULL OR phone IS NOT NULL)`,
      [siblingIds]
    )

    const emails = contactRows.rows
      .filter((r: { email: string }) => r.email)
      .map((r: { email: string; source_channel: string }, i: number) => ({
        email: r.email,
        type: r.source_channel,
        is_primary: i === 0,
      }))

    const phones = contactRows.rows
      .filter((r: { phone: string }) => r.phone)
      .map((r: { phone: string; source_channel: string }, i: number) => ({
        phone: r.phone,
        type: 'celular',
        is_primary: i === 0,
      }))

    const addresses = addressRows.rows
      .filter((a: { city?: string; street?: string }) => a.city || a.street)
      .map((a: { street: string; number: string; complement: string; city: string; state: string; zipcode: string }, i: number) => ({
        ...a,
        type: 'entrega',
        is_primary: i === 0,
      }))

    const aggRow = agg.rows[0]

    return NextResponse.json({
      customer: {
        ...c,
        total_spent:         aggRow.total_spent ?? c.total_spent,
        purchase_count:      aggRow.purchase_count ?? c.purchase_count,
        first_purchase_date: aggRow.first_purchase_date ?? c.first_purchase_date,
        last_purchase_date:  aggRow.last_purchase_date ?? c.last_purchase_date,
        sibling_count:       siblingIds.length,
      },
      emails,
      phones,
      addresses,
      purchases: purchases.rows,
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  } finally {
    client.release()
  }
}
