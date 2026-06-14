'use strict';
/**
 * Paystack Routes
 * Express router for all Paystack payment endpoints
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
  getPaystackClient,
  isPaystackEnabled,
  isPaystackConfigured,
  getPaystackCurrency,
  getPaystackConfig,
  getSupportedCurrencies,
  getPaystackPublicKey,
  initializePaystackTransaction,
  verifyPaystackTransaction,
  fetchPaystackSubscription,
  disablePaystackSubscription,
  verifyWebhookSignature,
  initiateRefund,
  generateReference,
  createPaystackCustomer,
  fetchPaystackCustomer,
} from './service';
import {
  handleChargeSuccess,
  handleSubscriptionCreate,
  handleSubscriptionDisable,
  handleSubscriptionNotRenew,
  handleInvoiceCreate,
  handleInvoicePaymentFailed,
  handleTransferSuccess,
  handleTransferFailed,
  handleRefundProcessed,
  handleChargeback,
  handlePaymentRequestPending,
  handlePaymentRequestSuccess,
} from './handlers';
import { FRONTEND_URL } from '../../webhook-helper';
import { logger } from '../../../../utils/logger';

const router: Router = express.Router();

router.get('/config', async (_req: Request, res: Response) => {
  try {
    const config = await getPaystackConfig();
    const currencyConfig = await getPaystackCurrency();
    res.json({
      ...config,
      supportedCurrencies: [{ 
        code: currencyConfig.currency, 
        symbol: currencyConfig.symbol, 
        name: currencyConfig.currency 
      }],
    });
  } catch (error: any) {
    logger.error('Error fetching Paystack config', error, 'Paystack');
    res.status(500).json({ error: 'Failed to fetch Paystack configuration' });
  }
});

router.post('/initialize-subscription', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const isEnabled = await isPaystackEnabled();
    if (!isEnabled) {
      return res.status(400).json({ error: 'Paystack payments are not enabled' });
    }
    
    const isConfigured = await isPaystackConfigured();
    if (!isConfigured) {
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

    const paystackPlanCode = billingPeriod === 'yearly' 
      ? plan.paystackYearlyPlanCode 
      : plan.paystackMonthlyPlanCode;

    if (!paystackPlanCode) {
      return res.status(400).json({ 
        error: `Paystack plan not configured for ${billingPeriod} billing period` 
      });
    }

    const currencyConfig = await getPaystackCurrency();
    const price = billingPeriod === 'yearly' 
      ? plan.paystackYearlyPrice 
      : plan.paystackMonthlyPrice;
    const amount = price ? parseFloat(price.toString()) : 0;

    const reference = generateReference('sub');
    const callbackUrl = `${FRONTEND_URL}/app/payment-result?status=success&gateway=paystack&type=subscription&reference=${reference}&plan_id=${planId}&billing_period=${billingPeriod}`;

    const transaction = await initializePaystackTransaction({
      email: user.email,
      amount,
      currency: currencyConfig.currency,
      reference,
      callback_url: callbackUrl,
      plan: paystackPlanCode,
      metadata: {
        userId,
        planId,
        billingPeriod,
        type: 'subscription',
      },
    });

    await PaymentAuditService.logPaymentInitiated('paystack', userId, 'subscription', amount, currencyConfig.currency, { planId, billingPeriod });

    res.json({
      authorizationUrl: transaction.authorization_url,
      accessCode: transaction.access_code,
      reference: transaction.reference,
      planName: plan.name,
      billingPeriod,
      amount,
      currency: currencyConfig.currency,
      currencySymbol: currencyConfig.symbol,
    });
  } catch (error: any) {
    logger.error('Initialize Paystack subscription error', error, 'Paystack');
    res.status(500).json({ error: 'Failed to initialize subscription' });
  }
});

router.post('/verify-subscription', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const isEnabled = await isPaystackEnabled();
    if (!isEnabled) {
      return res.status(400).json({ error: 'Paystack payments are not enabled' });
    }
    
    const { reference } = req.body;
    const userId = req.userId!;

    if (!reference) {
      return res.status(400).json({ error: 'Reference required' });
    }

    const verification = await verifyPaystackTransaction(reference);

    if (verification.status !== 'success') {
      return res.status(400).json({ error: 'Payment not successful' });
    }

    const metadata = verification.metadata || {};
    
    if (metadata.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const plan = await storage.getPlan(metadata.planId);
    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const billingPeriod = metadata.billingPeriod || 'monthly';
    const currentPeriodEnd = new Date();
    if (billingPeriod === 'yearly') {
      currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 1);
    } else {
      currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);
    }

    const subscriptionCode = verification.authorization?.authorization_code;
    const customerCode = verification.customer?.customer_code;

    const existingSub = await storage.getUserSubscription(userId);
    if (existingSub) {
      await storage.updateUserSubscription(existingSub.id, {
        planId: metadata.planId,
        status: 'active',
        currentPeriodStart: new Date(),
        currentPeriodEnd,
        paystackSubscriptionCode: subscriptionCode,
        paystackCustomerCode: customerCode,
        cancelAtPeriodEnd: false,
        billingPeriod,
      });
    } else {
      await storage.createUserSubscription({
        userId,
        planId: metadata.planId,
        status: 'active',
        currentPeriodStart: new Date(),
        currentPeriodEnd,
        paystackSubscriptionCode: subscriptionCode,
        paystackCustomerCode: customerCode,
        cancelAtPeriodEnd: false,
        billingPeriod,
      });
    }

    await storage.updateUser(userId, {
      planType: plan.name,
      planExpiresAt: currentPeriodEnd,
    });

    await NotificationService.notifyMembershipUpgraded(userId, plan.name);

    const amount = (verification.amount / 100).toFixed(2);
    const currency = verification.currency || 'NGN';
    const userSub = await storage.getUserSubscription(userId);

    try {
      const newTransaction = await storage.createPaymentTransaction({
        userId,
        type: 'subscription',
        gateway: 'paystack',
        gatewayTransactionId: reference,
        gatewaySubscriptionId: subscriptionCode,
        amount,
        currency,
        planId: metadata.planId,
        subscriptionId: userSub?.id,
        description: `${plan.displayName} Subscription`,
        billingPeriod,
        status: 'completed',
        completedAt: new Date(),
      });

      await PaymentAuditService.logSubscriptionCreated(
        'paystack',
        userId,
        subscriptionCode || reference,
        metadata.planId,
        billingPeriod,
        { amount: parseFloat(amount), currency }
      );

      try {
        await generateInvoiceForTransaction(newTransaction.id);
        await emailService.sendPurchaseConfirmation(newTransaction.id);
      } catch (emailError: any) {
        logger.error('Failed to send purchase confirmation email', emailError, 'Paystack');
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
    logger.error('Verify Paystack subscription error', error, 'Paystack');
    res.status(500).json({ error: 'Failed to verify subscription' });
  }
});

router.post('/initialize-credits', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const isEnabled = await isPaystackEnabled();
    if (!isEnabled) {
      return res.status(400).json({ error: 'Paystack payments are not enabled' });
    }
    
    const isConfigured = await isPaystackConfigured();
    if (!isConfigured) {
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
    const price = pkg.paystackPrice ? parseFloat(pkg.paystackPrice.toString()) : 0;
    
    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ 
        error: `Credit package does not have a price configured for Paystack (${currencyConfig.currency}). Please ask the admin to set the Paystack price.` 
      });
    }

    const reference = generateReference('cr');
    const callbackUrl = `${FRONTEND_URL}/app/payment-result?status=success&gateway=paystack&type=credits&reference=${reference}&package_id=${packageId}`;

    const transaction = await initializePaystackTransaction({
      email: user.email,
      amount: price,
      currency: currencyConfig.currency,
      reference,
      callback_url: callbackUrl,
      metadata: {
        userId,
        packageId,
        credits: pkg.credits.toString(),
        type: 'credits',
        billing_name: user.billingName || '',
        billing_address: user.billingAddressLine1 || '',
        billing_city: user.billingCity || '',
        billing_state: user.billingState || '',
        billing_postal_code: user.billingPostalCode || '',
        billing_country: user.billingCountry || '',
      },
    });

    await PaymentAuditService.logPaymentInitiated('paystack', userId, 'credits', price, currencyConfig.currency, { packageId });

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
    logger.error('Initialize Paystack credits error', error, 'Paystack');
    res.status(500).json({ error: 'Failed to initialize credits purchase' });
  }
});

router.post('/verify-credits', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const isEnabled = await isPaystackEnabled();
    if (!isEnabled) {
      return res.status(400).json({ error: 'Paystack payments are not enabled' });
    }
    
    const { reference, packageId } = req.body;
    const userId = req.userId!;

    if (!reference || !packageId) {
      return res.status(400).json({ error: 'Reference and package ID required' });
    }

    const verification = await verifyPaystackTransaction(reference);

    if (verification.status !== 'success') {
      return res.status(400).json({ error: 'Payment not successful' });
    }

    const metadata = verification.metadata || {};
    
    if (metadata.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const pkg = await storage.getCreditPackage(packageId);
    if (!pkg) {
      return res.status(404).json({ error: 'Package not found' });
    }

    try {
      await storage.addCreditsAtomic(userId, pkg.credits, `Purchased ${pkg.name}`, reference);

      const amount = (verification.amount / 100).toFixed(2);
      const currency = verification.currency || 'NGN';

      const creditTransaction = await storage.createPaymentTransaction({
        userId,
        type: 'credits',
        gateway: 'paystack',
        gatewayTransactionId: reference,
        amount,
        currency,
        creditPackageId: pkg.id,
        description: `${pkg.name} - ${pkg.credits} Credits`,
        creditsAwarded: pkg.credits,
        status: 'completed',
        completedAt: new Date(),
      });

      await PaymentAuditService.logCreditsAwarded(
        'paystack',
        userId,
        creditTransaction.id,
        pkg.credits,
        { packageName: pkg.name, amount: parseFloat(amount) }
      );

      try {
        await generateInvoiceForTransaction(creditTransaction.id);
        await emailService.sendPurchaseConfirmation(creditTransaction.id);
      } catch (emailError: any) {
        logger.error('Failed to send credits purchase confirmation email', emailError, 'Paystack');
      }
    } catch (error: any) {
      if (!error.message?.includes('unique') && !error.message?.includes('duplicate')) {
        throw error;
      }
      logger.info(`Payment ${reference} already processed, skipping credit addition`, undefined, 'Paystack');
    }

    const user = await storage.getUser(userId);

    res.json({
      success: true,
      message: 'Credits added successfully',
      credits: pkg.credits,
      newBalance: user?.credits || 0,
    });
  } catch (error: any) {
    logger.error('Verify Paystack credits error', error, 'Paystack');
    res.status(500).json({ error: 'Failed to verify credits purchase' });
  }
});

router.post('/verify-transaction', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const paystack = await getPaystackClient();
    if (!paystack) {
      return res.status(400).json({ error: 'Paystack is not configured' });
    }
    
    const { reference } = req.body;
    const userId = req.userId!;

    if (!reference) {
      return res.status(400).json({ error: 'Reference required' });
    }

    const verification = await verifyPaystackTransaction(reference);

    if (verification.status !== 'success') {
      return res.json({ 
        success: false, 
        status: 'pending',
        message: 'Transaction not yet completed' 
      });
    }

    const existingTx = await storage.getPaymentTransactionByGatewayId('paystack', reference);

    if (existingTx) {
      return res.json({
        success: true,
        status: 'already_processed',
        transactionId: existingTx.id,
        type: existingTx.type,
        credits: existingTx.creditsAwarded,
      });
    }

    const metadata = verification.metadata || {};
    
    if (metadata.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const result = await handleChargeSuccess(verification);
    
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
  } catch (error: any) {
    logger.error('Verify transaction error', error, 'Paystack');
    res.status(500).json({ error: 'Failed to verify transaction' });
  }
});

router.post('/cancel-subscription', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const isEnabled = await isPaystackEnabled();
    if (!isEnabled) {
      return res.status(400).json({ error: 'Paystack payments are not enabled' });
    }
    
    const userId = req.userId!;

    const subscription = await storage.getUserSubscription(userId);
    if (!subscription || !subscription.paystackSubscriptionCode) {
      return res.status(404).json({ error: 'No active Paystack subscription found' });
    }

    if (!subscription.paystackEmailToken) {
      await storage.updateUserSubscription(subscription.id, {
        cancelAtPeriodEnd: true,
      });

      await PaymentAuditService.logSubscriptionCancelled(
        'paystack',
        userId,
        subscription.paystackSubscriptionCode,
        true,
        { reason: 'user_requested_no_email_token' }
      );

      return res.json({
        message: 'Subscription will be canceled at the end of the billing period',
        currentPeriodEnd: subscription.currentPeriodEnd,
      });
    }

    await disablePaystackSubscription(
      subscription.paystackSubscriptionCode,
      subscription.paystackEmailToken
    );

    await storage.updateUserSubscription(subscription.id, {
      cancelAtPeriodEnd: true,
    });

    await PaymentAuditService.logSubscriptionCancelled(
      'paystack',
      userId,
      subscription.paystackSubscriptionCode,
      true,
      { reason: 'user_requested' }
    );

    res.json({
      message: 'Subscription will be canceled at the end of the billing period',
      currentPeriodEnd: subscription.currentPeriodEnd,
    });
  } catch (error: any) {
    logger.error('Cancel Paystack subscription error', error, 'Paystack');
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
    logger.error('Refund error', error, 'Paystack');
    res.status(500).json({ error: 'Failed to process refund' });
  }
});

router.post('/webhook', async (req, res) => {
  const rawReq = req as Request & { rawBody?: Buffer };
  const signature = req.headers['x-paystack-signature'] as string;

  try {
    const rawBody = rawReq.rawBody || Buffer.from(JSON.stringify(req.body));
    const isValid = await verifyWebhookSignature(rawBody.toString(), signature || '');

    if (!isValid) {
      logger.error('Webhook signature verification failed', undefined, 'Paystack');
      return res.status(400).send('Invalid signature');
    }

    await recordWebhookReceived('paystack');

    const event = req.body;
    const eventType = event.event;
    const data = event.data;

    logger.info(`Webhook received: ${eventType}`, undefined, 'Paystack');

    let result;

    try {
      switch (eventType) {
        case 'charge.success':
          result = await handleChargeSuccess(data);
          break;

        case 'subscription.create':
          result = await handleSubscriptionCreate(data);
          break;

        case 'subscription.disable':
          result = await handleSubscriptionDisable(data);
          break;

        case 'subscription.not_renew':
          result = await handleSubscriptionNotRenew(data);
          break;

        case 'invoice.create':
          result = await handleInvoiceCreate(data);
          break;

        case 'invoice.payment_failed':
          result = await handleInvoicePaymentFailed(data);
          break;

        case 'transfer.success':
          result = await handleTransferSuccess(data);
          break;

        case 'transfer.failed':
          result = await handleTransferFailed(data);
          break;

        case 'refund.processed':
          result = await handleRefundProcessed(data);
          break;

        case 'charge.dispute.create':
        case 'charge.dispute.remind':
        case 'charge.dispute.resolve':
          result = await handleChargeback(data);
          break;

        case 'paymentrequest.pending':
          result = await handlePaymentRequestPending(data);
          break;

        case 'paymentrequest.success':
          result = await handlePaymentRequestSuccess(data);
          break;

        default:
          logger.info(`Unhandled event type: ${eventType}`, undefined, 'Paystack');
          result = { success: true, action: 'unhandled' };
      }

      await PaymentAuditService.logWebhookReceived('paystack', eventType, result?.success || false, { eventId: event.id });

      res.json({ received: true });
    } catch (error: any) {
      logger.error('Webhook processing error', error, 'Paystack');
      
      await queueFailedWebhook(
        'paystack',
        eventType,
        event.id || `paystack_${Date.now()}`,
        data,
        error.message || 'Unknown error'
      );
      
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  } catch (error: any) {
    logger.error('Webhook error', error, 'Paystack');
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

router.post('/verify-payment', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const isEnabled = await isPaystackEnabled();
    if (!isEnabled) {
      return res.status(400).json({ error: 'Paystack payments are not enabled' });
    }

    const { reference } = req.body;
    const userId = req.userId!;

    if (!reference) {
      return res.status(400).json({ error: 'Reference required' });
    }

    const verification = await verifyPaystackTransaction(reference);

    if (verification.status !== 'success') {
      return res.json({
        success: false,
        status: 'pending',
        message: 'Transaction not yet completed',
      });
    }

    const metadata = verification.metadata || {};

    if (metadata.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const existingTx = await storage.getPaymentTransactionByGatewayId('paystack', reference);
    if (existingTx) {
      return res.json({
        success: true,
        status: 'already_processed',
        transactionId: existingTx.id,
        type: existingTx.type,
        credits: existingTx.creditsAwarded,
      });
    }

    if (metadata.type === 'subscription') {
      const plan = await storage.getPlan(metadata.planId);
      if (!plan) {
        return res.status(404).json({ error: 'Plan not found' });
      }

      const billingPeriod = metadata.billingPeriod || 'monthly';
      const currentPeriodEnd = new Date();
      if (billingPeriod === 'yearly') {
        currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 1);
      } else {
        currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);
      }

      const subscriptionCode = verification.authorization?.authorization_code;
      const customerCode = verification.customer?.customer_code;

      const existingSub = await storage.getUserSubscription(userId);
      if (existingSub) {
        await storage.updateUserSubscription(existingSub.id, {
          planId: metadata.planId,
          status: 'active',
          currentPeriodStart: new Date(),
          currentPeriodEnd,
          paystackSubscriptionCode: subscriptionCode,
          paystackCustomerCode: customerCode,
          cancelAtPeriodEnd: false,
          billingPeriod,
        });
      } else {
        await storage.createUserSubscription({
          userId,
          planId: metadata.planId,
          status: 'active',
          currentPeriodStart: new Date(),
          currentPeriodEnd,
          paystackSubscriptionCode: subscriptionCode,
          paystackCustomerCode: customerCode,
          cancelAtPeriodEnd: false,
          billingPeriod,
        });
      }

      await storage.updateUser(userId, {
        planType: plan.name,
        planExpiresAt: currentPeriodEnd,
      });

      await NotificationService.notifyMembershipUpgraded(userId, plan.name);

      const amount = (verification.amount / 100).toFixed(2);
      const currency = verification.currency || 'NGN';
      const userSub = await storage.getUserSubscription(userId);

      try {
        const newTransaction = await storage.createPaymentTransaction({
          userId,
          type: 'subscription',
          gateway: 'paystack',
          gatewayTransactionId: reference,
          gatewaySubscriptionId: subscriptionCode,
          amount,
          currency,
          planId: metadata.planId,
          subscriptionId: userSub?.id,
          description: `${plan.displayName || plan.name} Subscription`,
          billingPeriod,
          status: 'completed',
          completedAt: new Date(),
        });

        await PaymentAuditService.logSubscriptionCreated(
          'paystack',
          userId,
          subscriptionCode || reference,
          metadata.planId,
          billingPeriod,
          { amount: parseFloat(amount), currency }
        );

        try {
          await generateInvoiceForTransaction(newTransaction.id);
          await emailService.sendPurchaseConfirmation(newTransaction.id);
        } catch (emailError: any) {
          logger.error('Failed to send purchase confirmation email', emailError, 'Paystack');
        }
      } catch (txError: any) {
        if (!txError.message?.includes('unique') && !txError.message?.includes('duplicate')) {
          throw txError;
        }
      }

      return res.json({
        success: true,
        message: 'Subscription activated successfully',
        plan: plan.name,
        expiresAt: currentPeriodEnd,
      });
    } else if (metadata.type === 'credits') {
      const pkg = await storage.getCreditPackage(metadata.packageId);
      if (!pkg) {
        return res.status(404).json({ error: 'Package not found' });
      }

      try {
        await storage.addCreditsAtomic(userId, pkg.credits, `Purchased ${pkg.name}`, reference);

        const amount = (verification.amount / 100).toFixed(2);
        const currency = verification.currency || 'NGN';

        const creditTransaction = await storage.createPaymentTransaction({
          userId,
          type: 'credits',
          gateway: 'paystack',
          gatewayTransactionId: reference,
          amount,
          currency,
          creditPackageId: pkg.id,
          description: `${pkg.name} - ${pkg.credits} Credits`,
          creditsAwarded: pkg.credits,
          status: 'completed',
          completedAt: new Date(),
        });

        await PaymentAuditService.logCreditsAwarded(
          'paystack',
          userId,
          creditTransaction.id,
          pkg.credits,
          { packageName: pkg.name, amount: parseFloat(amount) }
        );

        try {
          await generateInvoiceForTransaction(creditTransaction.id);
          await emailService.sendPurchaseConfirmation(creditTransaction.id);
        } catch (emailError: any) {
          logger.error('Failed to send credits purchase confirmation email', emailError, 'Paystack');
        }
      } catch (error: any) {
        if (!error.message?.includes('unique') && !error.message?.includes('duplicate')) {
          throw error;
        }
        logger.info(`Payment ${reference} already processed, skipping credit addition`, undefined, 'Paystack');
      }

      const user = await storage.getUser(userId);

      return res.json({
        success: true,
        message: 'Credits added successfully',
        credits: pkg.credits,
        newBalance: user?.credits || 0,
      });
    } else {
      const result = await handleChargeSuccess(verification);
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
          error: result.error,
        });
      }
    }
  } catch (error: any) {
    logger.error('Verify payment error', error, 'Paystack');
    res.status(500).json({ error: 'Failed to verify payment' });
  }
});

export const paystackRouter = router;
export default router;
