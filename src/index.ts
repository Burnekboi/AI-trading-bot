import http from 'http';
import { Telegraf } from 'telegraf';
import { config } from './config';
import { initDatabase } from './db/database';
import { createBot } from './bot';
import { stopPositionMonitor } from './services/positionMonitor';

const PORT = Number(process.env.PORT ?? 3000);

let botStatus: 'starting' | 'running' | 'error' = 'starting';

async function launchBot(bot: Telegraf): Promise<void> {
  const MAX_RETRIES = 5;
  const RETRY_DELAY = 2000;

  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      await bot.launch();
      return;
    } catch (error) {
      const is409 = error instanceof Error &&
        (error as any).response?.error_code === 409;

      if (is409 && i < MAX_RETRIES - 1) {
        console.log(
          `Polling conflict (${i + 1}/${MAX_RETRIES}), retrying in ${RETRY_DELAY}ms...`
        );
        await new Promise((r) => setTimeout(r, RETRY_DELAY));
        continue;
      }
      throw error;
    }
  }
}

async function main(): Promise<void> {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/health' && req.method === 'GET') {
      const healthy = botStatus === 'running';
      res.writeHead(healthy ? 200 : 503);
      res.end(JSON.stringify({
        status: healthy ? 'ok' : botStatus,
        uptime: process.uptime(),
      }));
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  });

  server.listen(PORT, () => {
    console.log(`Health server listening on port ${PORT}`);
  });

  try {
    await initDatabase();
    const bot = createBot(config.botToken);

    const shutdown = async (signal: string) => {
      console.log(`\nReceived ${signal}, shutting down...`);
      stopPositionMonitor();
      bot.stop(signal);
      server.close();
      process.exit(0);
    };

    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));

    await launchBot(bot);
    botStatus = 'running';
    console.log('AI Trade Simulator Bot is running');
  } catch (error) {
    botStatus = 'error';
    console.error('Fatal startup error:', error);
    process.exit(1);
  }
}

main();
