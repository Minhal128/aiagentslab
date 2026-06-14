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

import { Router, Response } from "express";
import { storage } from "../storage";
import { requireRole, type AuthRequest } from "../middleware/auth";
import { authenticateHybrid } from "../middleware/hybrid-auth";
import { invoiceService } from "../services/invoice-service";
import { logger } from "../utils/logger";

const router = Router();
const SOURCE = "InvoiceRoutes";

/**
 * GET /api/invoices/:invoiceId/download
 * Download invoice PDF - authenticated users can download their own, admins can download any
 */
router.get("/:invoiceId/download", authenticateHybrid, async (req: AuthRequest, res: Response) => {
  try {
    const { invoiceId } = req.params;
    const userId = req.userId!;
    const userRole = req.userRole;

    const invoice = await storage.getInvoice(invoiceId);
    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    if (invoice.userId !== userId && userRole !== "admin") {
      return res.status(403).json({ message: "Access denied - you can only download your own invoices" });
    }

    const pdfBuffer = await invoiceService.getInvoicePDF(invoiceId);
    if (!pdfBuffer) {
      return res.status(404).json({ message: "Failed to generate invoice PDF" });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Invoice-${invoice.invoiceNumber}.pdf"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error: any) {
    logger.error(`Failed to download invoice: ${req.params.invoiceId}`, error, SOURCE);
    res.status(500).json({ message: "Failed to download invoice" });
  }
});

/**
 * GET /api/invoices/by-number/:invoiceNumber/download
 * Download invoice by invoice number
 */
router.get("/by-number/:invoiceNumber/download", authenticateHybrid, async (req: AuthRequest, res: Response) => {
  try {
    const { invoiceNumber } = req.params;
    const userId = req.userId!;
    const userRole = req.userRole;

    const invoice = await storage.getInvoiceByNumber(invoiceNumber);
    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    if (invoice.userId !== userId && userRole !== "admin") {
      return res.status(403).json({ message: "Access denied - you can only download your own invoices" });
    }

    const pdfBuffer = await invoiceService.getInvoicePDFByNumber(invoiceNumber);
    if (!pdfBuffer) {
      return res.status(404).json({ message: "Failed to generate invoice PDF" });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Invoice-${invoiceNumber}.pdf"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error: any) {
    logger.error(`Failed to download invoice by number: ${req.params.invoiceNumber}`, error, SOURCE);
    res.status(500).json({ message: "Failed to download invoice" });
  }
});

/**
 * GET /api/invoices/admin/:invoiceId/download
 * Admin-only download - download any invoice
 */
router.get("/admin/:invoiceId/download", authenticateHybrid, requireRole("admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { invoiceId } = req.params;

    const invoice = await storage.getInvoice(invoiceId);
    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    const pdfBuffer = await invoiceService.getInvoicePDF(invoiceId);
    if (!pdfBuffer) {
      return res.status(404).json({ message: "Failed to generate invoice PDF" });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Invoice-${invoice.invoiceNumber}.pdf"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error: any) {
    logger.error(`Admin failed to download invoice: ${req.params.invoiceId}`, error, SOURCE);
    res.status(500).json({ message: "Failed to download invoice" });
  }
});

/**
 * POST /api/invoices/admin/:transactionId/generate
 * Admin trigger to generate/regenerate invoice for a transaction
 */
router.post("/admin/:transactionId/generate", authenticateHybrid, requireRole("admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { transactionId } = req.params;
    const { regenerate } = req.body;

    const transaction = await storage.getPaymentTransaction(transactionId);
    if (!transaction) {
      return res.status(404).json({ message: "Transaction not found" });
    }

    if (transaction.status !== "completed") {
      return res.status(400).json({ 
        message: "Cannot generate invoice for non-completed transaction",
        transactionStatus: transaction.status
      });
    }

    const existingInvoice = await storage.getTransactionInvoice(transactionId);
    
    if (existingInvoice && !regenerate) {
      return res.json({ 
        message: "Invoice already exists",
        invoice: existingInvoice,
        alreadyExists: true
      });
    }

    if (existingInvoice && regenerate) {
      const pdfPath = await invoiceService.regeneratePDF(existingInvoice.id);
      const updatedInvoice = await storage.getInvoice(existingInvoice.id);
      return res.json({
        message: "Invoice PDF regenerated successfully",
        invoice: updatedInvoice,
        regenerated: true
      });
    }

    const invoice = await invoiceService.generateInvoice(transactionId);
    
    logger.info(`Admin generated invoice for transaction: ${transactionId}`, { 
      invoiceNumber: invoice.invoiceNumber,
      adminId: req.userId
    }, SOURCE);

    res.json({
      message: "Invoice generated successfully",
      invoice,
      created: true
    });
  } catch (error: any) {
    logger.error(`Failed to generate invoice for transaction: ${req.params.transactionId}`, error, SOURCE);
    res.status(500).json({ message: "Failed to generate invoice" });
  }
});

/**
 * GET /api/invoices/transaction/:transactionId
 * Get invoice for a specific transaction
 */
router.get("/transaction/:transactionId", authenticateHybrid, async (req: AuthRequest, res: Response) => {
  try {
    const { transactionId } = req.params;
    const userId = req.userId!;
    const userRole = req.userRole;

    const transaction = await storage.getPaymentTransaction(transactionId);
    if (!transaction) {
      return res.status(404).json({ message: "Transaction not found" });
    }

    if (transaction.userId !== userId && userRole !== "admin") {
      return res.status(403).json({ message: "Access denied" });
    }

    const invoice = await storage.getTransactionInvoice(transactionId);
    if (!invoice) {
      return res.status(404).json({ message: "No invoice for this transaction" });
    }

    res.json(invoice);
  } catch (error: any) {
    logger.error(`Failed to get invoice for transaction: ${req.params.transactionId}`, error, SOURCE);
    res.status(500).json({ message: "Failed to get invoice" });
  }
});

export default router;
