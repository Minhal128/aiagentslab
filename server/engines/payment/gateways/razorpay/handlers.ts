'use strict';
/**
 * Razorpay Webhook Event Handlers
 * Pure functions for processing webhook events
 */

import { storage } from '../../../../storage';
import { NotificationService } from '../../../../services/notification-service';
import { syncUserWithSubscription, applyPlanCredits } from '../../../../services/membership-service';
import { emailService } from '../../../../services/email-service';
import { generateInvoiceForTransaction } from '../../invoice-service';
import { PaymentAuditService } from '../../audit';
import { getRazorpayCurrency, fetchRazorpayPayment } from './service';

export interface HandlerResult {
  success: boolean;
  action?: string;
  error?: string;
  userId?: string;
  transactionId?: string;
}

export async function handleSubscriptionAuthenticated(): Promise<HandlerResult> {
  console.log('✅ [Razorpay] Subscription authenticated');
  return { success: true, action: 'subscription_authenticated' };
}

export async function handleSubscriptionActivated(
  subscription: any,
  payment?: any
): Promise<HandlerResult> {
  const notes = subscription.notes || {};
  const userId = notes.userId;
  const planId = notes.planId;
  const billingPeriod = notes.billingPeriod || 'monthly';

  if (!userId || !planId) {
    return { success: false, error: 'Missing userId or planId in subscription notes' };
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

  // Check if user already has a subscription (from any gateway)
  const existingSub = await storage.getUserSubscription(userId);
  
  if (existingSub) {
    // Update existing subscription instead of creating a duplicate
    console.log(`[Razorpay] Updating existing subscription ${existingSub.id} for user ${userId}`);
    await storage.updateUserSubscription(existingSub.id, {
      planId,
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd,
      razorpaySubscriptionId: subscription.id,
      cancelAtPeriodEnd: false,
      billingPeriod,
      // Clear other gateway IDs when switching to Razorpay
      stripeSubscriptionId: null,
      paypalSubscriptionId: null,
      paystackSubscriptionCode: null,
      paystackEmailToken: null,
      mercadopagoSubscriptionId: null,
    });
  } else {
    // No existing subscription, create new one
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
      console.log(`[Razorpay] Subscription ${subscription.id} already exists, skipping creation`);
    }
  }

  await storage.updateUser(userId, {
    planType: plan.name,
    planExpiresAt: currentPeriodEnd,
  });

  await NotificationService.notifyMembershipUpgraded(userId, plan.name);

  // Apply plan credits (e.g., 500 credits for Pro plan)
  const paymentId = payment?.id || subscription.id;
  await applyPlanCredits(userId, plan.id, 'razorpay', paymentId);

  const userSub = await storage.getUserSubscription(userId);
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

    await PaymentAuditService.logSubscriptionCreated(
      'razorpay',
      userId,
      subscription.id,
      planId,
      billingPeriod,
      { amount: inrAmount, currency: 'INR' }
    );

    try {
      await generateInvoiceForTransaction(newTransaction.id);
      await emailService.sendPurchaseConfirmation(newTransaction.id);
    } catch (emailError: any) {
      console.error(`❌ [Razorpay] Failed to send purchase confirmation email:`, emailError);
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

export async function handleSubscriptionCharged(
  subscription: any,
  payment: any
): Promise<HandlerResult> {
  const notes = subscription.notes || {};
  const userId = notes.userId;

  if (!userId) {
    return { success: false, error: 'No userId in subscription notes' };
  }

  const userSub = await storage.getUserSubscription(userId);
  if (!userSub) {
    return { success: false, error: 'User subscription not found' };
  }

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

  const plan = userSub.planId ? await storage.getPlan(userSub.planId) : null;
  const planName = plan?.name || 'pro';
  
  await storage.updateUser(userId, {
    planType: planName,
    planExpiresAt: newPeriodEnd,
  });

  if (!plan) {
    return { success: true, action: 'subscription_renewed_no_plan', userId };
  }

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

    await PaymentAuditService.logSubscriptionRenewed(
      'razorpay',
      userId,
      subscription.id,
      parseFloat(inrAmount?.toString() || '0'),
      'INR'
    );

    try {
      await generateInvoiceForTransaction(renewalTransaction.id);
      await emailService.sendPurchaseConfirmation(renewalTransaction.id);
    } catch (emailError: any) {
      console.error(`❌ [Razorpay] Failed to send renewal confirmation email:`, emailError);
    }

    return { 
      success: true, 
      action: 'subscription_renewed',
      userId,
      transactionId: renewalTransaction.id,
    };
  } catch (txError: any) {
    if (!txError.message?.includes('unique') && !txError.message?.includes('duplicate')) {
      throw txError;
    }
    return { success: true, action: 'renewal_already_processed', userId };
  }
}

export async function handleSubscriptionPending(
  subscription: any
): Promise<HandlerResult> {
  const notes = subscription.notes || {};
  const userId = notes.userId;

  if (!userId) {
    return { success: false, error: 'No userId in subscription notes' };
  }

  const userSub = await storage.getUserSubscription(userId);
  if (userSub) {
    await storage.updateUserSubscription(userSub.id, {
      status: 'past_due',
    });

    await PaymentAuditService.logPaymentFailed(
      'razorpay',
      userId,
      'Subscription payment pending',
      { subscriptionId: subscription.id }
    );
  }

  return { success: true, action: 'subscription_pending', userId };
}

export async function handleSubscriptionHalted(
  subscription: any
): Promise<HandlerResult> {
  const notes = subscription.notes || {};
  const userId = notes.userId;

  if (!userId) {
    return { success: false, error: 'No userId in subscription notes' };
  }

  const userSub = await storage.getUserSubscription(userId);
  if (userSub) {
    await storage.updateUserSubscription(userSub.id, {
      status: 'past_due',
    });

    await PaymentAuditService.logPaymentFailed(
      'razorpay',
      userId,
      'Subscription halted due to payment failure',
      { subscriptionId: subscription.id }
    );

    try {
      await emailService.sendPaymentFailed(userId, '0', 'Subscription payment halted');
    } catch (emailError: any) {
      console.error(`❌ [Razorpay] Failed to send payment failed email:`, emailError);
    }
  }

  return { success: true, action: 'subscription_halted', userId };
}

export async function handleSubscriptionCancelled(
  subscription: any
): Promise<HandlerResult> {
  const notes = subscription.notes || {};
  const userId = notes.userId;

  if (!userId) {
    return { success: false, error: 'No userId in subscription notes' };
  }

  const userSub = await storage.getUserSubscription(userId);
  if (userSub) {
    await storage.updateUserSubscription(userSub.id, {
      status: 'cancelled',
      cancelAtPeriodEnd: false,
    });

    await syncUserWithSubscription(userId);

    await PaymentAuditService.logSubscriptionCancelled(
      'razorpay',
      userId,
      subscription.id,
      false,
      { reason: 'subscription_cancelled' }
    );
  }

  return { success: true, action: 'subscription_cancelled', userId };
}

export async function handleSubscriptionCompleted(
  subscription: any
): Promise<HandlerResult> {
  const notes = subscription.notes || {};
  const userId = notes.userId;

  if (!userId) {
    return { success: false, error: 'No userId in subscription notes' };
  }

  const userSub = await storage.getUserSubscription(userId);
  if (userSub) {
    await storage.updateUserSubscription(userSub.id, {
      status: 'cancelled',
    });

    await syncUserWithSubscription(userId);

    await PaymentAuditService.logSubscriptionCancelled(
      'razorpay',
      userId,
      subscription.id,
      false,
      { reason: 'subscription_completed' }
    );
  }

  return { success: true, action: 'subscription_completed', userId };
}

export async function handlePaymentCaptured(
  payment: any
): Promise<HandlerResult> {
  const notes = payment.notes || {};
  
  if (notes.type !== 'credits') {
    return { success: true, action: 'not_credits_payment' };
  }

  const userId = notes.userId;
  const packageId = notes.packageId;
  const credits = parseInt(notes.credits || '0', 10);

  if (!userId || !packageId || !credits) {
    return { success: false, error: 'Invalid payment metadata for credits' };
  }

  const pkg = await storage.getCreditPackage(packageId);
  if (!pkg) {
    return { success: false, error: 'Package not found' };
  }

  try {
    await storage.addCreditsAtomic(userId, credits, `Purchased ${pkg.name}`, payment.id);

    const inrPrice = pkg.razorpayPrice ? parseFloat(pkg.razorpayPrice.toString()) : (payment.amount / 100);
    const creditTransaction = await storage.createPaymentTransaction({
      userId,
      type: 'credits',
      gateway: 'razorpay',
      gatewayTransactionId: payment.id,
      amount: inrPrice.toFixed(2),
      currency: 'INR',
      creditPackageId: packageId,
      description: `${pkg.name} - ${credits} Credits`,
      creditsAwarded: credits,
      status: 'completed',
      completedAt: new Date(),
    });

    await PaymentAuditService.logCreditsAwarded(
      'razorpay',
      userId,
      creditTransaction.id,
      credits,
      { packageName: pkg.name, amount: inrPrice }
    );

    try {
      await generateInvoiceForTransaction(creditTransaction.id);
      await emailService.sendPurchaseConfirmation(creditTransaction.id);
    } catch (emailError: any) {
      console.error(`❌ [Razorpay] Failed to send credits purchase confirmation email:`, emailError);
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

export async function handlePaymentFailed(
  payment: any
): Promise<HandlerResult> {
  const notes = payment.notes || {};
  const userId = notes.userId;

  if (!userId) {
    return { success: true, action: 'no_user_id' };
  }

  await PaymentAuditService.logPaymentFailed(
    'razorpay',
    userId,
    payment.error_description || 'Payment failed',
    { paymentId: payment.id }
  );

  try {
    const amount = (payment.amount / 100).toFixed(2);
    await emailService.sendPaymentFailed(userId, amount, payment.error_description || 'Payment failed');
  } catch (emailError: any) {
    console.error(`❌ [Razorpay] Failed to send payment failed email:`, emailError);
  }

  return { success: true, action: 'payment_failed', userId };
}

export async function handleRefundCreated(
  refund: any,
  payment: any
): Promise<HandlerResult> {
  const paymentId = payment?.id || refund.payment_id;
  
  if (!paymentId) {
    return { success: false, error: 'No payment ID in refund' };
  }

  const transaction = await storage.getPaymentTransactionByGatewayId('razorpay', paymentId);
  
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
    gateway: 'razorpay',
    gatewayRefundId: refund.id,
    reason: 'gateway_refund',
    initiatedBy: 'gateway',
    status: refund.status === 'processed' ? 'completed' : 'pending',
    creditsReversed: creditsReversed > 0 ? creditsReversed : undefined,
    metadata: {
      refundReason: refund.notes?.reason || 'external_refund',
    },
  });
  
  await storage.updatePaymentTransaction(transaction.id, { status: 'refunded' });

  await PaymentAuditService.logRefundCompleted(
    'razorpay',
    userId,
    transaction.id,
    refund.id,
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

export async function handleDispute(
  dispute: any,
  payment: any
): Promise<HandlerResult> {
  const paymentId = payment?.id || dispute.payment_id;
  
  if (!paymentId) {
    return { success: false, error: 'No payment ID in dispute' };
  }

  const transaction = await storage.getPaymentTransactionByGatewayId('razorpay', paymentId);
  
  if (!transaction) {
    return { success: false, error: 'Transaction not found for dispute' };
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
    gateway: 'razorpay',
    gatewayRefundId: dispute.id,
    reason: 'chargeback',
    initiatedBy: 'gateway',
    status: 'completed',
    creditsReversed: creditsReversed > 0 ? creditsReversed : undefined,
    metadata: {
      userSuspended: true,
      disputeReason: dispute.reason_code || 'unknown',
      disputeStatus: dispute.status,
    },
  });
  
  await storage.updatePaymentTransaction(transaction.id, { status: 'disputed' });
  await storage.updateUser(userId, { isActive: false });

  await PaymentAuditService.logDisputeOpened(
    'razorpay',
    userId,
    transaction.id,
    dispute.id,
    parseFloat(transaction.amount),
    transaction.currency,
    dispute.reason_code
  );
  
  try {
    await emailService.sendAccountSuspended(userId, `Chargeback dispute: ${dispute.reason_code || 'Unknown reason'}`);
  } catch (emailError: any) {
    console.error(`❌ [Razorpay] Failed to send account suspended email:`, emailError);
  }

  return { 
    success: true, 
    action: 'user_suspended_chargeback',
    userId,
    transactionId: transaction.id,
  };
}
