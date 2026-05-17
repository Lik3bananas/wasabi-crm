#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SKILL: Integrar wBuy API com Wasabi CRM Database
Fase 2: Sincronizar clientes e pedidos do wBuy
"""

import requests
import psycopg2
import os
from dotenv import load_dotenv
from datetime import datetime

load_dotenv('wasabi_CREDENTIALS.env')

# Configurações
WBUY_USER = "cb7486de-0454-4355-8bef-ee588db18c07"
WBUY_PASS = "1a647544dd9a4d69bafbe5e0c8b9d4c0"
WBUY_ENDPOINT = "https://sistema.sistemawbuy.com.br/api/v1"
WBUY_AUTH = (WBUY_USER, WBUY_PASS)

DB_ENDPOINT = os.getenv('DB_ENDPOINT')
DB_USER = os.getenv('DB_USER')
DB_PASSWORD = os.getenv('DB_PASSWORD')
DB_NAME = os.getenv('DB_NAME')

print("[*] FASE 2 - Integração wBuy")
print("=" * 70)

# Conectar BD
print("\n[*] Conectando na BD Wasabi...")
try:
    conn = psycopg2.connect(
        host=DB_ENDPOINT, port=5432, database=DB_NAME,
        user=DB_USER, password=DB_PASSWORD
    )
    cursor = conn.cursor()
    print("[+] Conectado!")
except Exception as e:
    print(f"[-] Erro: {e}")
    exit(1)

# Download dados wBuy
print("\n[*] Baixando dados do wBuy...")
print("    - Clientes...")
try:
    r = requests.get(f"{WBUY_ENDPOINT}/customer?limit=1000", auth=WBUY_AUTH, timeout=30)
    wbuy_customers = r.json()['data']
    print(f"    [+] {len(wbuy_customers)} clientes baixados (total: {r.json()['total']})")
except Exception as e:
    print(f"    [-] Erro: {e}")
    exit(1)

print("    - Pedidos...")
try:
    r = requests.get(f"{WBUY_ENDPOINT}/order?limit=1000", auth=WBUY_AUTH, timeout=30)
    wbuy_orders = r.json()['data']
    print(f"    [+] {len(wbuy_orders)} pedidos baixados (total: {r.json()['total']})")
except Exception as e:
    print(f"    [-] Erro: {e}")
    exit(1)

# Get clientes existentes na BD
print("\n[*] Carregando clientes existentes na BD...")
cursor.execute("SELECT email FROM customers WHERE email IS NOT NULL")
existing_emails = {row[0] for row in cursor.fetchall()}
print(f"[+] {len(existing_emails)} emails existentes")

# Processar
print("\n[*] Processando...")
customers_created = 0
customers_updated = 0
purchases_created = 0

# Para cada pedido
for idx, order in enumerate(wbuy_orders):
    if idx % 100 == 0:
        print(f"    [{idx}/{len(wbuy_orders)}]...")

    try:
        # Cliente está inside do pedido
        wbuy_customer = order.get('cliente', {})
        if not wbuy_customer:
            continue

        email = wbuy_customer.get('email', '').strip() if wbuy_customer.get('email') else None
        nome = wbuy_customer.get('nome', '').strip()[:500]
        telefone = wbuy_customer.get('telefone1', '').strip() if wbuy_customer.get('telefone1') else None
        doc1 = wbuy_customer.get('doc1', '').strip() if wbuy_customer.get('doc1') else None
        cidade = wbuy_customer.get('cidade', '').strip()[:150] if wbuy_customer.get('cidade') else None
        uf = wbuy_customer.get('uf', '').strip()[:10] if wbuy_customer.get('uf') else None
        cep = wbuy_customer.get('cep', '').strip()[:20] if wbuy_customer.get('cep') else None
        endereco = wbuy_customer.get('endereco', '').strip()[:500] if wbuy_customer.get('endereco') else None

        if not nome:
            continue

        # Procurar customer na BD
        customer_id = None

        if email and email in existing_emails:
            # Já existe
            try:
                cursor.execute("SELECT id FROM customers WHERE email = %s", (email,))
                result = cursor.fetchone()
                if result:
                    customer_id = result[0]
                    customers_updated += 1
            except:
                conn.rollback()
                cursor = conn.cursor()
                continue
        else:
            # Criar novo
            try:
                cursor.execute("""
                    INSERT INTO customers (full_name, email, phone, address_street, address_city,
                                          address_state, address_zipcode, source_channel, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())
                    RETURNING id
                """, (nome, email, telefone, endereco, cidade, uf, cep, 'wbuy'))
                customer_id = cursor.fetchone()[0]
                customers_created += 1
                if email:
                    existing_emails.add(email)
            except Exception as e:
                conn.rollback()
                cursor = conn.cursor()
                continue

        if not customer_id:
            continue

        # Inserir pedido
        try:
            order_date = order.get('data')  # "2026-05-09 15:14:19"
            order_id_wbuy = order.get('identificacao')  # NAE8FAE9ZEI4ZU5
            order_status = order.get('status', {}).get('nome', 'completed')
            if order_status.lower() in ['cancelado', 'devolvido']:
                order_status = 'cancelled'
            else:
                order_status = 'completed'

            # Total do pedido (procura em diferentes campos possíveis)
            total = 0.0
            for field in ['total_pedido', 'total', 'valor_total']:
                if field in order and order[field]:
                    try:
                        total = float(order[field])
                        break
                    except:
                        pass

            cursor.execute("""
                INSERT INTO purchases (customer_id, purchase_date, total_amount, status,
                                      source_channel, external_id, imported_from, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """, (customer_id, order_date, total, order_status, 'wbuy', order_id_wbuy, 'wbuy', datetime.now()))

            purchases_created += 1

        except Exception as e:
            conn.rollback()
            cursor = conn.cursor()

        # Commit a cada 100 pedidos
        if (idx + 1) % 100 == 0:
            conn.commit()

    except Exception as e:
        conn.rollback()
        cursor = conn.cursor()
        continue

conn.commit()

# Contagem final
cursor.execute("SELECT COUNT(*) FROM customers")
total_customers = cursor.fetchone()[0]
cursor.execute("SELECT COUNT(*) FROM purchases")
total_purchases = cursor.fetchone()[0]

cursor.close()
conn.close()

print()
print("=" * 70)
print("[+] INTEGRAÇÃO wBuy COMPLETA!")
print("=" * 70)
print(f"""
Resultado:
  Clientes criados: {customers_created}
  Clientes atualizados: {customers_updated}
  Pedidos importados: {purchases_created}

Totais na BD:
  Clientes: {total_customers}
  Pedidos: {total_purchases}
""")
print("=" * 70)
