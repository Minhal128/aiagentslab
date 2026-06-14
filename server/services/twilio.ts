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
import { getTwilioClient, getTwilioAccountSid } from "./twilio-connector";
import { getDomain } from "../utils/domain";
import { withServiceErrorHandling } from '../utils/service-error-wrapper';

interface CountryRequirements {
  addressRequired: 'none' | 'any' | 'local';
  bundleRequired: boolean;
  isoCountry: string;
  numberType: string;
}

// Use REAL Twilio by default, only mock if explicitly set
const TWILIO_MODE = process.env.TWILIO_MODE || 'live';
const SHOULD_MOCK_TWILIO = TWILIO_MODE === 'mock';

if (SHOULD_MOCK_TWILIO) {
  console.log("🔧 Twilio running in MOCK mode - using simulated phone numbers");
} else {
  console.log("📞 Twilio running in LIVE mode - using real Twilio connector");
}

interface TwilioPhoneNumber {
  phoneNumber: string;
  friendlyName?: string;
  sid: string;
  capabilities?: {
    voice: boolean;
    sms: boolean;
    mms: boolean;
  };
  pricing?: {
    purchasePrice: string;
    monthlyPrice: string;
    priceUnit: string;
  };
}

interface AvailablePhoneNumber {
  phoneNumber: string;
  friendlyName: string;
  locality?: string;
  region?: string;
  postalCode?: string;
  isoCountry: string;
  addressRequirements?: string;
  capabilities: {
    voice: boolean;
    sms: boolean;
    mms: boolean;
  };
  type?: string;
}

interface TwilioAddress {
  sid: string;
  friendlyName: string;
  customerName: string;
  street: string;
  city: string;
  region: string;
  postalCode: string;
  isoCountry: string;
  validated: boolean;
  verified: boolean;
}

interface BuyPhoneNumberOptions {
  phoneNumber: string;
  friendlyName?: string;
  addressSid?: string;
  bundleSid?: string;
}

// In-memory store for mock phone numbers in development
const mockOwnedNumbers: TwilioPhoneNumber[] = [];

export class TwilioService {
  private shouldMock: boolean;

  constructor() {
    this.shouldMock = SHOULD_MOCK_TWILIO;
  }

  private async getTwilioClientInstance() {
    if (this.shouldMock) {
      throw new Error("Mock mode - no Twilio client available");
    }
    return await getTwilioClient();
  }

  async searchAvailableNumbers(params: {
    country?: string;
    areaCode?: string;
    contains?: string;
    inPostalCode?: string;
    inLocality?: string;
    inRegion?: string;
    limit?: number;
    numberType?: 'local' | 'toll-free' | 'mobile' | 'national';
  }): Promise<AvailablePhoneNumber[]> {
    const isTollFree = params.numberType === 'toll-free';
    const isMobile = params.numberType === 'mobile';
    const isNational = params.numberType === 'national';

    // Use mock numbers in mock mode
    if (this.shouldMock) {
      console.log("Mock mode: Returning mock phone numbers");
      const areaCode = params.areaCode || "415";
      const locality = params.inLocality || "San Francisco";
      const region = params.inRegion || "CA";
      const postalCode = params.inPostalCode || "94102";
      return [
        {
          phoneNumber: isTollFree ? `+18005551234` : `+1${areaCode}5551234`,
          friendlyName: isTollFree ? `(800) 555-1234` : `(${areaCode}) 555-1234`,
          locality: isTollFree ? undefined : locality,
          region: isTollFree ? undefined : region,
          postalCode: isTollFree ? undefined : postalCode,
          isoCountry: params.country || "US",
          capabilities: {
            voice: true,
            sms: true,
            mms: false,
          },
          type: params.numberType || 'local'
        },
        {
          phoneNumber: isTollFree ? `+18885555678` : `+1${areaCode}5555678`,
          friendlyName: isTollFree ? `(888) 555-5678` : `(${areaCode}) 555-5678`,
          locality: isTollFree ? undefined : locality,
          region: isTollFree ? undefined : region,
          postalCode: isTollFree ? undefined : String(parseInt(postalCode, 10) + 1),
          isoCountry: params.country || "US",
          capabilities: {
            voice: true,
            sms: true,
            mms: false,
          },
          type: params.numberType || 'local'
        },
      ];
    }
    
    // Use real Twilio connector
    const client = await this.getTwilioClientInstance();
    const country = params.country || "US";
    
    const listOptions: any = {
      limit: params.limit || 20,
    };

    if (isTollFree) {
      // Toll-free numbers: only 'contains' filter is supported by Twilio
      if (params.contains) listOptions.contains = params.contains;
      console.log(`📞 [Search] Fetching toll-free numbers for ${country}`);
      const numbers = await client.availablePhoneNumbers(country).tollFree.list(listOptions);
      return numbers.map((num: any) => ({
        phoneNumber: num.phoneNumber,
        friendlyName: num.friendlyName,
        locality: undefined,
        region: undefined,
        postalCode: undefined,
        isoCountry: num.isoCountry,
        addressRequirements: num.addressRequirements,
        capabilities: num.capabilities,
        type: 'toll-free',
      }));
    }

    if (isMobile) {
      if (params.contains) listOptions.contains = params.contains;
      console.log(`📞 [Search] Fetching mobile numbers for ${country}`);
      const numbers = await client.availablePhoneNumbers(country).mobile.list(listOptions);
      return numbers.map((num: any) => ({
        phoneNumber: num.phoneNumber,
        friendlyName: num.friendlyName,
        locality: undefined,
        region: undefined,
        postalCode: undefined,
        isoCountry: num.isoCountry,
        addressRequirements: num.addressRequirements,
        capabilities: num.capabilities,
        type: 'mobile',
      }));
    }

    if (isNational) {
      if (params.contains) listOptions.contains = params.contains;
      console.log(`📞 [Search] Fetching national numbers for ${country}`);
      const numbers = await client.availablePhoneNumbers(country).national.list(listOptions);
      return numbers.map((num: any) => ({
        phoneNumber: num.phoneNumber,
        friendlyName: num.friendlyName,
        locality: undefined,
        region: undefined,
        postalCode: undefined,
        isoCountry: num.isoCountry,
        addressRequirements: num.addressRequirements,
        capabilities: num.capabilities,
        type: 'national',
      }));
    }

    // Local numbers support all filters
    if (params.areaCode) listOptions.areaCode = parseInt(params.areaCode, 10);
    if (params.contains) listOptions.contains = params.contains;
    if (params.inPostalCode) listOptions.inPostalCode = params.inPostalCode;
    if (params.inLocality) listOptions.inLocality = params.inLocality;
    if (params.inRegion) listOptions.inRegion = params.inRegion;
    
    console.log(`📞 [Search] Fetching local numbers for ${country}`);
    let numbers = [];
    try {
      numbers = await client.availablePhoneNumbers(country).local.list(listOptions);
    } catch (err: any) {
      console.warn(`Local search failed for ${country}: ${err.message}`);
    }

    // Fallback: If searching local returns no numbers, check mobile and national
    if (numbers.length === 0) {
      const fallbackOptions: any = { limit: params.limit || 20 };
      if (params.contains) fallbackOptions.contains = params.contains;
      
      console.log(`📞 [Search] No local numbers found. Fetching mobile numbers for ${country}`);
      try {
        const mobileNumbers = await client.availablePhoneNumbers(country).mobile.list(fallbackOptions);
        if (mobileNumbers.length > 0) {
          return mobileNumbers.map((num: any) => ({
            phoneNumber: num.phoneNumber,
            friendlyName: num.friendlyName,
            locality: undefined,
            region: undefined,
            postalCode: undefined,
            isoCountry: num.isoCountry,
            addressRequirements: num.addressRequirements,
            capabilities: num.capabilities,
            type: 'mobile',
          }));
        }
      } catch (err: any) {
        console.warn(`Mobile fallback search failed for ${country}: ${err.message}`);
      }

      console.log(`📞 [Search] No mobile numbers found. Fetching national numbers for ${country}`);
      try {
        const nationalNumbers = await client.availablePhoneNumbers(country).national.list(fallbackOptions);
        if (nationalNumbers.length > 0) {
          return nationalNumbers.map((num: any) => ({
            phoneNumber: num.phoneNumber,
            friendlyName: num.friendlyName,
            locality: undefined,
            region: undefined,
            postalCode: undefined,
            isoCountry: num.isoCountry,
            addressRequirements: num.addressRequirements,
            capabilities: num.capabilities,
            type: 'national',
          }));
        }
      } catch (err: any) {
        console.warn(`National fallback search failed for ${country}: ${err.message}`);
      }
    }

    return numbers.map((num: any) => ({
      phoneNumber: num.phoneNumber,
      friendlyName: num.friendlyName,
      locality: num.locality,
      region: num.region,
      postalCode: num.postalCode,
      isoCountry: num.isoCountry,
      addressRequirements: num.addressRequirements,
      capabilities: num.capabilities,
      type: 'local',
    }));
  }

  async buyPhoneNumber(options: BuyPhoneNumberOptions): Promise<TwilioPhoneNumber>;
  async buyPhoneNumber(phoneNumber: string, friendlyName?: string): Promise<TwilioPhoneNumber>;
  async buyPhoneNumber(phoneNumberOrOptions: string | BuyPhoneNumberOptions, friendlyName?: string): Promise<TwilioPhoneNumber> {
    const options: BuyPhoneNumberOptions = typeof phoneNumberOrOptions === 'string' 
      ? { phoneNumber: phoneNumberOrOptions, friendlyName }
      : phoneNumberOrOptions;
    
    const { phoneNumber, addressSid, bundleSid } = options;
    const resolvedFriendlyName = options.friendlyName;
    
    // Use mock purchase in mock mode
    if (this.shouldMock) {
      console.log("Mock mode: Simulating phone number purchase");
      const mockNumber = {
        phoneNumber: phoneNumber,
        friendlyName: resolvedFriendlyName || phoneNumber,
        sid: `PN_MOCK_${Date.now()}`,
        capabilities: {
          voice: true,
          sms: true,
          mms: false
        }
      };
      // Add to in-memory store
      mockOwnedNumbers.push(mockNumber);
      return mockNumber;
    }
    
    // Use real Twilio connector
    const client = await this.getTwilioClientInstance();
    
    // SECURITY: Do NOT set any webhook URL on purchase
    // Numbers start with no incoming call handling - calls will be rejected by Twilio
    // Webhook is only configured when an incoming connection is created
    // This prevents unauthorized incoming calls from incurring costs
    
    console.log(`📞 [Phone Purchase] Purchasing number WITHOUT webhook (incoming calls disabled until configured)`);
    
    // Build purchase options - include addressSid/bundleSid for regulatory compliance
    const purchaseOptions: any = {
      phoneNumber: phoneNumber,
      friendlyName: resolvedFriendlyName,
      // No voiceUrl set = incoming calls are rejected by Twilio (no cost)
    };
    
    // Add address for countries requiring regulatory compliance (e.g., Australia, UK, Germany)
    // When a bundleSid is also present, this addressSid must be the one registered inside
    // the bundle — the caller is responsible for providing the correct bundle-linked address.
    if (addressSid) {
      purchaseOptions.addressSid = addressSid;
      console.log(`📞 [Phone Purchase] Including AddressSid for regulatory compliance: ${addressSid.substring(0, 8)}...`);
    }
    
    // Add bundle for mobile numbers in certain countries requiring regulatory bundles
    if (bundleSid) {
      purchaseOptions.bundleSid = bundleSid;
      console.log(`📞 [Phone Purchase] Including BundleSid for regulatory compliance: ${bundleSid.substring(0, 8)}...`);
    }
    
    // Purchase phone number WITHOUT voice webhook - incoming calls won't be handled
    const result = await client.incomingPhoneNumbers.create(purchaseOptions);

    // Mask phone number in logs (show last 4 digits only)
    const maskedNumber = `***${phoneNumber.slice(-4)}`;
    console.log(`✅ [Phone Purchase] Number ${maskedNumber} purchased (incoming calls disabled)`);

    return {
      phoneNumber: result.phoneNumber,
      friendlyName: result.friendlyName,
      sid: result.sid,
      capabilities: result.capabilities,
    };
  }

  async listOwnedNumbers(): Promise<TwilioPhoneNumber[]> {
    // Return mock owned numbers in mock mode
    if (this.shouldMock) {
      console.log("Mock mode: Returning mock owned numbers");
      return mockOwnedNumbers.map(num => ({
        ...num,
        pricing: {
          purchasePrice: '1.00',
          monthlyPrice: '1.15',
          priceUnit: 'USD'
        }
      }));
    }
    
    // Use real Twilio connector
    const client = await this.getTwilioClientInstance();
    
    const numbers = await client.incomingPhoneNumbers.list();

    // Add standard US phone number pricing
    // Twilio's API doesn't include pricing in the phone number response
    // US local numbers typically cost $1.00 one-time purchase + $1.15/month
    return numbers.map((num: any) => ({
      phoneNumber: num.phoneNumber,
      friendlyName: num.friendlyName,
      sid: num.sid,
      capabilities: num.capabilities,
      pricing: {
        purchasePrice: '1.00',
        monthlyPrice: '1.15',
        priceUnit: 'USD'
      }
    }));
  }

  async releasePhoneNumber(sid: string): Promise<void> {
    // Handle mock release in mock mode
    if (this.shouldMock) {
      console.log("Mock mode: Simulating phone number release");
      const index = mockOwnedNumbers.findIndex(n => n.sid === sid);
      if (index !== -1) {
        mockOwnedNumbers.splice(index, 1);
      }
      return;
    }
    
    // Use real Twilio connector
    const client = await this.getTwilioClientInstance();
    
    await client.incomingPhoneNumbers(sid).remove();
  }

  async updatePhoneNumber(sid: string, params: { friendlyName?: string; voiceUrl?: string }): Promise<void> {
    if (this.shouldMock) {
      console.log("Mock mode: Simulating phone number update");
      return;
    }
    
    const client = await this.getTwilioClientInstance();
    
    await client.incomingPhoneNumbers(sid).update(params);
  }

  /**
   * List all addresses in the Twilio account
   * Used for regulatory compliance when purchasing numbers in countries like Australia, UK, Germany
   */
  async listAddresses(isoCountry?: string): Promise<TwilioAddress[]> {
    if (this.shouldMock) {
      console.log("Mock mode: Returning empty addresses list");
      return [];
    }
    
    const client = await this.getTwilioClientInstance();
    
    const listOptions: any = {};
    if (isoCountry) {
      listOptions.isoCountry = isoCountry;
    }
    
    const addresses = await client.addresses.list(listOptions);
    
    return addresses.map((addr: any) => ({
      sid: addr.sid,
      friendlyName: addr.friendlyName,
      customerName: addr.customerName,
      street: addr.street,
      city: addr.city,
      region: addr.region,
      postalCode: addr.postalCode,
      isoCountry: addr.isoCountry,
      validated: addr.validated,
      verified: addr.verified,
    }));
  }

  /**
   * Create a new address in Twilio for regulatory compliance
   */
  async createAddress(params: {
    customerName: string;
    street: string;
    city: string;
    region: string;
    postalCode: string;
    isoCountry: string;
    friendlyName?: string;
  }): Promise<TwilioAddress> {
    if (this.shouldMock) {
      console.log("Mock mode: Simulating address creation");
      return {
        sid: `AD${Date.now()}`,
        friendlyName: params.friendlyName || params.customerName,
        customerName: params.customerName,
        street: params.street,
        city: params.city,
        region: params.region,
        postalCode: params.postalCode,
        isoCountry: params.isoCountry,
        validated: false,
        verified: false,
      };
    }
    
    const client = await this.getTwilioClientInstance();
    
    const address = await client.addresses.create({
      customerName: params.customerName,
      street: params.street,
      city: params.city,
      region: params.region,
      postalCode: params.postalCode,
      isoCountry: params.isoCountry,
      friendlyName: params.friendlyName || `${params.customerName} - ${params.city}`,
    });
    
    return {
      sid: address.sid,
      friendlyName: address.friendlyName,
      customerName: address.customerName,
      street: address.street,
      city: address.city,
      region: address.region,
      postalCode: address.postalCode,
      isoCountry: address.isoCountry,
      validated: address.validated,
      verified: address.verified,
    };
  }

  /**
   * Delete an address from Twilio
   */
  async deleteAddress(sid: string): Promise<void> {
    if (this.shouldMock) {
      console.log("Mock mode: Simulating address deletion");
      return;
    }
    
    const client = await this.getTwilioClientInstance();
    await client.addresses(sid).remove();
  }

  /**
   * Get a specific address from Twilio
   */
  async getAddress(sid: string): Promise<TwilioAddress | null> {
    if (this.shouldMock) {
      console.log("Mock mode: Returning null for address fetch");
      return null;
    }
    
    try {
      const client = await this.getTwilioClientInstance();
      const address = await client.addresses(sid).fetch();
      
      return {
        sid: address.sid,
        friendlyName: address.friendlyName,
        customerName: address.customerName,
        street: address.street,
        city: address.city,
        region: address.region,
        postalCode: address.postalCode,
        isoCountry: address.isoCountry,
        validated: address.validated,
        verified: address.verified,
      };
    } catch (error: any) {
      if (error.code === 20404) {
        return null;
      }
      throw error;
    }
  }

  private regulatoryCache: Map<string, { data: CountryRequirements; timestamp: number }> = new Map();
  private static CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Dynamically fetch regulatory requirements for a country from Twilio's Regulations API.
   * Results are cached for 24 hours since regulations rarely change.
   * Checks what address, bundle, and document requirements exist for local numbers (most common type purchased).
   */
  async getCountryRequirements(isoCountry: string, numberType: string = 'local'): Promise<CountryRequirements> {
    const cacheKey = `${isoCountry}_${numberType}`;
    const cached = this.regulatoryCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < TwilioService.CACHE_TTL_MS) {
      return cached.data;
    }

    if (this.shouldMock) {
      const mockResult: CountryRequirements = { addressRequired: 'none', bundleRequired: false, isoCountry, numberType };
      return mockResult;
    }

    try {
      const client = await this.getTwilioClientInstance();

      const regulations = await client.numbers.v2.regulatoryCompliance.regulations.list({
        isoCountry,
        numberType,
        endUserType: 'business',
        limit: 5,
      });

      let addressRequired: 'none' | 'any' | 'local' = 'none';
      let bundleRequired = false;

      const anyAddressCountries = new Set(['GB', 'NL', 'SE', 'NO', 'DK', 'FI', 'IE']);

      if (regulations.length > 0) {
        let hasDocumentReq = false;
        let hasAddressReq = false;

        for (const reg of regulations) {
          const requirements = (reg as any).requirements;
          if (!requirements) continue;

          const endUserReqs = requirements.end_user || [];
          const docReqs = requirements.supporting_document || [];
          const allReqs = [...endUserReqs, ...docReqs];

          if (allReqs.some((r: any) => {
            const name = (r.friendly_name || r.type || '').toLowerCase();
            return name.includes('identity') || name.includes('document') ||
                   name.includes('passport') || name.includes('registration') ||
                   name.includes('proof');
          })) {
            hasDocumentReq = true;
          }

          if (allReqs.some((r: any) => {
            const name = (r.friendly_name || r.type || '').toLowerCase();
            return name.includes('address') || name.includes('proof of address');
          })) {
            hasAddressReq = true;
          }
        }

        bundleRequired = hasDocumentReq || hasAddressReq;

        if (hasAddressReq) {
          addressRequired = anyAddressCountries.has(isoCountry) ? 'any' : 'local';
        }

        console.log(`📋 [Regulatory] API for ${isoCountry}: ${regulations.length} regulation(s), hasDocumentReq=${hasDocumentReq}, hasAddressReq=${hasAddressReq}, bundleRequired=${bundleRequired}`);
      }

      let result: CountryRequirements = {
        addressRequired,
        bundleRequired,
        isoCountry,
        numberType,
      };

      const fallback = this.getFallbackRequirements(isoCountry);

      if (!result.bundleRequired && fallback.bundleRequired) {
        console.log(`📋 [Regulatory] API returned no bundle requirement for ${isoCountry}, but fallback map says bundle is required. Using fallback.`);
        result.bundleRequired = true;
      }
      if (result.addressRequired === 'none' && fallback.addressRequired !== 'none') {
        console.log(`📋 [Regulatory] API returned no address requirement for ${isoCountry}, but fallback map says '${fallback.addressRequired}'. Using fallback.`);
        result.addressRequired = fallback.addressRequired;
      }

      this.regulatoryCache.set(cacheKey, { data: result, timestamp: Date.now() });
      console.log(`📋 [Regulatory] Requirements for ${isoCountry}/${numberType}: address=${result.addressRequired}, bundle=${result.bundleRequired}`);
      return result;
    } catch (error: any) {
      console.warn(`📋 [Regulatory] Could not fetch regulations for ${isoCountry}/${numberType}: ${error.message}. Using fallback.`);
      return this.getFallbackRequirements(isoCountry);
    }
  }

  /**
   * Fallback requirements from a known country list, used when the Twilio API call fails.
   * This ensures the system still works even if Twilio's Regulations API is temporarily down.
   */
  private static readonly KNOWN_REQUIREMENTS: Record<string, { address: 'none' | 'any' | 'local'; bundle: boolean }> = {
    'AU': { address: 'local', bundle: true },
    'GB': { address: 'any', bundle: true },
    'DE': { address: 'local', bundle: true },
    'FR': { address: 'local', bundle: true },
    'ES': { address: 'local', bundle: true },
    'IT': { address: 'local', bundle: true },
    'NL': { address: 'any', bundle: true },
    'BE': { address: 'local', bundle: true },
    'AT': { address: 'local', bundle: true },
    'CH': { address: 'local', bundle: true },
    'SE': { address: 'any', bundle: true },
    'NO': { address: 'any', bundle: true },
    'DK': { address: 'any', bundle: true },
    'FI': { address: 'any', bundle: true },
    'IE': { address: 'any', bundle: true },
    'NZ': { address: 'local', bundle: true },
    'JP': { address: 'local', bundle: true },
    'SG': { address: 'local', bundle: true },
    'HK': { address: 'local', bundle: true },
    'ZA': { address: 'local', bundle: true },
    'BR': { address: 'local', bundle: true },
    'PL': { address: 'local', bundle: true },
    'PT': { address: 'local', bundle: true },
    'KR': { address: 'local', bundle: true },
    'MX': { address: 'local', bundle: true },
    'GR': { address: 'local', bundle: true },
    'HU': { address: 'local', bundle: true },
    'BG': { address: 'local', bundle: true },
    'LU': { address: 'local', bundle: true },
    'US': { address: 'none', bundle: false },
    'CA': { address: 'none', bundle: false },
    'IN': { address: 'none', bundle: false },
    'ID': { address: 'none', bundle: false },
    'PH': { address: 'none', bundle: false },
    'TH': { address: 'none', bundle: false },
    'MY': { address: 'none', bundle: false },
    'AE': { address: 'none', bundle: false },
    'SA': { address: 'none', bundle: false },
    'IL': { address: 'none', bundle: false },
    'NG': { address: 'none', bundle: false },
    'KE': { address: 'none', bundle: false },
    'GH': { address: 'none', bundle: false },
    'CO': { address: 'none', bundle: false },
    'CL': { address: 'none', bundle: false },
    'AR': { address: 'none', bundle: false },
    'PE': { address: 'none', bundle: false },
    'PR': { address: 'none', bundle: false },
    'DO': { address: 'none', bundle: false },
    'PA': { address: 'none', bundle: false },
    'JM': { address: 'none', bundle: false },
    'TT': { address: 'none', bundle: false },
    'VN': { address: 'none', bundle: false },
    'PK': { address: 'none', bundle: false },
    'BD': { address: 'none', bundle: false },
    'LK': { address: 'none', bundle: false },
    'TW': { address: 'none', bundle: false },
    'RO': { address: 'none', bundle: false },
    'HR': { address: 'none', bundle: false },
    'RS': { address: 'none', bundle: false },
    'UA': { address: 'none', bundle: false },
    'EG': { address: 'none', bundle: false },
    'QA': { address: 'none', bundle: false },
    'BH': { address: 'none', bundle: false },
    'KW': { address: 'none', bundle: false },
    'OM': { address: 'none', bundle: false },
  };

  private getFallbackRequirements(isoCountry: string): CountryRequirements {
    const known = TwilioService.KNOWN_REQUIREMENTS[isoCountry];
    return {
      addressRequired: known?.address || 'none',
      bundleRequired: known?.bundle || false,
      isoCountry,
      numberType: 'local',
    };
  }

  /**
   * Get address requirements for a specific country.
   * Now dynamically queries Twilio's Regulations API (with 24h cache).
   */
  async getAddressRequirements(isoCountry: string): Promise<string> {
    const reqs = await this.getCountryRequirements(isoCountry);
    return reqs.addressRequired;
  }

  /**
   * Check if a country requires a regulatory bundle.
   * Now dynamically queries Twilio's Regulations API (with 24h cache).
   */
  async getBundleRequirements(isoCountry: string): Promise<string> {
    const reqs = await this.getCountryRequirements(isoCountry);
    return reqs.bundleRequired ? 'local' : 'none';
  }

  /**
   * Fetch approved regulatory bundles from Twilio for a specific country.
   * Admin creates bundles in Twilio Console; this method just fetches approved ones.
   * Returns the first matching approved bundle SID, or null if none found.
   */
  async getApprovedBundleForCountry(isoCountry: string, numberType?: string): Promise<{ bundleSid: string; friendlyName: string } | null> {
    if (this.shouldMock) {
      console.log("Mock mode: Returning mock bundle");
      return { bundleSid: 'BU_MOCK_BUNDLE', friendlyName: 'Mock Bundle' };
    }

    try {
      const client = await this.getTwilioClientInstance();

      // Fetch approved bundles for this country from Twilio's Regulatory Compliance API
      const bundles = await client.numbers.v2.regulatoryCompliance.bundles.list({
        isoCountry: isoCountry,
        numberType: numberType || undefined,
        status: 'twilio-approved',
        limit: 10,
      });

      if (bundles.length > 0) {
        const bundle = bundles[0];
        console.log(`📋 [Regulatory] Found approved bundle for ${isoCountry} (type: ${numberType || 'any'}): ${bundle.sid} (${bundle.friendlyName})`);
        return { bundleSid: bundle.sid, friendlyName: bundle.friendlyName || 'Regulatory Bundle' };
      }

      // Do NOT fall back to a bundle of a different type — using a mismatched bundle causes
      // Twilio error 21649 ("Bundle does not have the correct regulation type").
      console.log(`📋 [Regulatory] No approved ${numberType || 'any-type'} bundle found for ${isoCountry}`);
      return null;
    } catch (error: any) {
      console.error(`📋 [Regulatory] Error fetching bundles for ${isoCountry}:`, error.message);
      return null;
    }
  }

  /**
   * Find the address SID that is registered inside a regulatory bundle.
   * When purchasing numbers in countries that require both a bundle AND an address (e.g. UK),
   * the address must be the one linked to the bundle — not just any account address.
   *
   * Strategy:
   * 1. List the bundle's item assignments and look for end-users with address_sids in attributes
   * 2. Fall back to listing Twilio account addresses filtered by country
   * Returns the first matching address SID, or null if none found.
   */
  async getBundleAddressSid(bundleSid: string, isoCountry: string): Promise<string | null> {
    if (this.shouldMock) {
      return 'AD_MOCK_ADDRESS';
    }

    try {
      const client = await this.getTwilioClientInstance();

      // Step 1: Query bundle item assignments to find the linked end-user
      console.log(`📋 [Regulatory] Fetching item assignments for bundle ${bundleSid.substring(0, 8)}...`);
      const items = await client.numbers.v2.regulatoryCompliance
        .bundles(bundleSid)
        .itemAssignments.list({ limit: 20 });

      console.log(`📋 [Regulatory] Bundle items found: ${items.map((i: any) => i.objectSid).join(', ') || 'none'}`);

      for (const item of items) {
        const objectSid = (item as any).objectSid as string | undefined;
        if (!objectSid) continue;

        // The Twilio Item Assignments API does NOT return an objectType field.
        // Use the SID prefix to identify the object type:
        //   AD... = Address assigned directly to the bundle → return immediately
        //   IT... = End-User → fetch and check attributes.address_sids
        //   RD... = Supporting Document → fetch and check attributes.address_sids

        if (objectSid.startsWith('AD')) {
          // Address is directly assigned as a bundle item — return it as-is
          console.log(`📋 [Regulatory] Found address directly assigned to bundle: ${objectSid.substring(0, 8)}...`);
          return objectSid;
        } else if (objectSid.startsWith('IT')) {
          try {
            const endUser = await client.numbers.v2.regulatoryCompliance
              .endUsers(objectSid)
              .fetch();

            const attrs = (endUser as any).attributes || {};
            console.log(`📋 [Regulatory] End-user ${objectSid.substring(0, 8)} attributes keys: ${Object.keys(attrs).join(', ') || 'empty'}`);
            // Twilio may expose address as address_sids array or address_sid string
            const addrSids: string[] = attrs.address_sids || (attrs.address_sid ? [attrs.address_sid] : []);
            if (addrSids.length > 0) {
              console.log(`📋 [Regulatory] Found address inside bundle via end-user: ${addrSids[0].substring(0, 8)}...`);
              return addrSids[0];
            }
          } catch (euErr: any) {
            console.warn(`📋 [Regulatory] Could not fetch end-user ${objectSid}: ${euErr.message}`);
          }
        } else if (objectSid.startsWith('RD')) {
          try {
            const doc = await client.numbers.v2.regulatoryCompliance
              .supportingDocuments(objectSid)
              .fetch();

            const attrs = (doc as any).attributes || {};
            console.log(`📋 [Regulatory] Supporting doc ${objectSid.substring(0, 8)} (${(doc as any).type}) attributes keys: ${Object.keys(attrs).join(', ') || 'empty'}`);
            const addrSids: string[] = attrs.address_sids || (attrs.address_sid ? [attrs.address_sid] : []);
            if (addrSids.length > 0) {
              console.log(`📋 [Regulatory] Found address inside bundle via supporting-document: ${addrSids[0].substring(0, 8)}...`);
              return addrSids[0];
            }
          } catch (docErr: any) {
            console.warn(`📋 [Regulatory] Could not fetch supporting-document ${objectSid}: ${docErr.message}`);
          }
        } else {
          console.log(`📋 [Regulatory] Skipping unrecognised item SID prefix: ${objectSid.substring(0, 2)}... (${objectSid.substring(0, 8)})`);
        }
      }

      // No address found inside the bundle items — return null.
      // Do NOT fall back to standalone account addresses: a non-bundle address causes
      // Twilio error 21651 "Address not contained in bundle".
      console.log(`📋 [Regulatory] No address_sids found in bundle items for ${bundleSid.substring(0, 8)} (${isoCountry}) — returning null`);
      return null;
    } catch (error: any) {
      console.warn(`📋 [Regulatory] Error fetching bundle address for ${isoCountry}: ${error.message}`);
      return null;
    }
  }

  /**
   * List all regulatory bundles from Twilio account (for admin reference).
   * Returns bundles with their status so admin can see what's approved, pending, etc.
   */
  async listAllBundles(): Promise<Array<{ sid: string; friendlyName: string; status: string; isoCountry: string; numberType: string }>> {
    if (this.shouldMock) {
      return [];
    }

    try {
      const client = await this.getTwilioClientInstance();
      const bundles = await client.numbers.v2.regulatoryCompliance.bundles.list({ limit: 50 });

      return bundles.map((b: any) => ({
        sid: b.sid,
        friendlyName: b.friendlyName || 'Unknown',
        status: b.status,
        isoCountry: b.isoCountry || 'Unknown',
        numberType: b.numberType || 'Unknown',
      }));
    } catch (error: any) {
      console.error(`📋 [Regulatory] Error listing bundles:`, error.message);
      return [];
    }
  }

  /**
   * Get phone number pricing from Twilio Pricing API
   * Returns purchase price and monthly price for a phone number based on its country and type
   */
  async getPhoneNumberPricing(phoneNumber: string): Promise<{ purchasePrice: string; monthlyPrice: string; priceUnit: string }> {
    if (this.shouldMock) {
      console.log("Mock mode: Returning mock pricing");
      return {
        purchasePrice: '1.00',
        monthlyPrice: '1.15',
        priceUnit: 'USD'
      };
    }

    try {
      const client = await this.getTwilioClientInstance();
      
      // Determine country from phone number (default to US)
      // Format: +1 (US), +44 (UK), +61 (AU), etc.
      let isoCountry = 'US';
      if (phoneNumber.startsWith('+1')) {
        isoCountry = 'US';
      } else if (phoneNumber.startsWith('+44')) {
        isoCountry = 'GB';
      } else if (phoneNumber.startsWith('+61')) {
        isoCountry = 'AU';
      }
      // Add more country mappings as needed

      // Determine phone number type (local, toll-free, mobile)
      // US toll-free: +1 (800|888|877|866|855|844|833)
      let numberType = 'local';
      if (isoCountry === 'US' && /^\+1(800|888|877|866|855|844|833)/.test(phoneNumber)) {
        numberType = 'toll free';
      }

      console.log(`💰 [Pricing] Fetching pricing for ${isoCountry} ${numberType} number`);

      // Fetch pricing from Twilio Pricing API v1 (correct version for phone numbers)
      const pricingData: any = await client.pricing.v1
        .phoneNumbers
        .countries(isoCountry)
        .fetch();

      console.log(`📋 [Pricing] Received pricing data for ${isoCountry}:`, JSON.stringify(pricingData, null, 2));

      // Twilio Node SDK transforms REST API fields from snake_case to camelCase
      // So phoneNumberPrices array contains: { numberType, basePrice, currentPrice }
      const priceInfo = pricingData.phoneNumberPrices?.find(
        (price: any) => price.numberType?.toLowerCase() === numberType.toLowerCase()
      );

      if (!priceInfo) {
        console.warn(`⚠️ [Pricing] No pricing found for "${numberType}" in ${isoCountry}`);
        console.warn(`Available types:`, pricingData.phoneNumberPrices?.map((p: any) => p.numberType || p.number_type));
        return {
          purchasePrice: '1.00',
          monthlyPrice: '1.15',
          priceUnit: (pricingData.priceUnit as string)?.toUpperCase() || 'USD'
        };
      }

      // Twilio phone numbers charge the full monthly price on purchase (no separate purchase fee)
      // The monthly price is the MRC (Monthly Recurring Charge)
      const monthlyPrice = priceInfo.currentPrice || priceInfo.basePrice || '1.15';
      
      console.log(`✅ [Pricing] ${isoCountry} ${numberType}: $${monthlyPrice}/${pricingData.priceUnit}`);

      return {
        purchasePrice: monthlyPrice, // First month charged on purchase
        monthlyPrice: monthlyPrice,
        priceUnit: (pricingData.priceUnit as string)?.toUpperCase() || 'USD'
      };
    } catch (error: any) {
      console.error('❌ [Pricing] Failed to fetch pricing from Twilio:', error.message);
      // Return default US pricing on error
      return {
        purchasePrice: '1.00',
        monthlyPrice: '1.15',
        priceUnit: 'USD'
      };
    }
  }

  /**
   * Configure voice webhook for an existing phone number
   * This is useful for fixing phone numbers that were purchased without webhook configuration
   */
  async configurePhoneWebhook(sid: string): Promise<void> {
    if (this.shouldMock) {
      console.log("Mock mode: Simulating webhook configuration");
      return;
    }
    
    // Get domain for webhook URL - use /incoming for receiving calls
    const domain = getDomain();
    const voiceWebhookUrl = `${domain}/api/webhooks/twilio/incoming`;
    
    // Mask SID in logs (show last 8 chars only)
    const maskedSid = `***${sid.slice(-8)}`;
    console.log(`📞 [Webhook Config] Configuring webhook for SID ${maskedSid}: ${voiceWebhookUrl}`);
    
    const client = await this.getTwilioClientInstance();
    
    await client.incomingPhoneNumbers(sid).update({
      voiceUrl: voiceWebhookUrl,
      voiceMethod: 'POST',
      voiceFallbackUrl: voiceWebhookUrl,
      voiceFallbackMethod: 'POST',
    });
    
    console.log(`✅ [Webhook Config] Webhook configured successfully for SID ${maskedSid}`);
  }

  /**
   * Configure phone number to route incoming calls to ElevenLabs native integration
   * This is used when a phone number is assigned to an incoming agent
   */
  async configurePhoneWebhookForElevenLabs(sid: string, phoneNumber: string): Promise<void> {
    if (this.shouldMock) {
      console.log("Mock mode: Simulating ElevenLabs webhook configuration");
      return;
    }
    
    // ElevenLabs native Twilio inbound endpoint
    const elevenLabsInboundUrl = 'https://api.elevenlabs.io/twilio/inbound_call';
    
    // Mask SID in logs (show last 8 chars only)
    const maskedSid = `***${sid.slice(-8)}`;
    console.log(`📞 [Twilio Config] Configuring ElevenLabs native inbound for SID ${maskedSid}`);
    
    const client = await this.getTwilioClientInstance();
    
    // Step 1: Set regional routing to US1 via Twilio Routes API
    // This ensures Twilio routes the call to US region where ElevenLabs config exists
    // Note: If no explicit route exists, Twilio defaults to us1, so 404 is acceptable
    try {
      console.log(`📞 [Twilio Routes] Setting voice region to 'us1' for ${phoneNumber}`);
      await client.routes.v2.phoneNumbers(phoneNumber).update({
        voiceRegion: 'us1'
      });
      console.log(`✅ [Twilio Routes] Voice region set to 'us1'`);
    } catch (routeError: any) {
      // Routes API may return 404 if no explicit routing exists - this means it defaults to us1
      // which is what we want, so we can safely ignore this error
      if (routeError.status === 404) {
        console.log(`📞 [Twilio Routes] No explicit route exists - defaulting to 'us1' (OK)`);
      } else {
        console.warn(`⚠️ [Twilio Routes] Could not set voice region: ${routeError.message}`);
        // Continue anyway - the webhook config is more important
      }
    }
    
    // Step 2: Configure the webhook URL to point to ElevenLabs endpoint
    await client.incomingPhoneNumbers(sid).update({
      voiceUrl: elevenLabsInboundUrl,
      voiceMethod: 'POST',
      voiceFallbackUrl: elevenLabsInboundUrl,
      voiceFallbackMethod: 'POST',
    });
    
    console.log(`✅ [Twilio Config] ElevenLabs native inbound configured for SID ${maskedSid}`);
  }

  /**
   * Clear webhook configuration from phone number
   * This is used when an incoming connection is deleted - the number goes back to having no call handling
   */
  async clearPhoneWebhook(sid: string): Promise<void> {
    if (this.shouldMock) {
      console.log("Mock mode: Simulating webhook removal");
      return;
    }
    
    // Mask SID in logs (show last 8 chars only)
    const maskedSid = `***${sid.slice(-8)}`;
    console.log(`📞 [Twilio Config] Clearing webhook for SID ${maskedSid}`);
    
    const client = await this.getTwilioClientInstance();
    
    // Set voice URL to empty string to clear the webhook
    await client.incomingPhoneNumbers(sid).update({
      voiceUrl: '',
      voiceFallbackUrl: '',
    });
    
    console.log(`✅ [Twilio Config] Webhook cleared for SID ${maskedSid}`);
  }

  async makeCall(params: {
    from: string;
    to: string;
    url: string;
  }): Promise<{ callSid: string }> {
    // Handle mock call in mock mode
    if (this.shouldMock) {
      console.log("Mock mode: Simulating outbound call", params);
      return { callSid: `CA_MOCK_${Date.now()}` };
    }
    
    // Use real Twilio connector
    const client = await this.getTwilioClientInstance();
    
    const call = await client.calls.create({
      from: params.from,
      to: params.to,
      url: params.url,
    });

    return { callSid: call.sid };
  }

  /**
   * Fetch detailed call information from Twilio by call SID
   * Returns phone numbers, duration, status, and recording URL
   */
  async getCallDetails(callSid: string): Promise<{
    sid: string;
    from: string;
    to: string;
    status: string;
    direction: 'inbound' | 'outbound-api' | 'outbound-dial';
    duration: number | null;
    startTime: Date | null;
    endTime: Date | null;
    recordingUrl: string | null;
  } | null> {
    if (this.shouldMock) {
      console.log("Mock mode: Returning mock call details");
      return {
        sid: callSid,
        from: '+15551234567',
        to: '+15559876543',
        status: 'completed',
        direction: 'inbound',
        duration: 120,
        startTime: new Date(),
        endTime: new Date(),
        recordingUrl: null
      };
    }

    try {
      const client = await this.getTwilioClientInstance();
      
      // Fetch the call details
      const call = await client.calls(callSid).fetch();
      
      // Also try to get the recording
      let recordingUrl: string | null = null;
      try {
        const recordings = await client.recordings.list({
          callSid: callSid,
          limit: 1
        });
        if (recordings.length > 0) {
          recordingUrl = `https://api.twilio.com${recordings[0].uri.replace('.json', '')}`;
        }
      } catch (recError: any) {
        console.warn(`⚠️ Could not fetch recording for call ${callSid}: ${recError.message}`);
      }

      return {
        sid: call.sid,
        from: call.from,
        to: call.to,
        status: call.status,
        direction: call.direction as 'inbound' | 'outbound-api' | 'outbound-dial',
        duration: call.duration ? parseInt(call.duration, 10) : null,
        startTime: call.startTime ? new Date(call.startTime) : null,
        endTime: call.endTime ? new Date(call.endTime) : null,
        recordingUrl
      };
    } catch (error: any) {
      console.error(`❌ Error fetching call details for ${callSid}: ${error.message}`);
      return null;
    }
  }

  /**
   * Fetch recordings for a call by Twilio call SID
   */
  async getCallRecordings(callSid: string): Promise<Array<{
    sid: string;
    duration: number;
    url: string;
  }>> {
    if (this.shouldMock) {
      console.log("Mock mode: Returning mock recordings");
      return [];
    }

    try {
      const client = await this.getTwilioClientInstance();
      const recordings = await client.recordings.list({
        callSid: callSid,
        limit: 10
      });

      return recordings.map((rec: any) => ({
        sid: rec.sid,
        duration: parseInt(rec.duration, 10) || 0,
        url: `https://api.twilio.com${rec.uri.replace('.json', '')}`
      }));
    } catch (error: any) {
      console.error(`❌ Error fetching recordings for ${callSid}: ${error.message}`);
      return [];
    }
  }
}

export const twilioService = new TwilioService();
