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

import { Router, Request, Response } from "express";
import { storage } from "../storage";
import { authenticateToken, requireRole, type AuthRequest } from "../middleware/auth";
import { db } from "../db";
import { users, paymentTransactions, refunds, invoices, plans, creditPackages } from "@shared/schema";
import archiver from "archiver";
import * as fs from "fs";
import * as path from "path";
import { eq } from "drizzle-orm";

const router = Router();

// Get all transactions with filters (admin only)
router.get("/", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { gateway, type, status, startDate, endDate } = req.query;
    
    const filters: any = {};
    if (gateway && typeof gateway === 'string') filters.gateway = gateway;
    if (type && typeof type === 'string') filters.type = type;
    if (status && typeof status === 'string') filters.status = status;
    if (startDate && typeof startDate === 'string') filters.startDate = new Date(startDate);
    if (endDate && typeof endDate === 'string') filters.endDate = new Date(endDate);

    const transactions = await storage.getAllPaymentTransactions(filters);
    
    // Enrich transactions with user and plan/package names
    const enrichedTransactions = await Promise.all(transactions.map(async (tx) => {
      const [user] = await db.select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, tx.userId));
      
      let planName = null;
      let packageName = null;
      
      if (tx.planId) {
        const [plan] = await db.select({ displayName: plans.displayName })
          .from(plans)
          .where(eq(plans.id, tx.planId));
        planName = plan?.displayName || 'Unknown Plan';
      }
      
      if (tx.creditPackageId) {
        const [pkg] = await db.select({ name: creditPackages.name })
          .from(creditPackages)
          .where(eq(creditPackages.id, tx.creditPackageId));
        packageName = pkg?.name || 'Unknown Package';
      }

      // Get refund info if exists
      const txRefunds = await storage.getTransactionRefunds(tx.id);
      
      // Get invoice if exists
      const invoice = await storage.getTransactionInvoice(tx.id);
      
      return {
        ...tx,
        user: user || null,
        planName,
        packageName,
        refunds: txRefunds,
        hasRefunds: txRefunds.length > 0,
        invoice: invoice ? { id: invoice.id, invoiceNumber: invoice.invoiceNumber, pdfUrl: invoice.pdfUrl } : null,
      };
    }));

    res.json({ transactions: enrichedTransactions });
  } catch (error: any) {
    console.error("Error fetching transactions:", error);
    res.status(500).json({ message: "Failed to fetch transactions" });
  }
});

// Get transaction analytics (admin only)
router.get("/analytics", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { startDate, endDate, timeRange } = req.query;
    
    let start: Date | undefined;
    let end: Date | undefined;

    // Handle timeRange parameter (week, month, year, all)
    if (timeRange && typeof timeRange === 'string') {
      const now = new Date();
      end = now;
      switch (timeRange) {
        case 'week':
          start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case 'year':
          start = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
          break;
        case 'all':
        default:
          start = undefined;
          end = undefined;
          break;
      }
    } else {
      start = startDate ? new Date(startDate as string) : undefined;
      end = endDate ? new Date(endDate as string) : undefined;
    }

    const analytics = await storage.getPaymentAnalytics(start, end);
    
    res.json(analytics);
  } catch (error: any) {
    console.error("Error fetching analytics:", error);
    res.status(500).json({ message: "Failed to fetch analytics" });
  }
});

// Get user's own transactions (with pagination support) - User accessible endpoint
// IMPORTANT: This route must be defined before /:id to avoid matching "history" as an id
router.get("/history", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    
    const transactions = await storage.getUserPaymentTransactions(userId);
    
    // Apply pagination
    const total = transactions.length;
    const paginatedTransactions = transactions.slice(offset, offset + limit);
    
    // Enrich with plan/package names and invoice availability
    const enrichedTransactions = await Promise.all(paginatedTransactions.map(async (tx) => {
      let planName = null;
      let packageName = null;
      
      if (tx.planId) {
        const [plan] = await db.select({ displayName: plans.displayName })
          .from(plans)
          .where(eq(plans.id, tx.planId));
        planName = plan?.displayName || 'Unknown Plan';
      }
      
      if (tx.creditPackageId) {
        const [pkg] = await db.select({ name: creditPackages.name })
          .from(creditPackages)
          .where(eq(creditPackages.id, tx.creditPackageId));
        packageName = pkg?.name || 'Unknown Package';
      }

      const invoice = await storage.getTransactionInvoice(tx.id);
      
      const txRefunds = await storage.getTransactionRefunds(tx.id);
      const completedRefund = txRefunds.find(r => r.status === 'completed');

      return {
        ...tx,
        planName,
        packageName,
        hasInvoice: !!invoice,
        invoiceId: invoice?.id || null,
        invoiceNumber: invoice?.invoiceNumber || null,
        hasRefund: !!completedRefund,
        refundId: completedRefund?.id || null,
        refundNoteNumber: completedRefund?.refundNoteNumber || null,
      };
    }));

    res.json({
      transactions: enrichedTransactions,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      }
    });
  } catch (error: any) {
    console.error("Error fetching user transactions:", error);
    res.status(500).json({ message: "Failed to fetch transactions" });
  }
});

// Get single transaction details (admin only)
router.get("/:id", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    
    const transaction = await storage.getPaymentTransaction(id);
    if (!transaction) {
      return res.status(404).json({ message: "Transaction not found" });
    }

    // Get user info
    const [user] = await db.select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, transaction.userId));

    // Get refunds for this transaction
    const txRefunds = await storage.getTransactionRefunds(id);

    // Get invoice if exists
    const invoice = await storage.getTransactionInvoice(id);

    res.json({
      ...transaction,
      user: user || null,
      refunds: txRefunds,
      invoice: invoice || null,
    });
  } catch (error: any) {
    console.error("Error fetching transaction:", error);
    res.status(500).json({ message: "Failed to fetch transaction" });
  }
});

// Get user's own transactions (legacy endpoint)
router.get("/user/history", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    
    const transactions = await storage.getUserPaymentTransactions(userId);
    
    // Enrich with plan/package names and invoice availability
    const enrichedTransactions = await Promise.all(transactions.map(async (tx) => {
      let planName = null;
      let packageName = null;
      
      if (tx.planId) {
        const [plan] = await db.select({ displayName: plans.displayName })
          .from(plans)
          .where(eq(plans.id, tx.planId));
        planName = plan?.displayName || 'Unknown Plan';
      }
      
      if (tx.creditPackageId) {
        const [pkg] = await db.select({ name: creditPackages.name })
          .from(creditPackages)
          .where(eq(creditPackages.id, tx.creditPackageId));
        packageName = pkg?.name || 'Unknown Package';
      }

      const invoice = await storage.getTransactionInvoice(tx.id);

      return {
        ...tx,
        planName,
        packageName,
        hasInvoice: !!invoice,
        invoiceNumber: invoice?.invoiceNumber || null,
      };
    }));

    res.json(enrichedTransactions);
  } catch (error: any) {
    console.error("Error fetching user transactions:", error);
    res.status(500).json({ message: "Failed to fetch transactions" });
  }
});

// Get all refunds (admin only)
router.get("/refunds/all", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
  try {
    const allRefunds = await storage.getAllRefunds();
    
    // Enrich with user and transaction info
    const enrichedRefunds = await Promise.all(allRefunds.map(async (refund) => {
      const [user] = await db.select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, refund.userId));
      
      const transaction = await storage.getPaymentTransaction(refund.transactionId);

      let adminUser = null;
      if (refund.adminId) {
        const [admin] = await db.select({ id: users.id, name: users.name })
          .from(users)
          .where(eq(users.id, refund.adminId));
        adminUser = admin || null;
      }

      return {
        ...refund,
        user: user || null,
        transaction: transaction || null,
        adminUser,
      };
    }));

    res.json(enrichedRefunds);
  } catch (error: any) {
    console.error("Error fetching refunds:", error);
    res.status(500).json({ message: "Failed to fetch refunds" });
  }
});

// Get all invoices (admin only)
router.get("/invoices/all", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
  try {
    const allInvoices = await storage.getAllInvoices();
    
    // Enrich with user info
    const enrichedInvoices = await Promise.all(allInvoices.map(async (invoice) => {
      const [user] = await db.select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, invoice.userId));

      return {
        ...invoice,
        user: user || null,
      };
    }));

    res.json({ invoices: enrichedInvoices });
  } catch (error: any) {
    console.error("Error fetching invoices:", error);
    res.status(500).json({ message: "Failed to fetch invoices" });
  }
});

// Get user's invoices
router.get("/user/invoices", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const userInvoices = await storage.getUserInvoices(userId);
    res.json(userInvoices);
  } catch (error: any) {
    console.error("Error fetching user invoices:", error);
    res.status(500).json({ message: "Failed to fetch invoices" });
  }
});

// Get invoice by ID
router.get("/invoice/:id", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const invoice = await storage.getInvoice(id);
    
    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    // Check if user owns the invoice or is admin
    if (invoice.userId !== req.userId && req.userRole !== 'admin') {
      return res.status(403).json({ message: "Access denied" });
    }

    res.json(invoice);
  } catch (error: any) {
    console.error("Error fetching invoice:", error);
    res.status(500).json({ message: "Failed to fetch invoice" });
  }
});

// Get webhook queue status (admin only)
router.get("/webhooks/queue", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
  try {
    const pending = await storage.getPendingWebhooks();
    const retryable = await storage.getRetryableWebhooks();
    const expired = await storage.getExpiredWebhooks();

    res.json({
      pending: pending.length,
      retryable: retryable.length,
      expired: expired.length,
      pendingItems: pending.slice(0, 20),
      retryableItems: retryable.slice(0, 20),
    });
  } catch (error: any) {
    console.error("Error fetching webhook queue:", error);
    res.status(500).json({ message: "Failed to fetch webhook queue" });
  }
});

// Bulk download invoices and/or refund notes as ZIP (admin only)
router.get("/export/zip", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { startDate, endDate, type } = req.query;
    
    // Type can be 'invoices', 'refunds', or 'all' (default)
    const exportType = (type as string) || 'all';
    
    let start: Date | undefined;
    let end: Date | undefined;
    
    if (startDate && typeof startDate === 'string') {
      start = new Date(startDate);
    }
    if (endDate && typeof endDate === 'string') {
      end = new Date(endDate);
      // Set to end of day
      end.setHours(23, 59, 59, 999);
    }
    
    const archive = archiver('zip', { zlib: { level: 9 } });
    const filesAdded: string[] = [];
    let hasFiles = false;
    
    // Get invoices
    if (exportType === 'all' || exportType === 'invoices') {
      const allInvoices = await storage.getAllInvoices();
      
      for (const invoice of allInvoices) {
        // Filter by date range
        if (start && invoice.issuedAt && new Date(invoice.issuedAt) < start) continue;
        if (end && invoice.issuedAt && new Date(invoice.issuedAt) > end) continue;
        
        if (invoice.pdfUrl && fs.existsSync(invoice.pdfUrl)) {
          const fileName = `invoices/${invoice.invoiceNumber.replace(/\//g, '-')}.pdf`;
          archive.file(invoice.pdfUrl, { name: fileName });
          filesAdded.push(fileName);
          hasFiles = true;
        }
      }
    }
    
    // Get refund notes
    if (exportType === 'all' || exportType === 'refunds') {
      const allRefunds = await storage.getAllRefunds();
      
      for (const refund of allRefunds) {
        // Filter by date range
        if (start && refund.createdAt && new Date(refund.createdAt) < start) continue;
        if (end && refund.createdAt && new Date(refund.createdAt) > end) continue;
        
        if (refund.pdfUrl && fs.existsSync(refund.pdfUrl)) {
          const fileName = `refund-notes/${refund.refundNoteNumber?.replace(/\//g, '-') || refund.id}.pdf`;
          archive.file(refund.pdfUrl, { name: fileName });
          filesAdded.push(fileName);
          hasFiles = true;
        }
      }
    }
    
    if (!hasFiles) {
      return res.status(404).json({ 
        message: "No documents found for the specified criteria",
        exportType,
        dateRange: { startDate: start?.toISOString(), endDate: end?.toISOString() }
      });
    }
    
    // Generate filename with date range
    const now = new Date();
    let zipFileName = `documents-export-${now.toISOString().split('T')[0]}`;
    if (exportType !== 'all') {
      zipFileName = `${exportType}-export-${now.toISOString().split('T')[0]}`;
    }
    if (start && end) {
      zipFileName += `-${start.toISOString().split('T')[0]}-to-${end.toISOString().split('T')[0]}`;
    }
    zipFileName += '.zip';
    
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFileName}"`);
    
    archive.on('error', (err) => {
      console.error("Archive error:", err);
      if (!res.headersSent) {
        res.status(500).json({ message: "Failed to create ZIP archive" });
      }
    });
    
    archive.pipe(res);
    await archive.finalize();
    
    console.log(`📦 [Export] Created ZIP with ${filesAdded.length} files: ${zipFileName}`);
  } catch (error: any) {
    console.error("Error exporting documents:", error);
    if (!res.headersSent) {
      res.status(500).json({ message: "Failed to export documents" });
    }
  }
});

export default router;
