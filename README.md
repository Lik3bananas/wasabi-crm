# Wasabi CRM — Base de Dados Unificada

Sistema de CRM para consolidação de dados de clientes e vendas da **Wasabi** em uma base central unificada.

![Python](https://img.shields.io/badge/Python-3.11-blue)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-blue)
![AWS](https://img.shields.io/badge/AWS-RDS-orange)

---

## Status do Projeto

| Fase | Fonte | Status | Clientes | Vendas |
|------|-------|--------|----------|--------|
| 1 | Excel Legado | ✅ Concluído | 1.286 | 1.528 |
| 2 | wBuy API (site) | ⚠️ Parcial | ~531 | ~889 |
| 3 | PDVNet (loja física) | ✅ Concluído | 8.646 | 15.220 |
| 3b | Sync diário automático | ✅ Ativo (12h/dia) | — | — |

**Total na base:** ~10.000+ clientes únicos · 17.600+ vendas · R$ 27M+ em faturamento histórico  
**Período:** Janeiro/2019 → Maio/2026

---

## Arquitetura

```
Fontes de dados
├── Excel Legado          → skill_import_legacy.py
├── wBuy API (site)       → skill_integrate_website_wbuy.py
└── PDVNet (loja física)  → skill_integrate_pdvnet.py
                                    ↓
                    Deduplicação: CPF → Email → Telefone
                                    ↓
                    PostgreSQL (AWS RDS us-east-2)
                    ├── customers           (perfil unificado)
                    ├── purchases           (histórico de vendas)
                    ├── purchase_items      (itens por venda)
                    ├── customer_emails
                    ├── customer_phones
                    ├── customer_addresses
                    ├── pdvnet_sync_control (controle de sync)
                    └── pdvnet_sync_log     (auditoria)
```

---

## Scripts principais

| Script | Descrição |
|--------|-----------|
| `skill_import_legacy.py` | Importa dados do Excel histórico |
| `skill_integrate_website_wbuy.py` | Integra vendas do site (wBuy) |
| `skill_integrate_pdvnet.py` | Importação pontual PDVNet por período |
| `pdvnet_importar_historico.py` | Importação bulk histórica (cache persistente) |
| `skill_sync_pdvnet_daily.py` | **Sync diário automático** — executa às 12h |

---

## Sync Diário PDVNet

O sistema sincroniza automaticamente as novas vendas da loja física todo dia às 12h:

```bash
# Sync manual
python skill_sync_pdvnet_daily.py

# Ver histórico de execuções
python skill_sync_pdvnet_daily.py --show-logs

# Simular sem inserir
python skill_sync_pdvnet_daily.py --dry-run
```

**Garantias:**
- Timestamp de controle só atualiza após 100% de sucesso
- Retry automático com backoff exponencial (3 tentativas)
- Log persistente em banco (`pdvnet_sync_log`) e arquivo local
- Filtro de deduplicação: ignora vendas do site (Loja 8 / wBuy)

---

## Deduplicação PDVNet × wBuy

O PDVNet registra vendas físicas E do site. Para evitar duplicatas:

```python
# Vendas do site são ignoradas na importação PDVNet
if venda.get('LojaId') == 8 or venda.get('TipoVenda') == 7:
    continue  # já importado pelo wBuy
```

Ver análise completa: `PDVNET_DEDUPLICATION_ANALYSIS.md`

---

## Configuração

```bash
# Instalar dependências
pip install psycopg2-binary requests python-dotenv

# Credenciais (criar a partir do template)
cp wasabi_CREDENTIALS.env.example wasabi_CREDENTIALS.env
# Editar wasabi_CREDENTIALS.env com suas credenciais
```

---

## Documentação

- `ARCHITECTURE.md` — Schema completo do banco
- `skill_integrate_pdvnet.md` — Documentação da integração PDVNet
- `skill_sync_pdvnet_daily.md` — Documentação do sync diário
- `PDVNET_DEDUPLICATION_ANALYSIS.md` — Análise de deduplicação com evidências
