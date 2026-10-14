# Givora API

NestJS 12 API for the Givora gifting store. It owns PostgreSQL through Prisma. The Next.js app never connects to the database.

## Local setup

```bash
cp .env.example .env
npm ci
npx prisma generate
npx prisma migrate deploy
npm run db:seed
npm run start:dev
```

The API listens on port 4000. Interactive docs are at `/api/v1/docs`.

Guest senders and recipients verify with a WhatsApp one-time code. In development, if WhatsApp credentials are empty, the code is printed in the API log.

## Telegram Mini App

Create `@GivoraWorldBot` in BotFather. Set the Main Mini App URL to `https://givoraworld.com/tg` and the menu button to the same URL. Then register the webhook:

```bash
PUBLIC_API_URL=https://api.givoraworld.com npx tsx scripts/set-telegram-webhook.ts
```

Create a private MinIO bucket `givora-private` with no anonymous access. Product photos stay in the public `givora-media` bucket.

Telegram checkout uses Cashfree **inline** checkout in the Mini App first, with **Open secure payment page** (`WebApp.openLink`) as fallback. Confirm payments with webhooks and `GET /payments/orders/:orderId/status`.

## Production

Nginx samples live in `deploy/`. PM2 uses `ecosystem.config.cjs` from `/var/www/givora-api/current`. Keep secrets in `/var/www/givora-api/shared/.env` (or symlink/copy to `.env` in the app root). The API, Prisma CLI, and `npm run db:seed` load `.env`, then `shared/.env`, then `/var/www/givora-api/shared/.env` automatically.

GitHub Actions on `main` builds, copies a release to the VPS, runs migrations, reloads PM2, and rolls back if `/api/v1/health` does not report a healthy database.

Nightly backups:

```bash
DATABASE_URL=postgresql://givora_app:…@127.0.0.1:5432/givora ./deploy/backup-postgres.sh
```

Restore drill: `createdb givora_restore && pg_restore --dbname=givora_restore /var/backups/givora/<file>.dump`

Cashfree production keys are environment variables (`CASHFREE_ENV=production` plus the app id, secret, and webhook secret). Do not commit them.
