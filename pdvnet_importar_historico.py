#!/usr/bin/env python3
"""
Importacao historica PDVNet - processo unico, cache persistente.

Otimizacoes vs rodar skill_integrate_pdvnet.py mes a mes:
  - Login UMA vez (nao a cada mes)
  - Cache de produtos persistente entre TODOS os meses
  - Cache de clientes persistente entre TODOS os meses (maior ganho)
  - Timeout reduzido nos lookups de cliente (8s vs 30s)
  - Progresso impresso a cada 25 vendas

Uso:
    python -u pdvnet_importar_historico.py                    # 2021-05 ate hoje
    python -u pdvnet_importar_historico.py --desde 2021-05
    python -u pdvnet_importar_historico.py --desde 2021-05 --ate 2021-12
"""

import sys
import time
import calendar
import argparse
import requests

# Preserva sys.argv antes de importar o modulo principal
_argv_original = sys.argv[:]
sys.argv = ['skill_integrate_pdvnet']
import skill_integrate_pdvnet as pdv
sys.argv = _argv_original

import psycopg2
from datetime import date

# Cache de clientes PDVNet -> CRM, compartilhado entre TODOS os meses
# Chave: pdvnet_cliente_id (string)
# Valor: crm customer_id (int)
_cache_clientes = {}


def buscar_cliente_rapido(token, cliente_id):
    """GET /api/public/clientes/{id} com timeout reduzido (8s)."""
    url = f"{pdv.PDVNET_BASE_URL}/api/public/clientes/{cliente_id}"
    try:
        resp = requests.get(url, headers=pdv.headers_auth(token), timeout=8)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        data = resp.json()
        return data if isinstance(data, dict) and data.get('Id') else None
    except Exception:
        return None


def importar_mes(conn, token, ano, mes):
    """Importa um mes completo. Usa _cache_clientes e _cache_variacoes globais."""
    global _cache_clientes

    ultimo_dia = calendar.monthrange(ano, mes)[1]
    desde = date(ano, mes, 1)
    ate   = date(ano, mes, ultimo_dia)

    vendas = pdv.buscar_vendas(token, desde, ate)

    stats = {
        'vendas_novas': 0,
        'vendas_duplicadas': 0,
        'vendas_site_ignoradas': 0,
        'clientes_novos': 0,
        'clientes_existentes': 0,
        'erros': 0,
    }

    total = len(vendas)
    t_inicio = time.time()

    for i, venda in enumerate(vendas, 1):
        external_id = str(venda.get('Id', '')).strip()
        if not external_id:
            continue

        # Progresso a cada 25 vendas
        if i % 25 == 0 or i == total:
            elapsed = time.time() - t_inicio
            vel = i / elapsed if elapsed > 0 else 0
            print(f"   [{i}/{total}] {vel:.1f} vendas/s  cache_prod={len(pdv._cache_variacoes)}  cache_cli={len(_cache_clientes)}", flush=True)

        try:
            # Filtro de deduplicacao: ignora vendas do site (wBuy/Wix)
            # Loja 8 = e-commerce. Ver PDVNET_DEDUPLICATION_ANALYSIS.md
            if venda.get('LojaId') == 8 or venda.get('TipoVenda') == 7:
                stats['vendas_site_ignoradas'] += 1
                continue

            if pdv.venda_ja_existe(conn, external_id):
                stats['vendas_duplicadas'] += 1
                continue

            # Resolve cliente — usa cache global primeiro
            pdvnet_cliente_id = str(venda.get('ClienteId', '')).strip()
            crm_id = _cache_clientes.get(pdvnet_cliente_id)

            if not crm_id:
                # Tenta por CPF da propria venda (sem chamada a API)
                cpf_venda = pdv.normalizar_cpf(venda.get('ClienteCPF', ''))
                if cpf_venda:
                    cur = conn.cursor()
                    cur.execute("SELECT id FROM customers WHERE cpf_encrypted = %s LIMIT 1", (cpf_venda,))
                    row = cur.fetchone()
                    cur.close()
                    if row:
                        crm_id = row[0]

            if not crm_id:
                # Busca dados completos do cliente na API PDVNet
                dados_cli = None
                if pdvnet_cliente_id and pdvnet_cliente_id != '0':
                    dados_cli = buscar_cliente_rapido(token, pdvnet_cliente_id)

                if dados_cli:
                    crm_id, foi_criado = pdv.encontrar_ou_criar_cliente(conn, dados_cli)
                    pdv.atualizar_contatos(conn, crm_id, dados_cli)
                    if foi_criado:
                        stats['clientes_novos'] += 1
                    else:
                        stats['clientes_existentes'] += 1
                else:
                    # Cliente anonimo ou nao encontrado na API
                    nome = venda.get('ClienteNome') or f"Cliente PDVNet #{pdvnet_cliente_id}"
                    cur = conn.cursor()
                    cur.execute("""
                        INSERT INTO customers
                            (full_name, source_channel, created_at, updated_at, total_spent, purchase_count)
                        VALUES (%s, 'pdvnet', NOW(), NOW(), 0, 0)
                        RETURNING id
                    """, (nome[:500],))
                    crm_id = cur.fetchone()[0]
                    conn.commit()
                    cur.close()
                    stats['clientes_novos'] += 1

            # Salva no cache global para proximos meses
            if pdvnet_cliente_id and crm_id:
                _cache_clientes[pdvnet_cliente_id] = crm_id

            pdv.inserir_venda(conn, crm_id, venda, token)
            stats['vendas_novas'] += 1

        except Exception as e:
            stats['erros'] += 1
            conn.rollback()

    elapsed_total = time.time() - t_inicio
    stats['segundos'] = round(elapsed_total, 1)
    return stats


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--desde', default='2021-05', help='Ano-mes inicio YYYY-MM (padrao: 2021-05)')
    parser.add_argument('--ate',   default=None,      help='Ano-mes fim YYYY-MM (padrao: mes atual)')
    args = parser.parse_args()

    def parse_ano_mes(s):
        p = s.split('-')
        return int(p[0]), int(p[1])

    ano_ini, mes_ini = parse_ano_mes(args.desde)
    if args.ate:
        ano_fim, mes_fim = parse_ano_mes(args.ate)
    else:
        hoje = date.today()
        ano_fim, mes_fim = hoje.year, hoje.month

    meses = []
    ano, mes = ano_ini, mes_ini
    while (ano, mes) <= (ano_fim, mes_fim):
        meses.append((ano, mes))
        mes += 1
        if mes > 12:
            mes = 1
            ano += 1

    print(f"Importando {len(meses)} meses: {ano_ini}-{mes_ini:02d} -> {ano_fim}-{mes_fim:02d}")
    print(f"Cache produtos + clientes persistente entre todos os meses.\n")

    conn = psycopg2.connect(**pdv.DB_CONFIG)
    print("[OK] Banco conectado")

    token = pdv.autenticar()
    print(f"[OK] Pronto. Cache produtos={len(pdv._cache_variacoes)}  cache_clientes={len(_cache_clientes)}\n")

    total_novas = 0
    total_erros = 0

    for ano, mes in meses:
        label = f"{ano}-{mes:02d}"
        print(f"\n--- {label} ---", flush=True)
        try:
            stats = importar_mes(conn, token, ano, mes)
            total_novas += stats['vendas_novas']
            total_erros += stats['erros']
            print(
                f"{label}  novas={stats['vendas_novas']:3d}  "
                f"skip_site={stats['vendas_site_ignoradas']:3d}  "
                f"ja_existiam={stats['vendas_duplicadas']:3d}  "
                f"erros={stats['erros']}  "
                f"tempo={stats.get('segundos','?')}s  "
                f"cache_prod={len(pdv._cache_variacoes)}  "
                f"cache_cli={len(_cache_clientes)}",
                flush=True
            )
        except Exception as e:
            print(f"{label}  ERRO GERAL: {e}", flush=True)
            total_erros += 1

    conn.close()
    print(f"\nConcluido. Total novas: {total_novas}  Erros: {total_erros}")
    print(f"Cache produtos: {len(pdv._cache_variacoes)} unicos  |  Cache clientes: {len(_cache_clientes)} unicos")


if __name__ == '__main__':
    main()
