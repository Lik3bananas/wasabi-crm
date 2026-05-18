# SKILL: Integração PDVNet (Loja Física) → Wasabi CRM Database

**Nome:** skill_integrate_pdvnet  
**Versão:** 3.0  
**Tipo:** Importação Histórica + Sync Diário Automático  
**Status:** ✅ Operacional — 15.220 vendas importadas (Jan/2019 → Mai/2026)

> ⚠️ **REGRA CRÍTICA DE DEDUPLICAÇÃO — LEIA PRIMEIRO:**  
> O PDVNet registra TANTO vendas físicas QUANTO vendas do site (espelho wBuy).  
> `LojaId=8` e `TipoVenda=7` = site — **SEMPRE filtrar, nunca importar**.  
> Evidências em `PDVNET_DEDUPLICATION_ANALYSIS.md`.

---

## Localização dos Scripts

Todos os arquivos ficam em `C:\Users\Usuario\Desktop\Nova pasta (3)\`:

| Arquivo | Função |
|---------|--------|
| `skill_integrate_pdvnet.py` | Importação pontual por período (histórica) |
| `skill_sync_pdvnet_daily.py` | **Sync diário automático** — roda 3x/dia (06h, 12h, 18h) |
| `pdvnet_importar_historico.py` | Importação bulk histórica com cache persistente |
| `wasabi_CREDENTIALS.env` | Credenciais DB + PDVNet |
| `pdvnet_sync.log` | Log do sync diário |
| `PDVNET_DEDUPLICATION_ANALYSIS.md` | Análise das 1.500 vendas que confirmou o filtro LojaId=8 |

---

## Credenciais e Acesso

### PDVNet API

```
URL Base:   http://wasabi.pdvnet.com.br/pdvapi
Docs:       http://wasabi.pdvnet.com.br/pdvapi/help
Framework:  ASP.NET Web API (REST/JSON)

Usuario:    Re Veras
Senha:      8170
```

### Banco de Dados (PostgreSQL RDS)

```
Host:       crm-postgres-prod.crcwscya20vj.us-east-2.rds.amazonaws.com
Port:       5432
Database:   crm_wasabi
User:       postgres
Password:   Crm2026Seg123Admin
SSL:        rejectUnauthorized=false
```

Arquivo completo: `wasabi_CREDENTIALS.env`

---

## Autenticação PDVNet

### Request

```http
POST http://wasabi.pdvnet.com.br/pdvapi/api/public/login
Content-Type: application/json

{"Usuario": "Re Veras", "Senha": "8170"}
```

### Response (campo lido pelo script)

```python
token = resp.json().get('Token')   # ← campo exato na resposta
```

O token é lido diretamente do campo `Token` do JSON. Exemplo de resposta:
```json
{"Token": "eyJ0eXAiOiJKV1Q...", "Sucesso": true}
```

### Header para todas as chamadas subsequentes

```http
Authorization: Bearer eyJ0eXAiOiJKV1Q...
```

---

## Endpoints da API

### Vendas (paginado)

```http
GET /api/public/vendas?inicio=YYYY-MM-DD&fim=YYYY-MM-DD&pagina=1&tamanhoPagina=50
Authorization: Bearer TOKEN
```

> ⚠️ **`tamanhoPagina` máximo é 50.** Valores acima causam HTTP 500. Usar sempre `tamanhoPagina=50`.

Resposta:
```json
{
  "Sucesso": true,
  "Total": 1247,
  "Paginas": 25,
  "Dados": [
    {
      "Id": 41741,
      "DataVenda": "2026-05-18T14:30:00",
      "ValorTotal": 350.00,
      "Inativa": false,
      "LojaId": 7,
      "TipoVenda": 65,
      "ClienteId": 12345,
      "ClienteCPF": "123.456.789-00",
      "ClienteNome": "MARIA SILVA",
      "Itens": [
        {
          "VariacaoId": 9901,
          "NomeProduto": "VESTIDO ESCADA INCERTI",
          "SKU": "VEST-001",
          "Quantidade": 1,
          "Preco": 399.00,
          "ValorDesconto": 49.00
        }
      ]
    }
  ]
}
```

**Campos críticos da venda:**

| Campo API | Significado | Mapeamento DB |
|-----------|-------------|---------------|
| `Id` | ID único da venda no PDVNet | `purchases.external_id` |
| `DataVenda` | Data/hora da venda | `purchases.purchase_date` |
| `ValorTotal` | **Total pago pelo cliente** (pode ser 0 em trocas) | `purchases.total_amount` |
| `Inativa` | `true` = venda cancelada | `purchases.status` → `cancelled` / `completed` |
| `LojaId` | 2, 4, 7 = loja física; **8 = site (filtrar!)** | — |
| `TipoVenda` | 65 = normal; 2 = troca; **7 = site (filtrar!)** | — |
| `ClienteId` | ID do cliente no PDVNet | para busca em `/api/public/clientes/{id}` |
| `ClienteCPF` | CPF do cliente | deduplicação |

**Campos críticos do item (`Itens[]`):**

| Campo API | Significado | Mapeamento DB |
|-----------|-------------|---------------|
| `VariacaoId` | ID da variação do produto | referência PDVNet |
| `NomeProduto` | Nome do produto | `purchase_items.product_name` |
| `SKU` | Código SKU | `purchase_items.product_sku` |
| `Quantidade` | Quantidade | `purchase_items.quantity` |
| `Preco` | **Preço cheio de varejo** (sem desconto aplicado) | `purchase_items.unit_price` |
| `ValorDesconto` | Desconto do item | `purchase_items.discount` |

> ℹ️ **Nota sobre preços:** `Preco` é o preço cheio. O valor realmente pago é `Preco - ValorDesconto`.  
> A UI do CRM exibe: Subtotal / Desconto / Total pago (não escala os preços dos itens).

### Cliente por ID

```http
GET /api/public/clientes/{ClienteId}
Authorization: Bearer TOKEN
```

Campos usados: `Nome`, `CPFCNPJ` (11 dígitos = CPF; 14 = CNPJ, ignorar para dedup),
`Email`, `Celular`, `Telefone`, `TelefoneComercial`,
`Enderecos[0].Rua`, `Enderecos[0].CEP`, `Enderecos[0].Cidade`, `Enderecos[0].UF`

### Outros endpoints disponíveis (não usados no sync)

| Endpoint | Descrição |
|----------|-----------|
| `GET /api/public/clientes` | Listar clientes (paginado) |
| `GET /api/public/lojas` | Lojas/filiais |
| `GET /api/public/vendedores` | Vendedores |
| `GET /api/public/variacoes/{id}` | Variação de produto específica |
| `GET /api/public/estoque/variacao` | Estoque |
| `GET /api/public/precos/{tabelaId}` | Tabela de preços |
| `GET /api/public/bonus/cliente/{id}` | Pontos/bônus do cliente |

---

## Lógica dos Scripts

### `skill_integrate_pdvnet.py` — Importação Histórica

Função principal `inserir_venda()`:

```python
# 1. Filtro de site (CRÍTICO — nunca remover)
if venda.get('LojaId') == 8 or venda.get('TipoVenda') == 7:
    continue  # é espelho wBuy, já está no banco via sync wBuy

# 2. Valores lidos do API
total   = float(venda.get('ValorTotal', 0))   # pode ser 0.0 em trocas
inativa = venda.get('Inativa', False)
status  = 'cancelled' if inativa else 'completed'

# 3. Itens
preco_unit = float(item.get('Preco', 0))         # preço cheio
desconto   = float(item.get('ValorDesconto', 0)) # desconto do item
preco_tot  = qtd * preco_unit                    # total sem desconto

# 4. external_id codifica a loja
# Formato: "{LojaId:03d}{Id}"  ex: Loja 7 + Id 1741 → "0071741"
# Prefixo "008..." nunca deve aparecer no banco

# 5. Atualização de cliente — INCREMENTAL (ver problema conhecido abaixo)
UPDATE customers SET
    purchase_count = purchase_count + 1,
    total_spent    = total_spent + %s,   # NUNCA decrementa em cancelamento
    ...
```

**Deduplicação de clientes:** CPF → Email → Telefone → Cria novo

### `skill_sync_pdvnet_daily.py` — Sync Diário

- **Tabela de controle:** `pdvnet_sync_control` — guarda timestamp do último sync bem-sucedido
- **Tabela de log:** `pdvnet_sync_log` — auditoria de cada execução
- **Retry:** 3 tentativas, backoff exponencial (2s, 4s, 8s)
- **Janela padrão:** busca desde o último timestamp até agora
- **Comportamento:** só processa pedidos NOVOS — se `external_id` já existe, pula
- **Modos:**
  ```bash
  python skill_sync_pdvnet_daily.py              # sync normal
  python skill_sync_pdvnet_daily.py --dry-run    # simula sem gravar
  python skill_sync_pdvnet_daily.py --desde 2026-05-01  # janela manual
  ```

**Agendamento atual (Windows Task Scheduler):**
```
Horários: 06:00, 12:00, 18:00 (3x por dia)
Log:      C:\Users\Usuario\Desktop\Nova pasta (3)\pdvnet_sync.log
```

---

## Deduplicação de Lojas (Regra Crítica)

O PDVNet tem 4 lojas registradas:

| LojaId | Tipo | Ação |
|--------|------|------|
| 2 | Loja física | ✅ Importar |
| 4 | Loja física | ✅ Importar |
| 7 | Loja física (principal) | ✅ Importar |
| **8** | **Site (espelho wBuy)** | **❌ Filtrar — já está no banco** |

`TipoVenda=7` também indica origem site — filtrado em conjunto.

**Como verificar integridade:**
```sql
-- Prefixo "008" = Loja 8 = site. NUNCA deve aparecer após importação correta.
SELECT LEFT(external_id, 3) AS loja_prefix, COUNT(*)
FROM purchases WHERE source_channel = 'pdvnet'
GROUP BY LEFT(external_id, 3);
-- Esperado: "007", "002", "004" apenas.
```

---

## Problemas Conhecidos (Dados Atuais)

### 1. ValorTotal=0 em Trocas (332 pedidos)

**Causa:** PDVNet retorna `ValorTotal=0` para pedidos do tipo `TipoVenda=2` (trocas/exchanges).  
Os itens têm preços corretos (`Preco` preenchido), mas o total da venda é zero porque é uma troca — não houve pagamento líquido.

```sql
-- Verificar: pedidos PDVNet com total_amount = 0
SELECT COUNT(*) FROM purchases WHERE source_channel = 'pdvnet' AND total_amount = 0;
-- Resultado atual: 332 pedidos

-- Todos vêm da Loja 7 (física, não site)
SELECT LEFT(external_id, 3) AS loja, COUNT(*)
FROM purchases WHERE source_channel = 'pdvnet' AND total_amount = 0
GROUP BY LEFT(external_id, 3);
```

**Status:** Aguardando confirmação do cliente se são realmente trocas intencionais com ValorTotal=0, ou se é bug no PDVNet.  
**Não corrigir automaticamente** — zeros são dados corretos da API.

### 2. total_spent Inflado para 275 Clientes (~R$785k)

**Causa:** `inserir_venda()` usa atualização incremental `total_spent = total_spent + valor`.  
Quando um pedido é cancelado (`Inativa=True`), o sync pula o pedido (já existe → `continue`).  
Como nunca há subtração, o `total_spent` nunca é decrementado para cancelamentos.

```sql
-- Verificar divergência: total_spent calculado vs armazenado
SELECT
    c.id,
    c.full_name,
    c.total_spent AS armazenado,
    COALESCE(SUM(CASE WHEN p.status='completed' THEN p.total_amount ELSE 0 END), 0) AS calculado,
    c.total_spent - COALESCE(SUM(CASE WHEN p.status='completed' THEN p.total_amount ELSE 0 END), 0) AS inflacao
FROM customers c
LEFT JOIN purchases p ON p.customer_id = c.id AND p.source_channel = 'pdvnet'
WHERE c.source_channel = 'pdvnet'
GROUP BY c.id, c.full_name, c.total_spent
HAVING c.total_spent > COALESCE(SUM(CASE WHEN p.status='completed' THEN p.total_amount ELSE 0 END), 0) + 1
ORDER BY inflacao DESC;
```

**Fix conhecido (ainda não executado):**
```sql
UPDATE customers c
SET total_spent = sub.real_total,
    purchase_count = sub.real_count,
    updated_at = NOW()
FROM (
    SELECT customer_id,
           COALESCE(SUM(CASE WHEN status='completed' THEN total_amount ELSE 0 END), 0) AS real_total,
           COUNT(CASE WHEN status='completed' THEN 1 END) AS real_count
    FROM purchases WHERE source_channel = 'pdvnet'
    GROUP BY customer_id
) sub
WHERE c.id = sub.customer_id
  AND c.source_channel = 'pdvnet';
```

---

## Mapeamento API → Banco

### Tabela `purchases`

| Campo API PDVNet | Campo DB | Notas |
|-----------------|----------|-------|
| `Id` | `external_id` | prefixado com LojaId (ex: "071{Id}") |
| `DataVenda` | `purchase_date` | |
| `ValorTotal` | `total_amount` | pode ser 0 em trocas |
| `Inativa=false` | `status = 'completed'` | |
| `Inativa=true` | `status = 'cancelled'` | |
| (fixo) | `source_channel = 'pdvnet'` | |
| (fixo) | `imported_from = 'pdvnet_api'` | |

### Tabela `purchase_items`

| Campo API PDVNet | Campo DB | Notas |
|-----------------|----------|-------|
| `NomeProduto` | `product_name` | |
| `SKU` | `product_sku` | |
| `Quantidade` | `quantity` | |
| `Preco` | `unit_price` | preço cheio, sem desconto |
| `Preco * Quantidade` | `total_price` | calculado no script |
| `ValorDesconto` | `discount` | desconto do item |

### Tabela `customers`

| Campo API PDVNet | Campo DB | Notas |
|-----------------|----------|-------|
| `ClienteNome` ou `Nome` | `full_name` | title case aplicado |
| `CPFCNPJ` (11d) | `cpf_encrypted` | 14d (CNPJ) ignorado para dedup |
| `Email` | `email` | lowercase |
| `Celular` | `phone` | preferencial |
| `Enderecos[0].Cidade` | `address_city` | |
| `Enderecos[0].UF` | `address_state` | |
| `Enderecos[0].Rua` | `address_street` | |
| `Enderecos[0].CEP` | `address_zipcode` | |
| (fixo) | `source_channel = 'pdvnet'` | |

---

## Consultas de Monitoramento

```sql
-- Volume geral
SELECT COUNT(*) FROM purchases WHERE source_channel = 'pdvnet';

-- Volume por status
SELECT status, COUNT(*), SUM(total_amount)
FROM purchases WHERE source_channel = 'pdvnet'
GROUP BY status;

-- Últimas vendas importadas
SELECT p.purchase_date, p.total_amount, p.status, c.full_name
FROM purchases p JOIN customers c ON c.id = p.customer_id
WHERE p.source_channel = 'pdvnet'
ORDER BY p.purchase_date DESC LIMIT 10;

-- Último sync bem-sucedido
SELECT * FROM pdvnet_sync_control ORDER BY updated_at DESC LIMIT 1;

-- Histórico de execuções do sync
SELECT * FROM pdvnet_sync_log ORDER BY created_at DESC LIMIT 20;

-- Verificar contaminação de site (não deve retornar "008")
SELECT LEFT(external_id, 3) AS loja_prefix, COUNT(*)
FROM purchases WHERE source_channel = 'pdvnet'
GROUP BY LEFT(external_id, 3) ORDER BY 2 DESC;
```

---

## Fluxo de Deduplicação de Clientes

```
1. Tem CPF (11 dígitos)?
   ├── SIM → busca customers.cpf_encrypted
   │         ├── ACHOU → usa esse perfil ✅
   │         └── NÃO ACHOU → tenta email
   └── NÃO (ou CNPJ 14d) → tenta email

2. Tem Email?
   ├── SIM → busca LOWER(customers.email)
   │         ├── ACHOU → usa esse perfil ✅
   │         └── NÃO ACHOU → tenta telefone
   └── NÃO → tenta telefone

3. Tem Telefone?
   ├── SIM → busca por dígitos normalizados
   │         ├── ACHOU → usa esse perfil ✅
   │         └── NÃO ACHOU → cria novo perfil
   └── NÃO → cria novo perfil
```

---

## Como Executar

### Dependências
```bash
pip install psycopg2-binary requests python-dotenv
```

### Importação histórica
```bash
cd "C:\Users\Usuario\Desktop\Nova pasta (3)"

# Dry-run primeiro
python skill_integrate_pdvnet.py --dry-run

# Importar desde data específica
python skill_integrate_pdvnet.py --desde 2026-01-01

# Importar tudo
python skill_integrate_pdvnet.py --full
```

### Sync diário manual
```bash
python skill_sync_pdvnet_daily.py
python skill_sync_pdvnet_daily.py --dry-run
```

---

## Status do Projeto

| Fase | Fonte | Status | Clientes | Pedidos |
|------|-------|--------|----------|---------|
| 1 | Excel Legado | ✅ Completo | 1.286 | 1.528 |
| 2 | wBuy API (site) | ✅ Operacional | ~783 | ~783 |
| 3 | PDVNet (loja física) | ✅ Concluído | 8.646 | 15.220 |

**Pendências de dados:**
- [ ] Confirmar com cliente se ValorTotal=0 são trocas intencionais (332 pedidos)
- [ ] Recalcular total_spent para os 275 clientes com valor inflado após confirmação

---

**Versão:** 3.0  
**Atualizado:** 2026-05-18  
**Status:** Operacional ✅
