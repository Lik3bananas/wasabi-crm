# 🛠️ SKILL: Importar Dados Históricos de Legacy System

**Status:** ✅ Production  
**Versão:** 1.0  
**Data:** 2026-05-11  
**Cliente Original:** Wasabi (E-commerce + Loja Física)

---

## O QUE FAZ

Importa dados de clientes e pedidos de um **arquivo Excel consolidado** (denormalizado) para a **base de dados unificada PostgreSQL** em formato normalizado.

**Transforma:**
```
Excel (1 linha por cliente com múltiplas colunas)
    ↓
BD (3 tabelas: customers → purchases → purchase_items)
```

---

## POR QUE FUNCIONA ASSIM

### Problema Original
- Legacy system exporta 1 linha por cliente com **774 colunas**
- Colunas estruturadas: `Pedido 1 - Data`, `Pedido 1 - Total`, `Pedido 1 - Produto 1 - Item`, etc.
- Dados altamente denormalizados (difícil de consultar)

### Solução
- **Leia o Excel em Python** (simples, flexível)
- **Deduplique por email** (evita clientes duplicados)
- **Normalize em memória**: extrai padrão `Pedido N - Produto M`
- **Insira na BD** em 3 tabelas normalizadas
- **Simples e direto** (sem retry logic, sem abstrações prematuras)

### Por que simplicidade?
Para 1,286 clientes com ~1,500 pedidos:
- ❌ Reconnection logic = overcomplicated
- ❌ Batching sofisticado = overhead
- ✅ Loop simples + commit() a cada 50 clientes = rápido e confiável

---

## LIÇÕES APRENDIDAS (Fase 1)

### ✅ O que funcionou

1. **Deduplicação NO EXCEL, não na DB**
   - `df.drop_duplicates(subset=['Email'], keep='first')`
   - Evita inserir 1,539 registros quando deveria ser 1,286

2. **Schema com field sizes corretos**
   ```sql
   full_name VARCHAR(500)      -- não 255
   email VARCHAR(500)          -- não 255
   address_street VARCHAR(500) -- não 255
   ```
   - Dados reais excedem limites pequenos
   - Melhor aumentar desde o início

3. **Simplicidade > Complexidade**
   - ❌ Scripts v1, v2, v3 com retry logic = overcomplicated
   - ❌ Reconnection com exponential backoff = desnecessário
   - ✅ Loop simples + insert direto = funciona

4. **Commit estratégico**
   - Commit a cada 50 clientes (não após cada um)
   - Balanceia performance com segurança

5. **Estrutura de padrão repetido**
   - Pedido N sempre tem mesmo padrão
   - `for p in range(1, 20)` com check `if f'Pedido {p} - Data' not in df.columns`
   - Funciona para clientes com 1 ou 10 pedidos

### ❌ Erros cometidos

1. **Múltiplos scripts diferentes**
   - Criei v1, v2, v3 em paralelo
   - Deveria ter tido UM script simples desde o início

2. **Abstração prematura**
   - Reconnection logic para 1,286 linhas é overkill
   - Timeout foi resolvido com deduplicação + schema correto

3. **Não testar schema ANTES**
   - VARCHAR(255) era insuficiente
   - Detectado só após inserção

4. **Não deduplicate desde o início**
   - Isso causou 1,539 registros duplicados
   - Teve que truncate e refazer

### 💡 Regra de Ouro

**Para importações de dados legados: Simplicidade > Performance > Features**

---

## PARA PRÓXIMOS CLIENTES

Se um novo cliente tem dados legados em Excel/CSV:

1. **Verifique a estrutura:**
   - Denormalizado (1 linha por cliente)?
   - Tem padrão repetido (Pedido N, Produto M)?
   - Qual é o identificador único? (Email, CPF, Telefone)

2. **Applique este template:**
   - Ler Excel
   - Deduplicate por identificador único
   - Loop: customer → purchases → items
   - Commit a cada 50 clientes
   - Validade final (COUNT de cada tabela)

3. **Sempre testar com 10 linhas primeiro**
   - `df_clean = df.head(10)`
   - Valide resultado antes de rodar em tudo

4. **Schema checklist:**
   - [ ] VARCHAR >= 500 para strings arbitrárias
   - [ ] VARCHAR >= 20 para CEP/Código Postal
   - [ ] created_at + updated_at em cada tabela
   - [ ] source_channel para rastrear origem dos dados
   - [ ] imported_from para Fase 1 vs Fase 2 vs Fase 3

---

## RESULTADO WASABI

```
✅ 1,286 clientes importados
✅ 1,528 pedidos consolidados
✅ 2,486 itens de pedidos
✅ Base de dados unificada funcionando
```

Pronto para Fase 2: Integração com site novo via API

---

**Próximo:** [skill_integrate_website.md](skill_integrate_website.md)
