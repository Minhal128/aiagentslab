'use strict';
/**
 * MercadoPago Routes
 * Express router with all MercadoPago payment endpoints
 */

import express, { Request, Response, Router } from 'express';
import { storage } from '../../../../storage';
import { authenticateToken, AuthRequest } from '../../../../middleware/auth';
import { hasActiveMembership, syncUserWithSubscription } from '../../../../services/membership-service';
import { queueFailedWebhook } from '../../../../services/webhook-retry-service';
import { NotificationService } from '../../../../services/notification-service';
import { recordWebhookReceived } from '../../webhook-helper';
import { generateInvoiceForTransaction } from '../../invoice-service';
import { PaymentAuditService } from '../../audit';
import { emailService } from '../../../../services/email-service';
import {
  getMercadoPagoConfig,
  getMercadoPagoClient,
  isMercadoPagoEnabled,
  getMercadoPagoCurrency,
  getSupportedCurrencies,
  createMercadoPagoPreference,
  fetchMercadoPagoPayment,
  createMercadoPagoSubscription,
  fetchMercadoPagoSubscription,
  cancelMercadoPagoSubscription,
  verifyMercadoPagoWebhookSignature,
} from './service';
import {
  handlePaymentApproved,
  handleSubscriptionAuthorized,
  handleSubscriptionCancelled,
  handlePaymentFailed,
  handleRefundProcessed,
  handleDisputeCreated,
  handleCreditsPayment,
} from './handlers';
import { FRONTEND_URL } from '../../webhook-helper';
import { logger } from '../../../../utils/logger';

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
    logger.error('Error fetching config', error, 'MercadoPago');
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
    const price = pkg.mercadopagoPrice ? parseFloat(pkg.mercadopagoPrice.toString()) : 0;
    
    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ 
        error: `Credit package does not have a price configured for MercadoPago (${currencyConfig.currency}). Please ask the admin to set the MercadoPago price.` 
      });
    }

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
        name: user.billingName?.split(' ')[0] || user.name?.split(' ')[0],
        surname: user.billingName?.split(' ').slice(1).join(' ') || user.name?.split(' ').slice(1).join(' ') || undefined,
      },
      backUrls: {
        success: `${FRONTEND_URL}/app/payment-result?status=success&gateway=mercadopago&type=credits`,
        failure: `${FRONTEND_URL}/app/payment-result?status=failure&gateway=mercadopago&type=credits`,
        pending: `${FRONTEND_URL}/app/payment-result?status=processing&gateway=mercadopago&type=credits`,
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
    logger.error('Create preference error', error, 'MercadoPago');
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
        
        const currencyConfig = await getMercadoPagoCurrency();
        const amount = payment.transaction_amount ? payment.transaction_amount.toString() : '0';
        
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

        await PaymentAuditService.logCreditsAwarded(
          'mercadopago',
          userId,
          creditTransaction.id,
          metadata.credits,
          { packageName: pkg.name, verifiedViaEndpoint: true }
        );

        try {
          await generateInvoiceForTransaction(creditTransaction.id);
          await emailService.sendPurchaseConfirmation(creditTransaction.id);
        } catch (emailError: any) {
          logger.error('Failed to send purchase confirmation', emailError, 'MercadoPago');
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
    logger.error('Verify payment error', error, 'MercadoPago');
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
      backUrl: `${FRONTEND_URL}/app/payment-result?status=success&gateway=mercadopago&type=subscription&plan_id=${planId}&billing_period=${billingPeriod}`,
    });

    res.json({
      subscriptionId: subscription.id,
      initPoint: subscription.init_point,
      planName: plan.displayName,
      billingPeriod,
    });
  } catch (error: any) {
    logger.error('Create subscription error', error, 'MercadoPago');
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
        logger.warn('Failed to cancel old subscription', e, 'MercadoPago');
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

      await PaymentAuditService.logSubscriptionCreated(
        'mercadopago',
        userId,
        subscriptionId,
        plan.id,
        billingPeriod,
        { amount: price, currency: currencyConfig.currency }
      );

      try {
        await generateInvoiceForTransaction(newTransaction.id);
        await emailService.sendPurchaseConfirmation(newTransaction.id);
      } catch (emailError: any) {
        logger.error('Failed to send purchase confirmation', emailError, 'MercadoPago');
      }
    } catch (txError: any) {
      logger.error('Failed to log payment transaction', txError, 'MercadoPago');
    }

    res.json({ success: true, planName: plan.displayName });
  } catch (error: any) {
    logger.error('Confirm subscription error', error, 'MercadoPago');
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

      await PaymentAuditService.logSubscriptionCancelled(
        'mercadopago',
        userId,
        subscription.mercadopagoSubscriptionId,
        true,
        { reason: 'immediate_cancellation' }
      );
    } else {
      await storage.updateUserSubscription(subscription.id, {
        cancelAtPeriodEnd: true,
      });

      await PaymentAuditService.logSubscriptionCancelled(
        'mercadopago',
        userId,
        subscription.mercadopagoSubscriptionId,
        false,
        { reason: 'cancel_at_period_end' }
      );
    }

    res.json({
      success: true,
      cancelAtPeriodEnd: !cancelImmediately,
      currentPeriodEnd: subscription.currentPeriodEnd,
    });
  } catch (error: any) {
    logger.error('Cancel subscription error', error, 'MercadoPago');
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
      logger.warn('Invalid webhook signature - rejecting', undefined, 'MercadoPago');
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    if (!event || !event.type) {
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }

    await recordWebhookReceived('mercadopago');
    logger.info(`Webhook received: ${event.type}`, undefined, 'MercadoPago');

    switch (event.type) {
      case 'payment':
        {
          const paymentId = event.data?.id;
          if (paymentId) {
            try {
              const payment = await fetchMercadoPagoPayment(paymentId);
              if (payment.status === 'approved' && payment.external_reference) {
                const result = await handlePaymentApproved(paymentId, payment.external_reference);
                logger.info(`Payment processed: ${paymentId}`, result, 'MercadoPago');
              } else if (payment.status === 'refunded') {
                const result = await handleRefundProcessed(paymentId, payment);
                logger.info(`Refund processed: ${paymentId}`, result, 'MercadoPago');
              }
            } catch (e) {
              logger.error('Failed to process payment webhook', e, 'MercadoPago');
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
              
              if (subscription.status === 'cancelled') {
                const result = await handleSubscriptionCancelled(preapprovalId);
                logger.info(`Subscription cancelled: ${preapprovalId}`, result, 'MercadoPago');
              } else if (subscription.status === 'authorized') {
                const result = await handleSubscriptionAuthorized(preapprovalId);
                logger.info(`Subscription authorized: ${preapprovalId}`, result, 'MercadoPago');
              } else if (subscription.status === 'paused') {
                const result = await handlePaymentFailed(preapprovalId);
                logger.warn(`Subscription payment failed: ${preapprovalId}`, result, 'MercadoPago');
              }
            } catch (e) {
              logger.error('Failed to process subscription webhook', e, 'MercadoPago');
            }
          }
        }
        break;

      case 'chargebacks':
      case 'claim':
        {
          const disputeId = event.data?.id;
          const paymentId = event.data?.payment_id;
          if (disputeId && paymentId) {
            const result = await handleDisputeCreated(
              disputeId,
              paymentId,
              event.data?.reason || 'unknown'
            );
            logger.warn(`Dispute created: ${disputeId}`, result, 'MercadoPago');
          }
        }
        break;

      default:
        logger.info(`Unhandled webhook event: ${event.type}`, undefined, 'MercadoPago');
    }

    res.status(200).json({ received: true });
  } catch (error: any) {
    logger.error('Webhook error', error, 'MercadoPago');
    
    const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    await queueFailedWebhook(
      'mercadopago',
      event?.type || 'unknown',
      event?.data?.id || `mercadopago_${Date.now()}`,
      event?.data || event,
      error.message || 'Unknown error'
    );
    
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export { router as mercadopagoRouter };
export default router;
