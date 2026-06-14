'use strict';
/**
 * MercadoPago Webhook Event Handlers
 * Pure functions for processing webhook events
 */

import { storage } from '../../../../storage';
import { NotificationService } from '../../../../services/notification-service';
import { syncUserWithSubscription, applyPlanCredits } from '../../../../services/membership-service';
import { emailService } from '../../../../services/email-service';
import { generateInvoiceForTransaction } from '../../invoice-service';
import { PaymentAuditService } from '../../audit';
import { getMercadoPagoCurrency, fetchMercadoPagoPayment, fetchMercadoPagoSubscription } from './service';

export interface HandlerResult {
  success: boolean;
  action?: string;
  error?: string;
  userId?: string;
  transactionId?: string;
}

export async function handlePaymentApproved(
  paymentId: string | number,
  externalReference: string
): Promise<HandlerResult> {
  let metadata;
  try {
    metadata = JSON.parse(externalReference);
  } catch {
    return { success: false, error: 'Invalid external reference' };
  }

  if (metadata.type === 'credits') {
    const pkg = await storage.getCreditPackage(metadata.packageId);
    if (!pkg) {
      return { success: false, error: 'Package not found' };
    }

    try {
      await storage.addCreditsAtomic(
        metadata.userId,
        metadata.credits,
        `Purchased ${pkg.name} via MercadoPago`,
        `mercadopago_${paymentId}`
      );
      
      const currencyConfig = await getMercadoPagoCurrency();
      const payment = await fetchMercadoPagoPayment(paymentId);
      const amount = payment.transaction_amount ? payment.transaction_amount.toString() : '0';
      
      const newTransaction = await storage.createPaymentTransaction({
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

      await PaymentAuditService.logCreditsAwarded(
        'mercadopago',
        metadata.userId,
        newTransaction.id,
        metadata.credits,
        { packageName: pkg.name }
      );

      try {
        await generateInvoiceForTransaction(newTransaction.id);
        await emailService.sendPurchaseConfirmation(newTransaction.id);
      } catch (emailError: any) {
        console.error(`❌ [MercadoPago] Failed to send purchase confirmation:`, emailError);
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

  return { success: true, action: 'payment_processed' };
}

export async function handleSubscriptionAuthorized(
  preapprovalId: string
): Promise<HandlerResult> {
  const allSubscriptions = await storage.getAllUserSubscriptions();
  const subscription = allSubscriptions.find(s => s.mercadopagoSubscriptionId === preapprovalId);
  
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
      'mercadopago',
      preapprovalId
    );
    const currencyConfig = await getMercadoPagoCurrency();
    const price = (subscription.billingPeriod === 'yearly')
      ? plan.mercadopagoYearlyPrice || plan.yearlyPrice
      : plan.mercadopagoMonthlyPrice || plan.monthlyPrice;
    
    try {
      const newTransaction = await storage.createPaymentTransaction({
        userId: subscription.userId,
        type: 'subscription',
        gateway: 'mercadopago',
        gatewayTransactionId: preapprovalId,
        gatewaySubscriptionId: preapprovalId,
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
        'mercadopago',
        subscription.userId,
        preapprovalId,
        parseFloat(price?.toString() || '0'),
        currencyConfig.currency
      );

      try {
        await generateInvoiceForTransaction(newTransaction.id);
        await emailService.sendPurchaseConfirmation(newTransaction.id);
      } catch (emailError: any) {
        console.error(`❌ [MercadoPago] Failed to send renewal email:`, emailError);
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
  preapprovalId: string
): Promise<HandlerResult> {
  const allSubscriptions = await storage.getAllUserSubscriptions();
  const subscription = allSubscriptions.find(s => s.mercadopagoSubscriptionId === preapprovalId);
  
  if (!subscription) {
    return { success: false, error: 'Subscription not found in database' };
  }

  const freePlan = await storage.getPlanByName('free');
  if (freePlan) {
    await storage.updateUserSubscription(subscription.id, {
      planId: freePlan.id,
      status: 'cancelled',
      mercadopagoSubscriptionId: null,
    });
    await syncUserWithSubscription(subscription.userId);
  }

  await PaymentAuditService.logSubscriptionCancelled(
    'mercadopago',
    subscription.userId,
    preapprovalId,
    false,
    { reason: 'subscription_cancelled_via_webhook' }
  );

  return { success: true, action: 'subscription_cancelled', userId: subscription.userId };
}

export async function handlePaymentFailed(
  preapprovalId: string
): Promise<HandlerResult> {
  const allSubscriptions = await storage.getAllUserSubscriptions();
  const subscription = allSubscriptions.find(s => s.mercadopagoSubscriptionId === preapprovalId);
  
  if (!subscription) {
    return { success: false, error: 'Subscription not found in database' };
  }

  await NotificationService.notifyPaymentFailed(subscription.userId);

  await PaymentAuditService.logPaymentFailed(
    'mercadopago',
    subscription.userId,
    'Subscription payment failed',
    { preapprovalId }
  );

  try {
    await emailService.sendPaymentFailed(subscription.userId, '0', 'Subscription payment failed');
  } catch (emailError: any) {
    console.error(`❌ [MercadoPago] Failed to send payment failed email:`, emailError);
  }

  return { success: true, action: 'payment_failed_notified', userId: subscription.userId };
}

export async function handleRefundProcessed(
  paymentId: string | number,
  refundData: any
): Promise<HandlerResult> {
  console.log(`🔄 [MercadoPago] Refund received for payment: ${paymentId}`);
  
  const transaction = await storage.getPaymentTransactionByGatewayId('mercadopago', paymentId.toString());
  
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
    console.log(`🔄 [MercadoPago] Reversed ${creditsReversed} credits for user ${userId}`);
  }
  
  const refundAmount = refundData?.amount || transaction.amount;
  await storage.createRefund({
    transactionId: transaction.id,
    userId,
    amount: refundAmount.toString(),
    currency: transaction.currency,
    gateway: 'mercadopago',
    gatewayRefundId: `mercadopago_refund_${paymentId}`,
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
    'mercadopago',
    userId,
    transaction.id,
    `mercadopago_refund_${paymentId}`,
    parseFloat(refundAmount.toString()),
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
  paymentId: string | number,
  disputeReason: string
): Promise<HandlerResult> {
  console.log(`🚨 [MercadoPago] Dispute created: ${disputeId} for payment: ${paymentId}`);
  
  const transaction = await storage.getPaymentTransactionByGatewayId('mercadopago', paymentId.toString());
  
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
    console.log(`🔄 [MercadoPago] Reversed ${creditsReversed} credits for user ${userId}`);
  }
  
  await storage.createRefund({
    transactionId: transaction.id,
    userId,
    amount: transaction.amount,
    currency: transaction.currency,
    gateway: 'mercadopago',
    gatewayRefundId: disputeId,
    reason: 'chargeback',
    initiatedBy: 'gateway',
    status: 'completed',
    creditsReversed: creditsReversed > 0 ? creditsReversed : undefined,
    metadata: {
      userSuspended: true,
      disputeReason,
    },
  });
  
  await storage.updatePaymentTransaction(transaction.id, { status: 'refunded' });
  await storage.updateUser(userId, { isActive: false });

  await PaymentAuditService.logDisputeOpened(
    'mercadopago',
    userId,
    transaction.id,
    disputeId,
    parseFloat(transaction.amount),
    transaction.currency,
    disputeReason
  );

  try {
    await emailService.sendAccountSuspended(userId, `Chargeback dispute: ${disputeReason}`);
  } catch (emailError: any) {
    console.error(`❌ [MercadoPago] Failed to send account suspended email:`, emailError);
  }

  console.log(`⛔ [MercadoPago] User ${userId} suspended due to chargeback. Dispute ID: ${disputeId}`);

  return {
    success: true,
    action: 'user_suspended_chargeback',
    userId,
    transactionId: transaction.id,
  };
}

export async function handleCreditsPayment(
  paymentId: string,
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
      `Purchased ${pkg.name} via MercadoPago`,
      `mercadopago_${paymentId}`
    );
    
    const currencyConfig = await getMercadoPagoCurrency();
    const payment = await fetchMercadoPagoPayment(paymentId);
    const amount = payment.transaction_amount ? payment.transaction_amount.toString() : '0';
    
    const newTransaction = await storage.createPaymentTransaction({
      userId: metadata.userId,
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
      metadata.userId,
      newTransaction.id,
      metadata.credits,
      { packageName: pkg.name }
    );

    try {
      await generateInvoiceForTransaction(newTransaction.id);
      await emailService.sendPurchaseConfirmation(newTransaction.id);
    } catch (emailError: any) {
      console.error(`❌ [MercadoPago] Failed to send purchase confirmation:`, emailError);
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
