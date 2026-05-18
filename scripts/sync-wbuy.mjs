/**
 * sync-wbuy.mjs — Sincronização wBuy → CRM Wasabi
 *
 * Modos:
 *   node sync-wbuy.mjs            → sync diário (janela 60 dias)
 *   node sync-wbuy.mjs --audit    → auditoria profunda (janela 365 dias)
 *   node sync-wbuy.mjs --days=90  → janela customizada
 */

import pg from 'pg'
import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { appendFileSync, mkdirSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../.env.local') })

const { Pool } = pg

// ── Configuração ──────────────────────────────────────────────────────────────

const WBUY_BASE  = process.env.WBUY_API_URL
const WBUY_AUTH  = Buffer.from(`${process.env.WBUY_USER}:${process.env.WBUY_PASS}`).toString('base64')
const API_LIMIT  = 100   // limite real da API wBuy por requisição

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl:      { rejectUnauthorized: false },
})

const STATUSES = [
  { id: 7,  label: 'Pedido concluído',   dbStatus: 'completed' },
  { id: 3,  label: 'Pagamento efetuado', dbStatus: 'completed' },
  { id: 5,  label: 'Em transporte',      dbStatus: 'completed' },
  { id: 1,  label: 'Aguardando pag.',    dbStatus: 'pending'   },
  { id: 6,  label: 'Pedido cancelado',   dbStatus: 'cancelled' },
  { id: 8,  label: 'Pagamento negado',   dbStatus: 'cancelled' },
  { id: 10, label: 'Devolvido',          dbStatus: 'cancelled' },
]

// ── Args ──────────────────────────────────────────────────────────────────────

const args   = process.argv.slice(2)
const isAudit = args.includes('--audit')
const daysArg = args.find(a => a.startsWith('--days='))
const WINDOW_DAYS = daysArg
  ? Number(daysArg.split('=')[1])
  : isAudit ? 365 : 60

const mode = isAudit ? 'AUDITORIA' : 'DIÁRIO'

// ── Logger ────────────────────────────────────────────────────────────────────

const LOG_DIR  = resolve(__dirname, '../logs')
const LOG_FILE = resolve(LOG_DIR, 'sync-wbuy.log')
mkdirSync(LOG_DIR, { recursive: true })

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  appendFileSync(LOG_FILE, line + '\n')
}

// ── API ───────────────────────────────────────────────────────────────────────

async function wbuyFetch(path) {
  const res = await fetch(`${WBUY_BASE}${path}`, {
    headers: { Authorization: `Basic ${WBUY_AUTH}` },
  })
  if (!res.ok) throw new Error(`wBuy HTTP ${res.status} → ${path}`)
  const json = await res.json()
  if (json.responseCode !== 200) throw new Error(`wBuy erro: ${json.message}`)
  return json
}

/**
 * Busca todos os pedidos de um status dentro da janela de dias.
 *
 * A API retorna do mais novo ao mais antigo, limitado a 100 por chamada.
 * Estratégia de paginação:
 *   - 1ª chamada: /order?status=X  → 100 pedidos mais recentes
 *   - Se todos os 100 caem dentro da janela E o total da API é maior que 100,
 *     fazemos chamadas adicionais filtrando por ID individual para os pedidos
 *     que estão no DB mas não apareceram na resposta (pedidos dentro da janela
 *     que ficaram fora do corte de 100).
 *   - Em modo auditoria, também verifica pedidos do DB fora da janela padrão.
 */
async function fetchOrdersInWindow(statusId, cutoff, knownIds) {
  const json   = await wbuyFetch(`/order?status=${statusId}`)
  const all    = json.data ?? []
  const apiTotal = json.total ?? 0

  // Filtra apenas pedidos dentro da janela
  const inWindow = all.filter(o => o.data && new Date(o.data) >= cutoff)

  // Alerta de truncamento: retornou exatamente o limite E algum pedido
  // dentro da janela pode ter ficado de fora
  let truncated = false
  if (all.length >= API_LIMIT && inWindow.length === all.length) {
    truncated = true
    log(`  ⚠ ALERTA: status ${statusId} retornou ${API_LIMIT} pedidos e todos caem dentro da janela.`)
    log(`    Total API: ${apiTotal}. Pedidos fora da janela podem não ter sido capturados.`)
    log(`    → Paginação complementar via ID para pedidos conhecidos no DB.`)
  }

  // Paginação complementar: pedidos que estão no DB, dentro da janela,
  // mas não apareceram na resposta da API (ficaram além do corte de 100)
  if (truncated && knownIds.size > 0) {
    const returnedIds = new Set(all.map(o => String(o.id)))
    const missingInDb = [...knownIds].filter(id => !returnedIds.has(id))

    if (missingInDb.length > 0) {
      log(`    Buscando ${missingInDb.length} pedidos individuais não retornados pela API...`)
      for (const id of missingInDb) {
        try {
          const r = await wbuyFetch(`/order/${id}`)
          const o = r.data?.[0]
          if (o && o.data && new Date(o.data) >= cutoff) {
            inWindow.push(o)
          }
        } catch {
          // Pedido não encontrado na API — ignorar
        }
      }
    }
  }

  return { orders: inWindow, apiTotal, truncated }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizePhone(p) {
  return (p ?? '').replace(/\D/g, '')
}

function normalizeName(n) {
  if (!n) return null
  return n.trim().replace(/\b\w/g, c => c.toUpperCase())
}

// ── Clientes ──────────────────────────────────────────────────────────────────

function normalizeCpf(doc) {
  if (!doc) return null
  const digits = doc.replace(/\D/g, '')
  // CPF = 11 digits; CNPJ = 14 digits — only save CPFs
  return digits.length === 11 ? digits : null
}

async function findOrCreateCustomer(client, c) {
  const email = c.email?.toLowerCase().trim() || null
  const phone = normalizePhone(c.telefone1 || c.telefone2 || '') || null
  const name  = normalizeName(c.nome) || 'Desconhecido'
  const city  = c.cidade || null
  const state = c.uf    || null
  const cpf   = normalizeCpf(c.doc1 || '')

  if (email) {
    const r = await client.query(
      `SELECT id FROM customers WHERE LOWER(email) = $1 LIMIT 1`, [email]
    )
    if (r.rows.length) {
      // Backfill CPF if we now have it and the record doesn't
      if (cpf) {
        await client.query(
          `UPDATE customers SET cpf_encrypted = $1, updated_at = NOW()
           WHERE id = $2 AND cpf_encrypted IS NULL`,
          [cpf, r.rows[0].id]
        )
      }
      return r.rows[0].id
    }
  }

  if (phone && phone.length >= 8) {
    const r = await client.query(
      `SELECT id FROM customers
       WHERE REGEXP_REPLACE(COALESCE(phone,''), '[^0-9]', '', 'g') = $1 LIMIT 1`,
      [phone]
    )
    if (r.rows.length) {
      if (cpf) {
        await client.query(
          `UPDATE customers SET cpf_encrypted = $1, updated_at = NOW()
           WHERE id = $2 AND cpf_encrypted IS NULL`,
          [cpf, r.rows[0].id]
        )
      }
      return r.rows[0].id
    }
  }

  const ins = await client.query(
    `INSERT INTO customers
       (full_name, email, phone, cpf_encrypted, source_channel, address_city, address_state,
        total_spent, purchase_count, is_active, created_at, updated_at)
     VALUES ($1,$2,$3,$4,'wbuy',$5,$6,0,0,true,NOW(),NOW())
     RETURNING id`,
    [name, email, phone, cpf, city, state]
  )
  return ins.rows[0].id
}

// ── Pedidos ───────────────────────────────────────────────────────────────────

async function upsertOrder(client, order, dbStatus) {
  const externalId  = String(order.id)
  const total       = Number(order.valor_total?.total ?? 0)
  const date        = order.data ? new Date(order.data) : new Date()
  const orderNumber = order.identificacao || null

  // Verifica se já existe
  const existing = await client.query(
    `SELECT id, status, total_amount FROM purchases
     WHERE external_id = $1 AND source_channel = 'wbuy' LIMIT 1`,
    [externalId]
  )

  if (existing.rows.length) {
    const cur = existing.rows[0]
    const divergences = []
    if (cur.status !== dbStatus) divergences.push(`status: ${cur.status} → ${dbStatus}`)
    if (Number(cur.total_amount) !== total) divergences.push(`total: ${cur.total_amount} → ${total}`)

    // Atualiza campos que podem ter mudado
    await client.query(
      `UPDATE purchases
       SET status = $1, total_amount = $2, updated_at = NOW()
       WHERE id = $3`,
      [dbStatus, total, cur.id]
    )
    return { isNew: false, divergences }
  }

  // Pedido novo — cria cliente se necessário
  const customerId = await findOrCreateCustomer(client, order.cliente ?? {})

  const ins = await client.query(
    `INSERT INTO purchases
       (customer_id, purchase_date, total_amount, status,
        source_channel, external_id, order_number, imported_from, created_at, updated_at)
     VALUES ($1,$2,$3,$4,'wbuy',$5,$6,'wbuy_api',NOW(),NOW())
     RETURNING id`,
    [customerId, date, total, dbStatus, externalId, orderNumber]
  )
  const purchaseId = ins.rows[0].id

  for (const p of (order.produtos ?? [])) {
    const qty   = Number(p.qtd   ?? 1)
    const price = Number(p.valor ?? 0)
    await client.query(
      `INSERT INTO purchase_items
         (purchase_id, product_name, product_sku, quantity, unit_price, total_price, discount, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,0,NOW())`,
      [purchaseId, p.produto, p.sku || null, qty, price, qty * price]
    )
  }

  // Atualiza estatísticas do cliente
  await client.query(
    `UPDATE customers SET
       total_spent         = (SELECT COALESCE(SUM(total_amount),0)  FROM purchases WHERE customer_id=$1 AND status='completed'),
       purchase_count      = (SELECT COUNT(*)                        FROM purchases WHERE customer_id=$1 AND status='completed'),
       first_purchase_date = (SELECT MIN(purchase_date)              FROM purchases WHERE customer_id=$1 AND status='completed'),
       last_purchase_date  = (SELECT MAX(purchase_date)              FROM purchases WHERE customer_id=$1 AND status='completed'),
       updated_at = NOW()
     WHERE id = $1`,
    [customerId]
  )

  return { isNew: true, divergences: [] }
}

// ── Sync por status ───────────────────────────────────────────────────────────

async function syncStatus(statusDef, cutoff, knownIds) {
  const { id: statusId, label, dbStatus } = statusDef

  const { orders, apiTotal, truncated } = await fetchOrdersInWindow(statusId, cutoff, knownIds)

  log(`  Status ${statusId} (${label}): ${orders.length} na janela | total API: ${apiTotal}${truncated ? ' ⚠ truncado' : ''}`)

  let newCount = 0, updatedCount = 0, divergenceCount = 0, errorCount = 0

  for (const order of orders) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { isNew, divergences } = await upsertOrder(client, order, dbStatus)
      await client.query('COMMIT')

      if (isNew) {
        newCount++
        log(`    + NOVO pedido #${order.id} (${order.identificacao}) — ${order.data}`)
      } else {
        updatedCount++
        if (divergences.length) {
          divergenceCount++
          log(`    ~ DIVERGÊNCIA pedido #${order.id}: ${divergences.join(' | ')}`)
        }
      }
    } catch (err) {
      await client.query('ROLLBACK')
      log(`    ✗ ERRO pedido #${order.id}: ${err.message}`)
      errorCount++
    } finally {
      client.release()
    }
  }

  return { newCount, updatedCount, divergenceCount, errorCount, apiTotal, inWindow: orders.length, truncated }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const startedAt = new Date()
  const cutoff    = new Date(startedAt)
  cutoff.setDate(cutoff.getDate() - WINDOW_DAYS)

  log(`════════════════════════════════════════════════════`)
  log(`  Sync wBuy → CRM | Modo: ${mode} | Janela: ${WINDOW_DAYS} dias`)
  log(`  De: ${cutoff.toLocaleDateString('pt-BR')} até hoje`)
  log(`════════════════════════════════════════════════════`)

  // Carrega IDs wBuy já existentes no DB dentro da janela (para paginação complementar)
  const dbRes = await pool.query(
    `SELECT external_id FROM purchases
     WHERE source_channel = 'wbuy'
       AND purchase_date >= $1
       AND external_id IS NOT NULL`,
    [cutoff]
  )
  const knownIds = new Set(dbRes.rows.map(r => r.external_id))
  log(`  Pedidos wBuy no DB dentro da janela: ${knownIds.size}`)

  const totals = { new: 0, updated: 0, divergences: 0, errors: 0, reviewed: 0 }

  for (const statusDef of STATUSES) {
    const r = await syncStatus(statusDef, cutoff, knownIds)
    totals.new        += r.newCount
    totals.updated    += r.updatedCount
    totals.divergences+= r.divergenceCount
    totals.errors     += r.errorCount
    totals.reviewed   += r.inWindow
  }

  const elapsed = ((Date.now() - startedAt.getTime()) / 1000).toFixed(1)

  log(`════════════════════════════════════════════════════`)
  log(`  RESULTADO FINAL — ${elapsed}s`)
  log(`  Pedidos revisados:   ${totals.reviewed}`)
  log(`  Pedidos novos:       ${totals.new}`)
  log(`  Pedidos atualizados: ${totals.updated}`)
  log(`  Divergências:        ${totals.divergences}`)
  log(`  Erros:               ${totals.errors}`)
  log(`════════════════════════════════════════════════════`)

  if (totals.errors > 0) {
    log(`  ⚠ Há erros — verifique o log: ${LOG_FILE}`)
  }

  await pool.end()
}

main().catch(err => {
  log(`ERRO FATAL: ${err.message}`)
  process.exit(1)
})
