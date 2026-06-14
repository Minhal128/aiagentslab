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
import Stripe from 'stripe';
import { storage } from '../storage';
import { PaymentError } from '../utils/errors';

let stripeInstance: Stripe | null = null;

async function getSetting(key: string): Promise<any> {
  const setting = await storage.getGlobalSetting(key);
  return setting?.value ?? null;
}

export async function getStripeClient(): Promise<Stripe | null> {
  const dbSecretKey = await getSetting('stripe_secret_key');
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
  const dbSecretKey = await getSetting('stripe_secret_key');
  const dbPublishableKey = await getSetting('stripe_publishable_key');
  const envSecretKey = process.env.STRIPE_SECRET_KEY;
  const envPublishableKey = process.env.VITE_STRIPE_PUBLIC_KEY;
  
  return !!((dbSecretKey && dbPublishableKey) || (envSecretKey && envPublishableKey));
}

export async function isStripeEnabled(): Promise<boolean> {
  const isConfigured = await isStripeConfigured();
  if (!isConfigured) return false;
  
  const enabled = await getSetting('stripe_enabled');
  if (enabled === undefined || enabled === null) return false;
  return enabled === true || enabled === 'true';
}

export async function getStripePublicKey(): Promise<string | null> {
  const dbKey = await getSetting('stripe_publishable_key');
  const envKey = process.env.VITE_STRIPE_PUBLIC_KEY;
  return dbKey || envKey || null;
}

export interface StripeCurrencyConfig {
  currency: string;
  currencyLocked: boolean;
  symbol: string;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  INR: '₹',
  AUD: 'A$',
  CAD: 'C$',
  JPY: '¥',
  CNY: '¥',
  CHF: 'CHF',
  SEK: 'kr',
  NOK: 'kr',
  DKK: 'kr',
  NZD: 'NZ$',
  SGD: 'S$',
  HKD: 'HK$',
  MXN: 'MX$',
  BRL: 'R$',
  PLN: 'zł',
  CZK: 'Kč',
  ZAR: 'R',
  AED: 'د.إ',
  THB: '฿',
  MYR: 'RM',
  PHP: '₱',
  TWD: 'NT$',
  KRW: '₩',
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
  const currency = await getSetting('stripe_currency');
  const locked = await getSetting('stripe_currency_locked');
  
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
  
  await storage.updateGlobalSetting('stripe_currency', currency.toUpperCase());
  
  return { success: true };
}

export async function lockStripeCurrency(): Promise<{ success: boolean; error?: string }> {
  const currentConfig = await getStripeCurrency();
  
  if (currentConfig.currencyLocked) {
    return { success: false, error: 'Stripe currency is already locked' };
  }
  
  await storage.updateGlobalSetting('stripe_currency_locked', true);
  
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
