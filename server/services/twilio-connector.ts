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
import twilio from 'twilio';
import { storage } from '../storage';
import { ExternalServiceError } from '../utils/errors';

/**
 * Get Twilio credentials from database or environment variables
 * 
 * Environment Variables:
 * - TWILIO_ACCOUNT_SID: Your Twilio Account SID
 * - TWILIO_AUTH_TOKEN: Your Twilio Auth Token
 * 
 * Alternatively, configure via Admin Panel > Settings > Twilio Configuration
 */
async function getCredentials() {
  // First, check if credentials are stored in database (Admin Panel configuration)
  const dbAccountSid = await storage.getGlobalSetting('twilio_account_sid');
  const dbAuthToken = await storage.getGlobalSetting('twilio_auth_token');
  
  if (dbAccountSid?.value && dbAuthToken?.value) {
    console.log('📞 Using Twilio credentials from database');
    return {
      accountSid: dbAccountSid.value,
      apiKey: dbAccountSid.value,
      apiKeySecret: dbAuthToken.value,
      phoneNumber: null
    };
  }

  // Fall back to environment variables
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    console.log('📞 Using Twilio credentials from environment variables');
    return {
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      apiKey: process.env.TWILIO_ACCOUNT_SID,
      apiKeySecret: process.env.TWILIO_AUTH_TOKEN,
      phoneNumber: null
    };
  }

  throw new ExternalServiceError(
    'Twilio',
    'No Twilio credentials found. Please configure TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in your .env file or via Admin Panel > Settings.',
    undefined,
    { operation: 'getCredentials' }
  );
}

export async function getTwilioClient() {
  const credentials = await getCredentials();
  return twilio(credentials.apiKey as string, credentials.apiKeySecret as string, {
    accountSid: credentials.accountSid as string
  });
}

export async function getTwilioFromPhoneNumber() {
  const { phoneNumber } = await getCredentials();
  return phoneNumber;
}

export async function getTwilioAccountSid(): Promise<string> {
  const credentials = await getCredentials();
  return credentials.accountSid as string;
}

export async function getTwilioAuthToken(): Promise<string> {
  const credentials = await getCredentials();
  return credentials.apiKeySecret as string;
}