import { Context, Markup, Telegraf } from 'telegraf';
import { getUser, setUserStep, updateAccountMode } from '../../db/repositories/users';
import { getWallet, deleteWallet, updateWalletNetwork } from '../../db/repositories/wallets';
import {
  addPromptMessage,
  clearSession,
} from '../session';
import {
  PIN_PROMPT,
  WALLET_DELETED_TEXT,
  buildRealDashboardText,
} from '../messages';
import {
  importWalletResultKeyboard,
  realDashboardKeyboard,
} from '../keyboards';
import { getWalletBalances } from '../../services/balanceService';
import type { AccountMode, WalletNetwork } from '../../types';

const pinBackKeyboard = (backAction: string) =>
  Markup.inlineKeyboard([
  [Markup.button.callback('⬅️ Back', backAction)],
]);

async function showRealDashboard(ctx: Context, chatId: number): Promise<void> {
  const user = await getUser(chatId);
  if (!user) return;
  const wallet = await getWallet(chatId);
  const text = buildRealDashboardText(wallet);

  if (ctx.callbackQuery?.message) {
    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      ...realDashboardKeyboard(wallet !== null),
    }).catch(() => {});
  } else {
    await ctx.reply(text, {
      parse_mode: 'HTML',
      ...realDashboardKeyboard(wallet !== null),
    });
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
    await ctx.answerCbQuery('🚀 Real trading coming soon!');
  });

  bot.action('wallet_status', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const wallet = await getWallet(chatId);
    if (!wallet) {
      await showRealDashboard(ctx, chatId);
      return;
    }

    clearSession(chatId);
    await setUserStep(chatId, 'awaiting_wallet_status_pin');

    if (ctx.callbackQuery?.message) {
      await ctx.editMessageText(PIN_PROMPT, {
        parse_mode: 'HTML',
        ...pinBackKeyboard('wallet_status_back'),
      });
      addPromptMessage(chatId, ctx.callbackQuery.message.message_id);
    }
  });

  bot.action('wallet_status_back', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    clearSession(chatId);
    await setUserStep(chatId, null);
    await showRealDashboard(ctx, chatId);
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

  bot.action('import_wallet_erc20', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    await updateWalletNetwork(chatId, 'ERC20');

    const wallet = await getWallet(chatId);
    if (!wallet) return;

    const balances = await getWalletBalances(wallet.address);
    const text =
      `📥 <b>Wallet Imported</b>\n` +
      `Network: <b>ERC-20 (ETH)</b>\n` +
      `Address: <code>${wallet.address}</code>\n\n` +
      `💰 <b>Balances:</b>\n` +
      `• USDT (ERC-20): ${balances.erc20Usdt.toFixed(2)}\n` +
      `• USDC (ERC-20): ${balances.erc20Usdc.toFixed(2)}\n` +
      `• USDT (BEP-20): ${balances.bep20Usdt.toFixed(2)}\n` +
      `• USDC (BEP-20): ${balances.bep20Usdc.toFixed(2)}`;

    if (ctx.callbackQuery?.message) {
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        ...importWalletResultKeyboard(),
      });
    }
  });

  bot.action('import_wallet_bep20', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    await updateWalletNetwork(chatId, 'BEP20');

    const wallet = await getWallet(chatId);
    if (!wallet) return;

    const balances = await getWalletBalances(wallet.address);
    const text =
      `📥 <b>Wallet Imported</b>\n` +
      `Network: <b>BEP-20 (BNB)</b>\n` +
      `Address: <code>${wallet.address}</code>\n\n` +
      `💰 <b>Balances:</b>\n` +
      `• USDT (ERC-20): ${balances.erc20Usdt.toFixed(2)}\n` +
      `• USDC (ERC-20): ${balances.erc20Usdc.toFixed(2)}\n` +
      `• USDT (BEP-20): ${balances.bep20Usdt.toFixed(2)}\n` +
      `• USDC (BEP-20): ${balances.bep20Usdc.toFixed(2)}`;

    if (ctx.callbackQuery?.message) {
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        ...importWalletResultKeyboard(),
      });
    }
  });

  bot.action('import_wallet_back', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    clearSession(chatId);
    await setUserStep(chatId, null);
    await showRealDashboard(ctx, chatId);
  });
}
