import http from 'http';
import { config } from './config';
import { initDatabase } from './db/database';
import { createBot } from './bot';
import { stopPositionMonitor } from './services/positionMonitor';

const PORT = Number(process.env.PORT ?? 3000);
const WEBHOOK_PATH = '/webhook';

let botStatus: 'starting' | 'running' | 'error' = 'starting';

async function main(): Promise<void> {
  const bot = createBot(config.botToken);

  const server = http.createServer((req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(botStatus === 'running' ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: botStatus, uptime: process.uptime() }));
      return;
    }

    if (req.method === 'POST' && req.url === WEBHOOK_PATH) {
      let body = '';
      req.on('data', (chunk) => body += chunk);
      req.on('end', async () => {
        try {
          const update = JSON.parse(body);
          await bot.handleUpdate(update, res);
        } catch (err) {
          console.error('Webhook error:', err);
          if (!res.writableEnded) res.end();
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  server.listen(PORT, () => {
    console.log(`Health server listening on port ${PORT}`);
  });

  try {
    await initDatabase();

    const shutdown = async (signal: string) => {
      console.log(`\nReceived ${signal}, shutting down...`);
      stopPositionMonitor();
      bot.stop(signal);
      server.close();
      process.exit(0);
    };

    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));

    if (process.env.RENDER_EXTERNAL_URL) {
      const base = process.env.RENDER_EXTERNAL_URL.replace(/\/+$/, '');
      const webhookUrl = `${base}${WEBHOOK_PATH}`;
      await bot.telegram.setWebhook(webhookUrl);
      const info = await bot.telegram.getWebhookInfo();
      console.log('Webhook registered:', info.url, '| pending:', info.pending_update_count, '| last error:', info.last_error_message ?? 'none');
    } else {
      await bot.launch();
    }

    botStatus = 'running';
    console.log('AI Trade Simulator Bot is running');
  } catch (error) {
    botStatus = 'error';
    console.error('Fatal startup error:', error);
    process.exit(1);
  }
}

main();
