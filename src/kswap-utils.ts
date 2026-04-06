import BN from "bn.js";
import type { KaminoReserve } from "@kamino-finance/klend-sdk";
import type {
  SwapInputs,
  SwapQuote,
  SwapIxs,
  SwapIxsProvider,
  SwapQuoteProvider
} from "@kamino-finance/klend-sdk";
import { KswapSdk, RouterContext } from "@kamino-finance/kswap-sdk";
import type { RouteOutput, RouteParams, RouterType, MintInfo } from "@kamino-finance/kswap-sdk";
import Decimal from "decimal.js";
import type { Address } from "@solana/kit";

// Roteadores permitidos pelo KSwap (conforme documentação Kamino)
const ALLOWED_ROUTERS: RouterType[] = ["metis", "titan", "dflow", "openOcean", "jupiterLite"];

export function getKswapQuoter(
  kswapSdk: KswapSdk,
  executor: Address,
  slippageBps: number,
  inputMintReserve: KaminoReserve,
  outputMintReserve: KaminoReserve
): SwapQuoteProvider<RouteOutput> {
  return async (inputs: SwapInputs): Promise<SwapQuote<RouteOutput>> => {
    const inMintInfo: MintInfo = {
      tokenProgramId: inputMintReserve.getLiquidityTokenProgram(),
      decimals: inputMintReserve.stats.decimals
    };
    const outMintInfo: MintInfo = {
      tokenProgramId: outputMintReserve.getLiquidityTokenProgram(),
      decimals: outputMintReserve.stats.decimals
    };
    const routerContext = new RouterContext(inMintInfo, outMintInfo);

    const routeParams: RouteParams = {
      executor,
      tokenIn: inputs.inputMint,
      tokenOut: inputs.outputMint,
      amount: new BN(inputs.inputAmountLamports.toDP(0).toString()),
      maxSlippageBps: slippageBps,
      wrapAndUnwrapSol: false,
      swapType: "exactIn",
      routerTypes: ALLOWED_ROUTERS,
      includeRfq: false,
      includeLimoLogs: false,
      withSimulation: true,
      filterFailedSimulations: false,
      timeoutMs: 30000,
      atLeastOneNoMoreThanTimeoutMS: 10000,
      preferredMaxAccounts: 10
    };

    const routeOutputs = await kswapSdk.getAllRoutes(routeParams, routerContext);
    if (routeOutputs.routes.length === 0) {
      throw new Error("Nenhuma rota KSwap encontrada para o par de tokens.");
    }

    // Selecionar melhor rota por preço (maior output garantido)
    const bestRoute = routeOutputs.routes.reduce((best, current) => {
      const outBest = new Decimal(best.amountsExactIn.amountOutGuaranteed.toString())
        .div(outputMintReserve.getMintFactor());
      const inBest = new Decimal(best.amountsExactIn.amountIn.toString())
        .div(inputMintReserve.getMintFactor());
      const outCurrent = new Decimal(current.amountsExactIn.amountOutGuaranteed.toString())
        .div(outputMintReserve.getMintFactor());
      const inCurrent = new Decimal(current.amountsExactIn.amountIn.toString())
        .div(inputMintReserve.getMintFactor());
      return outBest.div(inBest).greaterThan(outCurrent.div(inCurrent)) ? best : current;
    });

    const inAmount = new Decimal(bestRoute.amountsExactIn.amountIn.toString())
      .div(inputMintReserve.getMintFactor());
    const outAmount = new Decimal(bestRoute.amountsExactIn.amountOutGuaranteed.toString())
      .div(outputMintReserve.getMintFactor());

    return { priceAInB: outAmount.div(inAmount), quoteResponse: bestRoute };
  };
}

export function getKswapSwapper(
  kswapSdk: KswapSdk,
  executor: Address,
  slippageBps: number,
  inputMintReserve: KaminoReserve,
  outputMintReserve: KaminoReserve
): SwapIxsProvider<RouteOutput> {
  return async (inputs: SwapInputs): Promise<Array<SwapIxs<RouteOutput>>> => {
    const inMintInfo: MintInfo = {
      tokenProgramId: inputMintReserve.getLiquidityTokenProgram(),
      decimals: inputMintReserve.stats.decimals
    };
    const outMintInfo: MintInfo = {
      tokenProgramId: outputMintReserve.getLiquidityTokenProgram(),
      decimals: outputMintReserve.stats.decimals
    };
    const routerContext = new RouterContext(inMintInfo, outMintInfo);

    const routeParams: RouteParams = {
      executor,
      tokenIn: inputs.inputMint,
      tokenOut: inputs.outputMint,
      amount: new BN(inputs.inputAmountLamports.toString()),
      maxSlippageBps: slippageBps,
      wrapAndUnwrapSol: false,
      swapType: "exactIn",
      routerTypes: ALLOWED_ROUTERS,
      includeRfq: false,
      includeLimoLogs: false,
      withSimulation: true,
      filterFailedSimulations: false,
      timeoutMs: 30000,
      atLeastOneNoMoreThanTimeoutMS: 10000,
      preferredMaxAccounts: 10
    };

    const routeOutputs = await kswapSdk.getAllRoutes(routeParams, routerContext);
    if (routeOutputs.routes.length === 0) {
      throw new Error("Nenhuma rota KSwap encontrada no swapper.");
    }

    // Retornar TODAS as rotas para que getRepayWithCollIxs selecione a melhor
    // por tamanho de transação (conforme documentação Kamino)
    return routeOutputs.routes.map((routeOutput) => {
      const inAmt = new Decimal(routeOutput.amountsExactIn.amountIn.toString())
        .div(routeOutput.inputTokenDecimals || inputMintReserve.getMintFactor());
      const outAmt = new Decimal(routeOutput.amountsExactIn.amountOutGuaranteed.toString())
        .div(routeOutput.outputTokenDecimals || outputMintReserve.getMintFactor());

      return {
        preActionIxs: [],
        swapIxs: routeOutput.instructions?.swapIxs || [],
        lookupTables: routeOutput.lookupTableAccounts || [],
        quote: {
          priceAInB: outAmt.div(inAmt),
          quoteResponse: routeOutput,
          simulationResult: routeOutput.simulationResult,
          routerType: routeOutput.routerType
        }
      };
    });
  };
}
