# Orca Liquidity Bot (MVP)

Bot de liquidez concentrada para Orca Whirlpools na Solana, com re-range automático quando o preço sai da faixa.

## Requisitos

- Node.js 18+
- RPC endpoint dedicado
- Carteira com SOL para taxas

## Setup

1. Instale dependências:

```bash
npm install
```

2. Crie seu arquivo de configuração:

```bash
copy config.example.json config.json
```

3. Configure segredos:

```bash
copy .env.example .env
```

Preencha `WALLET_PRIVATE_KEY` (base58 ou JSON array) ou `WALLET_KEYPAIR_PATH`.

## Rodar (dry-run)

```bash
npm run dev -- --config config.json
```

Para rodar em produção:

```bash
npm run build
npm run start -- --config config.json
```

## Interface Web (opcional)

Para usar a interface web local:

```bash
npm run dev -- --config config.json --ui
```

Abra `http://localhost:3000` no navegador.

### Autenticação da UI (opcional)

Defina `UI_USER` e `UI_PASS` para proteger a interface com HTTP Basic Auth.
Quando ambos estiverem definidos, o navegador pedirá usuário e senha antes de carregar a UI.

Exemplo:

```bash
UI_USER=admin UI_PASS=secret npm run dev -- --config config.json --ui
```

### Configuração via ENV (opcional)

Você pode rodar sem `config.json` usando variáveis de ambiente:

- `CONFIG_JSON`: JSON completo do config
- `CONFIG_PATH`: caminho para um arquivo de config dentro do container
- ou variáveis individuais (ex.: `RPC_URL`, `WHIRLPOOL_ADDRESS`, `RANGE_WIDTH_PCT`, etc.)

Exemplo (com JSON):

```bash
CONFIG_JSON='{"network":"mainnet-beta","rpcUrl":"https://...","whirlpoolAddress":"...","rangeWidthPct":1,"slippageBps":50,"pollIntervalMs":30000}'
npm run dev -- --ui
```

### Persistência com Redis (opcional)

Para não perder pools e histórico após reiniciar o container, defina `REDIS_URL`.
O bot usa Redis para armazenar:

- lista de pools cadastradas
- pool selecionada
- histórico por pool

Exemplo:

```bash
REDIS_URL=redis://:SENHA@host:6379
REDIS_PREFIX=orca-bot
```

## Observações importantes

- O bot depende do SDK oficial da Orca (`@orca-so/whirlpools-sdk`). Caso a API do SDK tenha diferenças na sua versão, ajuste as funções em `src/orca.ts`.
- O campo `whirlpoolAddress` deve apontar para o Whirlpool WETH/SOL correto.
- Use `dryRun: true` para validar fluxo sem enviar transações.

## Campos de configuração

- `network`: rede Solana (`mainnet-beta` recomendado)
- `rpcUrl`: endpoint RPC
- `whirlpoolAddress`: endereço do Whirlpool
- `rangeWidthPct`: largura da faixa (ex.: `1.0` = ±1%)
- `slippageBps`: slippage máximo em bps (ex.: `50` = 0,50%)
- `pollIntervalMs`: intervalo de verificação
- `outOfRangeConfirmSec`: tempo (segundos) que o preço deve ficar fora da faixa antes de re-range
- `rebalanceCooldownSec`: tempo (segundos) mínimo entre rebalances
- `dryRun`: não envia transações
- `minSolBalance`: SOL mínimo para taxas
- `maxTokenA`/`maxTokenB`: limites de aporte em unidades humanas (ou `null`)
- `rebalanceSwapPct`: fração do excesso a swapar quando falta um dos tokens (1.0 = ajuste completo)
- `positionMint`: se você já tem uma posição criada, pode informar o mint aqui para pular a varredura
- `budgetUsd`: orçamento em USD para limitar o valor alocado na posição (ou `null`)
- `pythSolUsdFeedId`: feed ID hex da Pyth (ex.: `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d`)
- `priceStaleMaxSec`: idade máxima (segundos) para o preço da Pyth
