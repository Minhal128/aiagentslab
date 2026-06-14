'use strict';
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
import { storage } from '../storage';
import { PaymentAuditService } from '../engines/payment/audit';
import { db } from '../db';
import { campaigns, phoneNumbers } from '../../shared/schema';
import { eq, and, isNull } from 'drizzle-orm';

/**
 * Plan capabilities returned by getUserPlanCapabilities
 */
export interface PlanCapabilities {
  canChooseLlm: boolean;
  canPurchaseNumbers: boolean;
  useSystemPool: boolean;
  defaultLlmModel: string | null;
  planName: string;
  planDisplayName: string;
  features: Record<string, boolean>;
  sipEnabled: boolean;
  maxConcurrentSipCalls: number;
  sipEnginesAllowed: string[];
}

/**
 * Active subscription statuses that grant membership access.
 * 'active' - Subscription is active and payment is current
 * Note: Stripe's 'trialing', 'past_due' are mapped to 'active' in our webhook handlers
 */
const ACTIVE_SUBSCRIPTION_STATUSES = ['active'];

/**
 * Checks if a user has an active Pro membership.
 * Checks both the userSubscriptions table AND the users table fields.
 * Returns true if user has active membership, false otherwise.
 * 
 * This is a read-only check - it does NOT modify any records.
 * Syncing of user records should happen in webhook handlers.
 * 
 * IMPORTANT: Both checks require a valid expiry date in the future.
 * - Method 1: Subscription status must be 'active' AND currentPeriodEnd must be in the future
 * - Method 2: User planType must NOT be 'free' AND planExpiresAt must be in the future
 */
export async function hasActiveMembership(userId: string): Promise<boolean> {
  const user = await storage.getUser(userId);
  if (!user) return false;

  const now = new Date();

  // Method 1: Check userSubscriptions table for active PAID subscription
  // Requires: status is 'active' AND currentPeriodEnd is in the future AND plan is NOT Free
  const subscription = await storage.getUserSubscription(userId);
  if (subscription) {
    const hasActiveStatus = ACTIVE_SUBSCRIPTION_STATUSES.includes(subscription.status);
    const hasValidExpiry = subscription.currentPeriodEnd && new Date(subscription.currentPeriodEnd) > now;
    
    // Check that the plan is actually a paid plan (not Free)
    // Use OR logic: plan is paid if name is not 'free' OR if monthlyPrice > 0
    // This handles annual plans with $0/month, etc.
    let plan = subscription.plan;
    
    // If plan data not embedded but planId exists, fetch it directly
    if (!plan && subscription.planId) {
      plan = await storage.getPlan(subscription.planId);
    }
    
    // Determine if this is a paid plan
    const isPaidPlan = plan ? 
      (plan.name?.toLowerCase() !== 'free' || 
       parseFloat(plan.monthlyPrice?.toString() || '0') > 0) :
      true; // If plan still not found (data integrity issue), treat as paid to not block legitimate users
    
    if (hasActiveStatus && hasValidExpiry && isPaidPlan) {
      return true;
    }
  }

  // Method 2: Check user's planType and planExpiresAt fields (fallback)
  // Requires: planType is NOT 'free' AND planExpiresAt exists AND is in the future
  const isPaidPlan = user.planType && user.planType !== 'free';
  const hasValidUserExpiry = user.planExpiresAt && new Date(user.planExpiresAt) > now;
  
  if (isPaidPlan && hasValidUserExpiry) {
    return true;
  }

  return false;
}

/**
 * Gets the active plan name for a user.
 * Returns the plan name from the subscription if available, otherwise from user record.
 * Returns null if no active membership.
 */
export async function getActivePlanName(userId: string): Promise<string | null> {
  const now = new Date();
  
  // Check subscription first
  const subscription = await storage.getUserSubscription(userId);
  if (subscription) {
    const hasActiveStatus = ACTIVE_SUBSCRIPTION_STATUSES.includes(subscription.status);
    const hasValidExpiry = subscription.currentPeriodEnd && new Date(subscription.currentPeriodEnd) > now;
    
    if (hasActiveStatus && hasValidExpiry) {
      return subscription.plan?.name || 'Pro';
    }
  }

  // Fallback to user record
  const user = await storage.getUser(userId);
  if (user) {
    const isPaidPlan = user.planType && user.planType !== 'free';
    const hasValidUserExpiry = user.planExpiresAt && new Date(user.planExpiresAt) > now;
    
    if (isPaidPlan && hasValidUserExpiry) {
      return user.planType;
    }
  }

  return null;
}

/**
 * Syncs user record with subscription data.
 * Should be called from webhook handlers when subscription status changes.
 */
export async function syncUserWithSubscription(userId: string): Promise<void> {
  const subscription = await storage.getUserSubscription(userId);
  
  if (!subscription) {
    return;
  }

  // Get the plan name from the subscription
  const planName = subscription.plan?.name || 'pro';
  
  if (subscription.status === 'active' && new Date(subscription.currentPeriodEnd) > new Date()) {
    await storage.updateUser(userId, {
      planType: planName,
      planExpiresAt: subscription.currentPeriodEnd,
    });
  } else if (subscription.status === 'cancelled' || subscription.status === 'expired') {
    await storage.updateUser(userId, {
      planType: 'free',
      planExpiresAt: null,
    });
  }
}

/**
 * Applies plan credits to user's account when subscription is activated.
 * This should be called when a NEW subscription is created or when upgrading plans.
 * 
 * @param userId - The user ID
 * @param planId - The plan ID being activated
 * @param gateway - Payment gateway used (for audit logging)
 * @param transactionId - Transaction reference (for deduplication)
 * @returns The number of credits applied, or 0 if already applied
 */
export async function applyPlanCredits(
  userId: string,
  planId: string,
  gateway: 'stripe' | 'razorpay' | 'paypal' | 'paystack' | 'mercadopago',
  transactionId: string
): Promise<number> {
  const plan = await storage.getPlan(planId);
  if (!plan || !plan.includedCredits || plan.includedCredits <= 0) {
    console.log(`[Membership] No credits to apply for plan ${planId}`);
    return 0;
  }

  const creditsToAdd = plan.includedCredits;
  const creditRefId = `plan_credits_${gateway}_${transactionId}`;

  try {
    // Use addCreditsAtomic for deduplication - it will fail on duplicate stripePaymentId
    await storage.addCreditsAtomic(
      userId,
      creditsToAdd,
      `${plan.displayName} Plan - Included Credits`,
      creditRefId
    );

    console.log(`✅ [Membership] Applied ${creditsToAdd} credits to user ${userId} from ${plan.displayName} plan`);

    // Log the credit award for audit
    await PaymentAuditService.logCreditsAwarded(
      gateway,
      userId,
      transactionId,
      creditsToAdd,
      { planName: plan.name, planId: plan.id, reason: 'plan_subscription' }
    );

    // If upgrading to Pro, remove system pool numbers from campaigns
    // Pro users cannot use system pool numbers - they must purchase their own
    if (plan.name === 'pro' || plan.useSystemPool === false) {
      const removedCount = await removeSystemPoolNumbersFromCampaigns(userId);
      if (removedCount > 0) {
        console.log(`✅ [Membership] Removed ${removedCount} system pool number(s) from campaigns for upgraded user ${userId}`);
      }
    }

    return creditsToAdd;
  } catch (error: any) {
    // If duplicate, credits were already applied
    if (error.message?.includes('unique') || error.message?.includes('duplicate')) {
      console.log(`[Membership] Plan credits already applied for transaction ${transactionId}`);
      return 0;
    }
    throw error;
  }
}

/**
 * Gets the plan capabilities for a user.
 * Returns features like canChooseLlm, canPurchaseNumbers, useSystemPool.
 * Checks subscription first, falls back to user's planType.
 */
export async function getUserPlanCapabilities(userId: string): Promise<PlanCapabilities> {
  const now = new Date();
  
  // Default free plan capabilities
  const defaultCapabilities: PlanCapabilities = {
    canChooseLlm: false,
    canPurchaseNumbers: false,
    useSystemPool: true,
    defaultLlmModel: 'gpt-4o-mini',
    planName: 'free',
    planDisplayName: 'Free',
    features: {},
    sipEnabled: false,
    maxConcurrentSipCalls: 0,
    sipEnginesAllowed: [],
  };

  // Check subscription first
  const subscription = await storage.getUserSubscription(userId);
  if (subscription) {
    const hasActiveStatus = ACTIVE_SUBSCRIPTION_STATUSES.includes(subscription.status);
    const hasValidExpiry = !subscription.currentPeriodEnd || new Date(subscription.currentPeriodEnd) > now;
    
    if (hasActiveStatus && hasValidExpiry && subscription.plan) {
      const plan = subscription.plan;
      return {
        canChooseLlm: plan.canChooseLlm ?? false,
        canPurchaseNumbers: plan.canPurchaseNumbers ?? false,
        useSystemPool: plan.useSystemPool ?? true,
        defaultLlmModel: plan.defaultLlmModel ?? null,
        planName: plan.name,
        planDisplayName: plan.displayName,
        features: (plan.features as Record<string, boolean>) || {},
        sipEnabled: plan.sipEnabled ?? false,
        maxConcurrentSipCalls: plan.maxConcurrentSipCalls ?? 0,
        sipEnginesAllowed: (plan.sipEnginesAllowed as string[]) ?? [],
      };
    }
  }

  // Fallback: check user's planType and fetch that plan
  const user = await storage.getUser(userId);
  if (user && user.planType && user.planType !== 'free') {
    const hasValidExpiry = !user.planExpiresAt || new Date(user.planExpiresAt) > now;
    if (hasValidExpiry) {
      // Look up the plan by name
      const allPlans = await storage.getAllPlans();
      const userPlan = allPlans.find(p => p.name === user.planType);
      if (userPlan) {
        return {
          canChooseLlm: userPlan.canChooseLlm ?? false,
          canPurchaseNumbers: userPlan.canPurchaseNumbers ?? false,
          useSystemPool: userPlan.useSystemPool ?? true,
          defaultLlmModel: userPlan.defaultLlmModel ?? null,
          planName: userPlan.name,
          planDisplayName: userPlan.displayName,
          features: (userPlan.features as Record<string, boolean>) || {},
          sipEnabled: userPlan.sipEnabled ?? false,
          maxConcurrentSipCalls: userPlan.maxConcurrentSipCalls ?? 0,
          sipEnginesAllowed: (userPlan.sipEnginesAllowed as string[]) ?? [],
        };
      }
    }
  }

  // Return free plan defaults
  const allPlans = await storage.getAllPlans();
  const freePlan = allPlans.find(p => p.name === 'free');
  if (freePlan) {
    return {
      canChooseLlm: freePlan.canChooseLlm ?? false,
      canPurchaseNumbers: freePlan.canPurchaseNumbers ?? false,
      useSystemPool: freePlan.useSystemPool ?? true,
      defaultLlmModel: freePlan.defaultLlmModel ?? 'gpt-4o-mini',
      planName: freePlan.name,
      planDisplayName: freePlan.displayName,
      features: (freePlan.features as Record<string, boolean>) || {},
      sipEnabled: freePlan.sipEnabled ?? false,
      maxConcurrentSipCalls: freePlan.maxConcurrentSipCalls ?? 0,
      sipEnginesAllowed: (freePlan.sipEnginesAllowed as string[]) ?? [],
    };
  }

  return defaultCapabilities;
}

/**
 * Removes system pool numbers from user's campaigns.
 * Called when a Free user upgrades to Pro - they can no longer use system numbers.
 * 
 * @param userId - The user ID
 * @returns Number of campaigns that had their phone number removed
 */
export async function removeSystemPoolNumbersFromCampaigns(userId: string): Promise<number> {
  try {
    // Find all campaigns for this user that use system pool numbers
    const userCampaigns = await db
      .select({
        campaignId: campaigns.id,
        phoneNumberId: campaigns.phoneNumberId,
        phoneNumber: phoneNumbers.phoneNumber,
        isSystemPool: phoneNumbers.isSystemPool,
        phoneUserId: phoneNumbers.userId,
      })
      .from(campaigns)
      .leftJoin(phoneNumbers, eq(campaigns.phoneNumberId, phoneNumbers.id))
      .where(eq(campaigns.userId, userId));

    // Filter campaigns using system pool numbers
    const campaignsWithSystemPool = userCampaigns.filter(c => 
      c.phoneNumberId && 
      c.isSystemPool === true && 
      c.phoneUserId === null
    );

    if (campaignsWithSystemPool.length === 0) {
      console.log(`[Membership] No system pool numbers to remove for user ${userId}`);
      return 0;
    }

    // Remove system pool numbers from these campaigns
    const campaignIds = campaignsWithSystemPool.map(c => c.campaignId);
    
    for (const campaignId of campaignIds) {
      await db
        .update(campaigns)
        .set({ phoneNumberId: null })
        .where(eq(campaigns.id, campaignId));
    }

    console.log(`✅ [Membership] Removed system pool numbers from ${campaignIds.length} campaign(s) for user ${userId}`);
    
    return campaignIds.length;
  } catch (error: any) {
    console.error(`❌ [Membership] Error removing system pool numbers from campaigns:`, error.message);
    return 0;
  }
}
