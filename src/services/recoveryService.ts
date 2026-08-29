import { getAllWallets } from '../db/repositories/wallets';
import { getUserPositions, deletePosition } from '../db/repositories/positions';
import { getUserState } from './hyperliquidService';

export async function recoverRealPositions(): Promise<void> {
  console.log('[Recovery] Checking real positions on Hyperliquid vs DB...');
  const wallets = await getAllWallets();
  let cleaned = 0;

  for (const wallet of wallets) {
    if (!wallet.address) continue;

    let hlCoins: Set<string>;
    try {
      const state = await getUserState(wallet.address);
      hlCoins = new Set(state.assetPositions.map((ap) => ap.position.coin));
    } catch (err) {
      console.error(`[Recovery] HL state fetch failed for chat ${wallet.chatId} — skipping cleanup:`, err);
      continue;
    }

    const dbPositions = await getUserPositions(wallet.chatId);
    const realDbPositions = dbPositions.filter(p => p.accountMode === 'real');
    if (realDbPositions.length === 0) continue;

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