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
  getMercadoPagoClient,
  isMercadoPagoEnabled,
  getMercadoPagoCurrency,
  getMercadoPagoConfig,
  getSupportedCurrencies,
  createMercadoPagoPreference,
  fetchMercadoPagoPayment,
  createMercadoPagoSubscription,
  cancelMercadoPagoSubscription,
  fetchMercadoPagoSubscription,
  verifyMercadoPagoWebhookSignature,
  resetMercadoPagoClient
} from '../services/mercadopago-service';
import { queueFailedWebhook } from '../services/webhook-retry-service';
import { emailService } from '../services/email-service';
import { generateInvoiceForTransaction } from '../services/invoice-service';
import { FRONTEND_URL } from '../engines/payment/webhook-helper';
import { applyRefund } from '../services/credit-service';

const router: Router = express.Router();

router.get('/config', async (_req: Request, res: Response) => {
  try {
    const config = await getMercadoPagoConfig();
    const currencies = getSupportedCurrencies();
    res.json({
      ...config,
      supportedCurrencies: currencies,
    });
  } catch (error: any) {
    console.error('Error fetching MercadoPago config:', error);
    res.status(500).json({ error: 'Failed to fetch MercadoPago configuration' });
  }
});

router.post('/create-preference', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const isEnabled = await isMercadoPagoEnabled();
    if (!isEnabled) {
      return res.status(400).json({ error: 'MercadoPago payments are not enabled' });
    }

    const client = await getMercadoPagoClient();
    if (!client) {
      return res.status(400).json({ error: 'MercadoPago is not configured' });
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

    const currencyConfig = await getMercadoPagoCurrency();
    const price = pkg.mercadopagoPrice ? parseFloat(pkg.mercadopagoPrice.toString()) : parseFloat(pkg.price.toString());

    const preference = await createMercadoPagoPreference({
      items: [{
        title: `${pkg.name} - ${pkg.credits} Credits`,
        quantity: 1,
        unitPrice: price,
        currencyId: currencyConfig.currency,
        description: pkg.description || undefined,
        id: packageId,
      }],
      payer: {
        email: user.email,
        name: user.name?.split(' ')[0],
        surname: user.name?.split(' ').slice(1).join(' ') || undefined,
      },
      backUrls: {
        success: `${FRONTEND_URL}/app/billing?mercadopago=success`,
        failure: `${FRONTEND_URL}/app/billing?mercadopago=failed`,
        pending: `${FRONTEND_URL}/app/billing?mercadopago=pending`,
      },
      autoReturn: 'approved',
      externalReference: JSON.stringify({ userId, packageId, credits: pkg.credits, type: 'credits' }),
      notificationUrl: `${FRONTEND_URL}/api/mercadopago/webhook`,
    });

    res.json({
      preferenceId: preference.id,
      initPoint: preference.init_point,
      sandboxInitPoint: preference.sandbox_init_point,
      packageName: pkg.name,
      credits: pkg.credits,
      amount: price,
      currency: currencyConfig.currency,
      currencySymbol: currencyConfig.symbol,
    });
  } catch (error: any) {
    console.error('Create MercadoPago preference error:', error);
    res.status(500).json({ error: 'Failed to create MercadoPago preference' });
  }
});

router.post('/verify-payment', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const client = await getMercadoPagoClient();
    if (!client) {
      return res.status(400).json({ error: 'MercadoPago is not configured' });
    }

    const { paymentId, externalReference } = req.body;
    const userId = req.userId!;

    if (!paymentId) {
      return res.status(400).json({ error: 'Payment ID required' });
    }

    const payment = await fetchMercadoPagoPayment(paymentId);

    if (payment.status !== 'approved') {
      return res.status(400).json({ error: 'Payment not approved', status: payment.status });
    }

    let metadata;
    try {
      metadata = JSON.parse(externalReference || payment.external_reference);
    } catch {
      return res.status(400).json({ error: 'Invalid payment metadata' });
    }

    if (metadata.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (metadata.type === 'credits') {
      const pkg = await storage.getCreditPackage(metadata.packageId);
      if (!pkg) {
        return res.status(404).json({ error: 'Package not found' });
      }

      try {
        await storage.addCreditsAtomic(userId, metadata.credits, `Purchased ${pkg.name} via MercadoPago`, `mercadopago_${paymentId}`);
        import('../services/sip-credit-guard').then(({ reconnectAfterRecharge }) => reconnectAfterRecharge(userId)).catch(() => {});
        
        // Log payment transaction for credits
        const currencyConfig = await getMercadoPagoCurrency();
        const amount = payment.transaction_amount ? payment.transaction_amount.toString() : '0';
        try {
          const creditTransaction = await storage.createPaymentTransaction({
            userId,
            type: 'credits',
            gateway: 'mercadopago',
            gatewayTransactionId: paymentId,
            amount,
            currency: (payment.currency_id || currencyConfig.currency).toUpperCase(),
            creditPackageId: metadata.packageId,
            description: `${pkg.name} - ${metadata.credits} Credits`,
            creditsAwarded: metadata.credits,
            status: 'completed',
            completedAt: new Date(),
          });
          console.log(`✅ [MercadoPago] Logged credits transaction for user ${userId}`);
          
          // Generate invoice and send purchase confirmation email
          try {
            await generateInvoiceForTransaction(creditTransaction.id);
            await emailService.sendPurchaseConfirmation(creditTransaction.id);
            console.log(`✅ [MercadoPago] Credits purchase confirmation email sent for transaction ${creditTransaction.id}`);
          } catch (emailError: any) {
            console.error(`❌ [MercadoPago] Failed to send credits purchase confirmation email:`, emailError);
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
    console.error('Verify MercadoPago payment error:', error);
    res.status(500).json({ error: 'Failed to verify MercadoPago payment' });
  }
});

router.post('/create-subscription', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const isEnabled = await isMercadoPagoEnabled();
    if (!isEnabled) {
      return res.status(400).json({ error: 'MercadoPago payments are not enabled' });
    }

    const client = await getMercadoPagoClient();
    if (!client) {
      return res.status(400).json({ error: 'MercadoPago is not configured' });
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

    const mercadopagoPlanId = billingPeriod === 'yearly' ? plan.mercadopagoYearlyPlanId : plan.mercadopagoMonthlyPlanId;
    if (!mercadopagoPlanId) {
      return res.status(400).json({ error: 'MercadoPago plan not configured for this billing period' });
    }

    const subscription = await createMercadoPagoSubscription({
      preApprovalPlanId: mercadopagoPlanId,
      payerEmail: user.email,
      externalReference: JSON.stringify({ userId, planId, billingPeriod, type: 'subscription' }),
      reason: `${plan.displayName} - ${billingPeriod}`,
      backUrl: `${FRONTEND_URL}/app/billing?mercadopago_subscription=success&plan_id=${planId}&billing_period=${billingPeriod}`,
    });

    res.json({
      subscriptionId: subscription.id,
      initPoint: subscription.init_point,
      planName: plan.displayName,
      billingPeriod,
    });
  } catch (error: any) {
    console.error('Create MercadoPago subscription error:', error);
    res.status(500).json({ error: 'Failed to create MercadoPago subscription' });
  }
});

router.post('/confirm-subscription', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const client = await getMercadoPagoClient();
    if (!client) {
      return res.status(400).json({ error: 'MercadoPago is not configured' });
    }

    const { subscriptionId, planId, billingPeriod = 'monthly' } = req.body;
    const userId = req.userId!;

    if (!subscriptionId || !planId) {
      return res.status(400).json({ error: 'Subscription ID and Plan ID required' });
    }

    const subscription = await fetchMercadoPagoSubscription(subscriptionId);
    if (subscription.status !== 'authorized' && subscription.status !== 'pending') {
      return res.status(400).json({ error: 'Subscription not active' });
    }

    const plan = await storage.getPlan(planId);
    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const startDate = new Date();
    const endDate = new Date(startDate);
    if (billingPeriod === 'yearly') {
      endDate.setFullYear(endDate.getFullYear() + 1);
    } else {
      endDate.setMonth(endDate.getMonth() + 1);
    }

    const existingSubscription = await storage.getUserSubscription(userId);
    if (existingSubscription?.mercadopagoSubscriptionId && existingSubscription.mercadopagoSubscriptionId !== subscriptionId) {
      try {
        await cancelMercadoPagoSubscription(existingSubscription.mercadopagoSubscriptionId);
      } catch (e) {
        console.warn('Failed to cancel old MercadoPago subscription:', e);
      }
    }

    if (existingSubscription) {
      await storage.updateUserSubscription(existingSubscription.id, {
        planId: plan.id,
        status: 'active',
        currentPeriodStart: startDate,
        currentPeriodEnd: endDate,
        mercadopagoSubscriptionId: subscriptionId,
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
        mercadopagoSubscriptionId: subscriptionId,
        billingPeriod,
        cancelAtPeriodEnd: false,
      });
    }

    await syncUserWithSubscription(userId);

    await NotificationService.notifyMembershipUpgraded(userId, plan.displayName);

    // Log payment transaction for subscription
    const userSub = await storage.getUserSubscription(userId);
    const currencyConfig = await getMercadoPagoCurrency();
    const price = billingPeriod === 'yearly'
      ? plan.mercadopagoYearlyPrice || plan.yearlyPrice
      : plan.mercadopagoMonthlyPrice || plan.monthlyPrice;
    try {
      const newTransaction = await storage.createPaymentTransaction({
        userId,
        type: 'subscription',
        gateway: 'mercadopago',
        gatewayTransactionId: subscriptionId,
        gatewaySubscriptionId: subscriptionId,
        amount: price ? price.toString() : '0',
        currency: currencyConfig.currency.toUpperCase(),
        planId: plan.id,
        subscriptionId: userSub?.id,
        description: `${plan.displayName} Subscription`,
        billingPeriod,
        status: 'completed',
        completedAt: new Date(),
      });
      console.log(`✅ [MercadoPago] Logged subscription transaction for user ${userId}`);
      
      // Generate invoice and send purchase confirmation email
      try {
        await generateInvoiceForTransaction(newTransaction.id);
        await emailService.sendPurchaseConfirmation(newTransaction.id);
        console.log(`✅ [MercadoPago] Purchase confirmation email sent for transaction ${newTransaction.id}`);
      } catch (emailError: any) {
        console.error(`❌ [MercadoPago] Failed to send purchase confirmation email:`, emailError);
      }
    } catch (txError: any) {
      console.error('Failed to log payment transaction:', txError);
    }

    res.json({ success: true, planName: plan.displayName });
  } catch (error: any) {
    console.error('Confirm MercadoPago subscription error:', error);
    res.status(500).json({ error: 'Failed to confirm MercadoPago subscription' });
  }
});

router.post('/cancel-subscription', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const client = await getMercadoPagoClient();
    if (!client) {
      return res.status(400).json({ error: 'MercadoPago is not configured' });
    }

    const userId = req.userId!;
    const { cancelImmediately = false } = req.body;

    const subscription = await storage.getUserSubscription(userId);
    if (!subscription?.mercadopagoSubscriptionId) {
      return res.status(404).json({ error: 'No active MercadoPago subscription found' });
    }

    if (cancelImmediately) {
      await cancelMercadoPagoSubscription(subscription.mercadopagoSubscriptionId);

      const freePlan = await storage.getPlanByName('free');
      if (freePlan) {
        await storage.updateUserSubscription(subscription.id, {
          planId: freePlan.id,
          status: 'cancelled',
          mercadopagoSubscriptionId: null,
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
    console.error('Cancel MercadoPago subscription error:', error);
    res.status(500).json({ error: 'Failed to cancel MercadoPago subscription' });
  }
});

router.post('/webhook', express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
  try {
    const xSignature = req.headers['x-signature'] as string;
    const xRequestId = req.headers['x-request-id'] as string;
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

    const isValid = await verifyMercadoPagoWebhookSignature(rawBody, xSignature, xRequestId);
    if (!isValid) {
      console.warn('⚠️ [MercadoPago] Invalid webhook signature - rejecting');
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    if (!event || !event.type) {
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }

    console.log(`📥 [MercadoPago] Webhook received: ${event.type}`);

    switch (event.type) {
      case 'payment':
        {
          const paymentId = event.data?.id;
          if (paymentId) {
            try {
              const payment = await fetchMercadoPagoPayment(paymentId);
              if (payment.status === 'approved' && payment.external_reference) {
                let metadata;
                try {
                  metadata = JSON.parse(payment.external_reference);
                } catch {
                  console.warn('[MercadoPago] Invalid external reference');
                  break;
                }

                if (metadata.type === 'credits') {
                  const pkg = await storage.getCreditPackage(metadata.packageId);
                  if (pkg) {
                    try {
                      await storage.addCreditsAtomic(metadata.userId, metadata.credits, `Purchased ${pkg.name} via MercadoPago`, `mercadopago_${paymentId}`);
                      import('../services/sip-credit-guard').then(({ reconnectAfterRecharge }) => reconnectAfterRecharge(metadata.userId)).catch(() => {});
                      console.log(`✅ [MercadoPago] Added ${metadata.credits} credits to user ${metadata.userId}`);

                      // Log payment transaction for credits
                      const currencyConfig = await getMercadoPagoCurrency();
                      const amount = payment.transaction_amount ? payment.transaction_amount.toString() : '0';
                      try {
                        const webhookCreditTransaction = await storage.createPaymentTransaction({
                          userId: metadata.userId,
                          type: 'credits',
                          gateway: 'mercadopago',
                          gatewayTransactionId: paymentId.toString(),
                          amount,
                          currency: (payment.currency_id || currencyConfig.currency).toUpperCase(),
                          creditPackageId: metadata.packageId,
                          description: `${pkg.name} - ${metadata.credits} Credits`,
                          creditsAwarded: metadata.credits,
                          status: 'completed',
                          completedAt: new Date(),
                        });
                        console.log(`✅ [MercadoPago Webhook] Logged credits transaction for user ${metadata.userId}`);
                        
                        // Generate invoice and send purchase confirmation email
                        try {
                          await generateInvoiceForTransaction(webhookCreditTransaction.id);
                          await emailService.sendPurchaseConfirmation(webhookCreditTransaction.id);
                          console.log(`✅ [MercadoPago] Credits purchase confirmation email sent for transaction ${webhookCreditTransaction.id}`);
                        } catch (emailError: any) {
                          console.error(`❌ [MercadoPago] Failed to send credits purchase confirmation email:`, emailError);
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
            } catch (e) {
              console.error('[MercadoPago] Failed to process payment webhook:', e);
            }
          }
        }
        break;

      case 'subscription_preapproval':
        {
          const preapprovalId = event.data?.id;
          if (preapprovalId) {
            try {
              const subscription = await fetchMercadoPagoSubscription(preapprovalId);
              const allSubscriptions = await storage.getAllUserSubscriptions();
              const existingSubscription = allSubscriptions.find(s => s.mercadopagoSubscriptionId === preapprovalId);

              if (existingSubscription) {
                if (subscription.status === 'cancelled') {
                  const freePlan = await storage.getPlanByName('free');
                  if (freePlan) {
                    await storage.updateUserSubscription(existingSubscription.id, {
                      planId: freePlan.id,
                      status: 'cancelled',
                      mercadopagoSubscriptionId: null,
                    });
                    await syncUserWithSubscription(existingSubscription.userId);
                  }
                } else if (subscription.status === 'authorized') {
                  const startDate = new Date();
                  const endDate = new Date(startDate);
                  if (existingSubscription.billingPeriod === 'yearly') {
                    endDate.setFullYear(endDate.getFullYear() + 1);
                  } else {
                    endDate.setMonth(endDate.getMonth() + 1);
                  }

                  await storage.updateUserSubscription(existingSubscription.id, {
                    status: 'active',
                    currentPeriodStart: startDate,
                    currentPeriodEnd: endDate,
                    cancelAtPeriodEnd: false,
                  });

                  await syncUserWithSubscription(existingSubscription.userId);

                  // Log payment transaction for subscription
                  const plan = existingSubscription.planId ? await storage.getPlan(existingSubscription.planId) : null;
                  if (plan) {
                    const currencyConfig = await getMercadoPagoCurrency();
                    const price = (existingSubscription.billingPeriod === 'yearly')
                      ? plan.mercadopagoYearlyPrice || plan.yearlyPrice
                      : plan.mercadopagoMonthlyPrice || plan.monthlyPrice;
                    try {
                      const renewalTransaction = await storage.createPaymentTransaction({
                        userId: existingSubscription.userId,
                        type: 'subscription',
                        gateway: 'mercadopago',
                        gatewayTransactionId: preapprovalId,
                        gatewaySubscriptionId: preapprovalId,
                        amount: price ? price.toString() : '0',
                        currency: currencyConfig.currency.toUpperCase(),
                        planId: plan.id,
                        subscriptionId: existingSubscription.id,
                        description: `${plan.displayName} Subscription Renewal`,
                        billingPeriod: existingSubscription.billingPeriod || 'monthly',
                        status: 'completed',
                        completedAt: new Date(),
                      });
                      console.log(`✅ [MercadoPago Webhook] Logged subscription transaction for user ${existingSubscription.userId}`);
                      
                      // Generate invoice and send purchase confirmation email for renewal
                      try {
                        await generateInvoiceForTransaction(renewalTransaction.id);
                        await emailService.sendPurchaseConfirmation(renewalTransaction.id);
                        console.log(`✅ [MercadoPago] Renewal confirmation email sent for transaction ${renewalTransaction.id}`);
                      } catch (emailError: any) {
                        console.error(`❌ [MercadoPago] Failed to send renewal confirmation email:`, emailError);
                      }
                    } catch (txError: any) {
                      console.error('Failed to log payment transaction:', txError);
                    }
                  }
                }
              }
            } catch (e) {
              console.error('[MercadoPago] Failed to process subscription webhook:', e);
            }
          }
        }
        break;

      case 'payment.refunded':
        {
          // Handle external refund (not initiated via our admin API)
          const paymentId = event.data?.id;
          
          console.log(`🔄 [MercadoPago] Refund event for payment: ${paymentId}`);
          
          if (paymentId) {
            try {
              // Find the original transaction
              const transaction = await storage.getPaymentTransactionByGatewayId('mercadopago', paymentId.toString());
              
              if (transaction) {
                // Check if we already have a refund for this transaction
                const existingRefunds = await storage.getTransactionRefunds(transaction.id);
                if (existingRefunds.length > 0) {
                  console.log(`ℹ️ [MercadoPago] Refund already exists for payment ${paymentId}, skipping`);
                  break;
                }
                
                const userId = transaction.userId;
                
                // Reverse credits if it was a credit purchase using centralized refund service
                let creditsReversed = 0;
                if (transaction.type === 'credits' && transaction.creditsAwarded) {
                  const refundResult = await applyRefund({
                    userId,
                    creditsToReverse: transaction.creditsAwarded,
                    gateway: 'mercadopago',
                    gatewayRefundId: `mp_refund_${paymentId}`,
                    transactionId: transaction.id,
                    reason: 'External refund via MercadoPago',
                  });
                  
                  if (refundResult.success && !refundResult.alreadyProcessed) {
                    creditsReversed = refundResult.creditsReversed;
                    console.log(`🔄 [MercadoPago] Reversed ${creditsReversed} credits for user ${userId}. Transaction logged.`);
                  }
                }
                
                // Create refund record
                await storage.createRefund({
                  transactionId: transaction.id,
                  userId,
                  amount: transaction.amount,
                  currency: transaction.currency,
                  gateway: 'mercadopago',
                  gatewayRefundId: `mp_refund_${paymentId}`,
                  reason: 'gateway_refund',
                  initiatedBy: 'gateway',
                  status: 'completed',
                  creditsReversed: creditsReversed > 0 ? creditsReversed : undefined,
                  metadata: {
                    userSuspended: false,
                    refundReason: 'external_refund',
                  },
                });
                
                // Update transaction status
                await storage.updatePaymentTransaction(transaction.id, {
                  status: 'refunded',
                });
                
                console.log(`✅ [MercadoPago] External refund processed for user ${userId}. Payment: ${paymentId}`);
              }
            } catch (error: any) {
              console.error('Error processing external refund:', error);
            }
          }
        }
        break;

      case 'chargebacks':
      case 'payment.dispute.created':
        {
          // Handle chargeback/dispute - suspend user account
          const chargebackData = event.data;
          const paymentId = chargebackData?.id || chargebackData?.payment_id;
          
          console.log(`🚨 [MercadoPago] Chargeback/Dispute created for payment: ${paymentId}`);
          
          if (paymentId) {
            try {
              // Find the original transaction
              const transaction = await storage.getPaymentTransactionByGatewayId('mercadopago', paymentId.toString());
              
              if (transaction) {
                const userId = transaction.userId;
                
                // Reverse credits if it was a credit purchase using centralized refund service
                let creditsReversed = 0;
                if (transaction.type === 'credits' && transaction.creditsAwarded) {
                  const refundResult = await applyRefund({
                    userId,
                    creditsToReverse: transaction.creditsAwarded,
                    gateway: 'mercadopago',
                    gatewayRefundId: `mp_chargeback_${paymentId}`,
                    transactionId: transaction.id,
                    reason: 'Chargeback dispute',
                  });
                  
                  if (refundResult.success && !refundResult.alreadyProcessed) {
                    creditsReversed = refundResult.creditsReversed;
                    console.log(`🔄 [MercadoPago] Reversed ${creditsReversed} credits for user ${userId}. Transaction logged.`);
                  }
                }
                
                // Create refund record
                await storage.createRefund({
                  transactionId: transaction.id,
                  userId,
                  amount: transaction.amount,
                  currency: transaction.currency,
                  gateway: 'mercadopago',
                  gatewayRefundId: `mp_chargeback_${paymentId}`,
                  reason: 'chargeback',
                  initiatedBy: 'gateway',
                  status: 'completed',
                  creditsReversed: creditsReversed > 0 ? creditsReversed : undefined,
                  metadata: {
                    userSuspended: true,
                    disputeReason: chargebackData?.reason || 'unknown',
                    status: chargebackData?.status,
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
                  await emailService.sendAccountSuspended(userId, `Chargeback dispute: ${chargebackData?.reason || 'Unknown reason'}`);
                  console.log(`✅ [MercadoPago] Account suspended email sent to user ${userId}`);
                } catch (emailError: any) {
                  console.error(`❌ [MercadoPago] Failed to send account suspended email:`, emailError);
                }
                
                console.log(`⛔ [MercadoPago] User ${userId} suspended due to chargeback. Payment ID: ${paymentId}, Reason: ${chargebackData?.reason}`);
              } else {
                console.warn(`⚠️ [MercadoPago] No transaction found for payment ${paymentId}`);
              }
            } catch (error: any) {
              console.error('Error processing chargeback:', error);
            }
          }
        }
        break;

      default:
        console.log(`📥 [MercadoPago] Unhandled webhook event: ${event.type}`);
    }

    res.status(200).json({ received: true });
  } catch (error: any) {
    console.error('MercadoPago webhook error:', error);
    
    const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    await queueFailedWebhook(
      'mercadopago',
      event?.type || 'unknown',
      event?.data?.id || event?.id || `mercadopago_${Date.now()}`,
      event?.data || event,
      error.message || 'Unknown error'
    );
    
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;
