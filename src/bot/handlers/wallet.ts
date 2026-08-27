import { Context, Markup, Telegraf } from 'telegraf';
import { getUser, setUserStep, updateAccountMode } from '../../db/repositories/users';
import { getWallet, deleteWallet, updateApiWallet } from '../../db/repositories/wallets';
import {
  addPromptMessage,
  clearSession,
} from '../session';
import {
  PIN_PROMPT,
  WALLET_DELETED_TEXT,
  buildRealDashboardText,
  buildApiWalletStatusText,
  buildApiWalletSetupResultText,
  buildRealMoneyGuideText,
} from '../messages';
import {
  importWalletResultKeyboard,
  realDashboardKeyboard,
  realPromptBackKeyboard,
  walletStatusKeyboard,
} from '../keyboards';
import { getWalletBalances } from '../../services/balanceService';
import { getUserUsdcBalance, generateAndApproveAgent } from '../../services/hyperliquidService';
import type { AccountMode } from '../../types';

const pinBackKeyboard = (backAction: string) =>
  Markup.inlineKeyboard([
  [Markup.button.callback('⬅️ Back', backAction)],
]);

export async function showRealDashboard(ctx: Context, chatId: number): Promise<void> {
  try {
    const user = await getUser(chatId);
    if (!user) return;
    const wallet = await getWallet(chatId);
    let balances;
    let hlBalance: number | undefined;
    if (wallet) {
      balances = await getWalletBalances(wallet.address).catch((err) => {
        console.error('[showRealDashboard] chain balance fetch failed:', err);
        return undefined;
      });
      hlBalance = await getUserUsdcBalance(wallet.address).catch((err) => {
        console.error('[showRealDashboard] HL balance fetch failed:', err);
        return undefined;
      });
    }
    const text = buildRealDashboardText(wallet, balances, hlBalance);

    if (ctx.callbackQuery?.message) {
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...realDashboardKeyboard(wallet !== null),
      });
    } else {
      await ctx.reply(text, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...realDashboardKeyboard(wallet !== null),
      });
    }
  } catch (error) {
    console.error('[showRealDashboard error]', error);
  }
}

export function registerWalletHandlers(bot: Telegraf<Context>): void {
  bot.action('real_create_wallet', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const existing = await getWallet(chatId);
    if (existing) {
      await ctx.reply('You already have a wallet. Delete it first before creating a new one.');
      return;
    }

    clearSession(chatId);
    await setUserStep(chatId, 'awaiting_create_wallet_pin');

    if (ctx.callbackQuery?.message) {
      await ctx.editMessageText(PIN_PROMPT, {
        parse_mode: 'HTML',
        ...pinBackKeyboard('import_wallet_back'),
      });
      addPromptMessage(chatId, ctx.callbackQuery.message.message_id);
    } else {
      const msg = await ctx.reply(PIN_PROMPT, {
        parse_mode: 'HTML',
        ...pinBackKeyboard('import_wallet_back'),
      });
      addPromptMessage(chatId, msg.message_id);
    }
  });

  bot.action('real_import_wallet', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const wallet = await getWallet(chatId);
    if (wallet) {
      await ctx.reply('You already have a wallet. Delete it first before importing a new one.');
      return;
    }

    clearSession(chatId);
    await setUserStep(chatId, 'awaiting_import_wallet_pin');

    if (ctx.callbackQuery?.message) {
      await ctx.editMessageText(PIN_PROMPT, {
        parse_mode: 'HTML',
        ...pinBackKeyboard('import_wallet_back'),
      });
      addPromptMessage(chatId, ctx.callbackQuery.message.message_id);
    } else {
      const msg = await ctx.reply(PIN_PROMPT, {
        parse_mode: 'HTML',
        ...pinBackKeyboard('import_wallet_back'),
      });
      addPromptMessage(chatId, msg.message_id);
    }
  });

  bot.action('real_delete_wallet', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    await deleteWallet(chatId);

    if (ctx.callbackQuery?.message) {
      await ctx.editMessageText(WALLET_DELETED_TEXT, {
        parse_mode: 'HTML',
        ...realDashboardKeyboard(false),
      });
    }
  });

  bot.action('start_trading_real', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    try {
      const { startTradeFlow } = await import('./trade');
      await startTradeFlow(ctx, chatId, 'real');
    } catch (error) {
      console.error('[start_trading_real error]', error);
      await ctx
        .editMessageText('⚠️ Something went wrong. Please try again.', {
          parse_mode: 'HTML',
          ...realDashboardKeyboard(true),
        })
        .catch(() => {});
    }
  });

  bot.action('wallet_status', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    try {
      const wallet = await getWallet(chatId);
      if (!wallet) {
        await showRealDashboard(ctx, chatId);
        return;
      }

      clearSession(chatId);
      await setUserStep(chatId, null);

      const text = buildApiWalletStatusText(wallet);
      const hasApi = !!wallet.apiWalletPrivateKey;

      if (ctx.callbackQuery?.message) {
        await ctx.editMessageText(text, {
          parse_mode: 'HTML',
          ...walletStatusKeyboard(hasApi),
        });
      } else {
        await ctx.reply(text, {
          parse_mode: 'HTML',
          ...walletStatusKeyboard(hasApi),
        });
      }
    } catch (error) {
      console.error('[wallet_status error]', error);
      await ctx
        .editMessageText('⚠️ Could not load wallet status. Try again.', {
          parse_mode: 'HTML',
          ...realDashboardKeyboard(true),
        })
        .catch(() => {});
    }
  });

  bot.action('view_main_wallet', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    clearSession(chatId);
    await setUserStep(chatId, 'awaiting_view_main_wallet_pin');

    if (ctx.callbackQuery?.message) {
      await ctx.editMessageText(PIN_PROMPT, {
        parse_mode: 'HTML',
        ...pinBackKeyboard('wallet_status_back'),
      });
      addPromptMessage(chatId, ctx.callbackQuery.message.message_id);
    }
  });

  bot.action('back_to_wallet_status', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    try {
      const wallet = await getWallet(chatId);
      if (!wallet) {
        await showRealDashboard(ctx, chatId);
        return;
      }

      const text = buildApiWalletStatusText(wallet);
      const hasApi = !!wallet.apiWalletPrivateKey;

      if (ctx.callbackQuery?.message) {
        await ctx.editMessageText(text, {
          parse_mode: 'HTML',
          ...walletStatusKeyboard(hasApi),
        });
      }
    } catch (error) {
      console.error('[back_to_wallet_status error]', error);
    }
  });

  bot.action('setup_api_wallet', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const wallet = await getWallet(chatId);
    if (!wallet) {
      await showRealDashboard(ctx, chatId);
      return;
    }

    if (wallet.apiWalletPrivateKey) {
      await ctx.reply('API wallet is already configured.');
      return;
    }

    try {
      const hlUsdc = await getUserUsdcBalance(wallet.address);
      if (hlUsdc < 0.02) {
        await ctx.editMessageText(
          `❌ API wallet setup requires a tiny USDC balance on Hyperliquid for gas.\n\n` +
          `You have <b>${hlUsdc.toFixed(4)} USDC</b> on HL.\n\n` +
          `Deposit at least ~$1 USDC first, then try again.`,
          { parse_mode: 'HTML', ...realDashboardKeyboard(true) }
        );
        return;
      }

      await ctx.editMessageText('⏳ Generating and approving API wallet on Hyperliquid...');

      const result = await generateAndApproveAgent(wallet.privateKey);

      await updateApiWallet(chatId, result.apiAddress, result.apiPrivateKey);

      const text = buildApiWalletSetupResultText(result.apiAddress, result.apiPrivateKey);

      if (ctx.callbackQuery?.message) {
        await ctx.editMessageText(text, {
          parse_mode: 'HTML',
          ...walletStatusKeyboard(true),
        });
      } else {
        await ctx.reply(text, {
          parse_mode: 'HTML',
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Setup API Wallet Error]', error);
      await ctx.editMessageText(`❌ API wallet setup failed: ${message}`, {
        parse_mode: 'HTML',
      });
    }
  });

  bot.action('wallet_status_back', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    clearSession(chatId);
    await setUserStep(chatId, null);
    await showRealDashboard(ctx, chatId);
  });

  bot.action('real_money_guide', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const text = buildRealMoneyGuideText();

    try {
      if (ctx.callbackQuery?.message) {
        await ctx.editMessageText(text, {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          ...realPromptBackKeyboard(),
        });
      } else {
        await ctx.reply(text, {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          ...realPromptBackKeyboard(),
        });
      }
    } catch (error) {
      console.error('[real_money_guide error]', error);
    }
  });

  bot.action('real_back', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    await updateAccountMode(chatId, 'simulation' as AccountMode);

    const { modeSelectKeyboard } = await import('../keyboards');
    const { buildWelcomeText } = await import('../messages');
    const user = await getUser(chatId);
    if (!user) return;

    if (ctx.callbackQuery?.message) {
      await ctx.editMessageText(buildWelcomeText(user.address), {
        parse_mode: 'HTML',
        ...modeSelectKeyboard(),
      });
    }
  });

  bot.action('real_deposit_back', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    clearSession(chatId);
    await setUserStep(chatId, null);
    await showRealDashboard(ctx, chatId);
  });

  bot.action('import_wallet_back', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    clearSession(chatId);
    await setUserStep(chatId, null);
    await showRealDashboard(ctx, chatId);
  });
}
