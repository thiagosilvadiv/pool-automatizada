# Pool Automatizada

Bot de **liquidez concentrada** para [Orca Whirlpools](https://www.orca.so/) na Solana, com
re-range automático, painel web de controle e um ciclo opcional de **empréstimo no Kamino Lend**
usado para evitar a realização de perdas em um rebalanceamento.

> ⚠️ **AVISO DE RISCO — LEIA ANTES DE USAR**
>
> Este é um software **experimental**, em desenvolvimento contínuo, que movimenta fundos reais
> na blockchain de forma automática. Ele pode abrir e fechar posições, fazer swaps, tomar
> empréstimos e pagar dívidas **sem confirmação humana**.
>
> Você pode perder **todo o capital aplicado** — por impermanent loss, slippage, falha de RPC,
> bug no código, mudança de API dos SDKs ou **liquidação da sua posição no Kamino**.
>
> Não há garantia de nenhum tipo. Não é conselho financeiro. Use por sua conta e risco,
> preferencialmente com uma carteira dedicada e um valor que você aceita perder por inteiro.
> Comece sempre com `dryRun: true`.

---

## Índice

- [Para que serve](#para-que-serve)
- [Como funciona a pool](#como-funciona-a-pool)
- [Range assimétrico por valor](#range-assimétrico-por-valor)
- [O ciclo Kamino](#o-ciclo-kamino)
- [Interface web](#interface-web)
- [Instalação](#instalação)
- [Configuração](#configuração)
- [Segurança operacional](#segurança-operacional)
- [Testes](#testes)
- [Estado do projeto e limitações](#estado-do-projeto-e-limitações)
- [Licença](#licença)

---

## Para que serve

Em uma pool de liquidez concentrada, você só ganha taxas enquanto o preço do par estiver **dentro
da faixa** que você escolheu. Quando o preço sai da faixa, a posição para de render e fica 100%
convertida no token do lado "perdedor". Manter isso manualmente exige acompanhar o preço o dia
inteiro e refazer a posição toda vez.

Este bot automatiza esse trabalho:

1. **Mantém o capital sempre dentro da faixa produtiva** — detecta a saída da faixa, fecha a
   posição, reequilibra os tokens e reabre em torno do preço atual.
2. **Escolhe a faixa de forma assimétrica** para que o prejuízo na saída seja igual (ou menor)
   que o lucro no lado oposto, no token que você escolheu como referência.
3. **Evita realizar a perda quando o rebalanceamento sai negativo** — em vez de vender o token
   desvalorizado, deposita ele como colateral no Kamino, toma emprestado um stable e continua
   operando, desfazendo o empréstimo quando o preço volta ao seu preço médio.
4. **Opera várias pools ao mesmo tempo**, coordenando o saldo da carteira entre elas.

## Como funciona a pool

O laço principal é `BotRunner.tickOnce()` em `src/runner.ts`, executado a cada `pollIntervalMs`
(padrão 30s):

```
tick
 ├─ lê preço on-chain do Whirlpool (src/orca.ts) + preço SOL/USD da Pyth (src/pyth.ts)
 ├─ calcula a faixa alvo (src/strategy.ts → calculateRange)
 ├─ posição dentro da faixa?
 │    sim → registra estado, coleta taxas, segue
 │    não → conta o tempo fora (outOfRangeConfirmSec)
 │            └─ confirmado e fora do cooldown (rebalanceCooldownSec)?
 │                 ├─ fecha a posição
 │                 ├─ PnL do fechamento foi negativo e Kamino está ligado?
 │                 │     sim → inicia o ciclo Kamino (ver abaixo)
 │                 │     não → swap do excedente e reabre na nova faixa
 │                 └─ grava o evento no histórico (src/storage.ts)
 └─ opcional: auto-add de liquidez, hedge na Bybit, leitura de tendência
```

Módulos envolvidos:

| Módulo | Responsabilidade |
|---|---|
| `src/runner.ts` | Laço de uma pool: tick, rebalance, histórico, ações manuais |
| `src/pool-manager.ts` | Orquestra várias pools, seleção, start/stop, estado agregado |
| `src/orca.ts` | Toda a interação com o Whirlpool: abrir, fechar, swap, ciclo Kamino |
| `src/strategy.ts` | Cálculo da faixa e da preferência de saída |
| `src/balance-coordinator.ts` | Reserva de saldo por pool para elas não competirem pela carteira |
| `src/pyth.ts` | Preço SOL/USD via Pyth Hermes |
| `src/trend.ts` | Sinal de tendência via GeckoTerminal (opcional) |
| `src/hedge.ts` / `src/bybit.ts` | Hedge da posição em perpétuo na Bybit (opcional) |
| `src/storage.ts` / `src/redis.ts` | Persistência de pools e histórico (arquivo ou Redis) |
| `src/server.ts` | API HTTP e painel web |

## Range assimétrico por valor

Numa faixa simétrica (`±1%`), sair por baixo e sair por cima **não** dão o mesmo resultado
medido em um dos tokens. O bot corrige isso: você escolhe o token de referência
(`preferredExitToken`) e a direção preferida de saída (`preferredExitDirection`), o lado preferido
é fixado por `rangeWidthPct` e o lado oposto é resolvido por bisseção até que a magnitude do PnL
se iguale.

O `rangeExitBiasPct` reduz **apenas o lado negativo**: com `RANGE_EXIT_BIAS_PCT=10`, a perda fica
~10% menor que o ganho equivalente.

A derivação completa está em [`docs/estrategia-range-assimetrico.txt`](docs/estrategia-range-assimetrico.txt);
a implementação em `src/strategy.ts` e o alinhamento ao tick spacing da Orca em `src/tick-range.ts`.

## O ciclo Kamino

Esta é a parte central e a mais delicada do sistema. Ela existe para responder a uma pergunta:
**o que fazer quando o rebalanceamento fecharia a posição no prejuízo?**

Sem o ciclo, o bot venderia o token desvalorizado e realizaria a perda. Com o ciclo ligado
(`kaminoRebalanceEnabled`), quando o PnL do fechamento (sem taxas) é negativo
(`shouldUseKaminoAfterClose` em `src/kamino-close-policy.ts`), acontece o seguinte:

1. **Depósito de colateral** — o token que ficou em mãos é depositado no Kamino em vez de
   vendido. Qual token vai como colateral depende de `kaminoCollateralMode`:
   `exit` (o token da saída), `max-value` (o de maior valor em USD), `tokenA`, `tokenB`
   ou `both` (os dois).
2. **Empréstimo** — o bot toma emprestado `kaminoBorrowAsset` (padrão USDC) respeitando
   `kaminoMaxLtv` (padrão `0.4`, ou seja 40% do valor do colateral) — bem abaixo do limite de
   liquidação, para dar folga a quedas de preço.
3. **Volta para a pool** — o valor emprestado é reaplicado na pool, que continua gerando taxas
   enquanto a perda **não foi realizada**.
4. **Monitoramento** — `src/kamino-health.ts` acompanha o LTV e a saúde da obrigação a cada
   `kaminoScanIntervalSec`.
5. **Fechamento** — o ciclo só fecha quando o preço do colateral atinge o alvo, conforme
   `kaminoCloseRule`:
   - `avg-price`: alvo = preço-alvo calculado a partir do preço médio de entrada acumulado
     (`kaminoAvgMode`, `kaminoAvgPriceBasis`);
   - `breakeven`: alvo = o próprio preço médio do colateral;
   - `manual`: só fecha por comando seu no painel.
   Cada colateral é avaliado individualmente; se só parte atingiu o alvo, o bot faz fechamento
   parcial. Há uma salvaguarda que **bloqueia** o fechamento se o alvo calculado ficar abaixo de
   60% do preço atual nos primeiros 5 minutos do ciclo — sintoma de preço médio mal calculado.
6. **Repagamento** — a dívida é paga em pedaços, com tamanho calculado por risco
   (`computeRiskAwareRepayChunk` em `src/kamino-math.ts`), com repay direto ou usando o próprio
   colateral (`repayWithCollateral`, `src/kamino-split-repay.ts`), com retentativas
   (`kaminoRepayRetrySec`, `kaminoRepayMaxAttempts`).
7. **Se faltar saldo para quitar** — o bot **não** força a operação: registra o estado e envia um
   alerta por WhatsApp via Evolution API (`src/evolution-notify.ts`) dizendo exatamente quanto
   falta e para qual carteira enviar. Assim que o saldo aparece, ele conclui sozinho. Se o repay
   falhar por mais de 2 horas, o ciclo é marcado como **preso** e pede intervenção manual.

Proteções adicionais: `kaminoGracePeriodSec` impede fechar o ciclo logo após reabrir a pool
(evita loop de abre/fecha); `src/kamino-lock.ts` garante que só uma pool mexe no Kamino por vez;
e ciclos existentes na blockchain sem histórico local são **reconstruídos** a partir do estado
on-chain do market.

> ⚠️ **Risco específico**: enquanto o empréstimo está aberto, uma queda forte do colateral pode
> levar à **liquidação** pelo Kamino — que realiza uma perda maior do que a que se queria evitar.
> O `kaminoMaxLtv` conservador reduz essa chance, mas não a elimina.

## Interface web

`npm run start:ui` sobe um painel em `http://localhost:3000` (`src/server.ts`, arquivos em
`public/`):

- **`index.html`** — status das pools, faixa atual, saldos, start/stop, fechar, rebalancear,
  adicionar liquidez, ações do Kamino e log do ciclo.
- **`analytics.html`** — histórico e métricas de PnL (`public/analytics-metrics.js`).
- **`kamino-markets.html`** — cadastro dos markets do Kamino usados pelo bot.
- **`allowlist.html`** — lista de mints permitidos em swaps (lista vazia = tudo permitido).

A API expõe cerca de 40 rotas sob `/api/*` (pools, status, histórico, Kamino, swaps, config).

## Instalação

Requisitos: **Node.js 18+**, um **RPC dedicado** (RPC público não aguenta o ritmo do bot) e uma
carteira Solana com SOL para taxas.

```bash
npm install
cp .env.example .env      # preencha os segredos
cp config.example.json config.json
npm run dev -- --config config.json --ui     # desenvolvimento
```

Produção:

```bash
npm run build
npm run start -- --config config.json
```

Docker (o `Dockerfile` é um build multi-stage pronto para Easypanel):

```bash
docker build -t pool-automatizada .
docker run -p 3000:3000 --env-file .env pool-automatizada
```

## Configuração

A configuração pode vir de um `config.json`, de `CONFIG_JSON`/`CONFIG_PATH`, ou de variáveis de
ambiente individuais — veja `.env.example` e `config.example.json`. Validação e defaults ficam em
`src/config.ts`.

**Carteira** (escolha uma): `WALLET_PRIVATE_KEY` (base58 ou array JSON) **ou**
`WALLET_KEYPAIR_PATH` (arquivo montado no container).

**Principais parâmetros da pool**

| Campo | O que faz |
|---|---|
| `rpcUrl` / `network` | Endpoint RPC e rede (`mainnet-beta`) |
| `whirlpoolAddress` | Whirlpool alvo |
| `rangeWidthPct` | Largura da faixa (`1` = ±1%) |
| `rangeExitBiasPct` | Reduz só o PnL negativo, em % |
| `preferredExitToken` / `preferredExitDirection` | Token de referência e lado preferido da saída |
| `slippageBps` | Slippage máximo (`50` = 0,50%) |
| `pollIntervalMs` | Intervalo do tick |
| `outOfRangeConfirmSec` | Tempo fora da faixa antes de rebalancear |
| `rebalanceCooldownSec` | Intervalo mínimo entre rebalanceamentos |
| `budgetUsd` | Teto de capital alocado na posição |
| `minSolBalance` | SOL reservado para taxas |
| `dryRun` | Simula sem enviar transações |

**Principais parâmetros do Kamino**

| Campo | O que faz |
|---|---|
| `kaminoRebalanceEnabled` | Liga o ciclo de empréstimo |
| `kaminoBorrowAsset` | Ativo tomado emprestado (padrão `usdc`) |
| `kaminoMaxLtv` | LTV máximo (padrão `0.4`) |
| `kaminoCollateralMode` | `exit`, `max-value`, `tokenA`, `tokenB`, `both` |
| `kaminoCloseRule` | `avg-price`, `breakeven`, `manual` |
| `kaminoAvgMode` / `kaminoAvgPriceBasis` | Como o preço médio é acumulado |
| `kaminoScanIntervalSec` | Intervalo das leituras on-chain |
| `kaminoGracePeriodSec` | Carência antes de permitir fechar o ciclo |
| `kaminoRepayRetrySec` / `kaminoRepayMaxAttempts` | Política de retentativa do repay |

**Integrações opcionais**: `REDIS_URL` (persistência entre reinícios), `PYTH_SOL_USD_FEED_ID`,
`JUPITER_API_KEY`, `HEDGE_ENABLED` + `BYBIT_API_KEY`/`BYBIT_API_SECRET`, `trendEnabled`
(GeckoTerminal), e as variáveis da Evolution API para alertas no WhatsApp.

## Segurança operacional

- **Sempre defina `UI_USER` e `UI_PASS`.** Sem essas duas variáveis o Basic Auth **fica
  desligado** (`src/server.ts`) e qualquer pessoa que alcance a porta 3000 pode fechar posições,
  mexer no empréstimo e disparar swaps na sua carteira.
- **Não exponha a porta 3000 na internet aberta.** Use rede privada, VPN ou um proxy com TLS.
- **Nunca commite `config.json` nem `.env`** — o `rpcUrl` normalmente carrega a chave do seu RPC.
  Ambos já estão no `.gitignore`.
- **Use uma carteira dedicada**, só com o capital da operação. A chave privada fica em memória no
  processo e assina transações sem confirmação.
- `data/` guarda histórico real das suas posições (incluindo o mint da posição, que é rastreável
  na blockchain). Está no `.gitignore` — mantenha assim.

## Testes

```bash
npm test          # vitest, 24 suítes
npm run build     # typecheck + build
```

Os testes cobrem a matemática da estratégia, faixas, políticas do Kamino (fechamento, reabertura,
repay parcial, capacidade, saúde), auto-add, seleção de chunks, analytics e a API de pools.

## Estado do projeto e limitações

Projeto em evolução, escrito e ajustado em cima da operação real. O que você precisa saber antes
de usar ou contribuir:

- **Isto sempre precisa de ajuste.** Não existe configuração universal: `rangeWidthPct`,
  `rangeExitBiasPct`, `kaminoMaxLtv` e os intervalos precisam ser calibrados por par de tokens e
  por regime de mercado. Uma configuração que funciona num mercado lateral pode ser péssima numa
  tendência forte.
- **`src/orca.ts` tem ~11 mil linhas** e concentra pool + Kamino + swaps. A extração dos módulos
  `kamino-*.ts` (`math`, `health`, `close-policy`, `reopen-policy`, `split-repay`, `utils`) já
  começou esse trabalho, e ele deve continuar.
- **Hedge na Bybit e sinal de tendência (GeckoTerminal) são experimentais** e ficam desligados por
  padrão.
- **Os testes não cobrem o caminho de transação real** — eles validam a lógica de decisão, não o
  envio on-chain. Valide mudanças com `dryRun: true` antes de operar com valor.
- **Dependência de SDKs de terceiros** (Orca, Kamino, Jupiter): mudanças de API quebram fluxos;
  ajustes costumam cair em `src/orca.ts` e `src/kamino-client.ts`.
- **Sem controle de acesso por usuário** — o Basic Auth é único e global.
- Parte dos comentários e mensagens está em português, parte em inglês; a padronização está
  pendente.

Sugestões e issues são bem-vindas. Se for reportar um comportamento estranho, inclua a
configuração usada (**sem segredos**) e o trecho relevante do log do ciclo.

## Licença

[MIT](LICENSE).
