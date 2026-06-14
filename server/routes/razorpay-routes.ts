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
import express, { Request, Response, Router } from 'express';
import { storage } from '../storage';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { NotificationService } from '../services/notification-service';
import { hasActiveMembership, syncUserWithSubscription } from '../services/membership-service';
import {
  getRazorpayClient,
  createRazorpaySubscription,
  createRazorpayOrder,
  fetchRazorpaySubscription,
  cancelRazorpaySubscription,
  verifyPaymentSignature,
  verifyWebhookSignature,
  isRazorpayConfigured,
  isRazorpayEnabled,
  testRazorpayConnection,
  getActivePaymentGateway,
} from '../services/razorpay-service';
import { queueFailedWebhook } from '../services/webhook-retry-service';
import { emailService } from '../services/email-service';
import { generateInvoiceForTransaction } from '../services/invoice-service';
import { applyRefund } from '../services/credit-service';

const router: Router = express.Router();

async function getRazorpayKeyId(): Promise<string | null> {
  const setting = await storage.getGlobalSetting('razorpay_key_id');
  return setting?.value as string | null;
}

router.get('/config', async (req: Request, res: Response) => {
  try {
    // Check if Razorpay is enabled (not necessarily the "active" gateway)
    // When both gateways are enabled, Razorpay config should be available
    const isEnabled = await isRazorpayEnabled();
    if (!isEnabled) {
      return res.json({ enabled: false, keyId: null });
    }

    const isConfigured = await isRazorpayConfigured();
    if (!isConfigured) {
      return res.json({ enabled: false, keyId: null });
    }

    const keyId = await getRazorpayKeyId();
    res.json({ enabled: true, keyId });
  } catch (error: any) {
    console.error('Get Razorpay config error:', error);
    res.status(500).json({ error: 'Failed to get Razorpay config' });
  }
});

router.post('/create-subscription', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    // Check if Razorpay is enabled (not necessarily the "active" gateway)
    // When both gateways are enabled, the user's currency selection determines which to use
    const isEnabled = await isRazorpayEnabled();
    if (!isEnabled) {
      return res.status(400).json({ error: 'Razorpay payments are not enabled' });
    }
    
    const isConfigured = await isRazorpayConfigured();
    if (!isConfigured) {
      return res.status(400).json({ error: 'Razorpay is not configured' });
    }
    
    const { planId, billingPeriod = 'monthly' } = req.body;
    const userId = req.userId!;

    if (!planId) {
      return res.status(400).json({ error: 'Plan ID required' });
    }

    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const plan = await storage.getPlan(planId);
    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    // Use razorpayPlanId for monthly (field name is razorpayPlanId, not razorpayMonthlyPlanId)
    const razorpayPlanIdToUse = billingPeriod === 'yearly' 
      ? plan.razorpayYearlyPlanId 
      : plan.razorpayPlanId;

    if (!razorpayPlanIdToUse) {
      return res.status(400).json({ 
        error: `Razorpay plan not configured for ${billingPeriod} billing period` 
      });
    }

    const subscription = await createRazorpaySubscription({
      planId: razorpayPlanIdToUse,
      totalCount: billingPeriod === 'yearly' ? 5 : 60,
      customerNotify: true,
      notes: {
        userId,
        planId,
        billingPeriod,
      },
      notifyInfo: {
        notifyEmail: user.email,
      },
    });

    // Return INR amount for Razorpay subscriptions (not USD)
    const inrAmount = billingPeriod === 'yearly' 
      ? plan.razorpayYearlyPrice 
      : plan.razorpayMonthlyPrice;
    
    res.json({
      subscriptionId: subscription.id,
      planName: plan.name,
      billingPeriod,
      amount: inrAmount ? parseFloat(inrAmount.toString()) : 0,
      currency: 'INR',
    });
  } catch (error: any) {
    console.error('Create Razorpay subscription error:', error);
    res.status(500).json({ error: 'Failed to create subscription' });
  }
});

router.post('/verify-subscription', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    // Check if Razorpay is enabled (not necessarily the "active" gateway)
    const isEnabled = await isRazorpayEnabled();
    if (!isEnabled) {
      return res.status(400).json({ error: 'Razorpay payments are not enabled' });
    }
    
    const { razorpay_subscription_id, razorpay_payment_id, razorpay_signature } = req.body;
    const userId = req.userId!;

    if (!razorpay_subscription_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing payment verification parameters' });
    }

    const isValid = await verifyPaymentSignature({
      razorpay_subscription_id,
      razorpay_payment_id,
      razorpay_signature,
    });

    if (!isValid) {
      return res.status(400).json({ error: 'Payment signature verification failed' });
    }

    const subscription = await fetchRazorpaySubscription(razorpay_subscription_id);
    const notes = subscription.notes || {};

    if (notes.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const plan = await storage.getPlan(notes.planId);
    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const billingPeriod = notes.billingPeriod || 'monthly';
    const currentPeriodEnd = new Date();
    if (billingPeriod === 'yearly') {
      currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 1);
    } else {
      currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);
    }

    const existingSub = await storage.getUserSubscription(userId);
    if (existingSub) {
      await storage.updateUserSubscription(existingSub.id, {
        planId: notes.planId,
        status: 'active',
        currentPeriodStart: new Date(),
        currentPeriodEnd,
        razorpaySubscriptionId: razorpay_subscription_id,
        cancelAtPeriodEnd: false,
        billingPeriod,
      });
    } else {
      await storage.createUserSubscription({
        userId,
        planId: notes.planId,
        status: 'active',
        currentPeriodStart: new Date(),
        currentPeriodEnd,
        razorpaySubscriptionId: razorpay_subscription_id,
        cancelAtPeriodEnd: false,
        billingPeriod,
      });
    }

    await storage.updateUser(userId, {
      planType: plan.name,
      planExpiresAt: currentPeriodEnd,
    });

    await NotificationService.notifyMembershipUpgraded(userId, plan.name);

    // Log payment transaction
    const userSub = await storage.getUserSubscription(userId);
    const inrAmount = billingPeriod === 'yearly' 
      ? plan.razorpayYearlyPrice 
      : plan.razorpayMonthlyPrice;
    try {
      await storage.createPaymentTransaction({
        userId,
        type: 'subscription',
        gateway: 'razorpay',
        gatewayTransactionId: razorpay_payment_id,
        gatewaySubscriptionId: razorpay_subscription_id,
        amount: inrAmount ? inrAmount.toString() : '0',
        currency: 'INR',
        planId: notes.planId,
        subscriptionId: userSub?.id,
        description: `${plan.displayName} Subscription`,
        billingPeriod,
        status: 'completed',
        completedAt: new Date(),
      });
      console.log(`✅ [Razorpay] Logged subscription transaction for user ${userId}`);
    } catch (txError: any) {
      console.error('Failed to log payment transaction:', txError);
    }

    res.json({
      success: true,
      message: 'Subscription activated successfully',
      plan: plan.name,
      expiresAt: currentPeriodEnd,
    });
  } catch (error: any) {
    console.error('Verify Razorpay subscription error:', error);
    res.status(500).json({ error: 'Failed to verify subscription' });
  }
});

router.post('/create-order', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    // Check if Razorpay is enabled (not necessarily the "active" gateway)
    // When both gateways are enabled, the user's currency selection determines which to use
    const isEnabled = await isRazorpayEnabled();
    if (!isEnabled) {
      return res.status(400).json({ error: 'Razorpay payments are not enabled' });
    }
    
    const isConfigured = await isRazorpayConfigured();
    if (!isConfigured) {
      return res.status(400).json({ error: 'Razorpay is not configured' });
    }
    
    const { packageId } = req.body;
    const userId = req.userId!;

    if (!packageId) {
      return res.status(400).json({ error: 'Package ID required' });
    }

    // Membership requirement - check both subscription table and user fields
    const hasMembership = await hasActiveMembership(userId);
    if (!hasMembership) {
      return res.status(403).json({ 
        error: 'Active Pro membership required to purchase credits. Please subscribe to a plan first.' 
      });
    }

    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const pkg = await storage.getCreditPackage(packageId);
    if (!pkg) {
      return res.status(404).json({ error: 'Credit package not found' });
    }

    // Use razorpayPrice (INR) for Razorpay, not price (USD)
    const inrPrice = pkg.razorpayPrice ? parseFloat(pkg.razorpayPrice.toString()) : 0;
    if (inrPrice <= 0) {
      return res.status(400).json({ error: 'Credit package does not have an INR price configured for Razorpay' });
    }

    // Razorpay receipt must be <= 40 chars, use shortened format
    const shortUserId = userId.slice(-8);
    const timestamp = Date.now().toString().slice(-10);
    const receipt = `cr_${shortUserId}_${timestamp}`;
    
    const order = await createRazorpayOrder({
      amount: inrPrice,
      currency: 'INR',
      receipt,
      notes: {
        userId,
        packageId,
        credits: pkg.credits.toString(),
        type: 'credits',
      },
    });

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      packageName: pkg.name,
      credits: pkg.credits,
    });
  } catch (error: any) {
    console.error('Create Razorpay order error:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

router.post('/verify-order', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    // Check if Razorpay is enabled (not necessarily the "active" gateway)
    const isEnabled = await isRazorpayEnabled();
    if (!isEnabled) {
      return res.status(400).json({ error: 'Razorpay payments are not enabled' });
    }
    
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, packageId } = req.body;
    const userId = req.userId!;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !packageId) {
      return res.status(400).json({ error: 'Missing payment verification parameters' });
    }

    const isValid = await verifyPaymentSignature({
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    });

    if (!isValid) {
      return res.status(400).json({ error: 'Payment signature verification failed' });
    }

    const pkg = await storage.getCreditPackage(packageId);
    if (!pkg) {
      return res.status(404).json({ error: 'Package not found' });
    }

    try {
      await storage.addCreditsAtomic(userId, pkg.credits, `Purchased ${pkg.name}`, razorpay_payment_id);
      import('../services/sip-credit-guard').then(({ reconnectAfterRecharge }) => reconnectAfterRecharge(userId)).catch(() => {});

      // Log payment transaction for credits
      const inrPrice = pkg.razorpayPrice ? parseFloat(pkg.razorpayPrice.toString()) : 0;
      try {
        await storage.createPaymentTransaction({
          userId,
          type: 'credits',
          gateway: 'razorpay',
          gatewayTransactionId: razorpay_payment_id,
          amount: inrPrice.toFixed(2),
          currency: 'INR',
          creditPackageId: pkg.id,
          description: `${pkg.name} - ${pkg.credits} Credits`,
          creditsAwarded: pkg.credits,
          status: 'completed',
          completedAt: new Date(),
        });
        console.log(`✅ [Razorpay] Logged credits transaction for user ${userId}`);
      } catch (txError: any) {
        console.error('Failed to log payment transaction:', txError);
      }
    } catch (error: any) {
      if (!error.message?.includes('unique') && !error.message?.includes('duplicate')) {
        throw error;
      }
      console.log(`Payment ${razorpay_payment_id} already processed, skipping credit addition`);
    }

    const user = await storage.getUser(userId);

    res.json({
      success: true,
      message: 'Credits added successfully',
      credits: pkg.credits,
      newBalance: user?.credits || 0,
    });
  } catch (error: any) {
    console.error('Verify Razorpay order error:', error);
    res.status(500).json({ error: 'Failed to verify order' });
  }
});

router.post('/cancel-subscription', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    // Check if Razorpay is enabled (not necessarily the "active" gateway)
    const isEnabled = await isRazorpayEnabled();
    if (!isEnabled) {
      return res.status(400).json({ error: 'Razorpay payments are not enabled' });
    }
    
    const userId = req.userId!;

    const subscription = await storage.getUserSubscription(userId);
    if (!subscription || !subscription.razorpaySubscriptionId) {
      return res.status(404).json({ error: 'No active Razorpay subscription found' });
    }

    await cancelRazorpaySubscription(subscription.razorpaySubscriptionId, true);

    await storage.updateUserSubscription(subscription.id, {
      cancelAtPeriodEnd: true,
    });

    res.json({
      message: 'Subscription will be canceled at the end of the billing period',
      currentPeriodEnd: subscription.currentPeriodEnd,
    });
  } catch (error: any) {
    console.error('Cancel Razorpay subscription error:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

router.post('/webhook', async (req: Request, res: Response) => {
  const rawReq = req as Request & { rawBody?: Buffer };
  const signature = req.headers['x-razorpay-signature'] as string;

  try {
    const rawBody = rawReq.rawBody || Buffer.from(JSON.stringify(req.body));
    const isValid = await verifyWebhookSignature(rawBody.toString(), signature || '');

    if (!isValid) {
      console.error('Razorpay webhook signature verification failed');
      return res.status(400).send('Invalid signature');
    }

    const event = req.body;
    const eventType = event.event;
    const payload = event.payload;

    console.log(`📥 [Razorpay Webhook] Received event: ${eventType}`);

    switch (eventType) {
      case 'subscription.authenticated': {
        console.log('✅ [Razorpay] Subscription authenticated');
        break;
      }

      case 'subscription.activated': {
        const subscription = payload.subscription?.entity;
        if (subscription) {
          const notes = subscription.notes || {};
          const userId = notes.userId;
          const planId = notes.planId;
          const billingPeriod = notes.billingPeriod || 'monthly';

          if (userId && planId) {
            const plan = await storage.getPlan(planId);
            if (plan) {
              const currentPeriodEnd = new Date();
              if (billingPeriod === 'yearly') {
                currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 1);
              } else {
                currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);
              }

              try {
                await storage.createUserSubscription({
                  userId,
                  planId,
                  status: 'active',
                  currentPeriodStart: new Date(),
                  currentPeriodEnd,
                  razorpaySubscriptionId: subscription.id,
                  cancelAtPeriodEnd: false,
                  billingPeriod,
                });
              } catch (error: any) {
                if (!error.message?.includes('unique') && !error.message?.includes('duplicate')) {
                  throw error;
                }
              }

              await storage.updateUser(userId, {
                planType: plan.name,
                planExpiresAt: currentPeriodEnd,
              });

              await NotificationService.notifyMembershipUpgraded(userId, plan.name);

              // Log payment transaction
              const userSub = await storage.getUserSubscription(userId);
              const payment = payload.payment?.entity;
              const inrAmount = billingPeriod === 'yearly' 
                ? plan.razorpayYearlyPrice 
                : plan.razorpayMonthlyPrice;
              try {
                const newTransaction = await storage.createPaymentTransaction({
                  userId,
                  type: 'subscription',
                  gateway: 'razorpay',
                  gatewayTransactionId: payment?.id || subscription.id,
                  gatewaySubscriptionId: subscription.id,
                  amount: inrAmount ? inrAmount.toString() : '0',
                  currency: 'INR',
                  planId,
                  subscriptionId: userSub?.id,
                  description: `${plan.displayName} Subscription`,
                  billingPeriod,
                  status: 'completed',
                  completedAt: new Date(),
                });
                console.log(`✅ [Razorpay Webhook] Logged subscription transaction for user ${userId}`);
                
                // Generate invoice and send purchase confirmation email
                try {
                  await generateInvoiceForTransaction(newTransaction.id);
                  await emailService.sendPurchaseConfirmation(newTransaction.id);
                  console.log(`✅ [Razorpay] Purchase confirmation email sent for transaction ${newTransaction.id}`);
                } catch (emailError: any) {
                  console.error(`❌ [Razorpay] Failed to send purchase confirmation email:`, emailError);
                }
              } catch (txError: any) {
                console.error('Failed to log payment transaction:', txError);
              }
            }
          }
        }
        break;
      }

      case 'subscription.charged': {
        const subscription = payload.subscription?.entity;
        const payment = payload.payment?.entity;

        if (subscription && payment) {
          const notes = subscription.notes || {};
          const userId = notes.userId;

          if (userId) {
            const userSub = await storage.getUserSubscription(userId);
            if (userSub) {
              const billingPeriod = userSub.billingPeriod || 'monthly';
              const newPeriodEnd = new Date();
              if (billingPeriod === 'yearly') {
                newPeriodEnd.setFullYear(newPeriodEnd.getFullYear() + 1);
              } else {
                newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);
              }

              await storage.updateUserSubscription(userSub.id, {
                status: 'active',
                currentPeriodStart: new Date(),
                currentPeriodEnd: newPeriodEnd,
              });

              // Get the plan name from the subscription to ensure proper planType sync
              const plan = userSub.planId ? await storage.getPlan(userSub.planId) : null;
              const planName = plan?.name || 'pro';
              
              await storage.updateUser(userId, {
                planType: planName,
                planExpiresAt: newPeriodEnd,
              });

              // Log payment transaction for renewal
              if (plan) {
                const inrAmount = (userSub.billingPeriod === 'yearly')
                  ? plan.razorpayYearlyPrice
                  : plan.razorpayMonthlyPrice;
                try {
                  const renewalTransaction = await storage.createPaymentTransaction({
                    userId,
                    type: 'subscription',
                    gateway: 'razorpay',
                    gatewayTransactionId: payment.id,
                    gatewaySubscriptionId: subscription.id,
                    amount: inrAmount ? inrAmount.toString() : '0',
                    currency: 'INR',
                    planId: plan.id,
                    subscriptionId: userSub.id,
                    description: `${plan.displayName} Subscription Renewal`,
                    billingPeriod: userSub.billingPeriod || 'monthly',
                    status: 'completed',
                    completedAt: new Date(),
                  });
                  console.log(`✅ [Razorpay Webhook] Logged renewal transaction for user ${userId}`);
                  
                  // Generate invoice and send purchase confirmation email for renewal
                  try {
                    await generateInvoiceForTransaction(renewalTransaction.id);
                    await emailService.sendPurchaseConfirmation(renewalTransaction.id);
                    console.log(`✅ [Razorpay] Renewal confirmation email sent for transaction ${renewalTransaction.id}`);
                  } catch (emailError: any) {
                    console.error(`❌ [Razorpay] Failed to send renewal confirmation email:`, emailError);
                  }
                } catch (txError: any) {
                  console.error('Failed to log payment transaction:', txError);
                }
              }
            }
          }
        }
        break;
      }

      case 'subscription.pending': {
        const subscription = payload.subscription?.entity;
        if (subscription) {
          const notes = subscription.notes || {};
          const userId = notes.userId;

          if (userId) {
            const userSub = await storage.getUserSubscription(userId);
            if (userSub) {
              await storage.updateUserSubscription(userSub.id, {
                status: 'pending',
              });
            }
          }
        }
        break;
      }

      case 'subscription.halted': {
        const subscription = payload.subscription?.entity;
        if (subscription) {
          const notes = subscription.notes || {};
          const userId = notes.userId;

          if (userId) {
            const userSub = await storage.getUserSubscription(userId);
            if (userSub) {
              await storage.updateUserSubscription(userSub.id, {
                status: 'cancelled',
              });

              await storage.updateUser(userId, {
                planType: 'free',
                planExpiresAt: null,
              });
            }
          }
        }
        break;
      }

      case 'subscription.cancelled': {
        const subscription = payload.subscription?.entity;
        if (subscription) {
          const notes = subscription.notes || {};
          const userId = notes.userId;

          if (userId) {
            const userSub = await storage.getUserSubscription(userId);
            if (userSub) {
              await storage.updateUserSubscription(userSub.id, {
                status: 'expired',
              });

              await storage.updateUser(userId, {
                planType: 'free',
                planExpiresAt: null,
              });

              try {
                const { db } = await import('../db');
                const { agents, llmModels } = await import('@shared/schema');
                const { eq, and } = await import('drizzle-orm');

                const userAgents = await storage.getUserAgents(userId);

                const proModels = await db
                  .select()
                  .from(llmModels)
                  .where(eq(llmModels.tier, 'pro'));

                const proModelIds = proModels.map(m => m.modelId);

                const agentsToUpdate = userAgents.filter(agent => {
                  const currentModel = (agent.config as any)?.model || agent.llmModel;
                  return currentModel && proModelIds.includes(currentModel);
                });

                if (agentsToUpdate.length > 0) {
                  const activeFreeModels = await db
                    .select()
                    .from(llmModels)
                    .where(and(
                      eq(llmModels.tier, 'free'),
                      eq(llmModels.isActive, true)
                    ))
                    .orderBy(llmModels.sortOrder, llmModels.name)
                    .limit(1);

                  if (activeFreeModels.length > 0) {
                    const defaultFreeModel = activeFreeModels[0].modelId;

                    for (const agent of agentsToUpdate) {
                      const updatedConfig = {
                        ...(typeof agent.config === 'object' ? agent.config : {}),
                        model: defaultFreeModel
                      } as any;

                      await db
                        .update(agents)
                        .set({
                          config: updatedConfig,
                          llmModel: defaultFreeModel,
                          updatedAt: new Date()
                        })
                        .where(eq(agents.id, agent.id));
                    }
                  }
                }
              } catch (error) {
                console.error('Error downgrading user agents:', error);
              }
            }
          }
        }
        break;
      }

      case 'order.paid': {
        const order = payload.order?.entity;
        const payment = payload.payment?.entity;

        if (order && payment) {
          const notes = order.notes || {};
          const userId = notes.userId;
          const packageId = notes.packageId;
          const credits = parseInt(notes.credits || '0', 10);

          if (userId && packageId && credits > 0) {
            try {
              await storage.addCreditsAtomic(userId, credits, `Purchased ${credits} credits`, payment.id);
              import('../services/sip-credit-guard').then(({ reconnectAfterRecharge }) => reconnectAfterRecharge(userId)).catch(() => {});

              // Log payment transaction for credits
              const pkg = await storage.getCreditPackage(packageId);
              if (pkg) {
                const inrAmount = order.amount ? (order.amount / 100) : 0;
                try {
                  const creditTransaction = await storage.createPaymentTransaction({
                    userId,
                    type: 'credits',
                    gateway: 'razorpay',
                    gatewayTransactionId: payment.id,
                    amount: inrAmount.toFixed(2),
                    currency: 'INR',
                    creditPackageId: packageId,
                    description: `${pkg.name} - ${credits} Credits`,
                    creditsAwarded: credits,
                    status: 'completed',
                    completedAt: new Date(),
                  });
                  console.log(`✅ [Razorpay Webhook] Logged credits transaction for user ${userId}`);
                  
                  // Generate invoice and send purchase confirmation email
                  try {
                    await generateInvoiceForTransaction(creditTransaction.id);
                    await emailService.sendPurchaseConfirmation(creditTransaction.id);
                    console.log(`✅ [Razorpay] Credits purchase confirmation email sent for transaction ${creditTransaction.id}`);
                  } catch (emailError: any) {
                    console.error(`❌ [Razorpay] Failed to send credits purchase confirmation email:`, emailError);
                  }
                } catch (txError: any) {
                  console.error('Failed to log payment transaction:', txError);
                }
              }
            } catch (error: any) {
              if (!error.message?.includes('unique') && !error.message?.includes('duplicate')) {
                throw error;
              }
            }
          }
        }
        break;
      }

      case 'payment.captured': {
        console.log('✅ [Razorpay] Payment captured');
        break;
      }

      case 'payment.failed': {
        const payment = payload.payment?.entity;
        console.error('❌ [Razorpay] Payment failed:', payment?.error_description);
        
        // Try to find the user and send payment failed email
        try {
          const notes = payment?.notes || {};
          const userId = notes.userId;
          if (userId) {
            const failedAmount = ((payment?.amount || 0) / 100).toFixed(2);
            await emailService.sendPaymentFailed(userId, failedAmount, payment?.error_description || 'Payment failed');
            console.log(`✅ [Razorpay] Payment failed email sent to user ${userId}`);
          }
        } catch (emailError: any) {
          console.error(`❌ [Razorpay] Failed to send payment failed email:`, emailError);
        }
        break;
      }

      case 'refund.created': {
        // Handle external refund (not initiated via our admin API)
        const refund = payload.refund?.entity;
        const paymentId = refund?.payment_id;
        
        console.log(`🔄 [Razorpay] External refund created: ${refund?.id} for payment ${paymentId}`);
        
        if (paymentId && refund) {
          try {
            // Find the original transaction
            const transaction = await storage.getPaymentTransactionByGatewayId('razorpay', paymentId);
            
            if (transaction) {
              // Check if we already have a refund for this transaction
              const existingRefunds = await storage.getTransactionRefunds(transaction.id);
              if (existingRefunds.length > 0) {
                console.log(`ℹ️ [Razorpay] Refund already exists for payment ${paymentId}, skipping`);
                break;
              }
              
              const userId = transaction.userId;
              
              // Reverse credits if it was a credit purchase using centralized applyRefund
              let creditsReversed = 0;
              if (transaction.type === 'credits' && transaction.creditsAwarded) {
                const refundResult = await applyRefund({
                  userId,
                  creditsToReverse: transaction.creditsAwarded,
                  gateway: 'razorpay',
                  gatewayRefundId: refund.id,
                  transactionId: transaction.id,
                  reason: 'External refund via Razorpay',
                });
                
                if (refundResult.success && !refundResult.alreadyProcessed) {
                  creditsReversed = refundResult.creditsReversed;
                  console.log(`🔄 [Razorpay] Reversed ${creditsReversed} credits for user ${userId}. Transaction logged.`);
                }
              }
              
              // Create refund record
              await storage.createRefund({
                transactionId: transaction.id,
                userId,
                amount: ((refund.amount || 0) / 100).toFixed(2),
                currency: refund.currency?.toUpperCase() || transaction.currency,
                gateway: 'razorpay',
                gatewayRefundId: refund.id,
                reason: 'gateway_refund',
                initiatedBy: 'gateway',
                status: 'completed',
                creditsReversed: creditsReversed > 0 ? creditsReversed : undefined,
                metadata: {
                  userSuspended: false,
                  refundReason: refund.notes?.reason || 'external_refund',
                },
              });
              
              // Update transaction status
              await storage.updatePaymentTransaction(transaction.id, {
                status: 'refunded',
              });
              
              console.log(`✅ [Razorpay] External refund processed for user ${userId}. Payment: ${paymentId}`);
            }
          } catch (error: any) {
            console.error('Error processing external refund:', error);
          }
        }
        break;
      }

      case 'payment.dispute.created': {
        // Handle chargeback/dispute - suspend user account
        const dispute = payload.dispute?.entity;
        const paymentId = dispute?.payment_id;
        
        console.log(`🚨 [Razorpay] Dispute created: ${dispute?.id} for payment ${paymentId}`);
        
        if (paymentId && dispute) {
          try {
            // Find the original transaction
            const transaction = await storage.getPaymentTransactionByGatewayId('razorpay', paymentId);
            
            if (transaction) {
              const userId = transaction.userId;
              
              // Reverse credits if it was a credit purchase using centralized applyRefund
              let creditsReversed = 0;
              if (transaction.type === 'credits' && transaction.creditsAwarded) {
                const refundResult = await applyRefund({
                  userId,
                  creditsToReverse: transaction.creditsAwarded,
                  gateway: 'razorpay',
                  gatewayRefundId: dispute.id,
                  transactionId: transaction.id,
                  reason: 'Chargeback dispute',
                });
                
                if (refundResult.success && !refundResult.alreadyProcessed) {
                  creditsReversed = refundResult.creditsReversed;
                  console.log(`🔄 [Razorpay] Reversed ${creditsReversed} credits for user ${userId}. Transaction logged.`);
                }
              }
              
              // Create refund record
              await storage.createRefund({
                transactionId: transaction.id,
                userId,
                amount: ((dispute.amount || 0) / 100).toFixed(2),
                currency: dispute.currency?.toUpperCase() || transaction.currency,
                gateway: 'razorpay',
                gatewayRefundId: dispute.id,
                reason: 'chargeback',
                initiatedBy: 'gateway',
                status: 'completed',
                creditsReversed: creditsReversed > 0 ? creditsReversed : undefined,
                metadata: {
                  userSuspended: true,
                  disputeReason: dispute.reason_code || 'unknown',
                  disputePhase: dispute.phase,
                },
              });
              
              // Update transaction status
              await storage.updatePaymentTransaction(transaction.id, {
                status: 'refunded',
              });
              
              // SUSPEND user account
              await storage.updateUser(userId, {
                isActive: false,
              });
              
              // Send account suspended email
              try {
                await emailService.sendAccountSuspended(userId, `Chargeback dispute: ${dispute.reason_code || 'Unknown reason'}`);
                console.log(`✅ [Razorpay] Account suspended email sent to user ${userId}`);
              } catch (emailError: any) {
                console.error(`❌ [Razorpay] Failed to send account suspended email:`, emailError);
              }
              
              console.log(`⛔ [Razorpay] User ${userId} suspended due to chargeback. Dispute ID: ${dispute.id}, Reason: ${dispute.reason_code}`);
            } else {
              console.warn(`⚠️ [Razorpay] No transaction found for payment ${paymentId}`);
            }
          } catch (error: any) {
            console.error('Error processing chargeback:', error);
          }
        }
        break;
      }

      default:
        console.log(`ℹ️ [Razorpay] Unhandled event type: ${eventType}`);
    }

    res.json({ received: true });
  } catch (error: any) {
    console.error('Razorpay webhook error:', error);
    
    const event = req.body;
    await queueFailedWebhook(
      'razorpay',
      event?.event || 'unknown',
      event?.payload?.payment?.entity?.id || event?.payload?.subscription?.entity?.id || `razorpay_${Date.now()}`,
      event?.payload || event,
      error.message || 'Unknown error'
    );
    
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;
