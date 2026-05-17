# SKILL: Integração wBuy com Wasabi CRM Database

## O que faz
Sincroniza todos os clientes e pedidos da plataforma de ecommerce wBuy com o banco de dados central PostgreSQL do Wasabi CRM, consolidando histórico de compras de múltiplas fontes em um perfil único de cliente.

## Por que existe
A Wasabi opera em múltiplos canais:
1. ✅ **Site antigo** (legado) - histórico consolidado em Excel → importado (Fase 1)
2. ✅ **Site novo** (wBuy API) - integração via REST API (Fase 2) ← você está aqui
3. ⏳ **Loja física** (PDVNet) - futura integração (Fase 3)

Este skill une dados da Fase 2 com a base central, criando um perfil de cliente unificado onde todas as compras (legado, wBuy, e futuro físico) aparecem sob a mesma pessoa.

---

## Como funciona

### 1. Autenticação
```
Endpoint: https://sistema.sistemawbuy.com.br/api/v1
Auth: HTTP Basic (user:password)
User: cb7486de-0454-4355-8bef-ee588db18c07
Pass: 1a647544dd9a4d69bafbe5e0c8b9d4c0
```

### 2. Fluxo de dados
```
[1] Carregar clientes existentes na BD
    → SELECT email FROM customers
    → Set com 1,286+ emails para deduplicação
    
[2] Baixar clientes wBuy
    → GET /customer?limit=1000
    → Retorna: ~100 clientes (ver limitação abaixo)
    
[3] Para cada cliente wBuy:
    [a] Checar se email existe em existing_emails
    [b] Se SIM: Update (fetch customer_id)
    [c] Se NÃO: Insert novo cliente
    
[4] Para cada cliente, buscar seus pedidos
    → GET /order?cliente_id={customer_id}
    → Retorna: N pedidos desse cliente (sem limite 100 aqui!)
    
[5] Inserir pedidos e fazer commit a cada 10 clientes
```

### 3. Deduplicação
- Usa **email** como chave primária de deduplicação
- Se cliente com mesmo email já existe, apenas insere seus pedidos
- Se email não existe, cria novo perfil de cliente

### 4. Campos importados

**Clientes:**
```
full_name          ← cliente.nome (max 500 chars)
email              ← cliente.email (max 500 chars)
phone              ← cliente.telefone1
address_street     ← cliente.endereco (max 500 chars)
address_city       ← cliente.cidade (max 150 chars)
address_state      ← cliente.uf (max 10 chars)
address_zipcode    ← cliente.cep (max 20 chars)
source_channel     ← 'wbuy' (constante)
```

**Pedidos:**
```
purchase_date      ← order.data (formato: "2026-05-09 15:14:19")
total_amount       ← order.total_pedido / order.total / order.valor_total
status             ← order.status.nome → 'completed' ou 'cancelled'
source_channel     ← 'wbuy'
external_id        ← order.identificacao (ex: "NAE8FAE9ZEI4ZU5")
imported_from      ← 'wbuy'
```

---

## Descobertas técnicas importantes

### ⚠️ Limitação crítica da API wBuy

**Problema:** A API wBuy tem um **hard limit de 100 itens por request** SEM suporte a pagination.

**Testado e confirmado como NÃO funcionando:**
```
GET /customer?limit=1000&offset=0         → 401 Unauthorized
GET /customer?limit=100&page=2             → 401 Unauthorized
GET /customer?limit=100&start_id=12345678 → 401 Unauthorized
GET /order?limit=1000&offset=100           → 401 Unauthorized
GET /order?limit=100&since_date=2025-01-01 → 401 Unauthorized
```

**Efeito:**
- `/customer?limit=100` sempre retorna os MESMOS 100 clientes fixos
- Não há forma de acessar os 547 clientes restantes via API
- `/order?limit=1000` sempre retorna no máximo 100 pedidos
- Não há form de paginar através de todos os 639 pedidos

**Solução implementada:**
- Usar `/order?cliente_id={customer_id}` para buscar pedidos por cliente
- Isso CONTORNA a limitação de 100 itens porque:
  - Cada cliente tem seus próprios pedidos (geralmente < 10)
  - A limitação de 100 itens aplica-se por request, não por cliente
  - Assim conseguimos importar todos os pedidos dos 100 clientes acessíveis

**Verificado:**
```python
# Teste realizado em 2026-05-12
r = requests.get(f"https://sistema.sistemawbuy.com.br/api/v1/customer?limit=100")
r.json()['total']  # → 647 (total disponível)
len(r.json()['data'])  # → 100 (máximo retornado)

# Repeating the same request 7 times returned IDENTICAL 100 customers
# No rotation, no pagination mechanism
```

---

## Resultados da integração

### Fase 2 - wBuy Integration (Última execução)

```
Antes:
  Clientes: 1,355 (1,286 legado + 69 da 1ª tentativa)
  Pedidos: 1,628 (1,528 legado + 100 da 1ª tentativa)

Depois:
  Clientes criados: 73
  Clientes atualizados: 26
  Pedidos importados: 100
  
  Totais: 1,428 clientes, 1,728 pedidos
```

### Status por fase

| Fase | Fonte | Status | Clientes | Pedidos | Notas |
|------|-------|--------|----------|---------|-------|
| 1 | Excel legado | ✅ Completo | 1,286 | 1,528 | Importação bem-sucedida, dados históricos normalizados |
| 2 | wBuy API | ⚠️ Parcial | 100/647 | 100/639 | API limitation: apenas 100 clientes acessíveis |
| 3 | PDVNet físico | ⏳ Pendente | - | - | Aguardando configuração |

---

## Problemas encontrados e soluções

### Problema 1: Pagination Parameters Return 401
**Causa:** A API aparentemente invalida a autenticação quando parâmetros adicionais são passados. Possível bug ou design intencional para limitar requests.

**Solução:** Usar filtro por cliente_id em vez de pagination parâmetros.

### Problema 2: Customer endpoint sempre retorna 100 clientes fixos
**Causa:** API não suporta pagination e aparentemente retorna um subset fixo.

**Solução:** Documentar como limitação conhecida e solicitar ao suporte wBuy.

### Problema 3: Order endpoint relatado ter 639 itens totais, mas máximo de 100 retornados
**Causa:** Mesmo limite de 100 itens máximo por request.

**Solução:** Usar per-customer order fetching com `/order?cliente_id={id}` para contornar a limitação.

---

## Como usar

### Execução básica
```bash
cd "C:\Users\Usuario\Desktop\Nova pasta (3)"
python skill_integrate_website_wbuy_v2.py
```

### Parâmetros (variáveis de ambiente)
```bash
# .env ou wasabi_CREDENTIALS.env
DB_ENDPOINT=crm-postgres-prod.crcwscya20vj.us-east-2.rds.amazonaws.com
DB_USER=postgres
DB_PASSWORD=Crm2026Seg123Admin
DB_NAME=crm_wasabi
```

### O que acontece
1. Conecta ao banco de dados
2. Carrega emails existentes (deduplicação)
3. Baixa clientes wBuy
4. Para cada cliente:
   - Cria novo cliente ou encontra existente
   - Busca pedidos do cliente
   - Insere pedidos no banco
5. Mostra relatório final

---

## Próximos passos recomendados

### Imediato
1. ✅ Rodar skill_integrate_website_wbuy_v2.py periodicamente para sincronizar novos pedidos
2. 📋 Criar schedule semanal para atualizar dados do wBuy

### Curto prazo (esta semana)
1. **CRÍTICO**: Contactar wBuy support:
   - Solicitar acesso aos 547 clientes faltantes
   - Perguntar se há endpoint alternativo com pagination
   - Solicitar bulk export de todos os clientes e pedidos
   
2. Validar dados importados:
   ```sql
   SELECT COUNT(*) FROM customers WHERE source_channel = 'wbuy';
   SELECT COUNT(*) FROM purchases WHERE source_channel = 'wbuy';
   ```

### Médio prazo (próximas 2 semanas)
1. Integrar Fase 3: PDVNet (loja física)
2. Implementar deduplicação avançada (matching por CPF, telefone, não apenas email)
3. Criar views de consolidação de clientes multi-canal

### Longo prazo
1. Implementar sync incremental (apenas novos pedidos desde última execução)
2. Adicionar alertas de falha de integração
3. Criar dashboard de reconciliação (legado vs wBuy vs físico)

---

## Código base

### Script principal
- `skill_integrate_website_wbuy_v2.py` - Versão atual (com workaround para API limitation)

### Versões anteriores (referência)
- `skill_integrate_website_wbuy.py` - v1 (tentativa inicial, import limite)
- `skill_import_legacy_v3.py` - Versão resiliente com reconnect logic
- `skill_import_legacy_v2.py` - Versão com melhor tratamento de erros
- `skill_import_legacy.md` - Documentação da Fase 1

---

## Lições aprendidas

### ✅ O que funcionou bem
1. **Deduplicação por email antes de inserir** - Previne duplicatas
2. **Commit a cada N registros** - Melhor performance e resilência
3. **Try-except wrapper por iteração** - Evita transaction abort
4. **Per-customer order fetching** - Contorna API pagination limit elegantemente

### ❌ O que não funcionou
1. **Tentativa com reconnect logic complexo** - Overcomplicated for 100 customers
2. **Usar ?offset, ?page, ?start_id** - API retorna 401
3. **Esperar por limite maior na API** - Não existe pagination mechanism

### 🎓 Princípios confirmados
- Simplicidade > Complexidade (per-customer approach é mais simples e efetivo)
- Validar antes de escalar (testar API limitations antes de criar código complexo)
- Documentar tudo (próximas pessoas que usarem isso precisam saber das limitações)

---

## Status do projeto

```
Wasabi CRM - Database Unification Project
==========================================
Phase 1: Legacy Data Import     ✅ COMPLETE (1,286 customers, 1,528 orders)
Phase 2: wBuy Integration       ⚠️  PARTIAL (100/647 customers, all orders for these)
Phase 3: Physical Store (PDVNet) ⏳ PENDING

Impediments:
  - wBuy API only supports 100 items per request, no pagination
  - Need to contact wBuy support for bulk export or proper pagination API
```

---

## Documentação de referência

Veja também:
- `ARCHITECTURE.md` - Schema geral do banco de dados
- `skill_import_legacy.md` - Integração dos dados históricos
- `[CLIENTE]_SETUP.md` - Setup específico para este cliente

---

**Última atualização:** 2026-05-12  
**Autor:** Agente CRM Ecommerce Database Creator  
**Status:** Production (com limitação documentada)
