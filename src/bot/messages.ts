import type { ActivePosition, ClosePositionResult, PerformanceRecord } from '../types';
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
  usdcBalance: number
): string {
  return (
    `🤖 <b>AI Simulator Active Account</b>\n` +
    `Address: <code>${address}</code>\n\n` +
    `💵 <b>Simulated Balances:</b>\n` +
    `• USDT: ${formatBalance(usdtBalance)}\n` +
    `• USDC: ${formatBalance(usdcBalance)}`
  );
}

export function buildWelcomeText(address: string): string {
  return (
    `👋 Welcome to the <b>AI Trade Simulator</b>!\n\n` +
    `Your simulated wallet has been credited with <b>100.00 USDT</b>.\n` +
    `Address: <code>${address}</code>\n\n` +
    `Tap the dashboard to start paper trading with real MEXC market data.`
  );
}

export function buildActivePositionText(position: ActivePosition): string {
  const emoji = directionEmoji(position.direction);
  const pair = formatSymbolDisplay(position.symbol);
  const sl = position.stopLoss
    ? formatPrice(position.stopLoss)
    : 'None';
  const tp = position.targetProfit
    ? formatPrice(position.targetProfit)
    : 'None';

  return (
    `${emoji} <b>${position.direction}</b>\n` +
    `📊 <b>${pair}</b> (${position.strategyName})\n` +
    `💰 ${formatBalance(position.allocatedAmount)} USDT\n` +
    `⚡ Leverage: ${position.leverage}x\n` +
    `🔵 Entry: ${formatPrice(position.entryPrice)}\n` +
    `🔴 Stop loss: ${sl}\n` +
    `🟢 Target profit: ${tp}\n` +
    `🔄 STATUS: ONGOING`
  );
}

export function buildClosedPositionText(
  position: ActivePosition,
  result: ClosePositionResult
): string {
  const emoji = directionEmoji(position.direction);
  const pair = formatSymbolDisplay(position.symbol);
  const tp = position.targetProfit
    ? formatPrice(position.targetProfit)
    : 'None';
  const statusEmoji = result.status === 'Stopped' ? '🛑' : '⏰';

  return (
    `${emoji} <b>${position.direction}</b>\n` +
    `📊 <b>${pair}</b> (${position.strategyName})\n` +
    `💰 ${formatBalance(position.allocatedAmount)} USDT\n` +
    `⚡ Leverage: ${position.leverage}x\n` +
    `🔵 Entry: ${formatPrice(position.entryPrice)}\n` +
    `🟢 Target profit: ${tp}\n` +
    `${statusEmoji} STATUS: ${result.status.toUpperCase()}\n` +
    `💵 ${formatPnl(result.pnlUsdt)} (PnL)\n` +
    `💳 ${formatBalance(result.newBalance)} USDT (Total Balance)`
  );
}

export const AI_SCANNING_TEXT =
  '🔍 AI Engine active. Scanning MEXC volume leaders and calculating trade strategies...';

export const PROMPT_TRADE_AMOUNT =
  '💰 Enter the virtual USDT amount you wish to allocate (e.g., 20):';

export const PROMPT_LIMIT_DURATION =
  '⏳ Enter a duration constraint (e.g., 1hr, 4hr, or 24hr):';

export const PROMPT_LIMIT_AMOUNT =
  '💰 Enter the virtual USDT amount for your limit trade (e.g., 20):';

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
