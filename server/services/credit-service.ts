/**
 * Centralized Credit Deduction Service
 * 
 * Provides atomic, idempotent credit deduction across all telephony engines.
 * Standardizes transaction types and prevents double charging.
 */

import { db } from '../db';
import { users, creditTransactions, globalSettings } from '@shared/schema';
import { eq, and, sql } from 'drizzle-orm';
import { logger } from '../utils/logger';

export type CreditEngine = 'elevenlabs-twilio' | 'plivo-openai' | 'twilio-openai' | 'elevenlabs-sip' | 'openai-sip' | 'plivo-elevenlabs';

/**
 * Check if a user has sufficient credits for a call (at least 1 credit).
 * This is a non-deducting balance check used as a pre-call gate.
 */
export async function checkUserCreditBalance(userId: string): Promise<{ hasCredits: boolean; balance: number }> {
  try {
    const result = await db
      .select({ credits: users.credits })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    
    const balance = Number(result[0]?.credits) || 0;
    return { hasCredits: balance > 0, balance };
  } catch (error: any) {
    logger.error(`Failed to check credit balance for user ${userId}: ${error.message}`, error, 'CreditService');
    return { hasCredits: false, balance: 0 };
  }
}

export interface CreditDeductionParams {
  userId: string;
  creditsToDeduct: number;
  callId: string;
  fromNumber: string;
  toNumber: string;
  durationSeconds: number;
  engine: CreditEngine;
}

export interface CreditDeductionResult {
  success: boolean;
  creditsDeducted: number;
  newBalance?: number;
  error?: string;
  alreadyDeducted?: boolean;
}

/**
 * Generate a unique, namespaced reference for idempotency.
 * Format: {engine}:{callId}
 */
function generateReference(engine: CreditEngine, callId: string): string {
  return `${engine}:${callId}`;
}

/**
 * Format a SIP endpoint to show a clean phone number with engine label
 * @param endpoint - The SIP URI or phone number (e.g., "sip:12708221598@sip.rtc.elevenlabs.io:5060;transport=tcp")
 * @returns Formatted string like "+12708221598 (ElevenLabs SIP)" or the original if not a SIP URI
 */
function formatSipEndpoint(endpoint: string | null | undefined): string {
  if (!endpoint) {
    return 'Unknown';
  }

  if (!endpoint.startsWith('sip:')) {
    return endpoint;
  }

  const sipMatch = endpoint.match(/^sip:(\+?\d+)@(.+?)(?::\d+)?(?:;.*)?$/);
  
  if (!sipMatch) {
    return endpoint;
  }

  const phoneNumber = sipMatch[1].startsWith('+') ? sipMatch[1] : `+${sipMatch[1]}`;
  const domain = sipMatch[2].toLowerCase();

  let engineLabel = 'SIP';
  if (domain.includes('elevenlabs')) {
    engineLabel = 'ElevenLabs SIP';
  } else if (domain.includes('openai')) {
    engineLabel = 'OpenAI SIP';
  }

  return `${phoneNumber} (${engineLabel})`;
}

/**
 * Atomically deducts credits from a user's balance with idempotency protection.
 * 
 * Features:
 * - Uses advisory lock to prevent concurrent deductions for same reference
 * - Atomic SQL update using GREATEST(0, credits - amount) to prevent negative balance
 * - Idempotent: Won't double-charge if called multiple times for same call
 * - Consistent transaction type: 'usage' with negative amount
 * - Per-user reference checking to prevent cross-tenant collisions
 */
export async function deductCallCredits(params: CreditDeductionParams): Promise<CreditDeductionResult> {
  const { userId, creditsToDeduct, callId, fromNumber, toNumber, durationSeconds, engine } = params;

  if (creditsToDeduct <= 0) {
    return { success: true, creditsDeducted: 0, alreadyDeducted: false };
  }

  const reference = generateReference(engine, callId);
  const description = `${engine.replace('-', '+')} call: ${formatSipEndpoint(fromNumber)} → ${formatSipEndpoint(toNumber)} (${durationSeconds}s)`;

  try {
    // Use database transaction with advisory lock for true atomic idempotency
    const result = await db.transaction(async (tx) => {
      // Generate deterministic lock keys using two 32-bit hashes
      // pg_advisory_xact_lock(int, int) accepts two 32-bit integers
      const userHash = hashCode32(userId);
      const refHash = hashCode32(reference);
      
      // Acquire advisory lock to serialize concurrent requests for this exact reference+userId
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${userHash}, ${refHash})`);

      // Check for existing transaction with same reference AND userId (tenant isolation)
      const existingTransactions = await tx
        .select()
        .from(creditTransactions)
        .where(and(
          eq(creditTransactions.reference, reference),
          eq(creditTransactions.userId, userId)
        ));

      if (existingTransactions.length > 0) {
        logger.info(`Credits already deducted for ${reference} - skipping duplicate`, undefined, 'CreditService');
        return { 
          success: true, 
          creditsDeducted: 0, 
          alreadyDeducted: true 
        } as CreditDeductionResult;
      }

      // Lock the user row and get current balance atomically
      // This prevents concurrent calls for same user from racing
      const lockResult = await tx.execute(
        sql`SELECT credits FROM users WHERE id = ${userId} FOR UPDATE`
      );
      const currentCredits = Number(lockResult.rows?.[0]?.credits) || 0;
      const actualDeduction = Math.min(creditsToDeduct, currentCredits);

      // If user has insufficient credits (partial or zero), return failure to allow retry
      // This ensures no free calls - user must have FULL credits required
      if (actualDeduction < creditsToDeduct) {
        logger.warn(
          `[${engine}] Insufficient credits for ${reference}. Balance: ${currentCredits}, Requested: ${creditsToDeduct}`,
          undefined,
          'CreditService'
        );

        // Fire-and-forget user-facing notification + email so users learn that
        // a call ended without being billed and can top up. Centralized here so
        // every engine (Twilio+OpenAI, Plivo, ElevenLabs, SIP) gets the same
        // treatment automatically.
        notifyCreditFailure({
          userId,
          callId,
          creditsRequired: creditsToDeduct,
          currentBalance: currentCredits,
          durationSeconds,
        });

        // Return failure so callers can handle appropriately
        // Don't record transaction to allow retry when credits are available
        return {
          success: false,
          creditsDeducted: 0,
          newBalance: currentCredits,
          alreadyDeducted: false,
          error: 'Insufficient credits',
        } as CreditDeductionResult;
      }

      // Atomically update user credits using actual deduction amount
      await tx
        .update(users)
        .set({
          credits: sql`${users.credits} - ${actualDeduction}`,
        })
        .where(eq(users.id, userId));

      // Record the credit transaction with actual deducted amount
      await tx.insert(creditTransactions).values({
        userId,
        type: 'usage',
        amount: -actualDeduction,
        description,
        reference,
      });

      // Get updated balance for logging
      const [updatedUser] = await tx
        .select({ credits: users.credits })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      const newBalance = updatedUser?.credits || 0;

      logger.info(
        `[${engine}] Deducted ${actualDeduction} credits for ${reference}. New balance: ${newBalance}`,
        undefined,
        'CreditService'
      );

      return {
        success: true,
        creditsDeducted: actualDeduction,
        newBalance,
        alreadyDeducted: false,
      } as CreditDeductionResult;
    });

    return result;

  } catch (error: any) {
    // Handle unique constraint violation (double submission caught by DB)
    if (error.code === '23505' || error.message?.includes('duplicate')) {
      logger.info(`Credits already deducted for ${reference} (caught by constraint)`, undefined, 'CreditService');
      return {
        success: true,
        creditsDeducted: 0,
        alreadyDeducted: true,
      };
    }

    logger.error(`Failed to deduct credits for ${reference}: ${error.message}`, error, 'CreditService');
    return {
      success: false,
      creditsDeducted: 0,
      error: error.message,
    };
  }
}

/**
 * In-memory throttle so a user receiving many failed bills back-to-back does not
 * get a flood of emails. The in-app notification is still created per call so
 * users see every affected call in the bell, but emails are limited to one per
 * user per CREDIT_FAIL_EMAIL_THROTTLE_MS window.
 */
const CREDIT_FAIL_EMAIL_THROTTLE_MS = 60 * 60 * 1000; // 1 hour
const lastCreditFailEmailAt = new Map<string, number>();

export function notifyCreditFailure(params: {
  userId: string;
  callId: string;
  creditsRequired: number;
  currentBalance: number;
  durationSeconds: number;
}): void {
  const { userId, callId, creditsRequired, currentBalance, durationSeconds } = params;

  // Always create an in-app notification (per call). Lazy-imported to avoid
  // circular import issues with services that depend on credit-service.
  (async () => {
    try {
      const { NotificationService } = await import('./notification-service');
      await NotificationService.notifyCallCreditFailed(userId, {
        callId,
        creditsRequired,
        currentBalance,
        durationSeconds,
      });
    } catch (err: any) {
      logger.error(
        `Failed to create call credit-failed notification for user ${userId}: ${err?.message || err}`,
        undefined,
        'CreditService'
      );
    }
  })();

  // Email is throttled per user.
  const now = Date.now();
  const last = lastCreditFailEmailAt.get(userId) || 0;
  if (now - last < CREDIT_FAIL_EMAIL_THROTTLE_MS) {
    return;
  }
  lastCreditFailEmailAt.set(userId, now);

  (async () => {
    try {
      const { emailService } = await import('./email-service');
      await emailService.sendCallCreditFailedAlert(userId, {
        callId,
        creditsRequired,
        currentBalance,
        durationSeconds,
      });
    } catch (err: any) {
      logger.error(
        `Failed to send call credit-failed email for user ${userId}: ${err?.message || err}`,
        undefined,
        'CreditService'
      );
    }
  })();
}

/**
 * Generate a deterministic 32-bit signed integer hash for PostgreSQL advisory locks.
 * Uses djb2 hash algorithm for good distribution within 32-bit range.
 */
function hashCode32(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash | 0; // Convert to 32-bit integer
  }
  return hash;
}

/**
 * Check if a user has sufficient credits for a call.
 */
export async function checkSufficientCredits(userId: string, requiredCredits: number = 1): Promise<boolean> {
  try {
    const [user] = await db
      .select({ credits: users.credits })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return (user?.credits || 0) >= requiredCredits;
  } catch (error: any) {
    logger.error(`Failed to check credits for user ${userId}: ${error.message}`, error, 'CreditService');
    return false;
  }
}

/**
 * Get user's current credit balance.
 */
export async function getUserCredits(userId: string): Promise<number> {
  try {
    const [user] = await db
      .select({ credits: users.credits })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return user?.credits || 0;
  } catch (error: any) {
    logger.error(`Failed to get credits for user ${userId}: ${error.message}`, error, 'CreditService');
    return 0;
  }
}

export type RefundGateway = 'stripe' | 'razorpay' | 'paypal' | 'paystack' | 'mercadopago';

export interface RefundParams {
  userId: string;
  creditsToReverse: number;
  gateway: RefundGateway;
  gatewayRefundId: string;
  transactionId: string;
  reason?: string;
}

export interface RefundResult {
  success: boolean;
  creditsReversed: number;
  newBalance?: number;
  transactionId?: string;
  error?: string;
  alreadyProcessed?: boolean;
}

/**
 * Atomically reverses credits for a refund with transaction logging.
 * 
 * Features:
 * - Uses advisory lock to prevent concurrent refunds for same gateway refund
 * - Idempotent: Won't double-process if called multiple times for same refund
 * - Creates audit trail in credit_transactions table
 * - Uses negative amount to indicate credit reversal
 */
export async function applyRefund(params: RefundParams): Promise<RefundResult> {
  const { userId, creditsToReverse, gateway, gatewayRefundId, transactionId, reason } = params;

  if (creditsToReverse <= 0) {
    return { success: true, creditsReversed: 0, alreadyProcessed: false };
  }

  const reference = `refund:${gateway}:${gatewayRefundId}`;
  const description = reason 
    ? `${gateway.charAt(0).toUpperCase() + gateway.slice(1)} refund: ${reason}` 
    : `${gateway.charAt(0).toUpperCase() + gateway.slice(1)} refund for transaction ${transactionId}`;

  try {
    const result = await db.transaction(async (tx) => {
      // Generate deterministic lock keys for this refund
      const userHash = hashCode32(userId);
      const refHash = hashCode32(reference);
      
      // Acquire advisory lock to serialize concurrent requests for this exact refund
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${userHash}, ${refHash})`);

      // Check for existing refund transaction (idempotency)
      const existingTransactions = await tx
        .select()
        .from(creditTransactions)
        .where(and(
          eq(creditTransactions.reference, reference),
          eq(creditTransactions.userId, userId)
        ));

      if (existingTransactions.length > 0) {
        logger.info(`Refund already processed for ${reference} - skipping duplicate`, undefined, 'CreditService');
        return { 
          success: true, 
          creditsReversed: 0, 
          alreadyProcessed: true 
        } as RefundResult;
      }

      // Lock the user row and get current balance
      const lockResult = await tx.execute(
        sql`SELECT credits FROM users WHERE id = ${userId} FOR UPDATE`
      );
      const currentCredits = Number(lockResult.rows?.[0]?.credits) || 0;
      
      // Deduct credits (can't go below 0)
      const actualReversal = Math.min(creditsToReverse, currentCredits);

      // Update user credits
      const newBalance = Math.max(0, currentCredits - actualReversal);
      await tx
        .update(users)
        .set({ credits: newBalance })
        .where(eq(users.id, userId));

      // Record the refund transaction (negative amount)
      const [insertedTransaction] = await tx.insert(creditTransactions).values({
        userId,
        type: 'refund',
        amount: -actualReversal,
        description,
        reference,
      }).returning();

      logger.info(
        `[${gateway}] Reversed ${actualReversal} credits for refund ${gatewayRefundId}. New balance: ${newBalance}`,
        undefined,
        'CreditService'
      );

      return {
        success: true,
        creditsReversed: actualReversal,
        newBalance,
        transactionId: insertedTransaction?.id,
        alreadyProcessed: false,
      } as RefundResult;
    });

    return result;

  } catch (error: any) {
    // Handle unique constraint violation (double submission caught by DB)
    if (error.code === '23505' || error.message?.includes('duplicate')) {
      logger.info(`Refund already processed for ${reference} (caught by constraint)`, undefined, 'CreditService');
      return {
        success: true,
        creditsReversed: 0,
        alreadyProcessed: true,
      };
    }

    logger.error(`Failed to apply refund for ${reference}: ${error.message}`, error, 'CreditService');
    return {
      success: false,
      creditsReversed: 0,
      error: error.message,
    };
  }
}

/**
 * Deduct credits for a SIP call.
 * Uses global settings for credit_price_per_minute to ensure consistent billing across all SIP engines.
 * 
 * @param sipCallId - The ID of the SIP call record
 * @param durationSeconds - Duration of the call in seconds
 * @param engine - The SIP engine ('elevenlabs-sip' or 'openai-sip')
 */
export async function deductSipCallCredits(
  sipCallId: string,
  durationSeconds: number,
  engine: 'elevenlabs-sip' | 'openai-sip'
): Promise<CreditDeductionResult> {
  try {
    // Get credit price per minute from global settings
    const [creditPriceSetting] = await db
      .select()
      .from(globalSettings)
      .where(eq(globalSettings.key, 'credit_price_per_minute'))
      .limit(1);
    
    let creditPricePerMinute = 1;
    if (creditPriceSetting?.value) {
      const parsed = Number(creditPriceSetting.value);
      if (Number.isFinite(parsed) && parsed >= 0) {
        creditPricePerMinute = parsed;
      } else {
        logger.warn(
          `Invalid credit_price_per_minute setting: ${creditPriceSetting.value}. Using default: 1`,
          undefined,
          'CreditService'
        );
      }
    }
    
    // Calculate credits (rounded up)
    const minutes = Math.ceil(durationSeconds / 60);
    const creditsToDeduct = Math.ceil(minutes * creditPricePerMinute);
    
    logger.info(
      `[SIP Credit] Duration: ${durationSeconds}s (${minutes} min) × ${creditPricePerMinute} = ${creditsToDeduct} credits`,
      undefined,
      'CreditService'
    );
    
    // Get SIP call details
    const sipCallResult = await db.execute(
      sql`SELECT id, user_id, from_number, to_number FROM sip_calls WHERE id = ${sipCallId} LIMIT 1`
    );
    const sipCall = sipCallResult.rows[0] as {
      id: string;
      user_id: string;
      from_number: string | null;
      to_number: string | null;
    } | undefined;
    
    if (!sipCall) {
      logger.error(`SIP Call ${sipCallId} not found`, undefined, 'CreditService');
      return { success: false, creditsDeducted: 0, error: 'SIP Call not found' };
    }
    
    if (!sipCall.user_id) {
      logger.warn(`Could not determine user for SIP call ${sipCallId}`, undefined, 'CreditService');
      return { success: false, creditsDeducted: 0, error: 'Could not determine user for SIP call' };
    }
    
    // Deduct credits
    const result = await deductCallCredits({
      userId: sipCall.user_id,
      creditsToDeduct,
      callId: sipCall.id,
      fromNumber: sipCall.from_number || 'Unknown',
      toNumber: sipCall.to_number || 'Unknown',
      durationSeconds,
      engine,
    });
    
    // Update credits_used in sip_calls table
    if (result.success) {
      await db.execute(sql`
        UPDATE sip_calls 
        SET credits_used = ${creditsToDeduct}, updated_at = NOW()
        WHERE id = ${sipCallId}
      `);
      logger.info(`Updated sip_calls.credits_used: ${creditsToDeduct}`, undefined, 'CreditService');
    }
    
    return result;
  } catch (error: any) {
    logger.error(`SIP Credit deduction error: ${error.message}`, error, 'CreditService');
    return { success: false, creditsDeducted: 0, error: error.message || 'Unknown error' };
  }
}
