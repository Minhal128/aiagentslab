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
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { storage } from '../storage';
import { PaymentError } from '../utils/errors';

let razorpayInstance: Razorpay | null = null;

async function getSetting(key: string): Promise<any> {
  const setting = await storage.getGlobalSetting(key);
  return setting?.value ?? null;
}

export async function getRazorpayClient(): Promise<Razorpay | null> {
  // Check database first, then fall back to environment variables
  const dbKeyId = await getSetting('razorpay_key_id');
  const dbKeySecret = await getSetting('razorpay_key_secret');
  
  const keyId = dbKeyId || process.env.RAZORPAY_KEY_ID;
  const keySecret = dbKeySecret || process.env.RAZORPAY_KEY_SECRET;
  
  if (!keyId || !keySecret) {
    return null;
  }
  
  if (!razorpayInstance) {
    razorpayInstance = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });
  }
  
  return razorpayInstance;
}

export function resetRazorpayClient(): void {
  razorpayInstance = null;
}

export async function getActivePaymentGateway(): Promise<'stripe' | 'razorpay'> {
  const gateway = await getSetting('payment_gateway');
  return gateway === 'razorpay' ? 'razorpay' : 'stripe';
}

export async function isRazorpayConfigured(): Promise<boolean> {
  const dbKeyId = await getSetting('razorpay_key_id');
  const dbKeySecret = await getSetting('razorpay_key_secret');
  const envKeyId = process.env.RAZORPAY_KEY_ID;
  const envKeySecret = process.env.RAZORPAY_KEY_SECRET;
  
  return !!((dbKeyId && dbKeySecret) || (envKeyId && envKeySecret));
}

export async function isRazorpayEnabled(): Promise<boolean> {
  const enabled = await getSetting('razorpay_enabled');
  // Handle both boolean true and string 'true' (JSONB storage can return either)
  return enabled === true || enabled === 'true';
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
    console.error('❌ [Razorpay] Connection test failed:', error.message);
    return { success: false, error: error.message };
  }
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

export async function verifyPaymentSignature(params: {
  razorpay_order_id?: string;
  razorpay_subscription_id?: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}): Promise<boolean> {
  const keySecret = await getSetting('razorpay_key_secret');
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
  const webhookSecret = await getSetting('razorpay_webhook_secret');
  if (!webhookSecret) {
    console.warn('⚠️ [Razorpay] Webhook secret not configured, skipping signature verification');
    return true;
  }
  
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(body)
    .digest('hex');
  
  return expectedSignature === signature;
}

export async function fetchRazorpayPayment(paymentId: string): Promise<any> {
  const razorpay = await getRazorpayClient();
  if (!razorpay) {
    throw new PaymentError('razorpay', 'Razorpay not configured', paymentId, { operation: 'fetchPayment' });
  }
  
  return razorpay.payments.fetch(paymentId);
}

export async function captureRazorpayPayment(paymentId: string, amount: number, currency: string = 'INR'): Promise<any> {
  const razorpay = await getRazorpayClient();
  if (!razorpay) {
    throw new PaymentError('razorpay', 'Razorpay not configured', paymentId, { operation: 'capturePayment', amount, currency });
  }
  
  return razorpay.payments.capture(paymentId, Math.round(amount * 100), currency);
}

export async function refundRazorpayPayment(paymentId: string, amount?: number): Promise<any> {
  const razorpay = await getRazorpayClient();
  if (!razorpay) {
    throw new PaymentError('razorpay', 'Razorpay not configured', paymentId, { operation: 'refundPayment', amount });
  }
  
  const options: any = {};
  if (amount) {
    options.amount = Math.round(amount * 100);
  }
  
  return razorpay.payments.refund(paymentId, options);
}
