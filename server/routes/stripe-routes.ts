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
import express, { Request, Response, Router } from 'express';
import Stripe from 'stripe';
import { storage } from '../storage';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { NotificationService } from '../services/notification-service';
import { hasActiveMembership, syncUserWithSubscription } from '../services/membership-service';
import { 
  getStripeClient, 
  isStripeEnabled, 
  getStripeCurrency, 
  getStripeConfig,
  getSupportedCurrencies,
  setStripeCurrency,
  lockStripeCurrency,
  resetStripeClient
} from '../services/stripe-service';
import { queueFailedWebhook } from '../services/webhook-retry-service';
import { emailService } from '../services/email-service';
import { generateInvoiceForTransaction } from '../services/invoice-service';
import { FRONTEND_URL } from '../engines/payment/webhook-helper';
import { applyRefund } from '../services/credit-service';

const router: Router = express.Router();

/**
 * Gets or creates a valid Stripe customer for the user.
 * Handles the case where a stored customer ID is invalid (e.g., after switching Stripe accounts).
 */
async function getOrCreateValidStripeCustomer(
  stripe: Stripe,
  userId: string,
  user: { email: string; name: string; stripeCustomerId?: string | null }
): Promise<string> {
  let stripeCustomerId = user.stripeCustomerId;

  if (stripeCustomerId) {
    try {
      // Verify the customer exists in the current Stripe account
      await stripe.customers.retrieve(stripeCustomerId);
      return stripeCustomerId;
    } catch (error: any) {
      if (error.code === 'resource_missing') {
        console.log(`⚠️ [Stripe] Customer ${stripeCustomerId} not found, creating new customer for user ${userId}`);
        // Clear the invalid customer ID
        stripeCustomerId = null;
        await storage.updateUser(userId, { stripeCustomerId: null });
      } else {
        throw error;
      }
    }
  }

  // Create a new customer
  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name,
    metadata: { userId }
  });
  
  console.log(`✅ [Stripe] Created new customer ${customer.id} for user ${userId}`);
  await storage.updateUser(userId, { stripeCustomerId: customer.id });
  return customer.id;
}

// Stripe config endpoint - returns current configuration
router.get('/config', async (_req: Request, res: Response) => {
  try {
    const config = await getStripeConfig();
    const currencies = getSupportedCurrencies();
    res.json({
      ...config,
      supportedCurrencies: currencies,
    });
  } catch (error: any) {
    console.error('Error fetching Stripe config:', error);
    res.status(500).json({ error: 'Failed to fetch Stripe configuration' });
  }
});

// Create Payment Intent for embedded checkout (credit purchases)
router.post('/create-payment-intent', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    // Check if Stripe is enabled
    const isEnabled = await isStripeEnabled();
    if (!isEnabled) {
      return res.status(400).json({ error: 'Stripe payments are not enabled' });
    }
    
    const stripe = await getStripeClient();
    if (!stripe) {
      return res.status(400).json({ error: 'Stripe is not configured' });
    }
    
    const { packageId } = req.body;
    const userId = req.userId!;

    if (!packageId) {
      return res.status(400).json({ error: 'Package ID required' });
    }

    // Membership requirement - check both subscription table and user fields
    const hasMembership = await hasActiveMembership(userId);
    if (!hasMembership) {
      return res.status(403).json({ 
        error: 'Active Pro membership required to purchase credits. Please subscribe to a plan first.' 
      });
    }

    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const pkg = await storage.getCreditPackage(packageId);
    if (!pkg) {
      return res.status(404).json({ error: 'Credit package not found' });
    }

    // Get dynamic currency from settings
    const currencyConfig = await getStripeCurrency();
    
    // Get or create valid Stripe customer (handles invalid customer IDs)
    const stripeCustomerId = await getOrCreateValidStripeCustomer(stripe, userId, user);

    // Create payment intent with dynamic currency
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(parseFloat(pkg.price.toString()) * 100),
      currency: currencyConfig.currency.toLowerCase(),
      customer: stripeCustomerId,
      metadata: {
        userId,
        packageId,
        credits: pkg.credits.toString(),
        type: 'credits',
      },
      automatic_payment_methods: {
        enabled: true,
      },
    });

    res.json({ 
      clientSecret: paymentIntent.client_secret,
      packageName: pkg.name,
      credits: pkg.credits,
      amount: pkg.price,
      currency: currencyConfig.currency,
      currencySymbol: currencyConfig.symbol,
    });
  } catch (error: any) {
    console.error('Create payment intent error:', error);
    res.status(500).json({ error: 'Failed to create payment intent' });
  }
});

// Confirm payment and add credits
router.post('/confirm-payment', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const stripe = await getStripeClient();
    if (!stripe) {
      return res.status(400).json({ error: 'Stripe is not configured' });
    }
    
    const { paymentIntentId } = req.body;
    const userId = req.userId!;

    if (!paymentIntentId) {
      return res.status(400).json({ error: 'Payment intent ID required' });
    }

    // Retrieve payment intent from Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({ error: 'Payment not completed' });
    }

    // Verify this payment belongs to the user
    if (paymentIntent.metadata.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Add credits to user account
    const credits = parseInt(paymentIntent.metadata.credits || '0', 10);
    const packageId = paymentIntent.metadata.packageId;

    if (!credits || !packageId) {
      return res.status(400).json({ error: 'Invalid payment metadata' });
    }

    const pkg = await storage.getCreditPackage(packageId);
    if (!pkg) {
      return res.status(404).json({ error: 'Package not found' });
    }

    // Add credits using atomic transaction (handles idempotency via unique constraint)
    try {
      await storage.addCreditsAtomic(userId, credits, `Purchased ${pkg.name}`, paymentIntent.id);
      import('../services/sip-credit-guard').then(({ reconnectAfterRecharge }) => reconnectAfterRecharge(userId)).catch(() => {});
      res.json({ success: true, credits });
    } catch (error: any) {
      // If duplicate payment ID, it's already processed
      if (error.message?.includes('unique') || error.message?.includes('duplicate')) {
        res.json({ success: true, alreadyProcessed: true });
      } else {
        throw error;
      }
    }
  } catch (error: any) {
    console.error('Confirm payment error:', error);
    res.status(500).json({ error: 'Failed to confirm payment' });
  }
});

// Create Stripe Checkout Session for Subscriptions or Credits
router.post('/create-checkout-session', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    // Check if Stripe is enabled
    const isEnabled = await isStripeEnabled();
    if (!isEnabled) {
      return res.status(400).json({ error: 'Stripe payments are not enabled' });
    }
    
    const stripe = await getStripeClient();
    if (!stripe) {
      return res.status(400).json({ error: 'Stripe is not configured' });
    }
    
    const { type, planId, packageId, billingPeriod } = req.body;
    const userId = req.userId!;

    if (!type || !['subscription', 'credits'].includes(type)) {
      return res.status(400).json({ error: 'Invalid checkout type' });
    }

    // Get dynamic currency from settings
    const currencyConfig = await getStripeCurrency();

    // Get or create Stripe customer
    let user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Membership requirement for credit purchases - check both subscription table and user fields
    if (type === 'credits') {
      const hasMembership = await hasActiveMembership(userId);
      if (!hasMembership) {
        return res.status(403).json({ 
          error: 'Active Pro membership required to purchase credits. Please subscribe to a plan first.' 
        });
      }
    }

    // Get or create valid Stripe customer (handles invalid customer IDs)
    const stripeCustomerId = await getOrCreateValidStripeCustomer(stripe, userId, user);

    let sessionParams: Stripe.Checkout.SessionCreateParams = {
      customer: stripeCustomerId,
      mode: type === 'subscription' ? 'subscription' : 'payment',
      success_url: `${FRONTEND_URL}/app/billing?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/app/billing?canceled=true`,
      metadata: {
        userId,
        type,
      },
    };

    if (type === 'subscription') {
      // Membership subscription
      if (!planId || !billingPeriod) {
        return res.status(400).json({ error: 'Plan ID and billing period required for subscriptions' });
      }

      const plan = await storage.getPlan(planId);
      if (!plan) {
        return res.status(404).json({ error: 'Plan not found' });
      }

      const priceId = billingPeriod === 'yearly' 
        ? plan.stripeYearlyPriceId 
        : plan.stripeMonthlyPriceId;

      if (!priceId) {
        return res.status(400).json({ error: 'Stripe price not configured for this plan' });
      }

      sessionParams.line_items = [{
        price: priceId,
        quantity: 1,
      }];
      sessionParams.metadata!.planId = planId;
      sessionParams.metadata!.billingPeriod = billingPeriod;
      
      // Set subscription metadata so webhook events can map back to user
      sessionParams.subscription_data = {
        metadata: {
          userId,
          planId,
        },
      };
    } else {
      // Credits purchase
      if (!packageId) {
        return res.status(400).json({ error: 'Package ID required for credit purchase' });
      }

      const pkg = await storage.getCreditPackage(packageId);
      if (!pkg) {
        return res.status(404).json({ error: 'Credit package not found' });
      }

      sessionParams.line_items = [{
        price_data: {
          currency: currencyConfig.currency.toLowerCase(),
          product_data: {
            name: pkg.name,
            description: pkg.description || `${pkg.credits} credits`,
          },
          unit_amount: Math.round(parseFloat(pkg.price.toString()) * 100), // Convert to cents
        },
        quantity: 1,
      }];
      sessionParams.metadata!.packageId = packageId;
      sessionParams.metadata!.credits = pkg.credits.toString();
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    res.json({ url: session.url });
  } catch (error: any) {
    console.error('Stripe checkout session error:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Upgrade/Downgrade Subscription (Change Plan)
router.post('/change-plan', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const stripe = await getStripeClient();
    if (!stripe) {
      return res.status(400).json({ error: 'Stripe is not configured' });
    }
    
    const userId = req.userId!;
    const { newPlanId, billingPeriod } = req.body;

    if (!newPlanId) {
      return res.status(400).json({ error: 'New plan ID is required' });
    }

    // Get current subscription
    const userSub = await storage.getUserSubscription(userId);
    if (!userSub || !userSub.stripeSubscriptionId) {
      return res.status(404).json({ error: 'No active subscription found' });
    }

    // Get the new plan
    const newPlan = await storage.getPlan(newPlanId);
    if (!newPlan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    // Determine which price to use based on billing period
    const period = billingPeriod || userSub.billingPeriod || 'monthly';
    const newPriceId = period === 'yearly' 
      ? newPlan.stripeYearlyPriceId 
      : newPlan.stripeMonthlyPriceId;

    if (!newPriceId) {
      return res.status(400).json({ error: 'Stripe price not configured for this plan' });
    }

    // Retrieve current Stripe subscription
    const stripeSubscription = await stripe.subscriptions.retrieve(userSub.stripeSubscriptionId);
    
    // Get the current subscription item ID
    const currentItemId = stripeSubscription.items.data[0]?.id;
    if (!currentItemId) {
      return res.status(500).json({ error: 'Could not find subscription item' });
    }

    // Update subscription with new price
    // proration_behavior: 'none' means user switches immediately but pays new price next billing cycle
    const updatedSubscription = await stripe.subscriptions.update(userSub.stripeSubscriptionId, {
      items: [{
        id: currentItemId,
        price: newPriceId,
      }],
      proration_behavior: 'none', // No prorated charges - change takes effect at next renewal
      metadata: {
        userId,
        planId: newPlanId,
      },
    });

    // Update local database
    await storage.updateUserSubscription(userSub.id, {
      planId: newPlanId,
      billingPeriod: period,
    });

    // Update user's plan type
    await storage.updateUser(userId, {
      planType: newPlan.name,
    });

    console.log(`✅ User ${userId} changed plan to ${newPlan.name} (${period})`);

    res.json({ 
      success: true,
      message: `Plan changed to ${newPlan.displayName}. New pricing takes effect at your next billing cycle.`,
      newPlan: {
        id: newPlan.id,
        name: newPlan.displayName,
        billingPeriod: period,
      },
      currentPeriodEnd: new Date((updatedSubscription as any).current_period_end * 1000),
    });
  } catch (error: any) {
    console.error('Change plan error:', error);
    res.status(500).json({ error: 'Failed to change plan' });
  }
});

// Reactivate Cancelled Subscription (undo cancel_at_period_end)
router.post('/reactivate-subscription', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const stripe = await getStripeClient();
    if (!stripe) {
      return res.status(400).json({ error: 'Stripe is not configured' });
    }
    
    const userId = req.userId!;
    
    // Get user's subscription
    const subscription = await storage.getUserSubscription(userId);
    if (!subscription || !subscription.stripeSubscriptionId) {
      return res.status(404).json({ error: 'No subscription found' });
    }

    if (!subscription.cancelAtPeriodEnd) {
      return res.status(400).json({ error: 'Subscription is not set to cancel' });
    }

    // Reactivate by setting cancel_at_period_end to false
    await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });

    // Update local database
    await storage.updateUserSubscription(subscription.id, {
      cancelAtPeriodEnd: false,
    });

    console.log(`✅ User ${userId} reactivated their subscription`);

    res.json({ 
      success: true,
      message: 'Subscription has been reactivated. You will continue to be billed normally.',
    });
  } catch (error: any) {
    console.error('Reactivate subscription error:', error);
    res.status(500).json({ error: 'Failed to reactivate subscription' });
  }
});

// Cancel Subscription
router.post('/cancel-subscription', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const stripe = await getStripeClient();
    if (!stripe) {
      return res.status(400).json({ error: 'Stripe is not configured' });
    }
    
    const userId = req.userId!;
    
    // Get user's subscription
    const subscription = await storage.getUserSubscription(userId);
    if (!subscription || !subscription.stripeSubscriptionId) {
      return res.status(404).json({ error: 'No active subscription found' });
    }

    // Set subscription to cancel at period end
    await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    // Update local database
    await storage.updateUserSubscription(subscription.id, {
      cancelAtPeriodEnd: true,
    });

    res.json({ 
      message: 'Subscription will be canceled at the end of the billing period',
      currentPeriodEnd: subscription.currentPeriodEnd 
    });
  } catch (error: any) {
    console.error('Cancel subscription error:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

// Stripe Webhook Handler
router.post('/webhook', async (req, res) => {
  const stripe = await getStripeClient();
  if (!stripe) {
    return res.status(400).send('Stripe is not configured');
  }
  
  const rawReq = req as Request & { rawBody?: Buffer };
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig) {
    return res.status(400).send('No signature provided');
  }

  let event: Stripe.Event;

  try {
    // Use rawBody saved by express.json verify callback
    const rawBody = rawReq.rawBody || Buffer.from(JSON.stringify(req.body));
    
    // In development/testing, skip signature verification if no webhook secret
    if (!webhookSecret) {
      event = req.body as Stripe.Event;
    } else {
      event = stripe.webhooks.constructEvent(rawBody, sig as string, webhookSecret);
    }
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const metadata = session.metadata;
        
        if (!metadata || !metadata.userId) {
          console.error('No userId in session metadata');
          break;
        }

        if (metadata.type === 'subscription') {
          // Handle subscription purchase - atomic upsert for idempotency
          const subscriptionId = session.subscription as string;
          const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
          
          // Use upsert to prevent race conditions - unique constraint on stripeSubscriptionId
          const subscriptionData = {
            userId: metadata.userId,
            planId: metadata.planId!,
            status: 'active',
            currentPeriodStart: new Date((stripeSubscription as any).current_period_start * 1000),
            currentPeriodEnd: new Date((stripeSubscription as any).current_period_end * 1000),
            stripeSubscriptionId: subscriptionId,
            cancelAtPeriodEnd: false,
            billingPeriod: metadata.billingPeriod || 'monthly',
          };
          
          // Try to create, if it exists (ON CONFLICT), just skip
          let userSubId: string | undefined;
          try {
            const newSub = await storage.createUserSubscription(subscriptionData);
            userSubId = newSub.id;
          } catch (error: any) {
            // If unique constraint violation, subscription already exists - skip
            if (!error.message?.includes('unique') && !error.message?.includes('duplicate')) {
              throw error;
            }
            console.log(`Subscription ${subscriptionId} already exists, skipping creation`);
            const existingSub = await storage.getUserSubscription(metadata.userId);
            userSubId = existingSub?.id;
          }

          // Update user's plan type (always update to ensure consistency)
          const plan = await storage.getPlan(metadata.planId!);
          if (plan) {
            await storage.updateUser(metadata.userId, {
              planType: plan.name,
              planExpiresAt: new Date((stripeSubscription as any).current_period_end * 1000),
            });

            // Send membership upgrade notification
            await NotificationService.notifyMembershipUpgraded(metadata.userId, plan.name);

            // Log payment transaction
            const currencyConfig = await getStripeCurrency();
            const amount = (session.amount_total || 0) / 100;
            try {
              const newTransaction = await storage.createPaymentTransaction({
                userId: metadata.userId,
                type: 'subscription',
                gateway: 'stripe',
                gatewayTransactionId: session.payment_intent as string || session.id,
                gatewaySubscriptionId: subscriptionId,
                amount: amount.toFixed(2),
                currency: currencyConfig.currency.toUpperCase(),
                planId: plan.id,
                subscriptionId: userSubId,
                description: `${plan.displayName} Subscription`,
                billingPeriod: metadata.billingPeriod || 'monthly',
                status: 'completed',
                completedAt: new Date(),
              });
              console.log(`✅ [Stripe] Logged subscription transaction for user ${metadata.userId}`);
              
              // Generate invoice and send purchase confirmation email
              try {
                await generateInvoiceForTransaction(newTransaction.id);
                await emailService.sendPurchaseConfirmation(newTransaction.id);
                console.log(`✅ [Stripe] Purchase confirmation email sent for transaction ${newTransaction.id}`);
              } catch (emailError: any) {
                console.error(`❌ [Stripe] Failed to send purchase confirmation email:`, emailError);
              }
            } catch (txError: any) {
              console.error('Failed to log payment transaction:', txError);
            }
          }
        } else if (metadata.type === 'credits') {
          // Handle credit purchase - fully atomic transaction
          const credits = parseInt(metadata.credits || '0', 10);
          const paymentIntentId = session.payment_intent as string;
          
          if (paymentIntentId) {
            // Atomic: creates transaction + adds credits in single DB transaction
            // Unique constraint on stripePaymentId prevents duplicates
            try {
              await storage.addCreditsAtomic(
                metadata.userId,
                credits,
                `Purchased ${credits} credits`,
                paymentIntentId
              );
              import('../services/sip-credit-guard').then(({ reconnectAfterRecharge }) => reconnectAfterRecharge(metadata.userId)).catch(() => {});

              // Log payment transaction for credits
              const pkg = await storage.getCreditPackage(metadata.packageId!);
              if (pkg) {
                const currencyConfig = await getStripeCurrency();
                const amount = (session.amount_total || 0) / 100;
                try {
                  const creditTransaction = await storage.createPaymentTransaction({
                    userId: metadata.userId,
                    type: 'credits',
                    gateway: 'stripe',
                    gatewayTransactionId: paymentIntentId,
                    amount: amount.toFixed(2),
                    currency: currencyConfig.currency.toUpperCase(),
                    creditPackageId: pkg.id,
                    description: `${pkg.name} - ${credits} Credits`,
                    creditsAwarded: credits,
                    status: 'completed',
                    completedAt: new Date(),
                  });
                  console.log(`✅ [Stripe] Logged credits transaction for user ${metadata.userId}`);
                  
                  // Generate invoice and send purchase confirmation email
                  try {
                    await generateInvoiceForTransaction(creditTransaction.id);
                    await emailService.sendPurchaseConfirmation(creditTransaction.id);
                    console.log(`✅ [Stripe] Purchase confirmation email sent for credits transaction ${creditTransaction.id}`);
                  } catch (emailError: any) {
                    console.error(`❌ [Stripe] Failed to send credits purchase confirmation email:`, emailError);
                  }
                } catch (txError: any) {
                  console.error('Failed to log payment transaction:', txError);
                }
              }
            } catch (error: any) {
              // If unique constraint violation, payment already processed - skip
              if (!error.message?.includes('unique') && !error.message?.includes('duplicate')) {
                throw error;
              }
              console.log(`Payment ${paymentIntentId} already processed, skipping credit addition`);
            }
          }
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = subscription.metadata?.userId;
        
        if (userId) {
          const userSub = await storage.getUserSubscription(userId);
          if (userSub) {
            const newPeriodEnd = new Date((subscription as any).current_period_end * 1000);
            
            // Map Stripe statuses correctly for membership access
            let mappedStatus = 'active';
            if (subscription.status === 'canceled' || subscription.status === 'unpaid') {
              mappedStatus = 'cancelled';
            } else if (subscription.status === 'incomplete_expired') {
              mappedStatus = 'expired';
            } else if (subscription.status === 'incomplete') {
              // incomplete means payment setup not done - don't grant access yet
              mappedStatus = 'cancelled';
            }
            // Only 'trialing', 'active', 'past_due' -> treated as 'active' and grant access
            
            // Update subscription record
            await storage.updateUserSubscription(userSub.id, {
              status: mappedStatus,
              currentPeriodStart: new Date((subscription as any).current_period_start * 1000),
              currentPeriodEnd: newPeriodEnd,
              cancelAtPeriodEnd: (subscription as any).cancel_at_period_end,
            });

            // CRITICAL: Update user's planType and planExpiresAt to reflect renewal (only if subscription is active/trialing)
            if (mappedStatus === 'active') {
              // Get the plan name from the subscription to ensure proper planType sync
              const plan = userSub.planId ? await storage.getPlan(userSub.planId) : null;
              const planName = plan?.name || 'pro';
              
              await storage.updateUser(userId, {
                planType: planName,
                planExpiresAt: newPeriodEnd,
              });
            }
          }
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = subscription.metadata?.userId;
        
        if (userId) {
          const userSub = await storage.getUserSubscription(userId);
          if (userSub) {
            await storage.updateUserSubscription(userSub.id, {
              status: 'expired',
            });

            // Revert user to free plan
            await storage.updateUser(userId, {
              planType: 'free',
              planExpiresAt: null,
            });

            // Downgrade logic: Update all agents using Pro LLM models to free tier model
            try {
              const { db } = await import('../db');
              const { agents, llmModels } = await import('@shared/schema');
              const { eq, and, inArray } = await import('drizzle-orm');
              
              // Get all user's agents
              const userAgents = await storage.getUserAgents(userId);
              
              // Get all Pro tier models
              const proModels = await db
                .select()
                .from(llmModels)
                .where(eq(llmModels.tier, 'pro'));
              
              const proModelIds = proModels.map(m => m.modelId);
              
              // Filter agents that are using Pro models
              const agentsToUpdate = userAgents.filter(agent => {
                const currentModel = (agent.config as any)?.model || agent.llmModel;
                return currentModel && proModelIds.includes(currentModel);
              });
              
              if (agentsToUpdate.length > 0) {
                // Dynamically fetch the first active free-tier model as fallback
                const activeFreeModels = await db
                  .select()
                  .from(llmModels)
                  .where(and(
                    eq(llmModels.tier, 'free'),
                    eq(llmModels.isActive, true)
                  ))
                  .orderBy(llmModels.sortOrder, llmModels.name)
                  .limit(1);
                
                if (activeFreeModels.length === 0) {
                  console.error(`CRITICAL: No active free-tier LLM models available for user ${userId} downgrade. Cannot update ${agentsToUpdate.length} agent(s).`);
                  // Send notification to admins about this critical issue
                  await NotificationService.notifyAdmins(
                    'No Active Free LLM Models',
                    `User ${userId} downgraded but no active free-tier LLM models are available to migrate ${agentsToUpdate.length} agent(s). Please activate at least one free-tier model.`,
                    'critical'
                  );
                } else {
                  const defaultFreeModel = activeFreeModels[0].modelId;
                  
                  // Update each agent to use the default free model
                  for (const agent of agentsToUpdate) {
                    // Update agent config to use default free model
                    const updatedConfig = {
                      ...(typeof agent.config === 'object' ? agent.config : {}),
                      model: defaultFreeModel
                    } as any;
                    
                    await db
                      .update(agents)
                      .set({
                        config: updatedConfig,
                        llmModel: defaultFreeModel,
                        updatedAt: new Date(),
                      })
                      .where(eq(agents.id, agent.id));
                    
                    console.log(`Updated agent ${agent.id} from Pro model to ${defaultFreeModel} (${activeFreeModels[0].name}) due to plan downgrade`);
                  }
                  
                  console.log(`Successfully downgraded ${agentsToUpdate.length} agent(s) to free tier LLM model ${defaultFreeModel} for user ${userId}`);
                }
              }
            } catch (error) {
              console.error('Error updating agents on plan downgrade:', error);
              // Don't throw - subscription cancellation should still complete
            }

            // Send subscription cancellation notification
            await NotificationService.notifyMembershipCancelled(userId);
          }
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        // Access subscription ID safely - may be string, object, or null
        const invoiceData = invoice as any;
        const subscriptionId = typeof invoiceData.subscription === 'string' 
          ? invoiceData.subscription 
          : invoiceData.subscription?.id;
        
        // Handle successful subscription renewal
        if (subscriptionId) {
          const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
          const userId = stripeSubscription.metadata?.userId;
          
          if (userId) {
            const userSub = await storage.getUserSubscription(userId);
            if (userSub) {
              const newPeriodEnd = new Date((stripeSubscription as any).current_period_end * 1000);
              
              // Update subscription period
              await storage.updateUserSubscription(userSub.id, {
                status: 'active',
                currentPeriodStart: new Date((stripeSubscription as any).current_period_start * 1000),
                currentPeriodEnd: newPeriodEnd,
              });

              // CRITICAL: Update user's planExpiresAt on renewal
              await storage.updateUser(userId, {
                planExpiresAt: newPeriodEnd,
              });
              
              console.log(`✅ Invoice payment succeeded for user ${userId}, extended until ${newPeriodEnd}`);

              // Log payment transaction for subscription renewal
              const plan = userSub.planId ? await storage.getPlan(userSub.planId) : null;
              if (plan) {
                const currencyConfig = await getStripeCurrency();
                const amount = (invoice.amount_paid || 0) / 100;
                try {
                  const renewalTransaction = await storage.createPaymentTransaction({
                    userId,
                    type: 'subscription',
                    gateway: 'stripe',
                    gatewayTransactionId: (invoice as any).payment_intent as string || invoice.id,
                    gatewaySubscriptionId: subscriptionId,
                    amount: amount.toFixed(2),
                    currency: currencyConfig.currency.toUpperCase(),
                    planId: plan.id,
                    subscriptionId: userSub.id,
                    description: `${plan.displayName} Subscription Renewal`,
                    billingPeriod: userSub.billingPeriod || 'monthly',
                    status: 'completed',
                    completedAt: new Date(),
                  });
                  console.log(`✅ [Stripe] Logged renewal transaction for user ${userId}`);
                  
                  // Generate invoice and send purchase confirmation email for renewal
                  try {
                    await generateInvoiceForTransaction(renewalTransaction.id);
                    await emailService.sendPurchaseConfirmation(renewalTransaction.id);
                    console.log(`✅ [Stripe] Renewal confirmation email sent for transaction ${renewalTransaction.id}`);
                  } catch (emailError: any) {
                    console.error(`❌ [Stripe] Failed to send renewal confirmation email:`, emailError);
                  }
                } catch (txError: any) {
                  console.error('Failed to log payment transaction:', txError);
                }
              }
            }
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const invoiceData = invoice as any;
        const subscriptionId = typeof invoiceData.subscription === 'string' 
          ? invoiceData.subscription 
          : invoiceData.subscription?.id;
        
        console.error(`❌ Invoice payment failed: ${invoice.id}`);
        
        // Handle failed subscription payment - mark as past_due and notify user
        if (subscriptionId) {
          try {
            const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
            const userId = stripeSubscription.metadata?.userId;
            
            if (userId) {
              const userSub = await storage.getUserSubscription(userId);
              if (userSub) {
                // Update subscription status to past_due
                await storage.updateUserSubscription(userSub.id, {
                  status: 'past_due',
                });
                
                // Notify user about payment failure
                await NotificationService.notifyPaymentFailed(userId);
                
                // Send payment failed email
                try {
                  const failedAmount = ((invoice.amount_due || 0) / 100).toFixed(2);
                  await emailService.sendPaymentFailed(userId, failedAmount, 'Subscription renewal payment failed');
                  console.log(`✅ [Stripe] Payment failed email sent to user ${userId}`);
                } catch (emailError: any) {
                  console.error(`❌ [Stripe] Failed to send payment failed email:`, emailError);
                }
                
                console.log(`⚠️ User ${userId} subscription marked as past_due due to payment failure`);
              }
            }
          } catch (error) {
            console.error('Error handling payment failure:', error);
          }
        }
        break;
      }

      case 'charge.dispute.created': {
        // Handle chargeback/dispute - suspend user account
        const dispute = event.data.object as Stripe.Dispute;
        const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
        
        console.log(`🚨 [Stripe] Chargeback/Dispute created: ${dispute.id} for charge ${chargeId}`);
        
        if (chargeId) {
          try {
            // Find the original transaction
            const transaction = await storage.getPaymentTransactionByGatewayId('stripe', chargeId);
            
            if (transaction) {
              const userId = transaction.userId;
              
              // Reverse credits if it was a credit purchase using centralized service
              let creditsReversed = 0;
              if (transaction.type === 'credits' && transaction.creditsAwarded) {
                const refundResult = await applyRefund({
                  userId,
                  creditsToReverse: transaction.creditsAwarded,
                  gateway: 'stripe',
                  gatewayRefundId: dispute.id,
                  transactionId: transaction.id,
                  reason: `Chargeback dispute: ${dispute.reason || 'unknown'}`,
                });
                
                if (refundResult.success && !refundResult.alreadyProcessed) {
                  creditsReversed = refundResult.creditsReversed;
                  console.log(`🔄 [Stripe] Reversed ${creditsReversed} credits for user ${userId}. Transaction logged.`);
                }
              }
              
              // Create refund record
              await storage.createRefund({
                transactionId: transaction.id,
                userId,
                amount: transaction.amount,
                currency: transaction.currency,
                gateway: 'stripe',
                gatewayRefundId: dispute.id,
                reason: 'chargeback',
                initiatedBy: 'gateway',
                status: 'completed',
                creditsReversed: creditsReversed > 0 ? creditsReversed : undefined,
                metadata: {
                  userSuspended: true,
                  disputeReason: dispute.reason || 'unknown',
                  disputeStatus: dispute.status,
                  disputeAmount: dispute.amount,
                },
              });
              
              // Update transaction status
              await storage.updatePaymentTransaction(transaction.id, {
                status: 'refunded',
              });
              
              // SUSPEND user account
              await storage.updateUser(userId, {
                isActive: false,
              });
              
              // Send account suspended email
              try {
                await emailService.sendAccountSuspended(userId, `Chargeback dispute: ${dispute.reason || 'Unknown reason'}`);
                console.log(`✅ [Stripe] Account suspended email sent to user ${userId}`);
              } catch (emailError: any) {
                console.error(`❌ [Stripe] Failed to send account suspended email:`, emailError);
              }
              
              console.log(`⛔ [Stripe] User ${userId} suspended due to chargeback. Dispute ID: ${dispute.id}, Reason: ${dispute.reason}`);
            } else {
              console.warn(`⚠️ [Stripe] No transaction found for charge ${chargeId}`);
            }
          } catch (error: any) {
            console.error('Error processing chargeback:', error);
          }
        }
        break;
      }

      case 'charge.refunded': {
        // Handle external refunds (not initiated via our admin API)
        const charge = event.data.object as Stripe.Charge;
        
        console.log(`🔄 [Stripe] Charge refunded event: ${charge.id}`);
        
        // Only process if fully refunded externally
        if (charge.refunded) {
          try {
            // Find the original transaction
            const transaction = await storage.getPaymentTransactionByGatewayId('stripe', charge.id);
            
            // Check if we already have a refund for this transaction (to avoid duplicates)
            if (transaction) {
              const existingRefunds = await storage.getTransactionRefunds(transaction.id);
              if (existingRefunds.length > 0) {
                console.log(`ℹ️ [Stripe] Refund already exists for charge ${charge.id}, skipping`);
                break;
              }
              
              const userId = transaction.userId;
              
              // Reverse credits if it was a credit purchase using centralized service
              let creditsReversed = 0;
              if (transaction.type === 'credits' && transaction.creditsAwarded) {
                const refundId = charge.refunds?.data?.[0]?.id || `stripe_refund_${charge.id}`;
                const refundResult = await applyRefund({
                  userId,
                  creditsToReverse: transaction.creditsAwarded,
                  gateway: 'stripe',
                  gatewayRefundId: refundId,
                  transactionId: transaction.id,
                  reason: charge.refunds?.data?.[0]?.reason || 'External refund via Stripe dashboard',
                });
                
                if (refundResult.success && !refundResult.alreadyProcessed) {
                  creditsReversed = refundResult.creditsReversed;
                  console.log(`🔄 [Stripe] Reversed ${creditsReversed} credits for user ${userId}. Transaction logged.`);
                }
              }
              
              // Get refund ID from the charge object
              const refundId = charge.refunds?.data?.[0]?.id || `stripe_refund_${charge.id}`;
              
              // Create refund record
              await storage.createRefund({
                transactionId: transaction.id,
                userId,
                amount: transaction.amount,
                currency: transaction.currency,
                gateway: 'stripe',
                gatewayRefundId: refundId,
                reason: 'gateway_refund',
                initiatedBy: 'gateway',
                status: 'completed',
                creditsReversed: creditsReversed > 0 ? creditsReversed : undefined,
                metadata: {
                  userSuspended: false,
                  refundReason: charge.refunds?.data?.[0]?.reason || 'external_refund',
                },
              });
              
              // Update transaction status
              await storage.updatePaymentTransaction(transaction.id, {
                status: 'refunded',
              });
              
              console.log(`✅ [Stripe] External refund processed for user ${userId}. Charge: ${charge.id}`);
            }
          } catch (error: any) {
            console.error('Error processing external refund:', error);
          }
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error: any) {
    console.error('Webhook processing error:', error);
    
    await queueFailedWebhook(
      'stripe',
      event.type,
      event.id,
      event.data.object,
      error.message || 'Unknown error'
    );
    
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;
