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
/**
 * Get the correct domain for webhooks and callbacks
 * Works in both development and production environments
 * 
 * Environment Variables:
 * - APP_DOMAIN: Primary domain for the application (e.g., "app.yourdomain.com")
 * - DEV_DOMAIN: Explicit development domain override
 * - NODE_ENV: Set to "production" in production environments
 */
export function getDomain(fallbackHost?: string): string {
  let domain: string | undefined;
  const isProduction = process.env.NODE_ENV === 'production';
  
  // In development environment, use dev domain for correct webhook URLs
  if (!isProduction) {
    if (process.env.DEV_DOMAIN) {
      domain = process.env.DEV_DOMAIN;
    }
  }
  
  // In production or if no dev domain found, use APP_DOMAIN
  if (!domain && process.env.APP_DOMAIN) {
    domain = process.env.APP_DOMAIN;
  }
  
  // Fallback to BASE_URL or APP_URL (may already include protocol)
  if (!domain && process.env.BASE_URL) {
    domain = process.env.BASE_URL;
  }
  if (!domain && process.env.APP_URL) {
    domain = process.env.APP_URL;
  }

  // Fallback to the host header from request
  if (!domain && fallbackHost) {
    domain = fallbackHost;
  }
  
  if (!domain) {
    console.warn('⚠️  [Domain] No domain configured! Webhook/callback URLs will use http://localhost:5000 which will NOT work in production. Please set APP_DOMAIN in your environment variables (e.g., APP_DOMAIN=app.yourdomain.com).');
    domain = 'http://localhost:5000';
  }
  
  // Ensure domain always has https:// protocol prefix
  // This is required for proper URL generation (webhooks, WebSocket streams, etc.)
  if (!domain.startsWith('http://') && !domain.startsWith('https://')) {
    domain = 'https://' + domain;
  }
  
  return domain;
}
