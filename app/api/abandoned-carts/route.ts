import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import pool from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET — read synced abandoned carts from DB (last 7 days)
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const client = await pool.connect()
  try {
    // Get abandoned carts synced from wBuy panel (last 7 days)
    const result = await client.query(
      `SELECT
         p.id,
         p.external_id            AS cart_id,
         p.purchase_date          AS date,
         p.total_amount           AS total,
         p.order_number           AS wbuy_status,
         p.imported_from,
         c.id                     AS customer_db_id,
         c.full_name              AS customer_name,
         c.email                  AS customer_email,
         c.phone                  AS customer_phone,
         c.address_city           AS customer_city,
         c.address_state          AS customer_state,
         c.total_spent,
         c.purchase_count,
         c.last_purchase_date,
         c.source_channel
       FROM purchases p
       LEFT JOIN customers c ON c.id = p.customer_id
       WHERE p.status = 'abandoned'
         AND p.imported_from = 'wbuy_abandoned_cart'
         AND p.purchase_date >= NOW() - INTERVAL '7 days'
       ORDER BY p.purchase_date DESC`
    )

    const carts = result.rows.map((row) => {
      const existingCustomer = row.purchase_count > 0 || (row.total_spent && parseFloat(row.total_spent) > 0)
        ? {
            id:                 row.customer_db_id,
            full_name:          row.customer_name,
            email:              row.customer_email,
            phone:              row.customer_phone,
            total_spent:        row.total_spent,
            purchase_count:     row.purchase_count,
            last_purchase_date: row.last_purchase_date,
            source_channel:     row.source_channel,
          }
        : null

      return {
        cart_id:         row.cart_id,
        date:            row.date,
        total:           Number(row.total),
        wbuy_status:     row.wbuy_status || 'Abandonado',
        customer_name:   row.customer_name || 'Desconhecido',
        customer_email:  row.customer_email,
        customer_phone:  row.customer_phone,
        customer_city:   row.customer_city,
        customer_state:  row.customer_state,
        products:        [],  // products not captured by bookmarklet yet
        existing_customer: existingCustomer,
      }
    })

    // Get last sync time
    const syncRes = await client.query(
      `SELECT MAX(updated_at) AS last_sync FROM purchases
       WHERE imported_from = 'wbuy_abandoned_cart'`
    )
    const lastSync = syncRes.rows[0]?.last_sync || null

    return NextResponse.json({ carts, last_sync: lastSync, source: 'db' })
  } finally {
    client.release()
  }
}

// POST — create customer profile from an abandoned cart (legacy, kept for compatibility)
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const {
    customer_name, customer_email, customer_phone,
    cart_id, date, total,
  } = await req.json()

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const custRes = await client.query(
      `INSERT INTO customers
         (full_name, email, phone, source_channel, total_spent, purchase_count, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, 'wbuy', 0, 0, true, NOW(), NOW())
       ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name, updated_at = NOW()
       RETURNING id`,
      [customer_name, customer_email || null, customer_phone || null]
    )
    const customerId = custRes.rows[0].id

    // Link the purchase to this customer (may already exist from sync)
    if (cart_id) {
      await client.query(
        `UPDATE purchases SET customer_id = $1, updated_at = NOW() WHERE external_id = $2`,
        [customerId, cart_id]
      )
    } else {
      await client.query(
        `INSERT INTO purchases
           (customer_id, purchase_date, total_amount, status, source_channel, imported_from, created_at)
         VALUES ($1, $2, $3, 'abandoned', 'wbuy', 'wbuy_abandoned_cart', NOW())
         RETURNING id`,
        [customerId, date ? new Date(date) : new Date(), total || 0]
      )
    }

    await client.query('COMMIT')
    return NextResponse.json({ success: true, customer_id: customerId })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  } finally {
    client.release()
  }
}
