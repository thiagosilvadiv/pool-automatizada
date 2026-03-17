import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, getMint, TOKEN_PROGRAM_ID, NATIVE_MINT } from "@solana/spl-token";
import DecimalJs from "decimal.js";
import * as whirlpoolsSdk from "@orca-so/whirlpools-sdk";
import * as commonSdk from "@orca-so/common-sdk";
import { logger } from "./logger.js";
import { calculateRange, isPriceOutOfRange } from "./strategy.js";
import { getSolUsdPrice } from "./pyth.js";
const whirlpools = whirlpoolsSdk;
const common = commonSdk;
const Decimal = DecimalJs;
export class OrcaBot {
    constructor(ctx, client, botCtx) {
        this.poolState = null;
        this.currentPosition = null;
        this.currentPositionMint = null;
        this.initialPortfolioValue = null;
        this.initialPortfolioValueSol = null;
        this.initialPositionValue = null;
        this.initialPositionValueSol = null;
        this.outOfRangeSince = null;
        this.lastStatus = {
            running: false,
            lastAction: null,
            lastError: null,
            lastPrice: null,
            solUsdPrice: null,
            budgetUsd: null,
            budgetSol: null,
            targetRange: null,
            positionRange: null,
            positionMint: null,
            solBalance: null,
            tokenABalance: null,
            tokenBBalance: null,
            positionTokenA: null,
            positionTokenB: null,
            portfolioValue: null,
            pnl: null,
            portfolioUsd: null,
            pnlUsd: null,
            positionValue: null,
            positionPnl: null,
            positionValueUsd: null,
            positionPnlUsd: null,
            lastOpenTokenA: null,
            lastOpenTokenB: null,
            lastCloseTokenA: null,
            lastCloseTokenB: null
        };
        this.ctx = ctx;
        this.client = client;
        this.connection = botCtx.connection;
        this.wallet = botCtx.wallet;
        this.config = botCtx.config;
    }
    static async create(botCtx) {
        const ctx = whirlpools.WhirlpoolContext.from(botCtx.connection, botCtx.wallet);
        const client = whirlpools.buildWhirlpoolClient(ctx);
        const bot = new OrcaBot(ctx, client, botCtx);
        await bot.refreshPoolState();
        await bot.loadExistingPosition();
        return bot;
    }
    async tick() {
        this.lastStatus.running = true;
        await this.refreshPoolState();
        const solBalance = (await this.connection.getBalance(this.wallet.publicKey)) / LAMPORTS_PER_SOL;
        this.lastStatus.solBalance = solBalance;
        if (solBalance < this.config.minSolBalance) {
            logger.warn({ solBalance }, "SOL balance below minSolBalance; skipping");
            this.lastStatus.lastAction = "skip-low-sol";
            return this.getStatus();
        }
        const price = await this.getCurrentPrice();
        const range = calculateRange(price, this.config.rangeWidthPct);
        this.lastStatus.lastPrice = price;
        this.lastStatus.targetRange = range;
        const solUsdPrice = await this.tryGetSolUsdPrice();
        this.lastStatus.solUsdPrice = solUsdPrice;
        this.lastStatus.budgetUsd = this.config.budgetUsd;
        this.lastStatus.budgetSol = solUsdPrice && this.config.budgetUsd
            ? this.config.budgetUsd / solUsdPrice
            : null;
        await this.updatePortfolioSnapshot(price, solUsdPrice);
        if (!this.currentPosition) {
            logger.info({ price, range }, "no active position found; opening new position");
            const result = await this.openPosition(range, price, solUsdPrice);
            this.lastStatus.lastAction = result;
            if (result === "open-position") {
                await this.updatePortfolioSnapshot(price, solUsdPrice);
            }
            this.lastStatus.positionMint = this.currentPositionMint;
            return this.getStatus();
        }
        const positionRange = await this.getPositionRange(this.currentPosition);
        if (!positionRange) {
            logger.warn("failed to read position range; reloading position");
            await this.loadExistingPosition();
            this.lastStatus.lastAction = "reload-position";
            this.lastStatus.positionRange = null;
            this.lastStatus.positionMint = this.currentPositionMint;
            return this.getStatus();
        }
        const outOfRange = isPriceOutOfRange(price, positionRange);
        if (!outOfRange) {
            logger.info({ price, positionRange }, "price within range; no action");
            this.outOfRangeSince = null;
            this.lastStatus.lastAction = "no-action";
            this.lastStatus.positionRange = positionRange;
            this.lastStatus.positionMint = this.currentPositionMint;
            return this.getStatus();
        }
        if (this.config.outOfRangeConfirmSec > 0) {
            const now = Date.now();
            if (this.outOfRangeSince === null) {
                this.outOfRangeSince = now;
            }
            const elapsedSec = (now - this.outOfRangeSince) / 1000;
            if (elapsedSec < this.config.outOfRangeConfirmSec) {
                logger.info({ price, positionRange, elapsedSec, confirmSec: this.config.outOfRangeConfirmSec }, "price out of range; waiting confirmation");
                this.lastStatus.lastAction = "out-of-range-wait";
                this.lastStatus.positionRange = positionRange;
                this.lastStatus.positionMint = this.currentPositionMint;
                return this.getStatus();
            }
        }
        logger.info({ price, positionRange }, "price out of range; rebalancing");
        this.outOfRangeSince = null;
        await this.closePosition(this.currentPosition);
        this.currentPosition = null;
        this.currentPositionMint = null;
        const result = await this.openPosition(range, price, solUsdPrice);
        this.lastStatus.lastAction = result === "open-position" ? "rebalanced" : result;
        if (result === "open-position") {
            await this.updatePortfolioSnapshot(price, solUsdPrice);
        }
        this.lastStatus.positionRange = null;
        this.lastStatus.positionMint = this.currentPositionMint;
        return this.getStatus();
    }
    async closeActivePosition() {
        this.lastStatus.running = true;
        await this.refreshPoolState();
        const price = await this.getCurrentPrice();
        const solUsdPrice = await this.tryGetSolUsdPrice();
        this.lastStatus.lastPrice = price;
        this.lastStatus.solUsdPrice = solUsdPrice;
        this.lastStatus.budgetUsd = this.config.budgetUsd;
        this.lastStatus.budgetSol = solUsdPrice && this.config.budgetUsd
            ? this.config.budgetUsd / solUsdPrice
            : null;
        if (!this.currentPosition) {
            this.lastStatus.lastAction = "close-no-position";
            return this.getStatus();
        }
        await this.closePosition(this.currentPosition);
        this.currentPosition = null;
        this.currentPositionMint = null;
        await this.updatePortfolioSnapshot(price, solUsdPrice);
        this.lastStatus.lastAction = "close-position";
        this.lastStatus.positionMint = null;
        this.lastStatus.positionRange = null;
        return this.getStatus();
    }
    async refreshPoolState() {
        const poolAddress = new PublicKey(this.config.whirlpoolAddress);
        const pool = await this.client.getPool(poolAddress);
        const poolData = pool.getData();
        const tokenMintA = new PublicKey(poolData.tokenMintA);
        const tokenMintB = new PublicKey(poolData.tokenMintB);
        const [mintA, mintB] = await Promise.all([
            getMint(this.connection, tokenMintA),
            getMint(this.connection, tokenMintB)
        ]);
        this.poolState = {
            pool,
            poolAddress,
            tokenMintA,
            tokenMintB,
            decimalsA: mintA.decimals,
            decimalsB: mintB.decimals,
            tickSpacing: poolData.tickSpacing,
            isTokenASol: tokenMintA.equals(NATIVE_MINT),
            isTokenBSol: tokenMintB.equals(NATIVE_MINT)
        };
    }
    async getCurrentPrice() {
        if (!this.poolState) {
            throw new Error("poolState not initialized");
        }
        const poolData = this.poolState.pool.getData();
        const price = whirlpools.PriceMath.sqrtPriceX64ToPrice(poolData.sqrtPrice, this.poolState.decimalsA, this.poolState.decimalsB);
        return toNumber(price);
    }
    async getPositionRange(position) {
        if (!this.poolState) {
            return null;
        }
        const data = position.getData?.() ?? position.getData;
        if (!data) {
            return null;
        }
        const lowerPrice = whirlpools.PriceMath.tickIndexToPrice(data.tickLowerIndex, this.poolState.decimalsA, this.poolState.decimalsB);
        const upperPrice = whirlpools.PriceMath.tickIndexToPrice(data.tickUpperIndex, this.poolState.decimalsA, this.poolState.decimalsB);
        return { lower: toNumber(lowerPrice), upper: toNumber(upperPrice) };
    }
    async loadExistingPosition() {
        if (!this.poolState) {
            return;
        }
        let foundPosition = null;
        let foundMint = null;
        if (this.config.positionMint) {
            const position = await this.fetchPositionByMint(this.config.positionMint);
            if (position) {
                foundPosition = position;
                foundMint = this.config.positionMint;
            }
        }
        else {
            const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(this.wallet.publicKey, { programId: TOKEN_PROGRAM_ID });
            for (const acct of tokenAccounts.value) {
                const info = acct.account.data.parsed.info;
                const amount = Number(info.tokenAmount?.amount ?? 0);
                const decimals = Number(info.tokenAmount?.decimals ?? 0);
                if (amount === 0 || decimals !== 0) {
                    continue;
                }
                const mint = info.mint;
                try {
                    const position = await this.fetchPositionByMint(mint);
                    if (position) {
                        foundPosition = position;
                        foundMint = mint;
                        break;
                    }
                }
                catch {
                    continue;
                }
            }
        }
        this.currentPosition = foundPosition;
        this.currentPositionMint = foundMint;
        this.lastStatus.positionMint = this.currentPositionMint;
        if (this.currentPosition) {
            const range = await this.getPositionRange(this.currentPosition);
            this.lastStatus.positionRange = range ?? null;
        }
        else {
            this.lastStatus.positionRange = null;
        }
    }
    async fetchPositionByMint(mint) {
        if (!this.poolState) {
            return null;
        }
        const programId = whirlpools.ORCA_WHIRLPOOL_PROGRAM_ID ?? whirlpools.WHIRLPOOL_PROGRAM_ID;
        const positionMint = new PublicKey(mint);
        const positionPda = whirlpools.PDAUtil.getPosition(programId, positionMint);
        const positionAddress = positionPda.publicKey ?? positionPda;
        const position = await this.client.getPosition(positionAddress);
        const data = position.getData?.() ?? position.getData;
        if (data?.whirlpool && new PublicKey(data.whirlpool).equals(this.poolState.poolAddress)) {
            logger.info({ positionMint: mint }, "found existing position for pool");
            return position;
        }
        return null;
    }
    async openPosition(range, price, solUsdPrice) {
        if (!this.poolState) {
            throw new Error("poolState not initialized");
        }
        const { lowerTick, upperTick } = this.getTicksForRange(range);
        const slippage = common.Percentage.fromFraction(this.config.slippageBps, 10000);
        let balances = await this.getTokenBalances();
        let tokenExtensionCtx = await whirlpools.TokenExtensionUtil.buildTokenExtensionContext(this.ctx.fetcher, this.poolState.pool.getData(), whirlpools.IGNORE_CACHE);
        const { targetA, targetB } = await this.computeTargetAmounts(price, lowerTick, upperTick, balances.tokenA, balances.tokenB, solUsdPrice, tokenExtensionCtx);
        if (targetA <= 0 && targetB <= 0) {
            logger.warn("insufficient token balances to open position");
            return "insufficient-balance";
        }
        const swapped = await this.rebalanceToTarget(balances.tokenA, balances.tokenB, targetA, targetB, price, slippage);
        if (swapped) {
            balances = await this.getTokenBalances();
            await this.refreshPoolState();
            if (!this.poolState) {
                throw new Error("poolState not initialized after refresh");
            }
            tokenExtensionCtx = await whirlpools.TokenExtensionUtil.buildTokenExtensionContext(this.ctx.fetcher, this.poolState.pool.getData(), whirlpools.IGNORE_CACHE);
        }
        let usableA = Math.min(balances.tokenA, targetA);
        let usableB = Math.min(balances.tokenB, targetB);
        if (this.config.maxTokenA != null) {
            usableA = Math.min(usableA, this.config.maxTokenA);
        }
        if (this.config.maxTokenB != null) {
            usableB = Math.min(usableB, this.config.maxTokenB);
        }
        if (usableA <= 0 && usableB <= 0) {
            logger.warn("insufficient token balances to open position");
            return "insufficient-balance";
        }
        const poolState = this.poolState;
        if (!poolState) {
            throw new Error("poolState not initialized");
        }
        const buildQuote = () => {
            let quote = this.tryBuildQuote(poolState.pool, poolState.tokenMintA, new Decimal(usableA), lowerTick, upperTick, slippage, usableA, usableB, tokenExtensionCtx);
            if (!quote) {
                quote = this.tryBuildQuote(poolState.pool, poolState.tokenMintB, new Decimal(usableB), lowerTick, upperTick, slippage, usableA, usableB, tokenExtensionCtx);
            }
            return quote;
        };
        let quote = buildQuote();
        if (!quote) {
            logger.warn("unable to build liquidity quote with available balances");
            return "quote-failed";
        }
        for (let attempt = 0; attempt < 3; attempt += 1) {
            this.lastStatus.lastCloseTokenA = null;
            this.lastStatus.lastCloseTokenB = null;
            const { requiredA, requiredB } = extractQuoteAmounts(quote, this.poolState.decimalsA, this.poolState.decimalsB);
            this.lastStatus.lastOpenTokenA = requiredA;
            this.lastStatus.lastOpenTokenB = requiredB;
            logger.info({ lowerTick, upperTick, attempt }, "opening new position");
            try {
                let openResult;
                if (typeof this.poolState.pool.getOpenPositionWithOptMetadataTx === "function") {
                    openResult = await this.poolState.pool.getOpenPositionWithOptMetadataTx(lowerTick, upperTick, quote, this.wallet.publicKey, this.wallet.publicKey, TOKEN_PROGRAM_ID, false, undefined, true);
                }
                else {
                    openResult = await this.poolState.pool.openPosition?.(lowerTick, upperTick, quote)
                        ?? await this.poolState.pool.openPositionWithMetadata?.(lowerTick, upperTick, quote);
                }
                if (!openResult) {
                    throw new Error("openPosition method not available on pool object; adjust src/orca.ts to your SDK version");
                }
                const tx = openResult.transaction ?? openResult.tx ?? openResult;
                const positionMint = openResult.positionMint ?? openResult.positionMintAddress;
                const executed = await this.executeTx(tx, "open-position");
                if (executed && positionMint) {
                    this.currentPositionMint = positionMint.toString();
                    this.currentPosition = await this.fetchPositionByMint(this.currentPositionMint);
                    this.initialPositionValue = null;
                    this.initialPositionValueSol = null;
                }
                return executed ? "open-position" : "dry-run-open";
            }
            catch (err) {
                if (isPriceSlippageError(err) && attempt < 2) {
                    logger.warn({ attempt }, "price slippage out of bounds; re-quoting");
                    await this.refreshPoolState();
                    if (!this.poolState) {
                        throw err;
                    }
                    tokenExtensionCtx = await whirlpools.TokenExtensionUtil.buildTokenExtensionContext(this.ctx.fetcher, this.poolState.pool.getData(), whirlpools.IGNORE_CACHE);
                    quote = buildQuote();
                    if (!quote) {
                        logger.warn("unable to build liquidity quote with available balances after re-quote");
                        return "quote-failed";
                    }
                    continue;
                }
                throw err;
            }
        }
        return "quote-failed";
    }
    tryBuildQuote(pool, inputMint, amount, lowerTick, upperTick, slippage, usableA, usableB, tokenExtensionCtx) {
        if (!this.poolState || amount.lte(0)) {
            return null;
        }
        let currentAmount = amount;
        for (let attempt = 0; attempt < 4; attempt += 1) {
            if (currentAmount.lte(0)) {
                return null;
            }
            try {
                const quote = whirlpools.increaseLiquidityQuoteByInputTokenUsingPriceDeviation(inputMint, currentAmount, lowerTick, upperTick, slippage, pool, tokenExtensionCtx);
                const { requiredA, requiredB } = extractQuoteAmounts(quote, this.poolState.decimalsA, this.poolState.decimalsB);
                if (requiredA <= usableA + 1e-9 && requiredB <= usableB + 1e-9) {
                    return quote;
                }
                const scaleA = requiredA > 0 ? usableA / requiredA : 1;
                const scaleB = requiredB > 0 ? usableB / requiredB : 1;
                const scale = Math.min(scaleA, scaleB);
                if (!Number.isFinite(scale) || scale <= 0) {
                    return null;
                }
                if (scale >= 0.999) {
                    return null;
                }
                currentAmount = currentAmount.mul(scale * 0.98);
            }
            catch (err) {
                logger.warn({ err, attempt }, "failed to build liquidity quote");
                return null;
            }
        }
        return null;
    }
    async computeTargetAmounts(price, lowerTick, upperTick, walletA, walletB, solUsdPrice, tokenExtensionCtx) {
        if (!this.poolState) {
            return { targetA: 0, targetB: 0 };
        }
        const walletValue = walletB + walletA * price;
        if (walletValue <= 0) {
            return { targetA: 0, targetB: 0 };
        }
        let effectiveBudget = walletValue;
        if (this.config.budgetUsd != null) {
            if (!this.poolState.isTokenASol && !this.poolState.isTokenBSol) {
                throw new Error("budgetUsd requires a SOL (wSOL) leg in the pool");
            }
            const solUsd = solUsdPrice ?? await this.tryGetSolUsdPrice();
            if (!solUsd) {
                throw new Error("SOL/USD price unavailable");
            }
            const budgetSol = this.config.budgetUsd / solUsd;
            const budgetTokenB = this.poolState.isTokenBSol ? budgetSol : budgetSol * price;
            effectiveBudget = Math.min(walletValue, budgetTokenB);
        }
        const ratio = await this.getRangeRatio(lowerTick, upperTick, price, tokenExtensionCtx);
        const targetA = effectiveBudget / (price + ratio);
        const targetB = ratio * targetA;
        return { targetA, targetB };
    }
    async getRangeRatio(lowerTick, upperTick, price, tokenExtensionCtx) {
        if (!this.poolState) {
            return price;
        }
        try {
            const slippage = common.Percentage.fromFraction(0, 10000);
            const quote = whirlpools.increaseLiquidityQuoteByInputTokenUsingPriceDeviation(this.poolState.tokenMintA, new Decimal(1), lowerTick, upperTick, slippage, this.poolState.pool, tokenExtensionCtx);
            const { requiredA, requiredB } = extractQuoteAmounts(quote, this.poolState.decimalsA, this.poolState.decimalsB);
            if (requiredA > 0 && requiredB >= 0) {
                return requiredB / requiredA;
            }
        }
        catch (err) {
            logger.warn({ err }, "failed to compute ratio from liquidity quote");
        }
        return price;
    }
    async rebalanceToTarget(walletA, walletB, targetA, targetB, price, slippage) {
        if (!this.poolState) {
            return false;
        }
        const factor = Math.max(0, Math.min(1, this.config.rebalanceSwapPct ?? 1));
        if (factor <= 0) {
            return false;
        }
        const deltaA = targetA - walletA;
        const deltaB = targetB - walletB;
        if (deltaA > 0 && walletB > targetB) {
            const neededB = deltaA * price;
            const availableB = walletB - targetB;
            const amountIn = Math.min(neededB, availableB) * factor;
            if (amountIn > 0) {
                return this.swap(this.poolState.tokenMintB, amountIn, slippage);
            }
        }
        if (deltaB > 0 && walletA > targetA) {
            const neededA = deltaB / price;
            const availableA = walletA - targetA;
            const amountIn = Math.min(neededA, availableA) * factor;
            if (amountIn > 0) {
                return this.swap(this.poolState.tokenMintA, amountIn, slippage);
            }
        }
        return false;
    }
    async swap(inputMint, amountIn, slippage) {
        if (!this.poolState) {
            return false;
        }
        if (amountIn <= 0) {
            return false;
        }
        logger.info({ inputMint: inputMint.toBase58(), amountIn }, "attempting rebalance swap");
        const decimals = inputMint.equals(this.poolState.tokenMintA)
            ? this.poolState.decimalsA
            : this.poolState.decimalsB;
        const amountBN = common.DecimalUtil.toBN(new Decimal(amountIn), decimals);
        const programId = this.ctx.program?.programId
            ?? whirlpools.ORCA_WHIRLPOOL_PROGRAM_ID
            ?? whirlpools.WHIRLPOOL_PROGRAM_ID;
        if (!programId) {
            throw new Error("Whirlpool programId not available");
        }
        const swapQuote = await whirlpools.swapQuoteByInputToken?.(this.poolState.pool, inputMint, amountBN, slippage, programId, this.ctx.fetcher, whirlpools.IGNORE_CACHE);
        if (!swapQuote) {
            throw new Error("swapQuoteByInputToken not available; update src/orca.ts for your SDK version");
        }
        const swapResult = await this.poolState.pool.swap?.(swapQuote);
        if (!swapResult) {
            throw new Error("pool.swap not available; update src/orca.ts for your SDK version");
        }
        const tx = swapResult.transaction ?? swapResult.tx ?? swapResult;
        await this.executeTx(tx, "swap");
        return true;
    }
    async closePosition(position) {
        logger.info("closing position and collecting fees");
        try {
            const amounts = await this.getPositionTokenAmounts(position);
            this.lastStatus.lastCloseTokenA = amounts.tokenA;
            this.lastStatus.lastCloseTokenB = amounts.tokenB;
            this.lastStatus.lastOpenTokenA = null;
            this.lastStatus.lastOpenTokenB = null;
        }
        catch (err) {
            logger.warn({ err }, "failed to estimate close amounts");
        }
        const slippage = common.Percentage.fromFraction(this.config.slippageBps, 10000);
        let closeResult = null;
        if (typeof position.closePosition === "function" || typeof position.closePositionWithMetadata === "function") {
            closeResult = await position.closePosition?.()
                ?? await position.closePositionWithMetadata?.();
        }
        else if (this.poolState?.pool?.closePosition) {
            const positionAddress = position.getAddress?.() ?? position.getAddress ?? position.address;
            if (!positionAddress) {
                throw new Error("position address not available for closePosition");
            }
            closeResult = await this.poolState.pool.closePosition(positionAddress, slippage, this.wallet.publicKey, this.wallet.publicKey, this.wallet.publicKey, true);
        }
        else if (this.poolState?.pool?.getClosePositionIx) {
            const positionAddress = position.getAddress?.() ?? position.getAddress ?? position.address;
            if (!positionAddress) {
                throw new Error("position address not available for closePosition");
            }
            closeResult = await this.poolState.pool.getClosePositionIx(positionAddress, slippage, this.wallet.publicKey, this.wallet.publicKey, this.wallet.publicKey, true);
        }
        if (!closeResult) {
            throw new Error("closePosition not available on SDK objects; update src/orca.ts to your SDK version");
        }
        const txList = Array.isArray(closeResult) ? closeResult : [closeResult];
        for (const item of txList) {
            const tx = item.transaction ?? item.tx ?? item;
            await this.executeTx(tx, "close-position");
        }
        this.initialPositionValue = null;
        this.initialPositionValueSol = null;
    }
    getStatus() {
        return { ...this.lastStatus };
    }
    setError(err) {
        this.lastStatus.lastError = stringifyError(err);
    }
    async tryGetSolUsdPrice() {
        if (!this.config.pythSolUsdFeedId) {
            return null;
        }
        try {
            const price = await getSolUsdPrice(this.connection, this.config.pythSolUsdFeedId, this.config.priceStaleMaxSec ?? null, 30000);
            return price.price;
        }
        catch (err) {
            logger.warn({ err }, "failed to fetch SOL/USD from Pyth");
            if (this.config.budgetUsd != null) {
                throw err;
            }
            return null;
        }
    }
    async getTokenBalances() {
        if (!this.poolState) {
            throw new Error("poolState not initialized");
        }
        const ataA = getAssociatedTokenAddressSync(this.poolState.tokenMintA, this.wallet.publicKey);
        const ataB = getAssociatedTokenAddressSync(this.poolState.tokenMintB, this.wallet.publicKey);
        const [balA, balB] = await Promise.all([
            this.connection.getTokenAccountBalance(ataA).catch(() => null),
            this.connection.getTokenAccountBalance(ataB).catch(() => null)
        ]);
        let tokenA = balA?.value?.uiAmount ?? 0;
        let tokenB = balB?.value?.uiAmount ?? 0;
        if (this.poolState.isTokenASol || this.poolState.isTokenBSol) {
            const nativeSol = (await this.connection.getBalance(this.wallet.publicKey)) / LAMPORTS_PER_SOL;
            const availableSol = Math.max(0, nativeSol - this.config.minSolBalance);
            if (this.poolState.isTokenASol) {
                tokenA += availableSol;
            }
            if (this.poolState.isTokenBSol) {
                tokenB += availableSol;
            }
        }
        return { tokenA, tokenB };
    }
    async updatePortfolioSnapshot(price, solUsdPrice) {
        if (!this.poolState) {
            return;
        }
        const walletBalances = await this.getTokenBalances();
        const positionBalances = this.currentPosition
            ? await this.getPositionTokenAmounts(this.currentPosition)
            : { tokenA: 0, tokenB: 0 };
        const totalA = walletBalances.tokenA + positionBalances.tokenA;
        const totalB = walletBalances.tokenB + positionBalances.tokenB;
        const portfolioValueTokenB = totalB + totalA * price;
        const positionValueTokenB = positionBalances.tokenB + positionBalances.tokenA * price;
        let portfolioValueSol = null;
        if (this.poolState.isTokenBSol) {
            portfolioValueSol = portfolioValueTokenB;
        }
        else if (this.poolState.isTokenASol && price > 0) {
            portfolioValueSol = totalA + totalB / price;
        }
        this.lastStatus.tokenABalance = walletBalances.tokenA;
        this.lastStatus.tokenBBalance = walletBalances.tokenB;
        this.lastStatus.positionTokenA = positionBalances.tokenA;
        this.lastStatus.positionTokenB = positionBalances.tokenB;
        this.lastStatus.portfolioValue = portfolioValueSol ?? portfolioValueTokenB;
        if (portfolioValueSol != null) {
            if (this.initialPortfolioValueSol === null) {
                this.initialPortfolioValueSol = portfolioValueSol;
            }
            this.lastStatus.pnl = portfolioValueSol - this.initialPortfolioValueSol;
            this.lastStatus.portfolioUsd = solUsdPrice ? portfolioValueSol * solUsdPrice : null;
            this.lastStatus.pnlUsd = solUsdPrice
                ? (portfolioValueSol - this.initialPortfolioValueSol) * solUsdPrice
                : null;
        }
        else {
            if (this.initialPortfolioValue === null) {
                this.initialPortfolioValue = portfolioValueTokenB;
            }
            this.lastStatus.pnl = portfolioValueTokenB - this.initialPortfolioValue;
            this.lastStatus.portfolioUsd = null;
            this.lastStatus.pnlUsd = null;
        }
        if (!this.currentPosition) {
            this.lastStatus.positionValue = null;
            this.lastStatus.positionPnl = null;
            this.lastStatus.positionValueUsd = null;
            this.lastStatus.positionPnlUsd = null;
            return;
        }
        let positionValueSol = null;
        if (this.poolState.isTokenBSol) {
            positionValueSol = positionValueTokenB;
        }
        else if (this.poolState.isTokenASol && price > 0) {
            positionValueSol = positionBalances.tokenA + positionBalances.tokenB / price;
        }
        this.lastStatus.positionValue = positionValueSol ?? positionValueTokenB;
        if (positionValueSol != null) {
            if (this.initialPositionValueSol === null) {
                this.initialPositionValueSol = positionValueSol;
            }
            this.lastStatus.positionPnl = positionValueSol - this.initialPositionValueSol;
            this.lastStatus.positionValueUsd = solUsdPrice ? positionValueSol * solUsdPrice : null;
            this.lastStatus.positionPnlUsd = solUsdPrice
                ? (positionValueSol - this.initialPositionValueSol) * solUsdPrice
                : null;
        }
        else {
            if (this.initialPositionValue === null) {
                this.initialPositionValue = positionValueTokenB;
            }
            this.lastStatus.positionPnl = positionValueTokenB - this.initialPositionValue;
            this.lastStatus.positionValueUsd = null;
            this.lastStatus.positionPnlUsd = null;
        }
    }
    async getPositionTokenAmounts(position) {
        if (!this.poolState) {
            return { tokenA: 0, tokenB: 0 };
        }
        const data = position.getData?.() ?? position.getData;
        if (!data) {
            return { tokenA: 0, tokenB: 0 };
        }
        const poolData = this.poolState.pool.getData();
        const tokenExtensionCtx = await whirlpools.TokenExtensionUtil.buildTokenExtensionContext(this.ctx.fetcher, poolData, whirlpools.IGNORE_CACHE);
        const quote = whirlpools.decreaseLiquidityQuoteByLiquidityWithParams({
            liquidity: data.liquidity,
            slippageTolerance: common.Percentage.fromFraction(0, 10000),
            tickLowerIndex: data.tickLowerIndex,
            tickUpperIndex: data.tickUpperIndex,
            sqrtPrice: poolData.sqrtPrice,
            tickCurrentIndex: poolData.tickCurrentIndex,
            tokenExtensionCtx
        });
        const tokenA = toNumber(common.DecimalUtil.fromBN(quote.tokenEstA, this.poolState.decimalsA));
        const tokenB = toNumber(common.DecimalUtil.fromBN(quote.tokenEstB, this.poolState.decimalsB));
        return { tokenA, tokenB };
    }
    getTicksForRange(range) {
        if (!this.poolState) {
            throw new Error("poolState not initialized");
        }
        const lowerIndex = whirlpools.PriceMath.priceToTickIndex(new Decimal(range.lower), this.poolState.decimalsA, this.poolState.decimalsB);
        const upperIndex = whirlpools.PriceMath.priceToTickIndex(new Decimal(range.upper), this.poolState.decimalsA, this.poolState.decimalsB);
        let lowerTick = whirlpools.TickUtil.getInitializableTickIndex(lowerIndex, this.poolState.tickSpacing);
        let upperTick = whirlpools.TickUtil.getInitializableTickIndex(upperIndex, this.poolState.tickSpacing);
        if (lowerTick === upperTick) {
            upperTick = lowerTick + this.poolState.tickSpacing;
        }
        if (lowerTick > upperTick) {
            const temp = lowerTick;
            lowerTick = upperTick;
            upperTick = temp + this.poolState.tickSpacing;
        }
        return { lowerTick, upperTick };
    }
    async executeTx(tx, label) {
        if (this.config.dryRun) {
            logger.info({ label }, "dry-run enabled; skipping transaction execution");
            return false;
        }
        if (typeof tx.buildAndExecute === "function") {
            const sig = await tx.buildAndExecute();
            logger.info({ label, sig }, "transaction executed");
            return true;
        }
        if (typeof tx.execute === "function") {
            const sig = await tx.execute();
            logger.info({ label, sig }, "transaction executed");
            return true;
        }
        throw new Error("Unsupported transaction object; update src/orca.ts for your SDK version");
    }
}
function toNumber(value) {
    if (typeof value === "number") {
        return value;
    }
    if (typeof value?.toNumber === "function") {
        return value.toNumber();
    }
    if (typeof value?.toString === "function") {
        return Number(value.toString());
    }
    return Number(value);
}
function extractQuoteAmounts(quote, decimalsA, decimalsB) {
    const tokenA = quote.tokenMaxA ?? quote.tokenEstA ?? quote.tokenA ?? 0;
    const tokenB = quote.tokenMaxB ?? quote.tokenEstB ?? quote.tokenB ?? 0;
    return {
        requiredA: toUiAmount(tokenA, decimalsA),
        requiredB: toUiAmount(tokenB, decimalsB)
    };
}
function toUiAmount(value, decimals) {
    if (value == null) {
        return 0;
    }
    if (typeof value === "number") {
        return value;
    }
    if (Decimal?.isDecimal?.(value)) {
        return value.toNumber();
    }
    try {
        const dec = common.DecimalUtil.fromBN(value, decimals);
        return toNumber(dec);
    }
    catch {
        return toNumber(value);
    }
}
function stringifyError(err) {
    if (err instanceof Error) {
        return err.message;
    }
    return String(err);
}
function isPriceSlippageError(err) {
    const msg = err instanceof Error ? err.message : String(err);
    return msg.includes("0x17b5") || msg.includes("PriceSlippageOutOfBounds");
}
