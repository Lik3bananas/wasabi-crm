#!/usr/bin/env node
/**
 * sync-abandoned-carts.mjs
 *
 * Extrai carrinhos abandonados da aba do wBuy JÁ ABERTA no Chrome
 * via Chrome DevTools Protocol (CDP) e salva direto no banco.
 *
 * PRÉ-REQUISITO: Chrome deve estar aberto com a aba do wBuy autenticada.
 * O Chrome precisa ser iniciado com --remote-debugging-port=9222
 *
 * Alternativa manual:
 *   node scripts/sync-abandoned-carts.mjs --manual
 *   (abre Chrome visível via Puppeteer para login manual)
 *
 * Uso normal (via Task Scheduler):
 *   node scripts/sync-abandoned-carts.mjs
 *   node scripts/sync-abandoned-carts.mjs --days=7
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { execSync } from 'child_process';

const require = createRequire(import.meta.url);
const dotenv  = require('dotenv');
const pg      = require('pg');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.join(__dirname, '..');

dotenv.config({ path: path.join(ROOT, '.env.local') });

// ─── Config ──────────────────────────────────────────────────────────────────
const LOG_FILE   = path.join(ROOT, 'logs', 'sync-abandoned-carts.log');
const PANEL_URL  = 'https://sistema.sistemawbuy.com.br';
const CDP_PORT   = 9222;

const args    = process.argv.slice(2);
const DAYS    = parseInt((args.find(a => a.startsWith('--days=')) || '--days=7').split('=')[1]);

// ─── Logging ─────────────────────────────────────────────────────────────────
function log(msg, level = 'INFO') {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}`;
  console.log(line);
  try {
    fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {}
}

// ─── Windows Notification ────────────────────────────────────────────────────
function notify(title, message) {
  try {
    const t = title.replace(/['"]/g, '');
    const m = message.replace(/['"]/g, '').slice(0, 200);
    execSync(
      `powershell -NoProfile -WindowStyle Hidden -Command "$s=New-Object -ComObject WScript.Shell;$s.Popup('${m}',30,'${t}',0x40)"`,
      { timeout: 6000 }
    );
  } catch {
    log(`[NOTIF] ${title}: ${message}`, 'WARN');
  }
}

// ─── CDP helper ──────────────────────────────────────────────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    }).on('error', reject);
  });
}

async function getCDPTabs() {
  try {
    const tabs = await httpGet(`http://localhost:${CDP_PORT}/json`);
    return Array.isArray(tabs) ? tabs : [];
  } catch {
    return [];
  }
}

// ─── Build URL ───────────────────────────────────────────────────────────────
function buildCartsUrl(days) {
  const d0 = new Date();
  d0.setDate(d0.getDate() - days);
  const dd = String(d0.getDate()).padStart(2, '0');
  const mm = String(d0.getMonth() + 1).padStart(2, '0');
  const yy = d0.getFullYear();
  return `${PANEL_URL}/painel/pedidos/carrinhos-abandonados?q=&data1=${encodeURIComponent(`${dd}/${mm}/${yy}`)}&data2=`;
}

// ─── DB ──────────────────────────────────────────────────────────────────────
const pool = new pg.Pool({
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl:      { rejectUnauthorized: false },
});

function parseBRL(v) {
  return parseFloat((v || '0').replace('R$', '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.')) || 0;
}
function parseBRDate(d) {
  if (!d) return new Date();
  const [day, month, year] = d.split('/');
  return new Date(`${year}-${month}-${day}T12:00:00`);
}

async function syncToDB(carts) {
  const client = await pool.connect();
  let inserted = 0, updated = 0;
  try {
    await client.query('BEGIN');
    for (const cart of carts) {
      let customerId = null;
      if (cart.email) {
        const existing = await client.query('SELECT id FROM customers WHERE email=$1 LIMIT 1', [cart.email]);
        if (existing.rows.length > 0) {
          customerId = existing.rows[0].id;
          // Atualizar nome se estava vazio
          if (cart.name) {
            await client.query(
              `UPDATE customers SET full_name = CASE WHEN full_name IS NULL OR full_name='' THEN $1 ELSE full_name END, updated_at=NOW() WHERE id=$2`,
              [cart.name, customerId]
            );
          }
        } else {
          const r = await client.query(
            `INSERT INTO customers (full_name, email, source_channel, total_spent, purchase_count, is_active, created_at, updated_at)
             VALUES ($1,$2,'wbuy',0,0,true,NOW(),NOW()) RETURNING id`,
            [cart.name || 'Desconhecido', cart.email]
          );
          customerId = r.rows[0].id;
        }
      }

      const total = parseBRL(cart.total);
      const pDate = parseBRDate(cart.date);
      const wStat = cart.status || 'Abandonado';

      const ex = await client.query('SELECT id FROM purchases WHERE external_id=$1', [cart.cartId]);
      if (ex.rows.length > 0) {
        await client.query(
          `UPDATE purchases SET total_amount=$1, purchase_date=$2, order_number=$3, updated_at=NOW() WHERE external_id=$4`,
          [total, pDate, wStat, cart.cartId]
        );
        updated++;
      } else {
        await client.query(
          `INSERT INTO purchases (customer_id,purchase_date,total_amount,status,source_channel,external_id,order_number,imported_from,created_at)
           VALUES ($1,$2,$3,'abandoned','wbuy',$4,$5,'wbuy_abandoned_cart',NOW())`,
          [customerId, pDate, total, cart.cartId, wStat]
        );
        inserted++;
      }
    }
    await client.query('COMMIT');
    return { inserted, updated };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ─── Extract carts via CDP ────────────────────────────────────────────────────
const EXTRACT_JS = `
(function() {
  const items = document.querySelectorAll('div.item.dblclick');
  const result = [];
  items.forEach(item => {
    const excEl = item.querySelector('[onclick*="exclui_email"]');
    const idM   = excEl?.getAttribute('onclick')?.match(/'id':'([^']+)'/);
    if (!idM) return;
    const cartId = idM[1];
    const text   = item.innerText || '';
    const emailM = text.match(/[\\w.\\-+]+@[\\w.\\-]+\\.\\w+/);
    const valM   = text.match(/R\\$[\\d.,]+/);
    const dateM  = text.match(/\\d{2}\\/\\d{2}\\/\\d{4}/);
    const timeM  = text.match(/\\d{2}h\\d{2}/);
    const lines  = text.split('\\n').map(l => l.trim()).filter(Boolean);
    let name = '';
    for (const line of lines) {
      if (!line.match(/^\\d/) && !line.includes('@') && !line.includes('R$') &&
          !line.toLowerCase().includes('produto') && !line.toLowerCase().includes('recupera') &&
          !line.toLowerCase().includes('envio') && !line.toLowerCase().includes('id:') &&
          line.length > 3) { name = line; break; }
    }
    const status = text.includes('Recuperado') ? 'Recuperado'
      : text.includes('Em recupera') ? 'Em recuperação' : 'Abandonado';
    result.push({ cartId, name, email: emailM?.[0] ?? null, total: valM?.[0] ?? 'R$0,00',
      date: dateM?.[0] ?? null, time: timeM?.[0] ?? null, status });
  });
  return JSON.stringify(result);
})()
`;

async function extractViaCDP(tabId) {
  return new Promise((resolve, reject) => {
    const WebSocket = require('ws');
    const ws = new WebSocket(`ws://localhost:${CDP_PORT}/devtools/page/${tabId}`);
    const msgId = 1;
    let resolved = false;

    ws.on('open', () => {
      ws.send(JSON.stringify({ id: msgId, method: 'Runtime.evaluate', params: { expression: EXTRACT_JS, returnByValue: true } }));
    });
    ws.on('message', data => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.id === msgId) {
          ws.close();
          if (!resolved) {
            resolved = true;
            const val = msg.result?.result?.value;
            resolve(val ? JSON.parse(val) : []);
          }
        }
      } catch(e) { if (!resolved) { resolved = true; reject(e); } }
    });
    ws.on('error', e => { if (!resolved) { resolved = true; reject(e); } });
    setTimeout(() => { if (!resolved) { resolved = true; ws.close(); reject(new Error('CDP timeout')); } }, 15000);
  });
}

// ─── Puppeteer fallback (headless:false off-screen) ──────────────────────────
const SESSION_DIR  = path.join(__dirname, '.wbuy-session');
const COOKIES_FILE = path.join(__dirname, '.wbuy-cookies.json');
const CHROME_EXE   = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function loadCookies() {
  if (!fs.existsSync(COOKIES_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8')); } catch { return null; }
}
function saveCookies(cookies) {
  fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
  log(`${cookies.length} cookies salvos.`);
}

async function extractViaPuppeteer(cartsUrl) {
  let puppeteer;
  try { puppeteer = (await import('puppeteer-core')).default; }
  catch { puppeteer = require('puppeteer-core'); }

  fs.mkdirSync(SESSION_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME_EXE,
    headless: false,
    userDataDir: SESSION_DIR,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-position=-9999,-9999',
      '--window-size=1280,800',
    ],
    defaultViewport: null,
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36');
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.chrome = { runtime: {} };
    });

    const cookies = loadCookies();
    if (cookies) {
      await page.setCookie(...cookies);
      log(`${cookies.length} cookies restaurados.`);
    }

    await page.goto(cartsUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    const currentUrl = page.url();

    const isLoginPage = currentUrl.includes('/login') || currentUrl.includes('/entrar')
      || (await page.$('input[name="email"]')) !== null;

    if (isLoginPage) {
      log('Sessão wBuy expirada — necessário login manual.', 'WARN');
      await browser.close();
      notify('Wasabi CRM — Login wBuy necessário', 'Sessao expirada. Execute o setup: node scripts/sync-abandoned-carts.mjs --setup');
      return null;
    }

    const freshCookies = await page.cookies();
    if (freshCookies.length > 0) saveCookies(freshCookies);

    await page.waitForSelector('div.item.dblclick, .paginacao, .vazio, #main', { timeout: 10000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));

    const carts = await page.evaluate(() => {
      const items = document.querySelectorAll('div.item.dblclick');
      const result = [];
      items.forEach(item => {
        const excEl = item.querySelector('[onclick*="exclui_email"]');
        const idM   = excEl?.getAttribute('onclick')?.match(/'id':'([^']+)'/);
        if (!idM) return;
        const cartId = idM[1];
        const text   = item.innerText || '';
        const emailM = text.match(/[\w.\-+]+@[\w.\-]+\.\w+/);
        const valM   = text.match(/R\$[\d.,]+/);
        const dateM  = text.match(/\d{2}\/\d{2}\/\d{4}/);
        const timeM  = text.match(/\d{2}h\d{2}/);
        const lines  = text.split('\n').map(l => l.trim()).filter(Boolean);
        let name = '';
        for (const line of lines) {
          if (!line.match(/^\d/) && !line.includes('@') && !line.includes('R$') &&
              !line.toLowerCase().includes('produto') && !line.toLowerCase().includes('recupera') &&
              !line.toLowerCase().includes('envio') && !line.toLowerCase().includes('id:') &&
              line.length > 3) { name = line; break; }
        }
        const status = text.includes('Recuperado') ? 'Recuperado'
          : text.includes('Em recupera') ? 'Em recuperação' : 'Abandonado';
        result.push({ cartId, name, email: emailM?.[0] ?? null, total: valM?.[0] ?? 'R$0,00',
          date: dateM?.[0] ?? null, time: timeM?.[0] ?? null, status });
      });
      return result;
    });

    return carts;
  } finally {
    await browser.close().catch(() => {});
  }
}

// ─── Setup mode (login manual visível) ───────────────────────────────────────
async function runSetup() {
  let puppeteer;
  try { puppeteer = (await import('puppeteer-core')).default; }
  catch { puppeteer = require('puppeteer-core'); }

  fs.mkdirSync(SESSION_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME_EXE,
    headless: false,
    userDataDir: SESSION_DIR,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized'],
    defaultViewport: null,
  });

  const cartsUrl = buildCartsUrl(DAYS);
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36');
  await page.goto(cartsUrl, { waitUntil: 'networkidle2', timeout: 30000 });

  log('Aguardando login manual no wBuy (até 3 minutos)...');
  log('→ Faça login na janela do Chrome que abriu.');

  await page.waitForFunction(
    () => window.location.href.includes('carrinhos-abandonados'),
    { timeout: 180000 }
  ).catch(async () => {
    await page.goto(cartsUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  });

  const cookies = await page.cookies();
  saveCookies(cookies);
  log('Setup concluído! Sessão salva. Próximas execuções serão silenciosas.');
  await browser.close();
}

// ─── Main ─────────────────────────────────────────────────────────────────────
log('='.repeat(60));
log(`Sync carrinhos abandonados — últimos ${DAYS} dias`);

if (args.includes('--setup')) {
  await runSetup();
  await pool.end().catch(() => {});
  process.exit(0);
}

const cartsUrl = buildCartsUrl(DAYS);
let carts = null;

// Tentativa 1: Chrome com depuração remota aberto (mais rápido, sem nova janela)
log('Tentando via CDP (Chrome com debugging)...');
const cdpTabs = await getCDPTabs();
const wbuyTab = cdpTabs.find(t => t.url && t.url.includes('sistemawbuy.com.br'));

if (wbuyTab) {
  log(`Aba wBuy encontrada via CDP: ${wbuyTab.title}`);
  // Navegar para a URL de carrinhos se necessário
  if (!wbuyTab.url.includes('carrinhos-abandonados')) {
    log('Navegando para carrinhos-abandonados...');
    // Usamos fetch para enviar comando de navegação via CDP HTTP API
    try {
      await new Promise((resolve, reject) => {
        const WebSocket = require('ws');
        const ws = new WebSocket(`ws://localhost:${CDP_PORT}/devtools/page/${wbuyTab.id}`);
        ws.on('open', () => {
          ws.send(JSON.stringify({ id: 1, method: 'Page.navigate', params: { url: cartsUrl } }));
          setTimeout(() => { ws.close(); resolve(); }, 4000);
        });
        ws.on('error', reject);
      });
    } catch(e) { log('Erro ao navegar: ' + e.message, 'WARN'); }
    await new Promise(r => setTimeout(r, 3000));
  }
  try {
    carts = await extractViaCDP(wbuyTab.id);
    log(`CDP: ${carts.length} carrinhos extraídos.`);
  } catch(e) {
    log('CDP falhou: ' + e.message + ' — usando Puppeteer.', 'WARN');
  }
}

// Tentativa 2: Puppeteer com sessão salva (off-screen)
if (!carts) {
  log('Usando Puppeteer (off-screen)...');
  try {
    carts = await extractViaPuppeteer(cartsUrl);
  } catch(e) {
    log('Puppeteer falhou: ' + e.message, 'ERROR');
    notify('Wasabi CRM — Erro no sync', e.message.slice(0, 150));
    await pool.end().catch(() => {});
    process.exit(1);
  }
}

if (!carts) {
  log('Sync cancelado (sessão expirada ou erro).', 'WARN');
  await pool.end().catch(() => {});
  process.exit(0);
}

log(`Carrinhos encontrados: ${carts.length}`);
carts.forEach(c => log(`  → ${c.name} | ${c.email || 'sem email'} | ${c.total} | ${c.date} | ${c.status}`));

if (carts.length > 0) {
  try {
    const { inserted, updated } = await syncToDB(carts);
    log(`✅ Sync concluído: ${inserted} novos, ${updated} atualizados.`);
  } catch(e) {
    log('Erro ao salvar no banco: ' + e.message, 'ERROR');
    notify('Wasabi CRM — Erro no banco', e.message.slice(0, 150));
  }
} else {
  log('Nenhum carrinho no período.');
}

await pool.end().catch(() => {});
log('Finalizado.');
process.exit(0);
