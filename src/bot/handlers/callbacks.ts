import { Context, Telegraf } from 'telegraf';
import { getUser, setUserStep, updateUserLastTrade } from '../../db/repositories/users';
import { getUserPositions } from '../../db/repositories/positions';
import {
  executeMultipleTrades,
  closePosition,
  closePositionByMessage,
  closeAllPositions,
  savePosition,
} from '../../services/tradeService';
import {
  addPromptMessage,
  clearSession,
  getLimitDuration,
  getTradeMode,
  setLimitDuration,
  takePromptMessageIds,
} from '../session';
import { parseAmount, parseDuration } from '../../utils/parse';
import {
  AI_SCANNING_TEXT,
  PROMPT_LIMIT_AMOUNT,
  buildActivePositionText,
  buildClosedPositionText,
  buildDashboardText,
  buildStatsText,
} from '../messages';
import { backKeyboard, mainDashboardKeyboard, positionKeyboard, statsKeyboard } from '../keyboards';
import { getUserPerformance } from '../../db/repositories/performance';

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
  const allocated = positions.reduce((s, p) => s + p.allocatedAmount, 0);
  const available = user.usdtBalance - allocated;

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
      const trades = await executeMultipleTrades(chatId, amount, 1);

      await deletePromptMessages(ctx, chatId);

      for (const trade of trades) {
        const cardText = buildActivePositionText(trade);
        const cardMsg = await ctx.reply(cardText, {
          parse_mode: 'HTML',
          ...positionKeyboard(trade.symbol),
        });
        trade.messageId = cardMsg.message_id;
        await savePosition(trade);
      }

      clearSession(chatId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Trade execution failed.';
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
  const allocated = positions.reduce((s, p) => s + p.allocatedAmount, 0);
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

    const trades = await executeMultipleTrades(chatId, amount, count);

    await deletePromptMessages(ctx, chatId);

    for (const trade of trades) {
      const cardText = buildActivePositionText(trade);
      const cardMsg = await ctx.reply(cardText, {
        parse_mode: 'HTML',
        ...positionKeyboard(trade.symbol),
      });
      trade.messageId = cardMsg.message_id;
      await savePosition(trade);
    }

    clearSession(chatId);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Trade execution failed.';
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
        await processTradeAmount(ctx, chatId, amount);
        break;
      }

      case 'awaiting_pair_count': {
        await processPairCount(ctx, chatId, text);
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
          user.usdcBalance
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
          user.usdcBalance
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
          user.usdcBalance
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

    clearSession(chatId);
    await setUserStep(chatId, null);

    const positions = await getUserPositions(chatId);
    const hasPositions = positions.length > 0;
    const text = buildDashboardText(
      user.address,
      user.usdtBalance,
      user.usdcBalance
    );

    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      ...mainDashboardKeyboard(hasPositions),
    });
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
