import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import pool from '@/lib/db'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const search = searchParams.get('search') || ''
  const city = searchParams.get('city') || ''
  const state = searchParams.get('state') || ''
  const filter = searchParams.get('filter') || ''
  const dateFrom = searchParams.get('date_from') || ''
  const dateTo = searchParams.get('date_to') || ''
  const page = Math.max(1, Number(searchParams.get('page') || 1))
  const limit = 50
  const offset = (page - 1) * limit

  const conditions: string[] = []
  const params: unknown[] = []
  let p = 1

  if (search) {
    conditions.push(`(c.full_name ILIKE $${p} OR c.email ILIKE $${p} OR c.phone ILIKE $${p})`)
    params.push(`%${search}%`)
    p++
  }

  if (city) {
    conditions.push(`c.address_city ILIKE $${p}`)
    params.push(`%${city}%`)
    p++
  }

  if (state) {
    conditions.push(`c.address_state ILIKE $${p}`)
    params.push(`%${state}%`)
    p++
  }

  if (dateFrom && dateTo) {
    conditions.push(`EXISTS (SELECT 1 FROM purchases pu WHERE pu.customer_id = c.id AND pu.purchase_date BETWEEN $${p} AND $${p + 1})`)
    params.push(dateFrom, dateTo)
    p += 2
  } else if (dateFrom) {
    conditions.push(`c.last_purchase_date >= $${p}`)
    params.push(dateFrom)
    p++
  }

  if (filter === 'inactive_30') conditions.push(`c.last_purchase_date < NOW() - INTERVAL '30 days'`)
  else if (filter === 'inactive_60') conditions.push(`c.last_purchase_date < NOW() - INTERVAL '60 days'`)
  else if (filter === 'inactive_90') conditions.push(`c.last_purchase_date < NOW() - INTERVAL '90 days'`)

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const orderBy = filter === 'best_buyers' ? 'ORDER BY c.total_spent DESC NULLS LAST' : 'ORDER BY c.full_name ASC'

  const [rows, countRow] = await Promise.all([
    pool.query(
      `SELECT
        c.id,
        c.full_name,
        c.email,
        c.phone,
        c.source_channel,
        c.total_spent,
        c.purchase_count,
        c.first_purchase_date,
        c.last_purchase_date,
        c.is_active,
        TRIM(SPLIT_PART(c.address_city, '|', 1)) AS city,
        TRIM(SPLIT_PART(c.address_state, '|', 1)) AS state
      FROM customers c
      ${where}
      ${orderBy}
      LIMIT $${p} OFFSET $${p + 1}`,
      [...params, limit, offset]
    ),
    pool.query(`SELECT COUNT(*)::int AS total FROM customers c ${where}`, params),
  ])

  return NextResponse.json({
    customers: rows.rows,
    total: countRow.rows[0].total,
    page,
    totalPages: Math.ceil(countRow.rows[0].total / limit),
  })
}
