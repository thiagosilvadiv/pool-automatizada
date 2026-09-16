# Arquitetura

Documento de referência para quem vai ler ou mexer no código. Visão geral do sistema em
[`README.md`](../README.md).

## Visão geral

```
                    ┌──────────────────────────────────────────┐
  navegador ──HTTP──│ src/server.ts   (Express + Basic Auth)    │
                    │  ~40 rotas /api/*  +  public/ (painel)    │
                    └───────────────┬──────────────────────────┘
                                    │
                    ┌───────────────▼──────────────────────────┐
                    │ src/pool-manager.ts                       │
                    │  N pools, seleção, start/stop, agregação   │
                    └───────────────┬──────────────────────────┘
                                    │  1 BotRunner por pool
                    ┌───────────────▼──────────────────────────┐
                    │ src/runner.ts   (BotRunner.tickOnce)      │
                    └───┬───────────────┬──────────────┬────────┘
                        │               │              │
              ┌─────────▼────┐  ┌───────▼──────┐  ┌────▼─────────┐
              │ src/orca.ts  │  │ strategy.ts  │  │ storage.ts   │
              │ Whirlpool +  │  │ faixa/saída  │  │ redis.ts     │
              │ Kamino + swap│  └──────────────┘  └──────────────┘
              └──┬────────┬──┘
                 │        └──────────────┐
        ┌────────▼───────┐      ┌────────▼──────────────────────┐
        │ kamino-client  │      │ kamino-{math,health,lock,     │
        │ (klend-sdk)    │      │  close-policy,reopen-policy,  │
        └────────────────┘      │  split-repay,utils,types}     │
                                └───────────────────────────────┘

  Serviços externos: RPC Solana · Orca Whirlpools SDK · Kamino klend/kswap SDK ·
                     Jupiter (swap) · Pyth Hermes (preço) · GeckoTerminal (tendência) ·
                     Bybit (hedge) · Evolution API (WhatsApp) · Redis (persistência)
```

## Entrada

`src/index.ts` lê os argumentos (`--config`, `--ui`), carrega a configuração
(`src/config.ts`: arquivo, `CONFIG_JSON`, `CONFIG_PATH` ou variáveis individuais, com validação),
monta a conexão e a carteira (`src/solana.ts`) e sobe o modo headless ou a UI (`src/server.ts`).

## Camada de pools

**`src/pool-manager.ts`** mantém a lista de pools (`data/pools.json` ou Redis), qual está
selecionada, quais estão ativas, e cria um `BotRunner` por pool. Também roda tarefas periódicas
como o fechamento de contas de token vazias.

**`src/balance-coordinator.ts`** é o que impede duas pools de gastarem o mesmo saldo: cada pool
reserva o que precisa e as demais enxergam só o saldo livre.

## Ciclo de vida de uma posição

1. `tickOnce()` lê preço on-chain e preço de referência (Pyth).
2. `calculateRange()` (`src/strategy.ts`) produz a faixa alvo; `alignTickRangeToSpacing()`
   (`src/tick-range.ts`) ajusta aos ticks válidos da Orca.
3. Se não há posição: equilibra os tokens (swap via Jupiter/kswap) e abre.
4. Se há posição dentro da faixa: atualiza status, PnL e histórico.
5. Se está fora da faixa por `outOfRangeConfirmSec` e o cooldown passou: fecha.
6. Após fechar, decide entre **reabrir direto** (PnL ≥ 0) ou **iniciar o ciclo Kamino** (PnL < 0,
   `shouldUseKaminoAfterClose`).
7. Cada transição vira um evento no histórico (`open-position`, `resume-position`,
   `close-position`, `rebalanced`, …) em `data/history-<poolId>.json` ou Redis.

## Ciclo de vida de um empréstimo Kamino

```
PnL de fechamento < 0
   └─ tryAcquireKaminoLock()            src/kamino-lock.ts
        ├─ escolhe colateral            kaminoCollateralMode
        ├─ depositCollateral()          src/kamino-client.ts
        ├─ borrow() respeitando LTV     kaminoMaxLtv
        ├─ reabre a pool com o valor emprestado
        ├─ loop de manutenção:
        │    ├─ health/LTV              src/kamino-health.ts
        │    ├─ alvo atingido?          src/kamino-close-policy.ts (kaminoCloseRule)
        │    ├─ repay em chunks         src/kamino-math.ts / kamino-split-repay.ts
        │    └─ sem saldo → alerta      src/evolution-notify.ts
        ├─ withdraw do colateral
        └─ releaseKaminoLock()
```

Casos especiais tratados no código:

- **Reconstrução**: um empréstimo encontrado on-chain sem histórico local é reconstruído a partir
  do estado do market (`entrySource: "reconstructed"`).
- **Fechamento parcial**: no modo `both`, colaterais que atingiram o alvo são liquidados sozinhos.
- **Grace period** (`kaminoGracePeriodSec`): não fecha o ciclo logo depois de reabrir a pool.
- **Ciclo preso**: repay falhando por mais de 2 horas → log de `stuck` e espera intervenção.
- **Reabertura com saldo da carteira**: `kaminoUseWalletBalanceOnReopen` inclui o saldo livre ao
  reabrir, respeitando `budgetUsd`, reservas de outras pools e `minSolBalance`
  (`src/kamino-reopen-policy.ts`).

## Módulos auxiliares

| Arquivo | Papel |
|---|---|
| `src/auto-add-policy.ts` | Quando adicionar liquidez automaticamente e o mínimo em USD |
| `src/kswap-utils.ts` | Helpers de swap via SDK da Kamino |
| `src/retry.ts` | Retentativa com backoff (RPC e rate limit) |
| `src/logger.ts` | Logger pino e serialização de erros |
| `src/trend.ts` | Tendência via GeckoTerminal, com timeframe e validade |
| `src/hedge.ts` / `src/bybit.ts` | Abertura/fechamento de hedge em perpétuo |
| `src/types/*.d.ts` | Tipagens complementares de SDKs sem tipos |

## Persistência

Sem `REDIS_URL`, tudo vai para `data/` (ignorado pelo git): `pools.json`,
`history-<poolId>.json`, `history.json` e o estado dos markets do Kamino. Com `REDIS_URL`
(+ `REDIS_PREFIX`), os mesmos dados vão para o Redis e sobrevivem à recriação do container —
recomendado em deploy.

## Testes

`tests/` (vitest, `npm test`) cobre principalmente a lógica pura de decisão: faixas e estratégia,
matemática do Kamino, políticas de fechamento/reabertura, repay parcial e capacidade, auto-add,
seleção de chunks, analytics e a API de pools. Os caminhos que assinam transação não são
exercitados — valide mudanças com `dryRun: true`.
