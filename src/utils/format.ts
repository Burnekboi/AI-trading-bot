export function formatSymbolDisplay(symbol: string): string {
  if (symbol.endsWith('USDT')) {
    const base = symbol.slice(0, -4);
    return `${base}/USDT`;
  }
  return symbol;
}

export function formatBalance(amount: number): string {
  return amount.toFixed(2);
}

export function formatPrice(price: number): string {
  if (price >= 1000) return price.toFixed(2);
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(6);
}

export function formatPnl(pnl: number): string {
  const sign = pnl >= 0 ? '+' : '';
  return `${sign}${pnl.toFixed(2)} USDT`;
}

export function directionEmoji(direction: 'LONG' | 'SHORT'): string {
  return direction === 'LONG' ? '🟢' : '🔴';
}
