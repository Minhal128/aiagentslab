'use strict';
import { Router, Response } from 'express';
import { storage } from '../../storage';
import { AdminRequest, requireAdminPermission } from '../../middleware/admin-auth';
import { insertCreditPackageSchema } from '@shared/schema';
import Stripe from 'stripe';
import { getStripeCurrency } from '../../services/stripe-service';

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

export function registerCreditPackagesRoutes(router: Router) {
  router.get('/credit-packages', requireAdminPermission('billing', 'credits', 'read'), async (req: AdminRequest, res: Response) => {
    try {
      const packages = await storage.getAllCreditPackages();
      res.json(packages);
    } catch (error) {
      console.error('Error fetching credit packages:', error);
      res.status(500).json({ error: 'Failed to fetch credit packages' });
    }
  });

  router.post('/credit-packages', requireAdminPermission('billing', 'credits', 'create'), async (req: AdminRequest, res: Response) => {
    try {
      const bodyData = { ...req.body };
      if (typeof bodyData.price === 'number') {
        bodyData.price = bodyData.price.toFixed(2);
      }
      if (typeof bodyData.razorpayPrice === 'number') {
        bodyData.razorpayPrice = bodyData.razorpayPrice.toFixed(2);
      }
      
      let packageData;
      try {
        packageData = insertCreditPackageSchema.parse(bodyData);
      } catch (validationError: any) {
        if (validationError.errors) {
          return res.status(400).json({ 
            error: 'Validation failed', 
            details: validationError.errors 
          });
        }
        throw validationError;
      }
      
      let newPackage = await storage.createCreditPackage(packageData);
      
      const stripe = await getStripeClient();
      if (stripe) {
        try {
          const currency = await getDefaultCurrency();
          
          const stripeProduct = await stripe.products.create({
            name: packageData.name,
            description: packageData.description || undefined,
            metadata: {
              packageId: newPackage.id,
              credits: packageData.credits.toString()
            }
          });
          
          const stripePrice = await stripe.prices.create({
            product: stripeProduct.id,
            unit_amount: Math.round(parseFloat(packageData.price.toString()) * 100),
            currency: currency.toLowerCase(),
            metadata: {
              packageId: newPackage.id,
              credits: packageData.credits.toString()
            }
          });
          
          await storage.updateCreditPackage(newPackage.id, {
            stripeProductId: stripeProduct.id,
            stripePriceId: stripePrice.id
          });
          
          const updatedPackage = await storage.getCreditPackage(newPackage.id);
          if (updatedPackage) {
            newPackage = updatedPackage;
          }
          
          console.log(`✅ [Stripe] Created product ${stripeProduct.id} and price ${stripePrice.id} for credit package ${newPackage.id}`);
        } catch (stripeError: any) {
          console.error('❌ [Stripe] Error syncing credit package to Stripe:', stripeError.message);
        }
      }
      
      res.json(newPackage);
    } catch (error) {
      console.error('Error creating credit package:', error);
      res.status(500).json({ error: 'Failed to create credit package' });
    }
  });

  router.patch('/credit-packages/:packageId', requireAdminPermission('billing', 'credits', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const { packageId } = req.params;
      
      const bodyData = { ...req.body };
      if (typeof bodyData.price === 'number') {
        bodyData.price = bodyData.price.toFixed(2);
      }
      if (typeof bodyData.razorpayPrice === 'number') {
        bodyData.razorpayPrice = bodyData.razorpayPrice.toFixed(2);
      }
      
      let updateData;
      try {
        updateData = insertCreditPackageSchema.partial().parse(bodyData);
      } catch (validationError: any) {
        if (validationError.errors) {
          return res.status(400).json({ 
            error: 'Validation failed', 
            details: validationError.errors 
          });
        }
        throw validationError;
      }
      
      const existingPackage = await storage.getCreditPackage(packageId);
      if (!existingPackage) {
        return res.status(404).json({ error: 'Credit package not found' });
      }
      
      const stripe = await getStripeClient();
      if (stripe) {
        try {
          const currency = await getDefaultCurrency();
          const forceStripeSync = req.body.forceStripeSync === true;
          
          let stripeProductId = existingPackage.stripeProductId;
          
          if (!stripeProductId) {
            const stripeProduct = await stripe.products.create({
              name: updateData.name || existingPackage.name,
              description: updateData.description || existingPackage.description || undefined,
              metadata: {
                packageId: packageId,
                credits: (updateData.credits || existingPackage.credits).toString()
              }
            });
            stripeProductId = stripeProduct.id;
            updateData.stripeProductId = stripeProductId;
          } else {
            if (updateData.name || updateData.description) {
              await stripe.products.update(stripeProductId, {
                name: updateData.name || existingPackage.name,
                description: updateData.description || existingPackage.description || undefined,
                metadata: {
                  packageId: packageId,
                  credits: (updateData.credits || existingPackage.credits).toString()
                }
              });
            }
          }
          
          const newPrice = updateData.price?.toString();
          const oldPrice = existingPackage.price?.toString();
          const priceChanged = newPrice && newPrice !== oldPrice;
          const effectivePrice = newPrice || oldPrice;
          const effectiveAmount = effectivePrice ? parseFloat(effectivePrice) : 0;
          const shouldResyncPrice = forceStripeSync && existingPackage.stripePriceId && effectiveAmount > 0;
          
          if ((priceChanged || shouldResyncPrice) && effectiveAmount > 0) {
            if (existingPackage.stripePriceId) {
              try {
                await stripe.prices.update(existingPackage.stripePriceId, { active: false });
              } catch (archiveErr: any) {
                console.warn(`⚠️ [Stripe] Could not archive old price: ${archiveErr.message}`);
              }
            }
            
            const priceAmount = priceChanged ? newPrice! : effectivePrice!;
            const stripePrice = await stripe.prices.create({
              product: stripeProductId!,
              unit_amount: Math.round(parseFloat(priceAmount) * 100),
              currency: currency.toLowerCase(),
              metadata: {
                packageId: packageId,
                credits: (updateData.credits || existingPackage.credits).toString()
              }
            });
            updateData.stripePriceId = stripePrice.id;
          }
        } catch (stripeError: any) {
          console.error('❌ [Stripe] Error syncing credit package update to Stripe:', stripeError.message);
        }
      }
      
      await storage.updateCreditPackage(packageId, updateData);
      
      const updatedPackage = await storage.getCreditPackage(packageId);
      res.json({ success: true, package: updatedPackage });
    } catch (error: any) {
      console.error('Error updating credit package:', error);
      res.status(500).json({ error: 'Failed to update credit package' });
    }
  });
}
