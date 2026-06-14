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

import { Router, Request, Response } from "express";
import { RouteContext, AuthRequest } from "./common";
import { eq, and, isNull, sql } from "drizzle-orm";
import { phoneNumbers, creditTransactions, phoneNumberRentals } from "@shared/schema";

export function createPhoneRoutes(ctx: RouteContext): Router {
  const router = Router();
  const { db, storage, authenticateToken, authenticateHybrid, requireRole, checkActiveMembership, twilioService } = ctx;

  // Twilio Addresses - For regulatory compliance in countries like Australia, UK, Germany
  router.get("/api/twilio/addresses", authenticateHybrid, async (req: AuthRequest, res: Response) => {
    try {
      const { country } = req.query;
      const addresses = await twilioService.listAddresses(country as string);
      res.json(addresses);
    } catch (error: any) {
      console.error("List Twilio addresses error:", error);
      
      if (error.message?.includes('Authentication') || error.message?.includes('not connected') || error.status === 401) {
        return res.status(503).json({ 
          error: "Twilio credentials not configured", 
          message: "Please configure your Twilio credentials to view addresses."
        });
      }
      
      res.status(500).json({ error: "Failed to list addresses" });
    }
  });
  
  router.get("/api/twilio/address-requirements/:country", authenticateHybrid, async (req: AuthRequest, res: Response) => {
    try {
      const { country } = req.params;
      const isoCountry = country.toUpperCase();
      const reqs = await twilioService.getCountryRequirements(isoCountry);
      res.json({ 
        country: isoCountry,
        requirement: reqs.addressRequired,
        requiresAddress: reqs.addressRequired !== 'none',
        requiresLocalAddress: reqs.addressRequired === 'local',
        requiresBundle: reqs.bundleRequired,
        message: reqs.addressRequired === 'none' 
          ? 'No address required for this country'
          : reqs.addressRequired === 'local'
            ? `An address within ${isoCountry} is required for phone number purchase`
            : 'Any verified address is required for phone number purchase'
      });
    } catch (error: any) {
      console.error("Get address requirements error:", error);
      res.status(500).json({ error: "Failed to get address requirements" });
    }
  });

  // Phone Numbers routes
  router.get("/api/phone-numbers", authenticateHybrid, async (req: AuthRequest, res: Response) => {
    try {
      const userPhoneNumbers = await storage.getUserPhoneNumbers(req.userId!);
      
      const user = await storage.getUser(req.userId!);
      
      let allPhoneNumbers = [...userPhoneNumbers];
      if (user && user.planType === 'free') {
        const systemPoolNumbers = await db
          .select()
          .from(phoneNumbers)
          .where(
            and(
              eq(phoneNumbers.isSystemPool, true),
              isNull(phoneNumbers.userId)
            )
          );
        allPhoneNumbers = [...allPhoneNumbers, ...systemPoolNumbers];
      }
      
      res.json(allPhoneNumbers);
    } catch (error: any) {
      console.error("Get phone numbers error:", error);
      res.status(500).json({ error: "Failed to get phone numbers" });
    }
  });

  router.get("/api/phone-numbers/search", authenticateHybrid, async (req: AuthRequest, res: Response) => {
    try {
      const { country, areaCode, postalCode, locality, region, contains, numberType } = req.query;
      
      // Country is required, but other filters are optional
      if (!country) {
        return res.status(400).json({ error: "Country is required" });
      }

      const resolvedNumberType: 'local' | 'toll-free' | 'mobile' | 'national' =
        ['toll-free', 'mobile', 'national'].includes(numberType as string) ? (numberType as any) : 'local';

      const availableNumbers = await twilioService.searchAvailableNumbers({
        country: (country as string),
        areaCode: areaCode as string,
        contains: contains as string,
        inPostalCode: postalCode as string,
        inLocality: locality as string,
        inRegion: region as string,
        limit: 20,
        numberType: resolvedNumberType,
      });

      res.json(availableNumbers);
    } catch (error: any) {
      console.error("Search phone numbers error:", error);
      
      if (error.message?.includes('Authentication') || error.message?.includes('not connected') || error.status === 401) {
        return res.status(503).json({ 
          error: "Twilio credentials not configured", 
          message: "Please configure your Twilio credentials. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in your .env file, or configure via Admin Panel > Settings. Get your credentials from console.twilio.com"
        });
      }
      
      res.status(500).json({ error: "Failed to search phone numbers" });
    }
  });
  
  // Legacy route for backward compatibility
  router.get("/api/phone-numbers/search/:areaCode", authenticateHybrid, async (req: AuthRequest, res: Response) => {
    try {
      const { areaCode } = req.params;
      
      if (!areaCode || areaCode.length !== 3) {
        return res.status(400).json({ error: "Area code must be exactly 3 digits" });
      }

      const availableNumbers = await twilioService.searchAvailableNumbers({
        areaCode,
        limit: 20,
      });

      res.json(availableNumbers);
    } catch (error: any) {
      console.error("Search phone numbers error:", error);
      
      if (error.message?.includes('Authentication') || error.message?.includes('not connected') || error.status === 401) {
        return res.status(503).json({ 
          error: "Twilio credentials not configured", 
          message: "Please configure your Twilio credentials. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in your .env file, or configure via Admin Panel > Settings. Get your credentials from console.twilio.com"
        });
      }
      
      res.status(500).json({ error: "Failed to search phone numbers" });
    }
  });

  router.post("/api/phone-numbers/buy", authenticateToken, checkActiveMembership(storage), async (req: AuthRequest, res: Response) => {
    try {
      const { phoneNumber, friendlyName, addressSid, bundleSid, country, numberType } = req.body;
      // Normalise numberType: Twilio uses 'local', 'toll-free', 'mobile' or 'national'; default to 'local'
      const resolvedNumberType: 'local' | 'toll-free' | 'mobile' | 'national' =
        ['toll-free', 'mobile', 'national'].includes(numberType as string) ? (numberType as any) : 'local';

      if (!phoneNumber) {
        return res.status(400).json({ error: "Phone number is required" });
      }

      const user = await storage.getUser(req.userId!);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const { getUserPlanCapabilities } = await import('../services/membership-service');
      const capabilities = await getUserPlanCapabilities(req.userId!);
      if (!capabilities.canPurchaseNumbers) {
        return res.status(403).json({
          error: "Plan upgrade required",
          message: `Your ${capabilities.planDisplayName} plan does not allow purchasing phone numbers. Please upgrade to Pro to purchase your own phone numbers.`,
          upgradeRequired: true
        });
      }
      
      // KYC Verification Check for Twilio
      const twilioKycSetting = await storage.getGlobalSetting('twilio_kyc_required');
      const twilioKycRequired = twilioKycSetting?.value === true || twilioKycSetting?.value === 'true';
      
      if (twilioKycRequired) {
        const { KycService } = await import('../engines/kyc/services/kyc.service');
        const kycStatus = await KycService.getUserKycStatus(req.userId!);
        
        if (kycStatus.status !== 'approved') {
          return res.status(403).json({
            error: "KYC verification required",
            message: "You must complete KYC verification before purchasing Twilio phone numbers. Please upload your documents in Settings.",
            kycRequired: true,
            kycStatus: kycStatus.status
          });
        }
      }
      
      const effectiveLimits = await storage.getUserEffectiveLimits(req.userId!);
      const currentPhoneCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(phoneNumbers)
        .where(eq(phoneNumbers.userId, req.userId!));
      
      const phoneCount = Number(currentPhoneCount[0]?.count || 0);
      const maxPhoneNumbers = typeof effectiveLimits.maxPhoneNumbers === 'number' ? effectiveLimits.maxPhoneNumbers : 0;
      // Skip limit check if explicitly unlimited (999 or -1)
      if (maxPhoneNumbers !== 999 && maxPhoneNumbers !== -1 && phoneCount >= maxPhoneNumbers) {
        return res.status(403).json({ 
          error: "Phone number limit reached", 
          message: `You have reached your maximum of ${maxPhoneNumbers} phone numbers. Please upgrade your plan or release existing numbers.`,
          limit: maxPhoneNumbers,
          current: phoneCount
        });
      }

      const phoneNumberCostSetting = await storage.getGlobalSetting('phone_number_monthly_credits');
      const monthlyCredits = (phoneNumberCostSetting?.value as number) || 50;

      if (process.env.NODE_ENV !== 'development') {
        if ((user.credits || 0) < monthlyCredits) {
          return res.status(400).json({ 
            error: `Insufficient credits. Phone number rental requires ${monthlyCredits} credits per month. You have ${user.credits || 0} credits.` 
          });
        }
      }

      // Server-side validation for address requirements (regulatory compliance)
      // Use country from request (preferred) or detect from phone number prefix as fallback
      let phoneCountry = country?.toUpperCase() || null;
      
      // Fallback: detect from phone number prefix if country not provided
      if (!phoneCountry) {
        const prefixMap: Record<string, string> = {
          '+61': 'AU', '+44': 'GB', '+49': 'DE', '+33': 'FR', '+39': 'IT',
          '+34': 'ES', '+31': 'NL', '+32': 'BE', '+43': 'AT', '+41': 'CH',
          '+353': 'IE', '+351': 'PT', '+48': 'PL', '+46': 'SE', '+47': 'NO',
          '+45': 'DK', '+358': 'FI', '+64': 'NZ', '+65': 'SG', '+81': 'JP', '+82': 'KR',
          '+27': 'ZA', '+55': 'BR', '+52': 'MX', '+30': 'GR', '+36': 'HU',
          '+359': 'BG', '+352': 'LU'
        };
        
        // Check longer prefixes first (e.g., +353 before +3)
        const sortedPrefixes = Object.keys(prefixMap).sort((a, b) => b.length - a.length);
        for (const prefix of sortedPrefixes) {
          if (phoneNumber.startsWith(prefix)) {
            phoneCountry = prefixMap[prefix];
            break;
          }
        }
        
        if (!phoneCountry) {
          console.log(`[Phone Purchase] Could not determine country for number: ${phoneNumber.substring(0, 5)}***. Address requirement check skipped.`);
        }
      }
      
      // Dynamically fetch country requirements from Twilio's Regulations API (cached 24h)
      // Single call determines both bundle and address requirements for any country
      let effectiveBundleSid = bundleSid;
      let effectiveAddressSid = addressSid;

      if (phoneCountry) {
        const countryReqs = await twilioService.getCountryRequirements(phoneCountry, resolvedNumberType);
        console.log(`[Phone Purchase] Requirements for ${phoneCountry}/${resolvedNumberType}: bundle=${countryReqs.bundleRequired}, address=${countryReqs.addressRequired}`);

        // Check regulatory bundle FIRST (harder blocker — requires admin action, 1-3 days approval)
        if (countryReqs.bundleRequired && !effectiveBundleSid) {
          console.log(`[Phone Purchase] Country ${phoneCountry} requires ${resolvedNumberType} regulatory bundle, checking Twilio...`);
          const approvedBundle = await twilioService.getApprovedBundleForCountry(phoneCountry, resolvedNumberType);

          if (approvedBundle) {
            effectiveBundleSid = approvedBundle.bundleSid;
            console.log(`[Phone Purchase] Auto-attached approved ${resolvedNumberType} bundle: ${approvedBundle.friendlyName} (${approvedBundle.bundleSid})`);
          } else {
            return res.status(400).json({
              error: "Regulatory bundle required",
              message: `${resolvedNumberType === 'toll-free' ? 'Toll-free' : 'Local'} phone numbers in ${phoneCountry} require an approved Twilio Regulatory Bundle for ${resolvedNumberType} numbers. Please contact your administrator to set up the correct bundle type in Twilio Console.`,
              bundleRequired: true,
              country: phoneCountry,
              numberType: resolvedNumberType,
              contactAdmin: true
            });
          }
        }

        // Then check address requirement (user can resolve this themselves via Settings)
        if (countryReqs.addressRequired !== 'none') {
          if (effectiveBundleSid) {
            // Bundle is present — but Twilio still requires addressSid for some countries (e.g. UK).
            // The address must come from INSIDE the bundle (not a standalone account address).
            // getBundleAddressSid scans bundle item assignments and returns the address SID found there.
            const bundleAddress = await twilioService.getBundleAddressSid(effectiveBundleSid, phoneCountry);
            if (bundleAddress) {
              effectiveAddressSid = bundleAddress;
              console.log(`[Phone Purchase] Found address inside bundle for ${phoneCountry}: ${bundleAddress.substring(0, 8)}...`);
            } else {
              console.log(`[Phone Purchase] Bundle present for ${phoneCountry} — no address found inside bundle items, proceeding without addressSid`);
            }
          } else if (!effectiveAddressSid) {
            // No bundle — fall back to user's own saved verified address
            const { userAddresses } = await import("@shared/schema");
            const { eq, and } = await import("drizzle-orm");

            let userAddressList;
            if (countryReqs.addressRequired === 'local') {
              userAddressList = await db.select()
                .from(userAddresses)
                .where(and(
                  eq(userAddresses.userId, req.userId!),
                  eq(userAddresses.isoCountry, phoneCountry),
                  eq(userAddresses.status, 'verified')
                ));
            } else {
              userAddressList = await db.select()
                .from(userAddresses)
                .where(and(
                  eq(userAddresses.userId, req.userId!),
                  eq(userAddresses.status, 'verified')
                ));
            }

            if (userAddressList.length > 0 && userAddressList[0].twilioAddressSid) {
              effectiveAddressSid = userAddressList[0].twilioAddressSid;
              console.log(`[Phone Purchase] Using user's verified address: ${userAddressList[0].customerName} for ${phoneCountry}`);
            } else {
              return res.status(400).json({
                error: "Address required",
                message: countryReqs.addressRequired === 'local'
                  ? `Phone numbers in ${phoneCountry} require a verified local address. Please add an address for ${phoneCountry} in Settings → Addresses.`
                  : `Phone numbers in ${phoneCountry} require a verified address. Please add an address in Settings → Addresses.`,
                addressRequired: true,
                requiresLocalAddress: countryReqs.addressRequired === 'local',
                country: phoneCountry,
                redirectToSettings: true
              });
            }
          }
        }
      }

      // Attempt phone number purchase
      let twilioNumber;
      try {
        twilioNumber = await twilioService.buyPhoneNumber({
          phoneNumber,
          friendlyName,
          addressSid: effectiveAddressSid,
          bundleSid: effectiveBundleSid,
        });
      } catch (buyError: any) {
        // Handle error 21649: Bundle missing or wrong type for this number type.
        // This fires whether or not a bundle was provided — the provided bundle might be
        // the wrong type (e.g. toll-free bundle used for a local number), so we always
        // attempt to find the correctly-typed bundle and retry once.
        if (buyError.code === 21649 && phoneCountry) {
          console.log(`[Phone Purchase] Twilio error 21649 for ${phoneCountry}/${resolvedNumberType} — attempting to find correct ${resolvedNumberType} bundle...`);
          const approvedBundle = await twilioService.getApprovedBundleForCountry(phoneCountry, resolvedNumberType);

          if (approvedBundle && approvedBundle.bundleSid !== effectiveBundleSid) {
            console.log(`[Phone Purchase] Retrying purchase with correct ${resolvedNumberType} bundle: ${approvedBundle.bundleSid}`);
            // Also extract address from the newly found bundle
            let retryAddressSid = effectiveAddressSid;
            const bundleAddress = await twilioService.getBundleAddressSid(approvedBundle.bundleSid, phoneCountry);
            if (bundleAddress) retryAddressSid = bundleAddress;

            twilioNumber = await twilioService.buyPhoneNumber({
              phoneNumber,
              friendlyName,
              addressSid: retryAddressSid,
              bundleSid: approvedBundle.bundleSid,
            });
          } else {
            return res.status(400).json({
              error: "Regulatory bundle required",
              message: `Phone numbers in ${phoneCountry} require an approved Twilio Regulatory Bundle for ${resolvedNumberType} numbers. Please contact your administrator to set up the correct bundle type in Twilio Console.`,
              bundleRequired: true,
              country: phoneCountry,
              numberType: resolvedNumberType,
              contactAdmin: true
            });
          }
        // Handle address-required errors (21615, 21617, 21631, or message containing 'Address')
        // This catches cases where the dynamic API didn't detect address requirements
        // but Twilio still requires one (varies by account configuration)
        } else if (
          (buyError.code === 21615 || buyError.code === 21617 || buyError.code === 21631 ||
           (buyError.message && buyError.message.includes('Address'))) &&
          !effectiveAddressSid && !effectiveBundleSid && phoneCountry
        ) {
          console.log(`[Phone Purchase] Twilio requires address for ${phoneCountry} (error ${buyError.code}), returning friendly error`);
          return res.status(400).json({
            error: "Address required",
            message: `Phone numbers in ${phoneCountry} require a verified address. Please add an address in Settings → Addresses before purchasing.`,
            addressRequired: true,
            country: phoneCountry,
            redirectToSettings: true
          });
        } else {
          throw buyError;
        }
      }
      
      const pricing = await twilioService.getPhoneNumberPricing(phoneNumber);
      
      const { ElevenLabsPoolService } = await import('../services/elevenlabs-pool');
      const credentialToUse = await ElevenLabsPoolService.getUserCredential(req.userId!);
      
      if (!credentialToUse) {
        try {
          await twilioService.releasePhoneNumber(twilioNumber.sid);
        } catch (releaseError: any) {
          console.error('Failed to release Twilio number after credential error:', releaseError);
        }
        return res.status(500).json({ error: 'No active ElevenLabs API keys available in pool' });
      }
      console.log(`📞 [ElevenLabs Pool] Using user's assigned credential: ${credentialToUse.name}`);
      
      let dbPhoneNumber;
      
      if (process.env.NODE_ENV !== 'development') {
        try {
          await db.transaction(async (tx) => {
            await tx.insert(creditTransactions).values({
              userId: req.userId!,
              type: 'debit',
              amount: monthlyCredits,
              description: `Phone number rental: ${twilioNumber.phoneNumber}`,
            });

            await tx.execute(sql`
              UPDATE users 
              SET credits = COALESCE(credits, 0) - ${monthlyCredits}
              WHERE id = ${req.userId!}
            `);

            const nextBillingDate = new Date();
            nextBillingDate.setDate(nextBillingDate.getDate() + 30);

            const [phoneNumberRecord] = await tx.insert(phoneNumbers).values({
              userId: req.userId!,
              phoneNumber: twilioNumber.phoneNumber,
              twilioSid: twilioNumber.sid,
              friendlyName: twilioNumber.friendlyName,
              country: phoneCountry || "US",
              capabilities: twilioNumber.capabilities,
              status: "active",
              purchasePrice: pricing.purchasePrice,
              monthlyPrice: pricing.monthlyPrice,
              monthlyCredits: monthlyCredits,
              nextBillingDate: nextBillingDate,
              elevenLabsCredentialId: credentialToUse.id,
            }).returning();

            dbPhoneNumber = phoneNumberRecord;

            await tx.insert(phoneNumberRentals).values({
              phoneNumberId: phoneNumberRecord.id,
              userId: req.userId!,
              creditsCharged: monthlyCredits,
              status: 'success',
            });
          });
        } catch (dbError: any) {
          console.error('Database transaction failed after Twilio purchase, releasing number:', {
            phoneNumber: twilioNumber.phoneNumber,
            sid: twilioNumber.sid,
            userId: req.userId,
            error: dbError.message
          });
          
          try {
            await twilioService.releasePhoneNumber(twilioNumber.sid);
            console.log('Successfully released orphaned Twilio number:', twilioNumber.sid);
          } catch (releaseError: any) {
            console.error('CRITICAL: Failed to release Twilio number after DB failure:', {
              phoneNumber: twilioNumber.phoneNumber,
              sid: twilioNumber.sid,
              userId: req.userId,
              originalError: dbError.message,
              releaseError: releaseError.message
            });
          }
          
          throw dbError;
        }
      } else {
        const nextBillingDate = new Date();
        nextBillingDate.setDate(nextBillingDate.getDate() + 30);

        const [devPhoneNumber] = await db.insert(phoneNumbers).values({
          userId: req.userId!,
          phoneNumber: twilioNumber.phoneNumber,
          twilioSid: twilioNumber.sid,
          friendlyName: twilioNumber.friendlyName,
          country: phoneCountry || "US",
          capabilities: twilioNumber.capabilities,
          status: "active",
          purchasePrice: pricing.purchasePrice,
          monthlyPrice: pricing.monthlyPrice,
          monthlyCredits: monthlyCredits,
          nextBillingDate: nextBillingDate,
          elevenLabsCredentialId: credentialToUse.id,
        }).returning();
        
        dbPhoneNumber = devPhoneNumber;
      }
      
      let elevenLabsPhoneNumberId: string | null = null;
      if (dbPhoneNumber) {
        try {
          console.log(`📞 [ElevenLabs Sync] Syncing phone number to ElevenLabs: ${twilioNumber.phoneNumber}`);
          
          const { ElevenLabsService } = await import('../services/elevenlabs');
          const elevenLabsService = new ElevenLabsService(credentialToUse.apiKey);
          
          const { getTwilioAccountSid, getTwilioAuthToken } = await import('../services/twilio-connector');
          const twilioAccountSid = await getTwilioAccountSid();
          const twilioAuthToken = await getTwilioAuthToken();
          
          const elevenLabsResult = await elevenLabsService.syncPhoneNumberToElevenLabs({
            phoneNumber: twilioNumber.phoneNumber,
            twilioAccountSid,
            twilioAuthToken,
            label: friendlyName || twilioNumber.phoneNumber,
          });
          
          elevenLabsPhoneNumberId = elevenLabsResult.phone_number_id;
          console.log(`✅ [ElevenLabs Sync] Phone number synced successfully: ${elevenLabsPhoneNumberId}`);
          
          try {
            await db.update(phoneNumbers)
              .set({ 
                elevenLabsPhoneNumberId: elevenLabsPhoneNumberId,
                elevenLabsCredentialId: credentialToUse.id,
              })
              .where(eq(phoneNumbers.id, dbPhoneNumber.id));
            
            console.log(`✅ [ElevenLabs Sync] Phone number record updated with ElevenLabs ID and credential`);
            
            dbPhoneNumber.elevenLabsPhoneNumberId = elevenLabsPhoneNumberId;
            dbPhoneNumber.elevenLabsCredentialId = credentialToUse.id;
          } catch (dbUpdateError: any) {
            console.error('❌ [ElevenLabs Sync] Database update failed after ElevenLabs sync - cleaning up');
            
            try {
              await elevenLabsService.deletePhoneNumber(elevenLabsPhoneNumberId);
              console.log(`✅ [Rollback] Deleted ElevenLabs phone number: ${elevenLabsPhoneNumberId}`);
            } catch (deleteError: any) {
              console.error('❌ [Rollback] Failed to delete ElevenLabs phone number:', deleteError);
            }
            
            throw dbUpdateError;
          }
          
        } catch (elevenLabsError: any) {
          console.error('⚠️  [ElevenLabs Sync] Failed to sync phone number to ElevenLabs:', elevenLabsError);
          console.error('⚠️  [ElevenLabs Sync] Phone number purchased successfully but ElevenLabs sync failed');
          
          try {
            if (process.env.NODE_ENV !== 'development') {
              await db.transaction(async (tx) => {
                await tx.insert(creditTransactions).values({
                  userId: req.userId!,
                  type: 'credit',
                  amount: monthlyCredits,
                  description: `Refund: Phone number purchase rollback (${twilioNumber.phoneNumber})`,
                });
                
                await tx.execute(sql`
                  UPDATE users 
                  SET credits = COALESCE(credits, 0) + ${monthlyCredits}
                  WHERE id = ${req.userId!}
                `);
                
                console.log(`✅ [Rollback] Restored ${monthlyCredits} credits to user`);
              });
            }
            
            await db.delete(phoneNumbers).where(eq(phoneNumbers.id, dbPhoneNumber.id));
            console.log('✅ [Rollback] Deleted phone number from database');
            
            await twilioService.releasePhoneNumber(twilioNumber.sid);
            console.log('✅ [Rollback] Released Twilio phone number');
            
            console.log('✅ [Rollback] Complete rollback successful - all state restored consistently');
            throw new Error('Failed to sync phone number to ElevenLabs. Purchase fully rolled back.');
          } catch (rollbackError: any) {
            console.error('❌ [CRITICAL ROLLBACK FAILURE] Rollback failed after ElevenLabs sync failure:', rollbackError);
            console.error('❌ [CRITICAL] Manual intervention required - database and billing may be inconsistent');
            console.error('❌ [CRITICAL] User ID:', req.userId);
            console.error('❌ [CRITICAL] Phone Number:', twilioNumber.phoneNumber);
            console.error('❌ [CRITICAL] Twilio SID:', twilioNumber.sid);
            throw elevenLabsError;
          }
        }
      }

      res.json(dbPhoneNumber);
    } catch (error: any) {
      console.error("Buy phone number error:", error);
      
      if (error.message?.includes('Authentication') || error.message?.includes('not connected') || error.status === 401) {
        return res.status(503).json({ 
          error: "Twilio credentials not configured", 
          message: "Please configure your Twilio credentials. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in your .env file, or configure via Admin Panel > Settings. Get your credentials from console.twilio.com"
        });
      }
      
      res.status(500).json({ error: "Failed to buy phone number" });
    }
  });

  router.delete("/api/phone-numbers/:id", authenticateHybrid, async (req: AuthRequest, res: Response) => {
    try {
      const phoneNumber = await storage.getPhoneNumber(req.params.id);
      if (!phoneNumber || phoneNumber.userId !== req.userId) {
        return res.status(404).json({ error: "Phone number not found" });
      }

      if (phoneNumber.elevenLabsPhoneNumberId) {
        try {
          console.log(`📞 [ElevenLabs Delete] Deleting phone number from ElevenLabs: ${phoneNumber.elevenLabsPhoneNumberId}`);
          
          const { ElevenLabsPoolService } = await import('../services/elevenlabs-pool');
          const userAgents = await storage.getUserAgents(req.userId!);
          
          if (userAgents.length > 0 && userAgents[0].elevenLabsCredentialId) {
            const credential = await ElevenLabsPoolService.getCredentialById(userAgents[0].elevenLabsCredentialId);
            if (credential) {
              const { ElevenLabsService } = await import('../services/elevenlabs');
              const elevenLabsService = new ElevenLabsService(credential.apiKey);
              await elevenLabsService.deletePhoneNumber(phoneNumber.elevenLabsPhoneNumberId);
              console.log(`✅ [ElevenLabs Delete] Phone number deleted from ElevenLabs successfully`);
            }
          }
        } catch (elevenLabsError: any) {
          console.error("⚠️  [ElevenLabs Delete] Failed to delete from ElevenLabs:", elevenLabsError);
        }
      }

      try {
        await twilioService.releasePhoneNumber(phoneNumber.twilioSid);
      } catch (twilioError: any) {
        console.error("Failed to release from Twilio:", twilioError);
      }

      await storage.deletePhoneNumber(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete phone number error:", error);
      res.status(500).json({ error: "Failed to delete phone number" });
    }
  });

  // Admin Phone Numbers routes
  router.get("/api/admin/phone-numbers/search/:areaCode", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
    try {
      const { areaCode } = req.params;
      
      if (!areaCode || areaCode.length !== 3) {
        return res.status(400).json({ error: "Area code must be exactly 3 digits" });
      }

      const availableNumbers = await twilioService.searchAvailableNumbers({
        areaCode,
        limit: 20,
      });

      res.json(availableNumbers);
    } catch (error: any) {
      console.error("Search numbers error:", error);
      res.status(500).json({ error: "Failed to search numbers" });
    }
  });

  router.post("/api/admin/phone-numbers/buy-system", authenticateToken, requireRole("admin"), async (req: AuthRequest, res: Response) => {
    try {
      const { phoneNumber, friendlyName } = req.body;

      if (!phoneNumber) {
        return res.status(400).json({ error: "Phone number is required" });
      }

      const twilioNumber = await twilioService.buyPhoneNumber(
        phoneNumber,
        friendlyName || "System Pool Number"
      );

      const pricing = await twilioService.getPhoneNumberPricing(phoneNumber);

      const countryPrefixMap: Record<string, string> = {
        '+61': 'AU', '+44': 'GB', '+49': 'DE', '+33': 'FR', '+39': 'IT',
        '+34': 'ES', '+31': 'NL', '+32': 'BE', '+43': 'AT', '+41': 'CH',
        '+353': 'IE', '+351': 'PT', '+48': 'PL', '+46': 'SE', '+47': 'NO',
        '+45': 'DK', '+358': 'FI', '+64': 'NZ', '+65': 'SG', '+81': 'JP', '+82': 'KR',
        '+27': 'ZA', '+55': 'BR', '+52': 'MX', '+30': 'GR', '+36': 'HU',
        '+359': 'BG', '+352': 'LU'
      };
      let detectedCountry = 'US';
      const sortedPrefixes = Object.keys(countryPrefixMap).sort((a, b) => b.length - a.length);
      for (const prefix of sortedPrefixes) {
        if (twilioNumber.phoneNumber.startsWith(prefix)) {
          detectedCountry = countryPrefixMap[prefix];
          break;
        }
      }

      await storage.createPhoneNumber({
        userId: null,
        phoneNumber: twilioNumber.phoneNumber,
        twilioSid: twilioNumber.sid,
        friendlyName: twilioNumber.friendlyName,
        country: detectedCountry,
        capabilities: twilioNumber.capabilities,
        status: "active",
        isSystemPool: true,
        purchasePrice: pricing.purchasePrice,
        monthlyPrice: pricing.monthlyPrice,
        monthlyCredits: null,
        nextBillingDate: null,
      });

      res.json({ 
        success: true, 
        message: "System number added successfully",
        phoneNumber: twilioNumber.phoneNumber 
      });
    } catch (error: any) {
      console.error("Buy system number error:", error);
      
      if (error.message?.includes('Authentication') || error.message?.includes('not connected') || error.status === 401) {
        return res.status(503).json({ 
          error: "Twilio credentials not configured", 
          message: "Please configure your Twilio credentials. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in your .env file, or configure via Admin Panel > Settings. Get your credentials from console.twilio.com"
        });
      }
      
      res.status(500).json({ error: "Failed to add system number" });
    }
  });

  return router;
}
