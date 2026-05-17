#!/usr/bin/env python3
"""
SKILL: Integração PDVNet -> Wasabi CRM Database
Fase 3: Loja Física

Busca vendas e clientes da loja física via PDVNet API REST
e insere/atualiza na base de dados central unificada.

API: http://wasabi.pdvnet.com.br/pdvapi
Auth: POST /api/public/login  ->  {"Token": "..."}
Docs: http://wasabi.pdvnet.com.br/pdvapi/help

Uso:
    python skill_integrate_pdvnet.py                     # Incremental desde último sync
    python skill_integrate_pdvnet.py --desde 2024-01-01  # Desde data específica
    python skill_integrate_pdvnet.py --full              # Tudo desde 2024-01-01
    python skill_integrate_pdvnet.py --dry-run           # Ver sem inserir
"""

import os
import sys
import requests
import psycopg2
import argparse
from datetime import datetime, date
from dotenv import load_dotenv

# ============================================================
# CONFIGURAÇÃO
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

PAGE_SIZE = 50  # Limite real da API PDVNet (>50 retorna HTTP 500)

# ============================================================
# AUTENTICAÇÃO
# ============================================================

def autenticar():
    """
    POST /api/public/login
    Body: {"Usuario": "...", "Senha": "..."}
    Resposta: {"Token": "JWT_TOKEN_AQUI"}
    """
    url = f"{PDVNET_BASE_URL}/api/public/login"
    resp = requests.post(url, json={"Usuario": PDVNET_USUARIO, "Senha": PDVNET_SENHA}, timeout=30)
    resp.raise_for_status()

    data = resp.json()
    token = data.get('Token')
    if not token:
        raise Exception(f"Login PDVNet falhou: {data}")

    print("[OK] Autenticado no PDVNet")
    return token


def headers_auth(token):
    return {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json',
    }

# ============================================================
# BUSCA DE DADOS PDVNet
# ============================================================

def buscar_vendas(token, inicio, fim):
    """
    GET /api/public/vendas?inicio=&fim=&pagina=&tamanhoPagina=
    Resposta: {"Registros": [...], "PaginacaoInfo": {"TemProximaPagina": bool, "TotalRegistros": N}}
    """
    url = f"{PDVNET_BASE_URL}/api/public/vendas"
    inicio_str = inicio.strftime('%Y-%m-%d') if hasattr(inicio, 'strftime') else str(inicio)
    fim_str    = fim.strftime('%Y-%m-%d')    if hasattr(fim, 'strftime') else str(fim)

    print(f"[API] Buscando vendas PDVNet: {inicio_str} -> {fim_str}")

    todas = []
    pagina = 1

    while True:
        params = {
            'inicio': inicio_str,
            'fim':    fim_str,
            'pagina': pagina,
            'tamanhoPagina': PAGE_SIZE,
        }
        resp = requests.get(url, headers=headers_auth(token), params=params, timeout=60)
        resp.raise_for_status()
        data = resp.json()

        registros = data.get('Registros', [])
        paginacao = data.get('PaginacaoInfo', {})

        if not registros:
            break

        todas.extend(registros)

        total_registros = paginacao.get('TotalRegistros', '?')
        if pagina == 1:
            print(f"   Total disponível: {total_registros} vendas")

        print(f"   Página {pagina}/{paginacao.get('TotalPaginas','?')}: {len(registros)} vendas (acumulado: {len(todas)})")

        if not paginacao.get('TemProximaPagina', False):
            break

        pagina += 1

    print(f"   [OK] {len(todas)} vendas carregadas")
    return todas


def buscar_cliente_pdvnet(token, cliente_id):
    """GET /api/public/clientes/{id} -> dados completos ou None."""
    url = f"{PDVNET_BASE_URL}/api/public/clientes/{cliente_id}"
    resp = requests.get(url, headers=headers_auth(token), timeout=30)
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    data = resp.json()
    return data if isinstance(data, dict) and data.get('Id') else None


# Cache de produtos para não repetir chamadas à API
_cache_variacoes = {}  # variacao_id -> {"nome": "...", "cor": "...", "tamanho": "..."}


def buscar_nome_produto(token, variacao_id):
    """
    Busca nome do produto via variacao -> produto.
    Usa cache para não repetir chamadas para o mesmo produto.
    Retorna string no formato "NOME DO PRODUTO - COR TAM"
    """
    if variacao_id in _cache_variacoes:
        return _cache_variacoes[variacao_id]

    try:
        url_var = f"{PDVNET_BASE_URL}/api/public/variacoes/{variacao_id}"
        r = requests.get(url_var, headers=headers_auth(token), timeout=15)
        if r.status_code != 200:
            _cache_variacoes[variacao_id] = f"Produto #{variacao_id}"
            return _cache_variacoes[variacao_id]

        var = r.json()
        produto_id = var.get('ProdutoId', '')
        cor     = (var.get('Cor') or '').strip()
        tamanho = (var.get('Tamanho') or '').strip()

        nome_produto = f"Produto #{produto_id}"
        if produto_id:
            url_prod = f"{PDVNET_BASE_URL}/api/public/produtos/1/{produto_id}"
            r2 = requests.get(url_prod, headers=headers_auth(token), timeout=15)
            if r2.status_code == 200:
                prod = r2.json()
                nome_produto = prod.get('Nome', f"Produto #{produto_id}")

        # Monta nome completo: "MACACÃO DEL VIVO - VERMELHO P"
        partes = [nome_produto]
        if cor:
            partes.append(cor)
        if tamanho:
            partes.append(tamanho)

        resultado = ' - '.join(partes) if len(partes) > 1 else nome_produto
        _cache_variacoes[variacao_id] = resultado
        return resultado

    except Exception:
        _cache_variacoes[variacao_id] = f"Produto #{variacao_id}"
        return _cache_variacoes[variacao_id]

# ============================================================
# NORMALIZAÇÃO
# ============================================================

def normalizar_telefone(ddd, tel):
    """Combina DDD + número e retorna só dígitos."""
    ddd_digits = ''.join(c for c in str(ddd or '') if c.isdigit())
    tel_digits  = ''.join(c for c in str(tel or '') if c.isdigit())
    if not tel_digits:
        return None
    completo = ddd_digits + tel_digits if ddd_digits else tel_digits
    return completo if completo else None


def normalizar_cpf(cpf_cnpj):
    """Retorna CPF com 11 dígitos ou None. Ignora CNPJ (14 dígitos)."""
    if not cpf_cnpj:
        return None
    digitos = ''.join(c for c in str(cpf_cnpj) if c.isdigit())
    return digitos if len(digitos) == 11 else None

# ============================================================
# BANCO DE DADOS — DEDUPLICAÇÃO
# ============================================================

def encontrar_ou_criar_cliente(conn, dados_pdvnet):
    """
    CPF -> Email -> Telefone -> Cria novo.
    Retorna (customer_id, foi_criado).
    """
    cur = conn.cursor()
    customer_id = None

    cpf   = normalizar_cpf(dados_pdvnet.get('CPFCNPJ'))
    email = (dados_pdvnet.get('Email') or '').lower().strip() or None
    ddd   = dados_pdvnet.get('DDD', '')
    tel   = normalizar_telefone(ddd, dados_pdvnet.get('Celular') or dados_pdvnet.get('Telefone'))

    # 1º — CPF
    if cpf:
        cur.execute("SELECT id FROM customers WHERE cpf_encrypted = %s LIMIT 1", (cpf,))
        row = cur.fetchone()
        if row:
            customer_id = row[0]

    # 2º — Email
    if not customer_id and email:
        cur.execute("""
            SELECT c.id FROM customers c
            JOIN customer_emails ce ON ce.customer_id = c.id
            WHERE ce.email = %s LIMIT 1
        """, (email,))
        row = cur.fetchone()
        if row:
            customer_id = row[0]
        if not customer_id:
            cur.execute("SELECT id FROM customers WHERE email = %s LIMIT 1", (email,))
            row = cur.fetchone()
            if row:
                customer_id = row[0]

    # 3º — Telefone
    if not customer_id and tel:
        cur.execute("""
            SELECT c.id FROM customers c
            JOIN customer_phones cp ON cp.customer_id = c.id
            WHERE cp.phone = %s LIMIT 1
        """, (tel,))
        row = cur.fetchone()
        if row:
            customer_id = row[0]
        if not customer_id:
            cur.execute("SELECT id FROM customers WHERE phone = %s LIMIT 1", (tel,))
            row = cur.fetchone()
            if row:
                customer_id = row[0]

    foi_criado = False

    # 4º — Criar novo
    if not customer_id:
        nome = (dados_pdvnet.get('Nome') or 'Cliente PDVNet').strip()[:500]
        cur.execute("""
            INSERT INTO customers
                (full_name, source_channel, cpf_encrypted, created_at, updated_at, total_spent, purchase_count)
            VALUES (%s, 'pdvnet', %s, NOW(), NOW(), 0, 0)
            RETURNING id
        """, (nome, cpf))
        customer_id = cur.fetchone()[0]
        foi_criado = True

    cur.close()
    return customer_id, foi_criado


def atualizar_contatos(conn, customer_id, dados_pdvnet):
    """Adiciona email/telefones/endereço sem sobrescrever existentes."""
    cur = conn.cursor()

    email = (dados_pdvnet.get('Email') or '').lower().strip() or None
    if email:
        cur.execute("""
            INSERT INTO customer_emails (customer_id, email, type, created_at)
            SELECT %s, %s, 'pessoal', NOW()
            WHERE NOT EXISTS (
                SELECT 1 FROM customer_emails WHERE customer_id = %s AND email = %s
            )
        """, (customer_id, email, customer_id, email))

    ddd = dados_pdvnet.get('DDD', '')
    telefones = [
        (normalizar_telefone(ddd, dados_pdvnet.get('Celular')),          'celular'),
        (normalizar_telefone(ddd, dados_pdvnet.get('Telefone')),          'fixo'),
        (normalizar_telefone(ddd, dados_pdvnet.get('TelefoneComercial')), 'comercial'),
    ]
    for tel, tipo in telefones:
        if tel:
            cur.execute("""
                INSERT INTO customer_phones (customer_id, phone, type, created_at)
                SELECT %s, %s, %s, NOW()
                WHERE NOT EXISTS (
                    SELECT 1 FROM customer_phones WHERE customer_id = %s AND phone = %s
                )
            """, (customer_id, tel, tipo, customer_id, tel))

    enderecos = dados_pdvnet.get('Enderecos') or []
    if enderecos:
        e = enderecos[0]
        rua = (e.get('Rua') or '').strip()
        cep = (e.get('CEP') or '').strip()
        if rua:
            cur.execute("""
                INSERT INTO customer_addresses
                    (customer_id, street, number, complement, city, state, zipcode, country, type, created_at)
                SELECT %s, %s, %s, %s, %s, %s, %s, 'Brasil', 'residencial', NOW()
                WHERE NOT EXISTS (
                    SELECT 1 FROM customer_addresses
                    WHERE customer_id = %s AND street = %s AND zipcode = %s
                )
            """, (
                customer_id,
                rua[:500], (e.get('Numero') or '')[:20], (e.get('Complemento') or '')[:200],
                (e.get('Cidade') or '')[:150], (e.get('UF') or '')[:2], cep[:20],
                customer_id, rua[:500], cep[:20]
            ))

    conn.commit()
    cur.close()

# ============================================================
# BANCO DE DADOS — VENDAS
# ============================================================

def venda_ja_existe(conn, external_id):
    cur = conn.cursor()
    cur.execute("SELECT 1 FROM purchases WHERE external_id = %s LIMIT 1", (str(external_id).strip(),))
    existe = cur.fetchone() is not None
    cur.close()
    return existe


def inserir_venda(conn, customer_id, venda, token):
    """
    Insere venda PDVNet + itens no banco.
    Campos reais da API:
      Id, DataHora, ValorTotal, Inativa
      Itens[]: VariacaoId, Preco, Quantidade, ValorDesconto
    """
    cur = conn.cursor()

    venda_id = str(venda.get('Id', '')).strip()

    # Data
    data_raw = venda.get('DataHora')
    try:
        data_venda = datetime.fromisoformat(str(data_raw)) if data_raw else datetime.now()
    except Exception:
        data_venda = datetime.now()

    total   = float(venda.get('ValorTotal', 0))
    inativa = venda.get('Inativa', False)
    status  = 'cancelled' if inativa else 'completed'
    itens   = venda.get('Itens') or []

    cur.execute("""
        INSERT INTO purchases
            (customer_id, purchase_date, total_amount, status,
             source_channel, external_id, imported_from, created_at)
        VALUES (%s, %s, %s, %s, 'pdvnet', %s, 'pdvnet_api', NOW())
        RETURNING id
    """, (customer_id, data_venda, total, status, venda_id))

    purchase_id = cur.fetchone()[0]

    for item in itens:
        variacao_id = str(item.get('VariacaoId', '')).strip()

        # Busca nome do produto via cache/API
        nome = buscar_nome_produto(token, variacao_id) if variacao_id else 'Produto PDVNet'

        # Tamanho/Cor já estão no cache da variacao
        info_var = _cache_variacoes.get(variacao_id, {})
        if isinstance(info_var, dict):
            tamanho = info_var.get('tamanho')
        else:
            tamanho = None  # nome já inclui tamanho no formato "PRODUTO - COR TAM"

        qtd        = float(item.get('Quantidade', 1))
        preco_unit = float(item.get('Preco', 0))
        preco_tot  = qtd * preco_unit
        desconto   = float(item.get('ValorDesconto', 0))

        cur.execute("""
            INSERT INTO purchase_items
                (purchase_id, product_name, product_sku, product_size,
                 quantity, unit_price, total_price, discount, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())
        """, (purchase_id, nome[:500], variacao_id, tamanho, qtd, preco_unit, preco_tot, desconto))

    # Atualiza totais do cliente
    cur.execute("""
        UPDATE customers SET
            purchase_count      = purchase_count + 1,
            total_spent         = total_spent + %s,
            last_purchase_date  = GREATEST(COALESCE(last_purchase_date, %s), %s),
            first_purchase_date = LEAST(COALESCE(first_purchase_date, %s), %s),
            updated_at          = NOW()
        WHERE id = %s
    """, (total, data_venda, data_venda, data_venda, data_venda, customer_id))

    conn.commit()
    cur.close()
    return purchase_id


def get_ultimo_sync(conn):
    """Data da última venda PDVNet importada (para sync incremental)."""
    cur = conn.cursor()
    cur.execute("""
        SELECT MAX(purchase_date)::date FROM purchases
        WHERE source_channel = 'pdvnet'
    """)
    row = cur.fetchone()
    cur.close()
    return row[0] if (row and row[0]) else date(2024, 1, 1)

# ============================================================
# EXECUÇÃO PRINCIPAL
# ============================================================

def main():
    parser = argparse.ArgumentParser(description='Importa vendas PDVNet -> Wasabi CRM')
    parser.add_argument('--desde',   help='Data início YYYY-MM-DD')
    parser.add_argument('--ate',     help='Data fim YYYY-MM-DD (padrão: hoje)')
    parser.add_argument('--full',    action='store_true', help='Reimportar desde 2024-01-01')
    parser.add_argument('--dry-run', action='store_true', dest='dry_run',
                        help='Mostra o que seria importado sem inserir')
    args = parser.parse_args()

    print("=" * 60)
    print("[LOJA]  PDVNet -> Wasabi CRM  |  Integração Loja Física")
    print("=" * 60)

    print("\n[DB] Conectando ao banco de dados...")
    conn = psycopg2.connect(**DB_CONFIG)
    print("[OK] Banco conectado\n")

    # Período
    if args.full:
        inicio = date(2024, 1, 1)
        print("[SYNC] Modo FULL — importando desde 2024-01-01")
    elif args.desde:
        inicio = date.fromisoformat(args.desde)
    else:
        inicio = get_ultimo_sync(conn)
        print(f"[DATA] Último sync PDVNet detectado: {inicio}")

    fim = date.fromisoformat(args.ate) if args.ate else date.today()
    print(f"[DATA] Período: {inicio}  ->  {fim}\n")

    # Autentica
    token = autenticar()

    # Busca vendas
    vendas = buscar_vendas(token, inicio, fim)

    if not vendas:
        print("\n[OK] Nenhuma venda nova no período.")
        conn.close()
        return

    if args.dry_run:
        print(f"\n[DRY-RUN] {len(vendas)} vendas seriam processadas.")
        conn.close()
        return

    # Processa
    print(f"\n[PROC]  Processando {len(vendas)} vendas...\n")

    stats = {
        'vendas_novas': 0,
        'vendas_duplicadas': 0,
        'vendas_site_ignoradas': 0,  # Loja 8 / TipoVenda=7 (wBuy/Wix — já na base)
        'clientes_novos': 0,
        'clientes_existentes': 0,
        'erros': 0,
    }

    cache_clientes = {}  # pdvnet_id -> crm_customer_id

    for i, venda in enumerate(vendas, 1):
        external_id = str(venda.get('Id', '')).strip()
        if not external_id:
            continue

        try:
            # -------------------------------------------------------
            # FILTRO DE DEDUPLICACAO: ignora vendas do site (wBuy/Wix)
            #
            # O PDVNet registra TANTO vendas físicas QUANTO vendas do
            # site. A Loja 8 é exclusivamente o e-commerce (100% das
            # suas vendas têm TipoSistemaOrigem=1 e TipoVenda=7).
            # Essas vendas já foram importadas via wBuy na Fase 2.
            #
            # Evidência e análise completa: PDVNET_DEDUPLICATION_ANALYSIS.md
            # -------------------------------------------------------
            if venda.get('LojaId') == 8 or venda.get('TipoVenda') == 7:
                stats['vendas_site_ignoradas'] = stats.get('vendas_site_ignoradas', 0) + 1
                continue

            if venda_ja_existe(conn, external_id):
                stats['vendas_duplicadas'] += 1
                continue

            pdvnet_cliente_id = str(venda.get('ClienteId', '')).strip()
            cpf_venda = normalizar_cpf(venda.get('ClienteCPF', ''))

            # Tenta deduplicar só pelo CPF da venda (sem chamada extra à API)
            crm_id = None
            if cpf_venda:
                cur = conn.cursor()
                cur.execute("SELECT id FROM customers WHERE cpf_encrypted = %s LIMIT 1", (cpf_venda,))
                row = cur.fetchone()
                cur.close()
                if row:
                    crm_id = row[0]
                    foi_criado = False
                    cache_clientes[pdvnet_cliente_id] = crm_id

            # Se não achou pelo CPF da venda, busca/cria via dados completos do cliente
            if not crm_id:
                if pdvnet_cliente_id and pdvnet_cliente_id not in ('', '0'):
                    if pdvnet_cliente_id in cache_clientes:
                        crm_id = cache_clientes[pdvnet_cliente_id]
                        foi_criado = False
                    else:
                        dados_cli = buscar_cliente_pdvnet(token, pdvnet_cliente_id)
                        if dados_cli:
                            crm_id, foi_criado = encontrar_ou_criar_cliente(conn, dados_cli)
                            atualizar_contatos(conn, crm_id, dados_cli)
                        else:
                            crm_id, foi_criado = encontrar_ou_criar_cliente(
                                conn, {'Nome': f'Cliente PDVNet #{pdvnet_cliente_id}', 'CPFCNPJ': cpf_venda or ''}
                            )
                        cache_clientes[pdvnet_cliente_id] = crm_id
                else:
                    crm_id, foi_criado = encontrar_ou_criar_cliente(
                        conn, {'Nome': 'Cliente Anônimo PDVNet', 'CPFCNPJ': cpf_venda or ''}
                    )

            if foi_criado:
                stats['clientes_novos'] += 1
            else:
                stats['clientes_existentes'] += 1

            inserir_venda(conn, crm_id, venda, token)
            stats['vendas_novas'] += 1

            if i % 100 == 0:
                print(f"   [{i}/{len(vendas)}] processadas | novos clientes: {stats['clientes_novos']} | erros: {stats['erros']}")

        except Exception as e:
            stats['erros'] += 1
            print(f"   [AVISO]  Erro na venda {external_id}: {e}")
            conn.rollback()

    # Relatório
    print("\n" + "=" * 60)
    print("[STATS]  RELATÓRIO FINAL")
    print("=" * 60)
    print(f"  [OK]   Vendas fisicas importadas:     {stats['vendas_novas']}")
    print(f"  [SKIP] Vendas site ignoradas (wBuy):  {stats['vendas_site_ignoradas']}  <- Loja 8 / TipoVenda=7")
    print(f"  [SKIP] Vendas ja existentes:          {stats['vendas_duplicadas']}")
    print(f"  [CLI]  Clientes novos criados:        {stats['clientes_novos']}")
    print(f"  [LINK] Clientes existentes usados:    {stats['clientes_existentes']}")
    print(f"  [ERRO] Erros:                         {stats['erros']}")
    print("=" * 60)

    conn.close()
    print("\n[OK] Integração PDVNet concluída!\n")


if __name__ == '__main__':
    main()
