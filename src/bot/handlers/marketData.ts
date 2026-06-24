import { Context, Telegraf } from 'telegraf';
import { getUserPerformance } from '../../db/repositories/performance';
import { formatSymbolDisplay } from '../../utils/format';
import * as fs from 'fs';
import * as path from 'path';
import os from 'os';

export function registerMarketDataHandler(bot: Telegraf<Context>): void {
  bot.action('market_data', async (ctx) => {
    await ctx.answerCbQuery('Generating market data...');
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const records = getUserPerformance(chatId, 500);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mktdata-'));
    const filePath = path.join(tmpDir, 'market_data.txt');

    const lines: string[] = [
      '================================================================',
      '                    MARKET DATA - TRADE HISTORY                   ',
      '================================================================',
      '',
      `Generated: ${new Date().toLocaleString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })}`,
      `Total Trades: ${records.length}`,
      `Wins: ${records.filter((r) => r.wasProfitable).length}`,
      `Losses: ${records.filter((r) => !r.wasProfitable).length}`,
      '',
      '================================================================',
      '',
    ];

    if (records.length === 0) {
      lines.push('No trade history available.');
    } else {
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        const date = new Date(r.createdAt ?? 0);
        const formattedDate = date.toLocaleString('en-US', {
          month: '2-digit',
          day: '2-digit',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        });

        const pair = formatSymbolDisplay(r.symbol);
        const result = r.wasProfitable ? 'WIN' : 'LOSS';
        const pnl = r.pnlUsdt >= 0 ? `+${r.pnlUsdt.toFixed(2)}` : r.pnlUsdt.toFixed(2);
        const entry = r.entryPrice.toFixed(8).replace(/\.?0+$/, '');
        const exit = r.exitPrice.toFixed(8).replace(/\.?0+$/, '');
        const sl = r.stopLoss !== null ? r.stopLoss.toFixed(8).replace(/\.?0+$/, '') : 'N/A';
        const tp = r.targetProfit !== null ? r.targetProfit.toFixed(8).replace(/\.?0+$/, '') : 'N/A';

        lines.push(`--- TRADE #${i + 1} ---`);
        lines.push(`  Date & Time    : ${formattedDate}`);
        lines.push(`  Symbol         : ${pair}`);
        lines.push(`  Direction      : ${r.direction}`);
        lines.push(`  Strategy       : ${r.strategyName}`);
        lines.push(`  Entry Price    : ${entry}`);
        lines.push(`  Exit Price     : ${exit}`);
        lines.push(`  Stop Loss      : ${sl}`);
        lines.push(`  Target Profit  : ${tp}`);
        lines.push(`  Result         : ${result} (${pnl} USDT)`);
        lines.push('');
      }
    }

    lines.push('================================================================');
    lines.push('                    END OF REPORT                              ');
    lines.push('================================================================');

    fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');

    try {
      await ctx.replyWithDocument(
        { source: filePath, filename: 'market_data.txt' },
        { caption: '📈 <b>Market Data Report</b>', parse_mode: 'HTML' }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send file.';
      await ctx.reply(`❌ ${message}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
}
