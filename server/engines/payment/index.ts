'use strict';
/**
 * ============================================================
 * Payment Engine v1.0.0
 * ============================================================
 * A comprehensive, production-ready payment system supporting
 * multiple payment gateways with webhook management, refunds,
 * disputes, subscription lifecycle, and admin controls.
 * 
 * Supported Gateways:
 * - Stripe (Global)
 * - Razorpay (India)
 * - PayPal (Global)
 * - Paystack (Africa)
 * - MercadoPago (Latin America)
 * 
 * © 2025 Diploy — a brand of Bisht Technologies Private Limited
 * ============================================================
 */

export * from './types';
export * from './webhook-helper';

export { stripeRouter } from './gateways/stripe';
export { razorpayRouter } from './gateways/razorpay';
export { paystackRouter } from './gateways/paystack';
export { paypalRouter } from './gateways/paypal';
export { mercadopagoRouter } from './gateways/mercadopago';

export { invoiceService, generateInvoiceForTransaction } from './invoice-service';

export { PaymentAuditService } from './audit';

export const PAYMENT_ENGINE_VERSION = '1.0.0';

export function getPaymentEngineInfo() {
  return {
    version: PAYMENT_ENGINE_VERSION,
    gateways: ['stripe', 'razorpay', 'paypal', 'paystack', 'mercadopago'],
    features: [
      'Multi-gateway support',
      'Webhook management with DB secrets',
      'Verify-session fallback endpoints',
      'Refund and dispute handling',
      'Subscription lifecycle management',
      'Dunning for failed payments',
      'Invoice PDF generation',
      'Email notifications',
      'Admin dashboard',
      'Audit logging',
      'Reconciliation scheduler',
    ],
  };
}
