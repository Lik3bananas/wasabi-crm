import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import pool from '@/lib/db'

const PT_LOWER = new Set(['de','da','do','das','dos','e','em','na','no','nas','nos','com','por','para','a','o','as','os','ao','aos'])

function toTitleCase(name: string | null): string | null {
  if (!name) return name
  return name
    .toLowerCase()
    .split(' ')
    .map((word, i) => {
      if (!word) return word
      if (i === 0 || !PT_LOWER.has(word)) return word.charAt(0).toUpperCase() + word.slice(1)
      return word
    })
    .join(' ')
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const search = searchParams.get('search') || ''
  const status = searchParams.get('status') || ''
  const dateFrom = searchParams.get('date_from') || ''
  const dateTo = searchParams.get('date_to') || ''
  const page = Math.max(1, Number(searchParams.get('page') || 1))
  const limit = 50
  const offset = (page - 1) * limit

  // Pedidos com valor zero são registros fantasma (wBuy checkpoint rows).
  // Nunca devem aparecer em nenhuma listagem ou métrica.
  // Ghost rows excluded; PDVNet without CPF = company → hide; wBuy/legacy = always show
  const conditions: string[] = [
    'pu.total_amount > 0',
    `(c.source_channel != 'pdvnet' OR c.cpf_encrypted IS NOT NULL)`,
  ]
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

  try {
  const [rows, countRow] = await Promise.all([
    pool.query(
      `SELECT
        pu.id, pu.customer_id, c.full_name AS customer_name,
        pu.purchase_date, pu.total_amount, pu.status, pu.source_channel,
        l.nome  AS loja_nome,
        v.nome  AS vendedora_nome,
        COUNT(pi.id)::int AS item_count,
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'product_name', pi.product_name,
              'sku',          pi.product_sku,
              'quantity',     pi.quantity,
              'unit_price',   pi.unit_price,
              'total_price',  pi.total_price
            ) ORDER BY pi.id
          ) FILTER (WHERE pi.id IS NOT NULL),
          '[]'
        ) AS items
       FROM purchases pu
       JOIN customers c ON c.id = pu.customer_id
       LEFT JOIN lojas      l  ON l.pdv_id  = pu.loja_id
       LEFT JOIN vendedores v  ON v.pdv_id  = pu.vendedor_pdv_id
       LEFT JOIN purchase_items pi ON pi.purchase_id = pu.id
       ${where}
       GROUP BY pu.id, c.full_name, l.nome, v.nome
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

  type PurchaseRow = { customer_name: string; total_amount: string; items: { unit_price: string; total_price: string }[] }

  const normalized = (rows.rows as PurchaseRow[]).map((p) => ({
    ...p,
    customer_name: toTitleCase(p.customer_name),
  }))

  return NextResponse.json({
    purchases: normalized,
    total: countRow.rows[0].total,
    page,
    totalPages: Math.ceil(countRow.rows[0].total / limit),
  })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
