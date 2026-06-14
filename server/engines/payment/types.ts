'use strict';
/**
 * Payment Engine Types
 * Shared types and interfaces for all payment gateways
 */

export type PaymentGateway = 'stripe' | 'razorpay' | 'paypal' | 'paystack' | 'mercadopago';

export type PaymentType = 'subscription' | 'credits' | 'one_time';

export type PaymentStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'refunded' | 'disputed' | 'cancelled';

export type SubscriptionStatus = 'active' | 'past_due' | 'cancelled' | 'suspended' | 'trialing' | 'incomplete';

export type RefundStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type DisputeStatus = 'open' | 'under_review' | 'won' | 'lost' | 'closed';

export interface WebhookConfig {
  gateway: PaymentGateway;
  webhookUrl: string;
  webhookSecret: string | null;
  lastReceivedAt: Date | null;
  isConfigured: boolean;
  testResult?: {
    success: boolean;
    message: string;
    testedAt: Date;
  };
}

export interface GatewayCredentials {
  gateway: PaymentGateway;
  isConfigured: boolean;
  isEnabled: boolean;
  publicKey?: string;
  currency?: string;
  currencySymbol?: string;
  mode?: 'live' | 'sandbox' | 'test';
}

export interface PaymentResult {
  success: boolean;
  transactionId?: string;
  gatewayTransactionId?: string;
  error?: string;
  errorCode?: string;
  metadata?: Record<string, any>;
}

export interface RefundResult {
  success: boolean;
  refundId?: string;
  gatewayRefundId?: string;
  amount?: number;
  currency?: string;
  error?: string;
}

export interface VerifySessionParams {
  sessionId?: string;
  paymentId?: string;
  orderId?: string;
  reference?: string;
  subscriptionId?: string;
  signature?: string;
}

export interface VerifySessionResult {
  success: boolean;
  status: 'completed' | 'pending' | 'failed' | 'already_processed';
  transactionId?: string;
  userId?: string;
  type?: PaymentType;
  amount?: number;
  currency?: string;
  credits?: number;
  planId?: string;
  error?: string;
}

export interface WebhookEvent {
  gateway: PaymentGateway;
  eventType: string;
  eventId?: string;
  rawPayload: string;
  signature?: string;
  headers: Record<string, string>;
  receivedAt: Date;
}

export interface WebhookProcessResult {
  success: boolean;
  eventType: string;
  processed: boolean;
  action?: string;
  error?: string;
  userId?: string;
  transactionId?: string;
}

export interface SubscriptionWebhookData {
  subscriptionId: string;
  userId?: string;
  planId?: string;
  status: SubscriptionStatus;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
  billingPeriod?: 'monthly' | 'yearly';
  amount?: number;
  currency?: string;
}

export interface PaymentWebhookData {
  paymentId: string;
  userId?: string;
  type: PaymentType;
  status: PaymentStatus;
  amount: number;
  currency: string;
  credits?: number;
  packageId?: string;
  planId?: string;
  subscriptionId?: string;
  metadata?: Record<string, any>;
}

export interface RefundWebhookData {
  refundId: string;
  originalPaymentId: string;
  amount: number;
  currency: string;
  status: RefundStatus;
  reason?: string;
  userId?: string;
}

export interface DisputeWebhookData {
  disputeId: string;
  originalPaymentId: string;
  amount: number;
  currency: string;
  status: DisputeStatus;
  reason?: string;
  userId?: string;
  evidence?: Record<string, any>;
}

export interface DunningConfig {
  maxRetries: number;
  retryIntervalDays: number[];
  gracePeriodDays: number;
  suspendAfterGracePeriod: boolean;
  sendEmailOnRetry: boolean;
  sendEmailOnSuspension: boolean;
}

export interface ReconciliationResult {
  gateway: PaymentGateway;
  checkedAt: Date;
  transactionsFound: number;
  transactionsSynced: number;
  subscriptionsSynced: number;
  errors: string[];
}

export interface AuditLogEntry {
  action: string;
  gateway?: PaymentGateway;
  userId?: string;
  transactionId?: string;
  subscriptionId?: string;
  refundId?: string;
  disputeId?: string;
  adminId?: string;
  details?: Record<string, any>;
  ipAddress?: string;
  timestamp: Date;
}

export const CURRENCY_SYMBOLS: Record<string, string> = {
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
  NGN: '₦',
  GHS: '₵',
  KES: 'KSh',
  ARS: '$',
  CLP: '$',
  COP: '$',
  PEN: 'S/',
  UYU: '$',
};

export function getCurrencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency.toUpperCase()] || currency.toUpperCase();
}

export function formatCurrency(amount: number | string, currency: string): string {
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  const symbol = getCurrencySymbol(currency);
  return `${symbol}${numAmount.toFixed(2)}`;
}

export const GLOBAL_SETTINGS_KEYS = {
  STRIPE_SECRET_KEY: 'stripe_secret_key',
  STRIPE_PUBLISHABLE_KEY: 'stripe_publishable_key',
  STRIPE_WEBHOOK_SECRET: 'stripe_webhook_secret',
  STRIPE_ENABLED: 'stripe_enabled',
  STRIPE_CURRENCY: 'stripe_currency',
  STRIPE_CURRENCY_LOCKED: 'stripe_currency_locked',
  STRIPE_LAST_WEBHOOK_AT: 'stripe_last_webhook_at',

  RAZORPAY_KEY_ID: 'razorpay_key_id',
  RAZORPAY_KEY_SECRET: 'razorpay_key_secret',
  RAZORPAY_WEBHOOK_SECRET: 'razorpay_webhook_secret',
  RAZORPAY_ENABLED: 'razorpay_enabled',
  RAZORPAY_LAST_WEBHOOK_AT: 'razorpay_last_webhook_at',

  PAYPAL_CLIENT_ID: 'paypal_client_id',
  PAYPAL_CLIENT_SECRET: 'paypal_client_secret',
  PAYPAL_WEBHOOK_ID: 'paypal_webhook_id',
  PAYPAL_ENABLED: 'paypal_enabled',
  PAYPAL_MODE: 'paypal_mode',
  PAYPAL_CURRENCY: 'paypal_currency',
  PAYPAL_LAST_WEBHOOK_AT: 'paypal_last_webhook_at',

  PAYSTACK_PUBLIC_KEY: 'paystack_public_key',
  PAYSTACK_SECRET_KEY: 'paystack_secret_key',
  PAYSTACK_WEBHOOK_SECRET: 'paystack_webhook_secret',
  PAYSTACK_ENABLED: 'paystack_enabled',
  PAYSTACK_CURRENCY: 'paystack_currency',
  PAYSTACK_LAST_WEBHOOK_AT: 'paystack_last_webhook_at',

  MERCADOPAGO_ACCESS_TOKEN: 'mercadopago_access_token',
  MERCADOPAGO_PUBLIC_KEY: 'mercadopago_public_key',
  MERCADOPAGO_WEBHOOK_SECRET: 'mercadopago_webhook_secret',
  MERCADOPAGO_ENABLED: 'mercadopago_enabled',
  MERCADOPAGO_CURRENCY: 'mercadopago_currency',
  MERCADOPAGO_LAST_WEBHOOK_AT: 'mercadopago_last_webhook_at',

  ELEVENLABS_HMAC_SECRET: 'elevenlabs_hmac_secret',
  ELEVENLABS_LAST_WEBHOOK_AT: 'elevenlabs_last_webhook_at',
} as const;
