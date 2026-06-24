import { Context, Telegraf } from 'telegraf';
import { registerStartHandler } from './handlers/start';
import { registerDashboardHandler } from './handlers/dashboard';
import { registerTradeHandlers } from './handlers/trade';
import {
  registerActivityHandlers,
  registerTextInputHandler,
  registerStopTradingHandler,
  registerStopAllHandler,
  registerStopLastHandler,
  registerBackToDashboardHandler,
  registerStatsHandlers,
} from './handlers/callbacks';
import { registerMarketDataHandler } from './handlers/marketData';
import { startPositionMonitor } from '../services/positionMonitor';

export function createBot(token: string): Telegraf<Context> {
  const bot = new Telegraf<Context>(token);

  registerStartHandler(bot);
  registerDashboardHandler(bot);
  registerTradeHandlers(bot);
  registerTextInputHandler(bot);
  registerStopTradingHandler(bot);
  registerStopAllHandler(bot);
  registerStopLastHandler(bot);
  registerActivityHandlers(bot);
  registerBackToDashboardHandler(bot);
  registerStatsHandlers(bot);
  registerMarketDataHandler(bot);

  bot.catch((error, ctx) => {
    console.error(`Bot error for update ${ctx.updateType}:`, error);
  });

  startPositionMonitor(bot);

  return bot;
}
