import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

export const dynamic = 'force-dynamic'

// CORS: allow requests from the wBuy admin panel (bookmarklet)
function cors() {
  return {
    'Access-Control-Allow-Origin': 'https://sistema.sistemawbuy.com.br',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors() })
}

interface CartPayload {
  cartId: string
  name: string
  email: string | null
  total: string        // "R$1.115,00"
  productCount: string
  date: string         // "17/05/2026"
  time: string | null  // "10h05"
  status: string       // "Em recuperação" | "Recuperado" | "Abandonado"
  phone?: string | null
}

function parseBRL(v: string): number {
  return parseFloat(v.replace('R$', '').replace(/\./g, '').replace(',', '.').trim()) || 0
}

function parseBRDate(d: string): Date {
  const [day, month, year] = d.split('/')
  return new Date(`${year}-${month}-${day}T00:00:00`)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const carts: CartPayload[] = body.carts || []
  const syncedAt: string = body.synced_at || new Date().toISOString()

  if (!Array.isArray(carts) || carts.length === 0) {
    return NextResponse.json({ ok: false, error: 'Nenhum carrinho recebido' }, { status: 400, headers: cors() })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    let inserted = 0
    let updated = 0

    for (const cart of carts) {
      // Upsert customer by email
      let customerId: number | null = null
      if (cart.email) {
        const custRes = await client.query(
          `INSERT INTO customers
             (full_name, email, phone, source_channel, total_spent, purchase_count, is_active, created_at, updated_at)
           VALUES ($1, $2, $3, 'wbuy', 0, 0, true, NOW(), NOW())
           ON CONFLICT (email) DO UPDATE SET
             full_name = CASE WHEN customers.full_name IS NULL OR customers.full_name = '' THEN EXCLUDED.full_name ELSE customers.full_name END,
             updated_at = NOW()
           RETURNING id`,
          [cart.name || 'Desconhecido', cart.email, cart.phone || null]
        )
        customerId = custRes.rows[0].id
      }

      const total = parseBRL(cart.total)
      const purchaseDate = cart.date ? parseBRDate(cart.date) : new Date()
      const wbuyStatus = cart.status || 'Abandonado'

      // Check if already exists
      const existing = await client.query(
        `SELECT id FROM purchases WHERE external_id = $1`,
        [cart.cartId]
      )

      if (existing.rows.length > 0) {
        await client.query(
          `UPDATE purchases SET
             total_amount = $1, purchase_date = $2, order_number = $3, updated_at = NOW()
           WHERE external_id = $4`,
          [total, purchaseDate, wbuyStatus, cart.cartId]
        )
        updated++
      } else {
        await client.query(
          `INSERT INTO purchases
             (customer_id, purchase_date, total_amount, status, source_channel, external_id,
              order_number, imported_from, created_at)
           VALUES ($1, $2, $3, 'abandoned', 'wbuy', $4, $5, 'wbuy_abandoned_cart', NOW())`,
          [customerId, purchaseDate, total, cart.cartId, wbuyStatus]
        )
        inserted++
      }
    }

    await client.query('COMMIT')

    return NextResponse.json(
      { ok: true, inserted, updated, total: carts.length, synced_at: syncedAt },
      { headers: cors() }
    )
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('[sync abandoned carts]', err)
    return NextResponse.json({ ok: false, error: 'Erro interno' }, { status: 500, headers: cors() })
  } finally {
    client.release()
  }
}
