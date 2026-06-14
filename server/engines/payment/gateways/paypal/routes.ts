'use strict';
/**
 * PayPal Routes
 * Express router with all PayPal payment endpoints
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
  getPayPalConfig,
  getPayPalClient,
  isPayPalEnabled,
  getPayPalCurrency,
  getSupportedCurrencies,
  createPayPalOrder,
  capturePayPalOrder,
  fetchPayPalOrder,
  createPayPalSubscription,
  fetchPayPalSubscription,
  cancelPayPalSubscription,
  verifyPayPalWebhookSignature,
} from './service';
import {
  handleSubscriptionActivated,
  handleSubscriptionRenewed,
  handleSubscriptionCancelled,
  handlePaymentFailed,
  handleCaptureCompleted,
  handleCaptureRefunded,
  handleDisputeCreated,
  handleCreditsPayment,
} from './handlers';
import { FRONTEND_URL } from '../../webhook-helper';
import { logger } from '../../../../utils/logger';

const router: Router = express.Router();

const DEFAULT_APP_NAME = '';

async function getAppName(): Promise<string> {
  try {
    const setting = await storage.getGlobalSetting('app_name');
    if (setting?.value && typeof setting.value === 'string') {
      return setting.value;
    }
    return DEFAULT_APP_NAME;
  } catch (error) {
    logger.error('Failed to fetch app name', error, 'PayPal');
    return DEFAULT_APP_NAME;
  }
}

router.get('/config', async (_req: Request, res: Response) => {
  try {
    const config = await getPayPalConfig();
    const currencyConfig = await getPayPalCurrency();
    res.json({
      ...config,
      supportedCurrencies: [{ 
        code: currencyConfig.currency, 
        symbol: currencyConfig.symbol, 
        name: currencyConfig.currency 
      }],
    });
  } catch (error: any) {
    logger.error('Error fetching config', error, 'PayPal');
    res.status(500).json({ error: 'Failed to fetch PayPal configuration' });
  }
});

router.post('/create-order', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const isEnabled = await isPayPalEnabled();
    if (!isEnabled) {
      return res.status(400).json({ error: 'PayPal payments are not enabled' });
    }

    const client = await getPayPalClient();
    if (!client) {
      return res.status(400).json({ error: 'PayPal is not configured' });
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

    const currencyConfig = await getPayPalCurrency();
    const price = pkg.paypalPrice ? parseFloat(pkg.paypalPrice.toString()) : 0;
    
    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ 
        error: `Credit package does not have a price configured for PayPal (${currencyConfig.currency}). Please ask the admin to set the PayPal price.` 
      });
    }

    const order = await createPayPalOrder({
      amount: price,
      currency: currencyConfig.currency,
      description: `${pkg.name} - ${pkg.credits} Credits`,
      returnUrl: `${FRONTEND_URL}/app/payment-result?status=success&gateway=paypal&type=credits`,
      cancelUrl: `${FRONTEND_URL}/app/payment-result?status=cancelled&gateway=paypal&type=credits`,
      customId: JSON.stringify({ 
        userId, 
        packageId, 
        credits: pkg.credits, 
        type: 'credits',
        billing: user.billingName ? {
          name: user.billingName,
          address: user.billingAddressLine1,
          city: user.billingCity,
          country: user.billingCountry,
        } : undefined 
      }),
    });

    // Extract approval URL from PayPal order links
    const approvalUrl = order.links?.find((link: any) => link.rel === 'approve')?.href;
    
    if (!approvalUrl) {
      logger.error('No approval URL in PayPal order response', { orderId: order.id, links: order.links }, 'PayPal');
      return res.status(500).json({ error: 'PayPal order created but no approval URL returned' });
    }

    res.json({
      orderId: order.id,
      approvalUrl,
      packageName: pkg.name,
      credits: pkg.credits,
      amount: price,
      currency: currencyConfig.currency,
      currencySymbol: currencyConfig.symbol,
    });
  } catch (error: any) {
    logger.error('Create order error', error, 'PayPal');
    res.status(500).json({ error: 'Failed to create PayPal order' });
  }
});

router.post('/capture-order', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const client = await getPayPalClient();
    if (!client) {
      return res.status(400).json({ error: 'PayPal is not configured' });
    }

    const { orderId } = req.body;
    const userId = req.userId!;

    if (!orderId) {
      return res.status(400).json({ error: 'Order ID required' });
    }

    const capture = await capturePayPalOrder(orderId);

    if (capture.status !== 'COMPLETED') {
      return res.status(400).json({ error: 'Payment capture failed', status: capture.status });
    }

    const customId = capture.purchase_units?.[0]?.payments?.captures?.[0]?.custom_id;
    const captureId = capture.purchase_units?.[0]?.payments?.captures?.[0]?.id;
    
    let metadata;
    try {
      metadata = JSON.parse(customId);
    } catch {
      return res.status(400).json({ error: 'Invalid order metadata' });
    }

    if (metadata.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (metadata.type === 'credits') {
      const result = await handleCreditsPayment(orderId, captureId, metadata);
      
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.json({ success: true, credits: metadata.credits });
    } else {
      res.json({ success: true });
    }
  } catch (error: any) {
    logger.error('Capture order error', error, 'PayPal');
    res.status(500).json({ error: 'Failed to capture PayPal order' });
  }
});

router.post('/verify-order', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const client = await getPayPalClient();
    if (!client) {
      return res.status(400).json({ error: 'PayPal is not configured' });
    }

    const { orderId } = req.body;
    const userId = req.userId!;

    if (!orderId) {
      return res.status(400).json({ error: 'Order ID required' });
    }

    const order = await fetchPayPalOrder(orderId);

    if (order.status !== 'COMPLETED') {
      return res.status(400).json({ error: 'Order not completed', status: order.status });
    }

    const customId = order.purchase_units?.[0]?.payments?.captures?.[0]?.custom_id ||
                     order.purchase_units?.[0]?.custom_id;
    const captureId = order.purchase_units?.[0]?.payments?.captures?.[0]?.id;

    if (!customId) {
      return res.status(400).json({ error: 'Order metadata not found' });
    }

    let metadata;
    try {
      metadata = JSON.parse(customId);
    } catch {
      return res.status(400).json({ error: 'Invalid order metadata' });
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
        await storage.addCreditsAtomic(
          userId,
          metadata.credits,
          `Purchased ${pkg.name} via PayPal`,
          `paypal_${captureId || orderId}`
        );

        const currencyConfig = await getPayPalCurrency();
        const captureData = order.purchase_units?.[0]?.payments?.captures?.[0];
        const amount = captureData?.amount?.value || pkg.paypalPrice || pkg.price;

        const newTransaction = await storage.createPaymentTransaction({
          userId,
          type: 'credits',
          gateway: 'paypal',
          gatewayTransactionId: captureId || orderId,
          amount: amount.toString(),
          currency: (captureData?.amount?.currency_code || currencyConfig.currency).toUpperCase(),
          creditPackageId: metadata.packageId,
          description: `${pkg.name} - ${metadata.credits} Credits`,
          creditsAwarded: metadata.credits,
          status: 'completed',
          completedAt: new Date(),
        });

        await PaymentAuditService.logCreditsAwarded(
          'paypal',
          userId,
          newTransaction.id,
          metadata.credits,
          { packageName: pkg.name, verifiedViaEndpoint: true }
        );

        try {
          await generateInvoiceForTransaction(newTransaction.id);
          await emailService.sendPurchaseConfirmation(newTransaction.id);
        } catch (emailError: any) {
          logger.error('Failed to send purchase confirmation', emailError, 'PayPal');
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
    logger.error('Verify order error', error, 'PayPal');
    res.status(500).json({ error: 'Failed to verify PayPal order' });
  }
});

router.post('/create-subscription', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const isEnabled = await isPayPalEnabled();
    if (!isEnabled) {
      return res.status(400).json({ error: 'PayPal payments are not enabled' });
    }

    const client = await getPayPalClient();
    if (!client) {
      return res.status(400).json({ error: 'PayPal is not configured' });
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

    const paypalPlanId = billingPeriod === 'yearly' ? plan.paypalYearlyPlanId : plan.paypalMonthlyPlanId;
    if (!paypalPlanId) {
      return res.status(400).json({ error: 'PayPal plan not configured for this billing period' });
    }

    const appName = await getAppName();
    
    const subscription = await createPayPalSubscription({
      planId: paypalPlanId,
      subscriber: {
        name: { given_name: user.name?.split(' ')[0] || '', surname: user.name?.split(' ').slice(1).join(' ') || '' },
        email_address: user.email,
      },
      applicationContext: {
        brand_name: appName,
        return_url: `${FRONTEND_URL}/app/payment-result?status=success&gateway=paypal&type=subscription&plan_id=${planId}&billing_period=${billingPeriod}`,
        cancel_url: `${FRONTEND_URL}/app/payment-result?status=cancelled&gateway=paypal&type=subscription`,
        user_action: 'SUBSCRIBE_NOW',
      },
    });

    const approveLink = subscription.links?.find((link: any) => link.rel === 'approve');
    if (!approveLink) {
      return res.status(500).json({ error: 'No approval link received from PayPal' });
    }

    res.json({
      subscriptionId: subscription.id,
      approvalUrl: approveLink.href,
      planName: plan.displayName,
      billingPeriod,
    });
  } catch (error: any) {
    logger.error('Create subscription error', error, 'PayPal');
    res.status(500).json({ error: 'Failed to create PayPal subscription' });
  }
});

router.post('/confirm-subscription', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const client = await getPayPalClient();
    if (!client) {
      return res.status(400).json({ error: 'PayPal is not configured' });
    }

    const { subscriptionId, planId, billingPeriod = 'monthly' } = req.body;
    const userId = req.userId!;

    if (!subscriptionId || !planId) {
      return res.status(400).json({ error: 'Subscription ID and Plan ID required' });
    }

    const subscription = await fetchPayPalSubscription(subscriptionId);
    if (subscription.status !== 'ACTIVE' && subscription.status !== 'APPROVED') {
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
    if (existingSubscription?.paypalSubscriptionId && existingSubscription.paypalSubscriptionId !== subscriptionId) {
      try {
        await cancelPayPalSubscription(existingSubscription.paypalSubscriptionId);
      } catch (e) {
        logger.warn('Failed to cancel old subscription', e, 'PayPal');
      }
    }

    if (existingSubscription) {
      await storage.updateUserSubscription(existingSubscription.id, {
        planId: plan.id,
        status: 'active',
        currentPeriodStart: startDate,
        currentPeriodEnd: endDate,
        paypalSubscriptionId: subscriptionId,
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
        paypalSubscriptionId: subscriptionId,
        billingPeriod,
        cancelAtPeriodEnd: false,
      });
    }

    await syncUserWithSubscription(userId);
    await NotificationService.notifyMembershipUpgraded(userId, plan.displayName);

    const userSub = await storage.getUserSubscription(userId);
    const currencyConfig = await getPayPalCurrency();
    const price = billingPeriod === 'yearly'
      ? plan.paypalYearlyPrice || plan.yearlyPrice
      : plan.paypalMonthlyPrice || plan.monthlyPrice;

    try {
      const newTransaction = await storage.createPaymentTransaction({
        userId,
        type: 'subscription',
        gateway: 'paypal',
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
        'paypal',
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
        logger.error('Failed to send purchase confirmation', emailError, 'PayPal');
      }
    } catch (txError: any) {
      logger.error('Failed to log payment transaction', txError, 'PayPal');
    }

    res.json({ success: true, planName: plan.displayName });
  } catch (error: any) {
    logger.error('Confirm subscription error', error, 'PayPal');
    res.status(500).json({ error: 'Failed to confirm PayPal subscription' });
  }
});

router.post('/cancel-subscription', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const client = await getPayPalClient();
    if (!client) {
      return res.status(400).json({ error: 'PayPal is not configured' });
    }

    const userId = req.userId!;
    const { cancelImmediately = false } = req.body;

    const subscription = await storage.getUserSubscription(userId);
    if (!subscription?.paypalSubscriptionId) {
      return res.status(404).json({ error: 'No active PayPal subscription found' });
    }

    if (cancelImmediately) {
      await cancelPayPalSubscription(subscription.paypalSubscriptionId);

      const freePlan = await storage.getPlanByName('free');
      if (freePlan) {
        await storage.updateUserSubscription(subscription.id, {
          planId: freePlan.id,
          status: 'cancelled',
          paypalSubscriptionId: null,
        });
        await syncUserWithSubscription(userId);
      }

      await PaymentAuditService.logSubscriptionCancelled(
        'paypal',
        userId,
        subscription.paypalSubscriptionId,
        true,
        { reason: 'immediate_cancellation' }
      );
    } else {
      await storage.updateUserSubscription(subscription.id, {
        cancelAtPeriodEnd: true,
      });

      await PaymentAuditService.logSubscriptionCancelled(
        'paypal',
        userId,
        subscription.paypalSubscriptionId,
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
    logger.error('Cancel subscription error', error, 'PayPal');
    res.status(500).json({ error: 'Failed to cancel PayPal subscription' });
  }
});

router.post('/webhook', express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
  try {
    const rawBody = typeof req.body === 'string'
      ? req.body
      : Buffer.isBuffer(req.body)
        ? req.body.toString('utf8')
        : JSON.stringify(req.body);
    
    const isValid = await verifyPayPalWebhookSignature(rawBody, req.headers as Record<string, string | string[] | undefined>);
    if (!isValid) {
      logger.warn('Invalid webhook signature - rejecting', undefined, 'PayPal');
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    const webhookEvent = JSON.parse(rawBody);

    if (!webhookEvent || !webhookEvent.event_type) {
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }

    await recordWebhookReceived('paypal');
    logger.info(`Webhook received: ${webhookEvent.event_type}`, undefined, 'PayPal');

    switch (webhookEvent.event_type) {
      case 'BILLING.SUBSCRIPTION.ACTIVATED':
        {
          const subscriptionId = webhookEvent.resource?.id;
          if (subscriptionId) {
            const result = await handleSubscriptionActivated(subscriptionId, webhookEvent.resource);
            logger.info(`Subscription activated: ${subscriptionId}`, result, 'PayPal');
          }
        }
        break;

      case 'BILLING.SUBSCRIPTION.RENEWED':
      case 'PAYMENT.SALE.COMPLETED':
        {
          const subscriptionId = webhookEvent.resource?.billing_agreement_id || webhookEvent.resource?.id;
          if (subscriptionId) {
            const result = await handleSubscriptionRenewed(subscriptionId, webhookEvent.resource);
            logger.info(`Subscription renewed: ${subscriptionId}`, result, 'PayPal');
          }
        }
        break;

      case 'BILLING.SUBSCRIPTION.CANCELLED':
      case 'BILLING.SUBSCRIPTION.EXPIRED':
        {
          const subscriptionId = webhookEvent.resource?.id;
          if (subscriptionId) {
            const result = await handleSubscriptionCancelled(subscriptionId);
            logger.info(`Subscription cancelled: ${subscriptionId}`, result, 'PayPal');
          }
        }
        break;

      case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED':
        {
          const subscriptionId = webhookEvent.resource?.id;
          if (subscriptionId) {
            const result = await handlePaymentFailed(subscriptionId, webhookEvent.resource);
            logger.warn(`Subscription payment failed: ${subscriptionId}`, result, 'PayPal');
          }
        }
        break;

      case 'PAYMENT.CAPTURE.COMPLETED':
        {
          const captureId = webhookEvent.resource?.id;
          if (captureId) {
            await handleCaptureCompleted(captureId, webhookEvent.resource);
          }
        }
        break;

      case 'PAYMENT.CAPTURE.REFUNDED':
        {
          const captureId = webhookEvent.resource?.id;
          if (captureId) {
            const result = await handleCaptureRefunded(captureId, webhookEvent.resource, webhookEvent.id);
            logger.info(`Capture refunded: ${captureId}`, result, 'PayPal');
          }
        }
        break;

      case 'CUSTOMER.DISPUTE.CREATED':
        {
          const disputeId = webhookEvent.resource?.dispute_id;
          if (disputeId) {
            const result = await handleDisputeCreated(disputeId, webhookEvent.resource);
            logger.warn(`Dispute created: ${disputeId}`, result, 'PayPal');
          }
        }
        break;

      default:
        logger.info(`Unhandled webhook event: ${webhookEvent.event_type}`, undefined, 'PayPal');
    }

    res.status(200).json({ received: true });
  } catch (error: any) {
    logger.error('Webhook error', error, 'PayPal');
    
    try {
      const fallbackBody = typeof req.body === 'string'
        ? req.body
        : Buffer.isBuffer(req.body)
          ? req.body.toString('utf8')
          : JSON.stringify(req.body);
      const webhookEvent = JSON.parse(fallbackBody);
      await queueFailedWebhook(
        'paypal',
        webhookEvent?.event_type || 'unknown',
        webhookEvent?.id || `paypal_${Date.now()}`,
        webhookEvent?.resource || webhookEvent,
        error.message || 'Unknown error'
      );
    } catch (parseError) {
      await queueFailedWebhook(
        'paypal',
        'unknown',
        `paypal_${Date.now()}`,
        { rawBodyType: typeof req.body },
        error.message || 'Unknown error'
      );
    }
    
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export { router as paypalRouter };
export default router;
