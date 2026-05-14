import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import pool from '@/lib/db'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const client = await pool.connect()

  try {
    const [customer, purchases] = await Promise.all([
      client.query(
        `SELECT id, full_name, email, phone, source_channel, total_spent, purchase_count,
                address_street, address_number, address_complement,
                address_city, address_state, address_zipcode,
                first_purchase_date, last_purchase_date, is_active, created_at
         FROM customers WHERE id = $1`,
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
          ) FILTER (WHERE pi.id IS NOT NULL) AS items
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

    const c = customer.rows[0]
    return NextResponse.json({
      customer: c,
      emails: c.email ? [{ email: c.email, type: 'principal', is_primary: true }] : [],
      phones: c.phone ? [{ phone: c.phone, type: 'celular', is_primary: true }] : [],
      addresses: (c.address_city || c.address_street) ? [{
        street: c.address_street,
        number: c.address_number,
        complement: c.address_complement,
        city: c.address_city ? c.address_city.split('|')[0].trim() : '',
        state: c.address_state ? c.address_state.split('|')[0].trim() : '',
        zipcode: c.address_zipcode ? c.address_zipcode.split('|')[0].trim() : '',
        type: 'entrega',
        is_primary: true,
      }] : [],
      purchases: purchases.rows,
    })
  } finally {
    client.release()
  }
}
