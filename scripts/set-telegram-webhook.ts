import { loadEnvFiles } from '../src/config/load-env-file.js';

loadEnvFiles();

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const api = process.env.PUBLIC_API_URL ?? 'https://api.givoraworld.com';
if (!token || !secret) {
  throw new Error('Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET');
}
const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: `${api}/api/v1/telegram/webhook`,
    secret_token: secret,
    allowed_updates: ['message'],
  }),
});
console.log(response.status, await response.text());
