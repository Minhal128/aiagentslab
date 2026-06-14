'use strict';
/**
 * PayPal Webhook Event Handlers
 * Pure functions for processing webhook events
 */

import { storage } from '../../../../storage';
import { NotificationService } from '../../../../services/notification-service';
import { syncUserWithSubscription, applyPlanCredits } from '../../../../services/membership-service';
import { emailService } from '../../../../services/email-service';
import { generateInvoiceForTransaction } from '../../invoice-service';
import { PaymentAuditService } from '../../audit';
import { getPayPalCurrency, fetchPayPalSubscription } from './service';

export interface HandlerResult {
  success: boolean;
  action?: string;
  error?: string;
  userId?: string;
  transactionId?: string;
}

export async function handleSubscriptionActivated(
  subscriptionId: string,
  resource: any
): Promise<HandlerResult> {
  const allSubscriptions = await storage.getAllUserSubscriptions();
  const subscription = allSubscriptions.find(s => s.paypalSubscriptionId === subscriptionId);
  
  if (!subscription) {
    return { success: false, error: 'Subscription not found in database' };
  }

  const startDate = new Date();
  const endDate = new Date(startDate);
  if (subscription.billingPeriod === 'yearly') {
    endDate.setFullYear(endDate.getFullYear() + 1);
  } else {
    endDate.setMonth(endDate.getMonth() + 1);
  }

  await storage.updateUserSubscription(subscription.id, {
    status: 'active',
    currentPeriodStart: startDate,
    currentPeriodEnd: endDate,
    cancelAtPeriodEnd: false,
  });

  await syncUserWithSubscription(subscription.userId);

  const plan = subscription.planId ? await storage.getPlan(subscription.planId) : null;
  if (plan) {
    // Apply plan credits (e.g., 500 credits for Pro plan)
    await applyPlanCredits(
      subscription.userId,
      plan.id,
      'paypal',
      resource?.id || subscriptionId
    );

    const currencyConfig = await getPayPalCurrency();
    const price = (subscription.billingPeriod === 'yearly')
      ? plan.paypalYearlyPrice || plan.yearlyPrice
      : plan.paypalMonthlyPrice || plan.monthlyPrice;
    
    try {
      const newTransaction = await storage.createPaymentTransaction({
        userId: subscription.userId,
        type: 'subscription',
        gateway: 'paypal',
        gatewayTransactionId: resource?.id || subscriptionId,
        gatewaySubscriptionId: subscriptionId,
        amount: price ? price.toString() : '0',
        currency: currencyConfig.currency.toUpperCase(),
        planId: plan.id,
        subscriptionId: subscription.id,
        description: `${plan.displayName} Subscription`,
        billingPeriod: subscription.billingPeriod || 'monthly',
        status: 'completed',
        completedAt: new Date(),
      });

      await PaymentAuditService.logSubscriptionCreated(
        'paypal',
        subscription.userId,
        subscriptionId,
        plan.id,
        subscription.billingPeriod || 'monthly',
        { amount: price, currency: currencyConfig.currency }
      );

      try {
        await generateInvoiceForTransaction(newTransaction.id);
        await emailService.sendPurchaseConfirmation(newTransaction.id);
      } catch (emailError: any) {
        console.error(`❌ [PayPal] Failed to send purchase confirmation email:`, emailError);
      }

      return { 
        success: true, 
        action: 'subscription_activated',
        userId: subscription.userId,
        transactionId: newTransaction.id,
      };
    } catch (txError: any) {
      if (!txError.message?.includes('unique') && !txError.message?.includes('duplicate')) {
        throw txError;
      }
      return { success: true, action: 'subscription_already_processed', userId: subscription.userId };
    }
  }

  return { success: true, action: 'subscription_activated_no_plan', userId: subscription.userId };
}

export async function handleSubscriptionRenewed(
  subscriptionId: string,
  resource: any
): Promise<HandlerResult> {
  const allSubscriptions = await storage.getAllUserSubscriptions();
  const subscription = allSubscriptions.find(s => s.paypalSubscriptionId === subscriptionId);
  
  if (!subscription) {
    return { success: false, error: 'Subscription not found in database' };
  }

  const startDate = new Date();
  const endDate = new Date(startDate);
  if (subscription.billingPeriod === 'yearly') {
    endDate.setFullYear(endDate.getFullYear() + 1);
  } else {
    endDate.setMonth(endDate.getMonth() + 1);
  }

  await storage.updateUserSubscription(subscription.id, {
    status: 'active',
    currentPeriodStart: startDate,
    currentPeriodEnd: endDate,
    cancelAtPeriodEnd: false,
  });

  await syncUserWithSubscription(subscription.userId);

  const plan = subscription.planId ? await storage.getPlan(subscription.planId) : null;
  if (plan) {
    const currencyConfig = await getPayPalCurrency();
    const price = (subscription.billingPeriod === 'yearly')
      ? plan.paypalYearlyPrice || plan.yearlyPrice
      : plan.paypalMonthlyPrice || plan.monthlyPrice;
    
    try {
      const newTransaction = await storage.createPaymentTransaction({
        userId: subscription.userId,
        type: 'subscription',
        gateway: 'paypal',
        gatewayTransactionId: resource?.id || `${subscriptionId}_renewal_${Date.now()}`,
        gatewaySubscriptionId: subscriptionId,
        amount: price ? price.toString() : '0',
        currency: currencyConfig.currency.toUpperCase(),
        planId: plan.id,
        subscriptionId: subscription.id,
        description: `${plan.displayName} Subscription Renewal`,
        billingPeriod: subscription.billingPeriod || 'monthly',
        status: 'completed',
        completedAt: new Date(),
      });

      await PaymentAuditService.logSubscriptionRenewed(
        'paypal',
        subscription.userId,
        subscriptionId,
        parseFloat(price?.toString() || '0'),
        currencyConfig.currency
      );

      try {
        await generateInvoiceForTransaction(newTransaction.id);
        await emailService.sendPurchaseConfirmation(newTransaction.id);
      } catch (emailError: any) {
        console.error(`❌ [PayPal] Failed to send renewal email:`, emailError);
      }

      return { 
        success: true, 
        action: 'subscription_renewed',
        userId: subscription.userId,
        transactionId: newTransaction.id,
      };
    } catch (txError: any) {
      if (!txError.message?.includes('unique') && !txError.message?.includes('duplicate')) {
        throw txError;
      }
      return { success: true, action: 'renewal_already_processed', userId: subscription.userId };
    }
  }

  return { success: true, action: 'subscription_renewed_no_plan', userId: subscription.userId };
}

export async function handleSubscriptionCancelled(
  subscriptionId: string
): Promise<HandlerResult> {
  const allSubscriptions = await storage.getAllUserSubscriptions();
  const subscription = allSubscriptions.find(s => s.paypalSubscriptionId === subscriptionId);
  
  if (!subscription) {
    return { success: false, error: 'Subscription not found in database' };
  }

  const freePlan = await storage.getPlanByName('free');
  if (freePlan) {
    await storage.updateUserSubscription(subscription.id, {
      planId: freePlan.id,
      status: 'cancelled',
      paypalSubscriptionId: null,
    });
    await syncUserWithSubscription(subscription.userId);
  }

  await PaymentAuditService.logSubscriptionCancelled(
    'paypal',
    subscription.userId,
    subscriptionId,
    false,
    { reason: 'subscription_cancelled_via_webhook' }
  );

  return { success: true, action: 'subscription_cancelled', userId: subscription.userId };
}

export async function handlePaymentFailed(
  subscriptionId: string,
  resource: any
): Promise<HandlerResult> {
  const allSubscriptions = await storage.getAllUserSubscriptions();
  const subscription = allSubscriptions.find(s => s.paypalSubscriptionId === subscriptionId);
  
  if (!subscription) {
    return { success: false, error: 'Subscription not found in database' };
  }

  await NotificationService.notifyPaymentFailed(subscription.userId);

  await PaymentAuditService.logPaymentFailed(
    'paypal',
    subscription.userId,
    'Subscription payment failed',
    { subscriptionId }
  );

  try {
    const failedAmount = resource?.billing_info?.last_payment?.amount?.value || '0';
    await emailService.sendPaymentFailed(subscription.userId, failedAmount, 'Subscription payment failed');
  } catch (emailError: any) {
    console.error(`❌ [PayPal] Failed to send payment failed email:`, emailError);
  }

  return { success: true, action: 'payment_failed_notified', userId: subscription.userId };
}

export async function handleCaptureCompleted(
  captureId: string,
  resource: any
): Promise<HandlerResult> {
  console.log(`📥 [PayPal] Payment capture completed: ${captureId}`);
  return { success: true, action: 'capture_completed' };
}

export async function handleCaptureRefunded(
  captureId: string,
  resource: any,
  eventId: string
): Promise<HandlerResult> {
  console.log(`🔄 [PayPal] External refund received for capture: ${captureId}`);
  
  const transaction = await storage.getPaymentTransactionByGatewayId('paypal', captureId);
  
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
    console.log(`🔄 [PayPal] Reversed ${creditsReversed} credits for user ${userId}`);
  }
  
  const refundAmount = resource?.amount?.value || transaction.amount;
  await storage.createRefund({
    transactionId: transaction.id,
    userId,
    amount: refundAmount.toString(),
    currency: resource?.amount?.currency_code || transaction.currency,
    gateway: 'paypal',
    gatewayRefundId: eventId || `paypal_refund_${captureId}`,
    reason: 'gateway_refund',
    initiatedBy: 'gateway',
    status: 'completed',
    creditsReversed: creditsReversed > 0 ? creditsReversed : undefined,
    metadata: {
      userSuspended: false,
      refundReason: 'external_refund',
    },
  });
  
  await storage.updatePaymentTransaction(transaction.id, { status: 'refunded' });

  await PaymentAuditService.logRefundCompleted(
    'paypal',
    userId,
    transaction.id,
    eventId || `paypal_refund_${captureId}`,
    parseFloat(refundAmount),
    transaction.currency
  );

  return { 
    success: true, 
    action: 'external_refund_processed',
    userId,
    transactionId: transaction.id,
  };
}

export async function handleDisputeCreated(
  disputeId: string,
  resource: any
): Promise<HandlerResult> {
  console.log(`🚨 [PayPal] Dispute created: ${disputeId}`);
  
  const disputedTransaction = resource?.disputed_transactions?.[0];
  const captureId = disputedTransaction?.seller_transaction_id || disputedTransaction?.buyer_transaction_id;
  
  if (!captureId) {
    return { success: false, error: 'No capture ID in dispute' };
  }

  const transaction = await storage.getPaymentTransactionByGatewayId('paypal', captureId);
  
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
    console.log(`🔄 [PayPal] Reversed ${creditsReversed} credits for user ${userId}`);
  }
  
  const disputeAmount = resource?.dispute_amount?.value || disputedTransaction?.gross_amount?.value || transaction.amount;
  await storage.createRefund({
    transactionId: transaction.id,
    userId,
    amount: disputeAmount.toString(),
    currency: resource?.dispute_amount?.currency_code || transaction.currency,
    gateway: 'paypal',
    gatewayRefundId: disputeId,
    reason: 'chargeback',
    initiatedBy: 'gateway',
    status: 'completed',
    creditsReversed: creditsReversed > 0 ? creditsReversed : undefined,
    metadata: {
      userSuspended: true,
      disputeReason: resource?.reason || 'unknown',
      disputeStatus: resource?.status,
      disputeLifeCycleStage: resource?.dispute_life_cycle_stage,
    },
  });
  
  await storage.updatePaymentTransaction(transaction.id, { status: 'refunded' });
  await storage.updateUser(userId, { isActive: false });

  await PaymentAuditService.logDisputeOpened(
    'paypal',
    userId,
    transaction.id,
    disputeId,
    parseFloat(disputeAmount),
    transaction.currency,
    resource?.reason
  );

  try {
    await emailService.sendAccountSuspended(userId, `Chargeback dispute: ${resource?.reason || 'Unknown reason'}`);
  } catch (emailError: any) {
    console.error(`❌ [PayPal] Failed to send account suspended email:`, emailError);
  }

  console.log(`⛔ [PayPal] User ${userId} suspended due to chargeback. Dispute ID: ${disputeId}, Reason: ${resource?.reason}`);

  return { 
    success: true, 
    action: 'user_suspended_chargeback',
    userId,
    transactionId: transaction.id,
  };
}

export async function handleCreditsPayment(
  orderId: string,
  captureId: string,
  metadata: { userId: string; packageId: string; credits: number }
): Promise<HandlerResult> {
  const pkg = await storage.getCreditPackage(metadata.packageId);
  if (!pkg) {
    return { success: false, error: 'Package not found' };
  }

  try {
    await storage.addCreditsAtomic(
      metadata.userId,
      metadata.credits,
      `Purchased ${pkg.name} via PayPal`,
      `paypal_${captureId}`
    );
    
    const currencyConfig = await getPayPalCurrency();
    
    const newTransaction = await storage.createPaymentTransaction({
      userId: metadata.userId,
      type: 'credits',
      gateway: 'paypal',
      gatewayTransactionId: captureId || orderId,
      amount: pkg.paypalPrice ? pkg.paypalPrice.toString() : pkg.price.toString(),
      currency: currencyConfig.currency.toUpperCase(),
      creditPackageId: metadata.packageId,
      description: `${pkg.name} - ${metadata.credits} Credits`,
      creditsAwarded: metadata.credits,
      status: 'completed',
      completedAt: new Date(),
    });

    await PaymentAuditService.logCreditsAwarded(
      'paypal',
      metadata.userId,
      newTransaction.id,
      metadata.credits,
      { packageName: pkg.name }
    );

    try {
      await generateInvoiceForTransaction(newTransaction.id);
      await emailService.sendPurchaseConfirmation(newTransaction.id);
    } catch (emailError: any) {
      console.error(`❌ [PayPal] Failed to send purchase confirmation:`, emailError);
    }

    return { 
      success: true, 
      action: 'credits_awarded',
      userId: metadata.userId,
      transactionId: newTransaction.id,
    };
  } catch (error: any) {
    if (error.message?.includes('unique') || error.message?.includes('duplicate')) {
      return { success: true, action: 'credits_already_processed', userId: metadata.userId };
    }
    throw error;
  }
}
