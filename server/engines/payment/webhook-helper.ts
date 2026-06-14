'use strict';
/**
 * Webhook Helper Service
 * Manages webhook URLs, secrets, and tracking for all payment gateways
 */

import { storage } from '../../storage';
import { PaymentGateway, WebhookConfig, GLOBAL_SETTINGS_KEYS } from './types';

function stripProtocol(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

function getValidatedFrontendUrl(): string {
  // In production, require APP_DOMAIN or APP_URL to be set
  if (process.env.NODE_ENV === 'production') {
    if (process.env.APP_DOMAIN) {
      // Strip any existing protocol to prevent "https://https://..." URLs
      const domain = stripProtocol(process.env.APP_DOMAIN);
      return `https://${domain}`;
    }
    if (process.env.APP_URL) {
      return process.env.APP_URL;
    }
    // Log error but don't crash - fallback for backwards compatibility
    console.error('[CONFIG ERROR] Production requires APP_DOMAIN or APP_URL to be set');
    return 'http://localhost:5000'; // Will fail gracefully
  }
  
  // Development environment
  if (process.env.APP_DOMAIN) {
    // Strip any existing protocol to prevent "https://https://..." URLs
    const domain = stripProtocol(process.env.APP_DOMAIN);
    return `https://${domain}`;
  }
  return process.env.APP_URL || 'http://localhost:5000';
}

export const FRONTEND_URL = getValidatedFrontendUrl();

export function getWebhookUrl(gateway: PaymentGateway): string {
  return `${FRONTEND_URL}/api/${gateway}/webhook`;
}

export function getElevenLabsWebhookUrl(): string {
  return `${FRONTEND_URL}/api/elevenlabs/webhook`;
}

export async function getWebhookSecret(gateway: PaymentGateway): Promise<string | null> {
  const keyMap: Record<PaymentGateway, string> = {
    stripe: GLOBAL_SETTINGS_KEYS.STRIPE_WEBHOOK_SECRET,
    razorpay: GLOBAL_SETTINGS_KEYS.RAZORPAY_WEBHOOK_SECRET,
    paypal: GLOBAL_SETTINGS_KEYS.PAYPAL_WEBHOOK_ID,
    paystack: GLOBAL_SETTINGS_KEYS.PAYSTACK_SECRET_KEY,
    mercadopago: GLOBAL_SETTINGS_KEYS.MERCADOPAGO_WEBHOOK_SECRET,
  };

  const settingKey = keyMap[gateway];
  const setting = await storage.getGlobalSetting(settingKey);
  
  if (setting?.value) {
    return setting.value as string;
  }

  const envKeyMap: Record<PaymentGateway, string> = {
    stripe: 'STRIPE_WEBHOOK_SECRET',
    razorpay: 'RAZORPAY_WEBHOOK_SECRET',
    paypal: 'PAYPAL_WEBHOOK_ID',
    paystack: 'PAYSTACK_SECRET_KEY',
    mercadopago: 'MERCADOPAGO_WEBHOOK_SECRET',
  };

  return process.env[envKeyMap[gateway]] || null;
}

export async function setWebhookSecret(gateway: PaymentGateway, secret: string): Promise<void> {
  const keyMap: Record<PaymentGateway, string> = {
    stripe: GLOBAL_SETTINGS_KEYS.STRIPE_WEBHOOK_SECRET,
    razorpay: GLOBAL_SETTINGS_KEYS.RAZORPAY_WEBHOOK_SECRET,
    paypal: GLOBAL_SETTINGS_KEYS.PAYPAL_WEBHOOK_ID,
    paystack: GLOBAL_SETTINGS_KEYS.PAYSTACK_SECRET_KEY,
    mercadopago: GLOBAL_SETTINGS_KEYS.MERCADOPAGO_WEBHOOK_SECRET,
  };

  await storage.updateGlobalSetting(keyMap[gateway], secret);
}

export async function getLastWebhookReceivedAt(gateway: PaymentGateway | 'elevenlabs'): Promise<Date | null> {
  const keyMap: Record<string, string> = {
    stripe: GLOBAL_SETTINGS_KEYS.STRIPE_LAST_WEBHOOK_AT,
    razorpay: GLOBAL_SETTINGS_KEYS.RAZORPAY_LAST_WEBHOOK_AT,
    paypal: GLOBAL_SETTINGS_KEYS.PAYPAL_LAST_WEBHOOK_AT,
    paystack: GLOBAL_SETTINGS_KEYS.PAYSTACK_LAST_WEBHOOK_AT,
    mercadopago: GLOBAL_SETTINGS_KEYS.MERCADOPAGO_LAST_WEBHOOK_AT,
    elevenlabs: GLOBAL_SETTINGS_KEYS.ELEVENLABS_LAST_WEBHOOK_AT,
  };

  const setting = await storage.getGlobalSetting(keyMap[gateway]);
  if (setting?.value) {
    return new Date(setting.value as string);
  }
  return null;
}

export async function recordWebhookReceived(gateway: PaymentGateway | 'elevenlabs'): Promise<void> {
  const keyMap: Record<string, string> = {
    stripe: GLOBAL_SETTINGS_KEYS.STRIPE_LAST_WEBHOOK_AT,
    razorpay: GLOBAL_SETTINGS_KEYS.RAZORPAY_LAST_WEBHOOK_AT,
    paypal: GLOBAL_SETTINGS_KEYS.PAYPAL_LAST_WEBHOOK_AT,
    paystack: GLOBAL_SETTINGS_KEYS.PAYSTACK_LAST_WEBHOOK_AT,
    mercadopago: GLOBAL_SETTINGS_KEYS.MERCADOPAGO_LAST_WEBHOOK_AT,
    elevenlabs: GLOBAL_SETTINGS_KEYS.ELEVENLABS_LAST_WEBHOOK_AT,
  };

  await storage.updateGlobalSetting(keyMap[gateway], new Date().toISOString());
}

export async function getElevenLabsHmacSecret(): Promise<string | null> {
  const setting = await storage.getGlobalSetting(GLOBAL_SETTINGS_KEYS.ELEVENLABS_HMAC_SECRET);
  if (setting?.value) {
    return setting.value as string;
  }
  return process.env.ELEVENLABS_HMAC_SECRET || null;
}

export async function setElevenLabsHmacSecret(secret: string): Promise<void> {
  await storage.updateGlobalSetting(GLOBAL_SETTINGS_KEYS.ELEVENLABS_HMAC_SECRET, secret);
}

export async function getWebhookConfig(gateway: PaymentGateway): Promise<WebhookConfig> {
  const [secret, lastReceivedAt] = await Promise.all([
    getWebhookSecret(gateway),
    getLastWebhookReceivedAt(gateway),
  ]);

  return {
    gateway,
    webhookUrl: getWebhookUrl(gateway),
    webhookSecret: secret,
    lastReceivedAt,
    isConfigured: !!secret,
  };
}

export async function getAllWebhookConfigs(): Promise<WebhookConfig[]> {
  const gateways: PaymentGateway[] = ['stripe', 'razorpay', 'paypal', 'paystack', 'mercadopago'];
  const configs = await Promise.all(gateways.map(getWebhookConfig));
  return configs;
}

export async function getElevenLabsWebhookConfig(): Promise<{
  webhookUrl: string;
  hmacSecret: string | null;
  lastReceivedAt: Date | null;
  isConfigured: boolean;
}> {
  const [hmacSecret, lastReceivedAt] = await Promise.all([
    getElevenLabsHmacSecret(),
    getLastWebhookReceivedAt('elevenlabs'),
  ]);

  return {
    webhookUrl: getElevenLabsWebhookUrl(),
    hmacSecret,
    lastReceivedAt,
    isConfigured: !!hmacSecret,
  };
}

export async function isGatewayEnabled(gateway: PaymentGateway): Promise<boolean> {
  const keyMap: Record<PaymentGateway, string> = {
    stripe: GLOBAL_SETTINGS_KEYS.STRIPE_ENABLED,
    razorpay: GLOBAL_SETTINGS_KEYS.RAZORPAY_ENABLED,
    paypal: GLOBAL_SETTINGS_KEYS.PAYPAL_ENABLED,
    paystack: GLOBAL_SETTINGS_KEYS.PAYSTACK_ENABLED,
    mercadopago: GLOBAL_SETTINGS_KEYS.MERCADOPAGO_ENABLED,
  };

  const setting = await storage.getGlobalSetting(keyMap[gateway]);
  
  if (gateway === 'stripe') {
    if (setting?.value === undefined || setting?.value === null) {
      return true;
    }
  }

  return setting?.value === true || setting?.value === 'true';
}

export async function isGatewayConfigured(gateway: PaymentGateway): Promise<boolean> {
  switch (gateway) {
    case 'stripe': {
      const [secretKey, publishableKey] = await Promise.all([
        storage.getGlobalSetting(GLOBAL_SETTINGS_KEYS.STRIPE_SECRET_KEY),
        storage.getGlobalSetting(GLOBAL_SETTINGS_KEYS.STRIPE_PUBLISHABLE_KEY),
      ]);
      const dbConfigured = !!(secretKey?.value && publishableKey?.value);
      const envConfigured = !!(process.env.STRIPE_SECRET_KEY && process.env.VITE_STRIPE_PUBLIC_KEY);
      return dbConfigured || envConfigured;
    }
    case 'razorpay': {
      const [keyId, keySecret] = await Promise.all([
        storage.getGlobalSetting(GLOBAL_SETTINGS_KEYS.RAZORPAY_KEY_ID),
        storage.getGlobalSetting(GLOBAL_SETTINGS_KEYS.RAZORPAY_KEY_SECRET),
      ]);
      return !!(keyId?.value && keySecret?.value);
    }
    case 'paypal': {
      const [clientId, clientSecret] = await Promise.all([
        storage.getGlobalSetting(GLOBAL_SETTINGS_KEYS.PAYPAL_CLIENT_ID),
        storage.getGlobalSetting(GLOBAL_SETTINGS_KEYS.PAYPAL_CLIENT_SECRET),
      ]);
      return !!(clientId?.value && clientSecret?.value);
    }
    case 'paystack': {
      const [publicKey, secretKey] = await Promise.all([
        storage.getGlobalSetting(GLOBAL_SETTINGS_KEYS.PAYSTACK_PUBLIC_KEY),
        storage.getGlobalSetting(GLOBAL_SETTINGS_KEYS.PAYSTACK_SECRET_KEY),
      ]);
      return !!(publicKey?.value && secretKey?.value);
    }
    case 'mercadopago': {
      const accessToken = await storage.getGlobalSetting(GLOBAL_SETTINGS_KEYS.MERCADOPAGO_ACCESS_TOKEN);
      return !!accessToken?.value;
    }
    default:
      return false;
  }
}

export async function getEnabledGateways(): Promise<PaymentGateway[]> {
  const gateways: PaymentGateway[] = ['stripe', 'razorpay', 'paypal', 'paystack', 'mercadopago'];
  const results = await Promise.all(
    gateways.map(async (gateway) => {
      const [enabled, configured] = await Promise.all([
        isGatewayEnabled(gateway),
        isGatewayConfigured(gateway),
      ]);
      return { gateway, enabled: enabled && configured };
    })
  );
  return results.filter(r => r.enabled).map(r => r.gateway);
}
