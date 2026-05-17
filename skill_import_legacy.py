#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SKILL: Importar Historico Wasabi (Site Antigo)
Importa dados da planilha consolidada para a BD unificada
"""

import pandas as pd
import psycopg2
from psycopg2 import sql
import re
from datetime import datetime
import sys
import os
from dotenv import load_dotenv

# Load credentials
load_dotenv('wasabi_CREDENTIALS.env')

RDS_ENDPOINT = os.getenv('DB_ENDPOINT', 'crm-postgres-prod.crcwscya20vj.us-east-2.rds.amazonaws.com')
RDS_USER = os.getenv('DB_USER', 'postgres')
RDS_PASSWORD = os.getenv('DB_PASSWORD', 'Crm2026Seg123Admin')
RDS_DB = os.getenv('DB_NAME', 'crm_wasabi')

SPREADSHEET_PATH = r"C:\Users\Usuario\Downloads\Pedidos_consolidados_por_cliente.xlsx"

# ============================================================================
# MAIN IMPORT LOGIC
# ============================================================================

print("[*] Conectando na BD...")
try:
    conn = psycopg2.connect(
        host=RDS_ENDPOINT,
        port=5432,
        database=RDS_DB,
        user=RDS_USER,
        password=RDS_PASSWORD
    )
    print("[+] Conectado!")
except Exception as e:
    print(f"[-] Erro conectando: {e}")
    sys.exit(1)

print("[*] Lendo planilha...")
try:
    df = pd.read_excel(SPREADSHEET_PATH)
    print(f"[+] Planilha carregada: {df.shape[0]} linhas x {df.shape[1]} colunas")
except Exception as e:
    print(f"[-] Erro lendo planilha: {e}")
    sys.exit(1)

# ============================================================================
# PROCESS DATA
# ============================================================================

cursor = conn.cursor()
customers_created = 0
purchases_created = 0
products_created = 0
items_created = 0

print("[*] Processando dados...")

for idx, row in df.iterrows():
    if idx % 100 == 0:
        print(f"    [{idx}/{df.shape[0]}]...")

    try:
        # ===== EXTRACT CUSTOMER DATA =====
        email = str(row.get('Email', '')).strip()
        full_name = str(row.get('Nome principal', '')).strip()
        phone = str(row.get('Telefone 1', '')).strip()
        city = str(row.get('Cidade(s)', '')).strip()
        state = str(row.get('Estado(s)', '')).strip()
        zipcode = str(row.get('CEP(s)', '')).strip()
        address = str(row.get('Endereço(s)', '')).strip()

        # Skip se nao tiver email e nome
        if not full_name or full_name == 'nan':
            continue

        # Clean phone
        phone = re.sub(r'\D', '', phone) if phone != 'nan' else None
        phone = phone if phone else None
        email = email if email != 'nan' else None

        # ===== INSERT CUSTOMER =====
        cursor.execute("""
            INSERT INTO customers
            (full_name, email, phone, address_street, address_city, address_state, address_zipcode, source_channel, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (id) DO NOTHING
            RETURNING id
        """, (full_name, email, phone, address, city, state, zipcode, 'legacy_spreadsheet'))

        result = cursor.fetchone()
        if result:
            customer_id = result[0]
            customers_created += 1
        else:
            # Customer existe, buscar ID
            cursor.execute("SELECT id FROM customers WHERE email = %s OR full_name = %s LIMIT 1", (email, full_name))
            result = cursor.fetchone()
            customer_id = result[0] if result else None

        if not customer_id:
            continue

        # ===== PROCESS PURCHASES =====
        # Estrutura: "Pedido 1 - Data", "Pedido 2 - Data", etc
        purchase_num = 1
        while True:
            date_col = f'Pedido {purchase_num} - Data'

            if date_col not in df.columns:
                break

            purchase_date = row.get(date_col)
            if pd.isna(purchase_date):
                purchase_num += 1
                continue

            purchase_number = str(row.get(f'Pedido {purchase_num} - Número', ''))
            total_col = f'Pedido {purchase_num} - Total calculado'
            total_amount = row.get(total_col, 0)
            status_col = f'Pedido {purchase_num} - Status'
            status = str(row.get(status_col, 'completed')).strip()

            if status.lower() in ['cancelado', 'devolvido']:
                status = 'cancelled'
            elif status.lower() == 'entregue':
                status = 'completed'
            else:
                status = 'completed'

            # Convert total to float
            try:
                total_amount = float(total_amount) if not pd.isna(total_amount) else 0
            except:
                total_amount = 0

            # Insert purchase
            cursor.execute("""
                INSERT INTO purchases
                (customer_id, purchase_date, total_amount, status, source_channel, external_id, imported_from)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (customer_id, purchase_date, total_amount, status, 'legacy', purchase_number, 'legacy_spreadsheet'))

            purchase_id = cursor.fetchone()[0]
            purchases_created += 1

            # ===== PROCESS PRODUCTS =====
            product_num = 1
            while True:
                product_col = f'Pedido {purchase_num} - Produto {product_num} - Item'

                if product_col not in df.columns:
                    break

                product_name = str(row.get(product_col, '')).strip()
                if not product_name or product_name == 'nan':
                    product_num += 1
                    continue

                sku = str(row.get(f'Pedido {purchase_num} - Produto {product_num} - SKU', '')).strip()
                qty = row.get(f'Pedido {purchase_num} - Produto {product_num} - Quant.', 1)
                price = row.get(f'Pedido {purchase_num} - Produto {product_num} - Preço unit.', 0)
                subtotal = row.get(f'Pedido {purchase_num} - Produto {product_num} - Subtotal', 0)

                try:
                    qty = int(qty) if not pd.isna(qty) else 1
                    price = float(price) if not pd.isna(price) else 0
                    subtotal = float(subtotal) if not pd.isna(subtotal) else 0
                except:
                    qty, price, subtotal = 1, 0, 0

                # Get or create product
                if sku and sku != 'nan':
                    cursor.execute("""
                        SELECT id FROM products WHERE sku = %s
                    """, (sku,))
                    product = cursor.fetchone()

                    if not product:
                        cursor.execute("""
                            INSERT INTO products (sku, name, status)
                            VALUES (%s, %s, 'active')
                            RETURNING id
                        """, (sku, product_name))
                        product_id = cursor.fetchone()[0]
                        products_created += 1
                    else:
                        product_id = product[0]
                else:
                    product_id = None

                # Insert purchase item
                cursor.execute("""
                    INSERT INTO purchase_items
                    (purchase_id, product_id, product_sku, product_name, quantity, unit_price, total_price)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                """, (purchase_id, product_id, sku, product_name, qty, price, subtotal))

                items_created += 1
                product_num += 1

            purchase_num += 1

        conn.commit()

    except Exception as e:
        conn.rollback()
        print(f"    [!] Erro na linha {idx}: {e}")
        continue

cursor.close()
conn.close()

# ============================================================================
# SUMMARY
# ============================================================================

print()
print("=" * 70)
print("[+] IMPORTACAO COMPLETA!")
print("=" * 70)
print(f"""
Resultado:
  Clientes criados: {customers_created}
  Pedidos criados: {purchases_created}
  Produtos criados: {products_created}
  Itens de pedidos: {items_created}

Total de linhas processadas: {df.shape[0]}

Proximos passos:
  1. Validar dados importados
  2. Verificar deduplicacao
  3. Sincronizar site novo
""")
print("=" * 70)
