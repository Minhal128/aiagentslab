'use strict';
/**
 * Paystack Webhook Event Handlers
 * Pure functions for processing webhook events
 */

import { storage } from '../../../../storage';
import { NotificationService } from '../../../../services/notification-service';
import { syncUserWithSubscription, applyPlanCredits } from '../../../../services/membership-service';
import { emailService } from '../../../../services/email-service';
import { generateInvoiceForTransaction } from '../../invoice-service';
import { PaymentAuditService } from '../../audit';
import { getPaystackCurrency, verifyPaystackTransaction } from './service';

export interface HandlerResult {
  success: boolean;
  action?: string;
  error?: string;
  userId?: string;
  transactionId?: string;
}

export async function handleChargeSuccess(
  data: any
): Promise<HandlerResult> {
  const reference = data.reference;
  const metadata = data.metadata || {};
  const userId = metadata.userId;
  const type = metadata.type || 'subscription';

  if (!userId) {
    return { success: false, error: 'No userId in transaction metadata' };
  }

  const existingTx = await storage.getPaymentTransactionByGatewayId('paystack', reference);
  if (existingTx) {
    return { success: true, action: 'already_processed', userId, transactionId: existingTx.id };
  }

  if (type === 'credits') {
    return handleCreditsPayment(data, userId, metadata);
  } else if (type === 'subscription') {
    return handleSubscriptionPayment(data, userId, metadata);
  }

  return { success: true, action: 'unknown_type', userId };
}

async function handleCreditsPayment(
  data: any,
  userId: string,
  metadata: any
): Promise<HandlerResult> {
  const packageId = metadata.packageId;
  const credits = parseInt(metadata.credits || '0', 10);
  
  if (!packageId || !credits) {
    return { success: false, error: 'Invalid credits payment metadata' };
  }

  const pkg = await storage.getCreditPackage(packageId);
  if (!pkg) {
    return { success: false, error: 'Credit package not found' };
  }

  try {
    await storage.addCreditsAtomic(userId, credits, `Purchased ${pkg.name}`, data.reference);

    const amount = (data.amount / 100).toFixed(2);
    const currency = data.currency || 'NGN';

    const creditTransaction = await storage.createPaymentTransaction({
      userId,
      type: 'credits',
      gateway: 'paystack',
      gatewayTransactionId: data.reference,
      amount,
      currency,
      creditPackageId: packageId,
      description: `${pkg.name} - ${credits} Credits`,
      creditsAwarded: credits,
      status: 'completed',
      completedAt: new Date(),
    });

    await PaymentAuditService.logCreditsAwarded(
      'paystack',
      userId,
      creditTransaction.id,
      credits,
      { packageName: pkg.name, amount: parseFloat(amount) }
    );

    try {
      await generateInvoiceForTransaction(creditTransaction.id);
      await emailService.sendPurchaseConfirmation(creditTransaction.id);
    } catch (emailError: any) {
      console.error(`❌ [Paystack] Failed to send credits purchase confirmation email:`, emailError);
    }

    return {
      success: true,
      action: 'credits_awarded',
      userId,
      transactionId: creditTransaction.id,
    };
  } catch (error: any) {
    if (error.message?.includes('unique') || error.message?.includes('duplicate')) {
      return { success: true, action: 'credits_already_processed', userId };
    }
    throw error;
  }
}

async function handleSubscriptionPayment(
  data: any,
  userId: string,
  metadata: any
): Promise<HandlerResult> {
  const planId = metadata.planId;
  const billingPeriod = metadata.billingPeriod || 'monthly';

  if (!planId) {
    return { success: false, error: 'No planId in subscription metadata' };
  }

  const plan = await storage.getPlan(planId);
  if (!plan) {
    return { success: false, error: 'Plan not found' };
  }

  const currentPeriodEnd = new Date();
  if (billingPeriod === 'yearly') {
    currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 1);
  } else {
    currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);
  }

  const existingSub = await storage.getUserSubscription(userId);
  const subscriptionCode = data.subscription?.subscription_code || data.authorization?.authorization_code;

  if (existingSub) {
    console.log(`[Paystack] Updating existing subscription ${existingSub.id} for user ${userId}`);
    await storage.updateUserSubscription(existingSub.id, {
      planId,
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd,
      paystackSubscriptionCode: subscriptionCode,
      cancelAtPeriodEnd: false,
      billingPeriod,
      // Clear other gateway IDs when switching to Paystack
      stripeSubscriptionId: null,
      razorpaySubscriptionId: null,
      paypalSubscriptionId: null,
      mercadopagoSubscriptionId: null,
    });
  } else {
    await storage.createUserSubscription({
      userId,
      planId,
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd,
      paystackSubscriptionCode: subscriptionCode,
      cancelAtPeriodEnd: false,
      billingPeriod,
    });
  }

  await storage.updateUser(userId, {
    planType: plan.name,
    planExpiresAt: currentPeriodEnd,
  });

  await NotificationService.notifyMembershipUpgraded(userId, plan.name);

  // Apply plan credits (e.g., 500 credits for Pro plan)
  await applyPlanCredits(userId, plan.id, 'paystack', data.reference);

  const amount = (data.amount / 100).toFixed(2);
  const currency = data.currency || 'NGN';
  const userSub = await storage.getUserSubscription(userId);

  try {
    const newTransaction = await storage.createPaymentTransaction({
      userId,
      type: 'subscription',
      gateway: 'paystack',
      gatewayTransactionId: data.reference,
      gatewaySubscriptionId: subscriptionCode,
      amount,
      currency,
      planId,
      subscriptionId: userSub?.id,
      description: `${plan.displayName} Subscription`,
      billingPeriod,
      status: 'completed',
      completedAt: new Date(),
    });

    await PaymentAuditService.logSubscriptionCreated(
      'paystack',
      userId,
      subscriptionCode || data.reference,
      planId,
      billingPeriod,
      { amount: parseFloat(amount), currency }
    );

    try {
      await generateInvoiceForTransaction(newTransaction.id);
      await emailService.sendPurchaseConfirmation(newTransaction.id);
    } catch (emailError: any) {
      console.error(`❌ [Paystack] Failed to send purchase confirmation email:`, emailError);
    }

    return {
      success: true,
      action: 'subscription_activated',
      userId,
      transactionId: newTransaction.id,
    };
  } catch (txError: any) {
    if (!txError.message?.includes('unique') && !txError.message?.includes('duplicate')) {
      throw txError;
    }
    return { success: true, action: 'subscription_already_processed', userId };
  }
}

export async function handleSubscriptionCreate(
  data: any
): Promise<HandlerResult> {
  const customerCode = data.customer?.customer_code;
  const subscriptionCode = data.subscription_code;

  console.log(`✅ [Paystack] Subscription created: ${subscriptionCode} for customer ${customerCode}`);

  return { success: true, action: 'subscription_created' };
}

export async function handleSubscriptionDisable(
  data: any
): Promise<HandlerResult> {
  const subscriptionCode = data.subscription_code;
  const customerCode = data.customer?.customer_code;

  if (!subscriptionCode) {
    return { success: false, error: 'No subscription code in event data' };
  }

  const userSub = await storage.getUserSubscriptionByPaystackCode(subscriptionCode);
  if (!userSub) {
    console.warn(`⚠️ [Paystack] Subscription ${subscriptionCode} not found in database`);
    return { success: true, action: 'subscription_not_found' };
  }

  await storage.updateUserSubscription(userSub.id, {
    status: 'cancelled',
    cancelAtPeriodEnd: false,
  });

  await syncUserWithSubscription(userSub.userId);

  await PaymentAuditService.logSubscriptionCancelled(
    'paystack',
    userSub.userId,
    subscriptionCode,
    false,
    { reason: 'subscription_disabled' }
  );

  return { success: true, action: 'subscription_disabled', userId: userSub.userId };
}

export async function handleSubscriptionNotRenew(
  data: any
): Promise<HandlerResult> {
  const subscriptionCode = data.subscription_code;

  if (!subscriptionCode) {
    return { success: false, error: 'No subscription code in event data' };
  }

  const userSub = await storage.getUserSubscriptionByPaystackCode(subscriptionCode);
  if (!userSub) {
    console.warn(`⚠️ [Paystack] Subscription ${subscriptionCode} not found in database`);
    return { success: true, action: 'subscription_not_found' };
  }

  await storage.updateUserSubscription(userSub.id, {
    cancelAtPeriodEnd: true,
  });

  await PaymentAuditService.logSubscriptionCancelled(
    'paystack',
    userSub.userId,
    subscriptionCode,
    true,
    { reason: 'subscription_not_renew' }
  );

  return { success: true, action: 'subscription_not_renew', userId: userSub.userId };
}

export async function handleInvoiceCreate(
  data: any
): Promise<HandlerResult> {
  console.log(`📄 [Paystack] Invoice created: ${data.id || data.reference}`);
  return { success: true, action: 'invoice_created' };
}

export async function handleInvoicePaymentFailed(
  data: any
): Promise<HandlerResult> {
  const subscriptionCode = data.subscription?.subscription_code;

  if (!subscriptionCode) {
    return { success: true, action: 'no_subscription' };
  }

  const userSub = await storage.getUserSubscriptionByPaystackCode(subscriptionCode);
  if (!userSub) {
    return { success: true, action: 'subscription_not_found' };
  }

  await storage.updateUserSubscription(userSub.id, {
    status: 'past_due',
  });

  await PaymentAuditService.logPaymentFailed(
    'paystack',
    userSub.userId,
    'Invoice payment failed',
    { subscriptionCode, invoiceId: data.id }
  );

  try {
    const amount = data.amount ? (data.amount / 100).toFixed(2) : '0';
    await emailService.sendPaymentFailed(userSub.userId, amount, 'Subscription renewal failed');
  } catch (emailError: any) {
    console.error(`❌ [Paystack] Failed to send payment failed email:`, emailError);
  }

  return { success: true, action: 'invoice_payment_failed', userId: userSub.userId };
}

export async function handleTransferSuccess(
  data: any
): Promise<HandlerResult> {
  console.log(`✅ [Paystack] Transfer successful: ${data.reference}`);
  return { success: true, action: 'transfer_success' };
}

export async function handleTransferFailed(
  data: any
): Promise<HandlerResult> {
  console.log(`❌ [Paystack] Transfer failed: ${data.reference}`);
  return { success: true, action: 'transfer_failed' };
}

export async function handleRefundProcessed(
  data: any
): Promise<HandlerResult> {
  const reference = data.transaction_reference || data.transaction?.reference;
  
  if (!reference) {
    return { success: false, error: 'No transaction reference in refund event' };
  }

  const transaction = await storage.getPaymentTransactionByGatewayId('paystack', reference);
  
  if (!transaction) {
    return { success: false, error: 'Transaction not found for refund' };
  }

  const existingRefunds = await storage.getTransactionRefunds(transaction.id);
  if (existingRefunds.length > 0) {
    return { success: true, action: 'refund_already_exists' };
  }

  const userId = transaction.userId;
  const user = await storage.getUser(userId);
  
  let creditsReversed = 0;
  if (transaction.type === 'credits' && transaction.creditsAwarded && user) {
    creditsReversed = transaction.creditsAwarded;
    const newCredits = Math.max(0, user.credits - creditsReversed);
    await storage.updateUserCredits(userId, newCredits);
  }
  
  await storage.createRefund({
    transactionId: transaction.id,
    userId,
    amount: transaction.amount,
    currency: transaction.currency,
    gateway: 'paystack',
    gatewayRefundId: data.id?.toString() || `ref_${Date.now()}`,
    reason: 'gateway_refund',
    initiatedBy: 'gateway',
    status: 'completed',
    creditsReversed: creditsReversed > 0 ? creditsReversed : undefined,
    metadata: {
      refundReason: data.merchant_note || 'external_refund',
    },
  });
  
  await storage.updatePaymentTransaction(transaction.id, { status: 'refunded' });

  await PaymentAuditService.logRefundCompleted(
    'paystack',
    userId,
    transaction.id,
    data.id?.toString() || 'unknown',
    parseFloat(transaction.amount),
    transaction.currency
  );

  return {
    success: true,
    action: 'refund_processed',
    userId,
    transactionId: transaction.id,
  };
}

export async function handleChargeback(
  data: any
): Promise<HandlerResult> {
  const reference = data.transaction?.reference;
  
  if (!reference) {
    return { success: false, error: 'No transaction reference in chargeback' };
  }

  const transaction = await storage.getPaymentTransactionByGatewayId('paystack', reference);
  
  if (!transaction) {
    return { success: false, error: 'Transaction not found for chargeback' };
  }

  const userId = transaction.userId;
  const user = await storage.getUser(userId);
  
  let creditsReversed = 0;
  if (transaction.type === 'credits' && transaction.creditsAwarded && user) {
    creditsReversed = transaction.creditsAwarded;
    const newCredits = Math.max(0, user.credits - creditsReversed);
    await storage.updateUserCredits(userId, newCredits);
  }
  
  await storage.createRefund({
    transactionId: transaction.id,
    userId,
    amount: transaction.amount,
    currency: transaction.currency,
    gateway: 'paystack',
    gatewayRefundId: data.id?.toString() || `chb_${Date.now()}`,
    reason: 'chargeback',
    initiatedBy: 'gateway',
    status: 'completed',
    creditsReversed: creditsReversed > 0 ? creditsReversed : undefined,
    metadata: {
      userSuspended: true,
      chargebackReason: data.reason || 'unknown',
      chargebackStatus: data.status,
    },
  });
  
  await storage.updatePaymentTransaction(transaction.id, { status: 'disputed' });
  await storage.updateUser(userId, { isActive: false });

  await PaymentAuditService.logDisputeOpened(
    'paystack',
    userId,
    transaction.id,
    data.id?.toString() || 'unknown',
    parseFloat(transaction.amount),
    transaction.currency,
    data.reason
  );
  
  try {
    await emailService.sendAccountSuspended(userId, `Chargeback: ${data.reason || 'Unknown reason'}`);
  } catch (emailError: any) {
    console.error(`❌ [Paystack] Failed to send account suspended email:`, emailError);
  }

  return {
    success: true,
    action: 'user_suspended_chargeback',
    userId,
    transactionId: transaction.id,
  };
}

export async function handlePaymentRequestPending(
  data: any
): Promise<HandlerResult> {
  console.log(`⏳ [Paystack] Payment request pending: ${data.id}`);
  return { success: true, action: 'payment_request_pending' };
}

export async function handlePaymentRequestSuccess(
  data: any
): Promise<HandlerResult> {
  console.log(`✅ [Paystack] Payment request successful: ${data.id}`);
  return { success: true, action: 'payment_request_success' };
}
