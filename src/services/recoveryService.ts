import { getAllWallets } from '../db/repositories/wallets';
import { getUserPositions, deletePosition } from '../db/repositories/positions';
import { getUserOpenPositions as getHlOpenPositions } from './hyperliquidService';

export async function recoverRealPositions(): Promise<void> {
  console.log('[Recovery] Checking real positions on Hyperliquid vs DB...');
  const wallets = await getAllWallets();
  let cleaned = 0;

  for (const wallet of wallets) {
    if (!wallet.address) continue;

    const [hlPositions, dbPositions] = await Promise.all([
      getHlOpenPositions(wallet.address),
      getUserPositions(wallet.chatId),
    ]);

    const realDbPositions = dbPositions.filter(p => p.accountMode === 'real');
    if (realDbPositions.length === 0) continue;

    const hlCoins = new Set(hlPositions.map(p => p.coin));

    for (const dbPos of realDbPositions) {
      const coin = dbPos.symbol.replace('USDT', '').replace('USDC', '');
      if (!hlCoins.has(coin)) {
        console.log(`[Recovery] Removing stale DB position: ${dbPos.symbol} for chat ${wallet.chatId} (not on HL)`);
        await deletePosition(dbPos.id!);
        cleaned++;
      }
    }
  }

  console.log(`[Recovery] Done. Cleaned ${cleaned} stale position(s).`);
}
