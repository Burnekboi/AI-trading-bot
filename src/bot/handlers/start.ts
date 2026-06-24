import { Context, Telegraf } from 'telegraf';
import { config } from '../../config';
import { getOrCreateUser } from '../../db/repositories/users';
import { buildWelcomeText } from '../messages';
import { dashboardKeyboard } from '../keyboards';

export function registerStartHandler(bot: Telegraf<Context>): void {
  bot.command('start', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const user = await getOrCreateUser(chatId, config.defaultBalance);
    const text = buildWelcomeText(user.address);

    await ctx.reply(text, {
      parse_mode: 'HTML',
      ...dashboardKeyboard(),
    });
  });
}
