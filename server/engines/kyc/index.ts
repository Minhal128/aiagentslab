'use strict';
/**
 * ============================================================
 * KYC Engine - Export Index
 * 
 * User-level KYC verification for phone number purchases
 * ============================================================
 */

export { KycService } from './services/kyc.service';
export { KycEngineConfig } from './config/kyc-config';
export { registerKycRoutes } from './routes/kyc-routes';

export type {
  KycStatus,
  KycDocumentType,
  KycDocument,
  UserKycStatus,
  KycSettings,
} from './types';
