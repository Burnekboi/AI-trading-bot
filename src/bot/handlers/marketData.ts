import { Context, Telegraf } from 'telegraf';
import { getUserPerformance } from '../../db/repositories/performance';
import { formatSymbolDisplay } from '../../utils/format';
import * as fs from 'fs';

const MAX_TEXT_LENGTH = 3900;

function buildReport(records: Awaited<ReturnType<typeof getUserPerformance>>): string {
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

  return lines.join('\n');
}

function sendAsText(ctx: Context, text: string, page: number = 1): void {
  const header = page === 1
    ? '<b>📈 Market Data Report</b>\n\n<pre>'
    : '<pre>(continued)\n';
  const footer = page === 1 ? '</pre>' : '\n</pre>';

  const available = MAX_TEXT_LENGTH - header.length - footer.length;
  const chunk = text.slice(0, available);

  ctx.reply(`${header}${chunk}${footer}`, {
    parse_mode: 'HTML',
  }).catch(() => {});

  const rest = text.slice(available);
  if (rest.length > 0) {
    sendAsText(ctx, rest, page + 1);
  }
}

export function registerMarketDataHandler(bot: Telegraf<Context>): void {
  bot.action('market_data', async (ctx) => {
    await ctx.answerCbQuery('Generating market data...');
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const records = await getUserPerformance(chatId, 500);
    const content = buildReport(records);
    const buf = Buffer.from(content, 'utf-8');

    try {
      await ctx.replyWithDocument(
        { source: buf, filename: 'market_data.txt' },
        { caption: '📈 <b>Market Data Report</b>', parse_mode: 'HTML' }
      );
    } catch {
      // File upload failed — send as text split into chunks
      await ctx.reply('⚠️ File upload failed, sending as text message(s)...');
      sendAsText(ctx, content);
    }
  });
}
