import { ethers } from 'ethers';
import type { HttpTransport as HttpTransportType, InfoClient as InfoClientType, ExchangeClient as ExchangeClientType } from '@nktkas/hyperliquid';

let transport: InstanceType<typeof HttpTransportType>;
let infoClient: InstanceType<typeof InfoClientType>;
let ExchangeClient: typeof ExchangeClientType;

async function init(): Promise<void> {
  if (transport) return;
  const hl = await import('@nktkas/hyperliquid');
  transport = new hl.HttpTransport();
  infoClient = new hl.InfoClient({ transport });
  ExchangeClient = hl.ExchangeClient;
}

export interface HLPosition {
  coin: string;
  szi: string;
  entryPx: string;
  positionValue: string;
  unrealizedPnl: string;
  liquidationPx: string;
  leverage: { type: string; value: number };
  marginUsed: string;
}

export interface HLUserState {
  assetPositions: { position: HLPosition; type: string }[];
  crossMarginSummary: { accountValue: string; totalMarginUsed: string; totalNtlPos: string; totalRawUsd: string };
  marginSummary: { accountValue: string; totalMarginUsed: string; totalNtlPos: string; totalRawUsd: string };
  withdrawable: string;
  time: number;
}

export interface HLAssetCtx {
  dayNtlVlm: string;
  funding: string;
  markPx: string;
  midPx: string;
  openInterest: string;
  oraclePx: string;
  prevDayPx: string;
}

export interface HLUniverseItem {
  name: string;
  szDecimals: number;
  maxLeverage: number;
}

export async function getInfoClient(): Promise<InfoClientType> {
  await init();
  return infoClient;
}

export async function getAllMids(): Promise<Record<string, string>> {
  await init();
  return infoClient.allMids();
}

export async function getMeta(): Promise<{ universe: HLUniverseItem[] }> {
  await init();
  return infoClient.meta();
}

export async function getMetaAndAssetCtxs(): Promise<[{ universe: HLUniverseItem[] }, HLAssetCtx[]]> {
  await init();
  return infoClient.metaAndAssetCtxs() as Promise<[{ universe: HLUniverseItem[] }, HLAssetCtx[]]>;
}

export async function getUserState(address: string): Promise<HLUserState> {
  await init();
  return infoClient.clearinghouseState({ user: address }) as Promise<HLUserState>;
}

export async function getUserUsdcBalance(address: string): Promise<number> {
  try {
    const state = await getUserState(address);
    return parseFloat(state.withdrawable);
  } catch {
    return 0;
  }
}

export async function getUserOpenPositions(address: string): Promise<HLPosition[]> {
  try {
    const state = await getUserState(address);
    return state.assetPositions.map(ap => ap.position);
  } catch {
    return [];
  }
}

async function createExchangeClient(privateKey: string): Promise<ExchangeClientType> {
  await init();
  const wallet = new ethers.Wallet(privateKey.startsWith('0x') ? privateKey : '0x' + privateKey);
  return new ExchangeClient({ transport, wallet });
}

// Hyperliquid tick/lot rules: max 5 significant figures on prices,
// max (6 - szDecimals) decimal places for perps; sizes truncated to szDecimals.
export const MARKET_ORDER_SLIPPAGE = 0.05;

function truncateDecimalDigits(value: number, decimals: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  if (decimals <= 0) {
    const floored = Math.floor(value);
    return floored > 0 ? String(floored) : '';
  }
  const s = value.toFixed(Math.min(decimals + 10, 20));
  const dot = s.indexOf('.');
  if (dot === -1) return s;
  return s.slice(0, dot + 1 + decimals);
}

function truncateToSigFigs(numStr: string, maxSig: number): string {
  const dotIdx = numStr.indexOf('.');
  const intPart = dotIdx === -1 ? numStr : numStr.slice(0, dotIdx);
  const fracPart = dotIdx === -1 ? '' : numStr.slice(dotIdx + 1);

  let seen = 0;
  let started = false;

  // Integer part: once the budget is spent, pad with zeros to preserve magnitude.
  let newInt = '';
  for (const ch of intPart) {
    if (!started) {
      newInt += ch;
      if (ch !== '0') {
        started = true;
        seen = 1;
      }
      continue;
    }
    if (seen < maxSig) {
      newInt += ch;
      seen++;
    } else {
      newInt += '0';
    }
  }

  // Fractional part: stop appending once the budget is spent (truncate).
  let newFrac = '';
  for (const ch of fracPart) {
    if (!started) {
      newFrac += ch;
      if (ch !== '0') {
        started = true;
        seen = 1;
      }
      continue;
    }
    if (seen < maxSig) {
      newFrac += ch;
      seen++;
    } else {
      break;
    }
  }

  newFrac = newFrac.replace(/0+$/, '');
  return newFrac ? `${newInt}.${newFrac}` : newInt;
}

export function formatHlPrice(value: number, szDecimals: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';

  if (Number.isInteger(value)) return String(value);

  const maxDecimals = Math.max(6 - szDecimals, 0);
  let s = truncateDecimalDigits(value, maxDecimals);
  if (!s) return '';

  if (!s.includes('.') || Number.isInteger(parseFloat(s))) {
    return s.replace(/\.0+$/, '');
  }

  s = truncateToSigFigs(s, 5);
  if (s.endsWith('.')) s = s.slice(0, -1);
  if (parseFloat(s) <= 0) return '';
  return s;
}

export function formatHlSize(value: number, szDecimals: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  const s = truncateDecimalDigits(value, szDecimals);
  if (!s || parseFloat(s) <= 0) return '';
  if (s.includes('.')) {
    const trimmed = s.replace(/\.?0+$/, '');
    return parseFloat(trimmed) <= 0 ? s : trimmed;
  }
  return s;
}

async function getSzDecimals(coin: string): Promise<number> {
  await init();
  const meta = await infoClient.meta();
  const item = meta.universe.find((u) => u.name === coin);
  return item?.szDecimals ?? 0;
}

function applySlippage(price: number, isBuy: boolean): number {
  return isBuy ? price * (1 + MARKET_ORDER_SLIPPAGE) : price * (1 - MARKET_ORDER_SLIPPAGE);
}

export async function placeMarketOrder(
  privateKey: string,
  coin: string,
  isBuy: boolean,
  size: string,
  price: string,
  reduceOnly: boolean = false
): Promise<any> {
  const client = await createExchangeClient(privateKey);
  const szDecimals = await getSzDecimals(coin);
  const asset = await getAssetIndex(coin);

  const pxNum = applySlippage(parseFloat(price), isBuy);
  const px = formatHlPrice(pxNum, szDecimals);
  const sz = formatHlSize(parseFloat(size), szDecimals);

  if (!px || !sz || parseFloat(px) <= 0 || parseFloat(sz) <= 0) {
    throw new Error(
      `Invalid order params for ${coin}: px=${px || 'invalid'} sz=${sz || 'invalid'} (szDecimals=${szDecimals})`
    );
  }

  return client.order({
    orders: [{
      a: asset,
      b: isBuy,
      p: px,
      s: sz,
      r: reduceOnly,
      t: { limit: { tif: 'Ioc' } },
    }],
    grouping: 'na',
  });
}

export async function setLeverage(
  privateKey: string,
  coin: string,
  leverage: number,
  isCross: boolean = false
): Promise<any> {
  const client = await createExchangeClient(privateKey);
  const asset = await getAssetIndex(coin);
  return client.updateLeverage({
    asset,
    isCross,
    leverage,
  });
}

export async function closePosition(
  privateKey: string,
  coin: string,
  size: string,
  price: string,
  isLong: boolean
): Promise<any> {
  // Closing a LONG requires a sell; closing a SHORT requires a buy.
  // Reduce-only caps the order at the existing position size.
  return placeMarketOrder(privateKey, coin, !isLong, size, price, true);
}

export async function getCoinPrice(coin: string): Promise<number> {
  const mids = await getAllMids();
  const price = mids[coin];
  return price ? parseFloat(price) : 0;
}

export async function getCoinMeta(coin: string): Promise<HLUniverseItem | null> {
  const meta = await getMeta();
  const item = meta.universe.find(u => u.name === coin);
  return item ?? null;
}

let metaCache: { universe: HLUniverseItem[] } | null = null;
let metaCacheAt = 0;
const META_CACHE_MS = 60_000;

async function getCachedMeta(): Promise<{ universe: HLUniverseItem[] }> {
  const now = Date.now();
  if (metaCache && now - metaCacheAt < META_CACHE_MS) return metaCache;
  const meta = await getMeta();
  metaCache = meta;
  metaCacheAt = now;
  return meta;
}

// Hyperliquid action fields (order `a`, updateLeverage `asset`) expect the
// numeric asset index, not the coin name string. The /meta universe is ordered
// by asset index, so the array position equals the asset index.
export async function getAssetIndex(coin: string): Promise<number> {
  const meta = await getCachedMeta();
  const index = meta.universe.findIndex(u => u.name === coin);
  if (index < 0) throw new Error(`Cannot resolve asset index for ${coin}`);
  return index;
}
export function symbolToHl(symbol: string): string {
  return symbol.replace('USDT', '');
}

export function hlToSymbol(coin: string): string {
  return coin + 'USDT';
}

export interface HlCandle {
  t: number;
  T: number;
  s: string;
  i: string;
  o: string;
  c: string;
  h: string;
  l: string;
  v: string;
  n: number;
}

export type Kline = [
  openTime: number,
  open: string,
  high: string,
  low: string,
  close: string,
  volume: string,
  closeTime: number,
  quoteVolume: string,
];

export function hlCandleToKline(candle: HlCandle): Kline {
  return [
    candle.t,
    candle.o,
    candle.h,
    candle.l,
    candle.c,
    candle.v,
    candle.T,
    '0',
  ];
}

export interface HlPairInfo {
  coin: string;
  dayNtlVlm: number;
  markPx: number;
  midPx: number;
  funding: number;
  openInterest: number;
  prevDayPx: number;
  szDecimals: number;
  maxLeverage: number;
}

export async function getActiveHlPairs(): Promise<HlPairInfo[]> {
  await init();
  const [meta, ctxs] = await getMetaAndAssetCtxs();
  return meta.universe.map((item, i) => {
    const ctx = ctxs[i];
    return {
      coin: item.name,
      dayNtlVlm: parseFloat(ctx.dayNtlVlm),
      markPx: parseFloat(ctx.markPx),
      midPx: parseFloat(ctx.midPx),
      funding: parseFloat(ctx.funding),
      openInterest: parseFloat(ctx.openInterest),
      prevDayPx: parseFloat(ctx.prevDayPx),
      szDecimals: item.szDecimals,
      maxLeverage: item.maxLeverage,
    };
  });
}

export async function getHlCandles(
  coin: string,
  interval: string,
  limit: number
): Promise<Kline[]> {
  await init();
  const endTime = Date.now();
  const msPerCandle: Record<string, number> = {
    '1m': 60000, '3m': 180000, '5m': 300000, '15m': 900000,
    '30m': 1800000, '1h': 3600000, '2h': 7200000, '4h': 14400000,
    '8h': 28800000, '12h': 43200000, '1d': 86400000,
  };
  const ms = msPerCandle[interval] ?? 3600000;
  const startTime = endTime - ms * limit;

  const candles = await infoClient.candleSnapshot({
    coin,
    interval: interval as any,
    startTime,
    endTime,
  });

  return candles.map(hlCandleToKline);
}

export async function placeLimitOrder(
  privateKey: string,
  coin: string,
  isBuy: boolean,
  size: string,
  price: string,
  reduceOnly: boolean = false
): Promise<any> {
  const client = await createExchangeClient(privateKey);
  const szDecimals = await getSzDecimals(coin);
  const asset = await getAssetIndex(coin);

  const px = formatHlPrice(parseFloat(price), szDecimals);
  const sz = formatHlSize(parseFloat(size), szDecimals);

  if (!px || !sz || parseFloat(px) <= 0 || parseFloat(sz) <= 0) {
    throw new Error(
      `Invalid limit order params for ${coin}: px=${px || 'invalid'} sz=${sz || 'invalid'} (szDecimals=${szDecimals})`
    );
  }

  return client.order({
    orders: [{
      a: asset,
      b: isBuy,
      p: px,
      s: sz,
      r: reduceOnly,
      t: { limit: { tif: 'Gtc' } },
    }],
    grouping: 'na',
  });
}

export interface HlTriggerPlacement {
  stopLossPoint: number | null;
  takeProfitPoint: number | null;
  placedCount: number;
}

// Cancels every resting trigger order on a coin. Position TP/SL orders may be
// returned by HL as parent orders with nested `children` (each leg has its own
// oid), so both levels are collected. The exchange also auto-consumes a leg
// once it fills, which can make a batch cancel throw — in that case we retry
// each oid individually so one already-filled order never blocks the rest.
export async function cancelTriggerOrdersForCoin(
  privateKey: string,
  address: string,
  coin: string
): Promise<void> {
  await init();
  const client = await createExchangeClient(privateKey);
  const asset = await getAssetIndex(coin);

  const open = (await infoClient.openOrders({ user: address })) as unknown as Array<{
    coin?: string;
    oid?: number;
    reduceOnly?: boolean;
    isPositionTpsl?: boolean;
    triggerPx?: string;
    orderType?: string;
    children?: Array<{ oid?: number }>;
  }>;

  const targets = new Set<number>();

  const collect = (order: {
    coin?: string;
    oid?: number;
    reduceOnly?: boolean;
    isPositionTpsl?: boolean;
    triggerPx?: string;
    orderType?: string;
    children?: Array<{ oid?: number }>;
  }): void => {
    if (order.coin !== coin) return;
    const isTrigger =
      order.reduceOnly === true ||
      order.isPositionTpsl === true ||
      typeof order.triggerPx === 'string' ||
      (typeof order.orderType === 'string' &&
        (order.orderType.includes('Stop') || order.orderType.includes('Take Profit')));
    if (!isTrigger) return;
    if (typeof order.oid === 'number') targets.add(order.oid);
    if (Array.isArray(order.children)) {
      for (const child of order.children) {
        if (child && typeof child.oid === 'number') targets.add(child.oid);
      }
    }
  };

  open.forEach(collect);

  if (targets.size === 0) return;

  const cancels = [...targets].map((o) => ({ a: asset, o }));
  try {
    await client.cancel({ cancels });
    return;
  } catch (err) {
    console.error(`[Cancels] Batch cancel failed for ${coin}, retrying per order:`, err);
  }

  for (const oid of targets) {
    await client.cancel({ cancels: [{ a: asset, o: oid }] }).catch((e) =>
      console.error(`[Cancels] Could not cancel oid ${oid} for ${coin}:`, e)
    );
  }
}

// Attaches exchange-side stop-loss + take-profit market-on-trigger orders so
// the levels set by the bot are honoured by Hyperliquid itself (even if this
// process is offline). Both orders are reduce-only and placed with the
// `positionTpsl` grouping, so Hyperliquid scales their size along with the
// position (e.g., after the bot closes half at the 1x partial-TP point) and
// drops them once the position is fully closed. When a trade has no stop
// loss, a stop is placed at the liquidation price as a last-resort exit.
export async function placeTriggerOrders(
  privateKey: string,
  address: string,
  coin: string,
  isLong: boolean,
  entryPrice: number,
  size: number,
  stopLoss: number | null,
  takeProfit: number | null,
  liquidationPrice: number
): Promise<HlTriggerPlacement> {
  // Clear any stale reduce-only triggers on this coin first so a restarted
  // position never inherits orders that were meant for a closed one.
  await cancelTriggerOrdersForCoin(privateKey, address, coin).catch((err) =>
    console.error(`[Triggers] Pre-cancel for ${coin} failed (non-fatal):`, err)
  );

  const client = await createExchangeClient(privateKey);
  const szDecimals = await getSzDecimals(coin);
  const asset = await getAssetIndex(coin);

  const orders: Array<{
    a: number;
    b: boolean;
    p: string;
    s: string;
    r: boolean;
    t: { trigger: { isMarket: boolean; triggerPx: string; tpsl: 'sl' | 'tp' } };
  }> = [];

  const stopLevel = stopLoss ?? liquidationPrice;
  if (Number.isFinite(stopLevel) && stopLevel > 0) {
    const onSide = isLong ? stopLevel < entryPrice : stopLevel > entryPrice;
    const s = formatHlSize(size, szDecimals);
    const p = formatHlPrice(stopLevel, szDecimals);
    if (onSide && s && p) {
      orders.push({
        a: asset,
        b: !isLong,
        p,
        s,
        r: true,
        t: { trigger: { isMarket: true, triggerPx: p, tpsl: 'sl' } },
      });
    }
  }

  const tp = takeProfit;
  if (Number.isFinite(tp) && tp !== null && tp > 0) {
    const onSide = isLong ? tp > entryPrice : tp < entryPrice;
    const s = formatHlSize(size, szDecimals);
    const p = formatHlPrice(tp, szDecimals);
    if (onSide && s && p) {
      orders.push({
        a: asset,
        b: !isLong,
        p,
        s,
        r: true,
        t: { trigger: { isMarket: true, triggerPx: p, tpsl: 'tp' } },
      });
    }
  }

  if (orders.length === 0) {
    return { stopLossPoint: stopLevel, takeProfitPoint: takeProfit, placedCount: 0 };
  }

  await client.order({
    orders,
    grouping: 'positionTpsl',
  });

  return {
    stopLossPoint: stopLevel,
    takeProfitPoint: takeProfit,
    placedCount: orders.length,
  };
}

export async function generateAndApproveAgent(
  mainWalletPrivateKey: string
): Promise<{ apiAddress: string; apiPrivateKey: string }> {
  await init();
  const apiWallet = ethers.Wallet.createRandom();
  const apiAddress = apiWallet.address;
  const apiPrivateKey = apiWallet.privateKey;

  const mainPk = mainWalletPrivateKey.startsWith('0x') ? mainWalletPrivateKey : '0x' + mainWalletPrivateKey;
  const wallet = new ethers.Wallet(mainPk);
  const client = new ExchangeClient({ transport, wallet });

  const validUntil = Date.now() + 180 * 24 * 60 * 60 * 1000;
  const agentName = `ai-trade-bot valid_until ${validUntil}`;

  await client.approveAgent({
    agentAddress: apiAddress,
    agentName,
  });

  return { apiAddress: apiAddress, apiPrivateKey: apiPrivateKey };
}

// ── Arbitrum → Hyperliquid deposits ─────────────────────────────────────────
// Sending native USDC on Arbitrum One to the official bridge credits the
// SENDING address's Hyperliquid account (<1 min). Min deposit: 5 USDC.
const ARBITRUM_RPC = 'https://arb1.arbitrum.io/rpc';
export const HL_ARBITRUM_BRIDGE = '0x2df1c51e09aecf9cacb7bc98cb1742757f163df7';
export const HL_DEPOSIT_MIN_USDC = 5;
const ARB_NATIVE_USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';

let arbProvider: ethers.JsonRpcProvider | null = null;

function getArbProvider(): ethers.JsonRpcProvider {
  if (!arbProvider) arbProvider = new ethers.JsonRpcProvider(ARBITRUM_RPC);
  return arbProvider;
}

export async function getArbitrumBalances(
  address: string
): Promise<{ usdc: number; eth: number }> {
  const provider = getArbProvider();
  const usdc = new ethers.Contract(
    ARB_NATIVE_USDC,
    ['function balanceOf(address owner) view returns (uint256)'],
    provider
  );
  const [usdcRaw, ethRaw] = await Promise.all([
    usdc.balanceOf(address) as Promise<bigint>,
    provider.getBalance(address),
  ]);
  return {
    usdc: Number(ethers.formatUnits(usdcRaw, 6)),
    eth: Number(ethers.formatEther(ethRaw)),
  };
}

export async function depositUsdcToHyperliquid(
  privateKey: string,
  amountUsdc: number
): Promise<string> {
  if (amountUsdc < HL_DEPOSIT_MIN_USDC) {
    throw new Error(
      `Minimum deposit is ${HL_DEPOSIT_MIN_USDC} USDC. Smaller amounts are lost forever.`
    );
  }

  const pk = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey;
  const signer = new ethers.Wallet(pk, getArbProvider());

  const usdc = new ethers.Contract(
    ARB_NATIVE_USDC,
    ['function transfer(address to, uint256 amount) returns (bool)'],
    signer
  );

  const amountWei = BigInt(Math.round(amountUsdc * 1e6));

  // Ensure gas money exists before attempting (transfer costs ~50-100k gas).
  const feeData = await getArbProvider().getFeeData();
  const gasLimit = await getArbProvider().estimateGas({
    from: await signer.getAddress(),
    to: ARB_NATIVE_USDC,
    data: usdc.interface.encodeFunctionData('transfer', [HL_ARBITRUM_BRIDGE, amountWei]),
  });
  const gasCost = (feeData.gasPrice ?? 0n) * gasLimit;
  const ethBalance = await getArbProvider().getBalance(await signer.getAddress());
  if (ethBalance < gasCost) {
    throw new Error(
      'Not enough ETH on Arbitrum for gas. Send ~$0.10 worth of ETH to your wallet on the Arbitrum One network first.'
    );
  }

  const tx = await usdc.transfer(HL_ARBITRUM_BRIDGE, amountWei);
  await tx.wait();
  return tx.hash;
}

export async function waitForHlCredit(
  address: string,
  previousBalance: number,
  timeoutMs = 150000
): Promise<number | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    try {
      const bal = await getUserUsdcBalance(address);
      if (bal > previousBalance + 0.01) return bal;
    } catch {
      // transient API errors — keep polling until deadline
    }
  }
  return null;
}
