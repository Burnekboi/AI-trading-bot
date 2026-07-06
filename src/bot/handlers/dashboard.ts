import { Context, Telegraf } from 'telegraf';
import { getUser } from '../../db/repositories/users';
import { getWallet } from '../../db/repositories/wallets';
import { getWalletBalances } from '../../services/balanceService';
import { getUserUsdcBalance } from '../../services/hyperliquidService';
import { buildDashboardText, buildRealDashboardText } from '../messages';
import { mainDashboardKeyboard, realDashboardKeyboard } from '../keyboards';

export function registerDashboardHandler(bot: Telegraf<Context>): void {
  bot.action('open_dashboard', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const user = await getUser(chatId);
    if (!user) {
      await ctx.reply('Please send /start to initialize your account.');
      return;
    }

    if (user.accountMode === 'real') {
      const wallet = await getWallet(chatId);
      const balances = wallet ? await getWalletBalances(wallet.address) : undefined;
      const hlBalance = wallet ? await getUserUsdcBalance(wallet.address) : undefined;
      const text = buildRealDashboardText(wallet, balances, hlBalance);

      if (ctx.callbackQuery?.message) {
        await ctx.editMessageText(text, {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          ...realDashboardKeyboard(wallet !== null),
        }).catch(() => {});
      } else {
        await ctx.reply(text, {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          ...realDashboardKeyboard(wallet !== null),
        });
      }
      return;
    }

    const positions = await (await import('../../db/repositories/positions')).getUserPositions(chatId);
    const hasPositions = positions.length > 0;
    const text = buildDashboardText(
      user.address,
      user.usdtBalance,
      user.usdcBalance,
      user.accountMode
    );

    if (ctx.callbackQuery?.message) {
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        ...mainDashboardKeyboard(hasPositions),
      });
    } else {
      await ctx.reply(text, {
        parse_mode: 'HTML',
        ...mainDashboardKeyboard(hasPositions),
      });
    }
  });
}
