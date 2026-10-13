import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import type { AppEnv } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { badRequest } from '../common/http.js';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly config: ConfigService<AppEnv, true>,
    private readonly prisma: PrismaService,
  ) {}

  async sendOtp(phone: string, code: string) {
    const base = this.config.get('WHATSAPP_API_BASE_URL', { infer: true }).replace(/\/$/, '');
    const apiKey = this.config.get('WHATSAPP_API_KEY', { infer: true }).trim().replace(/>$/, '');
    const template = this.config.get('WHATSAPP_OTP_TEMPLATE_NAME', { infer: true });
    const language = this.config.get('WHATSAPP_OTP_TEMPLATE_LANGUAGE', { infer: true });
    if (!apiKey) {
      if (this.config.get('NODE_ENV', { infer: true }) !== 'production') {
        this.logger.warn(`WhatsApp OTP for ${phone.slice(0, 4)}… (dev only): ${code}`);
      }
      await this.log('whatsapp', phone, template, 'skipped', 'missing credentials');
      return;
    }
    const to = phone.replace(/^\+/, '');
    const response = await fetch(`${base}/api/v1/whatsapp/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-api-key': apiKey,
        'Idempotency-Key': `givora-otp-${to}-${Date.now()}`,
      },
      body: JSON.stringify({
        to,
        type: 'template',
        templateName: template,
        language,
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
        ],
      }),
    });
    if (!response.ok) {
      const error = await response.text();
      await this.log('whatsapp', phone, template, 'failed', `${response.status} ${error.slice(0, 400)}`);
      this.logger.error(`WhatsApp send failed with HTTP ${response.status}`);
      throw badRequest('OTP_DELIVERY_FAILED', 'Could not send the WhatsApp code. Try again shortly.');
    }
    await this.log('whatsapp', phone, template, 'sent');
  }

  async sendWhatsAppText(phone: string, template: string, bodyParameters: string[]) {
    const token = this.config.get('WHATSAPP_TOKEN', { infer: true });
    const phoneNumberId = this.config.get('WHATSAPP_PHONE_NUMBER_ID', { infer: true });
    const version = this.config.get('WHATSAPP_API_VERSION', { infer: true });
    if (!token || !phoneNumberId) {
      await this.log('whatsapp', phone, template, 'skipped', 'missing credentials');
      return;
    }
    const response = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone.replace(/^\+/, ''),
        type: 'template',
        template: {
          name: template,
          language: { code: 'en' },
          components: [
            {
              type: 'body',
              parameters: bodyParameters.map((text) => ({ type: 'text', text })),
            },
          ],
        },
      }),
    });
    await this.log('whatsapp', phone, template, response.ok ? 'sent' : 'failed');
  }

  async sendEmail(to: string, subject: string, text: string) {
    const host = this.config.get('SMTP_HOST', { infer: true });
    if (!host) {
      if (this.config.get('NODE_ENV', { infer: true }) !== 'production') {
        this.logger.log(`Email skipped to ${to}: ${subject}`);
      }
      await this.log('email', to, subject, 'skipped', 'missing smtp');
      return;
    }
    const transport = nodemailer.createTransport({
      host,
      port: this.config.get('SMTP_PORT', { infer: true }),
      auth: {
        user: this.config.get('SMTP_USER', { infer: true }),
        pass: this.config.get('SMTP_PASS', { infer: true }),
      },
    });
    try {
      await transport.sendMail({
        from: this.config.get('SMTP_FROM', { infer: true }),
        to,
        subject,
        text,
      });
      await this.log('email', to, subject, 'sent');
    } catch (error) {
      await this.log('email', to, subject, 'failed', error instanceof Error ? error.message : 'send failed');
    }
  }

  private async log(channel: string, to: string, template: string, status: string, error?: string) {
    await this.prisma.notificationLog.create({
      data: { channel, to: to.slice(0, 6) + '…', template, status, error },
    });
  }
}
