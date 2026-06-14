'use strict';
/**
 * Payment Audit Service
 * Logs all payment-related actions for compliance and debugging
 */

import { PaymentGateway, AuditLogEntry } from './types';
import { logger } from '../../utils/logger';

const SOURCE = 'PaymentAudit';

export class PaymentAuditService {
  private static async log(entry: AuditLogEntry): Promise<void> {
    const logMessage = `[${entry.action}] Gateway: ${entry.gateway || 'N/A'}, User: ${entry.userId || 'N/A'}, Transaction: ${entry.transactionId || 'N/A'}`;
    
    logger.info(logMessage, entry.details, SOURCE);
  }

  static async logPaymentInitiated(
    gateway: PaymentGateway,
    userId: string,
    type: 'subscription' | 'credits',
    amount: number,
    currency: string,
    details?: Record<string, any>
  ): Promise<void> {
    await this.log({
      action: 'payment_initiated',
      gateway,
      userId,
      details: { type, amount, currency, ...details },
      timestamp: new Date(),
    });
  }

  static async logPaymentCompleted(
    gateway: PaymentGateway,
    userId: string,
    transactionId: string,
    amount: number,
    currency: string,
    details?: Record<string, any>
  ): Promise<void> {
    await this.log({
      action: 'payment_completed',
      gateway,
      userId,
      transactionId,
      details: { amount, currency, ...details },
      timestamp: new Date(),
    });
  }

  static async logPaymentFailed(
    gateway: PaymentGateway,
    userId: string,
    error: string,
    details?: Record<string, any>
  ): Promise<void> {
    await this.log({
      action: 'payment_failed',
      gateway,
      userId,
      details: { error, ...details },
      timestamp: new Date(),
    });
  }

  static async logSubscriptionCreated(
    gateway: PaymentGateway,
    userId: string,
    subscriptionId: string,
    planId: string,
    billingPeriod: string,
    details?: Record<string, any>
  ): Promise<void> {
    await this.log({
      action: 'subscription_created',
      gateway,
      userId,
      subscriptionId,
      details: { planId, billingPeriod, ...details },
      timestamp: new Date(),
    });
  }

  static async logSubscriptionRenewed(
    gateway: PaymentGateway,
    userId: string,
    subscriptionId: string,
    amount: number,
    currency: string,
    details?: Record<string, any>
  ): Promise<void> {
    await this.log({
      action: 'subscription_renewed',
      gateway,
      userId,
      subscriptionId,
      details: { amount, currency, ...details },
      timestamp: new Date(),
    });
  }

  static async logSubscriptionCancelled(
    gateway: PaymentGateway,
    userId: string,
    subscriptionId: string,
    cancelAtPeriodEnd: boolean,
    details?: Record<string, any>
  ): Promise<void> {
    await this.log({
      action: 'subscription_cancelled',
      gateway,
      userId,
      subscriptionId,
      details: { cancelAtPeriodEnd, ...details },
      timestamp: new Date(),
    });
  }

  static async logRefundInitiated(
    gateway: PaymentGateway,
    userId: string,
    transactionId: string,
    refundId: string,
    amount: number,
    currency: string,
    adminId?: string,
    details?: Record<string, any>
  ): Promise<void> {
    await this.log({
      action: 'refund_initiated',
      gateway,
      userId,
      transactionId,
      refundId,
      adminId,
      details: { amount, currency, ...details },
      timestamp: new Date(),
    });
  }

  static async logRefundCompleted(
    gateway: PaymentGateway,
    userId: string,
    transactionId: string,
    refundId: string,
    amount: number,
    currency: string,
    details?: Record<string, any>
  ): Promise<void> {
    await this.log({
      action: 'refund_completed',
      gateway,
      userId,
      transactionId,
      refundId,
      details: { amount, currency, ...details },
      timestamp: new Date(),
    });
  }

  static async logDisputeOpened(
    gateway: PaymentGateway,
    userId: string,
    transactionId: string,
    disputeId: string,
    amount: number,
    currency: string,
    reason?: string,
    details?: Record<string, any>
  ): Promise<void> {
    await this.log({
      action: 'dispute_opened',
      gateway,
      userId,
      transactionId,
      disputeId,
      details: { amount, currency, reason, ...details },
      timestamp: new Date(),
    });
  }

  static async logDisputeResolved(
    gateway: PaymentGateway,
    userId: string,
    transactionId: string,
    disputeId: string,
    outcome: 'won' | 'lost',
    details?: Record<string, any>
  ): Promise<void> {
    await this.log({
      action: 'dispute_resolved',
      gateway,
      userId,
      transactionId,
      disputeId,
      details: { outcome, ...details },
      timestamp: new Date(),
    });
  }

  static async logWebhookReceived(
    gateway: PaymentGateway,
    eventType: string,
    success: boolean,
    details?: Record<string, any>
  ): Promise<void> {
    await this.log({
      action: 'webhook_received',
      gateway,
      details: { eventType, success, ...details },
      timestamp: new Date(),
    });
  }

  static async logConfigurationChanged(
    gateway: PaymentGateway | 'elevenlabs',
    adminId: string,
    field: string,
    ipAddress?: string,
    details?: Record<string, any>
  ): Promise<void> {
    await this.log({
      action: 'configuration_changed',
      gateway: gateway as PaymentGateway,
      adminId,
      ipAddress,
      details: { field, ...details },
      timestamp: new Date(),
    });
  }

  static async logCreditsAwarded(
    gateway: PaymentGateway,
    userId: string,
    transactionId: string,
    credits: number,
    details?: Record<string, any>
  ): Promise<void> {
    await this.log({
      action: 'credits_awarded',
      gateway,
      userId,
      transactionId,
      details: { credits, ...details },
      timestamp: new Date(),
    });
  }

  static async logCreditsReversed(
    gateway: PaymentGateway,
    userId: string,
    transactionId: string,
    credits: number,
    reason: string,
    details?: Record<string, any>
  ): Promise<void> {
    await this.log({
      action: 'credits_reversed',
      gateway,
      userId,
      transactionId,
      details: { credits, reason, ...details },
      timestamp: new Date(),
    });
  }
}

export const paymentAudit = PaymentAuditService;
