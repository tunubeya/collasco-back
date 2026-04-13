import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Mailgun from 'mailgun.js';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private mailgun: any;
  private domain: string;
  private fromEmail: string;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('MAILGUN_API_KEY') || '';
    const domain = this.configService.get<string>('MAILGUN_DOMAIN') || '';

    console.log(`[EmailService] initializing with domain: ${domain}, apiKey exists: ${!!apiKey}`);

    // Use built-in global FormData (Node 18+)
    this.mailgun = new Mailgun(globalThis.FormData);
    this.mailgun = this.mailgun.client({
      username: 'api',
      key: apiKey,
    });

    this.domain = domain;
    this.fromEmail = this.configService.get<string>('MAILGUN_FROM_EMAIL') || '';

    console.log(`[EmailService] initialized, domain: ${this.domain}, fromEmail: ${this.fromEmail}`);
  }

  async sendEmail(to: string, subject: string, html: string) {
    console.log(`[EmailService sendEmail] to=${to}, subject=${subject}, domain=${this.domain}`);

    if (!this.domain || !this.mailgun) {
      console.log(`[EmailService sendEmail] mailgun not initialized properly, skipping`);
      return;
    }

    try {
      const result = await this.mailgun.messages.create(this.domain, {
        from: this.fromEmail,
        to,
        subject,
        html,
      });
      console.log(`[EmailService sendEmail] success, result:`, result);
      return result;
    } catch (error) {
      console.log(`[EmailService sendEmail] error:`, error);
      throw error;
    }
  }

  async sendTicketNewSectionEmail(to: string, ticketTitle: string, followUpToken: string) {
    const baseUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3001';
    const followUpUrl = followUpToken
      ? `${baseUrl}/public/tickets/follow/${followUpToken}`
      : baseUrl;

    const subject = `New response on ticket: ${ticketTitle}`;
    const html = `
      <h2>New response on your ticket</h2>
      <p>Ticket: <strong>${ticketTitle}</strong></p>
      <p>A new response has been added to your ticket.</p>
      <p><a href="${followUpUrl}">View ticket</a></p>
    `;
    return this.sendEmail(to, subject, html);
  }
}
