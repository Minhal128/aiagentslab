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
'use strict';
import express, { type Request, Response, NextFunction } from "express";
import path from "path";
import cookieParser from "cookie-parser";
import compression from "compression";
import helmet from "helmet";
import { registerRoutes } from "./routes";
function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}
import { startPhoneBillingCron } from "./services/phone-billing-cron";
import { startCreditBackfillMonitor } from "./services/credit-backfill-monitor";
import { startPhoneReleaseRetryWorker } from "./services/phone-release-retry-worker";
import { runStartupHealthCheck, getHealthStatus } from "./services/startup-health-check";
import { setupGlobalHandlers, registerServer, signalReady } from "./services/graceful-shutdown";
import { startWatchdog } from "./services/resource-watchdog";
import { webhookRetryService } from "./services/webhook-retry-service";
import { preloadJwtExpiry } from "./middleware/auth";
import { cleanupStaleMaintenanceFlag } from "./services/system-update-service";
import { storage } from "./storage";
import { initializeMigrationEngine } from "./engines/elevenlabs-migration";
import { correlationIdMiddleware } from "./middleware/correlation-id";
import { emailService } from "./services/email-service";
import { initializeDirectories } from "./utils/init-directories";
import { runAllSeeds } from "./seed-all";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { resyncSipAgentTransferTools, resyncSipTrunkConfigs, resyncAppointmentWebhookUrls, resyncFormWebhookUrls, resyncMessagingWebhookUrls } from "./services/sip-transfer-resync";

// Setup global error handlers and shutdown signals FIRST
// This ensures crashes are caught even during initialization
setupGlobalHandlers();

// Ensure all required directories exist before starting
initializeDirectories();

// Diploy startup signature
console.log(`
====================================
Platform Initialized
©diploy
Unauthorized distribution prohibited
`);

const app = express();

// Enable gzip compression for all responses (improves load times by 60-80%)
app.use(compression({
  level: 6, // Balanced compression level (1-9, 6 is default)
  threshold: 1024, // Only compress responses > 1KB
  filter: (req, res) => {
    // Don't compress if client doesn't accept it
    if (req.headers['x-no-compression']) {
      return false;
    }
    // Use default filter (compresses text, json, etc.)
    return compression.filter(req, res);
  }
}));

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}
app.use(express.json({
  limit: '2mb',
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));
app.use(cookieParser()); // Parse cookies for refresh token handling

// Static file caching options (7 days for images/audio, reduces repeat requests)
const staticCacheOptions = { maxAge: '7d', etag: true, lastModified: true };

// Serve static files from client/public folder (for uploads like SEO images)
// This must come before API routes so /uploads/* URLs are served correctly
app.use('/uploads', (_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'attachment');
  next();
}, express.static(path.join(process.cwd(), 'client', 'public', 'uploads'), staticCacheOptions));

// Serve static images from client/public/images folder (for logos, favicons, SEO images)
// Images are stored as files instead of base64 to prevent database timeouts
app.use('/images', express.static(path.join(process.cwd(), 'client', 'public', 'images'), staticCacheOptions));

// Serve audio files from public/audio folder (for flow automation play_audio nodes)
app.use('/audio', express.static(path.join(process.cwd(), 'public', 'audio'), staticCacheOptions));

// Serve widget files from public/widget folder (for embeddable voice widgets)
// CORS enabled for cross-origin embedding on external websites
app.use('/widget', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
}, express.static(path.join(process.cwd(), 'public', 'widget')));

// Security headers via helmet
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  hsts: { maxAge: 31536000, includeSubDomains: true },
}));

app.disable('x-powered-by');

const seoPublicPaths = ['/', '/pricing', '/features', '/use-cases', '/integrations', '/blog', '/contact', '/about', '/privacy', '/terms', '/sitemap.xml', '/robots.txt'];
app.use((req: Request, res: Response, next: NextFunction) => {
  const p = req.path.replace(/\/+$/, '') || '/';
  const isPublicPage = seoPublicPaths.includes(p) || p.startsWith('/blog/');
  if (isPublicPage) {
    res.setHeader('X-Robots-Tag', 'index, follow');
  }
  next();
});

// Correlation ID middleware for distributed request tracing
app.use(correlationIdMiddleware);

// Simple health check endpoint for deployment
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// Detailed health check endpoint - returns minimal info without auth
app.get("/health/detailed", async (_req, res) => {
  try {
    const status = await getHealthStatus();
    const httpStatus = status.status === 'healthy' ? 200 : status.status === 'degraded' ? 200 : 503;
    res.status(httpStatus).json({ 
      status: status.status,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    res.status(503).json({ status: 'unhealthy' });
  }
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      // Include correlation ID (first 8 chars) in logs for request tracing
      const correlationPrefix = req.correlationId ? `[${req.correlationId.slice(0, 8)}] ` : '';
      let logLine = `${correlationPrefix}${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 90) {
        logLine = logLine.slice(0, 89) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Initialize Demo Mode if enabled (INTERNAL USE ONLY - not distributed to clients)
  // This folder is excluded from production ZIP packages
  if (process.env.DEMO_MODE === 'true') {
    try {
      const { initDemoMode, registerDemoModeRoutes } = await import('./demo-mode');
      initDemoMode(app);
      registerDemoModeRoutes(app);
    } catch (error) {
      console.error('[Demo Mode] Failed to initialize:', error);
    }
  }

  // Initialize email service from database settings FIRST (before health check)
  // This ensures database SMTP settings take precedence over env vars
  try {
    const emailInitialized = await emailService.reinitializeFromDatabase();
    if (emailInitialized) {
      console.log('📧 [Email] Service initialized from database settings');
    }
  } catch (error) {
    console.error('⚠️ [Email] Failed to initialize from database:', error);
  }
  
  // Run startup health checks before serving traffic
  try {
    await runStartupHealthCheck();
  } catch (error) {
    console.error('❌ [Startup] Health check failed:', error);
  }
  
  // Run database seeding on startup (safe - skips if data already exists)
  try {
    await runAllSeeds();
    console.log('✅ [Startup] Database seeding completed');
  } catch (error) {
    console.error('⚠️ [Startup] Database seeding failed (non-fatal):', error);
  }

  // Data fix: normalize phone number status 'assigned' → 'active'
  // The admin assign route previously set status='assigned' instead of 'active',
  // blocking those numbers from campaign execution. This corrects existing rows.
  try {
    await db.execute(sql`UPDATE phone_numbers SET status = 'active' WHERE status = 'assigned'`);
  } catch (error) {
    console.error('⚠️ [Startup] Phone status normalization failed (non-fatal):', error);
  }

  // One-time migration: auto-enable gateways that have credentials but no explicit *_enabled flag
  try {
    const migrationDone = await storage.getGlobalSetting('gateway_enable_migration_v1');
    if (!migrationDone) {
      const gatewayChecks = [
        { credKeys: ['stripe_secret_key', 'stripe_publishable_key'], enableKey: 'stripe_enabled', envKeys: ['STRIPE_SECRET_KEY', 'VITE_STRIPE_PUBLIC_KEY'] },
        { credKeys: ['razorpay_key_id', 'razorpay_key_secret'], enableKey: 'razorpay_enabled', envKeys: [] },
        { credKeys: ['paypal_client_id', 'paypal_client_secret'], enableKey: 'paypal_enabled', envKeys: [] },
        { credKeys: ['paystack_public_key', 'paystack_secret_key'], enableKey: 'paystack_enabled', envKeys: [] },
        { credKeys: ['mercadopago_access_token'], enableKey: 'mercadopago_enabled', envKeys: [] },
      ];
      for (const check of gatewayChecks) {
        const enabledSetting = await storage.getGlobalSetting(check.enableKey);
        if (!enabledSetting) {
          const dbCreds = await Promise.all(check.credKeys.map(k => storage.getGlobalSetting(k)));
          const hasDbCreds = dbCreds.every(s => s?.value);
          const hasEnvCreds = check.envKeys.length > 0 && check.envKeys.every(k => !!process.env[k]);
          if (hasDbCreds || hasEnvCreds) {
            await storage.updateGlobalSetting(check.enableKey, true);
            console.log(`🔄 [Migration] Auto-enabled ${check.enableKey} (credentials present, flag was unset)`);
          }
        }
      }
      await storage.updateGlobalSetting('gateway_enable_migration_v1', 'done');
      console.log('✅ [Migration] Gateway enable migration v1 completed');
    }
  } catch (error) {
    console.error('⚠️ [Migration] Gateway enable migration failed (non-fatal):', error);
  }
  
  // Preload JWT expiry settings from database
  await preloadJwtExpiry(storage);

  // Clear any stale `.maintenance` flag left by a previous crashed update
  // so user traffic isn't blocked indefinitely.
  cleanupStaleMaintenanceFlag();

  // Resync SIP agents' transfer tools on startup (non-blocking)
  resyncSipAgentTransferTools().catch(err => {
    console.warn('[Startup] SIP transfer resync failed (non-fatal):', err);
  });

  // Resync SIP trunk configs (media encryption, addresses) on startup (non-blocking)
  resyncSipTrunkConfigs().catch(err => {
    console.warn('[Startup] SIP trunk config resync failed (non-fatal):', err);
  });

  // Resync appointment webhook URLs with current persisted secret (non-blocking)
  // Prevents "Invalid authentication token" errors when ElevenLabs agents have stale webhook URLs
  resyncAppointmentWebhookUrls().catch(err => {
    console.warn('[Startup] Appointment webhook resync failed (non-fatal):', err);
  });

  // Resync form submission webhook URLs with the now-stable HMAC-derived secret (non-blocking)
  // Repairs all existing flow agents that have stale form webhook URLs from the old random-secret era
  resyncFormWebhookUrls().catch(err => {
    console.warn('[Startup] Form webhook resync failed (non-fatal):', err);
  });

  // Resync messaging (WhatsApp/Email) webhook URLs with current context (non-blocking)
  // Repairs agents missing conversationId context or using stale secrets
  resyncMessagingWebhookUrls().catch(err => {
    console.warn('[Startup] Messaging webhook resync failed (non-fatal):', err);
  });


  // SIP Credit Guard: Disconnect agents from SIP numbers for users below credit threshold
  import('./services/sip-credit-guard').then(({ runStartupCreditGuardScan }) => {
    runStartupCreditGuardScan().catch(err => {
      console.warn('[Startup] SIP credit guard scan failed (non-fatal):', err);
    });
  }).catch(() => {});
  
  const server = await registerRoutes(app);

  // Global error handler - ALWAYS returns JSON for API routes
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const isProduction = process.env.NODE_ENV === 'production';
    const message = status >= 500 && isProduction
      ? "Internal Server Error"
      : (err.message || "Internal Server Error");
    
    const correlationId = req.correlationId;
    const errorResponse: any = { 
      success: false,
      error: message, 
      message 
    };
    if (correlationId) {
      errorResponse.correlationId = correlationId;
    }

    console.error(`[Error Handler] ${req.method} ${req.path}:`, err.message || err);
    
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json');
      res.status(status).json(errorResponse);
    }
  });

  // API 404 handler - catches any /api/* route that wasn't matched
  // This MUST run before Vite catch-all to prevent HTML responses for API routes
  app.use('/api/*', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json');
    res.status(404).json({
      success: false,
      error: "API endpoint not found",
      path: req.originalUrl,
      method: req.method
    });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  const isProduction = app.get("env") === "production" || process.env.NODE_ENV === "production";
  
  // SEO meta tag injection middleware for social sharing (Facebook, WhatsApp, Twitter, etc.)
  // This injects og:image and other meta tags server-side since crawlers don't execute JavaScript
  const isPublicRoute = (pagePath: string): boolean => {
    const normalized = pagePath.replace(/\/+$/, '') || '/';
    return seoPublicPaths.includes(normalized) || normalized.startsWith('/blog/');
  };

  const injectSeoMetaTags = async (html: string, baseUrl: string, pageUrl: string, pagePath: string): Promise<string> => {
    try {
      const [seoSettings, appNameSetting, appTaglineSetting] = await Promise.all([
        storage.getSeoSettings(),
        storage.getGlobalSetting('app_name'),
        storage.getGlobalSetting('app_tagline')
      ]);

      const escapeHtml = (str: string): string => {
        return str
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      };

      const siteName: string = String(appNameSetting?.value || 'AI Platform');
      const tagline: string = String(appTaglineSetting?.value || '');
      const title: string = String(seoSettings?.defaultTitle || siteName);
      const fullTitle = tagline ? `${title} - ${tagline}` : title;
      const description: string = String(seoSettings?.defaultDescription || tagline || 'AI-powered voice agents for automated calling');

      const isPublic = isPublicRoute(pagePath);

      if (isPublic) {
        html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(fullTitle)}</title>`);
        html = html.replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/?>/, `<meta name="description" content="${escapeHtml(description)}" />`);
      }
      
      let ogImageUrl: string = String(seoSettings?.defaultOgImage || '/og-image.png');
      if (!ogImageUrl.startsWith('http')) {
        ogImageUrl = `${baseUrl}${ogImageUrl}`;
      }

      const ogImageExt = ogImageUrl.toLowerCase().split('.').pop()?.split('?')[0] || 'png';
      const ogImageType = ['jpg', 'jpeg'].includes(ogImageExt) ? 'image/jpeg' 
        : ogImageExt === 'gif' ? 'image/gif' 
        : ogImageExt === 'webp' ? 'image/webp' 
        : 'image/png';

      const secureImageUrl = ogImageUrl.startsWith('https://') ? ogImageUrl : ogImageUrl.replace('http://', 'https://');

      let robotsTag = '';
      let canonicalTag = '';
      let verificationTags = '';

      if (isPublic) {
        robotsTag = `\n    <meta name="robots" content="index, follow" />`;
        const canonicalUrl = pageUrl.split('?')[0].split('#')[0];
        canonicalTag = `\n    <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`;

        const googleVerification = seoSettings?.googleVerification;
        const bingVerification = seoSettings?.bingVerification;
        if (googleVerification) {
          verificationTags += `\n    <meta name="google-site-verification" content="${escapeHtml(googleVerification)}" />`;
        }
        if (bingVerification) {
          verificationTags += `\n    <meta name="msvalidate.01" content="${escapeHtml(bingVerification)}" />`;
        }
      } else {
        robotsTag = `\n    <meta name="robots" content="noindex, nofollow" />`;
      }
      
      const seoMetaTags = `
    <!-- Server-side SEO meta tags -->${robotsTag}${canonicalTag}${verificationTags}
    <meta property="og:title" content="${escapeHtml(fullTitle)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(pageUrl)}" />
    <meta property="og:image" content="${escapeHtml(ogImageUrl)}" />
    <meta property="og:image:secure_url" content="${escapeHtml(secureImageUrl)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:type" content="${ogImageType}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${escapeHtml(siteName)}" />
    <meta property="og:locale" content="en_US" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(fullTitle)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(ogImageUrl)}" />
    <!-- End server-side SEO meta tags -->`;

      return html.replace('</head>', `${seoMetaTags}\n  </head>`);
    } catch (error) {
      console.error('Error injecting SEO meta tags:', error);
      return html;
    }
  };
  
  // Crawler user agents that need server-rendered OG meta tags
  const crawlerUserAgents = [
    'facebookexternalhit',
    'Facebot',
    'WhatsApp',
    'Twitterbot',
    'LinkedInBot',
    'Slackbot',
    'Discordbot',
    'TelegramBot',
    'Pinterest',
    'Googlebot',
    'bingbot',
    'Applebot',
    'iMessageBot',
    'Apple-Messages'
  ];
  
  const isCrawler = (userAgent: string | undefined): boolean => {
    if (!userAgent) return false;
    return crawlerUserAgents.some(crawler => userAgent.toLowerCase().includes(crawler.toLowerCase()));
  };
  
  // Middleware to serve SEO-optimized HTML for social media crawlers
  // This runs BEFORE Vite/static file serving to catch crawler requests
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    const userAgent = req.headers['user-agent'];
    
    // Only intercept non-API HTML page requests from crawlers
    if (!req.path.startsWith('/api') && !req.path.includes('.') && isCrawler(userAgent)) {
      try {
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
        const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
        const baseUrl = `${protocol}://${host}`;
        const pageUrl = `${baseUrl}${req.originalUrl || req.path}`;
        
        // Read the appropriate HTML template based on environment
        const fs = await import('fs').then(m => m.promises);
        const prodPath = path.resolve(import.meta.dirname, 'public', 'index.html');
        const devPath = path.join(process.cwd(), 'client', 'index.html');
        
        // Use production build in production, dev template in development
        let indexPath = devPath;
        try {
          await fs.access(prodPath);
          if (isProduction) {
            indexPath = prodPath;
          }
        } catch {
          // Production build doesn't exist, use dev path
        }
        
        let html = await fs.readFile(indexPath, 'utf-8');
        
        html = await injectSeoMetaTags(html, baseUrl, pageUrl, req.path);
        
        res.setHeader('Content-Type', 'text/html');
        res.send(html);
        return;
      } catch (error) {
        console.error('Error serving crawler-optimized HTML:', error);
      }
    }
    next();
  });
  
  if (!isProduction) {
    const devModule = "./vite";
    const { setupVite } = await import(/* @vite-ignore */ devModule);
    await setupVite(app, server);
  } else {
    // Set NODE_ENV to production for proper middleware behavior
    process.env.NODE_ENV = "production";
    app.set("env", "production");
    log("Running in PRODUCTION mode");
    
    // In production, serve static files with SEO injection
    const fs = await import('fs');
    const distPath = path.resolve(import.meta.dirname, "public");
    
    if (!fs.existsSync(distPath)) {
      throw new Error(
        `Could not find the build directory: ${distPath}, make sure to build the client first`,
      );
    }
    
    app.use(express.static(distPath));
    
    // Serve index.html with SEO meta tags for all non-file routes
    app.use("*", async (req, res) => {
      try {
        const indexPath = path.resolve(distPath, "index.html");
        let html = await fs.promises.readFile(indexPath, 'utf-8');
        
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
        const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
        const baseUrl = `${protocol}://${host}`;
        const pageUrl = `${baseUrl}${req.originalUrl || req.path}`;
        
        const pagePath = req.originalUrl?.split('?')[0] || req.path;
        html = await injectSeoMetaTags(html, baseUrl, pageUrl, pagePath);
        res.setHeader('Content-Type', 'text/html');
        res.send(html);
      } catch (error) {
        console.error('Error serving index.html:', error);
        res.sendFile(path.resolve(distPath, "index.html"));
      }
    });
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  
  // Register the server for graceful shutdown
  registerServer(server);
  
  // In production ESM mode, Node.js can exit if the event loop appears empty
  // Set up keepalive BEFORE server.listen to ensure event loop stays active
  if (process.env.NODE_ENV === 'production') {
    const keepalive = setInterval(() => {
      // Heartbeat to keep process alive - do not use .unref()
      // This interval reference keeps the event loop active
    }, 30000);
    // Store reference to prevent garbage collection
    (global as any).__keepalive = keepalive;
    console.log('🔄 [Production] Keepalive interval started before server.listen');
  }
  
  // Wrap server.listen in a Promise to ensure IIFE awaits server startup
  // This prevents premature exit in ESM mode on Cloud Run/containerized deployments
  await new Promise<void>((resolve) => {
    // Build listen options - reusePort is only supported on Linux/Unix, not Windows
    const listenOptions: any = {
      port,
      host: "0.0.0.0",
    };
    if (process.platform !== 'win32') {
      listenOptions.reusePort = true;
    }
    
    server.listen(listenOptions, () => {
      log(`serving on port ${port}`);
      
      // Start phone number billing cron job
      startPhoneBillingCron();

      // Start daily un-billed call detection sweep across all telephony engines.
      startCreditBackfillMonitor();

      // Start worker that retries failed provider phone-number releases
      startPhoneReleaseRetryWorker();
      
      // Start resource watchdog for auto-restart monitoring
      startWatchdog();
      
      // Start webhook retry service for failed payment webhooks
      webhookRetryService.start();
      
      // Start ElevenLabs migration engine (handles retry queue for capacity errors)
      initializeMigrationEngine();
      
      // Initialize BullMQ if enabled (opt-in via ENABLE_BULLMQ=true and REDIS_URL)
      // This runs async and won't block startup if Redis is unavailable
      import('./infrastructure/bullmq').then(async (bullmq) => {
        try {
          const initialized = await bullmq.initializeBullMQ();
          if (initialized) {
            console.log('✅ [BullMQ] Queue system ready for campaign processing');
          }
        } catch (error: any) {
          console.warn('⚠️ [BullMQ] Failed to initialize (using fallback queues):', error.message);
        }
      }).catch(() => {
        // BullMQ module not available, continue without it
      });
      
      // Signal PM2 that the process is ready to receive connections
      signalReady();
      
      console.log('✅ [Production] Server fully initialized and listening');
      resolve();
    });
  });
  
  // Keep the IIFE alive - this line is never reached because server runs indefinitely
  // but having an unresolved promise after await ensures the event loop stays active
  console.log('🔄 [Server] Main initialization complete, server running...');
})();
