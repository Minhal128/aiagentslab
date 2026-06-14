'use strict';

import PDFDocument from 'pdfkit';
import { PDFDocument as PDFLib } from 'pdf-lib';
import * as fs from 'fs';
import * as path from 'path';
import { storage } from '../storage';
import { logger } from '../utils/logger';
import type { Refund, PaymentTransaction, User } from '@shared/schema';

const REFUND_NOTE_DIR = process.env.REFUND_NOTE_STORAGE_DIR || './data/refund-notes';
const SOURCE = 'RefundNoteService';

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  INR: '₹',
  AUD: 'A$',
  CAD: 'C$',
  JPY: '¥',
  CNY: '¥',
  CHF: 'CHF',
  SEK: 'kr',
  NOK: 'kr',
  DKK: 'kr',
  NZD: 'NZ$',
  SGD: 'S$',
  HKD: 'HK$',
  MXN: 'MX$',
  BRL: 'R$',
  PLN: 'zł',
  CZK: 'Kč',
  ZAR: 'R',
  NGN: '₦',
  KES: 'KSh',
};

function getCurrencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency.toUpperCase()] || currency.toUpperCase();
}

function formatCurrency(amount: number | string, currency: string): string {
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  const symbol = getCurrencySymbol(currency);
  return `${symbol}${numAmount.toFixed(2)}`;
}

function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function parseSettingValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    let parsed = value;
    while (parsed.startsWith('"') && parsed.endsWith('"') && parsed.length > 1) {
      parsed = parsed.slice(1, -1);
    }
    return parsed || null;
  }
  return String(value);
}

function formatDate(date: Date | null | undefined, timezone: string = 'UTC'): string {
  if (!date) return 'N/A';
  const validTimezone = isValidTimezone(timezone) ? timezone : 'UTC';
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: validTimezone,
  });
}

function ensureRefundNoteDir(): void {
  if (!fs.existsSync(REFUND_NOTE_DIR)) {
    fs.mkdirSync(REFUND_NOTE_DIR, { recursive: true });
    logger.info(`Created refund note directory: ${REFUND_NOTE_DIR}`, undefined, SOURCE);
  }
}

export interface CompanyInfo {
  name: string;
  email: string;
  website: string;
  logoUrl: string | null;
  timezone: string;
}

export class RefundNoteService {
  private async getCompanyInfo(): Promise<CompanyInfo> {
    const appNameSetting = await storage.getGlobalSetting('app_name');
    const adminEmailSetting = await storage.getGlobalSetting('admin_email');
    const supportEmailSetting = await storage.getGlobalSetting('support_email');
    const smtpFromEmailSetting = await storage.getGlobalSetting('smtp_from_email');
    const logoUrlSetting = await storage.getGlobalSetting('logo_url');
    const logoUrlLightSetting = await storage.getGlobalSetting('logo_url_light');
    const timezoneSetting = await storage.getGlobalSetting('invoice_timezone');
    const appUrlSetting = await storage.getGlobalSetting('app_url');
    
    const appName = parseSettingValue(appNameSetting?.value);
    const adminEmail = parseSettingValue(adminEmailSetting?.value);
    const supportEmail = parseSettingValue(supportEmailSetting?.value);
    const smtpFromEmail = parseSettingValue(smtpFromEmailSetting?.value);
    const logoUrl = parseSettingValue(logoUrlSetting?.value) || parseSettingValue(logoUrlLightSetting?.value);
    const rawTimezone = parseSettingValue(timezoneSetting?.value) || 'UTC';
    const dbAppUrl = parseSettingValue(appUrlSetting?.value);
    const appUrl = dbAppUrl || process.env.APP_URL || null;
    const companyEmail = adminEmail || supportEmail || smtpFromEmail;
    const timezone = isValidTimezone(rawTimezone) ? rawTimezone : 'UTC';
    
    return {
      name: appName || '',
      email: companyEmail || '',
      website: appUrl || '',
      logoUrl,
      timezone,
    };
  }

  async generateRefundNote(refundId: string): Promise<Refund> {
    logger.info(`Generating refund note for refund: ${refundId}`, undefined, SOURCE);

    const refund = await storage.getRefund(refundId);
    if (!refund) {
      throw new Error(`Refund not found: ${refundId}`);
    }

    if (refund.status !== 'completed') {
      throw new Error(`Cannot generate refund note for non-completed refund. Status: ${refund.status}`);
    }

    if (refund.pdfUrl) {
      logger.info(`Refund note already exists for refund: ${refundId}`, { refundNoteNumber: refund.refundNoteNumber }, SOURCE);
      return refund;
    }

    const transaction = await storage.getPaymentTransaction(refund.transactionId);
    if (!transaction) {
      throw new Error(`Original transaction not found: ${refund.transactionId}`);
    }

    const user = await storage.getUser(refund.userId);
    if (!user) {
      throw new Error(`User not found: ${refund.userId}`);
    }

    const refundNoteNumber = await storage.getNextRefundNoteNumber();
    logger.info(`Generated refund note number: ${refundNoteNumber}`, undefined, SOURCE);

    await storage.updateRefund(refundId, {
      refundNoteNumber,
    });

    try {
      const pdfBuffer = await this.generatePDF(refund, transaction, user, refundNoteNumber);
      const pdfPath = await this.savePDF(refundNoteNumber, pdfBuffer);
      
      await storage.updateRefund(refundId, {
        pdfUrl: pdfPath,
        pdfGeneratedAt: new Date(),
      });

      logger.info(`Refund note PDF generated and saved: ${pdfPath}`, undefined, SOURCE);

      const updatedRefund = await storage.getRefund(refundId);
      return updatedRefund || refund;
    } catch (error) {
      logger.error(`Failed to generate PDF for refund note: ${refundId}`, error, SOURCE);
      return refund;
    }
  }

  private async generatePDF(
    refund: Refund, 
    transaction: PaymentTransaction, 
    user: User,
    refundNoteNumber: string
  ): Promise<Buffer> {
    const companyInfo = await this.getCompanyInfo();
    
    const rawPdfBuffer = await new Promise<Buffer>(async (resolve, reject) => {
      try {
        const chunks: Buffer[] = [];
        const doc = new PDFDocument({ 
          size: 'A4', 
          margin: 50,
          autoFirstPage: false,
          bufferPages: true,
          info: {
            Title: `Refund Note ${refundNoteNumber}`,
            Author: companyInfo.name,
            Subject: 'Payment Refund Note',
          }
        });

        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        doc.addPage();
        
        await this.renderPDFContent(doc, refund, transaction, user, refundNoteNumber, companyInfo);

        doc.end();
      } catch (error) {
        reject(error);
      }
    });

    const pdfDoc = await PDFLib.load(rawPdfBuffer);
    const pageCount = pdfDoc.getPageCount();
    
    if (pageCount > 1) {
      logger.info(`Refund Note ${refundNoteNumber}: Removing ${pageCount - 1} extra pages`, undefined, SOURCE);
      for (let i = pageCount - 1; i >= 1; i--) {
        pdfDoc.removePage(i);
      }
    }

    const finalPdfBytes = await pdfDoc.save();
    return Buffer.from(finalPdfBytes);
  }

  private async renderPDFContent(
    doc: PDFKit.PDFDocument, 
    refund: Refund,
    transaction: PaymentTransaction,
    user: User,
    refundNoteNumber: string,
    companyInfo: CompanyInfo
  ): Promise<void> {
    const pageWidth = doc.page.width - 100;
    const leftMargin = 50;
    const rightMargin = doc.page.width - 50;
    
    this.renderHeader(doc, companyInfo, refundNoteNumber, refund, leftMargin, rightMargin);
    
    let yPos = 130;
    yPos = this.renderCustomerSection(doc, user, leftMargin, yPos);
    
    yPos = this.renderRefundDetails(doc, refund, transaction, leftMargin, rightMargin, yPos);
    
    yPos = this.renderOriginalTransaction(doc, transaction, leftMargin, yPos);
    
    this.renderFooter(doc, companyInfo);
  }

  private renderHeader(
    doc: PDFKit.PDFDocument,
    companyInfo: CompanyInfo,
    refundNoteNumber: string,
    refund: Refund,
    leftMargin: number,
    rightMargin: number
  ): void {
    let currentY = 30;
    const logoMaxHeight = 40;
    
    if (companyInfo.logoUrl && companyInfo.logoUrl.startsWith('data:image')) {
      try {
        const logoBuffer = Buffer.from(companyInfo.logoUrl.split(',')[1], 'base64');
        doc.image(logoBuffer, leftMargin, currentY, { 
          height: logoMaxHeight,
          fit: [100, logoMaxHeight]
        });
        currentY += logoMaxHeight + 8;
      } catch (error) {
        logger.warn('Failed to render logo in refund note, using text fallback', { error }, SOURCE);
      }
    }
    
    doc.fontSize(14).fillColor('#333333').font('Helvetica-Bold');
    doc.text(companyInfo.name, leftMargin, currentY, { lineBreak: false });
    doc.font('Helvetica');
    
    currentY += 16;
    doc.fontSize(9).fillColor('#666666');
    doc.text(companyInfo.email, leftMargin, currentY, { lineBreak: false });
    
    currentY += 12;
    doc.text(companyInfo.website, leftMargin, currentY, { lineBreak: false });

    doc.fontSize(20).fillColor('#333333').font('Helvetica-Bold');
    doc.text('REFUND NOTE', rightMargin - 150, 30, { width: 150, align: 'right', lineBreak: false });
    doc.font('Helvetica');

    doc.fontSize(9).fillColor('#666666');
    
    const infoX = rightMargin - 180;
    let infoY = 55;
    
    doc.text('Refund Note #:', infoX, infoY, { lineBreak: false });
    doc.font('Helvetica-Bold').fillColor('#333333');
    doc.text(refundNoteNumber, infoX + 80, infoY, { width: 100, align: 'right', lineBreak: false });
    doc.font('Helvetica').fillColor('#666666');
    
    infoY += 14;
    doc.text('Refund Date:', infoX, infoY, { lineBreak: false });
    doc.text(formatDate(refund.processedAt || refund.createdAt, companyInfo.timezone), infoX + 80, infoY, { width: 100, align: 'right', lineBreak: false });
    
    infoY += 14;
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#dc2626');
    doc.text('REFUNDED', infoX + 80, infoY, { width: 100, align: 'right', lineBreak: false });
    doc.font('Helvetica').fillColor('#666666');
  }

  private renderCustomerSection(
    doc: PDFKit.PDFDocument,
    user: User,
    leftMargin: number,
    startY: number
  ): number {
    doc.fontSize(10).fillColor('#333333').font('Helvetica-Bold');
    doc.text('Refunded To:', leftMargin, startY, { lineBreak: false });
    doc.font('Helvetica');
    
    let yPos = startY + 14;
    
    doc.fontSize(9).fillColor('#333333');
    doc.text(user.name, leftMargin, yPos, { lineBreak: false });
    
    yPos += 12;
    doc.fillColor('#666666');
    doc.text(user.email, leftMargin, yPos, { lineBreak: false });
    
    return yPos + 25;
  }

  private renderRefundDetails(
    doc: PDFKit.PDFDocument,
    refund: Refund,
    transaction: PaymentTransaction,
    leftMargin: number,
    rightMargin: number,
    startY: number
  ): number {
    const tableTop = startY;
    const tableWidth = rightMargin - leftMargin;
    
    doc.rect(leftMargin, tableTop, tableWidth, 20).fill('#f8f9fa');
    
    doc.fontSize(8).fillColor('#333333').font('Helvetica-Bold');
    
    let xPos = leftMargin + 8;
    doc.text('Description', xPos, tableTop + 6, { lineBreak: false });
    xPos += tableWidth * 0.5;
    doc.text('Gateway', xPos, tableTop + 6, { width: tableWidth * 0.2 - 10, align: 'center', lineBreak: false });
    xPos += tableWidth * 0.2;
    doc.text('Amount Refunded', xPos, tableTop + 6, { width: tableWidth * 0.3 - 16, align: 'right', lineBreak: false });
    
    doc.font('Helvetica');
    
    let yPos = tableTop + 28;
    xPos = leftMargin + 8;
    
    let description = 'Refund';
    if (refund.creditsReversed) {
      description = `Credit Refund (${refund.creditsReversed} credits reversed)`;
    } else if (transaction.type === 'subscription') {
      description = `Subscription Refund - ${transaction.description}`;
    } else if (transaction.type === 'credits') {
      description = `Credit Purchase Refund`;
    }
    
    doc.fontSize(8).fillColor('#333333');
    doc.text(description, xPos, yPos, { width: tableWidth * 0.5 - 16, lineBreak: false });
    
    xPos += tableWidth * 0.5;
    const gateway = refund.gateway.charAt(0).toUpperCase() + refund.gateway.slice(1);
    doc.text(gateway, xPos, yPos, { width: tableWidth * 0.2 - 10, align: 'center', lineBreak: false });
    
    xPos += tableWidth * 0.2;
    doc.font('Helvetica-Bold').fillColor('#dc2626');
    doc.text(formatCurrency(refund.amount, refund.currency), xPos, yPos, { 
      width: tableWidth * 0.3 - 16, 
      align: 'right',
      lineBreak: false 
    });
    
    doc.font('Helvetica').fillColor('#333333');
    
    yPos += 20;
    doc.moveTo(leftMargin, yPos).lineTo(rightMargin, yPos).stroke('#e5e7eb');
    
    yPos += 15;
    
    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Total Refunded:', rightMargin - 180, yPos, { lineBreak: false });
    doc.fillColor('#dc2626');
    doc.text(formatCurrency(refund.amount, refund.currency), rightMargin - 80, yPos, { width: 80, align: 'right', lineBreak: false });
    doc.fillColor('#333333').font('Helvetica');
    
    return yPos + 35;
  }

  private renderOriginalTransaction(
    doc: PDFKit.PDFDocument,
    transaction: PaymentTransaction,
    leftMargin: number,
    startY: number
  ): number {
    doc.fontSize(10).fillColor('#333333').font('Helvetica-Bold');
    doc.text('Original Transaction Details', leftMargin, startY, { lineBreak: false });
    doc.font('Helvetica');
    
    let yPos = startY + 16;
    
    doc.fontSize(8).fillColor('#666666');
    doc.text(`Transaction ID: ${transaction.id}`, leftMargin, yPos, { lineBreak: false });
    
    yPos += 12;
    doc.text(`Original Amount: ${formatCurrency(transaction.amount, transaction.currency)}`, leftMargin, yPos, { lineBreak: false });
    
    yPos += 12;
    const gateway = transaction.gateway.charAt(0).toUpperCase() + transaction.gateway.slice(1);
    doc.text(`Payment Gateway: ${gateway}`, leftMargin, yPos, { lineBreak: false });
    
    if (transaction.gatewayTransactionId) {
      yPos += 12;
      doc.text(`Gateway Reference: ${transaction.gatewayTransactionId}`, leftMargin, yPos, { lineBreak: false });
    }
    
    return yPos + 20;
  }

  private renderFooter(
    doc: PDFKit.PDFDocument,
    companyInfo: CompanyInfo
  ): void {
    const footerY = doc.page.height - 50;
    const leftMargin = 50;
    const rightMargin = doc.page.width - 50;
    
    doc.moveTo(leftMargin, footerY - 15).lineTo(rightMargin, footerY - 15).stroke('#e5e7eb');
    
    doc.fontSize(7).fillColor('#999999');
    doc.text(
      `This is an official refund note from ${companyInfo.name}. For questions, contact ${companyInfo.email}`,
      leftMargin,
      footerY,
      { width: rightMargin - leftMargin, align: 'center', lineBreak: false }
    );
  }

  private async savePDF(refundNoteNumber: string, pdfBuffer: Buffer): Promise<string> {
    ensureRefundNoteDir();
    
    const fileName = `${refundNoteNumber.replace(/\//g, '-')}.pdf`;
    const filePath = path.join(REFUND_NOTE_DIR, fileName);
    
    fs.writeFileSync(filePath, pdfBuffer);
    
    return filePath;
  }

  async getRefundNotePDF(refundId: string): Promise<Buffer | null> {
    const refund = await storage.getRefund(refundId);
    if (!refund || !refund.pdfUrl) {
      return null;
    }

    if (!fs.existsSync(refund.pdfUrl)) {
      logger.warn(`Refund note PDF file not found: ${refund.pdfUrl}`, undefined, SOURCE);
      return null;
    }

    return fs.readFileSync(refund.pdfUrl);
  }
}

export const refundNoteService = new RefundNoteService();

export async function generateRefundNoteForRefund(refundId: string): Promise<Refund> {
  return refundNoteService.generateRefundNote(refundId);
}
