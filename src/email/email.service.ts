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

  async sendPublicTicketCreatedEmail(
    to: string,
    reporterName: string | null,
    projectName: string,
    ticketTitle: string,
    followUpToken: string,
  ) {
    const baseUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3001';
    const publicUrl = `${baseUrl}/public/tickets/follow/${followUpToken}`;

    const subject = `Ticket created: ${ticketTitle} - ${projectName}`;
    const nameSaludo = reporterName ? `Hi ${reporterName},` : 'Hello,';

    const html = `
      <h2>${projectName}</h2>
      <p>${nameSaludo}</p>
      <p>Your ticket has been created successfully.</p>
      <p><strong>Ticket:</strong> ${ticketTitle}</p>
      <p>You can follow up on your ticket by clicking the button below:</p>
      <p><a href="${publicUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">View Ticket</a></p>
      <p>Or copy this link: ${publicUrl}</p>
    `;
    return this.sendEmail(to, subject, html);
  }

  async sendTicketNewSectionEmail(
    to: string,
    ticketTitle: string,
    followUpToken: string | null,
    ticketId?: string,
  ) {
    const baseUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3001';

    const subject = `New response on ticket: ${ticketTitle}`;
    let html: string;

    if (followUpToken) {
      // Usuario externo - enlace público
      const publicUrl = `${baseUrl}/public/tickets/follow/${followUpToken}`;
      html = `
        <h2>New response on your ticket</h2>
        <p>Ticket: <strong>${ticketTitle}</strong></p>
        <p>A new response has been added to your ticket.</p>
        <p><a href="${publicUrl}">View ticket</a></p>
      `;
    } else if (ticketId) {
      // Usuario interno - enlace privado con ID del ticket
      const internalUrl = `${baseUrl}/app/tickets/${ticketId}`;
      html = `
        <h2>New response on ticket: ${ticketTitle}</h2>
        <p>A new response has been added to a ticket you're following.</p>
        <p><a href="${internalUrl}">View ticket</a></p>
      `;
    } else {
      // Fallback
      const internalUrl = `${baseUrl}/app/tickets`;
      html = `
        <h2>New response on ticket: ${ticketTitle}</h2>
        <p>A new response has been added to a ticket you're following.</p>
        <p><a href="${internalUrl}">View tickets</a></p>
      `;
    }

    return this.sendEmail(to, subject, html);
  }

  async sendTicketAssignedEmail(to: string, ticketTitle: string, ticketId: string) {
    const baseUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3001';
    const internalUrl = `${baseUrl}/app/tickets/${ticketId}`;
    const subject = `Ticket assigned: ${ticketTitle}`;
    const html = `
      <h2>You have been assigned to a ticket</h2>
      <p>Ticket: <strong>${ticketTitle}</strong></p>
      <p>You have been assigned to this ticket.</p>
      <p><a href="${internalUrl}">View ticket</a></p>
    `;
    return this.sendEmail(to, subject, html);
  }

  async sendTicketCreatedEmail(to: string, ticketTitle: string, ticketId: string) {
    const baseUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3001';
    const internalUrl = `${baseUrl}/app/tickets/${ticketId}`;
    const subject = `New ticket created: ${ticketTitle}`;
    const html = `
      <h2>A new ticket has been created</h2>
      <p>Ticket: <strong>${ticketTitle}</strong></p>
      <p>A new ticket has been created and is awaiting assignment.</p>
      <p><a href="${internalUrl}">View ticket</a></p>
    `;
    return this.sendEmail(to, subject, html);
  }
}
