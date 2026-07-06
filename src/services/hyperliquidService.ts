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

export async function placeMarketOrder(
  privateKey: string,
  coin: string,
  isBuy: boolean,
  size: string,
  price: string,
  reduceOnly: boolean = false
): Promise<any> {
  const client = await createExchangeClient(privateKey);
  return client.order({
    orders: [{
      a: coin,
      b: isBuy,
      p: price,
      s: size,
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
  return client.updateLeverage({
    asset: coin,
    isCross,
    leverage,
  });
}

export async function closePosition(
  privateKey: string,
  coin: string,
  size: string,
  price: string
): Promise<any> {
  return placeMarketOrder(privateKey, coin, false, size, price, true);
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

export function symbolToHl(symbol: string): string {
  return symbol.replace('USDT', '');
}

export function hlToSymbol(coin: string): string {
  return coin + 'USDT';
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

  return { apiAddress, apiPrivateKey };
}
