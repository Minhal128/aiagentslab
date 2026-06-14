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
import { RouteContext, AuthRequest, escapeCSV } from "./common";

export function createSubscriptionRoutes(ctx: RouteContext): Router {
  const router = Router();
  const { storage, authenticateToken, authenticateHybrid } = ctx;

  // ============================================
  // PLANS ROUTES
  // ============================================

  // Get all plans (public)
  router.get("/api/plans", async (req: Request, res: Response) => {
    try {
      const plans = await storage.getAllPlans();
      res.json(plans);
    } catch (error: any) {
      console.error("Get plans error:", error);
      res.status(500).json({ error: "Failed to get plans" });
    }
  });

  // Get subscription plans (authenticated)
  router.get("/api/subscriptions/plans", authenticateHybrid, async (req: AuthRequest, res: Response) => {
    try {
      const plans = await storage.getAllPlans();
      res.json(plans);
    } catch (error: any) {
      console.error("Get subscription plans error:", error);
      res.status(500).json({ error: "Failed to get subscription plans" });
    }
  });

  // ============================================
  // USER SUBSCRIPTION ROUTES
  // ============================================

  // Get user's current subscription
  router.get("/api/subscriptions/my-subscription", authenticateHybrid, async (req: AuthRequest, res: Response) => {
    try {
      const subscription = await storage.getUserSubscription(req.userId!);
      res.json(subscription || null);
    } catch (error: any) {
      console.error("Get user subscription error:", error);
      res.status(500).json({ error: "Failed to get subscription" });
    }
  });

  // Get user subscription (alternate endpoint)
  router.get("/api/user-subscription", authenticateHybrid, async (req: AuthRequest, res: Response) => {
    try {
      const subscription = await storage.getUserSubscription(req.userId!);
      res.json(subscription);
    } catch (error: any) {
      console.error("Get user subscription error:", error);
      res.status(500).json({ error: "Failed to get subscription" });
    }
  });

  // ============================================
  // CREDIT PACKAGES ROUTES
  // ============================================

  // Get all credit packages (public)
  router.get("/api/credit-packages", async (req: Request, res: Response) => {
    try {
      const packages = await storage.getAllCreditPackages();
      res.json(packages);
    } catch (error: any) {
      console.error("Get credit packages error:", error);
      res.status(500).json({ error: "Failed to get credit packages" });
    }
  });

  // ============================================
  // CREDIT TRANSACTIONS ROUTES
  // ============================================

  // Get user's credit transactions
  router.get("/api/credits/transactions", authenticateHybrid, async (req: AuthRequest, res: Response) => {
    try {
      const transactions = await storage.getUserCreditTransactions(req.userId!);
      res.json(transactions);
    } catch (error: any) {
      console.error("Get credit transactions error:", error);
      res.status(500).json({ error: "Failed to get credit transactions" });
    }
  });

  // Get credit transactions (alternate endpoint)
  router.get("/api/credit-transactions", authenticateHybrid, async (req: AuthRequest, res: Response) => {
    try {
      const transactions = await storage.getUserCreditTransactions(req.userId!);
      res.json(transactions);
    } catch (error: any) {
      console.error("Get credit transactions error:", error);
      res.status(500).json({ error: "Failed to get credit transactions" });
    }
  });

  // Export credit transactions as CSV
  router.get("/api/credit-transactions/export", authenticateHybrid, async (req: AuthRequest, res: Response) => {
    try {
      const transactions = await storage.getUserCreditTransactions(req.userId!);
      
      // CSV header
      const csvHeader = "Date,Type,Amount,Description,Stripe Payment ID\n";
      
      // CSV rows
      const csvRows = transactions.map(t => {
        const date = new Date(t.createdAt).toISOString();
        const type = t.type === "credit" ? "Credit" : "Debit";
        const amount = t.type === "credit" ? `+${t.amount}` : `-${Math.abs(t.amount)}`;
        const description = escapeCSV(t.description);
        const stripeId = escapeCSV(t.stripePaymentId || "");
        return `${date},${type},${amount},${description},${stripeId}`;
      }).join("\n");

      const csv = csvHeader + csvRows;

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="transactions-${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(csv);
    } catch (error: any) {
      console.error("Export credit transactions error:", error);
      res.status(500).json({ error: "Failed to export credit transactions" });
    }
  });

  // ============================================
  // BILLING PROFILE ROUTES
  // ============================================

  // Get user's billing profile
  router.get("/api/billing-profile", authenticateHybrid, async (req: AuthRequest, res: Response) => {
    try {
      const user = await storage.getUser(req.userId!);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      res.json({
        billingName: user.billingName,
        billingAddressLine1: user.billingAddressLine1,
        billingAddressLine2: user.billingAddressLine2,
        billingCity: user.billingCity,
        billingState: user.billingState,
        billingPostalCode: user.billingPostalCode,
        billingCountry: user.billingCountry,
      });
    } catch (error: any) {
      console.error("Get billing profile error:", error);
      res.status(500).json({ error: "Failed to get billing profile" });
    }
  });

  // Update user's billing profile
  router.put("/api/billing-profile", authenticateHybrid, async (req: AuthRequest, res: Response) => {
    try {
      const { z } = await import('zod');
      const { billingName, billingAddressLine1, billingAddressLine2, billingCity, billingState, billingPostalCode, billingCountry } = req.body;
      
      const billingProfileSchema = z.object({
        billingName: z.string().min(1, "Full name is required"),
        billingAddressLine1: z.string().min(1, "Address line 1 is required"),
        billingAddressLine2: z.string().optional().nullable(),
        billingCity: z.string().min(1, "City is required"),
        billingState: z.string().min(1, "State/Province is required"),
        billingPostalCode: z.string().min(1, "Postal code is required"),
        billingCountry: z.string().min(1, "Country is required"),
      });
      
      const validationResult = billingProfileSchema.safeParse({
        billingName,
        billingAddressLine1,
        billingAddressLine2,
        billingCity,
        billingState,
        billingPostalCode,
        billingCountry,
      });
      
      if (!validationResult.success) {
        const errors = validationResult.error.errors.map(e => e.message).join(", ");
        return res.status(400).json({ error: errors });
      }
      
      await storage.updateUser(req.userId!, {
        billingName: billingName || null,
        billingAddressLine1: billingAddressLine1 || null,
        billingAddressLine2: billingAddressLine2 || null,
        billingCity: billingCity || null,
        billingState: billingState || null,
        billingPostalCode: billingPostalCode || null,
        billingCountry: billingCountry || null,
      });
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Update billing profile error:", error);
      res.status(500).json({ error: "Failed to update billing profile" });
    }
  });

  return router;
}
