'use strict';
/**
 * Razorpay Routes
 * Express router for all Razorpay payment endpoints
 */

import express, { Request, Response, Router } from 'express';
import { authenticateToken, AuthRequest } from '../../../../middleware/auth';
import { hasActiveMembership } from '../../../../services/membership-service';
import { queueFailedWebhook } from '../../../../services/webhook-retry-service';
import { storage } from '../../../../storage';
import { recordWebhookReceived } from '../../webhook-helper';
import { PaymentAuditService } from '../../audit';
import { generateInvoiceForTransaction } from '../../invoice-service';
import { emailService } from '../../../../services/email-service';
import { NotificationService } from '../../../../services/notification-service';
import {
  getRazorpayClient,
  isRazorpayEnabled,
  isRazorpayConfigured,
  getRazorpayCurrency,
  getRazorpayConfig,
  getSupportedCurrencies,
  getRazorpayKeyId,
  createRazorpaySubscription,
  createRazorpayOrder,
  fetchRazorpaySubscription,
  cancelRazorpaySubscription,
  fetchRazorpayPayment,
  verifyPaymentSignature,
  verifyWebhookSignature,
  initiateRefund,
} from './service';
import {
  handleSubscriptionAuthenticated,
  handleSubscriptionActivated,
  handleSubscriptionCharged,
  handleSubscriptionPending,
  handleSubscriptionHalted,
  handleSubscriptionCancelled,
  handleSubscriptionCompleted,
  handlePaymentCaptured,
  handlePaymentFailed,
  handleRefundCreated,
  handleDispute,
} from './handlers';
import { FRONTEND_URL } from '../../webhook-helper';
import { logger } from '../../../../utils/logger';

const router: Router = express.Router();

router.get('/config', async (_req: Request, res: Response) => {
  try {
    const config = await getRazorpayConfig();
    const currencies = getSupportedCurrencies();
    res.json({
      ...config,
      supportedCurrencies: currencies,
    });
  } catch (error: any) {
    logger.error('Error fetching Razorpay config', error, 'Razorpay');
    res.status(500).json({ error: 'Failed to fetch Razorpay configuration' });
  }
});

router.post('/create-subscription', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
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

    const inrAmount = billingPeriod === 'yearly' 
      ? plan.razorpayYearlyPrice 
      : plan.razorpayMonthlyPrice;

    await PaymentAuditService.logPaymentInitiated('razorpay', userId, 'subscription', parseFloat(inrAmount?.toString() || '0'), 'INR', { planId, billingPeriod });
    
    res.json({
      subscriptionId: subscription.id,
      planName: plan.name,
      billingPeriod,
      amount: inrAmount ? parseFloat(inrAmount.toString()) : 0,
      currency: 'INR',
    });
  } catch (error: any) {
    logger.error('Create Razorpay subscription error', error, 'Razorpay');
    res.status(500).json({ error: 'Failed to create subscription' });
  }
});

router.post('/verify-subscription', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
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

    const userSub = await storage.getUserSubscription(userId);
    const inrAmount = billingPeriod === 'yearly' 
      ? plan.razorpayYearlyPrice 
      : plan.razorpayMonthlyPrice;

    try {
      const newTransaction = await storage.createPaymentTransaction({
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

      await PaymentAuditService.logSubscriptionCreated(
        'razorpay',
        userId,
        razorpay_subscription_id,
        notes.planId,
        billingPeriod,
        { amount: inrAmount, currency: 'INR' }
      );

      try {
        await generateInvoiceForTransaction(newTransaction.id);
        await emailService.sendPurchaseConfirmation(newTransaction.id);
      } catch (emailError: any) {
        logger.error('Failed to send purchase confirmation email', emailError, 'Razorpay');
      }
    } catch (txError: any) {
      if (!txError.message?.includes('unique') && !txError.message?.includes('duplicate')) {
        throw txError;
      }
    }

    res.json({
      success: true,
      message: 'Subscription activated successfully',
      plan: plan.name,
      expiresAt: currentPeriodEnd,
    });
  } catch (error: any) {
    logger.error('Verify Razorpay subscription error', error, 'Razorpay');
    res.status(500).json({ error: 'Failed to verify subscription' });
  }
});

router.post('/create-order', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
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

    const inrPrice = pkg.razorpayPrice ? parseFloat(pkg.razorpayPrice.toString()) : 0;
    if (inrPrice <= 0) {
      return res.status(400).json({ error: 'Credit package does not have an INR price configured for Razorpay' });
    }

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
        customer_name: user.billingName || user.name || '',
        customer_email: user.email || '',
        billing_address_line1: user.billingAddressLine1 || '',
        billing_address_line2: user.billingAddressLine2 || '',
        billing_city: user.billingCity || '',
        billing_state: user.billingState || '',
        billing_postal_code: user.billingPostalCode || '',
        billing_country: user.billingCountry || '',
      },
    });

    await PaymentAuditService.logPaymentInitiated('razorpay', userId, 'credits', inrPrice, 'INR', { packageId });

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      packageName: pkg.name,
      credits: pkg.credits,
    });
  } catch (error: any) {
    logger.error('Create Razorpay order error', error, 'Razorpay');
    res.status(500).json({ error: 'Failed to create order' });
  }
});

router.post('/verify-order', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
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

      const inrPrice = pkg.razorpayPrice ? parseFloat(pkg.razorpayPrice.toString()) : 0;
      const creditTransaction = await storage.createPaymentTransaction({
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

      await PaymentAuditService.logCreditsAwarded(
        'razorpay',
        userId,
        creditTransaction.id,
        pkg.credits,
        { packageName: pkg.name, amount: inrPrice }
      );

      try {
        await generateInvoiceForTransaction(creditTransaction.id);
        await emailService.sendPurchaseConfirmation(creditTransaction.id);
      } catch (emailError: any) {
        logger.error('Failed to send credits purchase confirmation email', emailError, 'Razorpay');
      }
    } catch (error: any) {
      if (!error.message?.includes('unique') && !error.message?.includes('duplicate')) {
        throw error;
      }
      logger.info(`Payment ${razorpay_payment_id} already processed, skipping credit addition`, undefined, 'Razorpay');
    }

    const user = await storage.getUser(userId);

    res.json({
      success: true,
      message: 'Credits added successfully',
      credits: pkg.credits,
      newBalance: user?.credits || 0,
    });
  } catch (error: any) {
    logger.error('Verify Razorpay order error', error, 'Razorpay');
    res.status(500).json({ error: 'Failed to verify order' });
  }
});

router.post('/verify-payment', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const razorpay = await getRazorpayClient();
    if (!razorpay) {
      return res.status(400).json({ error: 'Razorpay is not configured' });
    }
    
    const { paymentId, orderId, subscriptionId } = req.body;
    const userId = req.userId!;

    if (!paymentId) {
      return res.status(400).json({ error: 'Payment ID required' });
    }

    const payment = await fetchRazorpayPayment(paymentId);

    if (payment.status !== 'captured') {
      return res.json({ 
        success: false, 
        status: 'pending',
        message: 'Payment not yet completed' 
      });
    }

    const existingTx = await storage.getPaymentTransactionByGatewayId('razorpay', paymentId);

    if (existingTx) {
      return res.json({
        success: true,
        status: 'already_processed',
        transactionId: existingTx.id,
        type: existingTx.type,
        credits: existingTx.creditsAwarded,
      });
    }

    const notes = payment.notes || {};
    
    if (notes.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (notes.type === 'credits') {
      const result = await handlePaymentCaptured(payment);
      if (result.success) {
        return res.json({
          success: true,
          status: 'completed',
          action: result.action,
          transactionId: result.transactionId,
        });
      } else {
        return res.status(400).json({ 
          success: false, 
          error: result.error 
        });
      }
    }

    res.json({ 
      success: true, 
      status: 'completed',
      message: 'Payment verified' 
    });
  } catch (error: any) {
    logger.error('Verify payment error', error, 'Razorpay');
    res.status(500).json({ error: 'Failed to verify payment' });
  }
});

router.post('/cancel-subscription', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
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

    await PaymentAuditService.logSubscriptionCancelled(
      'razorpay',
      userId,
      subscription.razorpaySubscriptionId,
      true,
      { reason: 'user_requested' }
    );

    res.json({
      message: 'Subscription will be canceled at the end of the billing period',
      currentPeriodEnd: subscription.currentPeriodEnd,
    });
  } catch (error: any) {
    logger.error('Cancel Razorpay subscription error', error, 'Razorpay');
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

router.post('/refund', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { transactionId, reason } = req.body;
    const adminId = req.userId!;

    const user = await storage.getUser(adminId);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const result = await initiateRefund(transactionId, reason, adminId);
    
    if (result.success) {
      res.json({ success: true, refundId: result.refundId });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error: any) {
    logger.error('Refund error', error, 'Razorpay');
    res.status(500).json({ error: 'Failed to process refund' });
  }
});

router.post('/webhook', async (req, res) => {
  const rawReq = req as Request & { rawBody?: Buffer };
  const signature = req.headers['x-razorpay-signature'] as string;

  try {
    const rawBody = rawReq.rawBody || Buffer.from(JSON.stringify(req.body));
    const isValid = await verifyWebhookSignature(rawBody.toString(), signature || '');

    if (!isValid) {
      logger.error('Webhook signature verification failed', undefined, 'Razorpay');
      return res.status(400).send('Invalid signature');
    }

    await recordWebhookReceived('razorpay');

    const event = req.body;
    const eventType = event.event;
    const payload = event.payload;

    logger.info(`Webhook received: ${eventType}`, undefined, 'Razorpay');

    let result;

    try {
      switch (eventType) {
        case 'subscription.authenticated':
          result = await handleSubscriptionAuthenticated();
          break;

        case 'subscription.activated':
          result = await handleSubscriptionActivated(
            payload.subscription?.entity,
            payload.payment?.entity
          );
          break;

        case 'subscription.charged':
          result = await handleSubscriptionCharged(
            payload.subscription?.entity,
            payload.payment?.entity
          );
          break;

        case 'subscription.pending':
          result = await handleSubscriptionPending(payload.subscription?.entity);
          break;

        case 'subscription.halted':
          result = await handleSubscriptionHalted(payload.subscription?.entity);
          break;

        case 'subscription.cancelled':
          result = await handleSubscriptionCancelled(payload.subscription?.entity);
          break;

        case 'subscription.completed':
          result = await handleSubscriptionCompleted(payload.subscription?.entity);
          break;

        case 'payment.captured':
          result = await handlePaymentCaptured(payload.payment?.entity);
          break;

        case 'payment.failed':
          result = await handlePaymentFailed(payload.payment?.entity);
          break;

        case 'refund.created':
          result = await handleRefundCreated(
            payload.refund?.entity,
            payload.payment?.entity
          );
          break;

        case 'payment.dispute.created':
        case 'payment.dispute.won':
        case 'payment.dispute.lost':
          result = await handleDispute(
            payload.dispute?.entity,
            payload.payment?.entity
          );
          break;

        default:
          logger.info(`Unhandled event type: ${eventType}`, undefined, 'Razorpay');
          result = { success: true, action: 'unhandled' };
      }

      await PaymentAuditService.logWebhookReceived('razorpay', eventType, result?.success || false, { eventId: event.id });

      res.json({ received: true });
    } catch (error: any) {
      logger.error('Webhook processing error', error, 'Razorpay');
      
      await queueFailedWebhook(
        'razorpay',
        eventType,
        event.id || `razorpay_${Date.now()}`,
        payload,
        error.message || 'Unknown error'
      );
      
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  } catch (error: any) {
    logger.error('Webhook error', error, 'Razorpay');
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export const razorpayRouter = router;
export default router;
