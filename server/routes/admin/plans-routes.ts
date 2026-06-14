'use strict';
import { Router, Response } from 'express';
import { storage } from '../../storage';
import { AdminRequest, requireAdminPermission } from '../../middleware/admin-auth';
import { insertPlanSchema } from '@shared/schema';
import { db } from '../../db';
import { eq } from 'drizzle-orm';
import Stripe from 'stripe';
import { 
  resetRazorpayClient, 
  getActivePaymentGateway, 
  createRazorpayPlan,
  fetchRazorpayPlan,
  isRazorpayConfigured,
  isRazorpayEnabled,
} from '../../services/razorpay-service';
import {
  resetStripeClient,
  getStripeCurrency,
  isStripeEnabled,
} from '../../services/stripe-service';
import {
  isPayPalConfigured,
  isPayPalEnabled,
  createPayPalProduct,
  createPayPalPlan,
  fetchPayPalPlan,
  deactivatePayPalPlan,
  getPayPalCurrency,
} from '../../services/paypal-service';
import {
  isPaystackConfigured,
  isPaystackEnabled,
  createPaystackPlan,
  getPaystackCurrency,
} from '../../services/paystack-service';
import {
  isMercadoPagoConfigured,
  isMercadoPagoEnabled,
  createMercadoPagoSubscriptionPlan,
  getMercadoPagoCurrency,
} from '../../services/mercadopago-service';

async function getStripeClient(): Promise<Stripe | null> {
  try {
    const dbSetting = await storage.getGlobalSetting('stripe_secret_key');
    const secretKey = (dbSetting?.value as string) || process.env.STRIPE_SECRET_KEY;
    
    if (!secretKey) {
      return null;
    }
    
    return new Stripe(secretKey, { apiVersion: '2025-10-29.clover' });
  } catch (error) {
    console.error('Error initializing Stripe client:', error);
    return null;
  }
}

async function getDefaultCurrency(): Promise<string> {
  try {
    const currencyConfig = await getStripeCurrency();
    return currencyConfig.currency;
  } catch (error) {
    console.error('Error getting default currency:', error);
    return 'USD';
  }
}

function convertPriceFields(bodyData: any): any {
  const result = { ...bodyData };
  const priceFields = [
    'monthlyPrice', 'yearlyPrice', 'razorpayMonthlyPrice', 'razorpayYearlyPrice',
    'paypalMonthlyPrice', 'paypalYearlyPrice', 'paystackMonthlyPrice', 'paystackYearlyPrice',
    'mercadopagoMonthlyPrice', 'mercadopagoYearlyPrice'
  ];
  
  for (const field of priceFields) {
    if (typeof result[field] === 'number') {
      result[field] = result[field].toFixed(2);
    }
  }
  
  return result;
}

export function registerPlansRoutes(router: Router) {
  router.get('/plans', requireAdminPermission('billing', 'plans', 'read'), async (req: AdminRequest, res: Response) => {
    try {
      const plans = await storage.getAllPlans();
      res.json(plans);
    } catch (error) {
      console.error('Error fetching plans:', error);
      res.status(500).json({ error: 'Failed to fetch plans' });
    }
  });

  router.post('/plans', requireAdminPermission('billing', 'plans', 'create'), async (req: AdminRequest, res: Response) => {
    try {
      const bodyData = convertPriceFields(req.body);
      
      let planData;
      try {
        planData = insertPlanSchema.parse(bodyData);
      } catch (validationError: any) {
        if (validationError.errors) {
          return res.status(400).json({ 
            error: 'Validation failed', 
            details: validationError.errors 
          });
        }
        throw validationError;
      }
      
      let newPlan = await storage.createPlan(planData);
      
      const gatewaySync: Record<string, { status: 'success' | 'failed' | 'skipped'; error?: string }> = {};

      gatewaySync.razorpay = { status: 'skipped' };
      const razorpayConfigured = (await isRazorpayEnabled()) && (await isRazorpayConfigured());
      if (razorpayConfigured) {
        try {
          const monthlyInrAmount = planData.razorpayMonthlyPrice ? parseFloat(planData.razorpayMonthlyPrice.toString()) : 0;
          let razorpayMonthlyPlanId: string | null = null;
          
          if (monthlyInrAmount > 0) {
            const monthlyPlan = await createRazorpayPlan({
              period: 'monthly',
              interval: 1,
              name: `${planData.displayName} - Monthly`,
              amount: monthlyInrAmount,
              currency: 'INR',
              description: planData.description || undefined,
              notes: { planId: newPlan.id, billingPeriod: 'monthly' }
            });
            razorpayMonthlyPlanId = monthlyPlan.id;
            console.log(`✅ [Razorpay] Created monthly plan ${monthlyPlan.id} with INR ${monthlyInrAmount}`);
          }
          
          let razorpayYearlyPlanId: string | null = null;
          const yearlyInrAmount = planData.razorpayYearlyPrice ? parseFloat(planData.razorpayYearlyPrice.toString()) : 0;
          if (yearlyInrAmount > 0) {
            const yearlyPlan = await createRazorpayPlan({
              period: 'yearly',
              interval: 1,
              name: `${planData.displayName} - Yearly`,
              amount: yearlyInrAmount,
              currency: 'INR',
              description: planData.description || undefined,
              notes: { planId: newPlan.id, billingPeriod: 'yearly' }
            });
            razorpayYearlyPlanId = yearlyPlan.id;
            console.log(`✅ [Razorpay] Created yearly plan ${yearlyPlan.id} with INR ${yearlyInrAmount}`);
          }
          
          if (razorpayMonthlyPlanId || razorpayYearlyPlanId) {
            await storage.updatePlan(newPlan.id, { razorpayPlanId: razorpayMonthlyPlanId, razorpayYearlyPlanId });
            const updatedPlan = await storage.getPlan(newPlan.id);
            if (updatedPlan) newPlan = updatedPlan;
          }
          gatewaySync.razorpay = { status: 'success' };
        } catch (razorpayError: any) {
          console.error('❌ [Razorpay] Error syncing plan to Razorpay:', razorpayError.message);
          gatewaySync.razorpay = { status: 'failed', error: razorpayError.message };
        }
      }
      
      gatewaySync.stripe = { status: 'skipped' };
      const stripeEnabled = await isStripeEnabled();
      const stripe = stripeEnabled ? await getStripeClient() : null;
      if (stripe) {
        try {
          const currency = await getDefaultCurrency();
          
          const stripeProduct = await stripe.products.create({
            name: planData.displayName,
            description: planData.description || undefined,
            metadata: { planId: newPlan.id, planName: planData.name }
          });
          
          const monthlyAmount = parseFloat(planData.monthlyPrice.toString());
          let monthlyPrice: Stripe.Price | null = null;
          if (monthlyAmount > 0) {
            monthlyPrice = await stripe.prices.create({
              product: stripeProduct.id,
              unit_amount: Math.round(monthlyAmount * 100),
              currency: currency.toLowerCase(),
              recurring: { interval: 'month' },
              metadata: { planId: newPlan.id, billingPeriod: 'monthly' }
            });
          }
          
          let yearlyPrice: Stripe.Price | null = null;
          if (planData.yearlyPrice) {
            const yearlyAmount = parseFloat(planData.yearlyPrice.toString());
            if (yearlyAmount > 0) {
              yearlyPrice = await stripe.prices.create({
                product: stripeProduct.id,
                unit_amount: Math.round(yearlyAmount * 100),
                currency: currency.toLowerCase(),
                recurring: { interval: 'year' },
                metadata: { planId: newPlan.id, billingPeriod: 'yearly' }
              });
            }
          }
          
          await storage.updatePlan(newPlan.id, {
            stripeProductId: stripeProduct.id,
            stripeMonthlyPriceId: monthlyPrice?.id || null,
            stripeYearlyPriceId: yearlyPrice?.id || null
          });
          
          const updatedPlan = await storage.getPlan(newPlan.id);
          if (updatedPlan) newPlan = updatedPlan;
          
          console.log(`✅ [Stripe] Created product ${stripeProduct.id} and prices for plan ${newPlan.id}`);
          gatewaySync.stripe = { status: 'success' };
        } catch (stripeError: any) {
          console.error('❌ [Stripe] Error syncing plan to Stripe:', stripeError.message);
          gatewaySync.stripe = { status: 'failed', error: stripeError.message };
        }
      }
      
      gatewaySync.paypal = { status: 'skipped' };
      const paypalConfigured = (await isPayPalEnabled()) && (await isPayPalConfigured());
      if (paypalConfigured) {
        try {
          const paypalCurrency = await getPayPalCurrency();
          const paypalUpdateData: any = {};
          
          const paypalProduct = await createPayPalProduct({
            name: planData.displayName,
            description: planData.description || undefined,
            type: 'SERVICE',
          });
          paypalUpdateData.paypalProductId = paypalProduct.id;
          
          const paypalMonthlyAmount = planData.paypalMonthlyPrice ? parseFloat(planData.paypalMonthlyPrice.toString()) : 0;
          if (paypalMonthlyAmount > 0) {
            const monthlyPlan = await createPayPalPlan({
              productId: paypalProduct.id,
              name: `${planData.displayName} - Monthly`,
              description: planData.description || undefined,
              billingCycles: [{
                frequency: { interval_unit: 'MONTH', interval_count: 1 },
                tenure_type: 'REGULAR',
                sequence: 1,
                total_cycles: 0,
                pricing_scheme: {
                  fixed_price: { value: paypalMonthlyAmount.toFixed(2), currency_code: paypalCurrency.currency },
                },
              }],
            });
            paypalUpdateData.paypalMonthlyPlanId = monthlyPlan.id;
          }
          
          const paypalYearlyAmount = planData.paypalYearlyPrice ? parseFloat(planData.paypalYearlyPrice.toString()) : 0;
          if (paypalYearlyAmount > 0) {
            const yearlyPlan = await createPayPalPlan({
              productId: paypalProduct.id,
              name: `${planData.displayName} - Yearly`,
              description: planData.description || undefined,
              billingCycles: [{
                frequency: { interval_unit: 'YEAR', interval_count: 1 },
                tenure_type: 'REGULAR',
                sequence: 1,
                total_cycles: 0,
                pricing_scheme: {
                  fixed_price: { value: paypalYearlyAmount.toFixed(2), currency_code: paypalCurrency.currency },
                },
              }],
            });
            paypalUpdateData.paypalYearlyPlanId = yearlyPlan.id;
          }
          
          if (Object.keys(paypalUpdateData).length > 0) {
            await storage.updatePlan(newPlan.id, paypalUpdateData);
            const updatedPlan = await storage.getPlan(newPlan.id);
            if (updatedPlan) newPlan = updatedPlan;
          }
          gatewaySync.paypal = { status: 'success' };
        } catch (paypalError: any) {
          console.error('❌ [PayPal] Error syncing plan to PayPal:', paypalError.message);
          gatewaySync.paypal = { status: 'failed', error: paypalError.message };
        }
      }
      
      gatewaySync.paystack = { status: 'skipped' };
      const paystackConfigured = (await isPaystackEnabled()) && (await isPaystackConfigured());
      if (paystackConfigured) {
        try {
          const paystackCurrency = await getPaystackCurrency();
          const paystackUpdateData: any = {};
          const PAYSTACK_MIN_AMOUNT = 1;
          
          const paystackMonthlyAmount = planData.paystackMonthlyPrice ? parseFloat(planData.paystackMonthlyPrice.toString()) : 0;
          if (paystackMonthlyAmount >= PAYSTACK_MIN_AMOUNT) {
            const monthlyPlan = await createPaystackPlan({
              name: `${planData.displayName} - Monthly`,
              interval: 'monthly',
              amount: paystackMonthlyAmount,
              currency: paystackCurrency.currency,
              description: planData.description || undefined,
            });
            paystackUpdateData.paystackMonthlyPlanCode = monthlyPlan.plan_code;
          }
          
          const paystackYearlyAmount = planData.paystackYearlyPrice ? parseFloat(planData.paystackYearlyPrice.toString()) : 0;
          if (paystackYearlyAmount >= PAYSTACK_MIN_AMOUNT) {
            const yearlyPlan = await createPaystackPlan({
              name: `${planData.displayName} - Yearly`,
              interval: 'annually',
              amount: paystackYearlyAmount,
              currency: paystackCurrency.currency,
              description: planData.description || undefined,
            });
            paystackUpdateData.paystackYearlyPlanCode = yearlyPlan.plan_code;
          }
          
          if (Object.keys(paystackUpdateData).length > 0) {
            await storage.updatePlan(newPlan.id, paystackUpdateData);
            const updatedPlan = await storage.getPlan(newPlan.id);
            if (updatedPlan) newPlan = updatedPlan;
          }
          gatewaySync.paystack = { status: 'success' };
        } catch (paystackError: any) {
          console.error('❌ [Paystack] Error syncing plan to Paystack:', paystackError.message);
          gatewaySync.paystack = { status: 'failed', error: paystackError.message };
        }
      }
      
      gatewaySync.mercadopago = { status: 'skipped' };
      const mercadopagoConfigured = (await isMercadoPagoEnabled()) && (await isMercadoPagoConfigured());
      if (mercadopagoConfigured) {
        try {
          const mercadopagoCurrency = await getMercadoPagoCurrency();
          const baseUrl = process.env.BASE_URL || process.env.APP_URL;
          const mercadopagoUpdateData: any = {};
          
          if (baseUrl) {
            const mercadopagoMonthlyAmount = planData.mercadopagoMonthlyPrice ? parseFloat(planData.mercadopagoMonthlyPrice.toString()) : 0;
            if (mercadopagoMonthlyAmount > 0) {
              const monthlyPlan = await createMercadoPagoSubscriptionPlan({
                reason: `${planData.displayName} - Monthly`,
                autoRecurring: {
                  frequency: 1,
                  frequencyType: 'months',
                  transactionAmount: mercadopagoMonthlyAmount,
                  currencyId: mercadopagoCurrency.currency,
                },
                backUrl: `${baseUrl}/app/billing`,
              });
              mercadopagoUpdateData.mercadopagoMonthlyPlanId = monthlyPlan.id;
            }
            
            const mercadopagoYearlyAmount = planData.mercadopagoYearlyPrice ? parseFloat(planData.mercadopagoYearlyPrice.toString()) : 0;
            if (mercadopagoYearlyAmount > 0) {
              const yearlyPlan = await createMercadoPagoSubscriptionPlan({
                reason: `${planData.displayName} - Yearly`,
                autoRecurring: {
                  frequency: 12,
                  frequencyType: 'months',
                  transactionAmount: mercadopagoYearlyAmount,
                  currencyId: mercadopagoCurrency.currency,
                },
                backUrl: `${baseUrl}/app/billing`,
              });
              mercadopagoUpdateData.mercadopagoYearlyPlanId = yearlyPlan.id;
            }
            
            if (Object.keys(mercadopagoUpdateData).length > 0) {
              await storage.updatePlan(newPlan.id, mercadopagoUpdateData);
              const updatedPlan = await storage.getPlan(newPlan.id);
              if (updatedPlan) newPlan = updatedPlan;
            }
          }
          gatewaySync.mercadopago = { status: 'success' };
        } catch (mercadopagoError: any) {
          console.error('❌ [MercadoPago] Error syncing plan to MercadoPago:', mercadopagoError.message);
          gatewaySync.mercadopago = { status: 'failed', error: mercadopagoError.message };
        }
      }
      
      res.json({ plan: newPlan, gatewaySync });
    } catch (error: any) {
      console.error('Error creating plan:', error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Validation failed', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to create plan' });
    }
  });

  router.patch('/plans/:planId', requireAdminPermission('billing', 'plans', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const { planId } = req.params;
      
      // Convert price fields to strings (decimal fields expect strings)
      const bodyData = convertPriceFields(req.body);
      
      let updateData;
      try {
        updateData = insertPlanSchema.partial().parse(bodyData);
      } catch (validationError: any) {
        if (validationError.errors) {
          return res.status(400).json({ 
            error: 'Validation failed', 
            details: validationError.errors 
          });
        }
        throw validationError;
      }
      
      // Get existing plan to check for price changes
      const existingPlan = await storage.getPlan(planId);
      if (!existingPlan) {
        return res.status(404).json({ error: 'Plan not found' });
      }
      
      // Check which payment gateway is active
      const activeGateway = await getActivePaymentGateway();
      
      const gatewaySync: Record<string, { status: 'success' | 'failed' | 'skipped'; error?: string }> = {};

      // Always sync to Razorpay if configured and INR prices exist (independent of active gateway)
      gatewaySync.razorpay = { status: 'skipped' };
      const razorpayConfigured = (await isRazorpayEnabled()) && (await isRazorpayConfigured());
      if (razorpayConfigured) {
        try {
          // Force resync option - recreate all Razorpay plans (since they're immutable)
          const forceRazorpaySync = req.body.forceRazorpaySync === true;
          if (forceRazorpaySync) {
            console.log(`🔄 [Razorpay] Force sync requested for plan ${planId} - will recreate all plans in INR`);
          }
          
          // Use INR-specific price fields for Razorpay (not USD prices)
          const newMonthlyInrPrice = updateData.razorpayMonthlyPrice?.toString();
          const oldMonthlyInrPrice = existingPlan.razorpayMonthlyPrice?.toString();
          const effectiveMonthlyInrPrice = newMonthlyInrPrice || oldMonthlyInrPrice;
          const effectiveMonthlyInrAmount = effectiveMonthlyInrPrice ? parseFloat(effectiveMonthlyInrPrice) : 0;
          const monthlyInrPriceChanged = newMonthlyInrPrice && newMonthlyInrPrice !== oldMonthlyInrPrice;
          const needsMonthlyPlan = !existingPlan.razorpayPlanId && effectiveMonthlyInrAmount > 0;
          
          // Handle monthly plan sync (Razorpay plans are immutable, so we create new ones)
          // Also resync if forceRazorpaySync is true
          const shouldResyncMonthlyRazorpay = forceRazorpaySync && effectiveMonthlyInrAmount > 0;
          if (effectiveMonthlyInrAmount > 0 && (monthlyInrPriceChanged || needsMonthlyPlan || shouldResyncMonthlyRazorpay)) {
            const priceAmount = monthlyInrPriceChanged ? parseFloat(newMonthlyInrPrice!) : effectiveMonthlyInrAmount;
            const monthlyPlan = await createRazorpayPlan({
              period: 'monthly',
              interval: 1,
              name: `${updateData.displayName || existingPlan.displayName} - Monthly`,
              amount: priceAmount,
              currency: 'INR',
              description: updateData.description || existingPlan.description || undefined,
              notes: {
                planId: planId,
                billingPeriod: 'monthly'
              }
            });
            updateData.razorpayPlanId = monthlyPlan.id;
            console.log(`✅ [Razorpay] Created monthly plan ${monthlyPlan.id} with INR ${priceAmount}`);
          } else if (effectiveMonthlyInrAmount === 0 && existingPlan.razorpayPlanId) {
            updateData.razorpayPlanId = null;
            console.log(`ℹ️ [Razorpay] Cleared monthly plan ID (no INR price)`);
          }
          
          // Use INR-specific yearly price field for Razorpay
          const newYearlyInrPrice = updateData.razorpayYearlyPrice?.toString();
          const oldYearlyInrPrice = existingPlan.razorpayYearlyPrice?.toString();
          const effectiveYearlyInrPrice = newYearlyInrPrice || oldYearlyInrPrice;
          const effectiveYearlyInrAmount = effectiveYearlyInrPrice ? parseFloat(effectiveYearlyInrPrice) : 0;
          const yearlyInrPriceChanged = newYearlyInrPrice && newYearlyInrPrice !== oldYearlyInrPrice;
          const needsYearlyPlan = !existingPlan.razorpayYearlyPlanId && effectiveYearlyInrAmount > 0;
          
          // Handle yearly plan sync (also resync if forceRazorpaySync is true)
          const shouldResyncYearlyRazorpay = forceRazorpaySync && effectiveYearlyInrAmount > 0;
          if (effectiveYearlyInrAmount > 0 && (yearlyInrPriceChanged || needsYearlyPlan || shouldResyncYearlyRazorpay)) {
            const priceAmount = yearlyInrPriceChanged ? parseFloat(newYearlyInrPrice!) : effectiveYearlyInrAmount;
            const yearlyPlan = await createRazorpayPlan({
              period: 'yearly',
              interval: 1,
              name: `${updateData.displayName || existingPlan.displayName} - Yearly`,
              amount: priceAmount,
              currency: 'INR',
              description: updateData.description || existingPlan.description || undefined,
              notes: {
                planId: planId,
                billingPeriod: 'yearly'
              }
            });
            updateData.razorpayYearlyPlanId = yearlyPlan.id;
            console.log(`✅ [Razorpay] Created yearly plan ${yearlyPlan.id} with INR ${priceAmount}`);
          } else if (effectiveYearlyInrAmount === 0 && existingPlan.razorpayYearlyPlanId) {
            updateData.razorpayYearlyPlanId = null;
            console.log(`ℹ️ [Razorpay] Cleared yearly plan ID (no INR price)`);
          }
          
          gatewaySync.razorpay = { status: 'success' };
        } catch (razorpayError: any) {
          console.error('❌ [Razorpay] Error syncing plan to Razorpay:', razorpayError.message);
          gatewaySync.razorpay = { status: 'failed', error: razorpayError.message };
          // Continue with update without blocking
        }
      }
      
      // Sync to Stripe only if enabled and configured (independent of active gateway)
      gatewaySync.stripe = { status: 'skipped' };
      const stripeEnabledForUpdate = await isStripeEnabled();
      const stripe = stripeEnabledForUpdate ? await getStripeClient() : null;
      if (stripe) {
        try {
          const currency = await getDefaultCurrency();
          
          // Force resync option - recreate all Stripe prices in current currency
          // This is used after admin changes currency and needs to resync pricing
          const forceStripeSync = req.body.forceStripeSync === true;
          if (forceStripeSync) {
            console.log(`🔄 [Stripe] Force sync requested for plan ${planId} - will recreate all prices in ${currency}`);
          }
          
          // Check if we need to create a new Stripe product (if none exists)
          let stripeProductId = existingPlan.stripeProductId;
          
          if (!stripeProductId) {
            // Create new Stripe Product
            const stripeProduct = await stripe.products.create({
              name: updateData.displayName || existingPlan.displayName,
              description: updateData.description || existingPlan.description || undefined,
              metadata: {
                planId: planId,
                planName: updateData.name || existingPlan.name
              }
            });
            stripeProductId = stripeProduct.id;
            updateData.stripeProductId = stripeProductId;
            console.log(`✅ [Stripe] Created new product ${stripeProductId} for plan ${planId}`);
          } else {
            // Update existing product if name/description changed
            if (updateData.displayName || updateData.description) {
              await stripe.products.update(stripeProductId, {
                name: updateData.displayName || existingPlan.displayName,
                description: updateData.description || existingPlan.description || undefined
              });
              console.log(`✅ [Stripe] Updated product ${stripeProductId}`);
            }
          }
          
          // Check if monthly price needs to be created/updated
          const newMonthlyPrice = updateData.monthlyPrice?.toString();
          const oldMonthlyPrice = existingPlan.monthlyPrice?.toString();
          const effectiveMonthlyPrice = newMonthlyPrice || oldMonthlyPrice;
          const effectiveMonthlyAmount = effectiveMonthlyPrice ? parseFloat(effectiveMonthlyPrice) : 0;
          const monthlyPriceChanged = newMonthlyPrice && newMonthlyPrice !== oldMonthlyPrice;
          const needsMonthlyPrice = !existingPlan.stripeMonthlyPriceId && effectiveMonthlyAmount > 0;
          
          // Handle monthly price sync (also resync if forceStripeSync is true and there's an existing price)
          const shouldResyncMonthly = forceStripeSync && existingPlan.stripeMonthlyPriceId && effectiveMonthlyAmount > 0;
          if (effectiveMonthlyAmount > 0 && (monthlyPriceChanged || needsMonthlyPrice || shouldResyncMonthly)) {
            // Archive old monthly price if exists (always archive before creating new)
            if (existingPlan.stripeMonthlyPriceId) {
              try {
                await stripe.prices.update(existingPlan.stripeMonthlyPriceId, { active: false });
                console.log(`📦 [Stripe] Archived old monthly price ${existingPlan.stripeMonthlyPriceId}`);
              } catch (archiveErr: any) {
                console.warn(`⚠️ [Stripe] Could not archive old monthly price: ${archiveErr.message}`);
              }
            }
            
            // Create new monthly price
            const priceAmount = monthlyPriceChanged ? newMonthlyPrice! : effectiveMonthlyPrice!;
            const monthlyPrice = await stripe.prices.create({
              product: stripeProductId!,
              unit_amount: Math.round(parseFloat(priceAmount) * 100),
              currency: currency.toLowerCase(),
              recurring: {
                interval: 'month'
              },
              metadata: {
                planId: planId,
                billingPeriod: 'monthly'
              }
            });
            updateData.stripeMonthlyPriceId = monthlyPrice.id;
            console.log(`✅ [Stripe] Created new monthly price ${monthlyPrice.id} ($${priceAmount})`);
          } else if (effectiveMonthlyAmount === 0 && existingPlan.stripeMonthlyPriceId) {
            // Transitioning to free plan - archive existing price and clear ID
            try {
              await stripe.prices.update(existingPlan.stripeMonthlyPriceId, { active: false });
              console.log(`📦 [Stripe] Archived monthly price ${existingPlan.stripeMonthlyPriceId} (plan now free)`);
            } catch (archiveErr: any) {
              console.warn(`⚠️ [Stripe] Could not archive monthly price: ${archiveErr.message}`);
            }
            updateData.stripeMonthlyPriceId = null;
            console.log(`ℹ️ [Stripe] Cleared monthly price ID for free plan`);
          }
          
          // Check if yearly price needs to be created/updated
          const newYearlyPrice = updateData.yearlyPrice?.toString();
          const oldYearlyPrice = existingPlan.yearlyPrice?.toString();
          const effectiveYearlyPrice = newYearlyPrice || oldYearlyPrice;
          const effectiveYearlyAmount = effectiveYearlyPrice ? parseFloat(effectiveYearlyPrice) : 0;
          const yearlyPriceChanged = newYearlyPrice && newYearlyPrice !== oldYearlyPrice;
          const needsYearlyPrice = !existingPlan.stripeYearlyPriceId && effectiveYearlyAmount > 0;
          
          // Handle yearly price sync (also resync if forceStripeSync is true and there's an existing price)
          const shouldResyncYearly = forceStripeSync && existingPlan.stripeYearlyPriceId && effectiveYearlyAmount > 0;
          if (effectiveYearlyAmount > 0 && (yearlyPriceChanged || needsYearlyPrice || shouldResyncYearly)) {
            // Archive old yearly price if exists (always archive before creating new)
            if (existingPlan.stripeYearlyPriceId) {
              try {
                await stripe.prices.update(existingPlan.stripeYearlyPriceId, { active: false });
                console.log(`📦 [Stripe] Archived old yearly price ${existingPlan.stripeYearlyPriceId}`);
              } catch (archiveErr: any) {
                console.warn(`⚠️ [Stripe] Could not archive old yearly price: ${archiveErr.message}`);
              }
            }
            
            // Create new yearly price
            const priceAmount = yearlyPriceChanged ? newYearlyPrice! : effectiveYearlyPrice!;
            const yearlyPrice = await stripe.prices.create({
              product: stripeProductId!,
              unit_amount: Math.round(parseFloat(priceAmount) * 100),
              currency: currency.toLowerCase(),
              recurring: {
                interval: 'year'
              },
              metadata: {
                planId: planId,
                billingPeriod: 'yearly'
              }
            });
            updateData.stripeYearlyPriceId = yearlyPrice.id;
            console.log(`✅ [Stripe] Created new yearly price ${yearlyPrice.id} ($${priceAmount})`);
          } else if (effectiveYearlyAmount === 0 && existingPlan.stripeYearlyPriceId) {
            // Transitioning to free plan - archive existing price and clear ID
            try {
              await stripe.prices.update(existingPlan.stripeYearlyPriceId, { active: false });
              console.log(`📦 [Stripe] Archived yearly price ${existingPlan.stripeYearlyPriceId} (plan now free)`);
            } catch (archiveErr: any) {
              console.warn(`⚠️ [Stripe] Could not archive yearly price: ${archiveErr.message}`);
            }
            updateData.stripeYearlyPriceId = null;
            console.log(`ℹ️ [Stripe] Cleared yearly price ID for free plan`);
          }
          
          gatewaySync.stripe = { status: 'success' };
        } catch (stripeError: any) {
          console.error('❌ [Stripe] Error syncing plan update to Stripe:', stripeError.message);
          gatewaySync.stripe = { status: 'failed', error: stripeError.message };
          // Continue with update without blocking
        }
      } else {
        console.log('ℹ️ [Stripe] No Stripe key configured, skipping plan sync');
      }
      
      await storage.updatePlan(planId, updateData);
      
      // Fetch updated plan to return
      const updatedPlan = await storage.getPlan(planId);
      // PayPal, Paystack, and MercadoPago have dedicated sync endpoints
      // (POST /plans/:planId/sync/paypal, etc.) and are not synced in the PATCH route.
      gatewaySync.paypal = gatewaySync.paypal || { status: 'skipped' };
      gatewaySync.paystack = gatewaySync.paystack || { status: 'skipped' };
      gatewaySync.mercadopago = gatewaySync.mercadopago || { status: 'skipped' };
      res.json({ success: true, plan: updatedPlan, gatewaySync });
    } catch (error: any) {
      console.error('Error updating plan:', error);
      // Return 400 for validation errors, 500 for internal errors
      if (error.name === 'ZodError') {
        return res.status(400).json({ 
          error: 'Validation failed', 
          details: error.errors 
        });
      }
      res.status(500).json({ 
        error: 'Failed to update plan'
      });
    }
  });

  router.get('/plans/:planId/users', requireAdminPermission('billing', 'plans', 'read'), async (req: AdminRequest, res: Response) => {
    try {
      const { planId } = req.params;
      
      const plan = await storage.getPlan(planId);
      if (!plan) {
        return res.status(404).json({ error: 'Plan not found' });
      }
      
      const allUsers = await storage.getAllUsers();
      const usersOnPlan = allUsers.filter(user => {
        return user.planType && user.planType.toLowerCase() === plan.name.toLowerCase();
      });
      
      res.json({
        planId,
        planName: plan.displayName,
        userCount: usersOnPlan.length,
        users: usersOnPlan.map(u => ({ id: u.id, name: u.name, email: u.email }))
      });
    } catch (error: any) {
      console.error('Error fetching plan users:', error);
      res.status(500).json({ error: 'Failed to fetch plan users' });
    }
  });

  router.post('/plans/:planId/migrate', requireAdminPermission('billing', 'plans', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const { planId } = req.params;
      const { targetPlanId } = req.body;
      
      if (!targetPlanId) {
        return res.status(400).json({ error: 'Target plan ID is required' });
      }
      
      const sourcePlan = await storage.getPlan(planId);
      if (!sourcePlan) {
        return res.status(404).json({ error: 'Source plan not found' });
      }
      
      const targetPlan = await storage.getPlan(targetPlanId);
      if (!targetPlan) {
        return res.status(404).json({ error: 'Target plan not found' });
      }
      
      const allUsers = await storage.getAllUsers();
      const usersOnPlan = allUsers.filter(user => {
        return user.planType && user.planType.toLowerCase() === sourcePlan.name.toLowerCase();
      });
      
      if (usersOnPlan.length === 0) {
        return res.json({ success: true, migratedCount: 0 });
      }
      
      const { users } = await import('@shared/schema');
      
      for (const user of usersOnPlan) {
        await db.update(users)
          .set({ planType: targetPlan.name })
          .where(eq(users.id, user.id));
      }
      
      res.json({
        success: true,
        migratedCount: usersOnPlan.length,
        targetPlanName: targetPlan.displayName
      });
    } catch (error: any) {
      console.error('Error migrating users:', error);
      res.status(500).json({ error: 'Failed to migrate users' });
    }
  });

  router.delete('/plans/:planId', requireAdminPermission('billing', 'plans', 'delete'), async (req: AdminRequest, res: Response) => {
    try {
      const { planId } = req.params;
      
      const plan = await storage.getPlan(planId);
      if (!plan) {
        return res.status(404).json({ error: 'Plan not found' });
      }
      
      const allUsers = await storage.getAllUsers();
      const usersOnPlan = allUsers.filter(user => {
        return user.planType && user.planType.toLowerCase() === plan.name.toLowerCase();
      });
      
      if (usersOnPlan.length > 0) {
        return res.status(400).json({ 
          error: 'USERS_NEED_MIGRATION',
          userCount: usersOnPlan.length,
          message: `${usersOnPlan.length} user(s) are currently subscribed to this plan. Please migrate them to another plan first.` 
        });
      }
      
      await storage.deletePlan(planId);
      res.json({ success: true });
    } catch (error: any) {
      console.error('Error deleting plan:', error);
      res.status(500).json({ error: 'Failed to delete plan' });
    }
  });

  // Stripe sync endpoint
  router.post('/plans/:planId/sync/stripe', requireAdminPermission('billing', 'plans', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const { planId } = req.params;
      
      const plan = await storage.getPlan(planId);
      if (!plan) {
        return res.status(404).json({ error: 'Plan not found' });
      }
      
      const stripe = await getStripeClient();
      if (!stripe) {
        return res.status(400).json({ error: 'Stripe is not configured' });
      }
      
      const currency = await getDefaultCurrency();
      const monthlyAmount = parseFloat(plan.monthlyPrice?.toString() || '0');
      const yearlyAmount = parseFloat(plan.yearlyPrice?.toString() || '0');
      
      let stripeProductId = plan.stripeProductId;
      
      // Create product if it doesn't exist
      if (!stripeProductId) {
        const stripeProduct = await stripe.products.create({
          name: plan.displayName,
          description: plan.description || undefined,
          metadata: { planId: plan.id, planName: plan.name }
        });
        stripeProductId = stripeProduct.id;
      }
      
      // Create or update monthly price
      let stripeMonthlyPriceId = plan.stripeMonthlyPriceId;
      if (monthlyAmount > 0 && !stripeMonthlyPriceId) {
        const monthlyPrice = await stripe.prices.create({
          product: stripeProductId,
          unit_amount: Math.round(monthlyAmount * 100),
          currency: currency.toLowerCase(),
          recurring: { interval: 'month' },
          metadata: { planId: plan.id, billingPeriod: 'monthly' }
        });
        stripeMonthlyPriceId = monthlyPrice.id;
      }
      
      // Create or update yearly price
      let stripeYearlyPriceId = plan.stripeYearlyPriceId;
      if (yearlyAmount > 0 && !stripeYearlyPriceId) {
        const yearlyPrice = await stripe.prices.create({
          product: stripeProductId,
          unit_amount: Math.round(yearlyAmount * 100),
          currency: currency.toLowerCase(),
          recurring: { interval: 'year' },
          metadata: { planId: plan.id, billingPeriod: 'yearly' }
        });
        stripeYearlyPriceId = yearlyPrice.id;
      }
      
      await storage.updatePlan(planId, {
        stripeProductId,
        stripeMonthlyPriceId,
        stripeYearlyPriceId
      });
      
      console.log(`✅ [Stripe] Synced plan ${planId} with product ${stripeProductId}`);
      
      res.json({ 
        success: true, 
        stripeProductId,
        stripeMonthlyPriceId,
        stripeYearlyPriceId
      });
    } catch (error: any) {
      console.error('Error syncing plan to Stripe:', error);
      res.status(500).json({ error: 'Failed to sync plan to Stripe' });
    }
  });

  // Razorpay sync endpoint
  router.post('/plans/:planId/sync/razorpay', requireAdminPermission('billing', 'plans', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const { planId } = req.params;
      
      const plan = await storage.getPlan(planId);
      if (!plan) {
        return res.status(404).json({ error: 'Plan not found' });
      }
      
      const razorpayConfigured = (await isRazorpayEnabled()) && (await isRazorpayConfigured());
      if (!razorpayConfigured) {
        return res.status(400).json({ error: 'Razorpay is not configured' });
      }
      
      const monthlyInrAmount = plan.razorpayMonthlyPrice ? parseFloat(plan.razorpayMonthlyPrice.toString()) : 0;
      const yearlyInrAmount = plan.razorpayYearlyPrice ? parseFloat(plan.razorpayYearlyPrice.toString()) : 0;
      
      let razorpayPlanId = plan.razorpayPlanId;
      let razorpayYearlyPlanId = plan.razorpayYearlyPlanId;
      
      if (monthlyInrAmount > 0) {
        if (!razorpayPlanId) {
          const monthlyPlan = await createRazorpayPlan({
            period: 'monthly',
            interval: 1,
            name: `${plan.displayName} - Monthly`,
            amount: monthlyInrAmount,
            currency: 'INR',
            description: plan.description || undefined,
            notes: { planId: plan.id, billingPeriod: 'monthly' }
          });
          razorpayPlanId = monthlyPlan.id;
          console.log(`✅ [Razorpay] Created monthly plan ${monthlyPlan.id}`);
        } else {
          // Existing plan — check if price changed (Razorpay plans are immutable, create new if different)
          try {
            const existingRzpPlan = await fetchRazorpayPlan(razorpayPlanId);
            const existingAmountPaise = existingRzpPlan?.item?.amount;
            const desiredAmountPaise = Math.round(monthlyInrAmount * 100);
            if (existingAmountPaise !== desiredAmountPaise) {
              console.log(`🔄 [Razorpay] Monthly price changed (${existingAmountPaise} → ${desiredAmountPaise} paise), creating new plan`);
              const monthlyPlan = await createRazorpayPlan({
                period: 'monthly',
                interval: 1,
                name: `${plan.displayName} - Monthly`,
                amount: monthlyInrAmount,
                currency: 'INR',
                description: plan.description || undefined,
                notes: { planId: plan.id, billingPeriod: 'monthly' }
              });
              razorpayPlanId = monthlyPlan.id;
              console.log(`✅ [Razorpay] Created updated monthly plan ${monthlyPlan.id}`);
            } else {
              console.log(`ℹ️ [Razorpay] Monthly price unchanged, keeping existing plan ${razorpayPlanId}`);
            }
          } catch (fetchErr: any) {
            console.warn(`⚠️ [Razorpay] Could not verify monthly plan price, keeping existing: ${fetchErr.message}`);
          }
        }
      }
      
      if (yearlyInrAmount > 0) {
        if (!razorpayYearlyPlanId) {
          const yearlyPlan = await createRazorpayPlan({
            period: 'yearly',
            interval: 1,
            name: `${plan.displayName} - Yearly`,
            amount: yearlyInrAmount,
            currency: 'INR',
            description: plan.description || undefined,
            notes: { planId: plan.id, billingPeriod: 'yearly' }
          });
          razorpayYearlyPlanId = yearlyPlan.id;
          console.log(`✅ [Razorpay] Created yearly plan ${yearlyPlan.id}`);
        } else {
          // Existing plan — check if price changed
          try {
            const existingRzpPlan = await fetchRazorpayPlan(razorpayYearlyPlanId);
            const existingAmountPaise = existingRzpPlan?.item?.amount;
            const desiredAmountPaise = Math.round(yearlyInrAmount * 100);
            if (existingAmountPaise !== desiredAmountPaise) {
              console.log(`🔄 [Razorpay] Yearly price changed (${existingAmountPaise} → ${desiredAmountPaise} paise), creating new plan`);
              const yearlyPlan = await createRazorpayPlan({
                period: 'yearly',
                interval: 1,
                name: `${plan.displayName} - Yearly`,
                amount: yearlyInrAmount,
                currency: 'INR',
                description: plan.description || undefined,
                notes: { planId: plan.id, billingPeriod: 'yearly' }
              });
              razorpayYearlyPlanId = yearlyPlan.id;
              console.log(`✅ [Razorpay] Created updated yearly plan ${yearlyPlan.id}`);
            } else {
              console.log(`ℹ️ [Razorpay] Yearly price unchanged, keeping existing plan ${razorpayYearlyPlanId}`);
            }
          } catch (fetchErr: any) {
            console.warn(`⚠️ [Razorpay] Could not verify yearly plan price, keeping existing: ${fetchErr.message}`);
          }
        }
      }
      
      await storage.updatePlan(planId, { razorpayPlanId, razorpayYearlyPlanId });
      
      res.json({ 
        success: true,
        razorpayPlanId,
        razorpayYearlyPlanId
      });
    } catch (error: any) {
      console.error('Error syncing plan to Razorpay:', error);
      res.status(500).json({ error: 'Failed to sync plan to Razorpay' });
    }
  });

  // PayPal sync endpoint
  router.post('/plans/:planId/sync/paypal', requireAdminPermission('billing', 'plans', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const { planId } = req.params;
      
      const plan = await storage.getPlan(planId);
      if (!plan) {
        return res.status(404).json({ error: 'Plan not found' });
      }
      
      const paypalConfigured = (await isPayPalEnabled()) && (await isPayPalConfigured());
      if (!paypalConfigured) {
        return res.status(400).json({ error: 'PayPal is not configured' });
      }
      
      const paypalCurrency = await getPayPalCurrency();
      const paypalMonthlyAmount = plan.paypalMonthlyPrice ? parseFloat(plan.paypalMonthlyPrice.toString()) : 0;
      const paypalYearlyAmount = plan.paypalYearlyPrice ? parseFloat(plan.paypalYearlyPrice.toString()) : 0;
      
      let paypalProductId = plan.paypalProductId;
      let paypalMonthlyPlanId = plan.paypalMonthlyPlanId;
      let paypalYearlyPlanId = plan.paypalYearlyPlanId;
      
      if (!paypalProductId) {
        const paypalProduct = await createPayPalProduct({
          name: plan.displayName,
          description: plan.description || undefined,
          type: 'SERVICE',
        });
        paypalProductId = paypalProduct.id;
      }
      
      if (paypalMonthlyAmount > 0 && paypalProductId) {
        if (!paypalMonthlyPlanId) {
          const monthlyPlan = await createPayPalPlan({
            productId: paypalProductId,
            name: `${plan.displayName} - Monthly`,
            description: plan.description || undefined,
            billingCycles: [{
              frequency: { interval_unit: 'MONTH', interval_count: 1 },
              tenure_type: 'REGULAR',
              sequence: 1,
              total_cycles: 0,
              pricing_scheme: {
                fixed_price: { value: paypalMonthlyAmount.toFixed(2), currency_code: paypalCurrency.currency },
              },
            }],
          });
          paypalMonthlyPlanId = monthlyPlan.id;
          console.log(`✅ [PayPal] Created monthly plan ${monthlyPlan.id}`);
        } else {
          // Existing plan — check if price changed; PayPal plans are immutable, deactivate old and create new
          try {
            const existingPpPlan = await fetchPayPalPlan(paypalMonthlyPlanId);
            const existingPrice = existingPpPlan?.billing_cycles?.[0]?.pricing_scheme?.fixed_price?.value;
            const desiredPrice = paypalMonthlyAmount.toFixed(2);
            if (existingPrice !== desiredPrice) {
              console.log(`🔄 [PayPal] Monthly price changed (${existingPrice} → ${desiredPrice}), replacing plan`);
              try {
                await deactivatePayPalPlan(paypalMonthlyPlanId);
              } catch (deactivateErr: any) {
                console.warn(`⚠️ [PayPal] Could not deactivate old monthly plan: ${deactivateErr.message}`);
              }
              const monthlyPlan = await createPayPalPlan({
                productId: paypalProductId,
                name: `${plan.displayName} - Monthly`,
                description: plan.description || undefined,
                billingCycles: [{
                  frequency: { interval_unit: 'MONTH', interval_count: 1 },
                  tenure_type: 'REGULAR',
                  sequence: 1,
                  total_cycles: 0,
                  pricing_scheme: {
                    fixed_price: { value: desiredPrice, currency_code: paypalCurrency.currency },
                  },
                }],
              });
              paypalMonthlyPlanId = monthlyPlan.id;
              console.log(`✅ [PayPal] Created updated monthly plan ${monthlyPlan.id}`);
            } else {
              console.log(`ℹ️ [PayPal] Monthly price unchanged, keeping existing plan ${paypalMonthlyPlanId}`);
            }
          } catch (fetchErr: any) {
            console.warn(`⚠️ [PayPal] Could not verify monthly plan price, keeping existing: ${fetchErr.message}`);
          }
        }
      }
      
      if (paypalYearlyAmount > 0 && paypalProductId) {
        if (!paypalYearlyPlanId) {
          const yearlyPlan = await createPayPalPlan({
            productId: paypalProductId,
            name: `${plan.displayName} - Yearly`,
            description: plan.description || undefined,
            billingCycles: [{
              frequency: { interval_unit: 'YEAR', interval_count: 1 },
              tenure_type: 'REGULAR',
              sequence: 1,
              total_cycles: 0,
              pricing_scheme: {
                fixed_price: { value: paypalYearlyAmount.toFixed(2), currency_code: paypalCurrency.currency },
              },
            }],
          });
          paypalYearlyPlanId = yearlyPlan.id;
          console.log(`✅ [PayPal] Created yearly plan ${yearlyPlan.id}`);
        } else {
          // Existing plan — check if price changed
          try {
            const existingPpPlan = await fetchPayPalPlan(paypalYearlyPlanId);
            const existingPrice = existingPpPlan?.billing_cycles?.[0]?.pricing_scheme?.fixed_price?.value;
            const desiredPrice = paypalYearlyAmount.toFixed(2);
            if (existingPrice !== desiredPrice) {
              console.log(`🔄 [PayPal] Yearly price changed (${existingPrice} → ${desiredPrice}), replacing plan`);
              try {
                await deactivatePayPalPlan(paypalYearlyPlanId);
              } catch (deactivateErr: any) {
                console.warn(`⚠️ [PayPal] Could not deactivate old yearly plan: ${deactivateErr.message}`);
              }
              const yearlyPlan = await createPayPalPlan({
                productId: paypalProductId,
                name: `${plan.displayName} - Yearly`,
                description: plan.description || undefined,
                billingCycles: [{
                  frequency: { interval_unit: 'YEAR', interval_count: 1 },
                  tenure_type: 'REGULAR',
                  sequence: 1,
                  total_cycles: 0,
                  pricing_scheme: {
                    fixed_price: { value: desiredPrice, currency_code: paypalCurrency.currency },
                  },
                }],
              });
              paypalYearlyPlanId = yearlyPlan.id;
              console.log(`✅ [PayPal] Created updated yearly plan ${yearlyPlan.id}`);
            } else {
              console.log(`ℹ️ [PayPal] Yearly price unchanged, keeping existing plan ${paypalYearlyPlanId}`);
            }
          } catch (fetchErr: any) {
            console.warn(`⚠️ [PayPal] Could not verify yearly plan price, keeping existing: ${fetchErr.message}`);
          }
        }
      }
      
      await storage.updatePlan(planId, { paypalProductId, paypalMonthlyPlanId, paypalYearlyPlanId });
      
      console.log(`✅ [PayPal] Synced plan ${planId}`);
      
      res.json({ 
        success: true,
        paypalProductId,
        paypalMonthlyPlanId,
        paypalYearlyPlanId
      });
    } catch (error: any) {
      console.error('Error syncing plan to PayPal:', error);
      res.status(500).json({ error: 'Failed to sync plan to PayPal' });
    }
  });

  // Paystack sync endpoint
  router.post('/plans/:planId/sync/paystack', requireAdminPermission('billing', 'plans', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const { planId } = req.params;
      
      const plan = await storage.getPlan(planId);
      if (!plan) {
        return res.status(404).json({ error: 'Plan not found' });
      }
      
      const paystackConfigured = (await isPaystackEnabled()) && (await isPaystackConfigured());
      if (!paystackConfigured) {
        return res.status(400).json({ error: 'Paystack is not configured' });
      }
      
      const paystackCurrency = await getPaystackCurrency();
      const PAYSTACK_MIN_AMOUNT = 1;
      
      const paystackMonthlyAmount = plan.paystackMonthlyPrice ? parseFloat(plan.paystackMonthlyPrice.toString()) : 0;
      const paystackYearlyAmount = plan.paystackYearlyPrice ? parseFloat(plan.paystackYearlyPrice.toString()) : 0;
      
      let paystackMonthlyPlanCode = plan.paystackMonthlyPlanCode;
      let paystackYearlyPlanCode = plan.paystackYearlyPlanCode;
      
      if (paystackMonthlyAmount >= PAYSTACK_MIN_AMOUNT && !paystackMonthlyPlanCode) {
        const monthlyPlan = await createPaystackPlan({
          name: `${plan.displayName} - Monthly`,
          interval: 'monthly',
          amount: paystackMonthlyAmount,
          currency: paystackCurrency.currency,
          description: plan.description || undefined,
        });
        paystackMonthlyPlanCode = monthlyPlan.plan_code;
      }
      
      if (paystackYearlyAmount >= PAYSTACK_MIN_AMOUNT && !paystackYearlyPlanCode) {
        const yearlyPlan = await createPaystackPlan({
          name: `${plan.displayName} - Yearly`,
          interval: 'annually',
          amount: paystackYearlyAmount,
          currency: paystackCurrency.currency,
          description: plan.description || undefined,
        });
        paystackYearlyPlanCode = yearlyPlan.plan_code;
      }
      
      await storage.updatePlan(planId, { paystackMonthlyPlanCode, paystackYearlyPlanCode });
      
      console.log(`✅ [Paystack] Synced plan ${planId}`);
      
      res.json({ 
        success: true,
        paystackMonthlyPlanCode,
        paystackYearlyPlanCode
      });
    } catch (error: any) {
      console.error('Error syncing plan to Paystack:', error);
      res.status(500).json({ error: 'Failed to sync plan to Paystack' });
    }
  });

  // MercadoPago sync endpoint
  router.post('/plans/:planId/sync/mercadopago', requireAdminPermission('billing', 'plans', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const { planId } = req.params;
      
      const plan = await storage.getPlan(planId);
      if (!plan) {
        return res.status(404).json({ error: 'Plan not found' });
      }
      
      const mercadopagoConfigured = (await isMercadoPagoEnabled()) && (await isMercadoPagoConfigured());
      if (!mercadopagoConfigured) {
        return res.status(400).json({ error: 'MercadoPago is not configured' });
      }
      
      const mercadopagoCurrency = await getMercadoPagoCurrency();
      const baseUrl = process.env.BASE_URL || process.env.APP_URL;
      
      if (!baseUrl) {
        return res.status(400).json({ error: 'BASE_URL is not configured' });
      }
      
      const mercadopagoMonthlyAmount = plan.mercadopagoMonthlyPrice ? parseFloat(plan.mercadopagoMonthlyPrice.toString()) : 0;
      const mercadopagoYearlyAmount = plan.mercadopagoYearlyPrice ? parseFloat(plan.mercadopagoYearlyPrice.toString()) : 0;
      
      let mercadopagoMonthlyPlanId = plan.mercadopagoMonthlyPlanId;
      let mercadopagoYearlyPlanId = plan.mercadopagoYearlyPlanId;
      
      if (mercadopagoMonthlyAmount > 0 && !mercadopagoMonthlyPlanId) {
        const monthlyPlan = await createMercadoPagoSubscriptionPlan({
          reason: `${plan.displayName} - Monthly`,
          autoRecurring: {
            frequency: 1,
            frequencyType: 'months',
            transactionAmount: mercadopagoMonthlyAmount,
            currencyId: mercadopagoCurrency.currency,
          },
          backUrl: `${baseUrl}/app/billing`,
        });
        mercadopagoMonthlyPlanId = monthlyPlan.id;
      }
      
      if (mercadopagoYearlyAmount > 0 && !mercadopagoYearlyPlanId) {
        const yearlyPlan = await createMercadoPagoSubscriptionPlan({
          reason: `${plan.displayName} - Yearly`,
          autoRecurring: {
            frequency: 12,
            frequencyType: 'months',
            transactionAmount: mercadopagoYearlyAmount,
            currencyId: mercadopagoCurrency.currency,
          },
          backUrl: `${baseUrl}/app/billing`,
        });
        mercadopagoYearlyPlanId = yearlyPlan.id;
      }
      
      await storage.updatePlan(planId, { mercadopagoMonthlyPlanId, mercadopagoYearlyPlanId });
      
      console.log(`✅ [MercadoPago] Synced plan ${planId}`);
      
      res.json({ 
        success: true,
        mercadopagoMonthlyPlanId,
        mercadopagoYearlyPlanId
      });
    } catch (error: any) {
      console.error('Error syncing plan to MercadoPago:', error);
      res.status(500).json({ error: 'Failed to sync plan to MercadoPago' });
    }
  });
}
