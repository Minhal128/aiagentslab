/**
 * ============================================================
 * © 2025 Diploy — a brand of Bisht Technologies Private Limited
 * Original Author: BTPL Engineering Team
 * Website: https://diploy.in
 * Contact: cs@diploy.in
 *
 * Distributed under the Envato / CodeCanyon License Agreement.
 * Licensed to the purchaser for use as defined by the
 * Envato Market (CodeCanyon) Regular or Extended License.
 *
 * You are NOT permitted to redistribute, resell, sublicense,
 * or share this source code, in whole or in part.
 * Respect the author's rights and Envato licensing terms.
 * ============================================================
 */
import Paystack from '@paystack/paystack-sdk';
import crypto from 'crypto';
import { storage } from '../storage';
import { PaymentError } from '../utils/errors';

let paystackInstance: Paystack | null = null;

async function getSetting(key: string): Promise<any> {
  const setting = await storage.getGlobalSetting(key);
  return setting?.value ?? null;
}

export async function getPaystackClient(): Promise<Paystack | null> {
  // Check database first, then fall back to environment variables
  const dbSecretKey = await getSetting('paystack_secret_key');
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
  const dbSecretKey = await getSetting('paystack_secret_key');
  const dbPublicKey = await getSetting('paystack_public_key');
  const envSecretKey = process.env.PAYSTACK_SECRET_KEY;
  const envPublicKey = process.env.PAYSTACK_PUBLIC_KEY;
  
  return !!((dbSecretKey && dbPublicKey) || (envSecretKey && envPublicKey));
}

export async function isPaystackEnabled(): Promise<boolean> {
  const enabled = await getSetting('paystack_enabled');
  return enabled === true || enabled === 'true';
}

export async function getPaystackPublicKey(): Promise<string | null> {
  const dbKey = await getSetting('paystack_public_key');
  return dbKey || process.env.PAYSTACK_PUBLIC_KEY || null;
}

export async function testPaystackConnection(): Promise<{ success: boolean; error?: string }> {
  try {
    const paystack = await getPaystackClient();
    if (!paystack) {
      return { success: false, error: 'Paystack not configured' };
    }
    
    const response = await paystack.transaction.list({ perPage: 1 });
    if (response.status) {
      return { success: true };
    }
    return { success: false, error: 'Failed to verify Paystack connection' };
  } catch (error: any) {
    console.error('❌ [Paystack] Connection test failed:', error.message);
    return { success: false, error: error.message };
  }
}

export interface PaystackCurrencyConfig {
  currency: string;
  currencyLocked: boolean;
  symbol: string;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  NGN: '₦',  // Nigerian Naira
  GHS: 'GH₵', // Ghanaian Cedi
  ZAR: 'R',   // South African Rand
  KES: 'KSh', // Kenyan Shilling
  USD: '$',   // US Dollar (for international)
};

export function getCurrencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency.toUpperCase()] || currency.toUpperCase();
}

export function getSupportedCurrencies(): Array<{ code: string; symbol: string; name: string }> {
  return [
    { code: 'NGN', symbol: '₦', name: 'Nigerian Naira' },
    { code: 'GHS', symbol: 'GH₵', name: 'Ghanaian Cedi' },
    { code: 'ZAR', symbol: 'R', name: 'South African Rand' },
    { code: 'KES', symbol: 'KSh', name: 'Kenyan Shilling' },
    { code: 'USD', symbol: '$', name: 'US Dollar' },
  ];
}

export async function getPaystackCurrency(): Promise<PaystackCurrencyConfig> {
  const currency = await getSetting('paystack_currency');
  const locked = await getSetting('paystack_currency_locked');
  
  const currencyCode = currency || 'NGN';
  const currencyLocked = locked === true || locked === 'true';
  
  return {
    currency: currencyCode.toUpperCase(),
    currencyLocked,
    symbol: getCurrencySymbol(currencyCode),
  };
}

export interface PaystackPlanOptions {
  name: string;
  interval: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'annually';
  amount: number;
  currency?: string;
  description?: string;
  sendInvoices?: boolean;
  sendSms?: boolean;
  invoiceLimit?: number;
}

export async function createPaystackPlan(options: PaystackPlanOptions): Promise<any> {
  const paystack = await getPaystackClient();
  if (!paystack) {
    throw new PaymentError('paystack', 'Paystack not configured', undefined, { operation: 'createPlan' });
  }
  
  const currencyConfig = await getPaystackCurrency();
  const currency = options.currency || currencyConfig.currency;
  
  const response = await paystack.plan.create({
    name: options.name,
    interval: options.interval,
    amount: Math.round(options.amount * 100).toString(),
    currency: currency,
    description: options.description || options.name,
    send_invoices: options.sendInvoices ?? true,
    send_sms: options.sendSms ?? false,
    invoice_limit: options.invoiceLimit || 0,
  });
  
  if (!response.status) {
    throw new PaymentError('paystack', `Failed to create plan: ${response.message}`, undefined, { operation: 'createPlan' });
  }
  
  console.log(`✅ [Paystack] Created plan ${response.data?.plan_code}`);
  return response.data;
}

export async function fetchPaystackPlan(planIdOrCode: string): Promise<any> {
  const paystack = await getPaystackClient();
  if (!paystack) {
    throw new PaymentError('paystack', 'Paystack not configured', undefined, { operation: 'fetchPlan', planIdOrCode });
  }
  
  const response = await paystack.plan.fetch(planIdOrCode);
  if (!response.status) {
    throw new PaymentError('paystack', `Failed to fetch plan: ${response.message}`, undefined, { operation: 'fetchPlan', planIdOrCode });
  }
  
  return response.data;
}

export async function listPaystackPlans(): Promise<any[]> {
  const paystack = await getPaystackClient();
  if (!paystack) {
    throw new PaymentError('paystack', 'Paystack not configured', undefined, { operation: 'listPlans' });
  }
  
  const response = await paystack.plan.list({});
  if (!response.status) {
    throw new PaymentError('paystack', `Failed to list plans: ${response.message}`, undefined, { operation: 'listPlans' });
  }
  
  return response.data || [];
}

export interface PaystackSubscriptionOptions {
  customer: string;
  plan: string;
  startDate?: Date;
}

export async function createPaystackSubscription(options: PaystackSubscriptionOptions): Promise<any> {
  const paystack = await getPaystackClient();
  if (!paystack) {
    throw new PaymentError('paystack', 'Paystack not configured', undefined, { operation: 'createSubscription', plan: options.plan });
  }
  
  const response = await paystack.subscription.create({
    customer: options.customer,
    plan: options.plan,
    start_date: options.startDate?.toISOString(),
  });
  
  if (!response.status) {
    throw new PaymentError('paystack', `Failed to create subscription: ${response.message}`, undefined, { operation: 'createSubscription' });
  }
  
  console.log(`✅ [Paystack] Created subscription ${response.data?.subscription_code}`);
  return response.data;
}

export async function fetchPaystackSubscription(subscriptionIdOrCode: string): Promise<any> {
  const paystack = await getPaystackClient();
  if (!paystack) {
    throw new PaymentError('paystack', 'Paystack not configured', undefined, { operation: 'fetchSubscription', subscriptionIdOrCode });
  }
  
  const response = await paystack.subscription.fetch(subscriptionIdOrCode);
  if (!response.status) {
    throw new PaymentError('paystack', `Failed to fetch subscription: ${response.message}`, undefined, { operation: 'fetchSubscription' });
  }
  
  return response.data;
}

export async function disablePaystackSubscription(subscriptionCode: string, emailToken: string): Promise<any> {
  const paystack = await getPaystackClient();
  if (!paystack) {
    throw new PaymentError('paystack', 'Paystack not configured', undefined, { operation: 'disableSubscription', subscriptionCode });
  }
  
  const response = await paystack.subscription.disable({
    code: subscriptionCode,
    token: emailToken,
  });
  
  if (!response.status) {
    throw new PaymentError('paystack', `Failed to disable subscription: ${response.message}`, undefined, { operation: 'disableSubscription' });
  }
  
  console.log(`✅ [Paystack] Disabled subscription ${subscriptionCode}`);
  return response.data;
}

export async function enablePaystackSubscription(subscriptionCode: string, emailToken: string): Promise<any> {
  const paystack = await getPaystackClient();
  if (!paystack) {
    throw new PaymentError('paystack', 'Paystack not configured', undefined, { operation: 'enableSubscription', subscriptionCode });
  }
  
  const response = await paystack.subscription.enable({
    code: subscriptionCode,
    token: emailToken,
  });
  
  if (!response.status) {
    throw new PaymentError('paystack', `Failed to enable subscription: ${response.message}`, undefined, { operation: 'enableSubscription' });
  }
  
  console.log(`✅ [Paystack] Enabled subscription ${subscriptionCode}`);
  return response.data;
}

export interface PaystackTransactionOptions {
  email: string;
  amount: number;
  currency?: string;
  reference?: string;
  callbackUrl?: string;
  metadata?: Record<string, any>;
  plan?: string;
  channels?: ('card' | 'bank' | 'ussd' | 'qr' | 'mobile_money' | 'bank_transfer')[];
}

export async function initializePaystackTransaction(options: PaystackTransactionOptions): Promise<any> {
  const paystack = await getPaystackClient();
  if (!paystack) {
    throw new PaymentError('paystack', 'Paystack not configured', undefined, { operation: 'initializeTransaction' });
  }
  
  const currencyConfig = await getPaystackCurrency();
  const currency = options.currency || currencyConfig.currency;
  
  const response = await paystack.transaction.initialize({
    email: options.email,
    amount: (Math.round(options.amount * 100)).toString(),
    currency: currency,
    reference: options.reference,
    callback_url: options.callbackUrl,
    metadata: options.metadata,
    plan: options.plan,
    channels: options.channels,
  });
  
  if (!response.status) {
    throw new PaymentError('paystack', `Failed to initialize transaction: ${response.message}`, undefined, { operation: 'initializeTransaction' });
  }
  
  console.log(`✅ [Paystack] Initialized transaction with reference ${response.data?.reference}`);
  return response.data;
}

export async function verifyPaystackTransaction(reference: string): Promise<any> {
  const paystack = await getPaystackClient();
  if (!paystack) {
    throw new PaymentError('paystack', 'Paystack not configured', undefined, { operation: 'verifyTransaction', reference });
  }
  
  const response = await paystack.transaction.verify(reference);
  if (!response.status) {
    throw new PaymentError('paystack', `Failed to verify transaction: ${response.message}`, undefined, { operation: 'verifyTransaction' });
  }
  
  return response.data;
}

export async function fetchPaystackTransaction(transactionId: number): Promise<any> {
  const paystack = await getPaystackClient();
  if (!paystack) {
    throw new PaymentError('paystack', 'Paystack not configured', undefined, { operation: 'fetchTransaction', transactionId });
  }
  
  const response = await paystack.transaction.fetch(transactionId);
  if (!response.status) {
    throw new PaymentError('paystack', `Failed to fetch transaction: ${response.message}`, undefined, { operation: 'fetchTransaction' });
  }
  
  return response.data;
}

export interface PaystackCustomerOptions {
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}

export async function createPaystackCustomer(options: PaystackCustomerOptions): Promise<any> {
  const paystack = await getPaystackClient();
  if (!paystack) {
    throw new PaymentError('paystack', 'Paystack not configured', undefined, { operation: 'createCustomer' });
  }
  
  const response = await paystack.customer.create({
    email: options.email,
    first_name: options.firstName,
    last_name: options.lastName,
    phone: options.phone,
  });
  
  if (!response.status) {
    throw new PaymentError('paystack', `Failed to create customer: ${response.message}`, undefined, { operation: 'createCustomer' });
  }
  
  console.log(`✅ [Paystack] Created customer ${response.data?.customer_code}`);
  return response.data;
}

export async function fetchPaystackCustomer(emailOrCode: string): Promise<any> {
  const paystack = await getPaystackClient();
  if (!paystack) {
    throw new PaymentError('paystack', 'Paystack not configured', undefined, { operation: 'fetchCustomer', emailOrCode });
  }
  
  const response = await paystack.customer.fetch(emailOrCode);
  if (!response.status) {
    throw new PaymentError('paystack', `Failed to fetch customer: ${response.message}`, undefined, { operation: 'fetchCustomer' });
  }
  
  return response.data;
}

export async function verifyPaystackWebhookSignature(
  body: string,
  signature: string
): Promise<boolean> {
  const secretKey = await getSetting('paystack_secret_key');
  if (!secretKey) {
    return false;
  }
  
  const hash = crypto
    .createHmac('sha512', secretKey)
    .update(body)
    .digest('hex');
  
  return hash === signature;
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
    publicKey,
    currency,
  };
}
