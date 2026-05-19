# Wasabi CRM — Como Iniciar o Sistema

> **Objetivo:** Qualquer pessoa deve conseguir iniciar o sistema do zero, sem improviso e sem dúvidas, seguindo este documento.

---

## Índice

1. [Pré-requisitos](#1-pré-requisitos)
2. [Estrutura do Projeto](#2-estrutura-do-projeto)
3. [Processo Correto de Inicialização](#3-processo-correto-de-inicialização)
4. [Problemas Comuns e Soluções](#4-problemas-comuns-e-soluções)
5. [Verificação Final](#5-verificação-final)
6. [Referência Rápida](#6-referência-rápida)

---

## 1. Pré-requisitos

### O que precisa estar instalado

| Ferramenta | Versão mínima | Como verificar |
|---|---|---|
| **Node.js** | v20 ou superior | `node --version` |
| **npm** | v10 ou superior | `npm --version` |
| **Git** | qualquer versão | `git --version` |

> Para instalar Node.js: https://nodejs.org (baixe a versão LTS)

### Variáveis de ambiente

O arquivo `.env.local` deve existir em `wasabi-crm\.env.local` com o conteúdo abaixo. **Esse arquivo já existe no projeto e NÃO deve ser commitado.**

```
# Banco de dados (AWS RDS PostgreSQL — remoto, sempre online)
DB_HOST=crm-postgres-prod.crcwscya20vj.us-east-2.rds.amazonaws.com
DB_PORT=5432
DB_NAME=crm_wasabi
DB_USER=postgres
DB_PASSWORD=Crm2026Seg123Admin

# Autenticação
AUTH_SECRET=wasabi-crm-secret-2026-change-in-production

# Login do sistema
ADMIN_USERNAME=admin
ADMIN_PASSWORD=wasabi2026

# wBuy API (integração e-commerce)
WBUY_API_URL=https://sistema.sistemawbuy.com.br/api/v1
WBUY_USER=cb7486de-0454-4355-8bef-ee588db18c07
WBUY_PASS=1a647544dd9a4d69bafbe5e0c8b9d4c0

# wBuy Painel (carrinhos abandonados)
WBUY_PANEL_URL=https://sistema.sistemawbuy.com.br
WBUY_PANEL_EMAIL=renata.b.veras@gmail.com
WBUY_PANEL_PASSWORD=Nina123!
```

### Banco de dados

O banco é **PostgreSQL hospedado na AWS RDS** — é um serviço remoto, sempre online. **Não é necessário instalar ou iniciar nenhum banco local.** O app se conecta automaticamente pelo `.env.local`.

### Dependências do projeto

As dependências ficam na pasta `node_modules`. Se essa pasta não existir (ex: primeira vez clonando o repositório), é necessário instalá-las. Veja a [Seção 3 — Passo a Passo](#3-processo-correto-de-inicialização).

---

## 2. Estrutura do Projeto

```
wasabi-crm/
│
├── app/                        ← Código principal (frontend + backend)
│   ├── (dashboard)/            ← Páginas protegidas do sistema
│   │   ├── dashboard/          ← Página inicial com métricas
│   │   ├── clientes/           ← Lista e detalhe de clientes
│   │   ├── pedidos/            ← Lista de pedidos
│   │   └── carrinho/           ← Carrinhos abandonados
│   ├── login/                  ← Página de login
│   ├── api/                    ← Rotas de API (backend)
│   │   ├── auth/               ← Login, logout, sessão
│   │   ├── customers/          ← API de clientes
│   │   ├── purchases/          ← API de pedidos
│   │   ├── dashboard/          ← API de métricas
│   │   ├── abandoned-carts/    ← API de carrinhos abandonados
│   │   └── export/             ← API de exportação Excel
│   ├── layout.tsx              ← Layout raiz
│   └── page.tsx                ← Redireciona para /dashboard
│
├── lib/                        ← Utilitários compartilhados
│   ├── db.ts                   ← Conexão com PostgreSQL
│   └── session.ts              ← Autenticação JWT
│
├── components/                 ← Componentes React reutilizáveis
│   └── Sidebar.tsx             ← Menu lateral
│
├── scripts/                    ← Scripts de sincronização
│   ├── sync-wbuy.mjs           ← Importa pedidos da wBuy
│   ├── sync-wbuy.bat           ← Atalho Windows para sync wBuy
│   ├── sync-abandoned-carts.mjs ← Sincroniza carrinhos abandonados
│   └── sync-abandoned-carts.bat ← Atalho Windows para sync carrinhos
│
├── logs/                       ← Logs gerados automaticamente
│
├── proxy.ts                    ← Controle de autenticação (≠ middleware.ts)
├── next.config.ts              ← Configuração do Next.js
├── ecosystem.config.js         ← Configuração PM2 (produção)
├── package.json                ← Dependências e scripts
├── .env.local                  ← Variáveis de ambiente (NÃO commitar)
├── iniciar.vbs                 ← Script de inicialização (Windows)
├── iniciar.bat                 ← Script alternativo de inicialização
└── COMO-INICIAR.md             ← Este documento
```

**Frontend e Backend estão no mesmo projeto.** O Next.js unifica tudo: as páginas em `app/(dashboard)/` são o frontend, e as rotas em `app/api/` são o backend.

---

## 3. Processo Correto de Inicialização

### Opção A — Inicialização com duplo clique (recomendado)

Esta é a forma mais simples. Não requer abrir terminal manualmente.

**Passo 1.** Abra a pasta do projeto:
```
C:\Users\Usuario\Desktop\Nova pasta (3)\App Wasabi\wasabi-crm\
```

**Passo 2.** Dê **duplo clique** no arquivo `iniciar.vbs`

O script vai:
- Encerrar qualquer processo Node.js anterior que possa estar travado na porta
- Aguardar 1 segundo
- Abrir uma janela de terminal preta e iniciar o servidor automaticamente

**Passo 3.** Aguarde aparecer na janela preta:
```
✓ Ready in XXXX ms
```

**Passo 4.** Abra o navegador e acesse:
```
http://localhost:3000
```

**Passo 5.** Faça login com:
- **Usuário:** `admin`
- **Senha:** `wasabi2026`

---

### Opção B — Inicialização via terminal (quando necessário)

Use esta opção se quiser ver os logs em tempo real ou se o `iniciar.vbs` não funcionar.

**Passo 1.** Abra o **Prompt de Comando** (`cmd`) como administrador.

**Passo 2.** Navegue até a pasta do projeto:
```cmd
cd "C:\Users\Usuario\Desktop\Nova pasta (3)\App Wasabi\wasabi-crm"
```

**Passo 3.** (Apenas na primeira vez, ou após clonar novamente) Instale as dependências:
```cmd
npm install
```
> Aguarde o npm baixar todos os pacotes. Pode demorar alguns minutos na primeira vez.

**Passo 4.** Inicie o servidor:
```cmd
npm run dev
```

**Passo 5.** Aguarde a mensagem:
```
▲ Next.js 16.2.6
  - Local:        http://localhost:3000
  - Network:      http://...

✓ Ready in XXXX ms
```

**Passo 6.** Acesse `http://localhost:3000` no navegador.

---

### Atenção: NÃO feche a janela do terminal enquanto estiver usando o sistema.

O servidor só funciona enquanto o terminal estiver aberto. Fechar o terminal encerra o sistema.

---

### Scripts de sincronização (opcionais)

Estes scripts importam dados da plataforma wBuy para o banco. Eles são independentes do servidor principal e podem ser executados separadamente quando necessário.

**Sincronizar pedidos wBuy:**
```
Duplo clique em: scripts\sync-wbuy.bat
```
ou via terminal:
```cmd
node scripts\sync-wbuy.mjs
```

**Sincronizar carrinhos abandonados:**
```
Duplo clique em: scripts\sync-abandoned-carts.bat
```
ou via terminal:
```cmd
node scripts\sync-abandoned-carts.mjs
```

Os logs dessas sincronizações ficam em `logs\sync-wbuy-scheduler.log` e `logs\sync-abandoned-carts-scheduler.log`.

---

## 4. Problemas Comuns e Soluções

### ❌ Erro: ERR_CONNECTION_REFUSED ao acessar localhost:3000

**Causa:** O servidor não está rodando.

**Solução:**
1. Feche qualquer janela de terminal que possa ter ficado aberta.
2. Dê duplo clique em `iniciar.vbs` novamente.
3. Aguarde a mensagem "Ready" aparecer antes de abrir o navegador.

---

### ❌ Erro: "Both middleware file './middleware.ts' and proxy file './proxy.ts' are detected"

**Causa:** Um arquivo `middleware.ts` foi criado na raiz do projeto. Este projeto usa `proxy.ts` (padrão do Next.js 16) — **NÃO deve existir `middleware.ts`**.

**Solução:**
1. Abra a pasta raiz do projeto no File Explorer.
2. Localize e **delete** o arquivo `middleware.ts`.
3. Execute `iniciar.vbs` novamente.

> **Atenção:** Nunca crie `middleware.ts` neste projeto. Toda a lógica de autenticação está em `proxy.ts`.

---

### ❌ Erro: "Port 3000 is in use" ou o servidor inicia na porta 3001

**Causa:** Há um processo Node.js anterior ainda rodando na porta 3000.

**Solução:**
1. Feche todas as janelas de terminal abertas.
2. Use o `iniciar.vbs` (ele já encerra processos Node.js automaticamente antes de iniciar).

Ou manualmente via terminal:
```cmd
taskkill /F /IM node.exe /T
```
Depois inicie normalmente.

---

### ❌ Erro de dependências: "Cannot find module ..." ou "npm ERR!"

**Causa:** A pasta `node_modules` não existe ou está corrompida.

**Solução:**
```cmd
cd "C:\Users\Usuario\Desktop\Nova pasta (3)\App Wasabi\wasabi-crm"
npm install
```
Aguarde o download finalizar e tente iniciar novamente.

---

### ❌ Erro de banco de dados: "ECONNREFUSED" ou "connection timeout"

**Causa:** O servidor PostgreSQL na AWS está inacessível. Isso pode ser por:
- Falta de conexão com a internet
- O servidor RDS está temporariamente indisponível

**Solução:**
1. Verifique se há conexão com a internet.
2. Aguarde alguns minutos e tente novamente.
3. Se persistir, entre em contato com o administrador do banco.

---

### ❌ Login não funciona: "Usuário ou senha inválidos"

**Causa:** Credenciais erradas ou o arquivo `.env.local` está incorreto.

**Credenciais corretas:**
- Usuário: `admin`
- Senha: `wasabi2026`

**Se ainda não funcionar:** Verifique se o arquivo `.env.local` existe na raiz do projeto com os valores corretos (veja [Seção 1](#1-pré-requisitos)).

---

### ❌ A sessão expira muito rápido ou redireciona para o login sem motivo

**Causa:** O token JWT expira após 8 horas. Comportamento esperado.

**Solução:** Faça login novamente. Isso é normal.

---

### ❌ Ao fechar e reabrir o `iniciar.vbs`, o sistema demora para responder

**Causa:** O Node.js anterior ainda estava terminando quando o novo iniciou.

**Solução:** O `iniciar.vbs` já tem um delay de 1 segundo embutido. Se o problema persistir, aguarde alguns segundos após fechar o terminal antes de usar o `iniciar.vbs` novamente.

---

### ❌ npm run dev abre na porta 3001 em vez de 3000

**Causa:** Há um processo Node.js/Next.js ainda ocupando a porta 3000.

**Solução:**
```cmd
taskkill /F /IM node.exe /T
```
Depois execute `npm run dev` ou `iniciar.vbs` novamente.

---

## 5. Verificação Final

Após iniciar o sistema, verifique cada item:

### ✅ Servidor rodando
Na janela do terminal deve aparecer:
```
▲ Next.js 16.2.6
  - Local:        http://localhost:3000

✓ Ready in XXXX ms
```

### ✅ App acessível no navegador
Abra: `http://localhost:3000`

Deve aparecer a **página de login** com campos "Usuário" e "Senha".

> Se aparecer ERR_CONNECTION_REFUSED, o servidor não iniciou. Volte para a [Seção 3](#3-processo-correto-de-inicialização).

### ✅ Login funcionando
Use `admin` / `wasabi2026`. Após o login, deve aparecer o **Dashboard** com métricas de vendas.

### ✅ Dados carregando
O Dashboard deve exibir:
- Gráficos de vendas
- Número de clientes
- Valor total de pedidos

Se os gráficos carregarem, o banco de dados está conectado e funcionando.

### ✅ Navegação funcionando
O menu lateral deve permitir navegar entre:
- **Dashboard** — métricas gerais
- **Clientes** — base de clientes
- **Pedidos** — histórico de compras
- **Carrinhos Abandonados** — integração wBuy

### ✅ Verificação das integrações (opcional)
Para confirmar que a integração wBuy está funcionando, acesse a aba **Carrinhos Abandonados**. Se houver dados listados, a integração está ativa.

---

## 6. Referência Rápida

| O que fazer | Como fazer |
|---|---|
| Iniciar o sistema | Duplo clique em `iniciar.vbs` |
| Acessar o sistema | `http://localhost:3000` |
| Login | admin / wasabi2026 |
| Encerrar o sistema | Fechar a janela preta do terminal |
| Matar processo travado | `taskkill /F /IM node.exe /T` no cmd |
| Instalar dependências | `npm install` no terminal da pasta do projeto |
| Sincronizar wBuy | Duplo clique em `scripts\sync-wbuy.bat` |
| Sincronizar carrinhos | Duplo clique em `scripts\sync-abandoned-carts.bat` |
| Ver logs de sincronização | Pasta `logs\` no projeto |

---

## Informações técnicas

| Item | Valor |
|---|---|
| Framework | Next.js 16.2.6 com Turbopack |
| Runtime | React 19.2.4 + TypeScript |
| Banco de dados | PostgreSQL (AWS RDS us-east-2) |
| Autenticação | JWT via `jose` (cookie `wasabi_session`, 8h) |
| Porta padrão | 3000 |
| Controle de rotas | `proxy.ts` (NÃO usar `middleware.ts`) |
| Repositório | https://github.com/Lik3bananas/wasabi-crm |

---

*Última atualização: 19/05/2026 — Atualizar este documento sempre que houver mudanças no processo de inicialização.*
