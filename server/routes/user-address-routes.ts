'use strict';
import { Router, Response } from "express";
import { RouteContext, AuthRequest } from "./common";
import { db } from "../db";
import { userAddresses } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { TwilioService } from "../services/twilio";
import { z } from "zod";

const createAddressSchema = z.object({
  customerName: z.string().min(1, "Name is required"),
  street: z.string().min(1, "Street address is required"),
  city: z.string().min(1, "City is required"),
  region: z.string().min(1, "State/Province is required"),
  postalCode: z.string().min(1, "Postal code is required"),
  isoCountry: z.string().length(2, "Country code must be 2 characters"),
});

export function createUserAddressRoutes(ctx: RouteContext): Router {
  const router = Router();
  const { authenticateHybrid, twilioService } = ctx;

  router.get("/api/user/addresses", authenticateHybrid, async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      
      const addresses = await db.select()
        .from(userAddresses)
        .where(eq(userAddresses.userId, userId))
        .orderBy(userAddresses.createdAt);
      
      res.json(addresses);
    } catch (error: any) {
      console.error("[User Addresses] Error fetching addresses:", error);
      res.status(500).json({ error: "Failed to fetch addresses" });
    }
  });

  router.post("/api/user/addresses", authenticateHybrid, async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const parsed = createAddressSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ 
          error: "Invalid address data", 
          details: parsed.error.errors 
        });
      }
      
      const { customerName, street, city, region, postalCode, isoCountry } = parsed.data;
      
      const twilioAddress = await twilioService.createAddress({
        customerName,
        street,
        city,
        region,
        postalCode,
        isoCountry,
        friendlyName: `${customerName} - ${city}, ${isoCountry}`,
      });
      
      // Determine address status based on Twilio's validation response
      // validated=true means address is valid, validated=false means validation failed
      // Note: On initial creation, Twilio may return validated=false while still processing
      // We'll set to 'submitted' initially and let the refresh endpoint handle final status
      const isVerified = twilioAddress.verified || twilioAddress.validated;
      
      const [address] = await db.insert(userAddresses).values({
        userId,
        customerName,
        street,
        city,
        region,
        postalCode,
        isoCountry,
        twilioAddressSid: twilioAddress.sid,
        status: isVerified ? 'verified' : 'submitted',
        verificationStatus: isVerified ? 'verified' : 'pending',
        validationStatus: twilioAddress.validated ? 'validated' : 'pending',
      }).returning();
      
      res.status(201).json(address);
    } catch (error: any) {
      console.error("[User Addresses] Error creating address:", error);
      res.status(500).json({ error: "Failed to create address" });
    }
  });

  router.get("/api/user/addresses/:id/refresh", authenticateHybrid, async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const { id } = req.params;
      
      const [address] = await db.select()
        .from(userAddresses)
        .where(and(
          eq(userAddresses.id, id),
          eq(userAddresses.userId, userId)
        ));
      
      if (!address) {
        return res.status(404).json({ error: "Address not found" });
      }
      
      if (!address.twilioAddressSid) {
        return res.status(400).json({ error: "Address not linked to Twilio" });
      }
      
      const twilioAddress = await twilioService.getAddress(address.twilioAddressSid);
      
      if (!twilioAddress) {
        await db.update(userAddresses)
          .set({ 
            status: 'rejected',
            rejectionReason: 'Address no longer exists in Twilio',
            updatedAt: new Date(),
          })
          .where(eq(userAddresses.id, id));
        
        return res.status(404).json({ error: "Address no longer exists in Twilio" });
      }
      
      // Address is verified if either verified=true OR validated=true (validated is sufficient for most countries)
      const isVerified = twilioAddress.verified || twilioAddress.validated;
      
      // Determine status based on Twilio's response
      let status: string;
      let verificationStatus: string;
      let validationStatus: string;
      let rejectionReason: string | null = null;
      
      if (isVerified) {
        status = 'verified';
        verificationStatus = 'verified';
        validationStatus = 'validated';
      } else {
        // Check if enough time has passed for Twilio to complete validation
        // Twilio typically validates addresses within 1-2 minutes
        const createdTime = address.createdAt.getTime();
        const now = Date.now();
        const minutesSinceCreation = (now - createdTime) / (1000 * 60);
        
        if (minutesSinceCreation < 5) {
          // Address was created recently, validation may still be in progress
          status = 'submitted';
          verificationStatus = 'pending';
          validationStatus = 'pending';
        } else {
          // Address was created more than 5 minutes ago and still not validated
          // This indicates validation has failed
          status = 'rejected';
          verificationStatus = 'failed';
          validationStatus = 'failed';
          rejectionReason = 'Address validation failed - please verify the address details are correct';
        }
      }
      
      const [updated] = await db.update(userAddresses)
        .set({
          status,
          verificationStatus,
          validationStatus,
          rejectionReason,
          updatedAt: new Date(),
        })
        .where(eq(userAddresses.id, id))
        .returning();
      
      res.json(updated);
    } catch (error: any) {
      console.error("[User Addresses] Error refreshing address:", error);
      res.status(500).json({ error: "Failed to refresh address status" });
    }
  });

  router.delete("/api/user/addresses/:id", authenticateHybrid, async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const { id } = req.params;
      
      const [address] = await db.select()
        .from(userAddresses)
        .where(and(
          eq(userAddresses.id, id),
          eq(userAddresses.userId, userId)
        ));
      
      if (!address) {
        return res.status(404).json({ error: "Address not found" });
      }
      
      if (address.twilioAddressSid) {
        try {
          await twilioService.deleteAddress(address.twilioAddressSid);
        } catch (twilioError: any) {
          console.error("[User Addresses] Failed to delete from Twilio:", twilioError);
        }
      }
      
      await db.delete(userAddresses)
        .where(eq(userAddresses.id, id));
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("[User Addresses] Error deleting address:", error);
      res.status(500).json({ error: "Failed to delete address" });
    }
  });

  router.get("/api/user/addresses/countries", authenticateHybrid, async (req: AuthRequest, res: Response) => {
    const countries = [
      { code: 'AF', name: 'Afghanistan', requirement: 'any' },
      { code: 'AL', name: 'Albania', requirement: 'any' },
      { code: 'DZ', name: 'Algeria', requirement: 'any' },
      { code: 'AD', name: 'Andorra', requirement: 'any' },
      { code: 'AO', name: 'Angola', requirement: 'any' },
      { code: 'AG', name: 'Antigua and Barbuda', requirement: 'any' },
      { code: 'AR', name: 'Argentina', requirement: 'any' },
      { code: 'AM', name: 'Armenia', requirement: 'any' },
      { code: 'AU', name: 'Australia', requirement: 'local' },
      { code: 'AT', name: 'Austria', requirement: 'local' },
      { code: 'AZ', name: 'Azerbaijan', requirement: 'any' },
      { code: 'BS', name: 'Bahamas', requirement: 'any' },
      { code: 'BH', name: 'Bahrain', requirement: 'any' },
      { code: 'BD', name: 'Bangladesh', requirement: 'any' },
      { code: 'BB', name: 'Barbados', requirement: 'any' },
      { code: 'BY', name: 'Belarus', requirement: 'any' },
      { code: 'BE', name: 'Belgium', requirement: 'local' },
      { code: 'BZ', name: 'Belize', requirement: 'any' },
      { code: 'BJ', name: 'Benin', requirement: 'any' },
      { code: 'BT', name: 'Bhutan', requirement: 'any' },
      { code: 'BO', name: 'Bolivia', requirement: 'any' },
      { code: 'BA', name: 'Bosnia and Herzegovina', requirement: 'any' },
      { code: 'BW', name: 'Botswana', requirement: 'any' },
      { code: 'BR', name: 'Brazil', requirement: 'any' },
      { code: 'BN', name: 'Brunei', requirement: 'any' },
      { code: 'BG', name: 'Bulgaria', requirement: 'any' },
      { code: 'BF', name: 'Burkina Faso', requirement: 'any' },
      { code: 'BI', name: 'Burundi', requirement: 'any' },
      { code: 'CV', name: 'Cabo Verde', requirement: 'any' },
      { code: 'KH', name: 'Cambodia', requirement: 'any' },
      { code: 'CM', name: 'Cameroon', requirement: 'any' },
      { code: 'CA', name: 'Canada', requirement: 'any' },
      { code: 'CF', name: 'Central African Republic', requirement: 'any' },
      { code: 'TD', name: 'Chad', requirement: 'any' },
      { code: 'CL', name: 'Chile', requirement: 'any' },
      { code: 'CN', name: 'China', requirement: 'any' },
      { code: 'CO', name: 'Colombia', requirement: 'any' },
      { code: 'KM', name: 'Comoros', requirement: 'any' },
      { code: 'CG', name: 'Congo', requirement: 'any' },
      { code: 'CD', name: 'Congo (Democratic Republic)', requirement: 'any' },
      { code: 'CR', name: 'Costa Rica', requirement: 'any' },
      { code: 'HR', name: 'Croatia', requirement: 'any' },
      { code: 'CU', name: 'Cuba', requirement: 'any' },
      { code: 'CY', name: 'Cyprus', requirement: 'any' },
      { code: 'CZ', name: 'Czech Republic', requirement: 'any' },
      { code: 'DK', name: 'Denmark', requirement: 'any' },
      { code: 'DJ', name: 'Djibouti', requirement: 'any' },
      { code: 'DM', name: 'Dominica', requirement: 'any' },
      { code: 'DO', name: 'Dominican Republic', requirement: 'any' },
      { code: 'EC', name: 'Ecuador', requirement: 'any' },
      { code: 'EG', name: 'Egypt', requirement: 'any' },
      { code: 'SV', name: 'El Salvador', requirement: 'any' },
      { code: 'GQ', name: 'Equatorial Guinea', requirement: 'any' },
      { code: 'ER', name: 'Eritrea', requirement: 'any' },
      { code: 'EE', name: 'Estonia', requirement: 'any' },
      { code: 'SZ', name: 'Eswatini', requirement: 'any' },
      { code: 'ET', name: 'Ethiopia', requirement: 'any' },
      { code: 'FJ', name: 'Fiji', requirement: 'any' },
      { code: 'FI', name: 'Finland', requirement: 'any' },
      { code: 'FR', name: 'France', requirement: 'local' },
      { code: 'GA', name: 'Gabon', requirement: 'any' },
      { code: 'GM', name: 'Gambia', requirement: 'any' },
      { code: 'GE', name: 'Georgia', requirement: 'any' },
      { code: 'DE', name: 'Germany', requirement: 'local' },
      { code: 'GH', name: 'Ghana', requirement: 'any' },
      { code: 'GR', name: 'Greece', requirement: 'any' },
      { code: 'GD', name: 'Grenada', requirement: 'any' },
      { code: 'GT', name: 'Guatemala', requirement: 'any' },
      { code: 'GN', name: 'Guinea', requirement: 'any' },
      { code: 'GW', name: 'Guinea-Bissau', requirement: 'any' },
      { code: 'GY', name: 'Guyana', requirement: 'any' },
      { code: 'HT', name: 'Haiti', requirement: 'any' },
      { code: 'HN', name: 'Honduras', requirement: 'any' },
      { code: 'HK', name: 'Hong Kong', requirement: 'local' },
      { code: 'HU', name: 'Hungary', requirement: 'any' },
      { code: 'IS', name: 'Iceland', requirement: 'any' },
      { code: 'IN', name: 'India', requirement: 'any' },
      { code: 'ID', name: 'Indonesia', requirement: 'any' },
      { code: 'IR', name: 'Iran', requirement: 'any' },
      { code: 'IQ', name: 'Iraq', requirement: 'any' },
      { code: 'IE', name: 'Ireland', requirement: 'any' },
      { code: 'IL', name: 'Israel', requirement: 'any' },
      { code: 'IT', name: 'Italy', requirement: 'local' },
      { code: 'CI', name: 'Ivory Coast', requirement: 'any' },
      { code: 'JM', name: 'Jamaica', requirement: 'any' },
      { code: 'JP', name: 'Japan', requirement: 'local' },
      { code: 'JO', name: 'Jordan', requirement: 'any' },
      { code: 'KZ', name: 'Kazakhstan', requirement: 'any' },
      { code: 'KE', name: 'Kenya', requirement: 'any' },
      { code: 'KI', name: 'Kiribati', requirement: 'any' },
      { code: 'KP', name: 'Korea (North)', requirement: 'any' },
      { code: 'KR', name: 'Korea (South)', requirement: 'any' },
      { code: 'KW', name: 'Kuwait', requirement: 'any' },
      { code: 'KG', name: 'Kyrgyzstan', requirement: 'any' },
      { code: 'LA', name: 'Laos', requirement: 'any' },
      { code: 'LV', name: 'Latvia', requirement: 'any' },
      { code: 'LB', name: 'Lebanon', requirement: 'any' },
      { code: 'LS', name: 'Lesotho', requirement: 'any' },
      { code: 'LR', name: 'Liberia', requirement: 'any' },
      { code: 'LY', name: 'Libya', requirement: 'any' },
      { code: 'LI', name: 'Liechtenstein', requirement: 'any' },
      { code: 'LT', name: 'Lithuania', requirement: 'any' },
      { code: 'LU', name: 'Luxembourg', requirement: 'any' },
      { code: 'MO', name: 'Macau', requirement: 'any' },
      { code: 'MG', name: 'Madagascar', requirement: 'any' },
      { code: 'MW', name: 'Malawi', requirement: 'any' },
      { code: 'MY', name: 'Malaysia', requirement: 'any' },
      { code: 'MV', name: 'Maldives', requirement: 'any' },
      { code: 'ML', name: 'Mali', requirement: 'any' },
      { code: 'MT', name: 'Malta', requirement: 'any' },
      { code: 'MH', name: 'Marshall Islands', requirement: 'any' },
      { code: 'MR', name: 'Mauritania', requirement: 'any' },
      { code: 'MU', name: 'Mauritius', requirement: 'any' },
      { code: 'MX', name: 'Mexico', requirement: 'any' },
      { code: 'FM', name: 'Micronesia', requirement: 'any' },
      { code: 'MD', name: 'Moldova', requirement: 'any' },
      { code: 'MC', name: 'Monaco', requirement: 'any' },
      { code: 'MN', name: 'Mongolia', requirement: 'any' },
      { code: 'ME', name: 'Montenegro', requirement: 'any' },
      { code: 'MA', name: 'Morocco', requirement: 'any' },
      { code: 'MZ', name: 'Mozambique', requirement: 'any' },
      { code: 'MM', name: 'Myanmar', requirement: 'any' },
      { code: 'NA', name: 'Namibia', requirement: 'any' },
      { code: 'NR', name: 'Nauru', requirement: 'any' },
      { code: 'NP', name: 'Nepal', requirement: 'any' },
      { code: 'NL', name: 'Netherlands', requirement: 'any' },
      { code: 'NZ', name: 'New Zealand', requirement: 'local' },
      { code: 'NI', name: 'Nicaragua', requirement: 'any' },
      { code: 'NE', name: 'Niger', requirement: 'any' },
      { code: 'NG', name: 'Nigeria', requirement: 'any' },
      { code: 'MK', name: 'North Macedonia', requirement: 'any' },
      { code: 'NO', name: 'Norway', requirement: 'any' },
      { code: 'OM', name: 'Oman', requirement: 'any' },
      { code: 'PK', name: 'Pakistan', requirement: 'any' },
      { code: 'PW', name: 'Palau', requirement: 'any' },
      { code: 'PS', name: 'Palestine', requirement: 'any' },
      { code: 'PA', name: 'Panama', requirement: 'any' },
      { code: 'PG', name: 'Papua New Guinea', requirement: 'any' },
      { code: 'PY', name: 'Paraguay', requirement: 'any' },
      { code: 'PE', name: 'Peru', requirement: 'any' },
      { code: 'PH', name: 'Philippines', requirement: 'any' },
      { code: 'PL', name: 'Poland', requirement: 'any' },
      { code: 'PT', name: 'Portugal', requirement: 'any' },
      { code: 'PR', name: 'Puerto Rico', requirement: 'any' },
      { code: 'QA', name: 'Qatar', requirement: 'any' },
      { code: 'RO', name: 'Romania', requirement: 'any' },
      { code: 'RU', name: 'Russia', requirement: 'any' },
      { code: 'RW', name: 'Rwanda', requirement: 'any' },
      { code: 'KN', name: 'Saint Kitts and Nevis', requirement: 'any' },
      { code: 'LC', name: 'Saint Lucia', requirement: 'any' },
      { code: 'VC', name: 'Saint Vincent and the Grenadines', requirement: 'any' },
      { code: 'WS', name: 'Samoa', requirement: 'any' },
      { code: 'SM', name: 'San Marino', requirement: 'any' },
      { code: 'ST', name: 'Sao Tome and Principe', requirement: 'any' },
      { code: 'SA', name: 'Saudi Arabia', requirement: 'any' },
      { code: 'SN', name: 'Senegal', requirement: 'any' },
      { code: 'RS', name: 'Serbia', requirement: 'any' },
      { code: 'SC', name: 'Seychelles', requirement: 'any' },
      { code: 'SL', name: 'Sierra Leone', requirement: 'any' },
      { code: 'SG', name: 'Singapore', requirement: 'local' },
      { code: 'SK', name: 'Slovakia', requirement: 'any' },
      { code: 'SI', name: 'Slovenia', requirement: 'any' },
      { code: 'SB', name: 'Solomon Islands', requirement: 'any' },
      { code: 'SO', name: 'Somalia', requirement: 'any' },
      { code: 'ZA', name: 'South Africa', requirement: 'any' },
      { code: 'SS', name: 'South Sudan', requirement: 'any' },
      { code: 'ES', name: 'Spain', requirement: 'local' },
      { code: 'LK', name: 'Sri Lanka', requirement: 'any' },
      { code: 'SD', name: 'Sudan', requirement: 'any' },
      { code: 'SR', name: 'Suriname', requirement: 'any' },
      { code: 'SE', name: 'Sweden', requirement: 'any' },
      { code: 'CH', name: 'Switzerland', requirement: 'local' },
      { code: 'SY', name: 'Syria', requirement: 'any' },
      { code: 'TW', name: 'Taiwan', requirement: 'any' },
      { code: 'TJ', name: 'Tajikistan', requirement: 'any' },
      { code: 'TZ', name: 'Tanzania', requirement: 'any' },
      { code: 'TH', name: 'Thailand', requirement: 'any' },
      { code: 'TL', name: 'Timor-Leste', requirement: 'any' },
      { code: 'TG', name: 'Togo', requirement: 'any' },
      { code: 'TO', name: 'Tonga', requirement: 'any' },
      { code: 'TT', name: 'Trinidad and Tobago', requirement: 'any' },
      { code: 'TN', name: 'Tunisia', requirement: 'any' },
      { code: 'TR', name: 'Turkey', requirement: 'any' },
      { code: 'TM', name: 'Turkmenistan', requirement: 'any' },
      { code: 'TV', name: 'Tuvalu', requirement: 'any' },
      { code: 'UG', name: 'Uganda', requirement: 'any' },
      { code: 'UA', name: 'Ukraine', requirement: 'any' },
      { code: 'AE', name: 'United Arab Emirates', requirement: 'any' },
      { code: 'GB', name: 'United Kingdom', requirement: 'any' },
      { code: 'US', name: 'United States', requirement: 'any' },
      { code: 'UY', name: 'Uruguay', requirement: 'any' },
      { code: 'UZ', name: 'Uzbekistan', requirement: 'any' },
      { code: 'VU', name: 'Vanuatu', requirement: 'any' },
      { code: 'VA', name: 'Vatican City', requirement: 'any' },
      { code: 'VE', name: 'Venezuela', requirement: 'any' },
      { code: 'VN', name: 'Vietnam', requirement: 'any' },
      { code: 'YE', name: 'Yemen', requirement: 'any' },
      { code: 'ZM', name: 'Zambia', requirement: 'any' },
      { code: 'ZW', name: 'Zimbabwe', requirement: 'any' },
    ];
    
    res.json(countries);
  });

  return router;
}
