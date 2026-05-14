import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import pool from '@/lib/db'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const search = searchParams.get('search') || ''
  const status = searchParams.get('status') || ''
  const dateFrom = searchParams.get('date_from') || ''
  const dateTo = searchParams.get('date_to') || ''
  const page = Math.max(1, Number(searchParams.get('page') || 1))
  const limit = 50
  const offset = (page - 1) * limit

  const conditions: string[] = []
  const params: unknown[] = []
  let p = 1

  if (search) {
    conditions.push(`c.full_name ILIKE $${p}`)
    params.push(`%${search}%`)
    p++
  }
  if (status) {
    conditions.push(`pu.status = $${p}`)
    params.push(status)
    p++
  }
  if (dateFrom) {
    conditions.push(`pu.purchase_date >= $${p}`)
    params.push(dateFrom)
    p++
  }
  if (dateTo) {
    conditions.push(`pu.purchase_date <= $${p}`)
    params.push(dateTo)
    p++
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const [rows, countRow] = await Promise.all([
    pool.query(
      `SELECT
        pu.id, pu.customer_id, c.full_name AS customer_name,
        pu.purchase_date, pu.total_amount, pu.status, pu.source_channel,
        COUNT(pi.id)::int AS item_count
       FROM purchases pu
       JOIN customers c ON c.id = pu.customer_id
       LEFT JOIN purchase_items pi ON pi.purchase_id = pu.id
       ${where}
       GROUP BY pu.id, c.full_name
       ORDER BY pu.purchase_date DESC
       LIMIT $${p} OFFSET $${p + 1}`,
      [...params, limit, offset]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total
       FROM purchases pu
       JOIN customers c ON c.id = pu.customer_id
       ${where}`,
      params
    ),
  ])

  return NextResponse.json({
    purchases: rows.rows,
    total: countRow.rows[0].total,
    page,
    totalPages: Math.ceil(countRow.rows[0].total / limit),
  })
}
