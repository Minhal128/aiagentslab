/**
 * ============================================================
 * DEMO MODE - INTERNAL USE ONLY
 * This folder is excluded from distribution packages.
 * 
 * Enable by setting DEMO_MODE=true in environment variables.
 * 
 * IMPORTANT: On hosting platforms (Heroku, DigitalOcean, etc.), 
 * environment variables set in the platform's dashboard/Secrets
 * will OVERRIDE values in the .env file. Make sure to:
 * 1. Update DEMO_MODE in the platform's environment settings
 * 2. Restart the application after changing the value
 * ============================================================
 */
import type { Express, Request, Response, NextFunction } from 'express';

export interface DemoModeConfig {
  blockAdminMutations: boolean;
  hideSensitiveData: boolean;
  showDemoBanner: boolean;
}

const config: DemoModeConfig = {
  blockAdminMutations: true,
  hideSensitiveData: true,
  showDemoBanner: true,
};

const ALLOWED_MUTATION_PATHS = [
  '/api/admin/analytics',
  '/api/admin/dashboard',
  '/api/admin/test-connection',
  '/api/admin/elevenlabs-pool',
  '/api/auth/',
  '/api/public/',
  '/api/agents',
  '/api/campaigns',
  '/api/calls',
  '/api/flows',
  '/api/contacts',
  '/api/incoming-connections',
  '/api/knowledge-base',
  '/api/crm',
  '/api/user',
];

const BLOCKED_MUTATION_PREFIXES = [
  '/api/admin',
  '/api/sip/admin',
  '/api/team/admin',
];

const SENSITIVE_DATA_PREFIXES = [
  '/api/admin/',
  '/api/user/api-keys',
  '/api/settings',
  '/api/sip/',
  '/api/team/',
];

function isDemoModeEnabled(): boolean {
  return process.env.DEMO_MODE === 'true';
}

function blockAdminMutationsMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!isDemoModeEnabled() || !config.blockAdminMutations) {
    return next();
  }

  const method = req.method.toUpperCase();
  const path = req.path;

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const isBlockedPath = BLOCKED_MUTATION_PREFIXES.some(prefix => path.startsWith(prefix));
    const isAllowedPath = ALLOWED_MUTATION_PATHS.some(allowed => path.startsWith(allowed));
    
    if (isBlockedPath && !isAllowedPath) {
      console.log(`[Demo Mode] Blocked ${method} ${path}`);
      return res.status(403).json({
        success: false,
        error: 'Demo Mode Active',
        message: 'Save operations are disabled in demo mode. This feature works in production.',
        demoMode: true,
      });
    }
  }

  next();
}

function filterSensitiveDataMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!isDemoModeEnabled() || !config.hideSensitiveData) {
    return next();
  }

  const path = req.path;
  const method = req.method.toUpperCase();

  if (method !== 'GET') {
    return next();
  }

  const isSensitivePath = SENSITIVE_DATA_PREFIXES.some(sensitive => path.startsWith(sensitive));
  
  if (isSensitivePath) {
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    
    res.json = function(data: any) {
      try {
        const filtered = deepFilterSensitiveData(data);
        return originalJson(filtered);
      } catch (error) {
        console.error('[Demo Mode] Error filtering JSON response:', error);
        return originalJson(data);
      }
    };
    
    res.send = function(data: any) {
      try {
        if (typeof data === 'object' && data !== null) {
          const filtered = deepFilterSensitiveData(data);
          return originalSend(filtered);
        }
        if (typeof data === 'string') {
          try {
            const parsed = JSON.parse(data);
            const filtered = deepFilterSensitiveData(parsed);
            return originalSend(JSON.stringify(filtered));
          } catch {
            return originalSend(data);
          }
        }
        return originalSend(data);
      } catch (error) {
        console.error('[Demo Mode] Error filtering send response:', error);
        return originalSend(data);
      }
    };
  }

  next();
}

const SENSITIVE_KEY_PATTERNS = [
  'apikey', 'api_key', 'secretkey', 'secret_key', 'secret', 'password', 'token',
  'accesskey', 'access_key', 'privatekey', 'private_key', 'authtoken', 'auth_token',
  'clientsecret', 'client_secret', 'smtppassword', 'smtp_password',
  'stripesecretkey', 'stripe_secret_key', 'razorpaykeysecret', 'razorpay_key_secret',
  'paypalclientsecret', 'paypal_client_secret', 'paystacksecretkey', 'paystack_secret_key',
  'mercadopagoaccesstoken', 'mercadopago_access_token', 'hashedkey', 'hashed_key',
  'credentials', 'authsid', 'auth_sid', 'webhook_secret', 'signing_secret',
];

function isPiiEmailField(keyLower: string): boolean {
  return keyLower === 'email' || 
         keyLower.endsWith('email') || 
         keyLower === 'useremail' ||
         keyLower === 'customeremail';
}

function isPiiPhoneField(keyLower: string): boolean {
  return keyLower === 'phone' || 
         keyLower === 'mobile' ||
         keyLower.endsWith('phone') ||
         keyLower.endsWith('mobile') ||
         keyLower === 'phonenumber' ||
         keyLower === 'mobilenumber';
}

function isPiiAddressField(keyLower: string): boolean {
  return keyLower === 'address' ||
         keyLower === 'streetaddress' ||
         keyLower === 'homeaddress' ||
         keyLower === 'billingaddress' ||
         keyLower === 'shippingaddress';
}

function deepFilterSensitiveData(data: any, depth: number = 0): any {
  if (depth > 10) return data;
  if (data === null || data === undefined) return data;
  
  if (data instanceof Date) return data;
  
  if (Array.isArray(data)) {
    return data.map(item => deepFilterSensitiveData(item, depth + 1));
  }
  
  if (typeof data !== 'object') return data;
  
  const result: any = {};
  for (const [key, value] of Object.entries(data)) {
    const keyLower = key.toLowerCase().replace(/[-_]/g, '');
    
    if (value instanceof Date) {
      result[key] = value;
    } else if (SENSITIVE_KEY_PATTERNS.some(pattern => keyLower.includes(pattern.replace(/[-_]/g, '')))) {
      result[key] = value ? '***HIDDEN***' : null;
    } else if (isPiiEmailField(keyLower) && typeof value === 'string' && value.includes('@')) {
      result[key] = maskEmail(value);
    } else if (isPiiPhoneField(keyLower) && typeof value === 'string' && value) {
      result[key] = '***-***-****';
    } else if (isPiiAddressField(keyLower) && typeof value === 'string' && value) {
      result[key] = '*** Hidden Address ***';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = deepFilterSensitiveData(value, depth + 1);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function maskEmail(email: string): string {
  if (!email) return email;
  const [local, domain] = email.split('@');
  if (!domain) return '***@***.***';
  const maskedLocal = local.length > 2 
    ? `${local[0]}***${local[local.length - 1]}`
    : '***';
  return `${maskedLocal}@${domain}`;
}

export function initDemoMode(app: Express): void {
  if (!isDemoModeEnabled()) {
    console.log('[Demo Mode] Disabled - DEMO_MODE env not set to true');
    return;
  }

  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           🎭 DEMO MODE ACTIVE                               ║');
  console.log('║           Admin mutations blocked, sensitive data hidden    ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');

  app.use(blockAdminMutationsMiddleware);
  app.use(filterSensitiveDataMiddleware);
}

export function getDemoModeStatus(): { enabled: boolean; config: DemoModeConfig } {
  return {
    enabled: isDemoModeEnabled(),
    config,
  };
}

export function registerDemoModeRoutes(app: Express): void {
  app.get('/api/demo-mode/status', (_req: Request, res: Response) => {
    res.json({
      enabled: isDemoModeEnabled(),
      message: isDemoModeEnabled() 
        ? 'Demo mode is active. Some admin features are restricted.'
        : 'Demo mode is not active.',
    });
  });
}
