'use strict';
import { Router, Response } from 'express';
import { storage } from '../../storage';
import { AdminRequest, requireAdminPermission } from '../../middleware/admin-auth';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const uploadsDir = path.join(process.cwd(), 'client', 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const uploadStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'seo-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: uploadStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type.'));
    }
  }
});

export function registerSeoRoutes(router: Router) {
  router.get('/seo', requireAdminPermission('settings', 'seo_settings', 'read'), async (req: AdminRequest, res: Response) => {
    try {
      const seoData = await storage.getSeoSettings();
      
      // Map database columns to frontend-expected field names
      const mappedSettings: Record<string, any> = {
        defaultTitle: seoData?.defaultTitle || '',
        defaultDescription: seoData?.defaultDescription || '',
        defaultKeywords: seoData?.defaultKeywords || [],
        defaultOgImage: seoData?.defaultOgImage || '',
        structuredDataOrg: seoData?.structuredData || null,
        structuredDataFaq: seoData?.structuredDataFaq || null,
        structuredDataProduct: seoData?.structuredDataProduct || null,
        twitterHandle: seoData?.twitterHandle || '',
        facebookAppId: seoData?.facebookAppId || '',
        robotsRules: seoData?.robotsRules || null,
        robotsCrawlDelay: seoData?.robotsCrawlDelay || null,
        canonicalBaseUrl: seoData?.canonicalBaseUrl || '',
        googleVerification: seoData?.googleVerification || '',
        bingVerification: seoData?.bingVerification || '',
        sitemapUrls: seoData?.sitemapUrls || [],
        sitemapEnabled: seoData?.sitemapEnabled ?? true,
        robotsEnabled: seoData?.robotsEnabled ?? true,
        structuredDataEnabled: seoData?.structuredDataEnabled ?? false,
        structuredDataFaqEnabled: seoData?.structuredDataFaqEnabled ?? false,
        structuredDataProductEnabled: seoData?.structuredDataProductEnabled ?? false
      };
      
      res.json(mappedSettings);
    } catch (error) {
      console.error('Error fetching SEO settings:', error);
      res.status(500).json({ error: 'Failed to fetch SEO settings' });
    }
  });

  router.patch('/seo', requireAdminPermission('settings', 'seo_settings', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const {
        defaultTitle, defaultDescription, defaultKeywords, defaultOgImage,
        canonicalBaseUrl, googleVerification, bingVerification,
        twitterHandle, facebookAppId, robotsRules, robotsCrawlDelay,
        structuredDataOrg, structuredDataFaq, structuredDataProduct,
        sitemapEnabled, robotsEnabled, 
        structuredDataEnabled, structuredDataFaqEnabled, structuredDataProductEnabled
      } = req.body;
      
      // Build update object with only defined fields
      const updateData: Record<string, any> = {};
      
      if (defaultTitle !== undefined) updateData.defaultTitle = defaultTitle;
      if (defaultDescription !== undefined) updateData.defaultDescription = defaultDescription;
      if (defaultKeywords !== undefined) updateData.defaultKeywords = defaultKeywords;
      if (defaultOgImage !== undefined) updateData.defaultOgImage = defaultOgImage;
      if (canonicalBaseUrl !== undefined) updateData.canonicalBaseUrl = canonicalBaseUrl;
      if (googleVerification !== undefined) updateData.googleVerification = googleVerification;
      if (bingVerification !== undefined) updateData.bingVerification = bingVerification;
      if (twitterHandle !== undefined) updateData.twitterHandle = twitterHandle;
      if (facebookAppId !== undefined) updateData.facebookAppId = facebookAppId;
      if (robotsRules !== undefined) updateData.robotsRules = robotsRules;
      if (robotsCrawlDelay !== undefined) updateData.robotsCrawlDelay = robotsCrawlDelay;
      if (structuredDataOrg !== undefined) updateData.structuredData = structuredDataOrg;
      if (structuredDataFaq !== undefined) updateData.structuredDataFaq = structuredDataFaq;
      if (structuredDataProduct !== undefined) updateData.structuredDataProduct = structuredDataProduct;
      if (sitemapEnabled !== undefined) updateData.sitemapEnabled = sitemapEnabled;
      if (robotsEnabled !== undefined) updateData.robotsEnabled = robotsEnabled;
      if (structuredDataEnabled !== undefined) updateData.structuredDataEnabled = structuredDataEnabled;
      if (structuredDataFaqEnabled !== undefined) updateData.structuredDataFaqEnabled = structuredDataFaqEnabled;
      if (structuredDataProductEnabled !== undefined) updateData.structuredDataProductEnabled = structuredDataProductEnabled;
      
      if (Object.keys(updateData).length > 0) {
        await storage.updateSeoSettings(updateData);
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error updating SEO settings:', error);
      res.status(500).json({ error: 'Failed to update SEO settings' });
    }
  });

  router.post('/seo/sitemap-urls', requireAdminPermission('settings', 'seo_settings', 'create'), async (req: AdminRequest, res: Response) => {
    try {
      const { urls, url, changefreq, priority } = req.body;
      
      type ChangeFreq = 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
      interface SitemapUrlEntry {
        url: string;
        changefreq: ChangeFreq;
        priority: number;
        lastmod?: string;
      }
      
      const seoData = await storage.getSeoSettings();
      let existingUrls: SitemapUrlEntry[] = [];
      
      if (seoData?.sitemapUrls && Array.isArray(seoData.sitemapUrls)) {
        existingUrls = (seoData.sitemapUrls as any[]).map((item: any) => {
          if (typeof item === 'string') {
            return { url: item, changefreq: 'weekly', priority: 0.5 };
          }
          return item;
        });
      }
      
      if (Array.isArray(urls)) {
        for (const u of urls) {
          const urlEntry = typeof u === 'string' 
            ? { url: u, changefreq: 'weekly', priority: 0.5 }
            : u;
          if (!existingUrls.find(e => e.url === urlEntry.url)) {
            existingUrls.push(urlEntry);
          }
        }
      } else if (url) {
        const newEntry: SitemapUrlEntry = {
          url,
          changefreq: changefreq || 'weekly',
          priority: priority ?? 0.5,
          lastmod: new Date().toISOString().split('T')[0]
        };
        if (!existingUrls.find(e => e.url === url)) {
          existingUrls.push(newEntry);
        }
      } else {
        return res.status(400).json({ error: 'URL or URLs array is required' });
      }
      
      await storage.updateSeoSettings({ sitemapUrls: existingUrls });
      
      res.json({ success: true, urls: existingUrls });
    } catch (error) {
      console.error('Error adding sitemap URLs:', error);
      res.status(500).json({ error: 'Failed to add sitemap URLs' });
    }
  });

  router.delete('/seo/sitemap-urls', requireAdminPermission('settings', 'seo_settings', 'delete'), async (req: AdminRequest, res: Response) => {
    try {
      const { urls, url } = req.body;
      
      type ChangeFreq = 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
      interface SitemapUrlEntry {
        url: string;
        changefreq: ChangeFreq;
        priority: number;
        lastmod?: string;
      }
      
      let urlsToRemove: string[] = [];
      if (Array.isArray(urls)) {
        urlsToRemove = urls;
      } else if (url) {
        urlsToRemove = [url];
      } else {
        return res.status(400).json({ error: 'URL or URLs array is required' });
      }
      
      const seoData = await storage.getSeoSettings();
      let existingUrls: SitemapUrlEntry[] = [];
      
      if (seoData?.sitemapUrls && Array.isArray(seoData.sitemapUrls)) {
        existingUrls = (seoData.sitemapUrls as any[]).map((item: any) => {
          if (typeof item === 'string') {
            return { url: item, changefreq: 'weekly', priority: 0.5 };
          }
          return item;
        });
      }
      
      const newUrls = existingUrls.filter(entry => !urlsToRemove.includes(entry.url));
      
      await storage.updateSeoSettings({ sitemapUrls: newUrls });
      
      res.json({ success: true, urls: newUrls });
    } catch (error) {
      console.error('Error removing sitemap URLs:', error);
      res.status(500).json({ error: 'Failed to remove sitemap URLs' });
    }
  });

  const SEO_DEFAULT_URLS: Array<{ url: string; changefreq: string; priority: number; lastmod?: string }> = [
    { url: '/', changefreq: 'weekly', priority: 1.0 },
    { url: '/pricing', changefreq: 'weekly', priority: 0.9 },
    { url: '/features', changefreq: 'weekly', priority: 0.9 },
    { url: '/use-cases', changefreq: 'weekly', priority: 0.8 },
    { url: '/integrations', changefreq: 'weekly', priority: 0.8 },
    { url: '/blog', changefreq: 'daily', priority: 0.7 },
    { url: '/contact', changefreq: 'monthly', priority: 0.6 },
    { url: '/about', changefreq: 'monthly', priority: 0.5 },
    { url: '/privacy', changefreq: 'yearly', priority: 0.2 },
    { url: '/terms', changefreq: 'yearly', priority: 0.2 },
  ];

  function escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function getCanonicalBaseUrl(seoData: any, req?: any): string {
    const canonicalUrl = seoData?.canonicalBaseUrl
      || process.env.CANONICAL_BASE_URL
      || '';

    if (canonicalUrl) {
      return canonicalUrl.replace(/\/+$/, '');
    }

    if (req) {
      const proto = req.headers?.['x-forwarded-proto'] || req.protocol || 'https';
      const host = req.get?.('host') || req.headers?.host;
      if (host) {
        return `${proto}://${host}`.replace(/\/+$/, '');
      }
    }

    return '';
  }

  router.post('/seo/generate-sitemap', requireAdminPermission('settings', 'seo_settings', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      type ChangeFreq = 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
      interface SitemapUrlEntry {
        url: string;
        changefreq: ChangeFreq;
        priority: number;
        lastmod?: string;
      }
      
      const seoData = await storage.getSeoSettings();
      const baseUrl = getCanonicalBaseUrl(seoData, req);
      
      let customUrls: SitemapUrlEntry[] = [];
      if (seoData?.sitemapUrls && Array.isArray(seoData.sitemapUrls)) {
        customUrls = (seoData.sitemapUrls as any[]).map((item: any) => {
          if (typeof item === 'string') {
            return { url: item, changefreq: 'weekly', priority: 0.5 };
          }
          return item;
        });
      }
      
      const urlMap = new Map<string, SitemapUrlEntry>();
      for (const entry of SEO_DEFAULT_URLS) {
        urlMap.set(entry.url, entry as SitemapUrlEntry);
      }
      for (const entry of customUrls) {
        urlMap.set(entry.url, entry);
      }
      const allUrls = Array.from(urlMap.values());
      
      await storage.updateSeoSettings({ sitemapUrls: allUrls });
      
      let sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n';
      sitemap += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
      
      for (const entry of allUrls) {
        const fullUrl = entry.url.startsWith('http') ? entry.url : `${baseUrl}${entry.url}`;
        const changefreq = entry.changefreq || 'weekly';
        const priority = typeof entry.priority === 'number' ? entry.priority : 0.5;
        sitemap += `  <url>\n`;
        sitemap += `    <loc>${escapeXml(fullUrl)}</loc>\n`;
        sitemap += `    <lastmod>${entry.lastmod || new Date().toISOString().split('T')[0]}</lastmod>\n`;
        sitemap += `    <changefreq>${changefreq}</changefreq>\n`;
        sitemap += `    <priority>${priority.toFixed(1)}</priority>\n`;
        sitemap += `  </url>\n`;
      }
      
      sitemap += '</urlset>';
      
      const sitemapPath = path.join(process.cwd(), 'client', 'public', 'sitemap.xml');
      fs.writeFileSync(sitemapPath, sitemap);
      
      res.json({ success: true, message: 'Sitemap generated successfully', urlCount: allUrls.length });
    } catch (error) {
      console.error('Error generating sitemap:', error);
      res.status(500).json({ error: 'Failed to generate sitemap' });
    }
  });

  router.post('/seo/rebuild-sitemap', requireAdminPermission('settings', 'seo_settings', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      type ChangeFreq = 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
      interface SitemapUrlEntry {
        url: string;
        changefreq: ChangeFreq;
        priority: number;
        lastmod?: string;
      }
      
      const seoData = await storage.getSeoSettings();
      const baseUrl = getCanonicalBaseUrl(seoData, req);
      
      let allUrls: SitemapUrlEntry[] = [];
      if (seoData?.sitemapUrls && Array.isArray(seoData.sitemapUrls)) {
        allUrls = (seoData.sitemapUrls as any[]).map((item: any) => {
          if (typeof item === 'string') {
            return { url: item, changefreq: 'weekly', priority: 0.5 };
          }
          return { ...item, lastmod: new Date().toISOString().split('T')[0] };
        });
      }
      
      if (allUrls.length === 0) {
        const today = new Date().toISOString().split('T')[0];
        allUrls = SEO_DEFAULT_URLS.map(u => ({ ...u, lastmod: today })) as SitemapUrlEntry[];
      }
      
      await storage.updateSeoSettings({ sitemapUrls: allUrls });
      
      let sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n';
      sitemap += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
      
      for (const entry of allUrls) {
        const fullUrl = entry.url.startsWith('http') ? entry.url : `${baseUrl}${entry.url}`;
        const changefreq = entry.changefreq || 'weekly';
        const priority = typeof entry.priority === 'number' ? entry.priority : 0.5;
        sitemap += `  <url>\n`;
        sitemap += `    <loc>${escapeXml(fullUrl)}</loc>\n`;
        sitemap += `    <lastmod>${entry.lastmod || new Date().toISOString().split('T')[0]}</lastmod>\n`;
        sitemap += `    <changefreq>${changefreq}</changefreq>\n`;
        sitemap += `    <priority>${priority.toFixed(1)}</priority>\n`;
        sitemap += `  </url>\n`;
      }
      
      sitemap += '</urlset>';
      
      const sitemapPath = path.join(process.cwd(), 'client', 'public', 'sitemap.xml');
      fs.writeFileSync(sitemapPath, sitemap);
      
      res.json({ success: true, message: 'Sitemap rebuilt successfully', urlCount: allUrls.length });
    } catch (error) {
      console.error('Error rebuilding sitemap:', error);
      res.status(500).json({ error: 'Failed to rebuild sitemap' });
    }
  });

  router.post('/seo/upload-image', requireAdminPermission('settings', 'seo_settings', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const { imageData, imageType, fileName, field } = req.body;
      
      // Handle base64 image data from frontend
      if (imageData && typeof imageData === 'string' && imageData.startsWith('data:')) {
        const matches = imageData.match(/^data:image\/(\w+);base64,(.+)$/);
        if (!matches) {
          return res.status(400).json({ error: 'Invalid image data format' });
        }
        
        const mimeType = matches[1].toLowerCase();
        const allowedTypes = ['jpeg', 'jpg', 'png', 'gif', 'webp'];
        if (!allowedTypes.includes(mimeType)) {
          return res.status(400).json({ error: 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.' });
        }
        
        const ext = mimeType === 'jpeg' ? 'jpg' : mimeType;
        const base64Data = matches[2];
        const buffer = Buffer.from(base64Data, 'base64');
        
        // Enforce file size limit (5MB)
        const maxSize = 5 * 1024 * 1024;
        if (buffer.length > maxSize) {
          return res.status(400).json({ error: 'File size exceeds 5MB limit' });
        }
        
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const newFileName = `seo-${imageType || 'image'}-${uniqueSuffix}.${ext}`;
        const filePath = path.join(uploadsDir, newFileName);
        
        fs.writeFileSync(filePath, buffer);
        
        const imageUrl = `/uploads/${newFileName}`;
        
        // Save to seo_settings based on image type
        if (imageType === 'ogImage' || field === 'seo_og_image') {
          await storage.updateSeoSettings({ defaultOgImage: imageUrl });
        }
        
        return res.json({ success: true, url: imageUrl, imageType });
      }
      
      return res.status(400).json({ error: 'No valid image data provided' });
    } catch (error) {
      console.error('Error uploading SEO image:', error);
      res.status(500).json({ error: 'Failed to upload SEO image' });
    }
  });
  
  // Also keep multipart form upload endpoint for backward compatibility
  router.post('/seo/upload-image-form', requireAdminPermission('settings', 'seo_settings', 'update'), upload.single('image'), async (req: AdminRequest, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      
      const imageUrl = `/uploads/${req.file.filename}`;
      const { field } = req.body;
      
      if (field === 'seo_og_image') {
        await storage.updateSeoSettings({ defaultOgImage: imageUrl });
      }
      
      res.json({ success: true, url: imageUrl });
    } catch (error) {
      console.error('Error uploading SEO image:', error);
      res.status(500).json({ error: 'Failed to upload SEO image' });
    }
  });

  router.get('/analytics-scripts', requireAdminPermission('settings', 'analytics_settings', 'read'), async (req: AdminRequest, res: Response) => {
    try {
      const scripts = await storage.getAllAnalyticsScripts();
      res.json(scripts);
    } catch (error) {
      console.error('Error fetching analytics scripts:', error);
      res.status(500).json({ error: 'Failed to fetch analytics scripts' });
    }
  });

  router.post('/analytics-scripts', requireAdminPermission('settings', 'analytics_settings', 'create'), async (req: AdminRequest, res: Response) => {
    try {
      const { name, type, code, headCode, bodyCode, placement, loadPriority, async: asyncLoad, defer, enabled, hideOnInternalPages, description } = req.body;
      
      // Accept either legacy 'code' field or the new headCode/bodyCode fields
      const hasCode = code && code.trim().length > 0;
      const hasHeadCode = headCode && headCode.trim().length > 0;
      const hasBodyCode = bodyCode && bodyCode.trim().length > 0;
      
      if (!name) {
        return res.status(400).json({ error: 'Name is required' });
      }
      if (!hasCode && !hasHeadCode && !hasBodyCode) {
        return res.status(400).json({ error: 'At least one of code, headCode, or bodyCode is required' });
      }
      
      // For backward compatibility, populate code from headCode/bodyCode if empty
      const effectiveCode = hasCode ? code : (hasHeadCode ? headCode : bodyCode);
      
      const newScript = await storage.createAnalyticsScript({
        name,
        type: type || 'custom',
        code: effectiveCode,
        headCode,
        bodyCode,
        placement: placement ? (Array.isArray(placement) ? placement : [placement]) : ['head'],
        loadPriority: loadPriority || 0,
        async: asyncLoad || false,
        defer: defer || false,
        enabled: enabled !== false,
        hideOnInternalPages: hideOnInternalPages || false,
        description
      });
      
      res.json(newScript);
    } catch (error) {
      console.error('Error creating analytics script:', error);
      res.status(500).json({ error: 'Failed to create analytics script' });
    }
  });

  router.patch('/analytics-scripts/:id', requireAdminPermission('settings', 'analytics_settings', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { 
        name, 
        type,
        code, 
        headCode,
        bodyCode,
        placement, 
        loadPriority,
        async: asyncLoad,
        defer,
        enabled,
        hideOnInternalPages,
        description
      } = req.body;
      
      const updateData: Record<string, any> = {};
      if (name !== undefined) updateData.name = name;
      if (type !== undefined) updateData.type = type;
      if (code !== undefined) updateData.code = code;
      if (headCode !== undefined) updateData.headCode = headCode;
      if (bodyCode !== undefined) updateData.bodyCode = bodyCode;
      if (placement !== undefined) updateData.placement = Array.isArray(placement) ? placement : [placement];
      if (loadPriority !== undefined) updateData.loadPriority = loadPriority;
      if (asyncLoad !== undefined) updateData.async = asyncLoad;
      if (defer !== undefined) updateData.defer = defer;
      if (enabled !== undefined) updateData.enabled = enabled;
      if (hideOnInternalPages !== undefined) updateData.hideOnInternalPages = hideOnInternalPages;
      if (description !== undefined) updateData.description = description;
      
      await storage.updateAnalyticsScript(id, updateData);
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error updating analytics script:', error);
      res.status(500).json({ error: 'Failed to update analytics script' });
    }
  });

  router.delete('/analytics-scripts/:id', requireAdminPermission('settings', 'analytics_settings', 'delete'), async (req: AdminRequest, res: Response) => {
    try {
      const { id } = req.params;
      await storage.deleteAnalyticsScript(id);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting analytics script:', error);
      res.status(500).json({ error: 'Failed to delete analytics script' });
    }
  });
}
