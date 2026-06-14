'use strict';
/**
 * Razorpay Service
 * Client factory, configuration loaders, and utility functions
 *
 * Client singleton is managed by the legacy service to avoid split-brain.
 */

import Razorpay from 'razorpay';
import crypto from 'crypto';
import { storage } from '../../../../storage';
import { PaymentError } from '../../../../utils/errors';
import { GLOBAL_SETTINGS_KEYS, getCurrencySymbol } from '../../types';

export {
  getRazorpayClient,
  resetRazorpayClient,
} from '../../../../services/razorpay-service';

import { getRazorpayClient } from '../../../../services/razorpay-service';

async function getSetting(key: string): Promise<any> {
  const setting = await storage.getGlobalSetting(key);
  return setting?.value ?? null;
}

export async function isRazorpayConfigured(): Promise<boolean> {
  const dbKeyId = await getSetting(GLOBAL_SETTINGS_KEYS.RAZORPAY_KEY_ID);
  const dbKeySecret = await getSetting(GLOBAL_SETTINGS_KEYS.RAZORPAY_KEY_SECRET);
  const envKeyId = process.env.RAZORPAY_KEY_ID;
  const envKeySecret = process.env.RAZORPAY_KEY_SECRET;
  
  return !!((dbKeyId && dbKeySecret) || (envKeyId && envKeySecret));
}

export async function isRazorpayEnabled(): Promise<boolean> {
  const isConfigured = await isRazorpayConfigured();
  if (!isConfigured) return false;
  
  const enabled = await getSetting(GLOBAL_SETTINGS_KEYS.RAZORPAY_ENABLED);
  return enabled === true || enabled === 'true';
}

export async function getRazorpayKeyId(): Promise<string | null> {
  const dbKey = await getSetting(GLOBAL_SETTINGS_KEYS.RAZORPAY_KEY_ID);
  const envKey = process.env.RAZORPAY_KEY_ID;
  return dbKey || envKey || null;
}

export async function getRazorpayWebhookSecret(): Promise<string | null> {
  const dbSecret = await getSetting(GLOBAL_SETTINGS_KEYS.RAZORPAY_WEBHOOK_SECRET);
  const envSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  return dbSecret || envSecret || null;
}

export interface RazorpayCurrencyConfig {
  currency: string;
  currencyLocked: boolean;
  symbol: string;
}

export function getSupportedCurrencies(): Array<{ code: string; symbol: string; name: string }> {
  return [
    { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
    { code: 'USD', symbol: '$', name: 'US Dollar' },
    { code: 'EUR', symbol: '€', name: 'Euro' },
    { code: 'GBP', symbol: '£', name: 'British Pound' },
    { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar' },
    { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham' },
    { code: 'MYR', symbol: 'RM', name: 'Malaysian Ringgit' },
  ];
}

export async function getRazorpayCurrency(): Promise<RazorpayCurrencyConfig> {
  const currency = 'INR';
  
  return {
    currency: currency.toUpperCase(),
    currencyLocked: true,
    symbol: getCurrencySymbol(currency),
  };
}

export async function testRazorpayConnection(): Promise<{ success: boolean; error?: string }> {
  try {
    const razorpay = await getRazorpayClient();
    if (!razorpay) {
      return { success: false, error: 'Razorpay not configured' };
    }
    
    await razorpay.plans.all({ count: 1 });
    return { success: true };
  } catch (error: any) {
    const paymentError = new PaymentError(
      'razorpay',
      `Razorpay connection test failed: ${error.message}`,
      undefined,
      { operation: 'testConnection' }
    );
    console.error('❌ [Razorpay] Connection test failed:', paymentError.message);
    return { success: false, error: paymentError.message };
  }
}

export async function getRazorpayConfig(): Promise<{
  enabled: boolean;
  configured: boolean;
  keyId: string | null;
  currency: RazorpayCurrencyConfig;
}> {
  const [enabled, configured, keyId, currency] = await Promise.all([
    isRazorpayEnabled(),
    isRazorpayConfigured(),
    getRazorpayKeyId(),
    getRazorpayCurrency(),
  ]);
  
  return {
    enabled,
    configured,
    keyId: enabled ? keyId : null,
    currency,
  };
}

export async function getActivePaymentGateway(): Promise<'stripe' | 'razorpay'> {
  const gateway = await getSetting('payment_gateway');
  return gateway === 'razorpay' ? 'razorpay' : 'stripe';
}

export interface RazorpayPlanOptions {
  period: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  name: string;
  amount: number;
  currency?: string;
  description?: string;
  notes?: Record<string, string>;
}

export async function createRazorpayPlan(options: RazorpayPlanOptions): Promise<any> {
  const razorpay = await getRazorpayClient();
  if (!razorpay) {
    throw new PaymentError('razorpay', 'Razorpay not configured', undefined, { operation: 'createPlan' });
  }
  
  const currency = options.currency || 'INR';
  
  const plan = await razorpay.plans.create({
    period: options.period,
    interval: options.interval,
    item: {
      name: options.name,
      amount: Math.round(options.amount * 100),
      currency: currency,
      description: options.description || options.name,
    },
    notes: options.notes || {},
  });
  
  console.log(`✅ [Razorpay] Created plan ${plan.id} for ${options.name}`);
  return plan;
}

export async function fetchRazorpayPlan(planId: string): Promise<any> {
  const razorpay = await getRazorpayClient();
  if (!razorpay) {
    throw new PaymentError('razorpay', 'Razorpay not configured', undefined, { operation: 'fetchPlan', planId });
  }
  
  return razorpay.plans.fetch(planId);
}

export interface RazorpaySubscriptionOptions {
  planId: string;
  totalCount?: number;
  customerNotify?: boolean;
  notes?: Record<string, string>;
  notifyInfo?: {
    notifyPhone?: string;
    notifyEmail?: string;
  };
}

export async function createRazorpaySubscription(options: RazorpaySubscriptionOptions): Promise<any> {
  const razorpay = await getRazorpayClient();
  if (!razorpay) {
    throw new PaymentError('razorpay', 'Razorpay not configured', undefined, { operation: 'createSubscription', planId: options.planId });
  }
  
  const subscriptionOptions: any = {
    plan_id: options.planId,
    total_count: options.totalCount || 12,
    customer_notify: options.customerNotify !== false ? 1 : 0,
    notes: options.notes || {},
  };
  
  if (options.notifyInfo) {
    subscriptionOptions.notify_info = {
      notify_phone: options.notifyInfo.notifyPhone,
      notify_email: options.notifyInfo.notifyEmail,
    };
  }
  
  const subscription = await razorpay.subscriptions.create(subscriptionOptions);
  console.log(`✅ [Razorpay] Created subscription ${subscription.id}`);
  return subscription;
}

export async function fetchRazorpaySubscription(subscriptionId: string): Promise<any> {
  const razorpay = await getRazorpayClient();
  if (!razorpay) {
    throw new PaymentError('razorpay', 'Razorpay not configured', undefined, { operation: 'fetchSubscription', subscriptionId });
  }
  
  return razorpay.subscriptions.fetch(subscriptionId);
}

export async function cancelRazorpaySubscription(
  subscriptionId: string, 
  cancelAtCycleEnd: boolean = true
): Promise<any> {
  const razorpay = await getRazorpayClient();
  if (!razorpay) {
    throw new PaymentError('razorpay', 'Razorpay not configured', undefined, { operation: 'cancelSubscription', subscriptionId });
  }
  
  const subscription = await razorpay.subscriptions.cancel(subscriptionId, cancelAtCycleEnd);
  console.log(`✅ [Razorpay] Cancelled subscription ${subscriptionId}`);
  return subscription;
}

export interface RazorpayOrderOptions {
  amount: number;
  currency?: string;
  receipt: string;
  notes?: Record<string, string>;
}

export async function createRazorpayOrder(options: RazorpayOrderOptions): Promise<any> {
  const razorpay = await getRazorpayClient();
  if (!razorpay) {
    throw new PaymentError('razorpay', 'Razorpay not configured', undefined, { operation: 'createOrder', receipt: options.receipt });
  }
  
  const currency = options.currency || 'INR';
  
  const order = await razorpay.orders.create({
    amount: Math.round(options.amount * 100),
    currency: currency,
    receipt: options.receipt,
    notes: options.notes || {},
  });
  
  console.log(`✅ [Razorpay] Created order ${order.id}`);
  return order;
}

export async function fetchRazorpayOrder(orderId: string): Promise<any> {
  const razorpay = await getRazorpayClient();
  if (!razorpay) {
    throw new PaymentError('razorpay', 'Razorpay not configured', undefined, { operation: 'fetchOrder', orderId });
  }
  
  return razorpay.orders.fetch(orderId);
}

export async function fetchRazorpayPayment(paymentId: string): Promise<any> {
  const razorpay = await getRazorpayClient();
  if (!razorpay) {
    throw new PaymentError('razorpay', 'Razorpay not configured', paymentId, { operation: 'fetchPayment' });
  }
  
  return razorpay.payments.fetch(paymentId);
}

export async function verifyPaymentSignature(params: {
  razorpay_order_id?: string;
  razorpay_subscription_id?: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}): Promise<boolean> {
  const keySecret = await getSetting(GLOBAL_SETTINGS_KEYS.RAZORPAY_KEY_SECRET) || process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) {
    throw new PaymentError('razorpay', 'Razorpay key secret not configured', undefined, { operation: 'verifyPaymentSignature' });
  }
  
  let expectedSignature: string;
  
  if (params.razorpay_subscription_id) {
    const body = params.razorpay_payment_id + '|' + params.razorpay_subscription_id;
    expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(body)
      .digest('hex');
  } else if (params.razorpay_order_id) {
    const body = params.razorpay_order_id + '|' + params.razorpay_payment_id;
    expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(body)
      .digest('hex');
  } else {
    throw new PaymentError('razorpay', 'Either razorpay_order_id or razorpay_subscription_id is required', params.razorpay_payment_id, { operation: 'verifyPaymentSignature' });
  }
  
  const isValid = expectedSignature === params.razorpay_signature;
  
  if (isValid) {
    console.log(`✅ [Razorpay] Payment signature verified for payment ${params.razorpay_payment_id}`);
  } else {
    console.error(`❌ [Razorpay] Payment signature verification failed for payment ${params.razorpay_payment_id}`);
  }
  
  return isValid;
}

export async function verifyWebhookSignature(
  body: string,
  signature: string
): Promise<boolean> {
  const webhookSecret = await getRazorpayWebhookSecret();
  if (!webhookSecret) {
    console.warn('⚠️ [Razorpay] Webhook secret not configured - rejecting webhook for security');
    return false;
  }
  
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(body)
    .digest('hex');
  
  const isValid = expectedSignature === signature;
  if (isValid) {
    console.log('✅ [Razorpay] Webhook signature verified');
  } else {
    console.warn('⚠️ [Razorpay] Webhook signature verification failed');
  }
  
  return isValid;
}

export async function captureRazorpayPayment(paymentId: string, amount: number, currency: string = 'INR'): Promise<any> {
  const razorpay = await getRazorpayClient();
  if (!razorpay) {
    throw new PaymentError('razorpay', 'Razorpay not configured', paymentId, { operation: 'capturePayment', amount, currency });
  }
  
  return razorpay.payments.capture(paymentId, Math.round(amount * 100), currency);
}

export async function initiateRefund(
  transactionId: string,
  reason?: string,
  adminId?: string
): Promise<{ success: boolean; refundId?: string; error?: string }> {
  try {
    const razorpay = await getRazorpayClient();
    if (!razorpay) {
      return { success: false, error: 'Razorpay not configured' };
    }

    const transaction = await storage.getPaymentTransaction(transactionId);
    if (!transaction) {
      return { success: false, error: 'Transaction not found' };
    }

    if (transaction.gateway !== 'razorpay') {
      return { success: false, error: 'Transaction is not a Razorpay payment' };
    }

    if (transaction.status === 'refunded') {
      return { success: false, error: 'Transaction already refunded' };
    }

    const refund = await razorpay.payments.refund(transaction.gatewayTransactionId!, {
      notes: {
        transactionId,
        adminId: adminId || 'system',
        reason: reason || 'Admin initiated refund',
      },
    });

    const user = await storage.getUser(transaction.userId);
    let creditsReversed = 0;
    if (transaction.type === 'credits' && transaction.creditsAwarded && user) {
      creditsReversed = transaction.creditsAwarded;
      const newCredits = Math.max(0, user.credits - creditsReversed);
      await storage.updateUserCredits(transaction.userId, newCredits);
    }

    await storage.createRefund({
      transactionId: transaction.id,
      userId: transaction.userId,
      amount: transaction.amount,
      currency: transaction.currency,
      gateway: 'razorpay',
      gatewayRefundId: refund.id,
      reason: reason || 'admin_initiated',
      initiatedBy: adminId ? 'admin' : 'system',
      adminId,
      status: 'completed',
      creditsReversed: creditsReversed > 0 ? creditsReversed : undefined,
    });

    await storage.updatePaymentTransaction(transactionId, { status: 'refunded' });

    return { success: true, refundId: refund.id };
  } catch (error: any) {
    console.error('❌ [Razorpay] Refund failed:', error);
    return { success: false, error: error.message };
  }
}
