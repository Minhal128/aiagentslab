'use strict';
/**
 * ============================================================
 * © 2025 Diploy — a brand of Bisht Technologies Private Limited
 * Original Author: BTPL Engineering Team
 * Website: https://diploy.in
 * Contact: cs@diploy.in
 *
 * Distributed under the Envato / CodeCanyon License Agreement.
 * Licensed to the purchaser for use as defined by the
 * Envato Market (CodeCanyon) Regular or Extended License.
 *
 * You are NOT permitted to redistribute, resell, sublicense,
 * or share this source code, in whole or in part.
 * Respect the author's rights and Envato licensing terms.
 * ============================================================
 */

import PDFDocument from 'pdfkit';
import { PDFDocument as PDFLib } from 'pdf-lib';
import * as fs from 'fs';
import * as path from 'path';
import { storage } from '../../storage';
import { logger } from '../../utils/logger';
import type { Invoice, PaymentTransaction, User } from '@shared/schema';

const INVOICE_DIR = process.env.INVOICE_STORAGE_DIR || './data/invoices';
const SOURCE = 'InvoiceService';

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
  
  // If it's a string, it might be JSON-encoded (with extra quotes)
  if (typeof value === 'string') {
    // Remove surrounding quotes if present (from JSON storage)
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
  
  // Validate timezone, fall back to UTC if invalid
  const validTimezone = isValidTimezone(timezone) ? timezone : 'UTC';
  
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: validTimezone,
  });
}

function ensureInvoiceDir(): void {
  if (!fs.existsSync(INVOICE_DIR)) {
    fs.mkdirSync(INVOICE_DIR, { recursive: true });
    logger.info(`Created invoice directory: ${INVOICE_DIR}`, undefined, SOURCE);
  }
}

export interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface CompanyInfo {
  name: string;
  email: string;
  website: string;
  logoUrl: string | null;
  timezone: string;
}

export class InvoiceService {
  private async getCompanyInfo(): Promise<CompanyInfo> {
    const appNameSetting = await storage.getGlobalSetting('app_name');
    const adminEmailSetting = await storage.getGlobalSetting('admin_email');
    const supportEmailSetting = await storage.getGlobalSetting('support_email');
    const smtpFromEmailSetting = await storage.getGlobalSetting('smtp_from_email');
    const logoUrlSetting = await storage.getGlobalSetting('logo_url');
    const logoUrlLightSetting = await storage.getGlobalSetting('logo_url_light');
    const timezoneSetting = await storage.getGlobalSetting('invoice_timezone');
    const appUrlSetting = await storage.getGlobalSetting('app_url');
    
    // Parse values from JSONB storage (removes extra quotes)
    const appName = parseSettingValue(appNameSetting?.value);
    const adminEmail = parseSettingValue(adminEmailSetting?.value);
    const supportEmail = parseSettingValue(supportEmailSetting?.value);
    const smtpFromEmail = parseSettingValue(smtpFromEmailSetting?.value);
    const logoUrl = parseSettingValue(logoUrlSetting?.value) || parseSettingValue(logoUrlLightSetting?.value);
    const rawTimezone = parseSettingValue(timezoneSetting?.value) || 'UTC';
    
    // Priority: database app_url > APP_URL env var
    const dbAppUrl = parseSettingValue(appUrlSetting?.value);
    const appUrl = dbAppUrl || process.env.APP_URL || null;
    
    // Priority for email: admin_email > support_email > smtp_from_email
    const companyEmail = adminEmail || supportEmail || smtpFromEmail;
    
    // Validate timezone, fall back to UTC if invalid
    const timezone = isValidTimezone(rawTimezone) ? rawTimezone : 'UTC';
    
    if (rawTimezone && rawTimezone !== 'UTC' && !isValidTimezone(rawTimezone)) {
      logger.warn(`Invalid invoice_timezone setting: ${rawTimezone}, falling back to UTC`, undefined, SOURCE);
    }
    
    if (!companyEmail) {
      logger.warn('No company email configured for invoices. Please set admin_email or support_email in branding settings.', undefined, SOURCE);
    }
    
    if (!appUrl) {
      logger.warn('No APP_URL configured for invoices. Please set app_url in settings or APP_URL environment variable.', undefined, SOURCE);
    }
    
    return {
      name: appName || '',
      email: companyEmail || '',
      website: appUrl || '',
      logoUrl,
      timezone,
    };
  }

  async generateInvoice(transactionId: string): Promise<Invoice> {
    logger.info(`Generating invoice for transaction: ${transactionId}`, undefined, SOURCE);

    const transaction = await storage.getPaymentTransaction(transactionId);
    if (!transaction) {
      throw new Error(`Transaction not found: ${transactionId}`);
    }

    if (transaction.status !== 'completed') {
      throw new Error(`Cannot generate invoice for non-completed transaction. Status: ${transaction.status}`);
    }

    const existingInvoice = await storage.getTransactionInvoice(transactionId);
    if (existingInvoice) {
      logger.info(`Invoice already exists for transaction: ${transactionId}`, { invoiceNumber: existingInvoice.invoiceNumber }, SOURCE);
      return existingInvoice;
    }

    const user = await storage.getUser(transaction.userId);
    if (!user) {
      throw new Error(`User not found: ${transaction.userId}`);
    }

    const invoiceNumber = await storage.getNextInvoiceNumber();
    logger.info(`Generated invoice number: ${invoiceNumber}`, undefined, SOURCE);

    const lineItems: LineItem[] = this.buildLineItems(transaction);
    const subtotal = lineItems.reduce((sum, item) => sum + item.total, 0);
    const tax = 0;
    const total = subtotal + tax;

    const now = new Date();
    const invoice = await storage.createInvoice({
      transactionId: transaction.id,
      userId: user.id,
      invoiceNumber,
      customerName: user.name,
      customerEmail: user.email,
      customerAddress: null,
      description: transaction.description,
      lineItems,
      subtotal: subtotal.toFixed(2),
      tax: tax.toFixed(2),
      total: total.toFixed(2),
      currency: transaction.currency,
      gateway: transaction.gateway,
      paymentMethod: this.getPaymentMethodDisplay(transaction),
      pdfUrl: null,
      pdfGeneratedAt: null,
      status: 'paid',
      emailSentAt: null,
      emailSentTo: null,
      issuedAt: now,
      dueAt: now,
      paidAt: transaction.completedAt || now,
    });

    logger.info(`Invoice record created: ${invoice.id}`, { invoiceNumber }, SOURCE);

    try {
      const pdfBuffer = await this.generatePDF(invoice);
      const pdfPath = await this.savePDF(invoice.invoiceNumber, pdfBuffer);
      
      await storage.updateInvoice(invoice.id, {
        pdfUrl: pdfPath,
        pdfGeneratedAt: new Date(),
      });

      logger.info(`PDF generated and saved: ${pdfPath}`, undefined, SOURCE);

      const updatedInvoice = await storage.getInvoice(invoice.id);
      return updatedInvoice || invoice;
    } catch (error) {
      logger.error(`Failed to generate PDF for invoice: ${invoice.id}`, error, SOURCE);
      return invoice;
    }
  }

  private buildLineItems(transaction: PaymentTransaction): LineItem[] {
    const amount = typeof transaction.amount === 'string' 
      ? parseFloat(transaction.amount) 
      : transaction.amount;

    if (transaction.type === 'credits' && transaction.creditsAwarded) {
      return [{
        description: `${transaction.creditsAwarded} Credits`,
        quantity: 1,
        unitPrice: amount,
        total: amount,
      }];
    }

    if (transaction.type === 'subscription') {
      const billingPeriod = transaction.billingPeriod === 'yearly' ? 'Yearly' : 'Monthly';
      return [{
        description: `${transaction.description} (${billingPeriod} Subscription)`,
        quantity: 1,
        unitPrice: amount,
        total: amount,
      }];
    }

    return [{
      description: transaction.description,
      quantity: 1,
      unitPrice: amount,
      total: amount,
    }];
  }

  private getPaymentMethodDisplay(transaction: PaymentTransaction): string {
    const gateway = transaction.gateway.charAt(0).toUpperCase() + transaction.gateway.slice(1);
    
    const metadata = transaction.metadata as Record<string, any> | null;
    if (metadata?.paymentMethod) {
      return `${gateway} - ${metadata.paymentMethod}`;
    }
    
    return gateway;
  }

  async generatePDF(invoice: Invoice): Promise<Buffer> {
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
            Title: `Invoice ${invoice.invoiceNumber}`,
            Author: companyInfo.name,
            Subject: 'Payment Invoice',
          }
        });

        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        doc.addPage();
        
        await this.renderPDFContent(doc, invoice, companyInfo);

        doc.end();
      } catch (error) {
        reject(error);
      }
    });

    const pdfDoc = await PDFLib.load(rawPdfBuffer);
    const pageCount = pdfDoc.getPageCount();
    
    if (pageCount > 1) {
      logger.info(`Invoice ${invoice.invoiceNumber}: Removing ${pageCount - 1} extra pages`, undefined, SOURCE);
      for (let i = pageCount - 1; i >= 1; i--) {
        pdfDoc.removePage(i);
      }
    }

    const finalPdfBytes = await pdfDoc.save();
    return Buffer.from(finalPdfBytes);
  }

  private async renderPDFContent(
    doc: PDFKit.PDFDocument, 
    invoice: Invoice,
    companyInfo: CompanyInfo
  ): Promise<void> {
    const pageWidth = doc.page.width - 100;
    const leftMargin = 50;
    const rightMargin = doc.page.width - 50;
    
    this.renderHeader(doc, companyInfo, invoice, leftMargin, rightMargin, pageWidth);
    
    let yPos = 130;
    yPos = this.renderCustomerSection(doc, invoice, leftMargin, yPos);
    
    yPos = this.renderLineItemsTable(doc, invoice, leftMargin, rightMargin, yPos);
    
    yPos = this.renderTotals(doc, invoice, rightMargin, yPos);
    
    yPos = this.renderPaymentInfo(doc, invoice, leftMargin, yPos);
    
    this.renderFooter(doc, companyInfo);
  }

  private renderHeader(
    doc: PDFKit.PDFDocument,
    companyInfo: CompanyInfo,
    invoice: Invoice,
    leftMargin: number,
    rightMargin: number,
    pageWidth: number
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
        logger.warn('Failed to render logo in invoice, using text fallback', { error }, SOURCE);
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

    doc.fontSize(24).fillColor('#333333').font('Helvetica-Bold');
    doc.text('INVOICE', rightMargin - 100, 30, { width: 100, align: 'right', lineBreak: false });
    doc.font('Helvetica');

    doc.fontSize(9).fillColor('#666666');
    
    const infoX = rightMargin - 180;
    let infoY = 60;
    
    doc.text('Invoice Number:', infoX, infoY, { lineBreak: false });
    doc.font('Helvetica-Bold').fillColor('#333333');
    doc.text(invoice.invoiceNumber, infoX + 80, infoY, { width: 100, align: 'right', lineBreak: false });
    doc.font('Helvetica').fillColor('#666666');
    
    infoY += 14;
    doc.text('Issue Date:', infoX, infoY, { lineBreak: false });
    doc.text(formatDate(invoice.issuedAt, companyInfo.timezone), infoX + 80, infoY, { width: 100, align: 'right', lineBreak: false });
    
    if (invoice.paidAt) {
      infoY += 14;
      doc.text('Paid Date:', infoX, infoY, { lineBreak: false });
      doc.text(formatDate(invoice.paidAt, companyInfo.timezone), infoX + 80, infoY, { width: 100, align: 'right', lineBreak: false });
    }
    
    infoY += 14;
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#22c55e');
    doc.text('PAID', infoX + 80, infoY, { width: 100, align: 'right', lineBreak: false });
    doc.font('Helvetica').fillColor('#666666');
  }

  private renderCustomerSection(
    doc: PDFKit.PDFDocument,
    invoice: Invoice,
    leftMargin: number,
    startY: number
  ): number {
    doc.fontSize(10).fillColor('#333333').font('Helvetica-Bold');
    doc.text('Bill To:', leftMargin, startY, { lineBreak: false });
    doc.font('Helvetica');
    
    let yPos = startY + 14;
    
    doc.fontSize(9).fillColor('#333333');
    doc.text(invoice.customerName, leftMargin, yPos, { lineBreak: false });
    
    yPos += 12;
    doc.fillColor('#666666');
    doc.text(invoice.customerEmail, leftMargin, yPos, { lineBreak: false });
    
    if (invoice.customerAddress) {
      yPos += 12;
      doc.text(invoice.customerAddress, leftMargin, yPos, { lineBreak: false });
    }
    
    return yPos + 20;
  }

  private renderLineItemsTable(
    doc: PDFKit.PDFDocument,
    invoice: Invoice,
    leftMargin: number,
    rightMargin: number,
    startY: number
  ): number {
    const tableTop = startY;
    const tableWidth = rightMargin - leftMargin;
    
    const colWidths = {
      description: tableWidth * 0.5,
      quantity: tableWidth * 0.15,
      unitPrice: tableWidth * 0.175,
      total: tableWidth * 0.175,
    };
    
    doc.rect(leftMargin, tableTop, tableWidth, 20)
       .fill('#f8f9fa');
    
    doc.fontSize(8).fillColor('#333333').font('Helvetica-Bold');
    
    let xPos = leftMargin + 8;
    doc.text('Description', xPos, tableTop + 6, { lineBreak: false });
    xPos += colWidths.description;
    doc.text('Qty', xPos, tableTop + 6, { width: colWidths.quantity - 10, align: 'center', lineBreak: false });
    xPos += colWidths.quantity;
    doc.text('Unit Price', xPos, tableTop + 6, { width: colWidths.unitPrice - 10, align: 'right', lineBreak: false });
    xPos += colWidths.unitPrice;
    doc.text('Total', xPos, tableTop + 6, { width: colWidths.total - 16, align: 'right', lineBreak: false });
    
    doc.font('Helvetica');
    
    let yPos = tableTop + 28;
    const lineItems = invoice.lineItems as LineItem[];
    
    for (const item of lineItems) {
      xPos = leftMargin + 8;
      
      const truncatedDesc = item.description.length > 50 
        ? item.description.substring(0, 47) + '...' 
        : item.description;
      
      doc.fontSize(8).fillColor('#333333');
      doc.text(truncatedDesc, xPos, yPos, { 
        width: colWidths.description - 16,
        lineBreak: false
      });
      
      xPos += colWidths.description;
      doc.text(item.quantity.toString(), xPos, yPos, { 
        width: colWidths.quantity - 10, 
        align: 'center',
        lineBreak: false 
      });
      
      xPos += colWidths.quantity;
      doc.text(formatCurrency(item.unitPrice, invoice.currency), xPos, yPos, { 
        width: colWidths.unitPrice - 10, 
        align: 'right',
        lineBreak: false 
      });
      
      xPos += colWidths.unitPrice;
      doc.text(formatCurrency(item.total, invoice.currency), xPos, yPos, { 
        width: colWidths.total - 16, 
        align: 'right',
        lineBreak: false 
      });
      
      yPos += 18;
    }
    
    doc.moveTo(leftMargin, yPos - 2)
       .lineTo(rightMargin, yPos - 2)
       .stroke('#e0e0e0');
    
    return yPos + 8;
  }

  private renderTotals(
    doc: PDFKit.PDFDocument,
    invoice: Invoice,
    rightMargin: number,
    startY: number
  ): number {
    const totalsX = rightMargin - 160;
    let yPos = startY;
    
    doc.fontSize(9).fillColor('#666666');
    
    doc.text('Subtotal:', totalsX, yPos, { lineBreak: false });
    doc.text(formatCurrency(invoice.subtotal, invoice.currency), totalsX + 60, yPos, { width: 100, align: 'right', lineBreak: false });
    
    yPos += 14;
    const taxAmount = typeof invoice.tax === 'string' ? parseFloat(invoice.tax) : (invoice.tax || 0);
    doc.text('Tax:', totalsX, yPos, { lineBreak: false });
    doc.text(formatCurrency(taxAmount, invoice.currency), totalsX + 60, yPos, { width: 100, align: 'right', lineBreak: false });
    
    yPos += 16;
    doc.moveTo(totalsX, yPos - 3)
       .lineTo(rightMargin, yPos - 3)
       .stroke('#e0e0e0');
    
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#333333');
    doc.text('Total:', totalsX, yPos, { lineBreak: false });
    doc.text(formatCurrency(invoice.total, invoice.currency), totalsX + 60, yPos, { width: 100, align: 'right', lineBreak: false });
    doc.font('Helvetica');
    
    return yPos + 25;
  }

  private renderPaymentInfo(
    doc: PDFKit.PDFDocument,
    invoice: Invoice,
    leftMargin: number,
    startY: number
  ): number {
    doc.rect(leftMargin, startY, 200, 55)
       .fill('#f8f9fa');
    
    doc.fontSize(9).fillColor('#333333').font('Helvetica-Bold');
    doc.text('Payment Information', leftMargin + 10, startY + 8, { lineBreak: false });
    doc.font('Helvetica');
    
    let yPos = startY + 22;
    doc.fontSize(8).fillColor('#666666');
    
    doc.text(`Gateway: ${invoice.gateway.charAt(0).toUpperCase() + invoice.gateway.slice(1)}`, leftMargin + 10, yPos, { lineBreak: false });
    yPos += 11;
    
    if (invoice.paymentMethod) {
      doc.text(`Method: ${invoice.paymentMethod}`, leftMargin + 10, yPos, { lineBreak: false });
      yPos += 11;
    }
    
    doc.text('Status: Paid', leftMargin + 10, yPos, { lineBreak: false });
    
    return startY + 65;
  }

  private renderFooter(
    doc: PDFKit.PDFDocument,
    companyInfo: CompanyInfo
  ): void {
    doc.switchToPage(0);
    
    const footerY = doc.page.height - 60;
    
    doc.moveTo(50, footerY)
       .lineTo(doc.page.width - 50, footerY)
       .stroke('#e0e0e0');
    
    doc.fontSize(9)
       .fillColor('#666666')
       .text('Thank you for your business!', 50, footerY + 10, { 
         align: 'center', 
         width: doc.page.width - 100,
         lineBreak: false 
       });
    
    doc.fontSize(7)
       .fillColor('#999999')
       .text(
         `For questions about this invoice, please contact ${companyInfo.email} | © ${new Date().getFullYear()} ${companyInfo.name}`,
         50, 
         footerY + 25, 
         { 
           align: 'center', 
           width: doc.page.width - 100,
           lineBreak: false 
         }
       );
  }

  private async savePDF(invoiceNumber: string, buffer: Buffer): Promise<string> {
    ensureInvoiceDir();
    
    const filename = `${invoiceNumber}.pdf`;
    const filepath = path.join(INVOICE_DIR, filename);
    
    await fs.promises.writeFile(filepath, buffer);
    
    return filepath;
  }

  async getInvoicePDF(invoiceId: string): Promise<Buffer | null> {
    const invoice = await storage.getInvoice(invoiceId);
    if (!invoice) {
      logger.warn(`Invoice not found: ${invoiceId}`, undefined, SOURCE);
      return null;
    }

    if (invoice.pdfUrl && fs.existsSync(invoice.pdfUrl)) {
      return fs.promises.readFile(invoice.pdfUrl);
    }

    logger.info(`PDF file not found, regenerating for invoice: ${invoice.invoiceNumber}`, undefined, SOURCE);
    const pdfBuffer = await this.generatePDF(invoice);
    
    const pdfPath = await this.savePDF(invoice.invoiceNumber, pdfBuffer);
    await storage.updateInvoice(invoice.id, {
      pdfUrl: pdfPath,
      pdfGeneratedAt: new Date(),
    });
    
    return pdfBuffer;
  }

  async getInvoicePDFByNumber(invoiceNumber: string): Promise<Buffer | null> {
    const invoice = await storage.getInvoiceByNumber(invoiceNumber);
    if (!invoice) {
      logger.warn(`Invoice not found by number: ${invoiceNumber}`, undefined, SOURCE);
      return null;
    }
    
    return this.getInvoicePDF(invoice.id);
  }

  async regeneratePDF(invoiceId: string): Promise<string | null> {
    const invoice = await storage.getInvoice(invoiceId);
    if (!invoice) {
      logger.warn(`Invoice not found for regeneration: ${invoiceId}`, undefined, SOURCE);
      return null;
    }

    const pdfBuffer = await this.generatePDF(invoice);
    const pdfPath = await this.savePDF(invoice.invoiceNumber, pdfBuffer);
    
    await storage.updateInvoice(invoice.id, {
      pdfUrl: pdfPath,
      pdfGeneratedAt: new Date(),
    });
    
    logger.info(`PDF regenerated for invoice: ${invoice.invoiceNumber}`, undefined, SOURCE);
    return pdfPath;
  }
}

export const invoiceService = new InvoiceService();

export async function generateInvoiceForTransaction(transactionId: string): Promise<Invoice | null> {
  try {
    logger.info(`Auto-generating invoice for transaction: ${transactionId}`, undefined, SOURCE);
    const invoice = await invoiceService.generateInvoice(transactionId);
    logger.info(`Invoice generated successfully: ${invoice.invoiceNumber}`, { transactionId }, SOURCE);
    return invoice;
  } catch (error) {
    logger.error(`Failed to auto-generate invoice for transaction: ${transactionId}`, error, SOURCE);
    return null;
  }
}
