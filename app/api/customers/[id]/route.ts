import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import pool from '@/lib/db'

const PT_LOWER = new Set(['de','da','do','das','dos','e','em','na','no','nas','nos','com','por','para','a','o','as','os','ao','aos'])

function toTitleCase(name: string | null): string | null {
  if (!name) return name
  return name
    .toLowerCase()
    .split(' ')
    .map((word, i) => {
      if (!word) return word
      if (i === 0 || !PT_LOWER.has(word)) return word.charAt(0).toUpperCase() + word.slice(1)
      return word
    })
    .join(' ')
}

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

    // All purchases from all sibling customer IDs — deduplicated in two passes.
    //
    // Pass 1 — DD/MM vs MM/DD import confusion (cross-sibling):
    //   The same purchase lands on two customer records with swapped month/day but
    //   IDENTICAL HH:MM:SS. Collapse by (amount, time-of-day, status, channel),
    //   keeping the most-recent calendar date.
    //
    // Pass 2 — wBuy checkout-step ghost rows (same customer):
    //   wBuy creates a new row at each checkout step (payment init, retry, confirm)
    //   for the same order → same amount, same day, different timestamps minutes
    //   apart. Collapse by (amount, calendar-date, status, channel), keeping the
    //   last timestamp (= the finalised transaction).
    //
    // Ghost R$0.00 rows (wBuy mirror records) are removed upfront.
    //
    // Items are fetched from ALL purchase IDs in each dedup group, not just the
    // winner — wBuy ghost rows store items on a different ID than the one kept.
    const purchases = await client.query(
      `WITH
       all_ids AS (
         SELECT
           p.id,
           p.total_amount::numeric  AS amount,
           p.purchase_date::date    AS pdate,
           p.purchase_date::time    AS ptime,
           p.status,
           p.source_channel
         FROM purchases p
         WHERE p.customer_id = ANY($1)
           AND p.total_amount::numeric > 0
       ),
       pass1 AS (
         SELECT DISTINCT ON (
           p.total_amount::numeric,
           p.purchase_date::time,
           p.status,
           p.source_channel
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
           p.source_channel,
           p.purchase_date DESC
       ),
       deduped AS (
         SELECT DISTINCT ON (
           total_amount::numeric,
           purchase_date::date,
           status,
           source_channel
         )
           id,
           purchase_date,
           total_amount,
           status,
           source_channel,
           customer_channel
         FROM pass1
         ORDER BY
           total_amount::numeric,
           purchase_date::date,
           status,
           source_channel,
           purchase_date DESC
       )
       SELECT
         d.id,
         d.purchase_date,
         d.total_amount,
         d.status,
         d.source_channel,
         d.customer_channel,
         COALESCE(
           (
             SELECT JSON_AGG(
               JSON_BUILD_OBJECT(
                 'product_name', pi.product_name,
                 'sku',          pi.product_sku,
                 'quantity',     pi.quantity,
                 'unit_price',   pi.unit_price,
                 'total_price',  pi.total_price
               ) ORDER BY pi.id
             )
             FROM purchase_items pi
             WHERE pi.purchase_id IN (
               SELECT a.id FROM all_ids a
               WHERE a.amount   = d.total_amount::numeric
                 AND a.pdate    = d.purchase_date::date
                 AND a.status   = d.status
                 AND a.source_channel = d.source_channel
             )
           ),
           '[]'::json
         ) AS items
       FROM deduped d
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

    // Deduplicate emails by lowercase value — same address from different records = one entry
    const seenEmails = new Set<string>()
    const emails = contactRows.rows
      .filter((r: { email: string }) => r.email)
      .filter((r: { email: string }) => {
        const key = r.email.toLowerCase().trim()
        if (seenEmails.has(key)) return false
        seenEmails.add(key)
        return true
      })
      .map((r: { email: string; source_channel: string }, i: number) => ({
        email: r.email,
        type: r.source_channel,
        is_primary: i === 0,
      }))

    // Normalize phone for deduplication:
    // 1. Strip non-digits
    // 2. Strip Brazilian country code 55 prefix when present (length > 11)
    // 3. Truncate to 11 digits max — handles malformed data with extra trailing zeros
    //    e.g. "55279810870000" (14d) → strip 55 → "279810870000" (12d) → slice 11 → "27981087000"
    //         "(27)98108-7000"  (11d) → no change                               → "27981087000" ✓ same
    function normalizePhone(p: string): string {
      let d = p.replace(/\D/g, '')
      if (d.length > 11 && d.startsWith('55')) d = d.slice(2)
      if (d.length > 11) d = d.slice(0, 11)
      return d
    }

    const seenPhones = new Set<string>()
    const phones = contactRows.rows
      .filter((r: { phone: string }) => r.phone)
      .filter((r: { phone: string }) => {
        const key = normalizePhone(r.phone)
        if (!key || seenPhones.has(key)) return false
        seenPhones.add(key)
        return true
      })
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

    // Adjust item prices proportionally to match actual purchase total_amount.
    // PDVNet stores items at full retail price but applies discounts at order level,
    // so items sum may not match the purchase total. Scale each item's price so that
    // the sum equals total_amount (what the customer actually paid).
    type RawItem = { product_name: string; sku: string; quantity: number; unit_price: string; total_price: string }
    type RawPurchase = { id: number; purchase_date: string; total_amount: string; status: string; source_channel: string; customer_channel: string; items: RawItem[] }

    const adjustedPurchases = (purchases.rows as RawPurchase[]).map((p) => {
      const items = p.items || []
      const itemsSum = items.reduce((s, i) => s + Number(i.total_price), 0)
      const purchaseTotal = Number(p.total_amount)
      if (items.length > 0 && itemsSum > 0 && Math.abs(itemsSum - purchaseTotal) > 0.01) {
        const ratio = purchaseTotal / itemsSum
        return {
          ...p,
          items: items.map((item) => ({
            ...item,
            unit_price:  (Number(item.unit_price)  * ratio).toFixed(2),
            total_price: (Number(item.total_price) * ratio).toFixed(2),
          })),
        }
      }
      return p
    })

    const aggRow = agg.rows[0]

    return NextResponse.json({
      customer: {
        ...c,
        full_name:           toTitleCase(c.full_name),
        total_spent:         aggRow.total_spent ?? c.total_spent,
        purchase_count:      aggRow.purchase_count ?? c.purchase_count,
        first_purchase_date: aggRow.first_purchase_date ?? c.first_purchase_date,
        last_purchase_date:  aggRow.last_purchase_date ?? c.last_purchase_date,
        sibling_count:       siblingIds.length,
      },
      emails,
      phones,
      addresses,
      purchases: adjustedPurchases,
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  } finally {
    client.release()
  }
}
