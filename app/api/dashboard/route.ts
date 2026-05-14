import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import pool from '@/lib/db'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    // Use pool.query() (not a shared client) so each query runs on its own connection
    // Running multiple client.query() in Promise.all on the same PoolClient causes
    // "missing FROM-clause entry" errors due to concurrent query execution on one socket
    const [metrics, monthlySales, topCities] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*)::int AS total_customers,
          COUNT(*) FILTER (WHERE is_active = true)::int AS active_customers,
          (SELECT COUNT(*)::int FROM purchases) AS total_orders,
          (SELECT COALESCE(SUM(total_amount), 0)::numeric FROM purchases WHERE status != 'cancelled') AS total_revenue,
          (SELECT COALESCE(AVG(total_amount), 0)::numeric FROM purchases WHERE status != 'cancelled') AS avg_order_value,
          COUNT(*) FILTER (WHERE source_channel = 'wbuy')::int AS wbuy_customers,
          COUNT(*) FILTER (WHERE source_channel = 'legacy_spreadsheet')::int AS legacy_customers
        FROM customers
      `),
      pool.query(`
        SELECT
          TO_CHAR(purchase_date, 'YYYY-MM') AS month,
          COUNT(*)::int AS orders,
          SUM(total_amount)::numeric AS revenue
        FROM purchases
        WHERE status != 'cancelled'
          AND purchase_date >= NOW() - INTERVAL '12 months'
        GROUP BY TO_CHAR(purchase_date, 'YYYY-MM')
        ORDER BY month ASC
      `),
      pool.query(`
        SELECT
          TRIM(SPLIT_PART(address_city, '|', 1)) AS city,
          TRIM(SPLIT_PART(address_state, '|', 1)) AS state,
          COUNT(*)::int AS total
        FROM customers
        WHERE address_city IS NOT NULL AND TRIM(address_city) != ''
        GROUP BY TRIM(SPLIT_PART(address_city, '|', 1)), TRIM(SPLIT_PART(address_state, '|', 1))
        ORDER BY total DESC
        LIMIT 10
      `),
    ])

    return NextResponse.json({
      metrics: metrics.rows[0],
      monthlySales: monthlySales.rows,
      topCities: topCities.rows,
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
