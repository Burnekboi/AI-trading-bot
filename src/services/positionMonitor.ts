import { Telegraf } from 'telegraf';
import { config } from '../config';
import { getAllActivePositions } from '../db/repositories/positions';
import { getCurrentPrice } from '../mexc/client';
import {
  closePositionByMessage,
  isStopLossHit,
  isTakeProfitHit,
  autoStartTrade,
  savePosition,
} from './tradeService';
import {
  buildClosedPositionText,
  buildActivePositionText,
} from '../bot/messages';
import { positionKeyboard } from '../bot/keyboards';

let monitorInterval: ReturnType<typeof setInterval> | null = null;

export function startPositionMonitor(bot: Telegraf): void {
  if (monitorInterval) return;

  monitorInterval = setInterval(async () => {
    const positions = await getAllActivePositions();

    for (const position of positions) {
      try {
        const now = Date.now();
        const currentPrice = await getCurrentPrice(position.symbol);

        const timerExpired =
          position.timerExpiresAt !== null && now >= position.timerExpiresAt;

        const slHit = isStopLossHit(
          position.direction,
          currentPrice,
          position.stopLoss
        );

        const tpHit = isTakeProfitHit(
          position.direction,
          currentPrice,
          position.targetProfit
        );

        if (!timerExpired && !slHit && !tpHit) continue;

        const { result } = await closePositionByMessage(
          position.chatId,
          position.messageId,
          'Ended..',
          currentPrice
        );
        const text = buildClosedPositionText(position, result);

        try {
          await bot.telegram.editMessageText(
            position.chatId,
            position.messageId,
            undefined,
            text,
            { parse_mode: 'HTML' }
          );
        } catch {
          // Message may have been deleted
        }

        if (slHit) {
          const next = await autoStartTrade(position.chatId);
          if (next) {
            const cardText = buildActivePositionText(next);
            const msg = await bot.telegram.sendMessage(
              position.chatId,
              cardText,
              {
                parse_mode: 'HTML',
                ...positionKeyboard(next.symbol),
              }
            );
            next.messageId = msg.message_id;
            savePosition(next);
          }
        }
      } catch (error) {
        console.error(
          `Position monitor error for chat ${position.chatId}:`,
          error
        );
      }
    }
  }, config.positionPollIntervalMs);

  console.log(
    `Position monitor started (interval: ${config.positionPollIntervalMs}ms)`
  );
}

export function stopPositionMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}

export async function refreshActivePositionCard(
  bot: Telegraf,
  chatId: number
): Promise<void> {
  const all = await getAllActivePositions();
  const positions = all.filter((p) => p.chatId === chatId);
  for (const position of positions) {
    const text = buildActivePositionText(position);
    await bot.telegram.editMessageText(
      chatId,
      position.messageId,
      undefined,
      text,
      {
        parse_mode: 'HTML',
        ...positionKeyboard(position.symbol),
      }
    );
  }
}
