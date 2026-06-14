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
  getPaystackClient,
  isPaystackEnabled,
  getPaystackCurrency,
  getPaystackConfig,
  getSupportedCurrencies,
  initializePaystackTransaction,
  verifyPaystackTransaction,
  createPaystackSubscription,
  disablePaystackSubscription,
  fetchPaystackSubscription,
  verifyPaystackWebhookSignature,
  createPaystackCustomer,
  fetchPaystackCustomer,
  resetPaystackClient
} from '../services/paystack-service';
import { queueFailedWebhook } from '../services/webhook-retry-service';
import { emailService } from '../services/email-service';
import { generateInvoiceForTransaction } from '../services/invoice-service';
import { FRONTEND_URL } from '../engines/payment/webhook-helper';
import { applyRefund } from '../services/credit-service';

const router: Router = express.Router();

router.get('/config', async (_req: Request, res: Response) => {
  try {
    const config = await getPaystackConfig();
    const currencies = getSupportedCurrencies();
    res.json({
      ...config,
      supportedCurrencies: currencies,
    });
  } catch (error: any) {
    console.error('Error fetching Paystack config:', error);
    res.status(500).json({ error: 'Failed to fetch Paystack configuration' });
  }
});

router.post('/initialize-transaction', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const isEnabled = await isPaystackEnabled();
    if (!isEnabled) {
      return res.status(400).json({ error: 'Paystack payments are not enabled' });
    }

    const client = await getPaystackClient();
    if (!client) {
      return res.status(400).json({ error: 'Paystack is not configured' });
    }

    const { packageId } = req.body;
    const userId = req.userId!;

    if (!packageId) {
      return res.status(400).json({ error: 'Package ID required' });
    }

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

    const currencyConfig = await getPaystackCurrency();
    const price = pkg.paystackPrice ? parseFloat(pkg.paystackPrice.toString()) : parseFloat(pkg.price.toString());

    const reference = `credits_${userId}_${packageId}_${Date.now()}`;

    const transaction = await initializePaystackTransaction({
      email: user.email,
      amount: price,
      currency: currencyConfig.currency,
      reference,
      callbackUrl: `${FRONTEND_URL}/app/billing?paystack=success&reference=${reference}`,
      metadata: {
        userId,
        packageId,
        credits: pkg.credits,
        type: 'credits',
      },
    });

    res.json({
      authorizationUrl: transaction.authorization_url,
      accessCode: transaction.access_code,
      reference: transaction.reference,
      packageName: pkg.name,
      credits: pkg.credits,
      amount: price,
      currency: currencyConfig.currency,
      currencySymbol: currencyConfig.symbol,
    });
  } catch (error: any) {
    console.error('Initialize Paystack transaction error:', error);
    res.status(500).json({ error: 'Failed to initialize Paystack transaction' });
  }
});

router.post('/verify-transaction', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const client = await getPaystackClient();
    if (!client) {
      return res.status(400).json({ error: 'Paystack is not configured' });
    }

    const { reference } = req.body;
    const userId = req.userId!;

    if (!reference) {
      return res.status(400).json({ error: 'Reference required' });
    }

    const transaction = await verifyPaystackTransaction(reference);

    if (transaction.status !== 'success') {
      return res.status(400).json({ error: 'Payment not completed' });
    }

    const metadata = transaction.metadata;
    if (!metadata || metadata.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (metadata.type === 'credits') {
      const pkg = await storage.getCreditPackage(metadata.packageId);
      if (!pkg) {
        return res.status(404).json({ error: 'Package not found' });
      }

      try {
        await storage.addCreditsAtomic(userId, metadata.credits, `Purchased ${pkg.name} via Paystack`, `paystack_${reference}`);
        import('../services/sip-credit-guard').then(({ reconnectAfterRecharge }) => reconnectAfterRecharge(userId)).catch(() => {});
        
        // Log payment transaction for credits
        const currencyConfig = await getPaystackCurrency();
        const amount = transaction.amount ? (transaction.amount / 100).toFixed(2) : '0';
        try {
          const creditTransaction = await storage.createPaymentTransaction({
            userId,
            type: 'credits',
            gateway: 'paystack',
            gatewayTransactionId: reference,
            amount,
            currency: (transaction.currency || currencyConfig.currency).toUpperCase(),
            creditPackageId: metadata.packageId,
            description: `${pkg.name} - ${metadata.credits} Credits`,
            creditsAwarded: metadata.credits,
            status: 'completed',
            completedAt: new Date(),
          });
          console.log(`✅ [Paystack] Logged credits transaction for user ${userId}`);
          
          // Generate invoice and send purchase confirmation email
          try {
            await generateInvoiceForTransaction(creditTransaction.id);
            await emailService.sendPurchaseConfirmation(creditTransaction.id);
            console.log(`✅ [Paystack] Credits purchase confirmation email sent for transaction ${creditTransaction.id}`);
          } catch (emailError: any) {
            console.error(`❌ [Paystack] Failed to send credits purchase confirmation email:`, emailError);
          }
        } catch (txError: any) {
          console.error('Failed to log payment transaction:', txError);
        }

        res.json({ success: true, credits: metadata.credits });
      } catch (error: any) {
        if (error.message?.includes('unique') || error.message?.includes('duplicate')) {
          res.json({ success: true, alreadyProcessed: true });
        } else {
          throw error;
        }
      }
    } else {
      res.json({ success: true });
    }
  } catch (error: any) {
    console.error('Verify Paystack transaction error:', error);
    res.status(500).json({ error: 'Failed to verify Paystack transaction' });
  }
});

router.post('/create-subscription', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const isEnabled = await isPaystackEnabled();
    if (!isEnabled) {
      return res.status(400).json({ error: 'Paystack payments are not enabled' });
    }

    const client = await getPaystackClient();
    if (!client) {
      return res.status(400).json({ error: 'Paystack is not configured' });
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

    const paystackPlanCode = billingPeriod === 'yearly' ? plan.paystackYearlyPlanCode : plan.paystackMonthlyPlanCode;
    if (!paystackPlanCode) {
      return res.status(400).json({ error: 'Paystack plan not configured for this billing period' });
    }

    const currencyConfig = await getPaystackCurrency();
    const price = billingPeriod === 'yearly'
      ? parseFloat(plan.paystackYearlyPrice?.toString() || plan.yearlyPrice?.toString() || '0')
      : parseFloat(plan.paystackMonthlyPrice?.toString() || plan.monthlyPrice?.toString() || '0');

    const reference = `sub_${userId}_${planId}_${Date.now()}`;

    const transaction = await initializePaystackTransaction({
      email: user.email,
      amount: price,
      currency: currencyConfig.currency,
      reference,
      callbackUrl: `${FRONTEND_URL}/app/billing?paystack_subscription=success&plan_id=${planId}&billing_period=${billingPeriod}`,
      plan: paystackPlanCode,
      metadata: {
        userId,
        planId,
        billingPeriod,
        type: 'subscription',
      },
    });

    res.json({
      authorizationUrl: transaction.authorization_url,
      accessCode: transaction.access_code,
      reference: transaction.reference,
      planName: plan.displayName,
      billingPeriod,
      amount: price,
      currency: currencyConfig.currency,
      currencySymbol: currencyConfig.symbol,
    });
  } catch (error: any) {
    console.error('Create Paystack subscription error:', error);
    res.status(500).json({ error: 'Failed to create Paystack subscription' });
  }
});

router.post('/confirm-subscription', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const client = await getPaystackClient();
    if (!client) {
      return res.status(400).json({ error: 'Paystack is not configured' });
    }

    const { reference, planId, billingPeriod = 'monthly' } = req.body;
    const userId = req.userId!;

    if (!reference || !planId) {
      return res.status(400).json({ error: 'Reference and Plan ID required' });
    }

    const transaction = await verifyPaystackTransaction(reference);
    if (transaction.status !== 'success') {
      return res.status(400).json({ error: 'Payment not completed' });
    }

    const plan = await storage.getPlan(planId);
    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const subscriptionCode = transaction.authorization?.authorization_code;
    const emailToken = transaction.customer?.customer_code;

    const startDate = new Date();
    const endDate = new Date(startDate);
    if (billingPeriod === 'yearly') {
      endDate.setFullYear(endDate.getFullYear() + 1);
    } else {
      endDate.setMonth(endDate.getMonth() + 1);
    }

    const existingSubscription = await storage.getUserSubscription(userId);
    if (existingSubscription?.paystackSubscriptionCode && existingSubscription.paystackEmailToken) {
      try {
        await disablePaystackSubscription(existingSubscription.paystackSubscriptionCode, existingSubscription.paystackEmailToken);
      } catch (e) {
        console.warn('Failed to disable old Paystack subscription:', e);
      }
    }

    if (existingSubscription) {
      await storage.updateUserSubscription(existingSubscription.id, {
        planId: plan.id,
        status: 'active',
        currentPeriodStart: startDate,
        currentPeriodEnd: endDate,
        paystackSubscriptionCode: subscriptionCode,
        paystackEmailToken: emailToken,
        billingPeriod,
        cancelAtPeriodEnd: false,
      });
    } else {
      await storage.createUserSubscription({
        userId,
        planId: plan.id,
        status: 'active',
        currentPeriodStart: startDate,
        currentPeriodEnd: endDate,
        paystackSubscriptionCode: subscriptionCode,
        paystackEmailToken: emailToken,
        billingPeriod,
        cancelAtPeriodEnd: false,
      });
    }

    await syncUserWithSubscription(userId);

    await NotificationService.notifyMembershipUpgraded(userId, plan.displayName);

    // Log payment transaction for subscription
    const userSub = await storage.getUserSubscription(userId);
    const currencyConfig = await getPaystackCurrency();
    const price = billingPeriod === 'yearly'
      ? plan.paystackYearlyPrice || plan.yearlyPrice
      : plan.paystackMonthlyPrice || plan.monthlyPrice;
    try {
      const newTransaction = await storage.createPaymentTransaction({
        userId,
        type: 'subscription',
        gateway: 'paystack',
        gatewayTransactionId: reference,
        amount: price ? price.toString() : '0',
        currency: currencyConfig.currency.toUpperCase(),
        planId: plan.id,
        subscriptionId: userSub?.id,
        description: `${plan.displayName} Subscription`,
        billingPeriod,
        status: 'completed',
        completedAt: new Date(),
      });
      console.log(`✅ [Paystack] Logged subscription transaction for user ${userId}`);
      
      // Generate invoice and send purchase confirmation email
      try {
        await generateInvoiceForTransaction(newTransaction.id);
        await emailService.sendPurchaseConfirmation(newTransaction.id);
        console.log(`✅ [Paystack] Purchase confirmation email sent for transaction ${newTransaction.id}`);
      } catch (emailError: any) {
        console.error(`❌ [Paystack] Failed to send purchase confirmation email:`, emailError);
      }
    } catch (txError: any) {
      console.error('Failed to log payment transaction:', txError);
    }

    res.json({ success: true, planName: plan.displayName });
  } catch (error: any) {
    console.error('Confirm Paystack subscription error:', error);
    res.status(500).json({ error: 'Failed to confirm Paystack subscription' });
  }
});

router.post('/cancel-subscription', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const client = await getPaystackClient();
    if (!client) {
      return res.status(400).json({ error: 'Paystack is not configured' });
    }

    const userId = req.userId!;
    const { cancelImmediately = false } = req.body;

    const subscription = await storage.getUserSubscription(userId);
    if (!subscription?.paystackSubscriptionCode || !subscription?.paystackEmailToken) {
      return res.status(404).json({ error: 'No active Paystack subscription found' });
    }

    if (cancelImmediately) {
      await disablePaystackSubscription(subscription.paystackSubscriptionCode, subscription.paystackEmailToken);

      const freePlan = await storage.getPlanByName('free');
      if (freePlan) {
        await storage.updateUserSubscription(subscription.id, {
          planId: freePlan.id,
          status: 'cancelled',
          paystackSubscriptionCode: null,
          paystackEmailToken: null,
        });
        await syncUserWithSubscription(userId);
      }
    } else {
      await storage.updateUserSubscription(subscription.id, {
        cancelAtPeriodEnd: true,
      });
    }

    res.json({
      success: true,
      cancelAtPeriodEnd: !cancelImmediately,
      currentPeriodEnd: subscription.currentPeriodEnd,
    });
  } catch (error: any) {
    console.error('Cancel Paystack subscription error:', error);
    res.status(500).json({ error: 'Failed to cancel Paystack subscription' });
  }
});

router.post('/webhook', express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
  try {
    const signature = req.headers['x-paystack-signature'] as string;
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

    const isValid = await verifyPaystackWebhookSignature(rawBody, signature);
    if (!isValid) {
      console.warn('⚠️ [Paystack] Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    if (!event || !event.event) {
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }

    console.log(`📥 [Paystack] Webhook received: ${event.event}`);

    switch (event.event) {
      case 'subscription.create':
        console.log(`📥 [Paystack] ${event.event} event received`);
        break;

      case 'invoice.payment_failed':
        {
          console.log(`📥 [Paystack] ${event.event} event received`);
          
          // Try to send payment failed email
          try {
            const data = event.data;
            const subscriptionCode = data?.subscription?.subscription_code;
            if (subscriptionCode) {
              const allSubscriptions = await storage.getAllUserSubscriptions();
              const subscription = allSubscriptions.find(s => s.paystackSubscriptionCode === subscriptionCode);
              if (subscription) {
                const failedAmount = ((data?.amount || 0) / 100).toFixed(2);
                await emailService.sendPaymentFailed(subscription.userId, failedAmount, 'Invoice payment failed');
                console.log(`✅ [Paystack] Payment failed email sent to user ${subscription.userId}`);
              }
            }
          } catch (emailError: any) {
            console.error(`❌ [Paystack] Failed to send payment failed email:`, emailError);
          }
        }
        break;

      case 'charge.success':
        {
          const data = event.data;
          if (data?.metadata?.type === 'credits') {
            const { userId, packageId, credits } = data.metadata;
            const reference = data.reference;

            const pkg = await storage.getCreditPackage(packageId);
            if (pkg) {
              try {
                await storage.addCreditsAtomic(userId, credits, `Purchased ${pkg.name} via Paystack`, `paystack_${reference}`);
                import('../services/sip-credit-guard').then(({ reconnectAfterRecharge }) => reconnectAfterRecharge(userId)).catch(() => {});
                console.log(`✅ [Paystack] Added ${credits} credits to user ${userId}`);

                // Log payment transaction for credits
                const currencyConfig = await getPaystackCurrency();
                const amount = data.amount ? (data.amount / 100).toFixed(2) : '0';
                try {
                  const webhookCreditTransaction = await storage.createPaymentTransaction({
                    userId,
                    type: 'credits',
                    gateway: 'paystack',
                    gatewayTransactionId: reference,
                    amount,
                    currency: (data.currency || currencyConfig.currency).toUpperCase(),
                    creditPackageId: packageId,
                    description: `${pkg.name} - ${credits} Credits`,
                    creditsAwarded: credits,
                    status: 'completed',
                    completedAt: new Date(),
                  });
                  console.log(`✅ [Paystack Webhook] Logged credits transaction for user ${userId}`);
                  
                  // Generate invoice and send purchase confirmation email
                  try {
                    await generateInvoiceForTransaction(webhookCreditTransaction.id);
                    await emailService.sendPurchaseConfirmation(webhookCreditTransaction.id);
                    console.log(`✅ [Paystack] Credits purchase confirmation email sent for transaction ${webhookCreditTransaction.id}`);
                  } catch (emailError: any) {
                    console.error(`❌ [Paystack] Failed to send credits purchase confirmation email:`, emailError);
                  }
                } catch (txError: any) {
                  console.error('Failed to log payment transaction:', txError);
                }
              } catch (error: any) {
                if (!error.message?.includes('unique') && !error.message?.includes('duplicate')) {
                  console.error('Error adding credits from webhook:', error);
                }
              }
            }
          }
        }
        break;

      case 'subscription.disable':
        {
          const subscriptionCode = event.data?.subscription_code;
          if (subscriptionCode) {
            const allSubscriptions = await storage.getAllUserSubscriptions();
            const subscription = allSubscriptions.find(s => s.paystackSubscriptionCode === subscriptionCode);
            if (subscription) {
              const freePlan = await storage.getPlanByName('free');
              if (freePlan) {
                await storage.updateUserSubscription(subscription.id, {
                  planId: freePlan.id,
                  status: 'cancelled',
                  paystackSubscriptionCode: null,
                  paystackEmailToken: null,
                });
                await syncUserWithSubscription(subscription.userId);
              }
            }
          }
        }
        break;

      case 'refund.processed':
      case 'refund.pending':
        {
          // Handle external refund (not initiated via our admin API)
          const refundData = event.data;
          const reference = refundData?.transaction?.reference;
          
          console.log(`🔄 [Paystack] Refund ${event.event}: ${refundData?.id} for transaction ${reference}`);
          
          if (reference) {
            try {
              // Find the original transaction
              const transaction = await storage.getPaymentTransactionByGatewayId('paystack', reference);
              
              if (transaction) {
                // Check if we already have a refund for this transaction
                const existingRefunds = await storage.getTransactionRefunds(transaction.id);
                if (existingRefunds.length > 0) {
                  console.log(`ℹ️ [Paystack] Refund already exists for transaction ${reference}, skipping`);
                  break;
                }
                
                const userId = transaction.userId;
                
                // Reverse credits if it was a credit purchase using centralized applyRefund
                let creditsReversed = 0;
                if (transaction.type === 'credits' && transaction.creditsAwarded) {
                  const refundResult = await applyRefund({
                    userId,
                    creditsToReverse: transaction.creditsAwarded,
                    gateway: 'paystack',
                    gatewayRefundId: refundData?.id?.toString() || `paystack_refund_${reference}`,
                    transactionId: transaction.id,
                    reason: 'External refund via Paystack',
                  });
                  
                  if (refundResult.success && !refundResult.alreadyProcessed) {
                    creditsReversed = refundResult.creditsReversed;
                    console.log(`🔄 [Paystack] Reversed ${creditsReversed} credits for user ${userId}. Transaction logged.`);
                  }
                }
                
                // Create refund record
                const refundAmount = ((refundData?.amount || 0) / 100).toFixed(2);
                await storage.createRefund({
                  transactionId: transaction.id,
                  userId,
                  amount: refundAmount,
                  currency: refundData?.currency || transaction.currency,
                  gateway: 'paystack',
                  gatewayRefundId: refundData?.id?.toString() || `paystack_refund_${reference}`,
                  reason: 'gateway_refund',
                  initiatedBy: 'gateway',
                  status: event.event === 'refund.processed' ? 'completed' : 'pending',
                  creditsReversed: creditsReversed > 0 ? creditsReversed : undefined,
                  metadata: {
                    userSuspended: false,
                    refundReason: refundData?.customer_note || 'external_refund',
                  },
                });
                
                // Update transaction status
                await storage.updatePaymentTransaction(transaction.id, {
                  status: 'refunded',
                });
                
                console.log(`✅ [Paystack] External refund processed for user ${userId}. Reference: ${reference}`);
              }
            } catch (error: any) {
              console.error('Error processing external refund:', error);
            }
          }
        }
        break;

      case 'charge.dispute.create':
      case 'charge.dispute.remind':
        {
          // Handle chargeback/dispute - suspend user account
          const disputeData = event.data;
          const reference = disputeData?.transaction?.reference;
          
          console.log(`🚨 [Paystack] Dispute ${event.event}: ${disputeData?.id} for transaction ${reference}`);
          
          if (reference) {
            try {
              // Find the original transaction
              const transaction = await storage.getPaymentTransactionByGatewayId('paystack', reference);
              
              if (transaction) {
                const userId = transaction.userId;
                
                // Reverse credits if it was a credit purchase using centralized applyRefund
                let creditsReversed = 0;
                if (transaction.type === 'credits' && transaction.creditsAwarded) {
                  const refundResult = await applyRefund({
                    userId,
                    creditsToReverse: transaction.creditsAwarded,
                    gateway: 'paystack',
                    gatewayRefundId: disputeData?.id?.toString() || `paystack_dispute_${reference}`,
                    transactionId: transaction.id,
                    reason: 'Chargeback dispute',
                  });
                  
                  if (refundResult.success && !refundResult.alreadyProcessed) {
                    creditsReversed = refundResult.creditsReversed;
                    console.log(`🔄 [Paystack] Reversed ${creditsReversed} credits for user ${userId}. Transaction logged.`);
                  }
                }
                
                // Create refund record
                const disputeAmount = ((disputeData?.amount || 0) / 100).toFixed(2);
                await storage.createRefund({
                  transactionId: transaction.id,
                  userId,
                  amount: disputeAmount,
                  currency: disputeData?.currency || transaction.currency,
                  gateway: 'paystack',
                  gatewayRefundId: disputeData?.id?.toString() || `paystack_dispute_${reference}`,
                  reason: 'chargeback',
                  initiatedBy: 'gateway',
                  status: 'completed',
                  creditsReversed: creditsReversed > 0 ? creditsReversed : undefined,
                  metadata: {
                    userSuspended: true,
                    disputeReason: disputeData?.category || 'unknown',
                    disputeStatus: disputeData?.status,
                    dueAt: disputeData?.due_at,
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
                  await emailService.sendAccountSuspended(userId, `Chargeback dispute: ${disputeData?.category || 'Unknown reason'}`);
                  console.log(`✅ [Paystack] Account suspended email sent to user ${userId}`);
                } catch (emailError: any) {
                  console.error(`❌ [Paystack] Failed to send account suspended email:`, emailError);
                }
                
                console.log(`⛔ [Paystack] User ${userId} suspended due to chargeback. Dispute ID: ${disputeData?.id}, Reason: ${disputeData?.category}`);
              } else {
                console.warn(`⚠️ [Paystack] No transaction found for reference ${reference}`);
              }
            } catch (error: any) {
              console.error('Error processing chargeback:', error);
            }
          }
        }
        break;

      default:
        console.log(`📥 [Paystack] Unhandled webhook event: ${event.event}`);
    }

    res.status(200).json({ received: true });
  } catch (error: any) {
    console.error('Paystack webhook error:', error);
    
    const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    await queueFailedWebhook(
      'paystack',
      event?.event || 'unknown',
      event?.data?.reference || event?.data?.id || `paystack_${Date.now()}`,
      event?.data || event,
      error.message || 'Unknown error'
    );
    
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;
