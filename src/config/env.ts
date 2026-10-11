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
  CLAIM_WINDOW_DAYS: z.coerce.number().default(30),
  CLAIM_EXTENSION_DAYS: z.coerce.number().default(30),
  SHIPPING_FLAT_PAISE: z.coerce.number().default(0),
  SHIPPING_FREE_ABOVE_PAISE: z.coerce.number().default(0),
  CASHFREE_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  CASHFREE_APP_ID: z.string().default(''),
  CASHFREE_SECRET_KEY: z.string().default(''),
  CASHFREE_API_VERSION: z.string().default('2025-01-01'),
  CASHFREE_WEBHOOK_SECRET: z.string().default(''),
  WHATSAPP_TOKEN: z.string().default(''),
  WHATSAPP_PHONE_NUMBER_ID: z.string().default(''),
  WHATSAPP_OTP_TEMPLATE: z.string().default('givora_otp'),
  WHATSAPP_API_VERSION: z.string().default('v21.0'),
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
