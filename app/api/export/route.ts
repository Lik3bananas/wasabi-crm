import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import pool from '@/lib/db'
import ExcelJS from 'exceljs'

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

  // Exclude ghost records and legal entities (CNPJ); show only pessoas físicas (CPF)
  const conditions: string[] = ['c.total_spent > 0', 'c.cpf_encrypted IS NOT NULL']
  const params: unknown[] = []
  let p = 1

  if (search) { conditions.push(`(c.full_name ILIKE $${p} OR c.email ILIKE $${p} OR c.phone ILIKE $${p})`); params.push(`%${search}%`); p++ }
  if (city) { conditions.push(`c.address_city ILIKE $${p}`); params.push(`%${city}%`); p++ }
  if (state) { conditions.push(`c.address_state ILIKE $${p}`); params.push(`%${state}%`); p++ }
  if (dateFrom && dateTo) { conditions.push(`EXISTS (SELECT 1 FROM purchases pu WHERE pu.customer_id = c.id AND pu.total_amount > 0 AND pu.purchase_date BETWEEN $${p} AND $${p+1})`); params.push(dateFrom, dateTo); p += 2 }
  if (filter === 'inactive_30') conditions.push(`c.last_purchase_date < NOW() - INTERVAL '30 days'`)
  if (filter === 'inactive_60') conditions.push(`c.last_purchase_date < NOW() - INTERVAL '60 days'`)
  if (filter === 'inactive_90') conditions.push(`c.last_purchase_date < NOW() - INTERVAL '90 days'`)

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const orderBy = filter === 'best_buyers' ? 'ORDER BY c.total_spent DESC NULLS LAST' : 'ORDER BY c.full_name ASC'

  const rows = await pool.query(
    `SELECT
      c.full_name AS "Nome",
      c.email AS "Email",
      c.phone AS "Telefone",
      TRIM(SPLIT_PART(c.address_city, '|', 1)) AS "Cidade",
      TRIM(SPLIT_PART(c.address_state, '|', 1)) AS "Estado",
      c.total_spent AS "Acumulado Comprado (R$)",
      c.purchase_count AS "Nº Pedidos",
      c.first_purchase_date AS "Primeira Compra",
      c.last_purchase_date AS "Última Compra",
      c.source_channel AS "Canal",
      CASE WHEN c.is_active THEN 'Ativo' ELSE 'Inativo' END AS "Status"
    FROM customers c ${where} ${orderBy} LIMIT 5000`,
    params
  )

  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Clientes')

  if (rows.rows.length > 0) {
    sheet.columns = Object.keys(rows.rows[0]).map((key) => ({ header: key, key, width: 22 }))
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF166534' } }
    rows.rows.forEach((row) => sheet.addRow(row))
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="clientes-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  })
}
