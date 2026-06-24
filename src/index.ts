import http from 'http';
import { config } from './config';
import { initDatabase } from './db/database';
import { createBot } from './bot';
import { stopPositionMonitor } from './services/positionMonitor';

const PORT = Number(process.env.PORT ?? 3000);

let botStatus: 'starting' | 'running' | 'error' = 'starting';

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

    await bot.launch();
    botStatus = 'running';
    console.log('AI Trade Simulator Bot is running');
  } catch (error) {
    botStatus = 'error';
    console.error('Fatal startup error:', error);
    process.exit(1);
  }
}

main();
