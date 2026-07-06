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
import { backKeyboard, realDashboardKeyboard } from '../keyboards';
import { getUserUsdcBalance } from '../../services/hyperliquidService';

export async function startTradeFlow(ctx: Context, chatId: number, accountMode: 'simulation' | 'real'): Promise<void> {
  clearSession(chatId);
  setPendingAccountMode(chatId, accountMode);
  setTradeMode(chatId, 'market');

  if (accountMode === 'real') {
    const wallet = await getWallet(chatId);
    if (!wallet) {
      if (ctx.callbackQuery?.message) {
        await ctx.editMessageText(
          'No wallet found. Create or import one first.',
          { ...realDashboardKeyboard(false) }
        );
      }
      return;
    }

    if (!wallet.apiWalletPrivateKey) {
      if (ctx.callbackQuery?.message) {
        await ctx.editMessageText(
          '⚠️ <b>Cannot trade real money yet.</b>\n\n' +
          '• <b>Requirements:</b> 10+ USDC on Hyperliquid + an API wallet\n\n' +
          'Go to <b>Wallet Status → [SET UP API WALLET]</b>\n' +
          '(costs ~$0.01 USDC on Hyperliquid).\n\n' +
          'This creates a separate API wallet for trading while keeping your main wallet safe.\n\n' +
          '📖 Check the GUIDE button for deposit + setup walkthrough.',
          { parse_mode: 'HTML', ...realDashboardKeyboard(true) }
        );
      }
      return;
    }

    const available = await getUserUsdcBalance(wallet.address);

    if (available < 10) {
      if (ctx.callbackQuery?.message) {
        await ctx.editMessageText(
          `❌ Minimum <b>10 USDC</b> required. Current: <b>${available.toFixed(2)}</b> USDC.\n\n` +
          `Deposit via <a href="https://app.hyperliquid.xyz">app.hyperliquid.xyz</a>\n\n` +
          `📖 Check the GUIDE button for step-by-step deposit instructions.`,
          { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...realDashboardKeyboard(true) }
        );
      }
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
    const user = await getUser(chatId);
    setPendingAccountMode(chatId, user?.accountMode ?? 'simulation');
    setTradeMode(chatId, 'limit');
    await setUserStep(chatId, 'awaiting_limit_duration');

    if (ctx.callbackQuery?.message) {
      await ctx.editMessageText(PROMPT_LIMIT_DURATION, {
        parse_mode: 'HTML',
        ...backKeyboard(),
      });
      addPromptMessage(chatId, ctx.callbackQuery.message.message_id);
    } else {
      const msg = await ctx.reply(PROMPT_LIMIT_DURATION, {
        parse_mode: 'HTML',
        ...backKeyboard(),
      });
      addPromptMessage(chatId, msg.message_id);
    }
  });
}
