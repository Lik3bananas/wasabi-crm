import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import pool from '@/lib/db'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const client = await pool.connect()

  try {
    const [customer, emails, phones, addresses, purchases] = await Promise.all([
      client.query(
        `SELECT id, full_name, source_channel, total_spent, purchase_count,
                first_purchase_date, last_purchase_date, is_active, created_at
         FROM customers WHERE id = $1`,
        [id]
      ),
      client.query(
        `SELECT email, type, is_primary FROM customer_emails WHERE customer_id = $1 ORDER BY is_primary DESC`,
        [id]
      ),
      client.query(
        `SELECT phone, type, is_primary FROM customer_phones WHERE customer_id = $1 ORDER BY is_primary DESC`,
        [id]
      ),
      client.query(
        `SELECT street, number, complement, city, state, zipcode, type, is_primary
         FROM customer_addresses WHERE customer_id = $1 ORDER BY is_primary DESC`,
        [id]
      ),
      client.query(
        `SELECT
          p.id, p.purchase_date, p.total_amount, p.status, p.source_channel,
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'product_name', pi.product_name,
              'quantity', pi.quantity,
              'unit_price', pi.unit_price,
              'total_price', pi.total_price
            ) ORDER BY pi.id
          ) AS items
         FROM purchases p
         LEFT JOIN purchase_items pi ON pi.purchase_id = p.id
         WHERE p.customer_id = $1
         GROUP BY p.id
         ORDER BY p.purchase_date DESC`,
        [id]
      ),
    ])

    if (customer.rows.length === 0) {
      return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 })
    }

    return NextResponse.json({
      customer: customer.rows[0],
      emails: emails.rows,
      phones: phones.rows,
      addresses: addresses.rows,
      purchases: purchases.rows,
    })
  } finally {
    client.release()
  }
}
