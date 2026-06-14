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

import type { Express, Router } from "express";
import type { Server } from "http";
import multer from "multer";
import { storage } from "../storage";
import { db } from "../db";
import { authenticateToken, requireRole, generateTokenAsync, checkActiveMembership, checkUserActive, type AuthRequest } from "../middleware/auth";
import { authenticateHybrid, optionalHybridAuth, type HybridAuthRequest } from "../middleware/hybrid-auth";
import { authRateLimiter, strictRateLimiter, paymentRateLimiter } from "../middleware/rateLimiter";
import { elevenLabsService } from "../services/elevenlabs";
import { ElevenLabsPoolService } from "../services/elevenlabs-pool";
import { twilioService } from "../services/twilio";
import { campaignExecutor } from "../services/campaign-executor";
import { NotificationService as notificationServiceSingleton } from "../services/notification-service";
import { IncomingAgentService } from "../services/incoming-agent";
import { FlowAgentService } from "../services/flow-agent";
import { webhookDeliveryService } from "../services/webhook-delivery";
import { webhookTestService } from "../services/webhook-test-service";
import { contactUploadService } from "../services/contact-upload-service";
import { recordingService } from "../services/recording-service";
import { CampaignScheduler } from "../services/campaign-scheduler";
import { emailService } from "../services/email-service";

/**
 * Shared upload configuration for file uploads
 */
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4',
  'text/plain', 'application/json',
]);

export const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} is not allowed`));
    }
  }
});

/**
 * Helper function to escape CSV fields
 */
export function escapeCSV(value: string | number): string {
  if (typeof value === 'number') return value.toString();
  if (!value) return "";
  
  const stringValue = value.toString();
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

/**
 * RouteContext contains all shared dependencies that route modules need.
 * Each route module exports a factory function that receives this context
 * and returns an Express Router.
 */
export interface RouteContext {
  // Database
  db: typeof db;
  storage: typeof storage;
  
  // Auth middleware
  authenticateToken: typeof authenticateToken;
  authenticateHybrid: typeof authenticateHybrid;
  optionalHybridAuth: typeof optionalHybridAuth;
  requireRole: typeof requireRole;
  generateTokenAsync: typeof generateTokenAsync;
  checkActiveMembership: typeof checkActiveMembership;
  checkUserActive: typeof checkUserActive;
  
  // Rate limiters
  authRateLimiter: typeof authRateLimiter;
  strictRateLimiter: typeof strictRateLimiter;
  paymentRateLimiter: typeof paymentRateLimiter;
  
  // Services
  elevenLabsService: typeof elevenLabsService;
  elevenLabsPoolService: ElevenLabsPoolService;
  twilioService: typeof twilioService;
  campaignExecutor: typeof campaignExecutor;
  notificationService: typeof notificationServiceSingleton;
  incomingAgentService: IncomingAgentService;
  flowAgentService: FlowAgentService;
  webhookDeliveryService: typeof webhookDeliveryService;
  webhookTestService: typeof webhookTestService;
  contactUploadService: typeof contactUploadService;
  recordingService: typeof recordingService;
  campaignScheduler: CampaignScheduler;
  emailService: typeof emailService;
  
  // Utilities
  upload: typeof upload;
  escapeCSV: typeof escapeCSV;
}

/**
 * Creates the shared route context with all dependencies.
 * Call this once in registerRoutes and pass to all route factories.
 */
export function createRouteContext(): RouteContext {
  const elevenLabsPoolService = new ElevenLabsPoolService();
  const incomingAgentService = new IncomingAgentService();
  const flowAgentService = new FlowAgentService();
  const campaignScheduler = new CampaignScheduler();
  
  return {
    db,
    storage,
    authenticateToken,
    authenticateHybrid,
    optionalHybridAuth,
    requireRole,
    generateTokenAsync,
    checkActiveMembership,
    checkUserActive,
    authRateLimiter,
    strictRateLimiter,
    paymentRateLimiter,
    elevenLabsService,
    elevenLabsPoolService,
    twilioService,
    campaignExecutor,
    notificationService: notificationServiceSingleton,
    incomingAgentService,
    flowAgentService,
    webhookDeliveryService,
    webhookTestService,
    contactUploadService,
    recordingService,
    campaignScheduler,
    emailService,
    upload,
    escapeCSV,
  };
}

/**
 * Type for route factory functions.
 * Each route module should export a function matching this signature.
 */
export type RouteFactory = (ctx: RouteContext) => Router;

// Re-export commonly used types
export type { AuthRequest } from "../middleware/auth";
export type { HybridAuthRequest } from "../middleware/hybrid-auth";
