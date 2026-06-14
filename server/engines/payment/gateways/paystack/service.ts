'use strict';
/**
 * Paystack Service
 * Client factory, configuration loaders, and utility functions
 */

import Paystack from '@paystack/paystack-sdk';
import crypto from 'crypto';
import { storage } from '../../../../storage';
import { PaymentError } from '../../../../utils/errors';
import { GLOBAL_SETTINGS_KEYS, getCurrencySymbol } from '../../types';

let paystackInstance: Paystack | null = null;

async function getSetting(key: string): Promise<any> {
  const setting = await storage.getGlobalSetting(key);
  return setting?.value ?? null;
}

export async function getPaystackClient(): Promise<Paystack | null> {
  const dbSecretKey = await getSetting(GLOBAL_SETTINGS_KEYS.PAYSTACK_SECRET_KEY);
  const secretKey = dbSecretKey || process.env.PAYSTACK_SECRET_KEY;
  
  if (!secretKey) {
    return null;
  }
  
  if (!paystackInstance) {
    paystackInstance = new Paystack(secretKey);
  }
  
  return paystackInstance;
}

export function resetPaystackClient(): void {
  paystackInstance = null;
}

export async function isPaystackConfigured(): Promise<boolean> {
  const dbSecretKey = await getSetting(GLOBAL_SETTINGS_KEYS.PAYSTACK_SECRET_KEY);
  const envSecretKey = process.env.PAYSTACK_SECRET_KEY;
  
  return !!(dbSecretKey || envSecretKey);
}

export async function isPaystackEnabled(): Promise<boolean> {
  const isConfigured = await isPaystackConfigured();
  if (!isConfigured) return false;
  
  const enabled = await getSetting(GLOBAL_SETTINGS_KEYS.PAYSTACK_ENABLED);
  return enabled === true || enabled === 'true';
}

export async function getPaystackPublicKey(): Promise<string | null> {
  const dbKey = await getSetting(GLOBAL_SETTINGS_KEYS.PAYSTACK_PUBLIC_KEY);
  const envKey = process.env.PAYSTACK_PUBLIC_KEY;
  return dbKey || envKey || null;
}

export async function getPaystackWebhookSecret(): Promise<string | null> {
  const dbSecret = await getSetting(GLOBAL_SETTINGS_KEYS.PAYSTACK_WEBHOOK_SECRET);
  const envSecret = process.env.PAYSTACK_WEBHOOK_SECRET;
  return dbSecret || envSecret || null;
}

export interface PaystackCurrencyConfig {
  currency: string;
  currencyLocked: boolean;
  symbol: string;
}

export function getSupportedCurrencies(): Array<{ code: string; symbol: string; name: string }> {
  return [
    { code: 'NGN', symbol: '₦', name: 'Nigerian Naira' },
    { code: 'GHS', symbol: '₵', name: 'Ghanaian Cedi' },
    { code: 'ZAR', symbol: 'R', name: 'South African Rand' },
    { code: 'KES', symbol: 'KSh', name: 'Kenyan Shilling' },
    { code: 'USD', symbol: '$', name: 'US Dollar' },
  ];
}

export async function getPaystackCurrency(): Promise<PaystackCurrencyConfig> {
  const currency = await getSetting(GLOBAL_SETTINGS_KEYS.PAYSTACK_CURRENCY) || 'NGN';
  
  return {
    currency: currency.toUpperCase(),
    currencyLocked: false,
    symbol: getCurrencySymbol(currency),
  };
}

export async function testPaystackConnection(): Promise<{ success: boolean; error?: string }> {
  try {
    const paystack = await getPaystackClient();
    if (!paystack) {
      return { success: false, error: 'Paystack not configured' };
    }
    
    const response = await paystack.transaction.list({ perPage: 1 });
    return { success: response.status === true };
  } catch (error: any) {
    const paymentError = new PaymentError(
      'paystack',
      `Paystack connection test failed: ${error.message}`,
      undefined,
      { operation: 'testConnection' }
    );
    console.error('❌ [Paystack] Connection test failed:', paymentError.message);
    return { success: false, error: paymentError.message };
  }
}

export async function getPaystackConfig(): Promise<{
  enabled: boolean;
  configured: boolean;
  publicKey: string | null;
  currency: PaystackCurrencyConfig;
}> {
  const [enabled, configured, publicKey, currency] = await Promise.all([
    isPaystackEnabled(),
    isPaystackConfigured(),
    getPaystackPublicKey(),
    getPaystackCurrency(),
  ]);
  
  return {
    enabled,
    configured,
    publicKey: enabled ? publicKey : null,
    currency,
  };
}

export interface PaystackPlanOptions {
  name: string;
  amount: number;
  interval: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'biannually' | 'annually';
  currency?: string;
  description?: string;
  invoice_limit?: number;
}

export async function createPaystackPlan(options: PaystackPlanOptions): Promise<any> {
  const paystack = await getPaystackClient();
  if (!paystack) {
    throw new PaymentError('paystack', 'Paystack not configured', undefined, { operation: 'createPlan' });
  }
  
  const currency = options.currency || 'NGN';
  
  const plan = await paystack.plan.create({
    name: options.name,
    amount: Math.round(options.amount * 100).toString(),
    interval: options.interval as any,
    currency: currency,
    description: options.description,
    invoice_limit: options.invoice_limit,
  });
  
  if (plan.status && plan.data) {
    console.log(`✅ [Paystack] Created plan ${plan.data.plan_code} for ${options.name}`);
    return plan.data;
  }
  
  throw new PaymentError('paystack', `Failed to create plan: ${plan.message}`, undefined, { operation: 'createPlan' });
}

export async function fetchPaystackPlan(planCode: string): Promise<any> {
  const paystack = await getPaystackClient();
  if (!paystack) {
    throw new PaymentError('paystack', 'Paystack not configured', undefined, { operation: 'fetchPlan', planCode });
  }
  
  const response = await paystack.plan.fetch(planCode);
  if (response.status && response.data) {
    return response.data;
  }
  
  throw new PaymentError('paystack', `Failed to fetch plan: ${response.message}`, undefined, { operation: 'fetchPlan', planCode });
}

export interface PaystackSubscriptionOptions {
  customer: string;
  plan: string;
  authorization?: string;
  start_date?: Date;
}

export async function createPaystackSubscription(options: PaystackSubscriptionOptions): Promise<any> {
  const paystack = await getPaystackClient();
  if (!paystack) {
    throw new PaymentError('paystack', 'Paystack not configured', undefined, { operation: 'createSubscription', planCode: options.plan });
  }
  
  const subscription = await paystack.subscription.create({
    customer: options.customer,
    plan: options.plan,
    authorization: options.authorization,
    start_date: options.start_date?.toISOString(),
  } as any);
  
  if (subscription.status && subscription.data) {
    console.log(`✅ [Paystack] Created subscription ${subscription.data.subscription_code}`);
    return subscription.data;
  }
  
  throw new PaymentError('paystack', `Failed to create subscription: ${subscription.message}`, undefined, { operation: 'createSubscription' });
}

export async function fetchPaystackSubscription(subscriptionCode: string): Promise<any> {
  const paystack = await getPaystackClient();
  if (!paystack) {
    throw new PaymentError('paystack', 'Paystack not configured', undefined, { operation: 'fetchSubscription', subscriptionCode });
  }
  
  const response = await paystack.subscription.fetch(subscriptionCode);
  if (response.status && response.data) {
    return response.data;
  }
  
  throw new PaymentError('paystack', `Failed to fetch subscription: ${response.message}`, undefined, { operation: 'fetchSubscription', subscriptionCode });
}

export async function enablePaystackSubscription(
  subscriptionCode: string,
  emailToken: string
): Promise<any> {
  const paystack = await getPaystackClient();
  if (!paystack) {
    throw new PaymentError('paystack', 'Paystack not configured', undefined, { operation: 'enableSubscription', subscriptionCode });
  }
  
  const response = await paystack.subscription.enable({
    code: subscriptionCode,
    token: emailToken,
  });
  
  if (response.status) {
    console.log(`✅ [Paystack] Enabled subscription ${subscriptionCode}`);
    return response.data;
  }
  
  throw new PaymentError('paystack', `Failed to enable subscription: ${response.message}`, undefined, { operation: 'enableSubscription', subscriptionCode });
}

export async function disablePaystackSubscription(
  subscriptionCode: string,
  emailToken: string
): Promise<any> {
  const paystack = await getPaystackClient();
  if (!paystack) {
    throw new PaymentError('paystack', 'Paystack not configured', undefined, { operation: 'disableSubscription', subscriptionCode });
  }
  
  const response = await paystack.subscription.disable({
    code: subscriptionCode,
    token: emailToken,
  });
  
  if (response.status) {
    console.log(`✅ [Paystack] Disabled subscription ${subscriptionCode}`);
    return response.data;
  }
  
  throw new PaymentError('paystack', `Failed to disable subscription: ${response.message}`, undefined, { operation: 'disableSubscription', subscriptionCode });
}

export interface PaystackTransactionOptions {
  email: string;
  amount: number;
  currency?: string;
  reference?: string;
  callback_url?: string;
  plan?: string;
  metadata?: Record<string, any>;
  subaccount?: string;
  channels?: string[];
}

export async function initializePaystackTransaction(options: PaystackTransactionOptions): Promise<any> {
  const paystack = await getPaystackClient();
  if (!paystack) {
    throw new PaymentError('paystack', 'Paystack not configured', undefined, { operation: 'initializeTransaction', email: options.email });
  }
  
  const currencyConfig = await getPaystackCurrency();
  const currency = options.currency || currencyConfig.currency;
  
  const transaction = await paystack.transaction.initialize({
    email: options.email,
    amount: Math.round(options.amount * 100).toString(),
    currency: currency,
    reference: options.reference,
    callback_url: options.callback_url,
    plan: options.plan,
    metadata: options.metadata,
    subaccount: options.subaccount,
    channels: options.channels,
  } as any);
  
  if (transaction.status && transaction.data) {
    console.log(`✅ [Paystack] Initialized transaction ${transaction.data.reference}`);
    return transaction.data;
  }
  
  throw new PaymentError('paystack', `Failed to initialize transaction: ${transaction.message}`, undefined, { operation: 'initializeTransaction' });
}

export async function verifyPaystackTransaction(reference: string): Promise<any> {
  const paystack = await getPaystackClient();
  if (!paystack) {
    throw new PaymentError('paystack', 'Paystack not configured', reference, { operation: 'verifyTransaction' });
  }
  
  const response = await paystack.transaction.verify(reference);
  if (response.status && response.data) {
    return response.data;
  }
  
  throw new PaymentError('paystack', `Failed to verify transaction: ${response.message}`, reference, { operation: 'verifyTransaction' });
}

export async function fetchPaystackTransaction(transactionId: string | number): Promise<any> {
  const paystack = await getPaystackClient();
  if (!paystack) {
    throw new PaymentError('paystack', 'Paystack not configured', transactionId.toString(), { operation: 'fetchTransaction' });
  }
  
  const response = await paystack.transaction.fetch(typeof transactionId === 'string' ? parseInt(transactionId, 10) : transactionId);
  if (response.status && response.data) {
    return response.data;
  }
  
  throw new PaymentError('paystack', `Failed to fetch transaction: ${response.message}`, transactionId.toString(), { operation: 'fetchTransaction' });
}

export async function verifyWebhookSignature(
  body: string,
  signature: string
): Promise<boolean> {
  const dbSecretKey = await getSetting(GLOBAL_SETTINGS_KEYS.PAYSTACK_SECRET_KEY);
  const secretKey = dbSecretKey || process.env.PAYSTACK_SECRET_KEY;
  
  if (!secretKey) {
    console.warn('⚠️ [Paystack] Secret key not configured - rejecting webhook for security');
    return false;
  }
  
  const hash = crypto
    .createHmac('sha512', secretKey)
    .update(body)
    .digest('hex');
  
  const isValid = hash === signature;
  if (isValid) {
    console.log('✅ [Paystack] Webhook signature verified');
  } else {
    console.warn('⚠️ [Paystack] Webhook signature verification failed');
  }
  
  return isValid;
}

export async function createPaystackCustomer(
  email: string,
  firstName?: string,
  lastName?: string,
  phone?: string
): Promise<any> {
  const paystack = await getPaystackClient();
  if (!paystack) {
    throw new PaymentError('paystack', 'Paystack not configured', undefined, { operation: 'createCustomer', email });
  }
  
  const customer = await paystack.customer.create({
    email,
    first_name: firstName,
    last_name: lastName,
    phone,
  });
  
  if (customer.status && customer.data) {
    console.log(`✅ [Paystack] Created customer ${customer.data.customer_code}`);
    return customer.data;
  }
  
  throw new PaymentError('paystack', `Failed to create customer: ${customer.message}`, undefined, { operation: 'createCustomer', email });
}

export async function fetchPaystackCustomer(emailOrCode: string): Promise<any> {
  const paystack = await getPaystackClient();
  if (!paystack) {
    throw new PaymentError('paystack', 'Paystack not configured', undefined, { operation: 'fetchCustomer', emailOrCode });
  }
  
  const response = await paystack.customer.fetch(emailOrCode);
  if (response.status && response.data) {
    return response.data;
  }
  
  throw new PaymentError('paystack', `Failed to fetch customer: ${response.message}`, undefined, { operation: 'fetchCustomer', emailOrCode });
}

export async function initiateRefund(
  transactionId: string,
  reason?: string,
  adminId?: string
): Promise<{ success: boolean; refundId?: string; error?: string }> {
  try {
    const paystack = await getPaystackClient();
    if (!paystack) {
      return { success: false, error: 'Paystack not configured' };
    }

    const transaction = await storage.getPaymentTransaction(transactionId);
    if (!transaction) {
      return { success: false, error: 'Transaction not found' };
    }

    if (transaction.gateway !== 'paystack') {
      return { success: false, error: 'Transaction is not a Paystack payment' };
    }

    if (transaction.status === 'refunded') {
      return { success: false, error: 'Transaction already refunded' };
    }

    const refund = await (paystack as any).refund.create({
      transaction: transaction.gatewayTransactionId!,
      merchant_note: reason || 'Admin initiated refund',
    });

    if (!refund.status || !refund.data) {
      return { success: false, error: refund.message || 'Refund failed' };
    }

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
      gateway: 'paystack',
      gatewayRefundId: refund.data.id?.toString(),
      reason: reason || 'admin_initiated',
      initiatedBy: adminId ? 'admin' : 'system',
      adminId,
      status: 'completed',
      creditsReversed: creditsReversed > 0 ? creditsReversed : undefined,
    });

    await storage.updatePaymentTransaction(transactionId, { status: 'refunded' });

    return { success: true, refundId: refund.data.id?.toString() };
  } catch (error: any) {
    console.error('❌ [Paystack] Refund failed:', error);
    return { success: false, error: error.message };
  }
}

export function generateReference(prefix: string = 'tx'): string {
  const timestamp = Date.now().toString(36);
  const randomStr = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${timestamp}_${randomStr}`;
}
