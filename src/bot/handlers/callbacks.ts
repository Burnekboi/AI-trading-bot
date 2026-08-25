import { Context, Markup, Telegraf } from 'telegraf';
import { ethers } from 'ethers';
import { getUser, setUserStep, updateAccountMode, updateUserLastTrade } from '../../db/repositories/users';
import { getUserPositions } from '../../db/repositories/positions';
import { createWallet, getWallet, isValidPrivateKey, deriveAddress, verifyWalletPin } from '../../db/repositories/wallets';
import {
  executeMultipleTrades,
  executeRealMultipleTrades,
  closePosition,
  closePositionByMessage,
  closeAllPositions,
  setPositionMessageId,
} from '../../services/tradeService';
import {
  addPromptMessage,
  clearSession,
  getLimitDuration,
  getPendingAccountMode,
  getPendingPin,
  getTradeMode,
  setLimitDuration,
  setPendingPin,
  takePromptMessageIds,
} from '../session';
import { parseAmount, parseDuration } from '../../utils/parse';
import {
  AI_SCANNING_TEXT,
  IMPORT_WALLET_PROMPT,
  INVALID_PIN_TEXT,
  PIN_PROMPT,
  PROMPT_LIMIT_AMOUNT,
  buildActivePositionText,
  buildActivityListText,
  buildActivityText,
  buildClosedPositionText,
  buildCreateWalletResultText,
  buildDashboardText,
  buildImportWalletResultText,
  buildMainWalletStatusText,
  buildRealDashboardText,
  buildStatsText,
  PROMPT_DEPOSIT_AMOUNT,
} from '../messages';
import {
  activityKeyboard,
  activityListKeyboard,
  backKeyboard,
  importWalletResultKeyboard,
  mainDashboardKeyboard,
  mainWalletViewKeyboard,
  modeSelectKeyboard,
  positionKeyboard,
  realDashboardKeyboard,
  statsKeyboard,
} from '../keyboards';
import { getUserPerformance } from '../../db/repositories/performance';
import { getWalletBalances } from '../../services/balanceService';
import {
  getUserUsdcBalance,
  depositUsdcToHyperliquid,
  getArbitrumBalances,
  waitForHlCredit,
  HL_DEPOSIT_MIN_USDC,
} from '../../services/hyperliquidService';
import type { AccountMode, UserProfile } from '../../types';

async function deletePromptMessages(
  ctx: Context,
  chatId: number
): Promise<void> {
  const ids = takePromptMessageIds(chatId);
  for (const messageId of ids) {
    try {
      await ctx.telegram.deleteMessage(chatId, messageId);
    } catch {
      // Message may already be deleted or too old
    }
  }
}

async function processTradeAmount(
  ctx: Context,
  chatId: number,
  amount: number
): Promise<void> {
  const user = await getUser(chatId);
  if (!user) {
    await ctx.reply('Please send /start to initialize your account.');
    return;
  }

  const positions = await getUserPositions(chatId);
  const allocated = positions.filter(p => p.accountMode !== 'real').reduce((s, p) => s + p.allocatedAmount, 0);
  const available = user.usdtBalance - allocated;

  if (amount < 10) {
    await ctx.reply('Minimum trade amount is 10 USDT. Try again:');
    return;
  }

  if (amount > available) {
    await ctx.reply(
      `Insufficient balance. You have ${available.toFixed(2)} USDT available. Try again:`
    );
    return;
  }

  const maxPairs = Math.max(1, Math.floor(available / amount));
  const maxPairsWithFee = Math.max(1, maxPairs - 1);

  const tradeMode = getTradeMode(chatId);
  await updateUserLastTrade(chatId, amount, tradeMode ?? 'market');
  await setUserStep(chatId, null);

  await deletePromptMessages(ctx, chatId);

  if (maxPairsWithFee <= 1) {
    const scanningMsg = await ctx.reply(AI_SCANNING_TEXT);
    addPromptMessage(chatId, scanningMsg.message_id);

    try {
      const trades = await executeMultipleTrades(chatId, amount, 1, 'simulation');

      await deletePromptMessages(ctx, chatId);

      for (const trade of trades) {
        const cardText = buildActivePositionText(trade);
        const cardMsg = await ctx.reply(cardText, {
          parse_mode: 'HTML',
          ...positionKeyboard(trade.symbol),
        });
        trade.messageId = cardMsg.message_id;
        if (trade.id) await setPositionMessageId(trade.id, cardMsg.message_id);
      }

      clearSession(chatId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Trade execution failed.';
      console.error('[Trade Error]', error);
      await ctx.reply(`❌ ${message}`);
      clearSession(chatId);
    }
  } else {
    await ctx.reply(
      `You can trade up to <b>${maxPairsWithFee} pairs</b> with ${amount} USDT each.\n` +
      `How many pairs do you want to execute?`,
      { parse_mode: 'HTML' }
    );
    await setUserStep(chatId, 'awaiting_pair_count');
  }
}

async function processPairCount(
  ctx: Context,
  chatId: number,
  text: string
): Promise<void> {
  const user = await getUser(chatId);
  if (!user) return;

  const count = parseInt(text, 10);
  if (isNaN(count) || count < 1) {
    await ctx.reply('Please enter a valid number (1 or more).');
    return;
  }

  if (!user.lastTradeAmount) {
    await ctx.reply('Session expired. Please start a new trade.');
    await setUserStep(chatId, null);
    return;
  }

  const amount = user.lastTradeAmount;
  const positions = await getUserPositions(chatId);
  const allocated = positions.filter(p => p.accountMode !== 'real').reduce((s, p) => s + p.allocatedAmount, 0);
  const available = user.usdtBalance - allocated;
  const maxPairs = Math.max(1, Math.floor(available / amount) - 1);

  if (count > maxPairs) {
    await ctx.reply(
      `Maximum ${maxPairs} pairs allowed with ${amount.toFixed(2)} USDT each. Try again:`
    );
    return;
  }

  if (count * amount > available) {
    await ctx.reply(
      `Insufficient balance. Need ${(count * amount).toFixed(2)} USDT, ` +
      `only ${available.toFixed(2)} available. Try again:`
    );
    return;
  }

  await setUserStep(chatId, null);

  const scanningMsg = await ctx.reply(AI_SCANNING_TEXT);
  addPromptMessage(chatId, scanningMsg.message_id);

  try {
    const tradeMode = getTradeMode(chatId);

    const trades = await executeMultipleTrades(chatId, amount, count, 'simulation');

    await deletePromptMessages(ctx, chatId);

    for (const trade of trades) {
      const cardText = buildActivePositionText(trade);
      const cardMsg = await ctx.reply(cardText, {
        parse_mode: 'HTML',
        ...positionKeyboard(trade.symbol),
      });
      trade.messageId = cardMsg.message_id;
      if (trade.id) await setPositionMessageId(trade.id, cardMsg.message_id);
    }

    clearSession(chatId);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Trade execution failed.';
    await ctx.reply(`❌ ${message}`);
    clearSession(chatId);
  }
}

async function processRealTradeAmount(ctx: Context, chatId: number, amount: number): Promise<void> {
  const wallet = await getWallet(chatId);
  if (!wallet) {
    await ctx.reply('No wallet found. Create or import one first.');
    return;
  }

  const hlBalance = await getUserUsdcBalance(wallet.address);

  if (hlBalance < 10) {
    await ctx.reply(`❌ Minimum 10 USDC Hyperliquid balance required. Current: ${hlBalance.toFixed(2)}.`);
    return;
  }

  const positions = await getUserPositions(chatId);
  const realAllocated = positions.filter(p => p.accountMode === 'real').reduce((s, p) => s + p.allocatedAmount, 0);
  const available = hlBalance - realAllocated;

  if (amount < 10) {
    await ctx.reply('Minimum trade amount is 10 USDT. Try again:');
    return;
  }

  if (amount > available) {
    await ctx.reply(`Insufficient HL balance. Available: ${available.toFixed(2)} USDC. Try again:`);
    return;
  }

  const maxPairs = Math.max(1, Math.floor(available / amount));
  const maxPairsWithFee = Math.max(1, maxPairs - 1);

  const tradeMode = getTradeMode(chatId);
  await updateUserLastTrade(chatId, amount, tradeMode ?? 'market');
  await setUserStep(chatId, null);
  await deletePromptMessages(ctx, chatId);

  if (maxPairsWithFee <= 1) {
    const scanningMsg = await ctx.reply(AI_SCANNING_TEXT);
    addPromptMessage(chatId, scanningMsg.message_id);

    try {
      const tradeMode = getTradeMode(chatId) ?? 'market';
      const trades = await executeRealMultipleTrades(chatId, amount, 1, tradeMode);

      await deletePromptMessages(ctx, chatId);

      for (const trade of trades) {
        const cardText = buildActivePositionText(trade);
        const cardMsg = await ctx.reply(cardText, {
          parse_mode: 'HTML',
          ...positionKeyboard(trade.symbol),
        });
        trade.messageId = cardMsg.message_id;
        if (trade.id) await setPositionMessageId(trade.id, cardMsg.message_id);
      }

      clearSession(chatId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Trade execution failed.';
      await ctx.reply(`❌ ${message}`);
      clearSession(chatId);
    }
  } else {
    await ctx.reply(
      `You can trade up to <b>${maxPairsWithFee} pairs</b> with ${amount} USDT each.\n` +
      `How many pairs do you want to execute?`,
      { parse_mode: 'HTML' }
    );
    await setUserStep(chatId, 'awaiting_real_pair_count');
  }
}

async function processRealPairCount(ctx: Context, chatId: number, text: string): Promise<void> {
  const user = await getUser(chatId);
  if (!user) return;

  const count = parseInt(text, 10);
  if (isNaN(count) || count < 1) {
    await ctx.reply('Please enter a valid number (1 or more).');
    return;
  }

  if (!user.lastTradeAmount) {
    await ctx.reply('Session expired. Please start a new trade.');
    await setUserStep(chatId, null);
    return;
  }

  const amount = user.lastTradeAmount;
  const wallet = await getWallet(chatId);
  if (!wallet) {
    await ctx.reply('No wallet found.');
    return;
  }

  const hlBalance = await getUserUsdcBalance(wallet.address);

  const positions = await getUserPositions(chatId);
  const realAllocated = positions.filter(p => p.accountMode === 'real').reduce((s, p) => s + p.allocatedAmount, 0);
  const available = hlBalance - realAllocated;
  const maxPairs = Math.max(1, Math.floor(available / amount) - 1);

  if (count > maxPairs) {
    await ctx.reply(`Maximum ${maxPairs} pairs allowed with ${amount.toFixed(2)} USDT each. Try again:`);
    return;
  }

  if (count * amount > available) {
    await ctx.reply(
      `Insufficient balance. Need ${(count * amount).toFixed(2)} USDT+USDC, ` +
      `only ${available.toFixed(2)} available. Try again:`
    );
    return;
  }

  await setUserStep(chatId, null);

  const scanningMsg = await ctx.reply(AI_SCANNING_TEXT);
  addPromptMessage(chatId, scanningMsg.message_id);

  try {
    const tradeMode = getTradeMode(chatId) ?? 'market';
    const trades = await executeRealMultipleTrades(chatId, amount, count, tradeMode);

    await deletePromptMessages(ctx, chatId);

    for (const trade of trades) {
      const cardText = buildActivePositionText(trade);
      const cardMsg = await ctx.reply(cardText, {
        parse_mode: 'HTML',
        ...positionKeyboard(trade.symbol),
      });
      trade.messageId = cardMsg.message_id;
      if (trade.id) await setPositionMessageId(trade.id, cardMsg.message_id);
    }

    clearSession(chatId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Trade execution failed.';
    await ctx.reply(`❌ ${message}`);
    clearSession(chatId);
  }
}

export function registerTextInputHandler(bot: Telegraf<Context>): void {
  bot.on('text', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return;

    const user = await getUser(chatId);
    if (!user?.currentStep) return;

    const userMessageId = ctx.message.message_id;
    addPromptMessage(chatId, userMessageId);

    switch (user.currentStep) {
      case 'awaiting_limit_duration': {
        const durationMs = parseDuration(text);
        if (!durationMs) {
          await ctx.reply(
            'Invalid duration. Use formats like 1hr, 4hr, 24hr, or 30m.'
          );
          return;
        }
        setLimitDuration(chatId, durationMs);
        await setUserStep(chatId, 'awaiting_limit_amount');
        const msg = await ctx.reply(PROMPT_LIMIT_AMOUNT, backKeyboard());
        addPromptMessage(chatId, msg.message_id);
        break;
      }

      case 'awaiting_trade_amount':
      case 'awaiting_limit_amount': {
        const amount = parseAmount(text);
        if (!amount) {
          await ctx.reply('Invalid amount. Enter a positive number (e.g., 20).');
          return;
        }
        const mode = getPendingAccountMode(chatId) ?? 'simulation';
        if (mode === 'real') {
          await processRealTradeAmount(ctx, chatId, amount);
        } else {
          await processTradeAmount(ctx, chatId, amount);
        }
        break;
      }

      case 'awaiting_pair_count': {
        await processPairCount(ctx, chatId, text);
        break;
      }

      case 'awaiting_real_trade_amount': {
        const amount = parseAmount(text);
        if (!amount) {
          await ctx.reply('Invalid amount. Enter a positive number (e.g., 20).');
          return;
        }
        await processRealTradeAmount(ctx, chatId, amount);
        break;
      }

      case 'awaiting_real_pair_count': {
        await processRealPairCount(ctx, chatId, text);
        break;
      }

      case 'awaiting_deposit_amount': {
        const amount = parseAmount(text);
        if (!amount) {
          await ctx.reply('Invalid amount. Enter a positive number (e.g., 100).');
          return;
        }
        await processDepositAmount(ctx, chatId, amount);
        break;
      }

      case 'awaiting_create_wallet_pin': {
        if (!/^\d{4}$/.test(text)) {
          await ctx.reply(INVALID_PIN_TEXT, { parse_mode: 'HTML' });
          return;
        }

        try {
          const randomWallet = ethers.Wallet.createRandom();
          const wallet = await createWallet(chatId, randomWallet.privateKey, 'ERC20', text);

          await deletePromptMessages(ctx, chatId);
          await setUserStep(chatId, null);

          const resultText = buildCreateWalletResultText(wallet.address, wallet.privateKey);

          await ctx.reply(resultText, {
            parse_mode: 'HTML',
            ...importWalletResultKeyboard(),
          });
        } catch (e) {
          await ctx.reply(`❌ Wallet creation failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
        }
        break;
      }

      case 'awaiting_import_wallet_pin': {
        if (!/^\d{4}$/.test(text)) {
          await ctx.reply(INVALID_PIN_TEXT, { parse_mode: 'HTML' });
          return;
        }

        setPendingPin(chatId, text);
        await setUserStep(chatId, 'awaiting_wallet_pk');

        await deletePromptMessages(ctx, chatId);

        const msg = await ctx.reply(IMPORT_WALLET_PROMPT, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⬅️ Back', 'import_wallet_back')],
          ]),
        });
        addPromptMessage(chatId, msg.message_id);
        break;
      }

      case 'awaiting_view_main_wallet_pin': {
        if (!/^\d{4}$/.test(text)) {
          await ctx.reply(INVALID_PIN_TEXT, { parse_mode: 'HTML' });
          return;
        }

        try {
          const valid = await verifyWalletPin(chatId, text);
          if (!valid) {
            await ctx.reply('❌ Incorrect PIN. Try again:', { parse_mode: 'HTML' });
            return;
          }

          await deletePromptMessages(ctx, chatId);
          await setUserStep(chatId, null);

          const wallet = await getWallet(chatId);
          if (!wallet) {
            await ctx.reply('Wallet not found.');
            return;
          }

          const balances = await getWalletBalances(wallet.address);
          const statusText = buildMainWalletStatusText(wallet, balances);

          await ctx.reply(statusText, {
            parse_mode: 'HTML',
            ...mainWalletViewKeyboard(),
          });
        } catch (e) {
          await ctx.reply(`❌ Error: ${e instanceof Error ? e.message : 'Unknown error'}`);
        }
        break;
      }

      case 'awaiting_wallet_pk': {
        const pendingPin = getPendingPin(chatId);

        if (!isValidPrivateKey(text)) {
          await ctx.reply(
            '❌ Invalid private key. Must be a 64-character hex string (with or without 0x prefix). Try again:',
            { parse_mode: 'HTML', ...backKeyboard() }
          );
          return;
        }

        try {
          const cleaned = text.startsWith('0x') ? text : '0x' + text;
          const address = deriveAddress(cleaned);

          await createWallet(chatId, cleaned, 'ERC20', pendingPin ?? '');
          clearSession(chatId);

          await deletePromptMessages(ctx, chatId);
          await setUserStep(chatId, null);

          const resultText = buildImportWalletResultText(address);

          await ctx.reply(resultText, {
            parse_mode: 'HTML',
            ...importWalletResultKeyboard(),
          });
        } catch (e) {
          await ctx.reply(`❌ Wallet import failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
        }
        break;
      }

    }
  });
}

export function registerStopTradingHandler(bot: Telegraf<Context>): void {
  bot.action('stop_trading', async (ctx) => {
    await ctx.answerCbQuery('Stopping trade...');
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const messageId = ctx.callbackQuery?.message?.message_id;
    if (!messageId) {
      await ctx.reply('Could not identify the position to stop.');
      return;
    }

    try {
      const { position, result } = await closePositionByMessage(chatId, messageId, 'Stopped');
      const text = buildClosedPositionText(position, result);

      if (ctx.callbackQuery?.message) {
        await ctx.editMessageText(text, { parse_mode: 'HTML' });
      } else {
        await ctx.reply(text, { parse_mode: 'HTML' });
      }

      const remaining = (await getUserPositions(chatId)).length;
      const user = await getUser(chatId);
      if (user) {
        const dashboard = buildDashboardText(
          user.address,
          user.usdtBalance,
          user.usdcBalance,
          user.accountMode
        );
        await ctx.reply(dashboard, {
          parse_mode: 'HTML',
          ...mainDashboardKeyboard(remaining > 0),
        });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to stop trade.';
      await ctx.reply(`❌ ${message}`);
    }
  });
}

export function registerStopAllHandler(bot: Telegraf<Context>): void {
  bot.action('stop_all', async (ctx) => {
    await ctx.answerCbQuery('Stopping all trades...');
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    try {
      const results = await closeAllPositions(chatId, 'Stopped');

      const totalPnl = results.reduce((s, r) => s + r.result.pnlUsdt, 0);
      const user = await getUser(chatId);

      if (ctx.callbackQuery?.message && user) {
        const dashboard = buildDashboardText(
          user.address,
          user.usdtBalance,
          user.usdcBalance,
          user.accountMode
        );
        await ctx.editMessageText(dashboard, {
          parse_mode: 'HTML',
          ...mainDashboardKeyboard(false),
        });
      }

      await ctx.reply(
        `✅ Stopped <b>${results.length}</b> position(s).\n` +
        `Total PnL: <b>${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}</b> USDT`,
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to stop trades.';
      await ctx.reply(`❌ ${message}`);
    }
  });
}

export function registerStopLastHandler(bot: Telegraf<Context>): void {
  bot.action('stop_last_trading', async (ctx) => {
    await ctx.answerCbQuery('Stopping last trade...');
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    try {
      const { position, result } = await closePosition(chatId, 'Stopped');
      const remaining = (await getUserPositions(chatId)).length;
      const user = await getUser(chatId);

      if (ctx.callbackQuery?.message && user) {
        const dashboard = buildDashboardText(
          user.address,
          user.usdtBalance,
          user.usdcBalance,
          user.accountMode
        );
        await ctx.editMessageText(dashboard, {
          parse_mode: 'HTML',
          ...mainDashboardKeyboard(remaining > 0),
        });
      }

      await ctx.reply(
        `✅ Stopped <b>${position.symbol}</b> ${position.direction}\n` +
        `PnL: <b>${result.pnlUsdt >= 0 ? '+' : ''}${result.pnlUsdt.toFixed(2)}</b> USDT`,
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to stop trade.';
      await ctx.reply(`❌ ${message}`);
    }
  });
}

export function registerBackToDashboardHandler(bot: Telegraf<Context>): void {
  bot.action('back_to_dashboard', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const user = await getUser(chatId);
    if (!user) {
      await ctx.reply('Please send /start to initialize your account.');
      return;
    }

    const pendingMode = getPendingAccountMode(chatId);

    clearSession(chatId);
    await setUserStep(chatId, null);

    if (pendingMode === 'real' || user.accountMode === 'real') {
      let wallet, balances, hlBalance;
      try {
        wallet = await getWallet(chatId);
        balances = wallet ? await getWalletBalances(wallet.address) : undefined;
        hlBalance = wallet ? await getUserUsdcBalance(wallet.address) : undefined;
      } catch (e) {
        console.error('[back_to_dashboard real] balance error:', e);
      }
      const text = buildRealDashboardText(wallet ?? null, balances, hlBalance);
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...realDashboardKeyboard(!!wallet),
      });
      return;
    }

    const positions = await getUserPositions(chatId);
    const hasPositions = positions.length > 0;
    const text = buildDashboardText(
      user.address,
      user.usdtBalance,
      user.usdcBalance,
      user.accountMode
    );

    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      ...mainDashboardKeyboard(hasPositions),
    });
  });
}

export function registerActivityHandlers(bot: Telegraf<Context>): void {
  bot.action('open_activity', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const openPositions = await getUserPositions(chatId);
    const closedRecords = await getUserPerformance(chatId);
    const openCount = openPositions.length;
    const closedCount = closedRecords.length;
    const text = buildActivityText(openCount, closedCount);

    if (ctx.callbackQuery?.message) {
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        ...activityKeyboard(),
      });
    } else {
      await ctx.reply(text, {
        parse_mode: 'HTML',
        ...activityKeyboard(),
      });
    }
  });

  bot.action('list_activity', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const openPositions = await getUserPositions(chatId);
    const closedRecords = await getUserPerformance(chatId);
    const text = buildActivityListText(openPositions, closedRecords);

    if (ctx.callbackQuery?.message) {
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        ...activityListKeyboard(),
      });
    } else {
      await ctx.reply(text, {
        parse_mode: 'HTML',
        ...activityListKeyboard(),
      });
    }
  });

  bot.action('back_to_activity', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const openPositions = await getUserPositions(chatId);
    const closedRecords = await getUserPerformance(chatId);
    const text = buildActivityText(openPositions.length, closedRecords.length);

    if (ctx.callbackQuery?.message) {
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        ...activityKeyboard(),
      });
    }
  });
}

async function showDashboard(ctx: Context, user: UserProfile, hasPositions: boolean): Promise<void> {
  try {
    if (user.accountMode === 'real') {
      const wallet = await getWallet(user.chatId).catch((err) => {
        console.error('[showDashboard] wallet fetch failed:', err);
        return undefined;
      });
      let balances;
      let hlBalance: number | undefined;
      if (wallet) {
        balances = await getWalletBalances(wallet.address).catch((err) => {
          console.error('[showDashboard] chain balance fetch failed:', err);
          return undefined;
        });
        hlBalance = await getUserUsdcBalance(wallet.address).catch((err) => {
          console.error('[showDashboard] HL balance fetch failed:', err);
          return undefined;
        });
      }
      const text = buildRealDashboardText(wallet ?? null, balances, hlBalance);

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
      return;
    }

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
  } catch (error) {
    console.error('[showDashboard error]', error);
  }
}

async function processDepositAmount(ctx: Context, chatId: number, amount: number): Promise<void> {
  const wallet = await getWallet(chatId);
  if (!wallet) {
    await setUserStep(chatId, null);
    await ctx.reply('Create or import a wallet first.');
    return;
  }

  if (amount < HL_DEPOSIT_MIN_USDC) {
    await ctx.reply(
      `❌ Minimum deposit is ${HL_DEPOSIT_MIN_USDC} USDC — the bridge loses smaller amounts forever. Enter a bigger amount:`
    );
    return;
  }

  let arb;
  try {
    arb = await getArbitrumBalances(wallet.address);
  } catch (err) {
    console.error('[Deposit] Arbitrum balance fetch failed:', err);
    await ctx.reply('⚠️ Could not reach Arbitrum RPC. Try again in a minute.');
    return;
  }

  if (arb.usdc < amount) {
    await ctx.reply(
      `❌ Wallet only has ${arb.usdc.toFixed(2)} USDC on Arbitrum.\n\n` +
      `Send USDC (network: <b>Arbitrum One</b>) to:\n<code>${wallet.address}</code>`,
      { parse_mode: 'HTML' }
    );
    return;
  }
  if (arb.eth < 0.00005) {
    await ctx.reply(
      `❌ No ETH for gas on Arbitrum.\n\n` +
      `Send a little ETH (~$0.10, network: <b>Arbitrum One</b>) to:\n<code>${wallet.address}</code>`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  const hlBefore = await getUserUsdcBalance(wallet.address).catch(() => 0);

  const statusMsg = await ctx.reply(`⏳ Depositing ${amount} USDC to Hyperliquid...`);

  try {
    const txHash = await depositUsdcToHyperliquid(wallet.privateKey, amount);

    await ctx.telegram.editMessageText(
      chatId,
      statusMsg.message_id,
      undefined,
      '✅ Confirmed on Arbitrum.\n⏳ Waiting for Hyperliquid credit (~1 min)...'
    );

    const credited = await waitForHlCredit(wallet.address, hlBefore);

    await setUserStep(chatId, null);

    if (credited !== null) {
      await ctx.reply(
        `💰 <b>Deposit complete!</b>\n\n` +
        `💵 Deposited: <b>${amount.toFixed(2)} USDC</b>\n` +
        `💳 HL balance: <b>${credited.toFixed(2)} USDC</b>\n` +
        `🔗 https://arbiscan.io/tx/${txHash}`,
        { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
      );
    } else {
      await ctx.reply(
        `✅ Transaction confirmed on-chain. Credit is slower than usual but will appear automatically — check your dashboard in a few minutes.\n` +
        `🔗 https://arbiscan.io/tx/${txHash}`,
        { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
      );
    }
  } catch (err) {
    console.error('[Deposit] failed:', err);
    await setUserStep(chatId, null);
    const reason = err instanceof Error ? err.message : 'Unknown error';
    await ctx.reply(`❌ Deposit failed: ${reason}\nYour USDC was not moved.`);
  }
}

async function switchMode(ctx: Context, chatId: number, mode: AccountMode): Promise<void> {
  await ctx.answerCbQuery();
  const user = await getUser(chatId);
  if (!user) {
    await ctx.reply('Please send /start to initialize your account.');
    return;
  }

  await updateAccountMode(chatId, mode);
  user.accountMode = mode;

  const positions = await getUserPositions(chatId);
  await showDashboard(ctx, user, positions.length > 0);
}

export function registerModeHandlers(bot: Telegraf<Context>): void {
  bot.action('start_simulation', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    await switchMode(ctx, chatId, 'simulation');
  });

  bot.action('start_real_money', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    await switchMode(ctx, chatId, 'real');
  });

  bot.action('switch_to_simulation', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    await switchMode(ctx, chatId, 'simulation');
  });

  bot.action('switch_to_real', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    await switchMode(ctx, chatId, 'real');
  });

  bot.action('real_trade', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    await switchMode(ctx, chatId, 'real');
  });

  bot.action('real_deposit', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const wallet = await getWallet(chatId);
    if (!wallet) {
      await ctx.reply('Create or import a wallet first.');
      return;
    }

    await setUserStep(chatId, 'awaiting_deposit_amount');
    const msg = await ctx.reply(PROMPT_DEPOSIT_AMOUNT, {
      parse_mode: 'HTML',
      ...backKeyboard(),
    });
    addPromptMessage(chatId, msg.message_id);
  });
}

export function registerStatsHandlers(bot: Telegraf<Context>): void {
  bot.action('open_stats', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const user = await getUser(chatId);
    if (!user) return;

    const records = await getUserPerformance(chatId);
    const wins = records.filter((r) => r.wasProfitable).length;
    const losses = records.filter((r) => !r.wasProfitable).length;

    const text = buildStatsText(user.usdtBalance, wins, losses);

    if (ctx.callbackQuery?.message) {
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        ...statsKeyboard(),
      });
    } else {
      await ctx.reply(text, {
        parse_mode: 'HTML',
        ...statsKeyboard(),
      });
    }
  });

  bot.action('list_wl', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const records = await getUserPerformance(chatId, 20);

    let text: string;

    if (records.length === 0) {
      text = '<b>📋 Recent Trades</b>\n\nNo trade history yet.';
    } else {
      const lines = records.map((r) => {
        const date = new Date(r.createdAt ?? 0);
        const formatted = date.toLocaleString('en-US', {
          month: '2-digit',
          day: '2-digit',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        });
        const icon = r.wasProfitable ? '🟢' : '🔴';
        const label = r.wasProfitable ? 'WIN' : 'LOSS';
        const pnl = r.pnlUsdt >= 0 ? `+${r.pnlUsdt.toFixed(2)}` : r.pnlUsdt.toFixed(2);
        return `${icon} ${formatted} - ${label} (${pnl})`;
      });

      text = `<b>📋 Recent Trades</b>\n\n${lines.join('\n')}`;
    }

    if (ctx.callbackQuery?.message) {
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        ...backKeyboard(),
      });
    } else {
      await ctx.reply(text, {
        parse_mode: 'HTML',
        ...backKeyboard(),
      });
    }
  });
}
