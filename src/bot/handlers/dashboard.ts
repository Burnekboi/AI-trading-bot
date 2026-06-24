import { Context, Telegraf } from 'telegraf';
import { getUser } from '../../db/repositories/users';
import { getUserPositions } from '../../db/repositories/positions';
import { buildDashboardText } from '../messages';
import { mainDashboardKeyboard } from '../keyboards';

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

    const positions = await getUserPositions(chatId);
    const hasPositions = positions.length > 0;
    const text = buildDashboardText(
      user.address,
      user.usdtBalance,
      user.usdcBalance
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
