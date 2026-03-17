# Plano de Desenvolvimento: Bot de Liquidez Concentrada na Orca (Solana)

## Sumário

1.  [Introdução](#1-introdução)
2.  [Fase 1: Arquitetura Técnica e Stack de Desenvolvimento](#2-fase-1-arquitetura-técnica-e-stack-de-desenvolvimento)
    *   [1.1. Linguagem de Programação](#11-linguagem-de-programação)
    *   [1.2. SDKs e Bibliotecas Essenciais](#12-sdks-e-bibliotecas-essenciais)
    *   [1.3. Acesso à Rede Solana (RPC Node)](#13-acesso-à-rede-solana-rpc-node)
    *   [1.4. Gerenciamento de Chaves e Segurança](#14-gerenciamento-de-chaves-e-segurança)
    *   [1.5. Monitoramento de Preços e Dados de Mercado](#15-monitoramento-de-preços-e-dados-de-mercado)
    *   [1.6. Estrutura de Projeto (Exemplo - Python)](#16-estrutura-de-projeto-exemplo---python)
3.  [Fase 2: Lógica da Estratégia de Re-range (Gatilhos de Entrada/Saída)](#3-fase-2-lógica-da-estratégia-de-re-range-gatilhos-de-entrada/saída)
    *   [2.1. Definição de Faixa de Preço Inicial (Initial Price Range)](#21-definição-de-faixa-de-preço-inicial-initial-price-range)
    *   [2.2. Gatilhos de Re-range (Re-ranging Triggers)](#22-gatilhos-de-re-range-re-ranging-triggers)
    *   [2.3. Lógica de Fechamento e Reabertura](#23-lógica-de-fechamento-e-reabertura)
    *   [2.4. Parâmetros Configuráveis da Estratégia](#24-parâmetros-configuráveis-da-estratégia)
4.  [Fase 3: Mapeamento do Fluxo de Execução](#4-fase-3-mapeamento-do-fluxo-de-execução)
    *   [3.1. Inicialização do Bot](#31-inicialização-do-bot)
    *   [3.2. Ciclo Principal de Operação (Loop Contínuo)](#32-ciclo-principal-de-operação-loop-contínuo)
    *   [3.3. Tratamento de Erros e Logs](#33-tratamento-de-erros-e-logs)
    *   [3.4. Diagrama de Fluxo Simplificado](#34-diagrama-de-fluxo-simplificado)
5.  [Fase 4: Gestão de Riscos e Controle de Custos](#5-fase-4-gestão-de-riscos-e-controle-de-custos)
    *   [4.1. Controle de Slippage](#41-controle-de-slippage)
    *   [4.2. Gerenciamento de Priority Fees (Taxas de Prioridade)](#42-gerenciamento-de-priority-fees-taxas-de-prioridade)
    *   [4.3. Monitoramento de Saldo e Alertas](#43-monitoramento-de-saldo-e-alertas)
    *   [4.4. Perda Impermanente (Impermanent Loss - IL)](#44-perda-impermanente-impermanent-loss---il)
    *   [4.5. Segurança da Chave Privada](#45-segurança-da-chave-privada)
    *   [4.6. Logging e Auditoria](#46-logging-e-auditoria)
6.  [Referências](#6-referências)

---

## 1. Introdução

Este documento apresenta um plano de desenvolvimento detalhado para a criação de um bot de automação de liquidez concentrada na Orca (Solana). O foco principal é em pares de ativos correlacionados, como WETH/SOL e JLP/SOL, utilizando uma estratégia de re-range automático que abre posições com faixas de preço curtas e as fecha/reabre quando o preço sai da faixa ou sob outras condições predefinidas. O objetivo é maximizar a coleta de taxas e otimizar a eficiência do capital, minimizando os riscos associados à provisão de liquidez.

---

## 2. Fase 1: Arquitetura Técnica e Stack de Desenvolvimento

Esta fase detalha os componentes tecnológicos e as ferramentas necessárias para construir o bot de automação de liquidez concentrada na Orca, com foco em pares correlacionados e estratégia de re-range.

### 2.1. Linguagem de Programação

Recomenda-se **Python** devido à sua vasta biblioteca para análise de dados, facilidade de scripting e grande comunidade em finanças quantitativas e automação. Alternativamente, **TypeScript/JavaScript** é uma excelente opção, dado que o SDK oficial da Orca é primariamente em TypeScript.

### 2.2. SDKs e Bibliotecas Essenciais

Para interagir com a blockchain Solana e os programas da Orca, os seguintes SDKs e bibliotecas serão fundamentais:

*   **Solana Web3 Library:**
    *   **Python:** `solana.py` - Biblioteca para interagir com a rede Solana, construir e enviar transações, gerenciar carteiras, etc.
    *   **TypeScript:** `@solana/web3.js` - A biblioteca oficial da Solana para interações com a blockchain.

*   **Orca Whirlpools SDK:**
    *   **Python:** Atualmente, não há um SDK Python oficial para Orca Whirlpools. Será necessário usar um wrapper não oficial ou, mais robustamente, interagir diretamente com os programas da Solana usando `solana.py` e entender a estrutura de dados dos Whirlpools. Uma alternativa é usar o SDK TypeScript e criar um serviço Python que se comunica com um backend Node.js/TypeScript.
    *   **TypeScript:** `@orca-so/whirlpools-sdk` - O SDK oficial para interagir com os pools de liquidez concentrada (Whirlpools) da Orca. Permite criar, gerenciar e fechar posições de liquidez, coletar taxas e rebalancear.

### 2.3. Acesso à Rede Solana (RPC Node)

Para garantir a execução rápida e confiável das transações, é crucial ter acesso a um nó RPC (Remote Procedure Call) de alta performance:

*   **Provedores:** Serviços como Helius, QuickNode, Alchemy ou Ankr oferecem nós RPC dedicados com baixa latência e maior limite de requisições, essenciais para bots de alta frequência.
*   **Configuração:** O bot precisará ser configurado para se conectar a este endpoint RPC.

### 2.4. Gerenciamento de Chaves e Segurança

A segurança das chaves privadas é primordial:

*   **Armazenamento:** As chaves privadas da carteira que proverá liquidez devem ser armazenadas de forma segura, preferencialmente em variáveis de ambiente, gerenciadores de segredos (como HashiCorp Vault ou AWS Secrets Manager) ou arquivos de chave criptografados, nunca diretamente no código-fonte.
*   **Assinatura de Transações:** O bot precisará da capacidade de assinar transações programaticamente usando a chave privada.

### 2.5. Monitoramento de Preços e Dados de Mercado

Para tomar decisões informadas sobre re-range, o bot precisará de dados de preço em tempo real:

*   **APIs de Dados:** APIs como CoinGecko, CoinMarketCap ou Pyth Network podem fornecer feeds de preço para os pares WETH/SOL e JLP/SOL.
*   **Preços On-Chain:** Para maior precisão e para evitar latência de APIs centralizadas, o bot pode consultar diretamente os oráculos de preço ou os próprios pools da Orca/Raydium para obter o preço atual do par.

### 2.6. Estrutura de Projeto (Exemplo - Python)

```
/bot_orca
├── main.py                 # Lógica principal do bot
├── config.py               # Configurações (RPC URL, chaves, pares, etc.)
├── solana_utils.py         # Funções de interação com a Solana (enviar tx, etc.)
├── orca_whirlpools.py      # Funções de interação com Orca Whirlpools (abrir/fechar/rebalancear)
├── price_monitor.py        # Módulo para monitorar preços
├── strategy.py             # Lógica da estratégia de re-range
├── requirements.txt        # Dependências Python
└── .env                    # Variáveis de ambiente (chaves privadas, etc.)
```

---

## 3. Fase 2: Lógica da Estratégia de Re-range (Gatilhos de Entrada/Saída)

Esta fase detalha a lógica central da estratégia de re-range automático para o bot de liquidez concentrada, focando nos gatilhos que determinarão quando abrir, fechar e reabrir posições.

### 3.1. Definição de Faixa de Preço Inicial (Initial Price Range)

Para pares correlacionados como WETH/SOL ou JLP/SOL, a estratégia se beneficia de faixas de preço estreitas para maximizar a eficiência do capital e a coleta de taxas. A definição da faixa inicial pode ser:

*   **Faixa Estática:** Um percentual fixo acima e abaixo do preço atual (ex: ±0.5%, ±1%). Simples de implementar, mas pode exigir ajustes manuais se a volatilidade mudar.
*   **Faixa Dinâmica (Baseada em Volatilidade):** Calculada com base na volatilidade histórica do par (ex: desvio padrão do preço nos últimos X períodos). Isso permite que a faixa se adapte às condições de mercado.

**Exemplo:** Se o preço atual for `P`, e a faixa for `±X%`, a faixa será `[P * (1 - X%), P * (1 + X%)]`.

### 3.2. Gatilhos de Re-range (Re-ranging Triggers)

O bot precisará monitorar o preço do par e reagir quando ele sair da faixa de liquidez ativa. Os principais gatilhos são:

*   **Preço Fora da Faixa (Price Out of Range):**
    *   **Gatilho:** O preço atual do par ultrapassa o limite superior ou inferior da faixa de liquidez ativa.
    *   **Ação:** Fechar a posição atual e reabrir uma nova posição com uma faixa centrada no novo preço atual.
*   **Tempo (Time-based Re-range):**
    *   **Gatilho:** Um período de tempo predefinido (ex: 24 horas, 48 horas) decorreu desde a última abertura/rebalanceamento da posição.
    *   **Ação:** Reavaliar a posição. Mesmo que o preço ainda esteja dentro da faixa, pode ser benéfico fechar e reabrir para coletar taxas acumuladas e ajustar a faixa para o preço atual, otimizando a eficiência do capital.
*   **Acúmulo de Taxas (Fee Accumulation):**
    *   **Gatilho:** As taxas acumuladas na posição atingem um determinado valor ou percentual do capital total.
    *   **Ação:** Fechar a posição para coletar as taxas e reabrir imediatamente. Isso garante que as taxas sejam realizadas e reinvestidas (se desejado) ou protegidas.

### 3.3. Lógica de Fechamento e Reabertura

Quando um gatilho de re-range é ativado, o bot seguirá este fluxo:

1.  **Fechamento da Posição:**
    *   Remover toda a liquidez da posição atual na Orca Whirlpool.
    *   Coletar todas as taxas e recompensas pendentes.
    *   Os tokens resultantes (Token A e Token B) serão depositados de volta na carteira do bot.
2.  **Determinação da Nova Faixa:**
    *   Obter o preço atual do par no momento do fechamento.
    *   Calcular a nova faixa de preço (superior e inferior) com base no preço atual e na lógica de definição de faixa (estática ou dinâmica).
3.  **Abertura da Nova Posição:**
    *   Depositar os tokens (Token A e Token B) na nova faixa de preço definida na Orca Whirlpool.
    *   É crucial que o bot tenha a quantidade correta de ambos os tokens para abrir a nova posição, o que pode exigir um swap mínimo se a proporção dos tokens mudou significativamente devido à IL ou ao rebalanceamento.

### 3.4. Parâmetros Configuráveis da Estratégia

Para flexibilidade e otimização, os seguintes parâmetros devem ser configuráveis:

*   **Pares de Ativos:** WETH/SOL, JLP/SOL, etc.
*   **Largura da Faixa:** Percentual (ex: 0.5%, 1%, 2%) ou método de cálculo (ex: desvio padrão).
*   **Frequência de Re-range por Tempo:** Intervalo em horas/dias para reavaliar a posição.
*   **Limiar de Taxas:** Valor mínimo de taxas acumuladas para acionar um re-range.
*   **Tolerância de Slippage:** Percentual máximo de slippage aceitável durante swaps internos (se necessário) ou ao adicionar/remover liquidez.

---

## 4. Fase 3: Mapeamento do Fluxo de Execução

Esta fase detalha o fluxo operacional do bot, desde a inicialização até o ciclo contínuo de monitoramento, rebalanceamento e gerenciamento de posições de liquidez concentrada na Orca.

### 4.1. Inicialização do Bot

1.  **Carregar Configurações:** O bot lê as configurações do arquivo `config.py` ou variáveis de ambiente, incluindo:
    *   Chave privada da carteira (seguramente carregada).
    *   Endpoint RPC da Solana.
    *   Pares de tokens a serem gerenciados (ex: WETH/SOL, JLP/SOL).
    *   Parâmetros da estratégia (largura da faixa, gatilhos de re-range, etc.).
2.  **Conectar à Solana e Orca:** Estabelece conexão com o nó RPC da Solana e inicializa o Orca Whirlpools SDK.
3.  **Verificar Posições Existentes:** O bot verifica se já existem posições de liquidez ativas para os pares configurados. Se sim, ele as carrega para monitoramento.

### 4.2. Ciclo Principal de Operação (Loop Contínuo)

O bot opera em um loop contínuo, executando as seguintes etapas em intervalos regulares (configuráveis):

#### 4.2.1. Monitoramento de Preços e Posições

1.  **Obter Preço Atual:** Consulta o preço atual de cada par de tokens (via oráculo on-chain ou API de dados de mercado).
2.  **Verificar Posições Ativas:** Para cada par, o bot verifica o estado de suas posições de liquidez ativas na Orca:
    *   **Preço Fora da Faixa:** O preço atual está fora da faixa de liquidez configurada para a posição?
    *   **Taxas Acumuladas:** As taxas e recompensas acumuladas atingiram o limiar de re-range?
    *   **Tempo de Posição:** O tempo desde a última abertura/rebalanceamento excedeu o limite configurado?

#### 4.2.2. Execução da Estratégia de Re-range

Se qualquer um dos gatilhos de re-range for ativado para uma posição, o bot inicia o processo de rebalanceamento:

1.  **Fechamento da Posição Atual:**
    *   Envia uma transação para a Orca para remover toda a liquidez da posição.
    *   Coleta todas as taxas e recompensas pendentes para a carteira do bot.
    *   Confirma que a transação foi bem-sucedida e que os tokens foram retornados à carteira.
2.  **Cálculo da Nova Faixa:**
    *   Com base no preço atual do par e nos parâmetros da estratégia (largura da faixa), calcula os novos limites superior e inferior para a próxima posição.
3.  **Abertura da Nova Posição:**
    *   Verifica o balanço de tokens na carteira para garantir que há tokens suficientes para a nova posição.
    *   Se necessário, executa um swap mínimo para ajustar a proporção dos tokens para a nova faixa (considerando a tolerância de slippage).
    *   Envia uma transação para a Orca para depositar liquidez na nova faixa de preço calculada.
    *   Confirma que a transação foi bem-sucedida e que a nova posição foi criada.

### 4.3. Tratamento de Erros e Logs

1.  **Registro de Eventos:** Todas as ações (abertura, fechamento, re-range, erros) são registradas em um arquivo de log ou sistema de monitoramento.
2.  **Notificações:** Em caso de erros críticos (ex: falha na transação, saldo insuficiente), o bot pode enviar notificações (ex: Telegram, Discord, e-mail) ao operador.
3.  **Mecanismos de Retentativa:** Implementar lógica de retentativa para transações que falham devido a congestionamento da rede ou outros problemas temporários.

### 4.4. Diagrama de Fluxo Simplificado

```mermaid
graph TD
    A[Iniciar Bot] --> B{Carregar Configurações & Conectar RPC/Orca}
    B --> C[Verificar Posições Existentes]
    C --> D(Loop Principal)

    D --> E[Monitorar Preços & Posições]
    E --> F{Gatilho de Re-range Ativado?}

    F -- Sim --> G[Fechar Posição Atual]
    G --> H[Calcular Nova Faixa]
    H --> I[Ajustar Tokens (se necessário)]
    I --> J[Abrir Nova Posição]
    J --> K[Registrar & Notificar]
    K --> D

    F -- Não --> D

    J -- Falha --> L[Tratar Erro & Retentar]
    L --> K
```

---

## 5. Fase 4: Gestão de Riscos e Controle de Custos

Esta fase aborda os mecanismos para mitigar riscos e controlar os custos operacionais do bot de liquidez concentrada, garantindo a sustentabilidade e rentabilidade da estratégia.

### 5.1. Controle de Slippage

O slippage (derrapagem) ocorre quando o preço de execução de uma ordem é diferente do preço esperado, especialmente em mercados voláteis ou com baixa liquidez. Para o bot, o slippage pode impactar as operações de swap necessárias para rebalancear tokens antes de abrir uma nova posição.

*   **Tolerância de Slippage Configurável:** O bot deve permitir a configuração de uma tolerância máxima de slippage (ex: 0.1%, 0.5%). Se o slippage estimado para um swap exceder esse limite, a transação deve ser abortada ou adiada.
*   **Simulação de Swaps:** Antes de executar um swap, o bot deve simular a transação para estimar o slippage e o impacto no preço. O Orca SDK e as APIs da Solana permitem a simulação de transações.
*   **Execução Condicional:** Apenas execute swaps se o impacto no preço for aceitável, considerando o potencial ganho com as taxas da nova posição.

### 5.2. Gerenciamento de Priority Fees (Taxas de Prioridade)

Na Solana, além da taxa base, é possível pagar uma "priority fee" para aumentar a chance de uma transação ser processada rapidamente, especialmente em momentos de congestionamento da rede. Para um bot que precisa de reações rápidas, isso é crucial.

*   **Estimativa Dinâmica:** O bot deve ser capaz de estimar a priority fee ideal com base nas condições atuais da rede (congestionamento, demanda por blocos). Provedores de RPC como Helius oferecem APIs para estimar essas taxas.
*   **Configuração de Limites:** Definir um limite máximo para a priority fee que o bot está disposto a pagar, evitando gastos excessivos em momentos de pico.
*   **Priorização de Transações:** Em situações críticas (ex: preço saindo rapidamente da faixa), o bot pode optar por pagar uma priority fee mais alta para garantir a execução.

### 5.3. Monitoramento de Saldo e Alertas

É fundamental monitorar o saldo da carteira do bot para evitar falhas em transações e garantir que há fundos suficientes para taxas e para a liquidez.

*   **Alertas de Saldo Baixo:** O bot deve enviar alertas (e-mail, Telegram) se o saldo de SOL (para taxas) ou dos tokens do par cair abaixo de um limite predefinido.
*   **Verificação Pré-Transação:** Antes de cada transação (abrir/fechar posição, swap), o bot deve verificar se há saldo suficiente para cobrir a operação e as taxas.

### 5.4. Perda Impermanente (Impermanent Loss - IL)

Embora a estratégia foque em pares correlacionados para minimizar a IL, ela ainda é um risco inerente à provisão de liquidez.

*   **Cálculo e Monitoramento:** O bot deve calcular e monitorar a IL da posição ativa. Isso pode ser feito comparando o valor atual da posição com o valor que os tokens teriam se tivessem sido simplesmente mantidos (HODL).
*   **Gatilhos de Saída por IL:** Em cenários extremos, se a IL atingir um nível inaceitável, o bot pode ser configurado para fechar a posição e aguardar condições de mercado mais favoráveis, mesmo que o preço ainda esteja dentro da faixa.

### 5.5. Segurança da Chave Privada

Conforme mencionado na Fase 1, a segurança da chave privada é crítica.

*   **Ambiente Isolado:** O bot deve ser executado em um ambiente seguro e isolado (ex: servidor virtual privado, contêiner Docker) com acesso restrito.
*   **Variáveis de Ambiente:** Nunca hardcode a chave privada. Use variáveis de ambiente ou um gerenciador de segredos.
*   **Permissões Mínimas:** A carteira do bot deve ter apenas as permissões necessárias para interagir com os programas da Orca e Solana, e não deve ser usada para outras finalidades.

### 5.6. Logging e Auditoria

Manter registros detalhados de todas as operações é essencial para depuração, análise de desempenho e auditoria.

*   **Logs Detalhados:** Registrar timestamps, transações enviadas, status de execução, preços, faixas de liquidez, taxas coletadas e quaisquer erros.
*   **Análise Pós-Operação:** Usar os logs para analisar o desempenho da estratégia, identificar gargalos e otimizar parâmetros.

---

## 6. Referências

*   [1] Orca Whirlpools SDK Documentation: [https://dev.orca.so/ts/](https://dev.orca.so/ts/)
*   [2] Solana Web3.js: [https://solana-labs.github.io/solana-web3.js/](https://solana-labs.github.io/solana-web3.js/)
*   [3] Solana Python SDK: [https://pypi.org/project/solana/](https://pypi.org/project/solana/)
*   [4] Understanding Solana Transaction Fees: [https://solana.com/learn/understanding-solana-transaction-fees](https://solana.com/learn/understanding-solana-transaction-fees)
*   [5] Mastering Concentrated Liquidity (V3) Pools. Making Profit While Providing Liquidity | by Brokkr Finance: [https://medium.com/brokkrfinance/mastering-concentrated-liquidity-v3-pools-with-smart-algo-strategies-ca967d320791](https://medium.com/brokkrfinance/mastering-concentrated-liquidity-v3-pools-with-smart-algo-strategies-ca967d320791)
*   [6] Orca Whirlpools Brings Concentrated Liquidity to Solana: [https://blockworks.co/news/orca-whirlpools-brings-concentrated-liquidity-to-solana](https://blockworks.co/news/orca-whirlpools-brings-concentrated-liquidity-to-solana)
*   [7] Orca Developers Overview: [https://docs.orca.so/developers/overview](https://docs.orca.so/developers/overview)
