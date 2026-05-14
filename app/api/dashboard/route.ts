import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import pool from '@/lib/db'

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const client = await pool.connect()
  try {
    const [metrics, monthlySales, topCities] = await Promise.all([
      client.query(`
        SELECT
          COUNT(*)::int AS total_customers,
          COUNT(*) FILTER (WHERE is_active = true)::int AS active_customers,
          (SELECT COUNT(*)::int FROM purchases) AS total_orders,
          (SELECT COALESCE(SUM(total_amount), 0)::numeric FROM purchases WHERE status != 'cancelado') AS total_revenue,
          (SELECT COALESCE(AVG(total_amount), 0)::numeric FROM purchases WHERE status != 'cancelado') AS avg_order_value,
          COUNT(*) FILTER (WHERE source_channel = 'wbuy')::int AS wbuy_customers,
          COUNT(*) FILTER (WHERE source_channel = 'legacy_spreadsheet')::int AS legacy_customers
        FROM customers
      `),
      client.query(`
        SELECT
          TO_CHAR(purchase_date, 'YYYY-MM') AS month,
          COUNT(*)::int AS orders,
          SUM(total_amount)::numeric AS revenue
        FROM purchases
        WHERE status != 'cancelado'
          AND purchase_date >= NOW() - INTERVAL '12 months'
        GROUP BY TO_CHAR(purchase_date, 'YYYY-MM')
        ORDER BY month ASC
      `),
      client.query(`
        SELECT
          COALESCE(NULLIF(TRIM(city), ''), 'Não informado') AS city,
          state,
          COUNT(*)::int AS total
        FROM customer_addresses
        WHERE is_primary = true
        GROUP BY city, state
        ORDER BY total DESC
        LIMIT 10
      `),
    ])

    return NextResponse.json({
      metrics: metrics.rows[0],
      monthlySales: monthlySales.rows,
      topCities: topCities.rows,
    })
  } finally {
    client.release()
  }
}
