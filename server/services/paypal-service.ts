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
import axios, { AxiosInstance } from 'axios';
import { storage } from '../storage';
import { PaymentError } from '../utils/errors';

let paypalClient: AxiosInstance | null = null;
let accessToken: string | null = null;
let tokenExpiry: number = 0;

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
  // Check database first, then fall back to environment variables
  const dbClientId = await getSetting('paypal_client_id');
  const dbClientSecret = await getSetting('paypal_client_secret');
  
  const clientId = dbClientId || process.env.PAYPAL_CLIENT_ID || null;
  const clientSecret = dbClientSecret || process.env.PAYPAL_CLIENT_SECRET || null;
  const dbMode = await getSetting('paypal_mode');
  const mode = (dbMode || process.env.PAYPAL_MODE || 'sandbox') as 'sandbox' | 'live';
  
  const baseUrl = mode === 'live' 
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
  
  return { clientId, clientSecret, mode, baseUrl };
}

async function getAccessToken(): Promise<string> {
  const credentials = await getPayPalCredentials();
  
  if (!credentials.clientId || !credentials.clientSecret) {
    throw new PaymentError('paypal', 'PayPal not configured', undefined, { operation: 'getAccessToken' });
  }
  
  if (accessToken && Date.now() < tokenExpiry - 60000) {
    return accessToken;
  }
  
  const auth = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64');
  
  const response = await axios.post(
    `${credentials.baseUrl}/v1/oauth2/token`,
    'grant_type=client_credentials',
    {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );
  
  accessToken = response.data.access_token;
  tokenExpiry = Date.now() + (response.data.expires_in * 1000);
  
  return accessToken!;
}

export async function getPayPalClient(): Promise<AxiosInstance | null> {
  const credentials = await getPayPalCredentials();
  
  if (!credentials.clientId || !credentials.clientSecret) {
    return null;
  }
  
  if (!paypalClient) {
    paypalClient = axios.create({
      baseURL: credentials.baseUrl,
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    paypalClient.interceptors.request.use(async (axiosConfig) => {
      const token = await getAccessToken();
      axiosConfig.headers.Authorization = `Bearer ${token}`;
      return axiosConfig;
    });
  }
  
  return paypalClient;
}

export function resetPayPalClient(): void {
  paypalClient = null;
  accessToken = null;
  tokenExpiry = 0;
}

export async function isPayPalConfigured(): Promise<boolean> {
  const credentials = await getPayPalCredentials();
  return !!(credentials.clientId && credentials.clientSecret);
}

export async function isPayPalEnabled(): Promise<boolean> {
  const enabled = await getSetting('paypal_enabled');
  return enabled === true || enabled === 'true';
}

export async function testPayPalConnection(): Promise<{ success: boolean; error?: string }> {
  try {
    const client = await getPayPalClient();
    if (!client) {
      return { success: false, error: 'PayPal not configured' };
    }
    
    await getAccessToken();
    return { success: true };
  } catch (error: any) {
    console.error('❌ [PayPal] Connection test failed:', error.message);
    return { success: false, error: error.message };
  }
}

export interface PayPalCurrencyConfig {
  currency: string;
  currencyLocked: boolean;
  symbol: string;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', AUD: 'A$', CAD: 'C$', CHF: 'CHF',
  JPY: '¥', NZD: 'NZ$', SGD: 'S$', HKD: 'HK$', SEK: 'kr', NOK: 'kr',
  DKK: 'kr', MXN: 'MX$', BRL: 'R$', PLN: 'zł', CZK: 'Kč', ZAR: 'R',
  ILS: '₪', PHP: '₱', THB: '฿', MYR: 'RM', TWD: 'NT$', RUB: '₽',
};

export function getCurrencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency.toUpperCase()] || currency.toUpperCase();
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
  const currency = await getSetting('paypal_currency');
  const locked = await getSetting('paypal_currency_locked');
  
  const currencyCode = currency || 'USD';
  const currencyLocked = locked === true || locked === 'true';
  
  return {
    currency: currencyCode.toUpperCase(),
    currencyLocked,
    symbol: getCurrencySymbol(currencyCode),
  };
}

export async function getPayPalPublicKey(): Promise<string | null> {
  return await getSetting('paypal_client_id');
}

export interface PayPalProductOptions {
  name: string;
  description?: string;
  type?: 'SERVICE' | 'PHYSICAL' | 'DIGITAL';
  category?: string;
}

export async function createPayPalProduct(options: PayPalProductOptions): Promise<any> {
  const client = await getPayPalClient();
  if (!client) {
    throw new PaymentError('paypal', 'PayPal not configured', undefined, { operation: 'createProduct' });
  }
  
  const response = await client.post('/v1/catalogs/products', {
    name: options.name,
    description: options.description || options.name,
    type: options.type || 'SERVICE',
    category: options.category || 'SOFTWARE',
  });
  
  console.log(`✅ [PayPal] Created product ${response.data.id}`);
  return response.data;
}

export interface PayPalPlanOptions {
  productId: string;
  name: string;
  description?: string;
  billingCycles: Array<{
    frequency: {
      interval_unit: 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';
      interval_count: number;
    };
    tenure_type: 'REGULAR' | 'TRIAL';
    sequence: number;
    total_cycles?: number;
    pricing_scheme: {
      fixed_price: {
        value: string;
        currency_code: string;
      };
    };
  }>;
  paymentPreferences?: {
    auto_bill_outstanding?: boolean;
    setup_fee_failure_action?: 'CONTINUE' | 'CANCEL';
    payment_failure_threshold?: number;
  };
}

export async function createPayPalPlan(options: PayPalPlanOptions): Promise<any> {
  const client = await getPayPalClient();
  if (!client) {
    throw new PaymentError('paypal', 'PayPal not configured', undefined, { operation: 'createPlan' });
  }
  
  const response = await client.post('/v1/billing/plans', {
    product_id: options.productId,
    name: options.name,
    description: options.description || options.name,
    billing_cycles: options.billingCycles,
    payment_preferences: options.paymentPreferences || {
      auto_bill_outstanding: true,
      setup_fee_failure_action: 'CONTINUE',
      payment_failure_threshold: 3,
    },
  });
  
  console.log(`✅ [PayPal] Created plan ${response.data.id}`);
  return response.data;
}

export async function fetchPayPalPlan(planId: string): Promise<any> {
  const client = await getPayPalClient();
  if (!client) {
    throw new PaymentError('paypal', 'PayPal not configured', undefined, { operation: 'fetchPlan', planId });
  }
  
  const response = await client.get(`/v1/billing/plans/${planId}`);
  return response.data;
}

export async function deactivatePayPalPlan(planId: string): Promise<void> {
  const client = await getPayPalClient();
  if (!client) {
    throw new PaymentError('paypal', 'PayPal not configured', undefined, { operation: 'deactivatePlan', planId });
  }
  
  await client.post(`/v1/billing/plans/${planId}/deactivate`);
  console.log(`✅ [PayPal] Deactivated plan ${planId}`);
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

export async function verifyPayPalWebhookSignature(
  body: string,
  headers: Record<string, string | string[] | undefined>
): Promise<boolean> {
  try {
    const webhookId = await getSetting('paypal_webhook_id');
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
  
  const mode = (await getSetting('paypal_mode')) || 'sandbox';
  
  return {
    enabled,
    configured,
    publicKey,
    currency,
    mode,
  };
}
