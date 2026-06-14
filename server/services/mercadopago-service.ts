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
import { MercadoPagoConfig, Preference, PreApprovalPlan, PreApproval, Payment } from 'mercadopago';
import crypto from 'crypto';
import { storage } from '../storage';
import { PaymentError } from '../utils/errors';

let mercadoPagoClient: MercadoPagoConfig | null = null;

async function getSetting(key: string): Promise<any> {
  const setting = await storage.getGlobalSetting(key);
  return setting?.value ?? null;
}

export async function getMercadoPagoClient(): Promise<MercadoPagoConfig | null> {
  // Check database first, then fall back to environment variables
  const dbAccessToken = await getSetting('mercadopago_access_token');
  const accessToken = dbAccessToken || process.env.MERCADOPAGO_ACCESS_TOKEN;
  
  if (!accessToken) {
    return null;
  }
  
  if (!mercadoPagoClient) {
    mercadoPagoClient = new MercadoPagoConfig({ accessToken });
  }
  
  return mercadoPagoClient;
}

export function resetMercadoPagoClient(): void {
  mercadoPagoClient = null;
}

export async function isMercadoPagoConfigured(): Promise<boolean> {
  const dbAccessToken = await getSetting('mercadopago_access_token');
  const dbPublicKey = await getSetting('mercadopago_public_key');
  const envAccessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  const envPublicKey = process.env.MERCADOPAGO_PUBLIC_KEY;
  
  return !!((dbAccessToken && dbPublicKey) || (envAccessToken && envPublicKey));
}

export async function isMercadoPagoEnabled(): Promise<boolean> {
  const enabled = await getSetting('mercadopago_enabled');
  return enabled === true || enabled === 'true';
}

export async function getMercadoPagoPublicKey(): Promise<string | null> {
  const dbKey = await getSetting('mercadopago_public_key');
  return dbKey || process.env.MERCADOPAGO_PUBLIC_KEY || null;
}

export async function testMercadoPagoConnection(): Promise<{ success: boolean; error?: string }> {
  try {
    const client = await getMercadoPagoClient();
    if (!client) {
      return { success: false, error: 'MercadoPago not configured' };
    }
    
    const preference = new Preference(client);
    await preference.search({ options: { limit: 1 } });
    return { success: true };
  } catch (error: any) {
    console.error('❌ [MercadoPago] Connection test failed:', error.message);
    return { success: false, error: error.message };
  }
}

export interface MercadoPagoCurrencyConfig {
  currency: string;
  currencyLocked: boolean;
  symbol: string;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  BRL: 'R$',    // Brazilian Real
  ARS: '$',     // Argentine Peso
  MXN: 'MX$',   // Mexican Peso
  CLP: '$',     // Chilean Peso
  COP: '$',     // Colombian Peso
  PEN: 'S/',    // Peruvian Sol
  UYU: '$U',    // Uruguayan Peso
  USD: '$',     // US Dollar
};

export function getCurrencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency.toUpperCase()] || currency.toUpperCase();
}

export function getSupportedCurrencies(): Array<{ code: string; symbol: string; name: string }> {
  return [
    { code: 'BRL', symbol: 'R$', name: 'Brazilian Real' },
    { code: 'ARS', symbol: '$', name: 'Argentine Peso' },
    { code: 'MXN', symbol: 'MX$', name: 'Mexican Peso' },
    { code: 'CLP', symbol: '$', name: 'Chilean Peso' },
    { code: 'COP', symbol: '$', name: 'Colombian Peso' },
    { code: 'PEN', symbol: 'S/', name: 'Peruvian Sol' },
    { code: 'UYU', symbol: '$U', name: 'Uruguayan Peso' },
    { code: 'USD', symbol: '$', name: 'US Dollar' },
  ];
}

export async function getMercadoPagoCurrency(): Promise<MercadoPagoCurrencyConfig> {
  const currency = await getSetting('mercadopago_currency');
  const locked = await getSetting('mercadopago_currency_locked');
  
  const currencyCode = currency || 'BRL';
  const currencyLocked = locked === true || locked === 'true';
  
  return {
    currency: currencyCode.toUpperCase(),
    currencyLocked,
    symbol: getCurrencySymbol(currencyCode),
  };
}

export interface MercadoPagoPreferenceOptions {
  items: Array<{
    title: string;
    quantity: number;
    unitPrice: number;
    currencyId?: string;
    description?: string;
    id?: string;
  }>;
  payer?: {
    email?: string;
    name?: string;
    surname?: string;
  };
  backUrls?: {
    success: string;
    failure: string;
    pending: string;
  };
  autoReturn?: 'approved' | 'all';
  externalReference?: string;
  notificationUrl?: string;
}

export async function createMercadoPagoPreference(options: MercadoPagoPreferenceOptions): Promise<any> {
  const client = await getMercadoPagoClient();
  if (!client) {
    throw new PaymentError('mercadopago', 'MercadoPago not configured', undefined, { operation: 'createPreference' });
  }
  
  const currencyConfig = await getMercadoPagoCurrency();
  
  const preference = new Preference(client);
  const result = await preference.create({
    body: {
      items: options.items.map(item => ({
        id: item.id || crypto.randomUUID(),
        title: item.title,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        currency_id: item.currencyId || currencyConfig.currency,
        description: item.description,
      })),
      payer: options.payer ? {
        email: options.payer.email,
        name: options.payer.name,
        surname: options.payer.surname,
      } : undefined,
      back_urls: options.backUrls ? {
        success: options.backUrls.success,
        failure: options.backUrls.failure,
        pending: options.backUrls.pending,
      } : undefined,
      auto_return: options.autoReturn,
      external_reference: options.externalReference,
      notification_url: options.notificationUrl,
    },
  });
  
  console.log(`✅ [MercadoPago] Created preference ${result.id}`);
  return result;
}

export async function fetchMercadoPagoPreference(preferenceId: string): Promise<any> {
  const client = await getMercadoPagoClient();
  if (!client) {
    throw new PaymentError('mercadopago', 'MercadoPago not configured', undefined, { operation: 'fetchPreference', preferenceId });
  }
  
  const preference = new Preference(client);
  return await preference.get({ preferenceId });
}

export interface MercadoPagoSubscriptionPlanOptions {
  reason: string;
  autoRecurring: {
    frequency: number;
    frequencyType: 'days' | 'months';
    transactionAmount: number;
    currencyId?: string;
    billingDayProportional?: boolean;
  };
  backUrl: string;
}

export async function createMercadoPagoSubscriptionPlan(options: MercadoPagoSubscriptionPlanOptions): Promise<any> {
  const client = await getMercadoPagoClient();
  if (!client) {
    throw new PaymentError('mercadopago', 'MercadoPago not configured', undefined, { operation: 'createSubscriptionPlan' });
  }
  
  const currencyConfig = await getMercadoPagoCurrency();
  
  const preApprovalPlan = new PreApprovalPlan(client);
  const result = await preApprovalPlan.create({
    body: {
      reason: options.reason,
      auto_recurring: {
        frequency: options.autoRecurring.frequency,
        frequency_type: options.autoRecurring.frequencyType,
        transaction_amount: options.autoRecurring.transactionAmount,
        currency_id: options.autoRecurring.currencyId || currencyConfig.currency,
        billing_day_proportional: options.autoRecurring.billingDayProportional,
      },
      back_url: options.backUrl,
    },
  });
  
  console.log(`✅ [MercadoPago] Created subscription plan ${result.id}`);
  return result;
}

export async function fetchMercadoPagoSubscriptionPlan(planId: string): Promise<any> {
  const client = await getMercadoPagoClient();
  if (!client) {
    throw new PaymentError('mercadopago', 'MercadoPago not configured', undefined, { operation: 'fetchSubscriptionPlan', planId });
  }
  
  const preApprovalPlan = new PreApprovalPlan(client);
  return await preApprovalPlan.get({ preApprovalPlanId: planId });
}

export interface MercadoPagoSubscriptionOptions {
  preApprovalPlanId: string;
  payerEmail: string;
  cardTokenId?: string;
  externalReference?: string;
  reason?: string;
  backUrl: string;
}

export async function createMercadoPagoSubscription(options: MercadoPagoSubscriptionOptions): Promise<any> {
  const client = await getMercadoPagoClient();
  if (!client) {
    throw new PaymentError('mercadopago', 'MercadoPago not configured', undefined, { operation: 'createSubscription', planId: options.preApprovalPlanId });
  }
  
  const preApproval = new PreApproval(client);
  const result = await preApproval.create({
    body: {
      preapproval_plan_id: options.preApprovalPlanId,
      payer_email: options.payerEmail,
      card_token_id: options.cardTokenId,
      external_reference: options.externalReference,
      reason: options.reason,
      back_url: options.backUrl,
    },
  });
  
  console.log(`✅ [MercadoPago] Created subscription ${result.id}`);
  return result;
}

export async function fetchMercadoPagoSubscription(subscriptionId: string): Promise<any> {
  const client = await getMercadoPagoClient();
  if (!client) {
    throw new PaymentError('mercadopago', 'MercadoPago not configured', undefined, { operation: 'fetchSubscription', subscriptionId });
  }
  
  const preApproval = new PreApproval(client);
  return await preApproval.get({ id: subscriptionId });
}

export async function cancelMercadoPagoSubscription(subscriptionId: string): Promise<any> {
  const client = await getMercadoPagoClient();
  if (!client) {
    throw new PaymentError('mercadopago', 'MercadoPago not configured', undefined, { operation: 'cancelSubscription', subscriptionId });
  }
  
  const preApproval = new PreApproval(client);
  const result = await preApproval.update({
    id: subscriptionId,
    body: {
      status: 'cancelled',
    },
  });
  
  console.log(`✅ [MercadoPago] Cancelled subscription ${subscriptionId}`);
  return result;
}

export async function fetchMercadoPagoPayment(paymentId: string | number): Promise<any> {
  const client = await getMercadoPagoClient();
  if (!client) {
    throw new PaymentError('mercadopago', 'MercadoPago not configured', undefined, { operation: 'fetchPayment', paymentId });
  }
  
  const payment = new Payment(client);
  return await payment.get({ id: String(paymentId) });
}

export async function verifyMercadoPagoWebhookSignature(
  body: string,
  xSignature: string,
  xRequestId: string
): Promise<boolean> {
  const webhookSecret = await getSetting('mercadopago_webhook_secret');
  if (!webhookSecret) {
    console.warn('⚠️ [MercadoPago] Webhook secret not configured - rejecting');
    return false;
  }
  
  if (!xSignature || !xRequestId) {
    console.warn('⚠️ [MercadoPago] Missing webhook signature headers');
    return false;
  }
  
  try {
    const parts = xSignature.split(',');
    let ts = '';
    let hash = '';
    
    for (const part of parts) {
      const [key, value] = part.split('=');
      if (key.trim() === 'ts') ts = value.trim();
      if (key.trim() === 'v1') hash = value.trim();
    }
    
    const manifest = `id:;request-id:${xRequestId};ts:${ts};`;
    const calculatedHash = crypto
      .createHmac('sha256', webhookSecret)
      .update(manifest)
      .digest('hex');
    
    return calculatedHash === hash;
  } catch (error) {
    console.error('❌ [MercadoPago] Webhook signature verification failed:', error);
    return false;
  }
}

export async function getMercadoPagoConfig(): Promise<{
  enabled: boolean;
  configured: boolean;
  publicKey: string | null;
  currency: MercadoPagoCurrencyConfig;
}> {
  const [enabled, configured, publicKey, currency] = await Promise.all([
    isMercadoPagoEnabled(),
    isMercadoPagoConfigured(),
    getMercadoPagoPublicKey(),
    getMercadoPagoCurrency(),
  ]);
  
  return {
    enabled,
    configured,
    publicKey,
    currency,
  };
}
