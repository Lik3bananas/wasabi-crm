# SKILL: Integração PDVNet (Loja Física) → Wasabi CRM Database

**Nome:** skill_integrate_pdvnet  
**Versão:** 2.0  
**Tipo:** Importação Histórica + Sync Diário Automático  
**Frequência:** Sync automático diário às 12h (`skill_sync_pdvnet_daily.py`)  
**Status:** ✅ Concluído — 15.220 vendas importadas (Jan/2019 → Mai/2026)  
**Fase:** 3 de 3

> ⚠️ **LEIA ANTES DE MODIFICAR:** Este script possui filtro crítico de deduplicação.
> O PDVNet contém TANTO vendas físicas QUANTO vendas do site (wBuy/Wix).
> Importar sem filtro gera duplicatas. Ver seção **Deduplicação** abaixo e arquivo
> `PDVNET_DEDUPLICATION_ANALYSIS.md` para análise completa com evidências.

---

## O que faz

Sincroniza vendas e clientes da **loja física Wasabi** (sistema PDVNet) com a base de dados central do CRM.

```
PDVNet (Loja Física)
   └─ GET /api/public/vendas?inicio=...&fim=...
   └─ GET /api/public/clientes/{id}
          ↓
   Deduplicação: CPF → Email → Telefone
          ↓
   PostgreSQL (Wasabi CRM Database)
   └─ customers  (perfil unificado)
   └─ purchases  (histórico de vendas)
   └─ purchase_items (itens de cada venda)
```

---

## Status das Fases do Projeto

| Fase | Fonte | Status | Clientes | Pedidos |
|------|-------|--------|----------|---------|
| 1 | Excel Legado | ✅ Completo | 1.286 | 1.528 |
| 2 | wBuy API (site) | ⚠️ Parcial | ~531 | ~889 |
| 3 | PDVNet (loja física) | ✅ Concluído | 8.646 | 15.220 |

---

## API PDVNet — O que foi mapeado

**Base URL:** `http://wasabi.pdvnet.com.br/pdvapi`  
**Docs:** `http://wasabi.pdvnet.com.br/pdvapi/help`  
**Framework:** ASP.NET Web API (REST/JSON)

### Autenticação

```
POST /api/public/login
Body: {"Usuario": "...", "Senha": "..."}
Resposta: {"Sucesso": true, "Mensagem": "TOKEN_AQUI", "Erro": null}
```

Todos os endpoints subsequentes usam:
```
Authorization: Bearer TOKEN_AQUI
```

### Endpoints usados pela skill

| Endpoint | Uso |
|----------|-----|
| `POST /api/public/login` | Autenticação |
| `GET /api/public/vendas?inicio=&fim=&pagina=&tamanhoPagina=` | Vendas por período |
| `GET /api/public/clientes/{id}` | Dados do cliente |
| `GET /api/public/clientes?cgc=&telefone=` | Buscar cliente por CPF/telefone |

### Outros endpoints disponíveis (não usados nesta skill)

| Endpoint | Descrição |
|----------|-----------|
| `GET /api/public/clientes` | Listar clientes (paginado) |
| `GET /api/public/vendedores` | Vendedores |
| `GET /api/public/lojas` | Lojas/filiais |
| `GET /api/public/estoque/variacao` | Estoque por produto |
| `GET /api/public/precos/{tabelaId}` | Tabela de preços |
| `GET /api/public/variacoes` | Variações de produto |
| `GET /api/public/produtos/{redeId}` | Catálogo de produtos |
| `GET /api/public/bonus/cliente/{id}` | Programa de pontos/bônus |

---

## Dados do Cliente PDVNet

Campos mapeados da API para o CRM:

```
PDVNet             →   CRM
──────────────────────────────────────────
Nome               →   customers.full_name
CPFCNPJ (11 dígitos) → customers.cpf_encrypted
Email              →   customer_emails
Celular            →   customer_phones (tipo: celular)
Telefone           →   customer_phones (tipo: fixo)
TelefoneComercial  →   customer_phones (tipo: comercial)
Enderecos[0].Rua   →   customer_addresses.street
Enderecos[0].CEP   →   customer_addresses.zipcode
Enderecos[0].Cidade→   customer_addresses.city
Enderecos[0].UF    →   customer_addresses.state
LojaId             →   ignorado (todas as vendas vão para source_channel='pdvnet')
```

**Campos disponíveis mas não mapeados ainda:**
- `DataNascimento` → pode ser salvo em `customers.date_of_birth`
- `Sexo` → para segmentação futura
- `ClassificacaoId` → classificação de cliente no PDVNet
- `Inativo` → sincronizar `customers.is_active`

---

## Dados da Venda PDVNet

```
PDVNet                  →   CRM
────────────────────────────────────────────────
Id                      →   purchases.external_id
DataVenda / DataEmissao →   purchases.purchase_date
TotalVenda / ValorTotal →   purchases.total_amount
Status                  →   purchases.status (completed/cancelled)
IdCliente               →   purchases.customer_id (via deduplicação)
'pdvnet'                →   purchases.source_channel
'pdvnet_api'            →   purchases.imported_from

Itens[]:
  Descricao / NomeProduto → purchase_items.product_name
  Codigo / SKU            → purchase_items.product_sku
  Tamanho / Grade         → purchase_items.product_size
  Quantidade              → purchase_items.quantity
  PrecoUnitario           → purchase_items.unit_price
  PrecoTotal              → purchase_items.total_price
  Desconto                → purchase_items.discount
```

---

## Vantagem sobre o wBuy: Paginação Real

O PDVNet suporta paginação verdadeira via `?pagina=N&tamanhoPagina=N`:

```python
# Fase 2 (wBuy) — LIMITAÇÃO: max 100 itens, sem paginação
GET /customer?limit=100  →  sempre os mesmos 100 clientes

# Fase 3 (PDVNet) — SEM LIMITAÇÃO: paginação real
GET /vendas?inicio=2024-01-01&fim=2024-12-31&pagina=1&tamanhoPagina=100
GET /vendas?inicio=2024-01-01&fim=2024-12-31&pagina=2&tamanhoPagina=100
GET /vendas?inicio=2024-01-01&fim=2024-12-31&pagina=3&tamanhoPagina=100
# ... até esgotar todas as páginas
```

Isso significa que o PDVNet importa **100% das vendas**, sem restrição.

---

## Como usar

### 1. Configurar credenciais

Adicionar ao arquivo `wasabi_CREDENTIALS.env`:

```env
# PDVNet — Loja Física
PDVNET_BASE_URL=http://wasabi.pdvnet.com.br/pdvapi
PDVNET_USUARIO=seu_usuario_aqui
PDVNET_SENHA=sua_senha_aqui
```

### 2. Executar

```bash
# Instalação de dependências (uma vez)
pip install psycopg2-binary requests python-dotenv

# Sync incremental (desde última venda importada)
python skill_integrate_pdvnet.py

# Ver o que seria importado (sem inserir)
python skill_integrate_pdvnet.py --dry-run

# Importar histórico desde data específica
python skill_integrate_pdvnet.py --desde 2024-01-01

# Reimportar tudo
python skill_integrate_pdvnet.py --full
```

### 3. Verificar resultado

```sql
-- Total de vendas PDVNet importadas
SELECT COUNT(*) FROM purchases WHERE source_channel = 'pdvnet';

-- Clientes que compraram na loja física
SELECT COUNT(DISTINCT customer_id) FROM purchases WHERE source_channel = 'pdvnet';

-- Últimas vendas importadas
SELECT p.purchase_date, p.total_amount, c.full_name
FROM purchases p
JOIN customers c ON c.id = p.customer_id
WHERE p.source_channel = 'pdvnet'
ORDER BY p.purchase_date DESC
LIMIT 10;

-- Clientes que compraram em AMBOS os canais (site + loja física)
SELECT c.full_name, c.email,
       SUM(p.total_amount) as total_gasto,
       COUNT(*) as total_compras
FROM customers c
JOIN purchases p ON p.customer_id = c.id
GROUP BY c.id, c.full_name, c.email
HAVING COUNT(DISTINCT p.source_channel) > 1
ORDER BY total_gasto DESC;
```

---

## Deduplicação: PDVNet vs Site (wBuy/Wix)

> Análise completa com evidências em: `PDVNET_DEDUPLICATION_ANALYSIS.md`

### O problema
O PDVNet registra vendas de **todas** as origens — loja física E site. Se importarmos tudo, cada venda do site seria contada duas vezes (uma vez pelo wBuy, uma vez pelo PDVNet).

### A solução: filtro por LojaId + TipoVenda

Análise de 1.500 vendas (2025) revelou padrão inequívoco:

| LojaId | TipoSistemaOrigem | TipoVenda | É site? |
|--------|-------------------|-----------|---------|
| 8 | 100% = 1 | 99% = 7 | **SIM — ignorar** |
| 2, 4, 7 | 99% = 2 | 65 (normal) | Não — importar |

**Regra implementada no script:**
```python
# Venda do site = IGNORADA (já está no wBuy)
if venda.get('LojaId') == 8 or venda.get('TipoVenda') == 7:
    continue
```

### Por que não cruzamos por CPF+Data+Valor
A importação do wBuy (Fase 2) não gravou CPF dos clientes — a API wBuy não retorna esse campo. Portanto, cruzar por `CPF + data + valor` retornou 0 matches. O filtro por `LojaId=8` é o único método confiável.

### Como verificar se há contaminação no futuro
```sql
-- IDs da Loja 8 começam com "008..." — NÃO devem aparecer após importação correta
SELECT LEFT(external_id, 3) as loja, COUNT(*)
FROM purchases WHERE source_channel = 'pdvnet'
GROUP BY LEFT(external_id, 3);
-- Se "008" aparecer: erro de filtro
```

---

## Fluxo de Deduplicação de Clientes

Quando uma venda do PDVNet chega com dados do cliente:

```
1. Tem CPF (11 dígitos)?
   ├── SIM → Busca em customers.cpf_encrypted
   │         ├── ACHOU → Usa esse perfil ✅
   │         └── NÃO ACHOU → Tenta email
   └── NÃO → Tenta email

2. Tem Email?
   ├── SIM → Busca em customer_emails + campo legado
   │         ├── ACHOU → Usa esse perfil ✅
   │         └── NÃO ACHOU → Tenta telefone
   └── NÃO → Tenta telefone

3. Tem Telefone (celular/fixo/comercial)?
   ├── SIM → Busca em customer_phones + campo legado
   │         ├── ACHOU → Usa esse perfil ✅
   │         └── NÃO ACHOU → Cria novo perfil
   └── NÃO → Cria novo perfil
```

**Resultado:** Cliente que comprou no site E na loja física aparece como **1 perfil** com todas as compras consolidadas.

---

## Sync Incremental

A skill é inteligente — na segunda execução em diante, busca apenas o que é novo:

```python
# Detecta data da última venda PDVNet já importada
SELECT MAX(purchase_date) FROM purchases WHERE source_channel = 'pdvnet'
# → 2025-03-15

# Busca só o que é novo
GET /api/public/vendas?inicio=2025-03-15&fim=2025-05-15
# → apenas vendas dos últimos 2 meses
```

**Resultado:**
- 1ª execução (full): importa todos os dados históricos (~minutos)
- Execuções diárias: apenas vendas do dia anterior (~segundos)

---

## Agendamento

### Windows Task Scheduler
```
Task: "WasabiSyncPDVNet"
Executar: python C:\Users\Usuario\Desktop\Nova pasta (3)\skill_integrate_pdvnet.py
Agendar: Todos os dias às 03:00
```

### Linux Cron
```bash
# Sincronizar toda noite às 3h
0 3 * * * /usr/bin/python3 /path/to/skill_integrate_pdvnet.py >> /var/log/pdvnet_sync.log 2>&1
```

---

## Tratamento de Erros

| Situação | Comportamento |
|----------|---------------|
| Venda sem cliente (`IdCliente` vazio) | Cria cliente "Anônimo PDVNet" |
| Cliente não encontrado na API | Cria cliente com nome `"Cliente PDVNet #ID"` |
| Venda já importada (`external_id` duplicado) | Pula silenciosamente |
| Erro em venda individual | Registra erro, continua as próximas |
| API retorna `Sucesso: false` | Para a paginação, reporta no log |
| CNPJ no campo CPFCNPJ (14 dígitos) | Ignora para deduplicação por CPF |

---

## Monitoramento

```
============================================================
🏪  PDVNet → Wasabi CRM  |  Integração Loja Física
============================================================

📦 Conectando ao banco de dados...
✅ Banco conectado

📅 Último sync PDVNet detectado: 2025-03-15
📅 Período: 2025-03-15  →  2025-05-15

✅ Autenticado no PDVNet
📡 Buscando vendas PDVNet: 2025-03-15 → 2025-05-15
   Página 1: 100 vendas
   Página 2: 100 vendas
   Página 3: 47 vendas
   Total encontrado: 247 vendas

⚙️  Processando 247 vendas...

   [50/247] vendas processadas...
   [100/247] vendas processadas...
   [150/247] vendas processadas...
   [200/247] vendas processadas...

============================================================
📊  RELATÓRIO FINAL
============================================================
  ✅ Vendas novas importadas:    235
  ⏭️  Vendas já existentes:       12
  👤 Clientes novos criados:     43
  🔗 Clientes existentes usados: 192
  ❌ Erros:                      0
============================================================

✅ Integração PDVNet concluída!
```

---

## Status Final

```
✅ Fase 1: Legacy Excel importado (1.286 clientes, 1.528 pedidos)
✅ Fase 2: wBuy API integrado (site)
✅ Fase 3: PDVNet importado — 15.220 vendas, Jan/2019 → Mai/2026
✅ Fase 3b: Sync diário automático configurado (skill_sync_pdvnet_daily.py)
⏳ Fase 4: Validar clientes unificados (site + loja = mesmo perfil)
⏳ Fase 5: Dashboard multicanal
```

## Scripts relacionados

| Script | Função |
|--------|--------|
| `skill_integrate_pdvnet.py` | Importação pontual por período |
| `pdvnet_importar_historico.py` | Importação bulk histórica (processo único, cache persistente) |
| `skill_sync_pdvnet_daily.py` | **Sync diário automático** — roda às 12h, busca apenas vendas novas |

---

## Referências

- `ARCHITECTURE.md` — Schema geral do banco
- `DEDUPLICATION.md` — Lógica completa de deduplicação
- `skill_import_legacy.md` — Fase 1 (dados históricos)
- `skill_integrate_website_wbuy.md` — Fase 2 (site wBuy)
- API Docs: http://wasabi.pdvnet.com.br/pdvapi/help

---

**Criado em:** 2026-05-15  
**Versão:** 1.0  
**Status:** Pronto — aguardando `PDVNET_USUARIO` e `PDVNET_SENHA`
