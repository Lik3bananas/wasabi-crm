# PDVNet — Análise de Deduplicação com wBuy/Site

**Data da análise:** 2026-05-15  
**Autor:** Agente CRM Database Creator  
**Status:** Documentado antes da primeira importação  

---

## O Problema

O sistema PDVNet (loja física) registra **todas** as vendas da Wasabi — incluindo as vendas feitas pelo **site (wBuy e Wix)**. Isso significa que se importarmos tudo do PDVNet sem filtro, cada venda do site seria contada **duas vezes** na base:

```
Venda no site (wBuy)
  └─ Já importada na Fase 2 (source_channel = 'wbuy')
  └─ TAMBÉM aparece no PDVNet como Loja 8 / TipoVenda=7
```

---

## A Evidência (dados reais analisados em 2026-05-15)

Amostra de **1.500 vendas de 2025** analisada campo a campo:

### Vendas por Loja — 2025

| LojaId | Total | TipoSistema=1 | TipoSistema=2 | TipoVenda principal | Conclusão |
|--------|-------|---------------|----------------|---------------------|-----------|
| 7 | 769 | 5 (0,6%) | 764 (99,4%) | 65 | ✅ Loja física |
| 2 | 377 | 3 (0,8%) | 374 (99,2%) | 65 + 2 | ✅ Loja física |
| 4 | 177 | 3 (1,7%) | 174 (98,3%) | 65 + 2 | ✅ Loja física |
| **8** | **168** | **168 (100%)** | **0 (0%)** | **7** | ❌ **SITE** |
| 1 | 9 | 9 (100%) | 0 (0%) | 2 | ⚠️ Transferências |

### Padrão inequívoco da Loja 8 (Site):
- `TipoSistemaOrigem = 1` em **100%** das vendas
- `TipoVenda = 7` em **99%** das vendas
- `NotaFiscalNumero = "S"` (= "Sem nota" / "Site")
- Zero vendas com TipoSistemaOrigem=2

### Padrão das lojas físicas (2, 4, 7):
- `TipoSistemaOrigem = 2` em **>99%** das vendas
- `TipoVenda = 65` para vendas normais
- `NotaFiscalNumero` = número sequencial real (ex: "000001574")

---

## Regra de Filtro Implementada

### O que IGNORAR ao importar do PDVNet:

```python
# Regra implementada em skill_integrate_pdvnet.py
def eh_venda_do_site(venda):
    """
    Retorna True se a venda é do site (wBuy/Wix) — deve ser IGNORADA.
    
    Por que LojaId=8: É a loja virtual cadastrada no PDVNet.
    100% das suas vendas têm TipoSistemaOrigem=1 e TipoVenda=7.
    
    Por que TipoVenda=7: Código específico para pedidos online.
    Não aparece em nenhuma loja física.
    """
    return venda.get('LojaId') == 8 or venda.get('TipoVenda') == 7
```

### O que IMPORTAR:

```
LojaId IN (2, 4, 7)   → Lojas físicas confirmadas
TipoVenda = 65        → Venda normal no caixa
TipoVenda = 59        → A confirmar (pouca frequência)
TipoVenda = 2         → A confirmar (pode ser troca/transferência)
```

---

## Campos-chave para Identificação de Origem

| Campo | Valor = Site | Valor = Loja Física |
|-------|-------------|---------------------|
| `LojaId` | `8` | `2`, `4`, `7` (e outros) |
| `TipoVenda` | `7` | `65` (normal), `2` (troca?) |
| `TipoSistemaOrigem` | `1` | `2` |
| `NotaFiscalNumero` | `"S"` ou vazio | Número sequencial |

---

## Por que não usamos cruzamento por CPF+Valor+Data

Tentativa feita durante análise:

```
Compras wBuy com CPF no banco: 0
Matches PDVNet x wBuy (CPF+Data+Valor): 0
```

**Motivo:** A importação da Fase 2 (wBuy) não gravou CPF dos clientes — a API wBuy não retornou esse campo. Portanto, não é possível cruzar por CPF entre PDVNet e wBuy.

**Conclusão:** O filtro por `LojaId=8` / `TipoVenda=7` é o único método confiável disponível.

---

## Volume de Vendas Afetado pelo Filtro

Do total de 7.985 vendas no PDVNet (2024–2026):

| Período | Total PDVNet | Site (Loja 8) | Físicas a Importar |
|---------|-------------|---------------|--------------------|
| 2024 | 3.158 | ~11% ≈ 347 | ~2.811 |
| 2025 | 3.545 | 168/1.500 amostra = ~11% ≈ 390 | ~3.155 |
| 2026 (jan-mai) | 1.282 | ~11% ≈ 141 | ~1.141 |
| **TOTAL** | **7.985** | **~878** | **~7.107** |

---

## Como Verificar no Futuro se Houver Dúvida

```sql
-- Ver distribuição de lojas nas vendas PDVNet importadas
SELECT 
    external_id,
    LEFT(external_id, 3) as loja_prefix,
    purchase_date,
    total_amount
FROM purchases
WHERE source_channel = 'pdvnet'
ORDER BY purchase_date DESC
LIMIT 20;

-- Contar por prefixo de loja (os primeiros dígitos do ID são o LojaId)
-- Ex: "071..." = Loja 7, "021..." = Loja 2, "008..." = Loja 8 (site - NÃO DEVE aparecer)
SELECT 
    LEFT(external_id, 3) as loja_prefix,
    COUNT(*) as total
FROM purchases
WHERE source_channel = 'pdvnet'
GROUP BY LEFT(external_id, 3)
ORDER BY total DESC;
```

Se `loja_prefix = '008'` aparecer, significa que vendas do site entraram erroneamente.

---

## Pendências a Confirmar com o Cliente

- [ ] `TipoVenda = 2` — O que são essas ~164 vendas distribuídas nas lojas físicas? Trocas? Devoluções? Transferências?
- [ ] `LojaId = 1` — 9 vendas de transferência. Importar ou ignorar?
- [ ] `LojaId = 6` — Aparece em pequena quantidade. É loja física?
- [ ] `TipoVenda = 59` — Pouco frequente. Qual é esse tipo?

---

## Histórico de Mudanças

| Data | Mudança | Motivo |
|------|---------|--------|
| 2026-05-15 | Análise inicial criada | Antes da primeira importação |

---

**Referências:**
- `skill_integrate_pdvnet.py` — Implementação do filtro
- `skill_integrate_pdvnet.md` — Documentação da skill
- `skill_integrate_website_wbuy.md` — Fase 2 (wBuy)
