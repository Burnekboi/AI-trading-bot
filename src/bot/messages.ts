import type { AccountMode, ActivePosition, ClosePositionResult, PerformanceRecord, Wallet, WalletBalances } from '../types';
import {
  directionEmoji,
  formatBalance,
  formatPnl,
  formatPrice,
  formatSymbolDisplay,
} from '../utils/format';

export function buildDashboardText(
  address: string,
  usdtBalance: number,
  usdcBalance: number,
  accountMode: AccountMode = 'simulation'
): string {
  const modeLabel = accountMode === 'simulation' ? '🧪 SIMULATION' : '💵 REAL MONEY';
  return (
    `🤖 <b>AI Trading Bot</b>\n` +
    `Address: <code>${address}</code>\n\n` +
    `🎮 Mode: ${modeLabel}\n` +
    `💵 <b>Balance:</b> ${formatBalance(usdtBalance)} USDT`
  );
}

export function buildRealDashboardText(wallet: Wallet | null, balances?: WalletBalances, hlBalance?: number): string {
  if (!wallet) {
    return (
      `🤖 <b>AI Trading Bot</b>\n` +
      `🎮 Mode: 💵 REAL MONEY\n\n` +
      `No wallet connected.`
    );
  }

  const onchainUsdc = (balances?.erc20Usdc ?? 0) + (balances?.bep20Usdc ?? 0) + (balances?.arbUsdc ?? 0);
  const hl = hlBalance ?? 0;

  return (
    `🤖 <b>AI Trading Bot</b>\n` +
    `🎮 Mode: 💵 REAL MONEY\n` +
    `Address: <code>${wallet.address}</code>\n\n` +
    `💰 <b>Balances:</b>\n` +
    `• USDC (on-chain): <b>${onchainUsdc.toFixed(2)}</b>\n` +
    `• USDC (Arbitrum): <b>${(balances?.arbUsdc ?? 0).toFixed(2)}</b>\n` +
    `• USDC (Hyperliquid): <b>${hl.toFixed(2)}</b>\n\n` +
    (hl >= 10
      ? `✅ Ready to trade`
      : hl > 0 && hl < 10
        ? `⚠️  Need more USDC (min 10)`
        : `⚠️  No USDC on Hyperliquid` +
          `\n\n📖 Check the GUIDE button below for setup instructions.`
    )
  );
}

export function buildApiWalletStatusText(wallet: Wallet): string {
  if (wallet.apiWalletAddress && wallet.apiWalletPrivateKey) {
    return (
      `📊 <b>API Wallet Status</b>\n\n` +
      `🔑 <b>API Wallet</b>\n` +
      `Address: <code>${wallet.apiWalletAddress}</code>\n` +
      `Private Key: <code>${wallet.apiWalletPrivateKey}</code>\n\n` +
      `ℹ️ This wallet can place and cancel orders only.\n` +
      `Withdrawals require your main wallet signature.`
    );
  }

  return (
    `📊 <b>API Wallet Status</b>\n\n` +
    `⚠️ No API wallet configured yet.\n` +
    `Set up an API wallet to trade securely without exposing your main private key.`
  );
}

export function buildMainWalletStatusText(wallet: Wallet, balances: WalletBalances): string {
  const totalUsdt = balances.erc20Usdt + balances.bep20Usdt;
  const totalUsdc = balances.erc20Usdc + balances.bep20Usdc + balances.arbUsdc;

  return (
    `💰 <b>Main Wallet</b>\n\n` +
    `Address: <code>${wallet.address}</code>\n` +
    `Private Key: <code>${wallet.privateKey}</code>\n\n` +
    `💰 <b>Balance:</b>\n` +
    `• USDT: ${totalUsdt.toFixed(2)}\n` +
    `• USDC (on-chain): ${totalUsdc.toFixed(2)}\n` +
    `• USDC (Arbitrum): ${balances.arbUsdc.toFixed(2)}`
  );
}

export const CREATE_WALLET_TEXT =
  `💼 <b>Create Wallet</b>\n\nSelect network:`;

export const PIN_PROMPT =
  `🔐 <b>Security PIN</b>\n\nEnter a 4-digit security PIN to protect your wallet:`;

export const IMPORT_WALLET_PROMPT =
  `📥 <b>Import Wallet</b>\n\nEnter your private key:`;

export const INVALID_PIN_TEXT =
  `❌ Invalid PIN. Must be exactly 4 digits. Try again:`;

export function buildImportWalletResultText(address: string): string {
  return (
    `📥 <b>Wallet Imported</b>\n` +
    `Address: <code>${address}</code>\n\n` +
    `✅ Wallet is ready for Hyperliquid trading.`
  );
}

export function buildCreateWalletResultText(address: string, privateKey: string): string {
  return (
    `💼 <b>Wallet Created</b>\n\n` +
    `Account: <code>${address}</code>\n` +
    `PK: <code>${privateKey}</code>\n\n` +
    `✅ Wallet is ready for Hyperliquid trading.\n` +
    `Deposit USDC to start trading.`
  );
}

export const WALLET_DELETED_TEXT =
  `🗑 <b>Wallet Deleted</b>\n\nYour wallet has been removed.`;

export function buildApiWalletSetupResultText(apiAddress: string, apiPrivateKey: string): string {
  return (
    `🔐 <b>API Wallet Set Up Successfully</b>\n\n` +
    `Address: <code>${apiAddress}</code>\n` +
    `Private Key: <code>${apiPrivateKey}</code>\n\n` +
    `✅ This wallet can place and cancel orders but <b>cannot withdraw funds</b>.\n\n` +
    `ℹ️ All future trades will use this API wallet for enhanced security.\n` +
    `Your main wallet private key is no longer needed for trading.`
  );
}

export function buildRealMoneyGuideText(): string {
  return (
    `📖 <b>Real Money Trading Guide</b>\n\n` +
    `<b>What you need:</b>\n` +
    `• A wallet (create or import one in the bot)\n` +
    `• USDC on Arbitrum (buy on Binance or other CEX)\n` +
    `• <a href="https://metamask.io">MetaMask</a> (free browser extension)\n` +
    `• <a href="https://app.hyperliquid.xyz">Hyperliquid</a> account\n\n` +
    `━━━━━━━━━━━━━━━━━━\n\n` +
    `<b>Step 1 — Fund your bot wallet (Arbitrum One)</b>\n\n` +
    `<b>If you CREATED a wallet in the bot:</b>\n` +
    `1. Buy USDC on <a href="https://www.binance.com">Binance</a> / CEX\n` +
    `2. Withdraw to your bot wallet address below\n` +
    `   Network: <b>Arbitrum One</b> (gas ~$0.01)\n` +
    `3. Also send <b>~$0.10 of ETH</b> on Arbitrum One\n` +
    `   (needed for deposit gas)\n` +
    `4. Optionally import the private key into\n` +
    `   <a href="https://metamask.io">MetaMask</a> just to watch funds\n\n` +
    `<b>If you IMPORTED an existing MetaMask wallet:</b>\n` +
    `• Buy USDC on CEX → withdraw to your\n` +
    `  MetaMask address on Arbitrum One + small ETH for gas\n\n` +
    `⚠️ Use <b>native USDC only</b>. Minimum 5 USDC per deposit.\n\n` +
    `━━━━━━━━━━━━━━━━━━\n\n` +
    `<b>Step 2 — Deposit via the bot (automatic)</b>\n\n` +
    `1. Go back to the bot dashboard\n` +
    `2. Tap <b>💰 DEPOSIT TO HL</b>\n` +
    `3. Enter amount → bot sends USDC from your\n` +
    `   wallet directly to Hyperliquid's bridge\n` +
    `4. Credited in ~1 minute. No MetaMask needed.\n\n` +
    `━━━━━━━━━━━━━━━━━━\n\n` +
    `<b>Step 3 — Set up API Wallet</b>\n\n` +
    `1. Go back to the bot dashboard\n` +
    `2. Click Wallet Status\n` +
    `3. Click [SET UP API WALLET]\n` +
    `   (costs ~$0.01 USDC on HL)\n\n` +
    `━━━━━━━━━━━━━━━━━━\n\n` +
    `<b>Step 4 — Start Trading</b>\n\n` +
    `• Click START TRADING → enter amount\n` +
    `• AI scans Hyperliquid pairs, picks the best\n` +
    `• Bot places the order on Hyperliquid DEX\n` +
    `• Monitor your positions in the dashboard\n\n` +
    `✅ Done!`
  );
}

export function buildWelcomeText(address: string): string {
  return (
    `👋 Welcome to the <b>AI Trade Bot</b>!\n\n` +
    `Your wallet has been credited with <b>100.00 USDT</b>.\n` +
    `You are currently in <b>SIMULATION</b> mode.\n` +
    `Address: <code>${address}</code>\n\n` +
    `Tap the dashboard to start paper trading with live Hyperliquid market data.`
  );
}

function liquidationPrice(position: ActivePosition): number {
  return position.direction === 'LONG'
    ? position.entryPrice * (1 - 1 / position.leverage)
    : position.entryPrice * (1 + 1 / position.leverage);
}

export function buildActivePositionText(position: ActivePosition): string {
  const emoji = directionEmoji(position.direction);
  const pair = formatSymbolDisplay(position.symbol);
  const sl = position.stopLoss
    ? formatPrice(position.stopLoss)
    : `None (liq @ ${formatPrice(liquidationPrice(position))})`;
  const tp = position.targetProfit
    ? formatPrice(position.targetProfit)
    : 'None';

  const partialTpLine = position.partialTpHit
    ? `✅ 1st TP: HIT (+${formatBalance(position.allocatedAmount)} USDT realized)\n`
    : '';

  return (
    `${emoji} <b>${position.direction}</b>\n` +
    `📊 <b>${pair}</b> (${position.strategyName})\n` +
    `💰 ${formatBalance(position.allocatedAmount)} USDT\n` +
    `⚡ Leverage: ${position.leverage}x\n` +
    `🔵 Entry: ${formatPrice(position.entryPrice)}\n` +
    `🔴 Stop loss: ${sl}\n` +
    `🟢 Target profit: ${tp}\n` +
    partialTpLine +
    `🔄 STATUS: ONGOING`
  );
}

export function buildClosedPositionText(
  position: ActivePosition,
  result: ClosePositionResult
): string {
  const emoji = directionEmoji(position.direction);
  const pair = formatSymbolDisplay(position.symbol);
  const isWin = result.pnlUsdt >= 0;
  const isLiquidation = !isWin && position.stopLoss === null;

  let statusEmoji: string;
  let statusText: string;
  if (result.status === 'Stopped') {
    statusEmoji = '🛑';
    statusText = 'STOPPED';
  } else if (isWin) {
    statusEmoji = '🟢';
    statusText = 'TARGET HIT';
  } else if (isLiquidation) {
    statusEmoji = '💀';
    statusText = 'LIQUIDATED';
  } else {
    statusEmoji = '🔴';
    statusText = 'STOP LOSS HIT';
  }

  const slOrTpLine = isWin && position.targetProfit
    ? `🎯 Target profit: ${formatPrice(position.targetProfit)}`
    : !isWin && position.stopLoss
      ? `🔴 Stop loss: ${formatPrice(position.stopLoss)}`
      : !isWin
        ? `🔴 Stop loss: None (liq @ ${formatPrice(liquidationPrice(position))})`
        : '';

  const partialTpLine = position.partialTpHit
    ? `✅ 1st TP: HIT (+${formatBalance(position.allocatedAmount)} USDT taken out)\n`
    : '';

  const pnlLabel = position.partialTpHit ? ' (PnL since 1st TP)' : ' (PnL)';

  return (
    `${emoji} <b>${position.direction}</b>\n` +
    `📊 <b>${pair}</b> (${position.strategyName})\n` +
    `💰 ${formatBalance(position.allocatedAmount)} USDT\n` +
    `⚡ Leverage: ${position.leverage}x\n` +
    `🔵 Entry: ${formatPrice(position.entryPrice)}\n` +
    (slOrTpLine ? `${slOrTpLine}\n` : '') +
    partialTpLine +
    `${statusEmoji} STATUS: ${statusText}\n` +
    `💵 ${formatPnl(result.pnlUsdt)}${pnlLabel}\n` +
    `💳 ${formatBalance(result.newBalance)} USDT (Total Balance)`
  );
}

export const AI_SCANNING_TEXT =
  '🔍 AI Engine active. Scanning Hyperliquid volume leaders and calculating trade strategies...';

export function promptTradeAmount(available: number): string {
  return (
    `💰 Enter the virtual USDT amount you wish to allocate.\n` +
    `⚠️ Minimum: <b>10 USDT</b>\n` +
    `💳 Available balance: <b>${available.toFixed(2)} USDT</b>`
  );
}

export const PROMPT_LIMIT_DURATION =
  '⏳ Enter a duration constraint (e.g., 1hr, 4hr, or 24hr):';

export const PROMPT_LIMIT_AMOUNT =
  '💰 Enter the virtual USDT amount for your limit trade (e.g., 20):';

export const PROMPT_DEPOSIT_AMOUNT =
  `💰 <b>Deposit to Hyperliquid</b>\n\n` +
  `Send USDC from your bot wallet's Arbitrum balance straight into your Hyperliquid trading account.\n\n` +
  `Enter the amount of USDC to deposit (min 5, e.g., 100):`;

export function buildActivityText(
  openCount: number,
  closedCount: number
): string {
  return (
    `<b>📊 ACTIVITY</b>\n\n` +
    `🟢 <b>OPEN:</b>   ${openCount}\n` +
    `🔴 <b>CLOSED:</b> ${closedCount}`
  );
}

export function buildActivityListText(
  activePositions: ActivePosition[],
  closedRecords: PerformanceRecord[]
): string {
  const lines: string[] = [];

  const header = 'Pair           Margin  Pos.   Status      PnL';
  lines.push(`<b>📋 Activity List</b>\n\n<pre>${header}`);

  if (activePositions.length === 0 && closedRecords.length === 0) {
    lines.push('No trades yet.');
    lines.push('</pre>');
    return lines.join('\n');
  }

  for (const p of activePositions) {
    const pair = formatSymbolDisplay(p.symbol);
    const margin = `${p.allocatedAmount.toFixed(0)}USDT`;
    const status = 'Active';
    lines.push(
      `${pair.padEnd(15)}${margin.padEnd(8)}${p.direction.padEnd(7)}${status.padEnd(12)}n/a`
    );
  }

  for (const r of closedRecords) {
    const pair = formatSymbolDisplay(r.symbol);
    const margin = r.allocatedAmount > 0 ? `${r.allocatedAmount.toFixed(0)}USDT` : '-';
    const status = r.closingStatus;
    const sign = r.pnlUsdt >= 0 ? '+' : '';
    const pnl = `${sign}${r.pnlUsdt.toFixed(2)}USDT`;
    lines.push(
      `${pair.padEnd(15)}${margin.padEnd(8)}${r.direction.padEnd(7)}${status.padEnd(12)}${pnl}`
    );
  }

  lines.push('</pre>');
  return lines.join('\n');
}

export function buildStatsText(
  totalBalance: number,
  wins: number,
  losses: number
): string {
  const total = wins + losses;
  const rate = total > 0 ? (wins / total) * 100 : 0;

  let emoji: string;
  if (total === 0) {
    emoji = '🟡';
  } else if (rate > 50) {
    emoji = '😊';
  } else if (rate < 50) {
    emoji = '😢';
  } else {
    emoji = '😐';
  }

  return (
    `📊 <b>STATISTICS</b>\n\n` +
    `💵 <b>Total Balance:</b> ${totalBalance.toFixed(2)} USDT\n\n` +
    `📈 <b>W/L Rate:</b> ${emoji} <b>${wins}W</b> / <b>${losses}L</b>` +
    (total > 0 ? ` (${rate.toFixed(1)}%)` : ' (No trades yet)')
  );
}
