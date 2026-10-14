import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  PUBLIC_WEB_URL: z.string().default('http://localhost:3000'),
  COOKIE_DOMAIN: z.string().optional().default(''),
  JWT_ACCESS_SECRET: z.string().min(32),
  ACCESS_TTL_SECONDS: z.coerce.number().default(900),
  REFRESH_TTL_DAYS: z.coerce.number().default(30),
  OTP_PEPPER: z.string().min(16),
  OTP_TTL_SECONDS: z.coerce.number().default(300),
  PAYMENT_WINDOW_MINUTES: z.coerce.number().default(30),
  GIFT_REDEEM_DAYS: z.coerce.number().default(30),
  GIFT_REMINDER_DAYS: z.coerce.number().default(7),
  AURA_INVITE_POINTS: z.coerce.number().default(5),
  AURA_PAISE_PER_POINT: z.coerce.number().default(1000),
  CASHFREE_ENV: z.preprocess(
    (val) => (typeof val === 'string' ? val.trim().toLowerCase() : val),
    z.enum(['sandbox', 'production']).default('sandbox'),
  ),
  CASHFREE_APP_ID: z.string().default(''),
  CASHFREE_SECRET_KEY: z.string().default(''),
  CASHFREE_API_VERSION: z.string().default('2025-01-01'),
  CASHFREE_WEBHOOK_SECRET: z.string().default(''),
  WHATSAPP_TOKEN: z.string().default(''),
  WHATSAPP_PHONE_NUMBER_ID: z.string().default(''),
  WHATSAPP_OTP_TEMPLATE: z.string().default('givora_otp'),
  WHATSAPP_API_VERSION: z.string().default('v21.0'),
  WHATSAPP_API_BASE_URL: z.string().default('https://api.alterera.net'),
  WHATSAPP_API_KEY: z.string().default(''),
  WHATSAPP_OTP_TEMPLATE_NAME: z.string().default('otp_verification'),
  WHATSAPP_OTP_TEMPLATE_LANGUAGE: z.string().default('en_US'),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().default('Givora <hello@givora.in>'),
  S3_ENDPOINT: z.string().default('http://127.0.0.1:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('givora-media'),
  S3_ACCESS_KEY: z.string().default(''),
  S3_SECRET_KEY: z.string().default(''),
  S3_PUBLIC_BASE_URL: z.string().default('http://127.0.0.1:9000/givora-media'),
  S3_PRIVATE_BUCKET: z.string().default('givora-private'),
  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_BOT_USERNAME: z.string().default('GivoraWorldBot'),
  TELEGRAM_WEBHOOK_SECRET: z.string().default(''),
  MINIAPP_URL: z.string().default('http://localhost:3000/tg'),
  SWAGGER_USER: z.string().default(''),
  SWAGGER_PASSWORD: z.string().default(''),
  SEED_ADMIN_EMAIL: z.string().default('admin@givora.in'),
  SEED_ADMIN_PASSWORD: z.string().default('ChangeMeNow!2026'),
});

export type AppEnv = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment: ${details}`);
  }
  return parsed.data;
}
