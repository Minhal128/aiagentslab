'use strict';
/**
 * Stripe Routes
 * Express router for all Stripe payment endpoints
 */

import express, { Request, Response, Router } from 'express';
import Stripe from 'stripe';
import { authenticateToken, AuthRequest } from '../../../../middleware/auth';
import { hasActiveMembership } from '../../../../services/membership-service';
import { queueFailedWebhook } from '../../../../services/webhook-retry-service';
import { storage } from '../../../../storage';
import { recordWebhookReceived } from '../../webhook-helper';
import { PaymentAuditService } from '../../audit';
import { generateInvoiceForTransaction } from '../../invoice-service';
import { emailService } from '../../../../services/email-service';
import {
  getStripeClient,
  isStripeEnabled,
  getStripeCurrency,
  getStripeConfig,
  getSupportedCurrencies,
  setStripeCurrency,
  lockStripeCurrency,
  getOrCreateStripeCustomer,
  getStripeWebhookSecret,
  initiateRefund,
} from './service';
import {
  handleCheckoutSessionCompleted,
  handleInvoicePaymentSucceeded,
  handleInvoicePaymentFailed,
  handleSubscriptionDeleted,
  handleSubscriptionUpdated,
  handleChargeDispute,
  handleChargeRefunded,
} from './handlers';
import { FRONTEND_URL } from '../../webhook-helper';
import { logger } from '../../../../utils/logger';

const router: Router = express.Router();

/**
 * Safely parse a Unix timestamp (in seconds) to a Date object.
 * Returns current date if timestamp is invalid/missing.
 */
function safeUnixToDate(unixTimestamp: number | undefined | null, fallback?: Date): Date {
  if (unixTimestamp !== undefined && unixTimestamp !== null && typeof unixTimestamp === 'number' && !isNaN(unixTimestamp) && unixTimestamp >= 0) {
    const date = new Date(unixTimestamp * 1000);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }
  return fallback || new Date();
}

router.get('/config', async (_req: Request, res: Response) => {
  try {
    const config = await getStripeConfig();
    const currencies = getSupportedCurrencies();
    res.json({
      ...config,
      supportedCurrencies: currencies,
    });
  } catch (error: any) {
    logger.error('Error fetching Stripe config', error, 'Stripe');
    res.status(500).json({ error: 'Failed to fetch Stripe configuration' });
  }
});

router.post('/create-payment-intent', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const isEnabled = await isStripeEnabled();
    if (!isEnabled) {
      return res.status(400).json({ error: 'Stripe payments are not enabled' });
    }
    
    const stripe = await getStripeClient();
    if (!stripe) {
      return res.status(400).json({ error: 'Stripe is not configured' });
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

    const currencyConfig = await getStripeCurrency();
    const price = parseFloat(pkg.price?.toString() || '0');
    
    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ 
        error: `Credit package does not have a valid price configured. Please ask the admin to set a price for this package.` 
      });
    }
    
    const stripeCustomerId = await getOrCreateStripeCustomer(stripe, userId, user);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(price * 100),
      currency: currencyConfig.currency.toLowerCase(),
      customer: stripeCustomerId,
      description: `${pkg.name} - ${pkg.credits} Credits`,
      metadata: {
        userId,
        packageId,
        credits: pkg.credits.toString(),
        type: 'credits',
      },
      automatic_payment_methods: {
        enabled: true,
      },
      shipping: user.billingName ? {
        name: user.billingName,
        address: {
          line1: user.billingAddressLine1 || '',
          line2: user.billingAddressLine2 || undefined,
          city: user.billingCity || '',
          state: user.billingState || undefined,
          postal_code: user.billingPostalCode || '',
          country: user.billingCountry || '',
        }
      } : undefined,
    });

    await PaymentAuditService.logPaymentInitiated('stripe', userId, 'credits', price, currencyConfig.currency, { packageId });

    res.json({ 
      clientSecret: paymentIntent.client_secret,
      packageName: pkg.name,
      credits: pkg.credits,
      amount: pkg.price,
      currency: currencyConfig.currency,
      currencySymbol: currencyConfig.symbol,
    });
  } catch (error: any) {
    logger.error('Create payment intent error', error, 'Stripe');
    res.status(500).json({ error: 'Failed to create payment intent' });
  }
});

router.post('/confirm-payment', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const stripe = await getStripeClient();
    if (!stripe) {
      return res.status(400).json({ error: 'Stripe is not configured' });
    }
    
    const { paymentIntentId } = req.body;
    const userId = req.userId!;

    if (!paymentIntentId) {
      return res.status(400).json({ error: 'Payment intent ID required' });
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({ error: 'Payment not completed' });
    }

    if (paymentIntent.metadata.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const credits = parseInt(paymentIntent.metadata.credits || '0', 10);
    const packageId = paymentIntent.metadata.packageId;

    if (!credits || !packageId) {
      return res.status(400).json({ error: 'Invalid payment metadata' });
    }

    const pkg = await storage.getCreditPackage(packageId);
    if (!pkg) {
      return res.status(404).json({ error: 'Package not found' });
    }

    // Check if payment was already processed (prevent duplicates)
    const existingTx = await storage.getPaymentTransactionByGatewayId('stripe', paymentIntent.id);
    if (existingTx) {
      return res.json({
        success: true,
        status: 'already_processed',
        transactionId: existingTx.id,
        type: existingTx.type,
        credits: existingTx.creditsAwarded,
      });
    }

    try {
      await storage.addCreditsAtomic(userId, credits, `Purchased ${pkg.name}`, paymentIntent.id);

      // Get currency config for transaction record
      const currencyConfig = await getStripeCurrency();
      const amount = (paymentIntent.amount / 100).toFixed(2);

      // Create payment transaction record
      const creditTransaction = await storage.createPaymentTransaction({
        userId,
        type: 'credits',
        gateway: 'stripe',
        gatewayTransactionId: paymentIntent.id,
        amount,
        currency: currencyConfig.currency.toUpperCase(),
        creditPackageId: packageId,
        description: `${pkg.name} - ${credits} Credits`,
        creditsAwarded: credits,
        status: 'completed',
        completedAt: new Date(),
      });

      await PaymentAuditService.logCreditsAwarded(
        'stripe',
        userId,
        creditTransaction.id,
        credits,
        { packageName: pkg.name, amount: parseFloat(amount) }
      );

      // Generate invoice and send email
      try {
        await generateInvoiceForTransaction(creditTransaction.id);
        await emailService.sendPurchaseConfirmation(creditTransaction.id);
      } catch (emailError: any) {
        logger.error('Failed to send credits purchase confirmation email', emailError, 'Stripe');
      }

      res.json({ success: true, credits });
    } catch (error: any) {
      if (error.message?.includes('unique') || error.message?.includes('duplicate')) {
        res.json({ success: true, alreadyProcessed: true });
      } else {
        throw error;
      }
    }
  } catch (error: any) {
    logger.error('Confirm payment error', error, 'Stripe');
    res.status(500).json({ error: 'Failed to confirm payment' });
  }
});

router.post('/create-checkout-session', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const isEnabled = await isStripeEnabled();
    if (!isEnabled) {
      return res.status(400).json({ error: 'Stripe payments are not enabled' });
    }
    
    const stripe = await getStripeClient();
    if (!stripe) {
      return res.status(400).json({ error: 'Stripe is not configured' });
    }
    
    const { type, planId, packageId, billingPeriod } = req.body;
    const userId = req.userId!;

    if (!type || !['subscription', 'credits'].includes(type)) {
      return res.status(400).json({ error: 'Invalid checkout type' });
    }

    const currencyConfig = await getStripeCurrency();
    let user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (type === 'credits') {
      const hasMembership = await hasActiveMembership(userId);
      if (!hasMembership) {
        return res.status(403).json({ 
          error: 'Active Pro membership required to purchase credits. Please subscribe to a plan first.' 
        });
      }
    }

    const stripeCustomerId = await getOrCreateStripeCustomer(stripe, userId, user);

    let sessionParams: Stripe.Checkout.SessionCreateParams = {
      customer: stripeCustomerId,
      mode: type === 'subscription' ? 'subscription' : 'payment',
      success_url: `${FRONTEND_URL}/app/payment-result?status=success&gateway=stripe&type=${type}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/app/payment-result?status=cancelled&gateway=stripe&type=${type}`,
      metadata: {
        userId,
        type,
      },
    };

    if (type === 'subscription') {
      if (!planId || !billingPeriod) {
        return res.status(400).json({ error: 'Plan ID and billing period required for subscriptions' });
      }

      const plan = await storage.getPlan(planId);
      if (!plan) {
        return res.status(404).json({ error: 'Plan not found' });
      }

      const priceId = billingPeriod === 'yearly' 
        ? plan.stripeYearlyPriceId 
        : plan.stripeMonthlyPriceId;

      if (!priceId) {
        return res.status(400).json({ error: 'Stripe price not configured for this plan' });
      }

      sessionParams.line_items = [{
        price: priceId,
        quantity: 1,
      }];
      sessionParams.metadata!.planId = planId;
      sessionParams.metadata!.billingPeriod = billingPeriod;
      sessionParams.subscription_data = {
        metadata: {
          userId,
          planId,
        },
      };
    } else {
      if (!packageId) {
        return res.status(400).json({ error: 'Package ID required for credit purchase' });
      }

      const pkg = await storage.getCreditPackage(packageId);
      if (!pkg) {
        return res.status(404).json({ error: 'Credit package not found' });
      }

      sessionParams.line_items = [{
        price_data: {
          currency: currencyConfig.currency.toLowerCase(),
          product_data: {
            name: pkg.name,
            description: pkg.description || `${pkg.credits} credits`,
          },
          unit_amount: Math.round(parseFloat(pkg.price.toString()) * 100),
        },
        quantity: 1,
      }];
      sessionParams.metadata!.packageId = packageId;
      sessionParams.metadata!.credits = pkg.credits.toString();
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    
    await PaymentAuditService.logPaymentInitiated('stripe', userId, type, 0, currencyConfig.currency, { sessionId: session.id });

    res.json({ url: session.url });
  } catch (error: any) {
    logger.error('Stripe checkout session error', error, 'Stripe');
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

router.post('/verify-session', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const stripe = await getStripeClient();
    if (!stripe) {
      return res.status(400).json({ error: 'Stripe is not configured' });
    }
    
    const { sessionId } = req.body;
    const userId = req.userId!;

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID required' });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.metadata?.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (session.payment_status !== 'paid') {
      return res.json({ 
        success: false, 
        status: 'pending',
        message: 'Payment not yet completed' 
      });
    }

    const existingTx = await storage.getPaymentTransactionByGatewayId(
      'stripe',
      session.payment_intent as string || session.id
    );

    if (existingTx) {
      return res.json({
        success: true,
        status: 'already_processed',
        transactionId: existingTx.id,
        type: existingTx.type,
        credits: existingTx.creditsAwarded,
      });
    }

    const result = await handleCheckoutSessionCompleted(session);

    if (result.success) {
      res.json({
        success: true,
        status: 'completed',
        action: result.action,
        transactionId: result.transactionId,
      });
    } else {
      res.status(400).json({ 
        success: false, 
        error: result.error 
      });
    }
  } catch (error: any) {
    logger.error('Verify session error', error, 'Stripe');
    res.status(500).json({ error: 'Failed to verify session' });
  }
});

router.post('/change-plan', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const stripe = await getStripeClient();
    if (!stripe) {
      return res.status(400).json({ error: 'Stripe is not configured' });
    }
    
    const userId = req.userId!;
    const { newPlanId, billingPeriod } = req.body;

    if (!newPlanId) {
      return res.status(400).json({ error: 'New plan ID is required' });
    }

    const userSub = await storage.getUserSubscription(userId);
    if (!userSub || !userSub.stripeSubscriptionId) {
      return res.status(404).json({ error: 'No active subscription found' });
    }

    const newPlan = await storage.getPlan(newPlanId);
    if (!newPlan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const period = billingPeriod || userSub.billingPeriod || 'monthly';
    const newPriceId = period === 'yearly' 
      ? newPlan.stripeYearlyPriceId 
      : newPlan.stripeMonthlyPriceId;

    if (!newPriceId) {
      return res.status(400).json({ error: 'Stripe price not configured for this plan' });
    }

    const stripeSubscription = await stripe.subscriptions.retrieve(userSub.stripeSubscriptionId);
    const currentItemId = stripeSubscription.items.data[0]?.id;
    
    if (!currentItemId) {
      return res.status(500).json({ error: 'Could not find subscription item' });
    }

    const updatedSubscription = await stripe.subscriptions.update(userSub.stripeSubscriptionId, {
      items: [{
        id: currentItemId,
        price: newPriceId,
      }],
      proration_behavior: 'none',
      metadata: {
        userId,
        planId: newPlanId,
      },
    });

    await storage.updateUserSubscription(userSub.id, {
      planId: newPlanId,
      billingPeriod: period,
    });

    await storage.updateUser(userId, {
      planType: newPlan.name,
    });

    logger.info(`User ${userId} changed plan to ${newPlan.name} (${period})`, undefined, 'Stripe');

    res.json({ 
      success: true,
      message: `Plan changed to ${newPlan.displayName}. New pricing takes effect at your next billing cycle.`,
      newPlan: {
        id: newPlan.id,
        name: newPlan.displayName,
        billingPeriod: period,
      },
      currentPeriodEnd: safeUnixToDate((updatedSubscription as any).current_period_end),
    });
  } catch (error: any) {
    logger.error('Change plan error', error, 'Stripe');
    res.status(500).json({ error: 'Failed to change plan' });
  }
});

router.post('/reactivate-subscription', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const stripe = await getStripeClient();
    if (!stripe) {
      return res.status(400).json({ error: 'Stripe is not configured' });
    }
    
    const userId = req.userId!;
    
    const subscription = await storage.getUserSubscription(userId);
    if (!subscription || !subscription.stripeSubscriptionId) {
      return res.status(404).json({ error: 'No subscription found' });
    }

    if (!subscription.cancelAtPeriodEnd) {
      return res.status(400).json({ error: 'Subscription is not set to cancel' });
    }

    await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });

    await storage.updateUserSubscription(subscription.id, {
      cancelAtPeriodEnd: false,
    });

    logger.info(`User ${userId} reactivated their subscription`, undefined, 'Stripe');

    res.json({ 
      success: true,
      message: 'Subscription has been reactivated. You will continue to be billed normally.',
    });
  } catch (error: any) {
    logger.error('Reactivate subscription error', error, 'Stripe');
    res.status(500).json({ error: 'Failed to reactivate subscription' });
  }
});

router.post('/cancel-subscription', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const stripe = await getStripeClient();
    if (!stripe) {
      return res.status(400).json({ error: 'Stripe is not configured' });
    }
    
    const userId = req.userId!;
    
    const subscription = await storage.getUserSubscription(userId);
    if (!subscription || !subscription.stripeSubscriptionId) {
      return res.status(404).json({ error: 'No active subscription found' });
    }

    await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    await storage.updateUserSubscription(subscription.id, {
      cancelAtPeriodEnd: true,
    });

    res.json({ 
      message: 'Subscription will be canceled at the end of the billing period',
      currentPeriodEnd: subscription.currentPeriodEnd 
    });
  } catch (error: any) {
    logger.error('Cancel subscription error', error, 'Stripe');
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
    logger.error('Refund error', error, 'Stripe');
    res.status(500).json({ error: 'Failed to process refund' });
  }
});

router.post('/webhook', async (req, res) => {
  const stripe = await getStripeClient();
  if (!stripe) {
    return res.status(400).send('Stripe is not configured');
  }
  
  const rawReq = req as Request & { rawBody?: Buffer };
  const sig = req.headers['stripe-signature'];
  const webhookSecret = await getStripeWebhookSecret();

  if (!sig) {
    return res.status(400).send('No signature provided');
  }

  let event: Stripe.Event;

  try {
    const rawBody = rawReq.rawBody || Buffer.from(JSON.stringify(req.body));
    
    if (!webhookSecret) {
      event = req.body as Stripe.Event;
    } else {
      event = stripe.webhooks.constructEvent(rawBody, sig as string, webhookSecret);
    }
  } catch (err: any) {
    logger.error('Webhook signature verification failed', err, 'Stripe');
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  await recordWebhookReceived('stripe');

  try {
    let result;
    
    switch (event.type) {
      case 'checkout.session.completed':
        result = await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'invoice.payment_succeeded':
        result = await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;
      case 'invoice.payment_failed':
        result = await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;
      case 'customer.subscription.deleted':
        result = await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.updated':
        result = await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      case 'charge.dispute.created':
        result = await handleChargeDispute(event.data.object as Stripe.Dispute);
        break;
      case 'charge.refunded':
        result = await handleChargeRefunded(event.data.object as Stripe.Charge);
        break;
      default:
        logger.info(`Unhandled event type: ${event.type}`, undefined, 'Stripe');
        result = { success: true, action: 'unhandled' };
    }

    await PaymentAuditService.logWebhookReceived('stripe', event.type, result?.success || false, { eventId: event.id });

    res.json({ received: true });
  } catch (error: any) {
    logger.error('Webhook processing error', error, 'Stripe');
    
    await queueFailedWebhook(
      'stripe',
      event.type,
      event.id,
      event.data.object,
      error.message || 'Unknown error'
    );
    
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export const stripeRouter = router;
export default router;
