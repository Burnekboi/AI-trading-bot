import { Context, Telegraf } from 'telegraf';
import { getUser, setUserStep } from '../../db/repositories/users';
import { getUserPositions } from '../../db/repositories/positions';
import {
  addPromptMessage,
  clearSession,
  setTradeMode,
} from '../session';
import {
  PROMPT_LIMIT_DURATION,
  promptTradeAmount,
} from '../messages';
import { backKeyboard } from '../keyboards';

export function registerTradeHandlers(bot: Telegraf<Context>): void {
  bot.action('trade_market', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const user = await getUser(chatId);
    if (!user) {
      await ctx.reply('Please send /start to initialize your account.');
      return;
    }

    const positions = await getUserPositions(chatId);
    const allocated = positions.reduce((s, p) => s + p.allocatedAmount, 0);
    const available = user.usdtBalance - allocated;

    clearSession(chatId);
    setTradeMode(chatId, 'market');
    await setUserStep(chatId, 'awaiting_trade_amount');

    const text = promptTradeAmount(available);

    if (ctx.callbackQuery?.message) {
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        ...backKeyboard(),
      });
      addPromptMessage(chatId, ctx.callbackQuery.message.message_id);
    } else {
      const msg = await ctx.reply(text, {
        parse_mode: 'HTML',
        ...backKeyboard(),
      });
      addPromptMessage(chatId, msg.message_id);
    }
  });

  bot.action('trade_limit', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    if (!(await getUser(chatId))) {
      await ctx.reply('Please send /start to initialize your account.');
      return;
    }

    clearSession(chatId);
    setTradeMode(chatId, 'limit');
    await setUserStep(chatId, 'awaiting_limit_duration');

    if (ctx.callbackQuery?.message) {
      await ctx.editMessageText(PROMPT_LIMIT_DURATION, {
        parse_mode: 'HTML',
        ...backKeyboard(),
      });
      addPromptMessage(chatId, ctx.callbackQuery.message.message_id);
    } else {
      const msg = await ctx.reply(PROMPT_LIMIT_DURATION, backKeyboard());
      addPromptMessage(chatId, msg.message_id);
    }
  });
}
