#!/usr/bin/env python3
"""
SKILL: Sync Diario PDVNet -> Wasabi CRM
Versao: 1.0

Sincroniza incrementalmente vendas novas da loja fisica (PDVNet) com a base CRM.
Usa timestamp de controle para buscar apenas registros novos.

SEGURANCA:
  - Timestamp so e atualizado apos importacao 100% concluida sem erros
  - Em caso de falha, mantem timestamp anterior (nenhuma venda perdida)
  - Retry automatico com backoff exponencial para falhas de API
  - Log persistente em banco para auditoria completa

USO:
  python skill_sync_pdvnet_daily.py              # sync incremental normal
  python skill_sync_pdvnet_daily.py --dry-run    # simula sem inserir
  python skill_sync_pdvnet_daily.py --force-desde 2026-05-01  # forca data inicio
  python skill_sync_pdvnet_daily.py --show-logs  # mostra ultimos 10 logs

AGENDAMENTO SUGERIDO (Windows Task Scheduler):
  Executar: python C:\...\skill_sync_pdvnet_daily.py
  Horario:  06:00, 12:00, 18:00 (3x ao dia)
  Ou cron Linux: 0 6,12,18 * * *
"""

import os
import sys
import time
import logging
import argparse
import traceback
import requests
import psycopg2
from datetime import datetime, timezone
from dotenv import load_dotenv

# ============================================================
# CONFIGURACAO
# ============================================================

load_dotenv('wasabi_CREDENTIALS.env')

DB_CONFIG = {
    'host':     os.getenv('DB_ENDPOINT', 'crm-postgres-prod.crcwscya20vj.us-east-2.rds.amazonaws.com'),
    'port':     int(os.getenv('DB_PORT', 5432)),
    'database': os.getenv('DB_NAME', 'crm_wasabi'),
    'user':     os.getenv('DB_USER', 'postgres'),
    'password': os.getenv('DB_PASSWORD', ''),
}

PDVNET_BASE_URL = os.getenv('PDVNET_BASE_URL', 'http://wasabi.pdvnet.com.br/pdvapi')
PDVNET_USUARIO  = os.getenv('PDVNET_USUARIO', 'Re Veras')
PDVNET_SENHA    = os.getenv('PDVNET_SENHA', '8170')

PAGE_SIZE    = 50    # limite real da API PDVNet (>50 retorna HTTP 500)
MAX_RETRIES  = 3     # tentativas por chamada de API
RETRY_DELAY  = 2     # segundos base para backoff exponencial

# ============================================================
# LOGGING
# ============================================================

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('pdvnet_sync.log', encoding='utf-8'),
    ]
)
log = logging.getLogger('pdvnet_sync')

# ============================================================
# HELPERS DE API COM RETRY
# ============================================================

def api_get(url, headers, params=None, timeout=30):
    """GET com retry automatico e backoff exponencial."""
    for tentativa in range(1, MAX_RETRIES + 1):
        try:
            resp = requests.get(url, headers=headers, params=params, timeout=timeout)
            resp.raise_for_status()
            return resp
        except requests.exceptions.Timeout:
            log.warning(f"Timeout na tentativa {tentativa}/{MAX_RETRIES}: {url}")
        except requests.exceptions.HTTPError as e:
            if e.response is not None and e.response.status_code in (400, 401, 403, 404):
                raise  # erros permanentes: nao retenta
            log.warning(f"HTTP {e.response.status_code} na tentativa {tentativa}/{MAX_RETRIES}")
        except requests.exceptions.ConnectionError:
            log.warning(f"Erro de conexao na tentativa {tentativa}/{MAX_RETRIES}")

        if tentativa < MAX_RETRIES:
            espera = RETRY_DELAY * (2 ** (tentativa - 1))
            log.info(f"Aguardando {espera}s antes de nova tentativa...")
            time.sleep(espera)

    raise Exception(f"API falhou apos {MAX_RETRIES} tentativas: {url}")


def autenticar():
    """Login PDVNet. Retorna token Bearer."""
    url = f"{PDVNET_BASE_URL}/api/public/login"
    resp = requests.post(
        url,
        json={"Usuario": PDVNET_USUARIO, "Senha": PDVNET_SENHA},
        timeout=30
    )
    resp.raise_for_status()
    token = resp.json().get('Token')
    if not token:
        raise Exception(f"Login PDVNet falhou: {resp.json()}")
    return token


def headers_auth(token):
    return {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}

# ============================================================
# CONTROLE DE SYNC
# ============================================================

def obter_ultimo_sync(conn):
    """Retorna (last_sync_at, control_id) da tabela de controle."""
    cur = conn.cursor()
    cur.execute("SELECT id, last_sync_at FROM pdvnet_sync_control ORDER BY id LIMIT 1")
    row = cur.fetchone()
    cur.close()
    if not row:
        raise Exception("Tabela pdvnet_sync_control vazia. Execute setup primeiro.")
    return row[0], row[1]  # control_id, last_sync_at


def criar_log_inicio(conn, desde, ate):
    """Insere registro de log no inicio da execucao. Retorna log_id."""
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO pdvnet_sync_log
            (started_at, status, desde_timestamp, ate_timestamp)
        VALUES (NOW(), 'running', %s, %s)
        RETURNING id
    """, (desde, ate))
    log_id = cur.fetchone()[0]
    conn.commit()
    cur.close()
    return log_id


def atualizar_log(conn, log_id, status, stats, error_msg=None, new_timestamp=None):
    """Atualiza registro de log ao final da execucao."""
    cur = conn.cursor()
    cur.execute("""
        UPDATE pdvnet_sync_log SET
            completed_at            = NOW(),
            status                  = %s,
            vendas_encontradas      = %s,
            vendas_importadas       = %s,
            vendas_duplicadas       = %s,
            vendas_site_ignoradas   = %s,
            clientes_novos          = %s,
            erros_count             = %s,
            execution_time_seconds  = EXTRACT(EPOCH FROM (NOW() - started_at)),
            new_sync_timestamp      = %s,
            error_message           = %s
        WHERE id = %s
    """, (
        status,
        stats.get('vendas_encontradas', 0),
        stats.get('vendas_novas', 0),
        stats.get('vendas_duplicadas', 0),
        stats.get('vendas_site_ignoradas', 0),
        stats.get('clientes_novos', 0),
        stats.get('erros', 0),
        new_timestamp,
        error_msg,
        log_id,
    ))
    conn.commit()
    cur.close()


def salvar_timestamp_sucesso(conn, control_id, novo_timestamp):
    """
    Atualiza o timestamp de controle SOMENTE apos importacao bem-sucedida.
    REGRA CRITICA: nunca atualizar em caso de erro.
    """
    cur = conn.cursor()
    cur.execute("""
        UPDATE pdvnet_sync_control SET
            last_sync_at            = %s,
            last_sync_completed_at  = NOW(),
            last_sync_status        = 'success',
            updated_at              = NOW()
        WHERE id = %s
    """, (novo_timestamp, control_id))
    conn.commit()
    cur.close()
    log.info(f"Timestamp de controle atualizado para: {novo_timestamp}")

# ============================================================
# BUSCA DE VENDAS
# ============================================================

def buscar_vendas(token, desde, ate):
    """Busca todas as vendas do periodo com paginacao completa."""
    url    = f"{PDVNET_BASE_URL}/api/public/vendas"
    desde_str = desde.strftime('%Y-%m-%d') if hasattr(desde, 'strftime') else str(desde)[:10]
    ate_str   = ate.strftime('%Y-%m-%d')   if hasattr(ate, 'strftime') else str(ate)[:10]

    log.info(f"Buscando vendas PDVNet: {desde_str} -> {ate_str}")

    todas  = []
    pagina = 1

    while True:
        resp = api_get(url, headers_auth(token), params={
            'inicio': desde_str, 'fim': ate_str,
            'pagina': pagina, 'tamanhoPagina': PAGE_SIZE,
        })
        data      = resp.json()
        registros = data.get('Registros', [])
        paginacao = data.get('PaginacaoInfo', {})

        if pagina == 1:
            total = paginacao.get('TotalRegistros', '?')
            log.info(f"Total disponivel: {total} vendas")

        if not registros:
            break

        todas.extend(registros)
        log.info(f"Pagina {pagina}: {len(registros)} vendas (acumulado: {len(todas)})")

        if not paginacao.get('TemProximaPagina', False):
            break
        pagina += 1

    log.info(f"Total carregado: {len(todas)} vendas")
    return todas

# ============================================================
# DEDUPLICACAO DE CLIENTES
# ============================================================

def normalizar_cpf(val):
    if not val:
        return None
    d = ''.join(c for c in str(val) if c.isdigit())
    return d if len(d) == 11 else None


def normalizar_tel(ddd, tel):
    dd = ''.join(c for c in str(ddd or '') if c.isdigit())
    tt = ''.join(c for c in str(tel or '') if c.isdigit())
    if not tt:
        return None
    return (dd + tt) if dd else tt


def buscar_cliente_api(token, cliente_id):
    """GET /clientes/{id} com timeout reduzido."""
    url = f"{PDVNET_BASE_URL}/api/public/clientes/{cliente_id}"
    try:
        resp = api_get(url, headers_auth(token), timeout=8)
        d = resp.json()
        return d if isinstance(d, dict) and d.get('Id') else None
    except Exception:
        return None


def encontrar_ou_criar_cliente(conn, dados, cache_cli):
    """CPF -> Email -> Telefone -> Cria. Usa cache_cli para evitar chamadas repetidas."""
    cur = conn.cursor()

    cpf   = normalizar_cpf(dados.get('CPFCNPJ'))
    email = (dados.get('Email') or '').lower().strip() or None
    ddd   = dados.get('DDD', '')
    tel   = normalizar_tel(ddd, dados.get('Celular') or dados.get('Telefone'))
    cid   = None

    if cpf:
        cur.execute("SELECT id FROM customers WHERE cpf_encrypted=%s LIMIT 1", (cpf,))
        r = cur.fetchone()
        if r: cid = r[0]

    if not cid and email:
        cur.execute("""
            SELECT c.id FROM customers c
            JOIN customer_emails ce ON ce.customer_id=c.id
            WHERE ce.email=%s LIMIT 1
        """, (email,))
        r = cur.fetchone()
        if not r:
            cur.execute("SELECT id FROM customers WHERE email=%s LIMIT 1", (email,))
            r = cur.fetchone()
        if r: cid = r[0]

    if not cid and tel:
        cur.execute("""
            SELECT c.id FROM customers c
            JOIN customer_phones cp ON cp.customer_id=c.id
            WHERE cp.phone=%s LIMIT 1
        """, (tel,))
        r = cur.fetchone()
        if not r:
            cur.execute("SELECT id FROM customers WHERE phone=%s LIMIT 1", (tel,))
            r = cur.fetchone()
        if r: cid = r[0]

    foi_criado = False
    if not cid:
        nome = (dados.get('Nome') or 'Cliente PDVNet').strip()[:500]
        cur.execute("""
            INSERT INTO customers
                (full_name, source_channel, cpf_encrypted, created_at, updated_at, total_spent, purchase_count)
            VALUES (%s,'pdvnet',%s,NOW(),NOW(),0,0) RETURNING id
        """, (nome, cpf))
        cid = cur.fetchone()[0]
        foi_criado = True

        # Adiciona contatos
        if email:
            cur.execute("""
                INSERT INTO customer_emails(customer_id,email,type,created_at)
                SELECT %s,%s,'pessoal',NOW()
                WHERE NOT EXISTS(SELECT 1 FROM customer_emails WHERE customer_id=%s AND email=%s)
            """, (cid,email,cid,email))
        for t, tp in [(tel,'celular')]:
            if t:
                cur.execute("""
                    INSERT INTO customer_phones(customer_id,phone,type,created_at)
                    SELECT %s,%s,%s,NOW()
                    WHERE NOT EXISTS(SELECT 1 FROM customer_phones WHERE customer_id=%s AND phone=%s)
                """, (cid,t,tp,cid,t))

    conn.commit()
    cur.close()
    return cid, foi_criado

# ============================================================
# CACHE DE PRODUTOS
# ============================================================

_cache_variacoes = {}

def buscar_nome_produto(token, variacao_id):
    if not variacao_id:
        return 'Produto PDVNet'
    if variacao_id in _cache_variacoes:
        return _cache_variacoes[variacao_id]
    try:
        r = api_get(f"{PDVNET_BASE_URL}/api/public/variacoes/{variacao_id}",
                    headers_auth(token), timeout=8)
        var = r.json()
        produto_id = var.get('ProdutoId','')
        cor     = (var.get('Cor') or '').strip()
        tamanho = (var.get('Tamanho') or '').strip()

        nome = f"Produto #{produto_id}"
        if produto_id:
            try:
                r2 = api_get(f"{PDVNET_BASE_URL}/api/public/produtos/1/{produto_id}",
                             headers_auth(token), timeout=8)
                nome = r2.json().get('Nome', nome)
            except Exception:
                pass

        partes = [p for p in [nome, cor, tamanho] if p]
        resultado = ' - '.join(partes)
        _cache_variacoes[variacao_id] = resultado
        return resultado
    except Exception:
        _cache_variacoes[variacao_id] = f"Produto #{variacao_id}"
        return _cache_variacoes[variacao_id]

# ============================================================
# INSERIR VENDA
# ============================================================

def venda_ja_existe(conn, external_id):
    cur = conn.cursor()
    cur.execute("SELECT 1 FROM purchases WHERE external_id=%s LIMIT 1", (str(external_id),))
    existe = cur.fetchone() is not None
    cur.close()
    return existe


def inserir_venda(conn, customer_id, venda, token):
    cur = conn.cursor()

    venda_id   = str(venda.get('Id','')).strip()
    data_raw   = venda.get('DataHora')
    try:
        data_venda = datetime.fromisoformat(str(data_raw)) if data_raw else datetime.now()
    except Exception:
        data_venda = datetime.now()

    total  = float(venda.get('ValorTotal', 0))
    status = 'cancelled' if venda.get('Inativa') else 'completed'
    itens  = venda.get('Itens') or []

    cur.execute("""
        INSERT INTO purchases
            (customer_id, purchase_date, total_amount, status,
             source_channel, external_id, imported_from, created_at)
        VALUES (%s,%s,%s,%s,'pdvnet',%s,'pdvnet_api',NOW())
        RETURNING id
    """, (customer_id, data_venda, total, status, venda_id))
    purchase_id = cur.fetchone()[0]

    for item in itens:
        var_id = str(item.get('VariacaoId','')).strip()
        nome   = buscar_nome_produto(token, var_id) if var_id else 'Produto PDVNet'
        qtd    = float(item.get('Quantidade', 1))
        preco  = float(item.get('Preco', 0))
        desc   = float(item.get('ValorDesconto', 0))
        cur.execute("""
            INSERT INTO purchase_items
                (purchase_id, product_name, product_sku, quantity,
                 unit_price, total_price, discount, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,NOW())
        """, (purchase_id, nome[:500], var_id, qtd, preco, qtd*preco, desc))

    cur.execute("""
        UPDATE customers SET
            purchase_count     = purchase_count + 1,
            total_spent        = total_spent + %s,
            last_purchase_date = GREATEST(COALESCE(last_purchase_date,%s),%s),
            first_purchase_date= LEAST(COALESCE(first_purchase_date,%s),%s),
            updated_at         = NOW()
        WHERE id=%s
    """, (total, data_venda, data_venda, data_venda, data_venda, customer_id))

    conn.commit()
    cur.close()
    return purchase_id

# ============================================================
# SYNC PRINCIPAL
# ============================================================

def executar_sync(conn, token, desde, ate, dry_run=False):
    """
    Executa a sincronização completa para o período.
    Retorna (stats, max_data_venda, sucesso).
    """
    stats = {
        'vendas_encontradas': 0,
        'vendas_novas': 0,
        'vendas_duplicadas': 0,
        'vendas_site_ignoradas': 0,
        'clientes_novos': 0,
        'erros': 0,
    }

    vendas = buscar_vendas(token, desde, ate)
    stats['vendas_encontradas'] = len(vendas)

    if not vendas:
        log.info("Nenhuma venda nova no periodo.")
        return stats, desde, True

    if dry_run:
        log.info(f"[DRY-RUN] {len(vendas)} vendas seriam processadas.")
        stats['vendas_novas'] = len(vendas)
        return stats, ate, True

    cache_cli    = {}
    max_data     = desde
    erros_fatais = 0

    for i, venda in enumerate(vendas, 1):
        external_id = str(venda.get('Id', '')).strip()
        if not external_id:
            continue

        try:
            # -------------------------------------------------------
            # FILTRO DE DEDUPLICACAO: ignora vendas do site (wBuy/Wix)
            # Loja 8 = e-commerce. Ver PDVNET_DEDUPLICATION_ANALYSIS.md
            # -------------------------------------------------------
            if venda.get('LojaId') == 8 or venda.get('TipoVenda') == 7:
                stats['vendas_site_ignoradas'] += 1
                continue

            if venda_ja_existe(conn, external_id):
                stats['vendas_duplicadas'] += 1
                continue

            # Resolve cliente
            pdv_cli_id = str(venda.get('ClienteId', '')).strip()
            crm_id     = cache_cli.get(pdv_cli_id)

            if not crm_id:
                cpf = normalizar_cpf(venda.get('ClienteCPF',''))
                if cpf:
                    cur = conn.cursor()
                    cur.execute("SELECT id FROM customers WHERE cpf_encrypted=%s LIMIT 1",(cpf,))
                    r = cur.fetchone()
                    cur.close()
                    if r: crm_id = r[0]

            if not crm_id and pdv_cli_id and pdv_cli_id != '0':
                dados_cli = buscar_cliente_api(token, pdv_cli_id)
                if dados_cli:
                    crm_id, foi_criado = encontrar_ou_criar_cliente(conn, dados_cli, cache_cli)
                    if foi_criado:
                        stats['clientes_novos'] += 1

            if not crm_id:
                nome = venda.get('ClienteNome') or f"Cliente PDVNet #{pdv_cli_id}"
                cur = conn.cursor()
                cur.execute("""
                    INSERT INTO customers
                        (full_name,source_channel,created_at,updated_at,total_spent,purchase_count)
                    VALUES (%s,'pdvnet',NOW(),NOW(),0,0) RETURNING id
                """, (nome[:500],))
                crm_id = cur.fetchone()[0]
                conn.commit()
                cur.close()
                stats['clientes_novos'] += 1

            if pdv_cli_id and crm_id:
                cache_cli[pdv_cli_id] = crm_id

            inserir_venda(conn, crm_id, venda, token)
            stats['vendas_novas'] += 1

            # Atualiza max data desta venda
            data_raw = venda.get('DataHora')
            if data_raw:
                try:
                    dv = datetime.fromisoformat(str(data_raw))
                    if dv.tzinfo is None:
                        dv = dv.replace(tzinfo=timezone.utc)
                    if max_data is None or dv > max_data:
                        max_data = dv
                except Exception:
                    pass

            if i % 50 == 0:
                log.info(f"  Progresso: {i}/{len(vendas)} | novas={stats['vendas_novas']} erros={stats['erros']}")

        except Exception as e:
            stats['erros'] += 1
            erros_fatais += 1
            log.error(f"Erro na venda {external_id}: {e}")
            conn.rollback()
            if erros_fatais >= 10:
                raise Exception(f"Muitos erros fatais ({erros_fatais}). Abortando sync.")

    sucesso = stats['erros'] == 0
    return stats, max_data, sucesso

# ============================================================
# MOSTRAR LOGS
# ============================================================

def mostrar_logs(conn, n=10):
    cur = conn.cursor()
    cur.execute(f"""
        SELECT id, started_at::timestamptz AT TIME ZONE 'America/Sao_Paulo',
               status, vendas_importadas, erros_count,
               execution_time_seconds, error_message
        FROM pdvnet_sync_log
        ORDER BY started_at DESC
        LIMIT {n}
    """)
    print(f"\n{'ID':<6} {'Data/Hora':<22} {'Status':<10} {'Importadas':<12} {'Erros':<8} {'Tempo(s)':<10} Mensagem")
    print("-" * 90)
    for r in cur.fetchall():
        msg = (r[6] or '')[:40]
        print(f"{r[0]:<6} {str(r[1])[:19]:<22} {r[2]:<10} {r[3] or 0:<12} {r[4] or 0:<8} {r[5] or 0:<10.1f} {msg}")
    cur.close()

# ============================================================
# MAIN
# ============================================================

def main():
    parser = argparse.ArgumentParser(description='Sync diario PDVNet -> Wasabi CRM')
    parser.add_argument('--dry-run',       action='store_true', help='Simula sem inserir')
    parser.add_argument('--force-desde',   help='Forca data inicio (YYYY-MM-DD)')
    parser.add_argument('--show-logs',     action='store_true', help='Mostra ultimos logs')
    args = parser.parse_args()

    log.info("=" * 60)
    log.info("PDVNet Sync Diario | Wasabi CRM")
    log.info("=" * 60)

    conn = psycopg2.connect(**DB_CONFIG)

    if args.show_logs:
        mostrar_logs(conn)
        conn.close()
        return

    # Obtem ultimo sync
    control_id, last_sync_at = obter_ultimo_sync(conn)

    if args.force_desde:
        desde = datetime.fromisoformat(args.force_desde).replace(tzinfo=timezone.utc)
        log.info(f"[FORCADO] Inicio: {desde.date()}")
    else:
        desde = last_sync_at
        log.info(f"Ultimo sync bem-sucedido: {desde}")

    ate = datetime.now(timezone.utc)
    log.info(f"Periodo: {desde} -> {ate}")

    if args.dry_run:
        log.info("[DRY-RUN] Nenhuma alteracao sera feita no banco.")

    # Autentica PDVNet
    token = autenticar()
    log.info("Autenticado no PDVNet")

    # Cria registro de log
    log_id = criar_log_inicio(conn, desde, ate)

    # Executa sync
    sucesso   = False
    stats     = {}
    max_data  = desde
    error_msg = None

    try:
        stats, max_data, sucesso = executar_sync(conn, token, desde, ate, dry_run=args.dry_run)

    except Exception as e:
        error_msg = traceback.format_exc()
        log.error(f"ERRO FATAL no sync: {e}")
        log.error(error_msg)
        sucesso = False
        stats.setdefault('erros', 1)

    # Determina status final
    if sucesso and stats.get('erros', 0) == 0:
        status_final = 'success'
    elif stats.get('vendas_novas', 0) > 0 and stats.get('erros', 0) > 0:
        status_final = 'partial'
    else:
        status_final = 'error'

    # Atualiza log
    atualizar_log(
        conn, log_id, status_final, stats,
        error_msg=error_msg,
        new_timestamp=max_data if sucesso else None
    )

    # *** REGRA CRITICA: so atualiza timestamp em caso de sucesso total ***
    if sucesso and not args.dry_run and stats.get('erros', 0) == 0:
        salvar_timestamp_sucesso(conn, control_id, max_data)
    else:
        log.warning("Timestamp de controle NAO atualizado (sync nao foi 100% bem-sucedido).")
        log.warning("Proximo sync usara o timestamp anterior para nao perder vendas.")

    # Relatorio final
    log.info("")
    log.info("=" * 60)
    log.info("RELATORIO FINAL")
    log.info("=" * 60)
    log.info(f"  Status:             {status_final.upper()}")
    log.info(f"  Vendas encontradas: {stats.get('vendas_encontradas', 0)}")
    log.info(f"  Vendas importadas:  {stats.get('vendas_novas', 0)}")
    log.info(f"  Ja existiam:        {stats.get('vendas_duplicadas', 0)}")
    log.info(f"  Site ignoradas:     {stats.get('vendas_site_ignoradas', 0)}  (Loja 8 / wBuy)")
    log.info(f"  Clientes novos:     {stats.get('clientes_novos', 0)}")
    log.info(f"  Erros:              {stats.get('erros', 0)}")
    log.info(f"  Timestamp usado:    {desde}")
    log.info(f"  Novo timestamp:     {max_data if sucesso else 'NAO ATUALIZADO'}")
    log.info("=" * 60)

    conn.close()
    sys.exit(0 if status_final == 'success' else 1)


if __name__ == '__main__':
    main()
