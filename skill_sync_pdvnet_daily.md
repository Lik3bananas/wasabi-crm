# SKILL: Sync Diário PDVNet → Wasabi CRM

**Versão:** 1.0  
**Script:** `skill_sync_pdvnet_daily.py`  
**Frequência recomendada:** 3x ao dia (06h, 12h, 18h) ou 1x ao dia (03h)  
**Status:** ✅ Produção

---

## O que faz

Sincroniza **apenas vendas novas** da loja física (PDVNet) com a base CRM desde o último sync bem-sucedido. Nenhuma venda é perdida, nenhuma é duplicada.

```
PDVNet API
  └─ GET /vendas?inicio=LAST_SYNC&fim=NOW
         ↓
  Filtro: ignora Loja 8 / TipoVenda=7 (site wBuy — já na base)
         ↓
  Deduplicação: CPF → Email → Telefone → Cria novo
         ↓
  PostgreSQL CRM
  ├─ purchases + purchase_items
  ├─ pdvnet_sync_control  (timestamp de controle)
  └─ pdvnet_sync_log      (auditoria completa)
```

---

## Garantias de segurança

| Garantia | Como é feita |
|----------|-------------|
| Nenhuma venda perdida | Timestamp só atualiza após 100% de sucesso |
| Nenhuma duplicata | `external_id` único em `purchases` |
| Sem duplicatas de site | Filtro `LojaId=8` e `TipoVenda=7` |
| Rastreabilidade | Log persistente em `pdvnet_sync_log` |
| Tolerância a falhas | Retry automático (3x, backoff exponencial) |
| Falha segura | Em erro: timestamp anterior mantido, próximo sync pega tudo |

---

## Tabelas criadas

### `pdvnet_sync_control` — controle de timestamp
```sql
id                      -- sempre 1 linha
last_sync_at            -- timestamp do último sync bem-sucedido ← usado na próxima consulta
last_sync_completed_at  -- quando terminou
last_sync_status        -- success / error / partial
last_vendas_importadas
updated_at
```

### `pdvnet_sync_log` — auditoria completa
```sql
id
started_at              -- quando o sync começou
completed_at            -- quando terminou
status                  -- success / error / partial / running
desde_timestamp         -- parâmetro inicio usado na API
ate_timestamp           -- parâmetro fim usado na API
vendas_encontradas      -- total retornado pela API
vendas_importadas       -- novas inseridas no CRM
vendas_duplicadas       -- já existiam (puladas)
vendas_site_ignoradas   -- Loja 8 / wBuy (filtradas)
clientes_novos
erros_count
execution_time_seconds
new_sync_timestamp      -- timestamp salvo após sucesso (NULL se falhou)
error_message           -- stack trace em caso de erro
```

---

## Como usar

```bash
# Sync normal (busca desde último timestamp salvo)
python skill_sync_pdvnet_daily.py

# Simular sem inserir nada
python skill_sync_pdvnet_daily.py --dry-run

# Forçar data de início (reprocessar período)
python skill_sync_pdvnet_daily.py --force-desde 2026-05-01

# Ver histórico de sincronizações
python skill_sync_pdvnet_daily.py --show-logs
```

---

## Agendamento — Windows Task Scheduler

```
Nome da tarefa:  WasabiSyncPDVNet
Programa:        python
Argumentos:      C:\Users\Usuario\Desktop\Nova pasta (3)\skill_sync_pdvnet_daily.py
Horários:        06:00, 12:00, 18:00 (criar 3 tarefas)
Iniciar em:      C:\Users\Usuario\Desktop\Nova pasta (3)\
```

**Passo a passo:**
1. Abrir "Agendador de Tarefas" no Windows
2. Criar tarefa básica
3. Disparador: Diariamente às 06:00
4. Ação: Iniciar programa → `python` com argumento `skill_sync_pdvnet_daily.py`
5. Repetir para 12:00 e 18:00

---

## Agendamento — Linux Cron

```bash
# Editar crontab
crontab -e

# 3x ao dia: 06h, 12h, 18h
0 6,12,18 * * * cd /path/to/wasabi && python skill_sync_pdvnet_daily.py >> /var/log/pdvnet_sync.log 2>&1
```

---

## Consultas de monitoramento

```sql
-- Últimas 10 sincronizações
SELECT id, started_at AT TIME ZONE 'America/Sao_Paulo' as hora,
       status, vendas_importadas, erros_count, execution_time_seconds
FROM pdvnet_sync_log
ORDER BY started_at DESC LIMIT 10;

-- Sincronizações com erro
SELECT * FROM pdvnet_sync_log
WHERE status IN ('error', 'partial')
ORDER BY started_at DESC;

-- Timestamp atual de controle
SELECT last_sync_at AT TIME ZONE 'America/Sao_Paulo',
       last_sync_status, last_vendas_importadas
FROM pdvnet_sync_control;

-- Total importado hoje
SELECT SUM(vendas_importadas)
FROM pdvnet_sync_log
WHERE started_at >= CURRENT_DATE
AND status = 'success';
```

---

## Comportamento em falhas

| Situação | O que acontece |
|----------|---------------|
| API fora do ar | 3 retries com backoff (2s, 4s, 8s) |
| Timeout de rede | Retry automático |
| Erro em 1 venda | Registra erro, continua as próximas |
| 10+ erros fatais | Aborta e mantém timestamp anterior |
| Falha total | Log registrado, próximo sync repete o período |
| Sucesso parcial | `status=partial`, timestamp NÃO atualizado |

---

## Arquivo de log local

Além do banco, o script grava `pdvnet_sync.log` no diretório local:

```
2026-05-17 06:00:01 [INFO] PDVNet Sync Diario | Wasabi CRM
2026-05-17 06:00:02 [INFO] Ultimo sync: 2026-05-16 18:01:33
2026-05-17 06:00:04 [INFO] Total disponivel: 47 vendas
2026-05-17 06:00:28 [INFO] Status: SUCCESS | Importadas: 43 | Erros: 0 | Tempo: 24.3s
```

---

## Referências

- `PDVNET_DEDUPLICATION_ANALYSIS.md` — por que filtramos Loja 8
- `skill_integrate_pdvnet.md` — documentação completa da integração
- `skill_integrate_pdvnet.py` — script de importação histórica
- API PDVNet: http://wasabi.pdvnet.com.br/pdvapi/help
