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
import { authenticateToken, requireRole, type AuthRequest } from "../middleware/auth";
import { db } from "../db";
import { users, paymentTransactions } from "@shared/schema";
import { eq } from "drizzle-orm";
import { getStripeClient, isStripeEnabled } from "../services/stripe-service";
import { getRazorpayClient, isRazorpayEnabled } from "../services/razorpay-service";
import { getPayPalClient, isPayPalEnabled } from "../services/paypal-service";
import { isPaystackEnabled } from "../services/paystack-service";
import { getMercadoPagoClient, isMercadoPagoEnabled } from "../services/mercadopago-service";
import { PaymentRefund as MercadoPagoRefund } from 'mercadopago';
import axios from 'axios';
import { applyRefund, type RefundGateway } from "../services/credit-service";
import { generateRefundNoteForRefund, refundNoteService } from "../services/refund-note-service";

const router = Router();

interface RefundRequest {
  amount: number;
  reason?: string;
  adminNote?: string;
  customerNote?: string;
}

interface GatewayRefundResult {
  success: boolean;
  gatewayRefundId?: string;
  error?: string;
}

async function processStripeRefund(
  gatewayTransactionId: string,
  amount: number,
  currency: string
): Promise<GatewayRefundResult> {
  try {
    const stripe = await getStripeClient();
    if (!stripe) {
      return { success: false, error: 'Stripe is not configured' };
    }

    const amountInCents = Math.round(amount * 100);
    
    const refund = await stripe.refunds.create({
      payment_intent: gatewayTransactionId,
      amount: amountInCents,
    });

    console.log(`✅ [Stripe] Created refund ${refund.id} for payment intent ${gatewayTransactionId}`);
    return { success: true, gatewayRefundId: refund.id };
  } catch (error: any) {
    console.error(`❌ [Stripe] Refund failed:`, error.message);
    return { success: false, error: error.message };
  }
}

async function processRazorpayRefund(
  gatewayTransactionId: string,
  amount: number,
  currency: string
): Promise<GatewayRefundResult> {
  try {
    const razorpay = await getRazorpayClient();
    if (!razorpay) {
      return { success: false, error: 'Razorpay is not configured' };
    }

    const amountInPaise = Math.round(amount * 100);
    
    const refund = await razorpay.payments.refund(gatewayTransactionId, {
      amount: amountInPaise,
    });

    console.log(`✅ [Razorpay] Created refund ${refund.id} for payment ${gatewayTransactionId}`);
    return { success: true, gatewayRefundId: refund.id };
  } catch (error: any) {
    console.error(`❌ [Razorpay] Refund failed:`, error.message);
    return { success: false, error: error.message };
  }
}

async function processPayPalRefund(
  gatewayTransactionId: string,
  amount: number,
  currency: string
): Promise<GatewayRefundResult> {
  try {
    const client = await getPayPalClient();
    if (!client) {
      return { success: false, error: 'PayPal is not configured' };
    }

    const response = await client.post(`/v2/payments/captures/${gatewayTransactionId}/refund`, {
      amount: {
        value: amount.toFixed(2),
        currency_code: currency.toUpperCase(),
      },
    });

    console.log(`✅ [PayPal] Created refund ${response.data.id} for capture ${gatewayTransactionId}`);
    return { success: true, gatewayRefundId: response.data.id };
  } catch (error: any) {
    console.error(`❌ [PayPal] Refund failed:`, error.message);
    return { success: false, error: error.response?.data?.message || error.message };
  }
}

async function getPaystackSecretKey(): Promise<string | null> {
  const setting = await storage.getGlobalSetting('paystack_secret_key');
  return (setting?.value as string | null) ?? null;
}

async function processPaystackRefund(
  gatewayTransactionId: string,
  amount: number,
  currency: string
): Promise<GatewayRefundResult> {
  try {
    const secretKey = await getPaystackSecretKey();
    if (!secretKey) {
      return { success: false, error: 'Paystack is not configured' };
    }

    const amountInKobo = Math.round(amount * 100);
    
    const response = await axios.post(
      'https://api.paystack.co/refund',
      {
        transaction: gatewayTransactionId,
        amount: amountInKobo,
      },
      {
        headers: {
          'Authorization': `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.data.status) {
      return { success: false, error: response.data.message || 'Refund failed' };
    }

    console.log(`✅ [Paystack] Created refund for transaction ${gatewayTransactionId}`);
    return { success: true, gatewayRefundId: response.data.data?.id?.toString() };
  } catch (error: any) {
    console.error(`❌ [Paystack] Refund failed:`, error.message);
    return { success: false, error: error.response?.data?.message || error.message };
  }
}

async function processMercadoPagoRefund(
  gatewayTransactionId: string,
  amount: number,
  currency: string
): Promise<GatewayRefundResult> {
  try {
    const client = await getMercadoPagoClient();
    if (!client) {
      return { success: false, error: 'MercadoPago is not configured' };
    }

    const refund = new MercadoPagoRefund(client);
    const response = await refund.create({
      payment_id: parseInt(gatewayTransactionId, 10),
      body: {
        amount: amount,
      },
    });

    console.log(`✅ [MercadoPago] Created refund ${response.id} for payment ${gatewayTransactionId}`);
    return { success: true, gatewayRefundId: response.id?.toString() };
  } catch (error: any) {
    console.error(`❌ [MercadoPago] Refund failed:`, error.message);
    return { success: false, error: error.message };
  }
}

router.post("/:transactionId", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { transactionId } = req.params;
    const { amount, reason, adminNote, customerNote } = req.body as RefundRequest;
    const adminId = req.userId!;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: "Valid refund amount is required" });
    }

    const transaction = await storage.getPaymentTransaction(transactionId);
    if (!transaction) {
      return res.status(404).json({ message: "Transaction not found" });
    }

    if (transaction.status === 'refunded') {
      return res.status(400).json({ message: "Transaction has already been fully refunded" });
    }

    if (transaction.status !== 'completed') {
      return res.status(400).json({ message: "Only completed transactions can be refunded" });
    }

    const transactionAmount = parseFloat(transaction.amount);
    const existingRefunds = await storage.getTransactionRefunds(transactionId);
    const totalRefunded = existingRefunds.reduce((sum, r) => sum + parseFloat(r.amount), 0);
    const availableForRefund = transactionAmount - totalRefunded;

    if (amount > availableForRefund) {
      return res.status(400).json({ 
        message: `Refund amount exceeds available balance. Maximum refundable: ${availableForRefund.toFixed(2)} ${transaction.currency}` 
      });
    }

    const user = await storage.getUser(transaction.userId);
    if (!user) {
      return res.status(404).json({ message: "User associated with transaction not found" });
    }

    console.log(`🔄 [Refund] Processing ${transaction.gateway} refund for transaction ${transactionId}`);
    console.log(`   Amount: ${amount} ${transaction.currency}`);
    console.log(`   Admin: ${adminId}`);

    let gatewayResult: GatewayRefundResult;

    switch (transaction.gateway) {
      case 'stripe':
        if (!await isStripeEnabled()) {
          return res.status(400).json({ message: "Stripe is not enabled" });
        }
        if (!transaction.gatewayTransactionId) {
          return res.status(400).json({ message: "No Stripe payment intent found for this transaction" });
        }
        gatewayResult = await processStripeRefund(
          transaction.gatewayTransactionId,
          amount,
          transaction.currency
        );
        break;

      case 'razorpay':
        if (!await isRazorpayEnabled()) {
          return res.status(400).json({ message: "Razorpay is not enabled" });
        }
        if (!transaction.gatewayTransactionId) {
          return res.status(400).json({ message: "No Razorpay payment ID found for this transaction" });
        }
        gatewayResult = await processRazorpayRefund(
          transaction.gatewayTransactionId,
          amount,
          transaction.currency
        );
        break;

      case 'paypal':
        if (!await isPayPalEnabled()) {
          return res.status(400).json({ message: "PayPal is not enabled" });
        }
        if (!transaction.gatewayTransactionId) {
          return res.status(400).json({ message: "No PayPal capture ID found for this transaction" });
        }
        gatewayResult = await processPayPalRefund(
          transaction.gatewayTransactionId,
          amount,
          transaction.currency
        );
        break;

      case 'paystack':
        if (!await isPaystackEnabled()) {
          return res.status(400).json({ message: "Paystack is not enabled" });
        }
        if (!transaction.gatewayTransactionId) {
          return res.status(400).json({ message: "No Paystack transaction reference found" });
        }
        gatewayResult = await processPaystackRefund(
          transaction.gatewayTransactionId,
          amount,
          transaction.currency
        );
        break;

      case 'mercadopago':
        if (!await isMercadoPagoEnabled()) {
          return res.status(400).json({ message: "MercadoPago is not enabled" });
        }
        if (!transaction.gatewayTransactionId) {
          return res.status(400).json({ message: "No MercadoPago payment ID found for this transaction" });
        }
        gatewayResult = await processMercadoPagoRefund(
          transaction.gatewayTransactionId,
          amount,
          transaction.currency
        );
        break;

      default:
        return res.status(400).json({ message: `Unsupported payment gateway: ${transaction.gateway}` });
    }

    let creditsReversed: number | null = null;
    
    if (transaction.type === 'credits' && transaction.creditsAwarded && gatewayResult.success) {
      const refundRatio = amount / transactionAmount;
      const creditsToReverse = Math.floor((transaction.creditsAwarded || 0) * refundRatio);
      
      if (creditsToReverse > 0) {
        const refundResult = await applyRefund({
          userId: user.id,
          creditsToReverse,
          gateway: transaction.gateway as RefundGateway,
          gatewayRefundId: gatewayResult.gatewayRefundId || `admin_refund_${transactionId}`,
          transactionId,
          reason: reason || 'Admin initiated refund',
        });
        
        if (refundResult.success) {
          creditsReversed = refundResult.creditsReversed;
          console.log(`✅ [Refund] Reversed ${creditsReversed} credits from user ${user.id}. New balance: ${refundResult.newBalance}. Transaction logged.`);
        } else {
          console.error(`❌ [Refund] Failed to reverse credits: ${refundResult.error}`);
        }
      }
    }

    const refund = await storage.createRefund({
      transactionId,
      userId: transaction.userId,
      amount: amount.toString(),
      currency: transaction.currency,
      gateway: transaction.gateway,
      gatewayRefundId: gatewayResult.gatewayRefundId || null,
      reason: reason || 'admin_request',
      initiatedBy: 'admin',
      adminId,
      status: gatewayResult.success ? 'completed' : 'failed',
      creditsReversed,
      adminNote: adminNote || null,
      customerNote: customerNote || null,
      processedAt: gatewayResult.success ? new Date() : null,
      metadata: gatewayResult.error ? { error: gatewayResult.error } : null,
    });

    if (gatewayResult.success) {
      const newTotalRefunded = totalRefunded + amount;
      const newStatus = newTotalRefunded >= transactionAmount ? 'refunded' : 'partially_refunded';
      
      await storage.updatePaymentTransaction(transactionId, {
        status: newStatus,
      });

      console.log(`✅ [Refund] Transaction ${transactionId} status updated to ${newStatus}`);
      
      // Generate refund note PDF
      try {
        const updatedRefund = await generateRefundNoteForRefund(refund.id);
        console.log(`📄 [Refund] Generated refund note: ${updatedRefund.refundNoteNumber}`);
      } catch (pdfError: any) {
        console.error(`⚠️ [Refund] Failed to generate refund note PDF:`, pdfError.message);
      }
    }

    if (!gatewayResult.success) {
      console.error(`❌ [Refund] Failed to process refund:`, gatewayResult.error);
      return res.status(500).json({ 
        message: "Gateway refund failed", 
        error: gatewayResult.error,
        refund,
      });
    }

    // Get the latest refund data with PDF info
    const updatedRefund = await storage.getRefund(refund.id);

    const [adminUser] = await db.select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.id, adminId));

    res.json({
      message: "Refund processed successfully",
      refund: {
        ...(updatedRefund || refund),
        adminUser,
      },
      creditsReversed,
    });
  } catch (error: any) {
    console.error("Error processing refund:", error);
    res.status(500).json({ message: "Failed to process refund" });
  }
});

router.get("/:id/download", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const userRole = req.userRole;
    
    const refund = await storage.getRefund(id);
    if (!refund) {
      return res.status(404).json({ message: "Refund not found" });
    }

    // Users can only download their own refund notes, admins can download any
    if (userRole !== 'admin' && userRole !== 'super_admin' && refund.userId !== userId) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (!refund.pdfUrl) {
      // Try to generate the refund note if it doesn't exist
      try {
        const updatedRefund = await generateRefundNoteForRefund(id);
        if (!updatedRefund.pdfUrl) {
          return res.status(404).json({ message: "Refund note PDF not available" });
        }
      } catch (error) {
        return res.status(404).json({ message: "Refund note PDF not available" });
      }
    }

    const pdfBuffer = await refundNoteService.getRefundNotePDF(id);
    if (!pdfBuffer) {
      return res.status(404).json({ message: "Refund note PDF file not found" });
    }

    const latestRefund = await storage.getRefund(id);
    const fileName = latestRefund?.refundNoteNumber 
      ? `${latestRefund.refundNoteNumber.replace(/\//g, '-')}.pdf`
      : `refund-note-${id}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error: any) {
    console.error("Error downloading refund note:", error);
    res.status(500).json({ message: "Failed to download refund note" });
  }
});

router.get("/:id", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    
    const refund = await storage.getRefund(id);
    if (!refund) {
      return res.status(404).json({ message: "Refund not found" });
    }

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

    res.json({
      ...refund,
      user: user || null,
      transaction: transaction || null,
      adminUser,
    });
  } catch (error: any) {
    console.error("Error fetching refund:", error);
    res.status(500).json({ message: "Failed to fetch refund" });
  }
});

router.get("/", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
  try {
    const allRefunds = await storage.getAllRefunds();
    
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

// Get user's own refunds
router.get("/user/my-refunds", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const userRefunds = await storage.getUserRefunds(userId);
    
    // Enrich with transaction info
    const enrichedRefunds = await Promise.all(userRefunds.map(async (refund) => {
      const transaction = await storage.getPaymentTransaction(refund.transactionId);
      return {
        ...refund,
        transaction: transaction ? {
          id: transaction.id,
          type: transaction.type,
          gateway: transaction.gateway,
          description: transaction.description,
        } : null,
      };
    }));

    res.json(enrichedRefunds);
  } catch (error: any) {
    console.error("Error fetching user refunds:", error);
    res.status(500).json({ message: "Failed to fetch refunds" });
  }
});

// Download refund note PDF (admin)
router.get("/admin/:id/download", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    
    const refund = await storage.getRefund(id);
    if (!refund) {
      return res.status(404).json({ message: "Refund not found" });
    }

    if (!refund.pdfUrl) {
      // Try to generate the refund note if it doesn't exist
      try {
        const updatedRefund = await refundNoteService.generateRefundNote(id);
        if (!updatedRefund.pdfUrl) {
          return res.status(404).json({ message: "Refund note PDF not available" });
        }
        refund.pdfUrl = updatedRefund.pdfUrl;
      } catch (genError: any) {
        return res.status(404).json({ message: "Refund note PDF not available" });
      }
    }

    const fs = await import('fs');
    if (!fs.existsSync(refund.pdfUrl)) {
      return res.status(404).json({ message: "Refund note PDF file not found" });
    }

    const fileName = `RefundNote-${refund.refundNoteNumber || id}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    
    const fileStream = fs.createReadStream(refund.pdfUrl);
    fileStream.pipe(res);
  } catch (error: any) {
    console.error("Error downloading refund note:", error);
    res.status(500).json({ message: "Failed to download refund note" });
  }
});

// Download refund note PDF (user - own refunds only)
router.get("/user/:id/download", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    
    const refund = await storage.getRefund(id);
    if (!refund) {
      return res.status(404).json({ message: "Refund not found" });
    }

    // Verify the refund belongs to this user
    if (refund.userId !== userId) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (!refund.pdfUrl) {
      return res.status(404).json({ message: "Refund note PDF not available" });
    }

    const fs = await import('fs');
    if (!fs.existsSync(refund.pdfUrl)) {
      return res.status(404).json({ message: "Refund note PDF file not found" });
    }

    const fileName = `RefundNote-${refund.refundNoteNumber || id}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    
    const fileStream = fs.createReadStream(refund.pdfUrl);
    fileStream.pipe(res);
  } catch (error: any) {
    console.error("Error downloading refund note:", error);
    res.status(500).json({ message: "Failed to download refund note" });
  }
});

export default router;
