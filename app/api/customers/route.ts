import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import pool from '@/lib/db'

// Prepositions and conjunctions that stay lowercase (Portuguese)
const PT_LOWER = new Set(['de','da','do','das','dos','e','em','na','no','nas','nos','com','por','para','a','o','as','os','ao','aos'])

function toTitleCase(name: string | null): string | null {
  if (!name) return name
  return name
    .toLowerCase()
    .split(' ')
    .map((word, i) => {
      if (!word) return word
      // Always capitalize first word and words not in the preposition list
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
  const city = searchParams.get('city') || ''
  const state = searchParams.get('state') || ''
  const filter = searchParams.get('filter') || ''
  const dateFrom = searchParams.get('date_from') || ''
  const dateTo = searchParams.get('date_to') || ''
  const cepsParam = searchParams.get('ceps') || ''
  // Normalise: keep only digits, drop anything shorter than 5 chars (incomplete CEP)
  const cepList = cepsParam
    ? cepsParam.split(',').map(c => c.replace(/\D/g, '')).filter(c => c.length >= 5)
    : []
  const page = Math.max(1, Number(searchParams.get('page') || 1))
  const limit = 50
  const offset = (page - 1) * limit

  // Always exclude inactive (test/training) customers
  const conditions: string[] = ['c.is_active = true']
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
    conditions.push(`EXISTS (SELECT 1 FROM purchases pu WHERE pu.customer_id = c.id AND pu.purchase_date BETWEEN $${p} AND $${p + 1}::date + INTERVAL '1 day')`)
    params.push(dateFrom, dateTo)
    p += 2
  } else if (dateFrom) {
    // Use actual purchase records — last_purchase_date column may have DD/MM swap errors from import
    conditions.push(`EXISTS (SELECT 1 FROM purchases pu WHERE pu.customer_id = c.id AND pu.purchase_date >= $${p})`)
    params.push(dateFrom)
    p++
  }

  if (cepList.length > 0) {
    // Normalise the stored CEP the same way (strip dashes) before comparing.
    // address_zipcode may contain pipe-separated values from multiple sources;
    // we check ALL parts so that merged records are always found.
    conditions.push(
      `EXISTS (
         SELECT 1
         FROM UNNEST(STRING_TO_ARRAY(
           REGEXP_REPLACE(COALESCE(c.address_zipcode,''), '-', '', 'g'), '|'
         )) AS _z
         WHERE TRIM(_z) = ANY($${p})
       )`
    )
    params.push(cepList)
    p++
  }

  // Legacy inactive shortcuts
  if (filter === 'inactive_30') conditions.push(`c.last_purchase_date < NOW() - INTERVAL '30 days'`)
  else if (filter === 'inactive_60') conditions.push(`c.last_purchase_date < NOW() - INTERVAL '60 days'`)
  else if (filter === 'inactive_90') conditions.push(`c.last_purchase_date < NOW() - INTERVAL '90 days'`)

  // Advanced segmentation: inactivity in days
  const inactiveDays = Number(searchParams.get('inactive_days') || 0)
  if (inactiveDays > 0) {
    conditions.push(`c.last_purchase_date < NOW() - (INTERVAL '1 day' * $${p}::int)`)
    params.push(inactiveDays)
    p++
  }

  // Advanced segmentation: min purchases
  const minPurchases = Number(searchParams.get('min_purchases') || 0)
  if (minPurchases > 0) {
    conditions.push(`c.purchase_count >= $${p}`)
    params.push(minPurchases)
    p++
  }

  // Advanced segmentation: max purchases (e.g. one-time buyers = max 1)
  const maxPurchases = Number(searchParams.get('max_purchases') || 0)
  if (maxPurchases > 0) {
    conditions.push(`c.purchase_count <= $${p}`)
    params.push(maxPurchases)
    p++
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const sortBy  = searchParams.get('sort_by')  || 'name'
  const sortDir = searchParams.get('sort_dir') === 'desc' ? 'DESC' : 'ASC'
  const sortCol: Record<string, string> = {
    name:          'full_name',
    total_spent:   'total_spent',
    purchase_count:'purchase_count',
    last_purchase: 'last_purchase_date',
    channel:       'source_channel',
  }
  const col = sortCol[sortBy] || 'full_name'
  // best_buyers filter overrides sort
  const orderBy = filter === 'best_buyers'
    ? 'ORDER BY total_spent DESC NULLS LAST'
    : `ORDER BY ${col} ${sortDir} NULLS LAST`

  try {
  const [rows, countRow] = await Promise.all([
    pool.query(
      `SELECT id, full_name, email, phone, source_channel, total_spent, purchase_count,
              first_purchase_date, last_purchase_date, is_active, city, state
       FROM (
         SELECT DISTINCT ON (COALESCE(LOWER(c.email), c.id::text))
           c.id,
           c.full_name,
           c.email,
           c.phone,
           COALESCE(
             (SELECT p.source_channel FROM purchases p
              WHERE p.customer_id = c.id
              ORDER BY p.purchase_date DESC LIMIT 1),
             c.source_channel
           ) AS source_channel,
           c.total_spent,
           c.purchase_count,
           c.first_purchase_date,
           c.last_purchase_date,
           c.is_active,
           TRIM(SPLIT_PART(c.address_city, '|', 1)) AS city,
           TRIM(SPLIT_PART(c.address_state, '|', 1)) AS state
         FROM customers c
         ${where}
         ORDER BY COALESCE(LOWER(c.email), c.id::text),
           CASE WHEN c.source_channel = 'wbuy' THEN 0 ELSE 1 END,
           c.last_purchase_date DESC NULLS LAST
       ) deduped
       ${orderBy}
       LIMIT $${p} OFFSET $${p + 1}`,
      [...params, limit, offset]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM (
         SELECT DISTINCT ON (COALESCE(LOWER(c.email), c.id::text)) c.id
         FROM customers c ${where}
         ORDER BY COALESCE(LOWER(c.email), c.id::text)
       ) deduped`,
      params
    ),
  ])

  const normalized = rows.rows.map((c: { full_name: string }) => ({
    ...c,
    full_name: toTitleCase(c.full_name),
  }))

  return NextResponse.json({
    customers: normalized,
    total: countRow.rows[0].total,
    page,
    totalPages: Math.ceil(countRow.rows[0].total / limit),
  })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
