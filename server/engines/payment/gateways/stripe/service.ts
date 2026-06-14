'use strict';
/**
 * Stripe Service
 * Client factory, configuration loaders, and utility functions
 */

import Stripe from 'stripe';
import { storage } from '../../../../storage';
import { PaymentError } from '../../../../utils/errors';
import { GLOBAL_SETTINGS_KEYS, getCurrencySymbol } from '../../types';

let stripeInstance: Stripe | null = null;

async function getSetting(key: string): Promise<any> {
  const setting = await storage.getGlobalSetting(key);
  return setting?.value ?? null;
}

export async function getStripeClient(): Promise<Stripe | null> {
  const dbSecretKey = await getSetting(GLOBAL_SETTINGS_KEYS.STRIPE_SECRET_KEY);
  const envSecretKey = process.env.STRIPE_SECRET_KEY || process.env.TESTING_STRIPE_SECRET_KEY;
  
  const secretKey = dbSecretKey || envSecretKey;
  
  if (!secretKey) {
    return null;
  }
  
  if (!stripeInstance) {
    stripeInstance = new Stripe(secretKey, {
      apiVersion: '2025-10-29.clover',
    });
  }
  
  return stripeInstance;
}

export function resetStripeClient(): void {
  stripeInstance = null;
}

export async function isStripeConfigured(): Promise<boolean> {
  const dbSecretKey = await getSetting(GLOBAL_SETTINGS_KEYS.STRIPE_SECRET_KEY);
  const dbPublishableKey = await getSetting(GLOBAL_SETTINGS_KEYS.STRIPE_PUBLISHABLE_KEY);
  const envSecretKey = process.env.STRIPE_SECRET_KEY;
  const envPublishableKey = process.env.VITE_STRIPE_PUBLIC_KEY;
  
  return !!((dbSecretKey && dbPublishableKey) || (envSecretKey && envPublishableKey));
}

export async function isStripeEnabled(): Promise<boolean> {
  const isConfigured = await isStripeConfigured();
  if (!isConfigured) return false;
  
  const enabled = await getSetting(GLOBAL_SETTINGS_KEYS.STRIPE_ENABLED);
  if (enabled === undefined || enabled === null) return false;
  return enabled === true || enabled === 'true';
}

export async function getStripePublicKey(): Promise<string | null> {
  const dbKey = await getSetting(GLOBAL_SETTINGS_KEYS.STRIPE_PUBLISHABLE_KEY);
  const envKey = process.env.VITE_STRIPE_PUBLIC_KEY;
  return dbKey || envKey || null;
}

export async function getStripeWebhookSecret(): Promise<string | null> {
  const dbSecret = await getSetting(GLOBAL_SETTINGS_KEYS.STRIPE_WEBHOOK_SECRET);
  const envSecret = process.env.STRIPE_WEBHOOK_SECRET;
  return dbSecret || envSecret || null;
}

export interface StripeCurrencyConfig {
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
    { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
    { code: 'CHF', symbol: 'CHF', name: 'Swiss Franc' },
    { code: 'SEK', symbol: 'kr', name: 'Swedish Krona' },
    { code: 'NOK', symbol: 'kr', name: 'Norwegian Krone' },
    { code: 'DKK', symbol: 'kr', name: 'Danish Krone' },
    { code: 'NZD', symbol: 'NZ$', name: 'New Zealand Dollar' },
    { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar' },
    { code: 'HKD', symbol: 'HK$', name: 'Hong Kong Dollar' },
    { code: 'MXN', symbol: 'MX$', name: 'Mexican Peso' },
    { code: 'BRL', symbol: 'R$', name: 'Brazilian Real' },
    { code: 'PLN', symbol: 'zł', name: 'Polish Zloty' },
    { code: 'CZK', symbol: 'Kč', name: 'Czech Koruna' },
    { code: 'ZAR', symbol: 'R', name: 'South African Rand' },
    { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham' },
    { code: 'THB', symbol: '฿', name: 'Thai Baht' },
    { code: 'MYR', symbol: 'RM', name: 'Malaysian Ringgit' },
    { code: 'PHP', symbol: '₱', name: 'Philippine Peso' },
    { code: 'TWD', symbol: 'NT$', name: 'Taiwan Dollar' },
    { code: 'KRW', symbol: '₩', name: 'South Korean Won' },
  ];
}

export async function getStripeCurrency(): Promise<StripeCurrencyConfig> {
  const currency = await getSetting(GLOBAL_SETTINGS_KEYS.STRIPE_CURRENCY);
  const locked = await getSetting(GLOBAL_SETTINGS_KEYS.STRIPE_CURRENCY_LOCKED);
  
  const currencyCode = currency || 'USD';
  const currencyLocked = locked === true || locked === 'true';
  
  return {
    currency: currencyCode.toUpperCase(),
    currencyLocked,
    symbol: getCurrencySymbol(currencyCode),
  };
}

export async function setStripeCurrency(currency: string): Promise<{ success: boolean; error?: string }> {
  const currentConfig = await getStripeCurrency();
  
  if (currentConfig.currencyLocked) {
    return { success: false, error: 'Stripe currency is locked and cannot be changed' };
  }
  
  const validCurrencies = getSupportedCurrencies().map(c => c.code);
  if (!validCurrencies.includes(currency.toUpperCase())) {
    return { success: false, error: `Invalid currency: ${currency}. Supported currencies: ${validCurrencies.join(', ')}` };
  }
  
  await storage.updateGlobalSetting(GLOBAL_SETTINGS_KEYS.STRIPE_CURRENCY, currency.toUpperCase());
  
  return { success: true };
}

export async function lockStripeCurrency(): Promise<{ success: boolean; error?: string }> {
  const currentConfig = await getStripeCurrency();
  
  if (currentConfig.currencyLocked) {
    return { success: false, error: 'Stripe currency is already locked' };
  }
  
  await storage.updateGlobalSetting(GLOBAL_SETTINGS_KEYS.STRIPE_CURRENCY_LOCKED, true);
  
  console.log(`🔒 [Stripe] Currency locked to ${currentConfig.currency}`);
  return { success: true };
}

export async function testStripeConnection(): Promise<{ success: boolean; error?: string }> {
  try {
    const stripe = await getStripeClient();
    if (!stripe) {
      return { success: false, error: 'Stripe not configured' };
    }
    
    await stripe.balance.retrieve();
    return { success: true };
  } catch (error: any) {
    const paymentError = new PaymentError(
      'stripe',
      `Stripe connection test failed: ${error.message}`,
      undefined,
      { operation: 'testConnection' }
    );
    console.error('❌ [Stripe] Connection test failed:', paymentError.message);
    return { success: false, error: paymentError.message };
  }
}

export async function getStripeConfig(): Promise<{
  enabled: boolean;
  configured: boolean;
  publicKey: string | null;
  currency: StripeCurrencyConfig;
}> {
  const [enabled, configured, publicKey, currency] = await Promise.all([
    isStripeEnabled(),
    isStripeConfigured(),
    getStripePublicKey(),
    getStripeCurrency(),
  ]);
  
  return {
    enabled,
    configured,
    publicKey: enabled ? publicKey : null,
    currency,
  };
}

export async function getOrCreateStripeCustomer(
  stripe: Stripe,
  userId: string,
  user: { email: string; name: string; stripeCustomerId?: string | null }
): Promise<string> {
  let stripeCustomerId = user.stripeCustomerId;

  if (stripeCustomerId) {
    try {
      await stripe.customers.retrieve(stripeCustomerId);
      return stripeCustomerId;
    } catch (error: any) {
      if (error.code === 'resource_missing') {
        console.log(`⚠️ [Stripe] Customer ${stripeCustomerId} not found, creating new customer for user ${userId}`);
        stripeCustomerId = null;
        await storage.updateUser(userId, { stripeCustomerId: null });
      } else {
        throw error;
      }
    }
  }

  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name,
    metadata: { userId }
  });
  
  console.log(`✅ [Stripe] Created new customer ${customer.id} for user ${userId}`);
  await storage.updateUser(userId, { stripeCustomerId: customer.id });
  return customer.id;
}

export async function initiateRefund(
  transactionId: string,
  reason?: string,
  adminId?: string
): Promise<{ success: boolean; refundId?: string; error?: string }> {
  try {
    const stripe = await getStripeClient();
    if (!stripe) {
      return { success: false, error: 'Stripe not configured' };
    }

    const transaction = await storage.getPaymentTransaction(transactionId);
    if (!transaction) {
      return { success: false, error: 'Transaction not found' };
    }

    if (transaction.gateway !== 'stripe') {
      return { success: false, error: 'Transaction is not a Stripe payment' };
    }

    if (transaction.status === 'refunded') {
      return { success: false, error: 'Transaction already refunded' };
    }

    const refund = await stripe.refunds.create({
      payment_intent: transaction.gatewayTransactionId!,
      reason: 'requested_by_customer',
      metadata: {
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
      gateway: 'stripe',
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
    console.error('❌ [Stripe] Refund failed:', error);
    return { success: false, error: error.message };
  }
}
