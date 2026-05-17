# 🏗️ ARQUITETURA: CRM Ecommerce Database System

## Visão Geral do Sistema

Este documento explica **como o sistema funciona**, **por que é desenhado assim**, e **como os dados fluem**.

---

## 1. Arquitetura em 3 Camadas

### Visão Gráfica

```
┌────────────────────────────────────────────────────────────┐
│ CAMADA 3: APLICAÇÕES CRM (Consulta e Análise)              │
│ ┌──────────────────┐ ┌──────────────────┐                  │
│ │  Dashboard       │ │  Reports/        │                  │
│ │  (consultas)     │ │  Analytics       │                  │
│ │  (relatórios)    │ │  (análise)       │                  │
│ └────────┬─────────┘ └────────┬─────────┘                  │
│          │ SQL/API             │ SQL/API                   │
└──────────┼─────────────────────┼────────────────────────────┘
           │                     │
┌──────────┴─────────────────────┴────────────────────────────┐
│ CAMADA 2: BASE DE DADOS CENTRAL (PostgreSQL na AWS RDS)    │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Schema Principal:                                    │   │
│  │  • customers (perfil único do cliente)             │   │
│  │  • purchases (compras online + presenciais)        │   │
│  │  • communications (WhatsApp, Instagram, email)     │   │
│  │  • products (catálogo)                             │   │
│  │  • abandoned_carts (carrinhos não finalizados)     │   │
│  │  • returns (trocas/devoluções)                     │   │
│  │  • customer_identifiers (CPF, Email, Telefone)    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  Recursos:                                                   │
│  • Backup automático diário                                │
│  • Criptografia de dados sensíveis (CPF, Phone)           │
│  • Índices para busca rápida                               │
│  • Backup para S3 (resiliência)                            │
└──────────┬──────────────────────────────────────────────────┘
           │ Insert/Update (via Skills)
┌──────────┴──────────────────────────────────────────────────┐
│ CAMADA 1: FONTES DE DADOS EXTERNAS (Integradas via Skills)  │
│                                                              │
│  Loja Online:          Loja Física:        Comunicações:    │
│  ├─ WooCommerce        ├─ PDVNet           ├─ WhatsApp      │
│  ├─ Shopify            ├─ Microvix         ├─ Instagram     │
│  └─ Custom API         └─ Custom           ├─ Email         │
│                                             └─ SMS          │
│                        Financeiro:                           │
│                        ├─ PDVNet (financeiro)               │
│                        ├─ Microvix (financeiro)             │
│                        └─ Custom                            │
│                                                              │
│  Cada fonte tem uma SKILL que:                              │
│  1. Busca dados (API, banco, arquivo)                       │
│  2. Transforma em formato padrão                            │
│  3. Identifica o cliente (CPF/Email/Phone/Nome)            │
│  4. Insere/atualiza na base central                         │
└────────────────────────────────────────────────────────────┘
```

### Por que 3 camadas?

| Camada | Por quê |
|--------|--------|
| **Camada 1** | Cada fonte de dados é diferente (APIs diferentes, formatos diferentes). Separar permite criar skills especializadas sem afetar o resto |
| **Camada 2** | Base de dados central = fonte única de verdade. Todos consultam aqui. Se está aqui, está correto e unificado |
| **Camada 3** | Aplicações de negócio (dashboards, relatórios) só consultam a base. Não precisam saber de onde os dados vieram |

---

## 2. Schema do Banco de Dados

### Tabela: `customers` (O coração do sistema)

```sql
CREATE TABLE customers (
    id UUID PRIMARY KEY,                    -- Identificador único gerado
    created_at TIMESTAMP,                   -- Quando foi criado
    updated_at TIMESTAMP,                   -- Última atualização
    
    -- Dados pessoais
    full_name VARCHAR(255),                 -- Nome completo
    cpf VARCHAR(11) ENCRYPTED,              -- CPF criptografado
    phone VARCHAR(20) ENCRYPTED,            -- Telefone criptografado
    email VARCHAR(255) ENCRYPTED,           -- Email criptografado
    
    -- Dados de endereço
    address_street VARCHAR(255),
    address_number VARCHAR(10),
    address_neighborhood VARCHAR(100),
    address_city VARCHAR(100),
    address_state VARCHAR(2),
    address_zipcode VARCHAR(8),
    
    -- Metadados
    customer_source VARCHAR(50),            -- De onde veio (site, loja física, etc)
    is_duplicate BOOLEAN DEFAULT FALSE,     -- Flag se é duplicate
    merged_into_id UUID,                    -- Se foi merged, aponta para quem
    
    -- Estatísticas
    total_purchases DECIMAL(10,2),
    total_spent DECIMAL(10,2),
    last_purchase_date DATE,
    first_purchase_date DATE,
    
    -- LGPD
    consented_communications BOOLEAN,
    data_deletion_requested BOOLEAN,
    data_deletion_date DATE
);

-- Índices para performance
CREATE INDEX idx_customers_cpf ON customers(cpf);
CREATE INDEX idx_customers_email ON customers(email);
CREATE INDEX idx_customers_phone ON customers(phone);
CREATE INDEX idx_customers_full_name ON customers(full_name);
```

**Por que é assim:**
- **UUID**: Permite gerar ID em qualquer lugar sem conflitar
- **ENCRYPTED**: CPF/Email/Phone são sensíveis (LGPD). Nunca logs em texto plano
- **customer_source**: Saber de onde veio ajuda a troubleshoot se algo der errado
- **is_duplicate + merged_into_id**: Quando dois clientes são na verdade a mesma pessoa, marcamos um como duplicate
- **Índices**: Buscar por CPF/Email deve ser instantâneo (< 100ms)

---

### Tabela: `customer_identifiers` (Mapear múltiplos identificadores)

```sql
CREATE TABLE customer_identifiers (
    id UUID PRIMARY KEY,
    customer_id UUID REFERENCES customers(id),
    
    identifier_type VARCHAR(50),           -- 'cpf', 'email', 'phone', 'external_id'
    identifier_value VARCHAR(255) ENCRYPTED,  -- O valor (criptografado se sensível)
    source VARCHAR(50),                    -- De qual sistema veio (woocommerce, pdvnet, etc)
    
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    
    UNIQUE(identifier_type, identifier_value, source)
);

CREATE INDEX idx_identifiers_value ON customer_identifiers(identifier_value);
```

**Por que:**
- Um cliente pode ter múltiplos emails (pessoal, comercial)
- Um cliente pode ter múltiplos telefones (celular, residencial)
- Um cliente pode ter ID diferente em cada sistema (ID_WOOCOMMERCE vs ID_PDVNET)
- Essa tabela permite: "Buscar todas as identidades desse cliente"

---

### Tabela: `purchases` (Histórico de compras)

```sql
CREATE TABLE purchases (
    id UUID PRIMARY KEY,
    customer_id UUID REFERENCES customers(id),
    
    -- Identificação da compra
    external_purchase_id VARCHAR(255),     -- ID no sistema original
    source VARCHAR(50),                    -- 'woocommerce', 'pdvnet', 'loja_fisica', etc
    
    -- Dados da compra
    purchase_date TIMESTAMP,
    total_amount DECIMAL(10,2),
    payment_method VARCHAR(50),             -- 'credito', 'debito', 'dinheiro', 'pix'
    
    -- Itens da compra
    items_count INT,
    items_json JSONB,                       -- Array de {sku, name, price, quantity, size}
    
    -- Status
    status VARCHAR(50),                     -- 'completed', 'returned', 'refunded'
    
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

CREATE INDEX idx_purchases_customer ON purchases(customer_id);
CREATE INDEX idx_purchases_date ON purchases(purchase_date);
```

**Por que JSONB para items:**
- Nem toda compra tem tamanho (alguns produtos não têm)
- Alguns sistemas mandam cor, outros não
- JSONB permite flexibilidade sem quebrar o schema
- Pode indexar dentro do JSONB depois se necessário

---

### Tabela: `communications` (WhatsApp, Instagram, Email)

```sql
CREATE TABLE communications (
    id UUID PRIMARY KEY,
    customer_id UUID REFERENCES customers(id),
    
    -- Dados da comunicação
    channel VARCHAR(50),                    -- 'whatsapp', 'instagram', 'email', 'sms'
    direction VARCHAR(20),                  -- 'inbound', 'outbound'
    
    message_text TEXT,
    sent_at TIMESTAMP,
    
    -- Contexto
    conversation_id VARCHAR(255),           -- Para agrupar mensagens relacionadas
    topic VARCHAR(100),                     -- 'product_question', 'complaint', 'support', etc
    
    created_at TIMESTAMP
);

CREATE INDEX idx_communications_customer ON communications(customer_id);
CREATE INDEX idx_communications_channel ON communications(channel);
CREATE INDEX idx_communications_topic ON communications(topic);
```

**Por que:**
- Visualizar histórico de interações com o cliente
- Identificar padrões (reclamações repetidas, dúvidas comuns)
- Saber último contato e assunto

---

### Tabela: `products` (Catálogo)

```sql
CREATE TABLE products (
    id UUID PRIMARY KEY,
    
    -- Identificação
    sku VARCHAR(100) UNIQUE,                -- Identificador único do produto
    name VARCHAR(255),
    description TEXT,
    
    -- Dados
    price DECIMAL(10,2),
    category VARCHAR(100),
    brand VARCHAR(100),
    
    -- Origem
    source VARCHAR(50),                     -- 'woocommerce', 'custom', etc
    external_id VARCHAR(255),
    
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

CREATE INDEX idx_products_sku ON products(sku);
CREATE INDEX idx_products_category ON products(category);
```

**Por que separado:**
- Referência única para produtos
- Evita duplicar informações em purchases
- Facilita análise: "Qual produto é mais comprado?"

---

### Tabela: `abandoned_carts` (Carrinhos não finalizados)

```sql
CREATE TABLE abandoned_carts (
    id UUID PRIMARY KEY,
    customer_id UUID REFERENCES customers(id),
    
    source VARCHAR(50),                     -- 'woocommerce', 'shopify', etc
    external_cart_id VARCHAR(255),
    
    items_json JSONB,                       -- Produtos no carrinho
    total_value DECIMAL(10,2),
    
    created_at TIMESTAMP,
    last_updated TIMESTAMP,
    
    -- Status
    is_recovered BOOLEAN,
    recovered_at TIMESTAMP
);

CREATE INDEX idx_carts_customer ON abandoned_carts(customer_id);
```

**Por que:**
- Identificar oportunidades de venda (pessoas que quase compraram)
- Campanha de remarketing
- Análise: "Por quê os carrinhos foram abandonados?"

---

## 3. Fluxo de Dados Típico

### Cenário: Cliente faz compra online + compra na loja física

```
1️⃣ COMPRA ONLINE (WooCommerce)
   └─ Skill: skill_integrate_woocommerce
      └─ Busca: "Novas compras nos últimos 24h"
      └─ Encontra: João comprou camiseta
      └─ Extrai: email=joao@gmail.com, phone=11999999999
      └─ Procura: Existe cliente com email=joao@gmail.com?
         └─ SIM: Atualiza purchases e totals
         └─ NÃO: Cria novo customer

2️⃣ COMPRA NA LOJA (PDVNet)
   └─ Skill: skill_integrate_pdvnet
      └─ Busca: "Novas vendas nos últimos 24h"
      └─ Encontra: João comprou calça (informação: telefone=11999999999)
      └─ Procura: Existe cliente com phone=11999999999?
         └─ SIM: Atualiza purchases e totals
         └─ NÃO: Cria novo customer

3️⃣ RESULTADO
   └─ Existe 1 customer: João
   └─ Tem 2 purchases (online + presencial)
   └─ Dashboard mostra: "João comprou R$ X, 2 vezes"
```

---

## 4. Identificação de Clientes (Deduplicação)

### O Problema
- João faz compra com email joao@gmail.com
- Depois compra na loja com telefone 11999999999
- São a mesma pessoa?
- Como saber sem dados duplicados?

### A Solução: Fuzzy Matching + Regras

```python
def find_or_create_customer(data):
    """
    Procura cliente existente baseado em identificadores
    Usa regras para não criar duplicatas
    """
    
    # Extrai identificadores disponíveis
    identifiers = {
        'cpf': data.get('cpf'),
        'email': data.get('email'),
        'phone': data.get('phone'),
        'name': data.get('name')
    }
    
    # Busca exata: se tem CPF, é certeza
    if identifiers['cpf']:
        customer = search_by_cpf(identifiers['cpf'])
        if customer:
            return customer
    
    # Busca por email (múltiplos emails possíveis)
    if identifiers['email']:
        customer = search_by_email(identifiers['email'])
        if customer:
            return customer
    
    # Busca por telefone
    if identifiers['phone']:
        customer = search_by_phone(identifiers['phone'])
        if customer:
            return customer
    
    # Fuzzy matching: nome + informações
    if identifiers['name']:
        similar = fuzzy_search_by_name(
            identifiers['name'],
            threshold=0.85  # 85% de similaridade
        )
        if len(similar) == 1:  # Encontrou 1 match bem provável
            return similar[0]
    
    # Nenhum encontrado: criar novo
    return create_new_customer(identifiers)
```

**Prioridade:**
1. CPF (certeza absoluta)
2. Email (muito provável)
3. Telefone (provável)
4. Fuzzy name matching (possível)
5. Criar novo (quando tudo falha)

---

## 5. Segurança e LGPD

### Dados Sensíveis
- CPF ✅ Criptografado no banco
- Telefone ✅ Criptografado no banco
- Email ✅ Criptografado em algumas queries
- Dados de cartão ❌ **NUNCA armazenar**

### Backup e Recuperação
- ✅ Backup automático diário no AWS RDS
- ✅ Snapshot semanal para S3
- ✅ Retenção de 30 dias
- ✅ Recuperação de ponto específico possível

### Auditoria
- ✅ Log de quem acessou dados de qual cliente
- ✅ Log de deletes/updates
- ✅ Rastrear mudanças sensíveis (CPF, dados de cobrança)

### Conformidade LGPD
- ✅ Direito ao esquecimento: marca `data_deletion_requested = true`
- ✅ Direito à portabilidade: pode exportar todos seus dados
- ✅ Consentimento: campo `consented_communications`
- ✅ Dados com segurança: criptografia + backup

---

## 6. Performance e Escalabilidade

### Para 100-50.000 clientes

| Métrica | Target | Como atingir |
|---------|--------|-------------|
| Buscar cliente por CPF | < 100ms | Índice em cpf |
| Listar 10 últimas compras | < 500ms | Índice em (customer_id, date) |
| Inserir compra | < 1s | Batch insert onde possível |
| Relatório mensal | < 30s | Queries pré-calculadas |

### Índices Críticos
```sql
-- Procurados o tempo todo
CREATE INDEX idx_customers_cpf ON customers(cpf);
CREATE INDEX idx_customers_email ON customers(email);
CREATE INDEX idx_customers_phone ON customers(phone);

-- Listagens
CREATE INDEX idx_purchases_customer_date ON purchases(customer_id, purchase_date DESC);
CREATE INDEX idx_communications_customer_channel ON communications(customer_id, channel);

-- Fuzzy search (nome)
CREATE INDEX idx_customers_name_trgm ON customers USING gin(full_name gin_trgm_ops);
```

---

## 7. Extensibilidade

### Adicionar nova fonte de dados

```
1. Criar nova SKILL (ex: skill_integrate_instagram)
2. Skill busca dados de Instagram API
3. Extrai: customer_id, message_text, timestamp
4. Insere em communications table
5. Pronto! Aparece no sistema
6. Nenhuma alteração no schema necessária
```

### Adicionar novo campo de cliente

```
1. ALTER TABLE customers ADD COLUMN novo_campo VARCHAR(255);
2. Atualizar documentação
3. Skills podem começar a popular esse campo
```

**Flexibilidade:** A estrutura principal é sólida (customers, purchases, communications), mas permite crescimento sem quebrar tudo.

---

## 8. Decisões de Design

| Decisão | Alternativa | Por quê escolhemos |
|---------|------------|------------------|
| **PostgreSQL** | MySQL, MongoDB | SQL é estruturado, LGPD-friendly, free tier AWS, JSONB para flexibilidade |
| **RDS (gerenciado)** | EC2 + PostgreSQL manual | Backup automático, não gerenciar OS, patch automático |
| **UUID para IDs** | Números sequenciais | Gerar IDs em qualquer lugar sem conflitos, mais seguro (não expõe quantidade de clientes) |
| **JSONB para items** | Tabela separada | Flexibilidade: nem todo item tem tamanho/cor/etc |
| **Fuzzy matching** | Apenas buscas exatas | Reduz duplicatas, melhora experiência do usuário |
| **Criptografia** | Texto plano | LGPD obrigatória, compliance, confiança do cliente |

---

## 9. Versão e Histórico

| Versão | Data | Mudanças |
|--------|------|----------|
| 1.0 | May 10, 2026 | Arquitetura inicial completa |

Este documento é sua verdade técnica. Sempre atualize quando mudanças ocorrerem. 🚀
