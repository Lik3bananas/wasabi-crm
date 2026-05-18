import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import pool from '@/lib/db'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const dateFrom = searchParams.get('date_from') || ''
  const dateTo   = searchParams.get('date_to')   || ''

  // Build shared period conditions for purchase-based metrics.
  // Ghost rows (total_amount = 0) are always excluded.
  // Two variants: plain (no alias) for queries without JOIN, aliased (pu.) for JOIN queries.
  const periodParams: unknown[] = []
  const periodConds:        string[] = ['total_amount > 0']
  const periodCondsAliased: string[] = ['pu.total_amount > 0']
  let idx = 1

  if (dateFrom) {
    periodConds.push(`purchase_date >= $${idx}`)
    periodCondsAliased.push(`pu.purchase_date >= $${idx}`)
    periodParams.push(dateFrom)
    idx++
  }
  if (dateTo) {
    periodConds.push(`purchase_date < $${idx}::date + INTERVAL '1 day'`)
    periodCondsAliased.push(`pu.purchase_date < $${idx}::date + INTERVAL '1 day'`)
    periodParams.push(dateTo)
    idx++
  }

  // Revenue / orders metrics also exclude cancelled
  const revenueWhere        = [...periodConds,        `status != 'cancelled'`].join(' AND ')
  const revenueWhereAliased = [...periodCondsAliased, `pu.status != 'cancelled'`].join(' AND ')

  // Monthly chart: same filter, but default to last 12 months when no period is set
  const chartConds = [...periodConds, `status != 'cancelled'`]
  if (!dateFrom && !dateTo) {
    chartConds.push(`purchase_date >= NOW() - INTERVAL '12 months'`)
  }
  const chartWhere = chartConds.join(' AND ')

  try {
    const [metrics, monthlySales, itemsMetrics, topCities] = await Promise.all([
      // Purchase metrics are filtered by period.
      // total_customers / active_customers are always global (base size never changes with period).
      pool.query(`
        SELECT
          (SELECT COUNT(*)::int FROM customers WHERE is_active = true AND total_spent > 0 AND (source_channel != 'pdvnet' OR cpf_encrypted IS NOT NULL)) AS total_customers,
          (SELECT COUNT(*)::int FROM customers WHERE is_active = true AND total_spent > 0 AND (source_channel != 'pdvnet' OR cpf_encrypted IS NOT NULL)) AS active_customers,
          COUNT(*)::int                                                AS total_orders,
          COALESCE(SUM(total_amount), 0)::numeric                     AS total_revenue,
          COALESCE(AVG(total_amount), 0)::numeric                     AS avg_order_value,
          COUNT(DISTINCT customer_id)::int                            AS unique_customers,
          COUNT(*) FILTER (WHERE source_channel = 'wbuy')::int   AS wbuy_orders,
          COUNT(*) FILTER (WHERE source_channel = 'legacy')::int  AS wix_orders,
          COUNT(*) FILTER (WHERE source_channel = 'pdvnet')::int  AS pdv_orders
        FROM purchases
        WHERE ${revenueWhere}
      `, periodParams),
      // Monthly revenue chart — grouped by month, filtered by period
      pool.query(`
        SELECT
          TO_CHAR(purchase_date, 'YYYY-MM') AS month,
          COUNT(*)::int                     AS orders,
          SUM(total_amount)::numeric        AS revenue
        FROM purchases
        WHERE ${chartWhere}
        GROUP BY TO_CHAR(purchase_date, 'YYYY-MM')
        ORDER BY month ASC
      `, periodParams),
      // Avg items (units) per order — filtered by period, requires JOIN with purchase_items
      pool.query(`
        SELECT
          COALESCE(
            SUM(pi.quantity)::numeric / NULLIF(COUNT(DISTINCT pu.id), 0),
            0
          )::numeric AS avg_items_per_order,
          COALESCE(SUM(pi.quantity), 0)::int AS total_units
        FROM purchases pu
        JOIN purchase_items pi ON pi.purchase_id = pu.id
        WHERE ${revenueWhereAliased}
      `, periodParams),
      // Top states — all channels, period-filtered
      // PDV orders always count as RJ; wBuy/Wix use real customer address_state
      pool.query(`
        SELECT
          CASE
            WHEN pu.source_channel = 'pdvnet' THEN 'RJ'
            ELSE REGEXP_REPLACE(TRIM(SPLIT_PART(c.address_state, '|', 1)), '^BR-', '')
          END AS state,
          COUNT(*)::int AS total
        FROM purchases pu
        LEFT JOIN customers c ON c.id = pu.customer_id
        WHERE ${revenueWhereAliased}
        GROUP BY CASE
          WHEN pu.source_channel = 'pdvnet' THEN 'RJ'
          ELSE REGEXP_REPLACE(TRIM(SPLIT_PART(c.address_state, '|', 1)), '^BR-', '')
        END
        ORDER BY total DESC
        LIMIT 10
      `, periodParams),
    ])

    return NextResponse.json({
      metrics:     { ...metrics.rows[0], ...itemsMetrics.rows[0] },
      monthlySales: monthlySales.rows,
      topCities:   topCities.rows,
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
