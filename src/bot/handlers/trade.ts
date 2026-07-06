import { Context, Telegraf } from 'telegraf';
import { getUser, setUserStep } from '../../db/repositories/users';
import { getUserPositions } from '../../db/repositories/positions';
import { getWallet } from '../../db/repositories/wallets';
import {
  addPromptMessage,
  clearSession,
  getPendingAccountMode,
  setPendingAccountMode,
  setTradeMode,
} from '../session';
import {
  PROMPT_LIMIT_DURATION,
  promptTradeAmount,
} from '../messages';
import { backKeyboard } from '../keyboards';
import { getUserUsdcBalance } from '../../services/hyperliquidService';

export async function startTradeFlow(ctx: Context, chatId: number, accountMode: 'simulation' | 'real'): Promise<void> {
  clearSession(chatId);
  setPendingAccountMode(chatId, accountMode);
  setTradeMode(chatId, 'market');

  if (accountMode === 'real') {
    const wallet = await getWallet(chatId);
    if (!wallet) {
      await ctx.reply('No wallet found. Create or import one first.');
      return;
    }

    const available = await getUserUsdcBalance(wallet.address);

    if (available < 10) {
      await ctx.reply(
        `❌ Minimum 10 USDC Hyperliquid balance required. Current: ${available.toFixed(2)} USDC.\n\n` +
        `Deposit USDC to Hyperliquid via <a href="https://app.hyperliquid.xyz">app.hyperliquid.xyz</a>`,
        { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
      );
      return;
    }

    await setUserStep(chatId, 'awaiting_real_trade_amount');

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
  } else {
    await setUserStep(chatId, 'awaiting_trade_amount');
    const user = await getUser(chatId);
    if (!user) return;

    const positions = await getUserPositions(chatId);
    const allocated = positions.filter(p => p.accountMode !== 'real').reduce((s, p) => s + p.allocatedAmount, 0);
    const available = user.usdtBalance - allocated;

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
  }
}

export function registerTradeHandlers(bot: Telegraf<Context>): void {
  bot.action('simulation_trade', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const user = await getUser(chatId);
    if (!user) {
      await ctx.reply('Please send /start to initialize your account.');
      return;
    }

    await startTradeFlow(ctx, chatId, 'simulation');
  });

  bot.action('trade_market', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const mode = getPendingAccountMode(chatId) ?? 'simulation';
    await startTradeFlow(ctx, chatId, mode);
  });

  bot.action('trade_limit', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    await clearSession(chatId);
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
