import http from 'http';
import { config } from './config';
import { getDatabase, closeDatabase } from './db/database';
import { createBot } from './bot';
import { stopPositionMonitor } from './services/positionMonitor';

const PORT = Number(process.env.PORT ?? 3000);

async function main(): Promise<void> {
  getDatabase();
  console.log('Database initialized');

  const bot = createBot(config.botToken);

  const server = http.createServer((req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.listen(PORT, () => {
    console.log(`Health server listening on port ${PORT}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down...`);
    stopPositionMonitor();
    bot.stop(signal);
    server.close();
    closeDatabase();
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await bot.launch();
  console.log('AI Trade Simulator Bot is running');
}

main().catch((error) => {
  console.error('Fatal startup error:', error);
  process.exit(1);
});
