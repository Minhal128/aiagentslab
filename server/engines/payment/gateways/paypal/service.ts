'use strict';
/**
 * PayPal Service
 * Client factory, configuration loaders, and utility functions
 *
 * Client singleton is managed by the legacy service to avoid split-brain.
 */

import axios, { AxiosInstance } from 'axios';
import { storage } from '../../../../storage';
import { PaymentError } from '../../../../utils/errors';
import { GLOBAL_SETTINGS_KEYS, getCurrencySymbol } from '../../types';

export {
  getPayPalClient,
  resetPayPalClient,
  testPayPalConnection,
} from '../../../../services/paypal-service';

import { getPayPalClient } from '../../../../services/paypal-service';

async function getSetting(key: string): Promise<any> {
  const setting = await storage.getGlobalSetting(key);
  return setting?.value ?? null;
}

async function getPayPalCredentials(): Promise<{
  clientId: string | null;
  clientSecret: string | null;
  mode: 'sandbox' | 'live';
  baseUrl: string;
}> {
  const dbClientId = await getSetting(GLOBAL_SETTINGS_KEYS.PAYPAL_CLIENT_ID);
  const dbClientSecret = await getSetting(GLOBAL_SETTINGS_KEYS.PAYPAL_CLIENT_SECRET);
  
  const clientId = dbClientId || process.env.PAYPAL_CLIENT_ID || null;
  const clientSecret = dbClientSecret || process.env.PAYPAL_CLIENT_SECRET || null;
  const dbMode = await getSetting(GLOBAL_SETTINGS_KEYS.PAYPAL_MODE);
  const mode = (dbMode || process.env.PAYPAL_MODE || 'sandbox') as 'sandbox' | 'live';
  
  const baseUrl = mode === 'live' 
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
  
  return { clientId, clientSecret, mode, baseUrl };
}

export async function isPayPalConfigured(): Promise<boolean> {
  const credentials = await getPayPalCredentials();
  return !!(credentials.clientId && credentials.clientSecret);
}

export async function isPayPalEnabled(): Promise<boolean> {
  const isConfigured = await isPayPalConfigured();
  if (!isConfigured) return false;
  
  const enabled = await getSetting(GLOBAL_SETTINGS_KEYS.PAYPAL_ENABLED);
  return enabled === true || enabled === 'true';
}

export async function getPayPalPublicKey(): Promise<string | null> {
  const dbKey = await getSetting(GLOBAL_SETTINGS_KEYS.PAYPAL_CLIENT_ID);
  return dbKey || process.env.PAYPAL_CLIENT_ID || null;
}

export async function getPayPalWebhookId(): Promise<string | null> {
  const dbSecret = await getSetting(GLOBAL_SETTINGS_KEYS.PAYPAL_WEBHOOK_ID);
  const envSecret = process.env.PAYPAL_WEBHOOK_ID;
  return dbSecret || envSecret || null;
}

export interface PayPalCurrencyConfig {
  currency: string;
  currencyLocked: boolean;
  symbol: string;
}

export function getSupportedCurrencies(): Array<{ code: string; symbol: string; name: string }> {
  return [
    { code: 'USD', symbol: '$', name: 'US Dollar' },
    { code: 'EUR', symbol: '€', name: 'Euro' },
    { code: 'GBP', symbol: '£', name: 'British Pound' },
    { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
    { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar' },
    { code: 'CHF', symbol: 'CHF', name: 'Swiss Franc' },
    { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
    { code: 'NZD', symbol: 'NZ$', name: 'New Zealand Dollar' },
    { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar' },
    { code: 'HKD', symbol: 'HK$', name: 'Hong Kong Dollar' },
    { code: 'SEK', symbol: 'kr', name: 'Swedish Krona' },
    { code: 'NOK', symbol: 'kr', name: 'Norwegian Krone' },
    { code: 'DKK', symbol: 'kr', name: 'Danish Krone' },
    { code: 'MXN', symbol: 'MX$', name: 'Mexican Peso' },
    { code: 'BRL', symbol: 'R$', name: 'Brazilian Real' },
    { code: 'PLN', symbol: 'zł', name: 'Polish Zloty' },
    { code: 'CZK', symbol: 'Kč', name: 'Czech Koruna' },
    { code: 'ZAR', symbol: 'R', name: 'South African Rand' },
    { code: 'ILS', symbol: '₪', name: 'Israeli Shekel' },
    { code: 'PHP', symbol: '₱', name: 'Philippine Peso' },
    { code: 'THB', symbol: '฿', name: 'Thai Baht' },
    { code: 'MYR', symbol: 'RM', name: 'Malaysian Ringgit' },
    { code: 'TWD', symbol: 'NT$', name: 'Taiwan Dollar' },
  ];
}

export async function getPayPalCurrency(): Promise<PayPalCurrencyConfig> {
  const currency = await getSetting(GLOBAL_SETTINGS_KEYS.PAYPAL_CURRENCY);
  const locked = await getSetting('paypal_currency_locked');
  
  const currencyCode = currency || 'USD';
  const currencyLocked = locked === true || locked === 'true';
  
  return {
    currency: currencyCode.toUpperCase(),
    currencyLocked,
    symbol: getCurrencySymbol(currencyCode),
  };
}

export async function setPayPalCurrency(currency: string): Promise<{ success: boolean; error?: string }> {
  const currentConfig = await getPayPalCurrency();
  
  if (currentConfig.currencyLocked) {
    return { success: false, error: 'PayPal currency is locked and cannot be changed' };
  }
  
  const validCurrencies = getSupportedCurrencies().map(c => c.code);
  if (!validCurrencies.includes(currency.toUpperCase())) {
    return { success: false, error: `Invalid currency: ${currency}. Supported currencies: ${validCurrencies.join(', ')}` };
  }
  
  await storage.updateGlobalSetting(GLOBAL_SETTINGS_KEYS.PAYPAL_CURRENCY, currency.toUpperCase());
  
  return { success: true };
}

export async function lockPayPalCurrency(): Promise<{ success: boolean; error?: string }> {
  const currentConfig = await getPayPalCurrency();
  
  if (currentConfig.currencyLocked) {
    return { success: false, error: 'PayPal currency is already locked' };
  }
  
  await storage.updateGlobalSetting('paypal_currency_locked', true);
  
  console.log(`🔒 [PayPal] Currency locked to ${currentConfig.currency}`);
  return { success: true };
}

export async function getPayPalConfig(): Promise<{
  enabled: boolean;
  configured: boolean;
  publicKey: string | null;
  currency: PayPalCurrencyConfig;
  mode: 'sandbox' | 'live';
}> {
  const [enabled, configured, publicKey, currency] = await Promise.all([
    isPayPalEnabled(),
    isPayPalConfigured(),
    getPayPalPublicKey(),
    getPayPalCurrency(),
  ]);
  
  const credentials = await getPayPalCredentials();
  
  return {
    enabled,
    configured,
    publicKey: enabled ? publicKey : null,
    currency,
    mode: credentials.mode,
  };
}

export interface PayPalOrderOptions {
  amount: number;
  currency?: string;
  description?: string;
  returnUrl: string;
  cancelUrl: string;
  customId?: string;
}

export async function createPayPalOrder(options: PayPalOrderOptions): Promise<any> {
  const client = await getPayPalClient();
  if (!client) {
    throw new PaymentError('paypal', 'PayPal not configured', undefined, { operation: 'createOrder' });
  }
  
  const currencyConfig = await getPayPalCurrency();
  const currency = options.currency || currencyConfig.currency;
  
  const response = await client.post('/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [{
      amount: {
        currency_code: currency,
        value: options.amount.toFixed(2),
      },
      description: options.description,
      custom_id: options.customId,
    }],
    application_context: {
      return_url: options.returnUrl,
      cancel_url: options.cancelUrl,
      user_action: 'PAY_NOW',
    },
  });
  
  console.log(`✅ [PayPal] Created order ${response.data.id}`);
  return response.data;
}

export async function capturePayPalOrder(orderId: string): Promise<any> {
  const client = await getPayPalClient();
  if (!client) {
    throw new PaymentError('paypal', 'PayPal not configured', undefined, { operation: 'captureOrder', orderId });
  }
  
  const response = await client.post(`/v2/checkout/orders/${orderId}/capture`, {});
  console.log(`✅ [PayPal] Captured order ${orderId}`);
  return response.data;
}

export async function fetchPayPalOrder(orderId: string): Promise<any> {
  const client = await getPayPalClient();
  if (!client) {
    throw new PaymentError('paypal', 'PayPal not configured', undefined, { operation: 'fetchOrder', orderId });
  }
  
  const response = await client.get(`/v2/checkout/orders/${orderId}`);
  return response.data;
}

export interface PayPalSubscriptionOptions {
  planId: string;
  subscriber?: {
    name?: { given_name: string; surname: string };
    email_address?: string;
  };
  applicationContext?: {
    brand_name?: string;
    return_url: string;
    cancel_url: string;
    user_action?: 'SUBSCRIBE_NOW' | 'CONTINUE';
  };
}

export async function createPayPalSubscription(options: PayPalSubscriptionOptions): Promise<any> {
  const client = await getPayPalClient();
  if (!client) {
    throw new PaymentError('paypal', 'PayPal not configured', undefined, { operation: 'createSubscription', planId: options.planId });
  }
  
  const response = await client.post('/v1/billing/subscriptions', {
    plan_id: options.planId,
    subscriber: options.subscriber,
    application_context: options.applicationContext,
  });
  
  console.log(`✅ [PayPal] Created subscription ${response.data.id}`);
  return response.data;
}

export async function fetchPayPalSubscription(subscriptionId: string): Promise<any> {
  const client = await getPayPalClient();
  if (!client) {
    throw new PaymentError('paypal', 'PayPal not configured', undefined, { operation: 'fetchSubscription', subscriptionId });
  }
  
  const response = await client.get(`/v1/billing/subscriptions/${subscriptionId}`);
  return response.data;
}

export async function cancelPayPalSubscription(subscriptionId: string, reason?: string): Promise<void> {
  const client = await getPayPalClient();
  if (!client) {
    throw new PaymentError('paypal', 'PayPal not configured', undefined, { operation: 'cancelSubscription', subscriptionId });
  }
  
  await client.post(`/v1/billing/subscriptions/${subscriptionId}/cancel`, {
    reason: reason || 'Subscription cancelled by user',
  });
  
  console.log(`✅ [PayPal] Cancelled subscription ${subscriptionId}`);
}

export async function verifyPayPalWebhookSignature(
  body: string,
  headers: Record<string, string | string[] | undefined>
): Promise<boolean> {
  try {
    const webhookId = await getPayPalWebhookId();
    if (!webhookId) {
      console.warn('[PayPal] Webhook ID not configured - rejecting webhook');
      return false;
    }

    const transmissionId = headers['paypal-transmission-id'] as string;
    const transmissionTime = headers['paypal-transmission-time'] as string;
    const transmissionSig = headers['paypal-transmission-sig'] as string;
    const certUrl = headers['paypal-cert-url'] as string;
    const authAlgo = headers['paypal-auth-algo'] as string;

    if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo) {
      console.warn('[PayPal] Missing webhook verification headers');
      return false;
    }

    const client = await getPayPalClient();
    if (!client) {
      return false;
    }

    const verificationResponse = await client.post('/v1/notifications/verify-webhook-signature', {
      transmission_id: transmissionId,
      transmission_time: transmissionTime,
      transmission_sig: transmissionSig,
      cert_url: certUrl,
      auth_algo: authAlgo,
      webhook_id: webhookId,
      webhook_event: JSON.parse(body),
    });

    const verified = verificationResponse.data?.verification_status === 'SUCCESS';
    if (verified) {
      console.log('✅ [PayPal] Webhook signature verified');
    } else {
      console.warn('⚠️ [PayPal] Webhook signature verification failed');
    }
    return verified;
  } catch (error: any) {
    console.error('[PayPal] Webhook signature verification error:', error.message);
    return false;
  }
}

export async function initiateRefund(
  transactionId: string,
  reason?: string,
  adminId?: string
): Promise<{ success: boolean; refundId?: string; error?: string }> {
  try {
    const client = await getPayPalClient();
    if (!client) {
      return { success: false, error: 'PayPal not configured' };
    }

    const transaction = await storage.getPaymentTransaction(transactionId);
    if (!transaction) {
      return { success: false, error: 'Transaction not found' };
    }

    if (transaction.gateway !== 'paypal') {
      return { success: false, error: 'Transaction is not a PayPal payment' };
    }

    if (transaction.status === 'refunded') {
      return { success: false, error: 'Transaction already refunded' };
    }

    const captureId = transaction.gatewayTransactionId;
    const response = await client.post(`/v2/payments/captures/${captureId}/refund`, {
      note_to_payer: reason || 'Refund processed',
    });

    const refundId = response.data.id;

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
      gateway: 'paypal',
      gatewayRefundId: refundId,
      reason: reason || 'admin_initiated',
      initiatedBy: adminId ? 'admin' : 'system',
      adminId,
      status: 'completed',
      creditsReversed: creditsReversed > 0 ? creditsReversed : undefined,
    });

    await storage.updatePaymentTransaction(transactionId, { status: 'refunded' });

    return { success: true, refundId };
  } catch (error: any) {
    console.error('❌ [PayPal] Refund failed:', error);
    return { success: false, error: error.message };
  }
}
