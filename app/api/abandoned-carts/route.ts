import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import pool from '@/lib/db'

const WBUY_BASE = process.env.WBUY_API_URL!
const WBUY_AUTH = Buffer.from(`${process.env.WBUY_USER}:${process.env.WBUY_PASS}`).toString('base64')

async function wbuyGet(path: string) {
  const res = await fetch(`${WBUY_BASE}${path}`, {
    headers: { Authorization: `Basic ${WBUY_AUTH}` },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`wBuy ${path} → ${res.status}`)
  return res.json()
}

function normalizePhone(p: string) {
  return (p || '').replace(/\D/g, '')
}

// GET — fetch abandoned carts from wBuy (last 30 days) and identify customers
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)

  // Status 1 = Aguardando pagamento | Status 8 = Pagamento negado
  const [pendingRes, deniedRes] = await Promise.all([
    wbuyGet('/order?status=1'),
    wbuyGet('/order?status=8'),
  ])

  type WbuyOrder = {
    id: number
    identificacao: string
    data: string
    status: { id: number; nome: string }
    cliente: {
      nome?: string
      email?: string
      doc1?: string
      telefone1?: string
      telefone2?: string
      cidade?: string
      uf?: string
    }
    produtos: {
      sku?: string
      produto: string
      valor: string | number
      qtd: string | number
      cor?: string
      variacao?: string
    }[]
    pagamento?: { tipo?: string; servico?: string }
    valor_total?: { total?: string | number }
  }

  const allOrders: (WbuyOrder & { _statusLabel: string })[] = [
    ...(pendingRes.data || []).map((o: WbuyOrder) => ({ ...o, _statusLabel: 'Aguardando pagamento' })),
    ...(deniedRes.data  || []).map((o: WbuyOrder) => ({ ...o, _statusLabel: 'Pagamento negado' })),
  ]

  // Filter to last 30 days
  const recent = allOrders.filter((o) => {
    if (!o.data) return false
    return new Date(o.data) >= cutoff
  })

  const client = await pool.connect()
  try {
    const carts = await Promise.all(
      recent.map(async (order) => {
        const c = order.cliente || {}
        const email  = c.email?.toLowerCase().trim() || null
        const phone  = normalizePhone(c.telefone1 || c.telefone2 || '')
        const name   = c.nome?.trim() || 'Desconhecido'

        // Match existing customer: email first, then phone
        let customer = null
        if (email) {
          const r = await client.query(
            `SELECT id, full_name, email, phone, total_spent, purchase_count, last_purchase_date, source_channel
             FROM customers WHERE LOWER(email) = $1 LIMIT 1`,
            [email]
          )
          if (r.rows.length) customer = r.rows[0]
        }
        if (!customer && phone.length >= 8) {
          const r = await client.query(
            `SELECT id, full_name, email, phone, total_spent, purchase_count, last_purchase_date, source_channel
             FROM customers WHERE REGEXP_REPLACE(COALESCE(phone,''), '[^0-9]', '', 'g') = $1 LIMIT 1`,
            [phone]
          )
          if (r.rows.length) customer = r.rows[0]
        }

        const products = (order.produtos || []).map((p) => ({
          name:      p.produto,
          sku:       p.sku || null,
          qty:       Number(p.qtd),
          price:     Number(p.valor),
          color:     p.cor || null,
          variation: p.variacao || null,
        }))

        const total = Number(order.valor_total?.total || 0)

        return {
          wbuy_order_id:   order.id,
          wbuy_order_code: order.identificacao,
          date:            order.data,
          status_label:    order._statusLabel,
          total,
          customer_name:   name,
          customer_email:  email,
          customer_phone:  phone || null,
          customer_city:   c.cidade || null,
          customer_state:  c.uf || null,
          payment_method:  order.pagamento?.tipo || null,
          products,
          existing_customer: customer,
        }
      })
    )

    return NextResponse.json({ carts })
  } finally {
    client.release()
  }
}

// POST — create customer profile + record abandoned cart in DB
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const {
    customer_name, customer_email, customer_phone,
    wbuy_order_id, date, total, products, status_label,
  } = await req.json()

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Create or update customer
    const custRes = await client.query(
      `INSERT INTO customers
         (full_name, email, phone, source_channel, total_spent, purchase_count, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, 'wbuy', 0, 0, true, NOW(), NOW())
       ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name, updated_at = NOW()
       RETURNING id`,
      [customer_name, customer_email || null, customer_phone || null]
    )
    const customerId = custRes.rows[0].id

    // Record abandoned cart as a pending purchase
    const extId = `wbuy_abandoned_${wbuy_order_id}`
    const purchRes = await client.query(
      `INSERT INTO purchases
         (customer_id, purchase_date, total_amount, status, source_channel, external_id, imported_from, created_at)
       VALUES ($1, $2, $3, 'pending', 'wbuy', $4, 'abandoned_cart', NOW())
       ON CONFLICT (external_id) DO NOTHING
       RETURNING id`,
      [customerId, date ? new Date(date) : new Date(), total, extId]
    )

    if (purchRes.rows.length > 0) {
      const purchaseId = purchRes.rows[0].id
      for (const p of products) {
        await client.query(
          `INSERT INTO purchase_items
             (purchase_id, product_name, product_sku, quantity, unit_price, total_price, discount)
           VALUES ($1, $2, $3, $4, $5, $6, 0)`,
          [purchaseId, p.name, p.sku || null, p.qty || 1, p.price, p.qty * p.price]
        )
      }
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
