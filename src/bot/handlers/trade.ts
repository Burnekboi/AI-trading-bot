import { Context, Telegraf } from 'telegraf';
import { getUser, setUserStep } from '../../db/repositories/users';
import {
  addPromptMessage,
  clearSession,
  setTradeMode,
} from '../session';
import {
  PROMPT_LIMIT_DURATION,
  PROMPT_TRADE_AMOUNT,
} from '../messages';
import { backKeyboard } from '../keyboards';

export function registerTradeHandlers(bot: Telegraf<Context>): void {
  bot.action('trade_market', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    if (!getUser(chatId)) {
      await ctx.reply('Please send /start to initialize your account.');
      return;
    }

    clearSession(chatId);
    setTradeMode(chatId, 'market');
    setUserStep(chatId, 'awaiting_trade_amount');

    if (ctx.callbackQuery?.message) {
      await ctx.editMessageText(PROMPT_TRADE_AMOUNT, {
        parse_mode: 'HTML',
        ...backKeyboard(),
      });
      addPromptMessage(chatId, ctx.callbackQuery.message.message_id);
    } else {
      const msg = await ctx.reply(PROMPT_TRADE_AMOUNT, backKeyboard());
      addPromptMessage(chatId, msg.message_id);
    }
  });

  bot.action('trade_limit', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    if (!getUser(chatId)) {
      await ctx.reply('Please send /start to initialize your account.');
      return;
    }

    clearSession(chatId);
    setTradeMode(chatId, 'limit');
    setUserStep(chatId, 'awaiting_limit_duration');

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
