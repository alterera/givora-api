import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module.js';
import type { AppEnv } from './config/env.js';

const app = await NestFactory.create(AppModule, { rawBody: true, bufferLogs: true });
app.useLogger(app.get(Logger));
const config = app.get<ConfigService<AppEnv, true>>(ConfigService);
app.setGlobalPrefix('api/v1');
const expressApp = app.getHttpAdapter().getInstance() as {
  set: (key: string, value: number) => void;
};
expressApp.set('trust proxy', 1);
app.use(helmet());
app.use(cookieParser());
app.enableCors({
  origin: config.get('WEB_ORIGIN', { infer: true }),
  credentials: true,
});
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
);
const document = SwaggerModule.createDocument(
  app,
  new DocumentBuilder()
    .setTitle('Givora API')
    .setDescription('Gifting commerce API')
    .setVersion('1.0')
    .addCookieAuth('givora_access')
    .build(),
);
const swaggerUser = config.get('SWAGGER_USER', { infer: true });
const swaggerPassword = config.get('SWAGGER_PASSWORD', { infer: true });
if (config.get('NODE_ENV', { infer: true }) === 'production' && swaggerUser) {
  app.use('/api/v1/docs', (req: Request, res: Response, next: NextFunction) => {
    const expected = `Basic ${Buffer.from(`${swaggerUser}:${swaggerPassword}`).toString('base64')}`;
    if (req.headers.authorization !== expected) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Givora docs"');
      res.status(401).send('Authentication required');
      return;
    }
    next();
  });
}
SwaggerModule.setup('api/v1/docs', app, document);
app.enableShutdownHooks();
await app.listen(config.get('PORT', { infer: true }));
