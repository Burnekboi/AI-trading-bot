import { Context, Telegraf } from 'telegraf';
import { getUser, setUserStep } from '../../db/repositories/users';
import { getWallet, deleteWallet } from '../../db/repositories/wallets';
import {
  addPromptMessage,
  clearSession,
  takePromptMessageIds,
} from '../session';
import {
  CREATE_WALLET_TEXT,
  IMPORT_WALLET_PROMPT,
  WALLET_DELETED_TEXT,
  buildRealDashboardText,
} from '../messages';
import {
  backKeyboard,
  createWalletKeyboard,
  importWalletResultKeyboard,
  realDashboardKeyboard,
} from '../keyboards';
import type { AccountMode } from '../../types';
import { updateAccountMode } from '../../db/repositories/users';

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

    const wallet = await getWallet(chatId);
    if (wallet) {
      await ctx.reply('You already have a wallet. Delete it first before creating a new one.');
      return;
    }

    if (ctx.callbackQuery?.message) {
      await ctx.editMessageText(CREATE_WALLET_TEXT, {
        parse_mode: 'HTML',
        ...createWalletKeyboard(),
      });
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
    await setUserStep(chatId, 'awaiting_wallet_pk');

    if (ctx.callbackQuery?.message) {
      await ctx.editMessageText(IMPORT_WALLET_PROMPT, {
        parse_mode: 'HTML',
        ...backKeyboard(),
      });
      addPromptMessage(chatId, ctx.callbackQuery.message.message_id);
    } else {
      const msg = await ctx.reply(IMPORT_WALLET_PROMPT, {
        parse_mode: 'HTML',
        ...backKeyboard(),
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

  bot.action('create_wallet_erc20', async (ctx) => {
    await ctx.answerCbQuery('ERC-20 wallet creation coming soon!');
  });

  bot.action('create_wallet_bep20', async (ctx) => {
    await ctx.answerCbQuery('BEP-20 wallet creation coming soon!');
  });

  bot.action('create_wallet_back', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    await showRealDashboard(ctx, chatId);
  });

  bot.action('import_wallet_erc20', async (ctx) => {
    await ctx.answerCbQuery('ERC-20 balance display coming soon!');
  });

  bot.action('import_wallet_bep20', async (ctx) => {
    await ctx.answerCbQuery('BEP-20 balance display coming soon!');
  });

  bot.action('import_wallet_back', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    await showRealDashboard(ctx, chatId);
  });
}
