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
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: uploadStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/x-icon'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images are allowed.'));
    }
  }
});

export function registerBrandingRoutes(router: Router) {
  router.get('/branding', async (req: AdminRequest, res: Response) => {
    try {
      const brandingKeys = [
        'app_name', 'app_tagline', 'admin_email', 'app_location',
        'logo_url', 'logo_url_light', 'logo_url_dark', 'favicon_url', 
        'social_twitter_url', 'social_linkedin_url', 'social_github_url',
        'theme_primary', 'theme_primary_foreground', 'theme_accent', 'theme_background', 'theme_sidebar',
        'theme_website_accent', 'theme_website_foreground',
        'branding_updated_at'
      ];
      const branding: Record<string, any> = {};
      
      for (const key of brandingKeys) {
        const setting = await storage.getGlobalSetting(key);
        if (setting) {
          branding[key] = setting.value;
        }
      }
      
      res.json(branding);
    } catch (error) {
      console.error('Error fetching branding:', error);
      res.status(500).json({ error: 'Failed to fetch branding' });
    }
  });

  router.patch('/branding', requireAdminPermission('settings', 'edit_settings', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const { 
        app_name, app_tagline, admin_email, app_location,
        logo_url, logo_url_light, logo_url_dark, favicon_url,
        social_twitter_url, social_linkedin_url, social_github_url,
        theme_primary, theme_primary_foreground, theme_accent, theme_background, theme_sidebar,
        theme_website_accent, theme_website_foreground
      } = req.body;
      
      if (app_name !== undefined) await storage.updateGlobalSetting('app_name', app_name);
      if (app_tagline !== undefined) await storage.updateGlobalSetting('app_tagline', app_tagline);
      if (admin_email !== undefined) await storage.updateGlobalSetting('admin_email', admin_email);
      if (app_location !== undefined) await storage.updateGlobalSetting('app_location', app_location);
      if (logo_url !== undefined) await storage.updateGlobalSetting('logo_url', logo_url);
      if (logo_url_light !== undefined) await storage.updateGlobalSetting('logo_url_light', logo_url_light);
      if (logo_url_dark !== undefined) await storage.updateGlobalSetting('logo_url_dark', logo_url_dark);
      if (favicon_url !== undefined) await storage.updateGlobalSetting('favicon_url', favicon_url);
      if (social_twitter_url !== undefined) await storage.updateGlobalSetting('social_twitter_url', social_twitter_url);
      if (social_linkedin_url !== undefined) await storage.updateGlobalSetting('social_linkedin_url', social_linkedin_url);
      if (social_github_url !== undefined) await storage.updateGlobalSetting('social_github_url', social_github_url);
      if (theme_primary !== undefined) await storage.updateGlobalSetting('theme_primary', theme_primary);
      if (theme_primary_foreground !== undefined) await storage.updateGlobalSetting('theme_primary_foreground', theme_primary_foreground);
      if (theme_accent !== undefined) await storage.updateGlobalSetting('theme_accent', theme_accent);
      if (theme_background !== undefined) await storage.updateGlobalSetting('theme_background', theme_background);
      if (theme_sidebar !== undefined) await storage.updateGlobalSetting('theme_sidebar', theme_sidebar);
      if (theme_website_accent !== undefined) await storage.updateGlobalSetting('theme_website_accent', theme_website_accent);
      if (theme_website_foreground !== undefined) await storage.updateGlobalSetting('theme_website_foreground', theme_website_foreground);
      
      await storage.updateGlobalSetting('branding_updated_at', new Date().toISOString());
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error updating branding:', error);
      res.status(500).json({ error: 'Failed to update branding' });
    }
  });

  router.post('/branding/upload-logo', requireAdminPermission('settings', 'edit_settings', 'update'), upload.single('logo'), async (req: AdminRequest, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      
      const logoUrl = `/uploads/${req.file.filename}`;
      await storage.updateGlobalSetting('logo_url', logoUrl);
      await storage.updateGlobalSetting('branding_updated_at', new Date().toISOString());
      
      res.json({ success: true, url: logoUrl, logo_url: logoUrl });
    } catch (error) {
      console.error('Error uploading logo:', error);
      res.status(500).json({ error: 'Failed to upload logo' });
    }
  });

  router.post('/branding/upload-logo-light', requireAdminPermission('settings', 'edit_settings', 'update'), upload.single('logo'), async (req: AdminRequest, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      
      const logoUrl = `/uploads/${req.file.filename}`;
      await storage.updateGlobalSetting('logo_url_light', logoUrl);
      await storage.updateGlobalSetting('branding_updated_at', new Date().toISOString());
      
      res.json({ success: true, url: logoUrl, logo_url_light: logoUrl });
    } catch (error) {
      console.error('Error uploading light logo:', error);
      res.status(500).json({ error: 'Failed to upload light logo' });
    }
  });

  router.post('/branding/upload-logo-dark', requireAdminPermission('settings', 'edit_settings', 'update'), upload.single('logo'), async (req: AdminRequest, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      
      const logoUrl = `/uploads/${req.file.filename}`;
      await storage.updateGlobalSetting('logo_url_dark', logoUrl);
      await storage.updateGlobalSetting('branding_updated_at', new Date().toISOString());
      
      res.json({ success: true, url: logoUrl, logo_url_dark: logoUrl });
    } catch (error) {
      console.error('Error uploading dark logo:', error);
      res.status(500).json({ error: 'Failed to upload dark logo' });
    }
  });

  router.post('/branding/upload-favicon', requireAdminPermission('settings', 'edit_settings', 'update'), upload.single('favicon'), async (req: AdminRequest, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      
      const faviconUrl = `/uploads/${req.file.filename}`;
      await storage.updateGlobalSetting('favicon_url', faviconUrl);
      await storage.updateGlobalSetting('branding_updated_at', new Date().toISOString());
      
      res.json({ success: true, url: faviconUrl, favicon_url: faviconUrl });
    } catch (error) {
      console.error('Error uploading favicon:', error);
      res.status(500).json({ error: 'Failed to upload favicon' });
    }
  });

  router.delete('/branding/logo', requireAdminPermission('settings', 'edit_settings', 'delete'), async (req: AdminRequest, res: Response) => {
    try {
      await storage.updateGlobalSetting('logo_url', '');
      await storage.updateGlobalSetting('branding_updated_at', new Date().toISOString());
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting logo:', error);
      res.status(500).json({ error: 'Failed to delete logo' });
    }
  });

  router.delete('/branding/logo-light', requireAdminPermission('settings', 'edit_settings', 'delete'), async (req: AdminRequest, res: Response) => {
    try {
      await storage.updateGlobalSetting('logo_url_light', '');
      await storage.updateGlobalSetting('branding_updated_at', new Date().toISOString());
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting light logo:', error);
      res.status(500).json({ error: 'Failed to delete light logo' });
    }
  });

  router.delete('/branding/logo-dark', requireAdminPermission('settings', 'edit_settings', 'delete'), async (req: AdminRequest, res: Response) => {
    try {
      await storage.updateGlobalSetting('logo_url_dark', '');
      await storage.updateGlobalSetting('branding_updated_at', new Date().toISOString());
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting dark logo:', error);
      res.status(500).json({ error: 'Failed to delete dark logo' });
    }
  });

  router.delete('/branding/favicon', requireAdminPermission('settings', 'edit_settings', 'delete'), async (req: AdminRequest, res: Response) => {
    try {
      await storage.updateGlobalSetting('favicon_url', '');
      await storage.updateGlobalSetting('branding_updated_at', new Date().toISOString());
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting favicon:', error);
      res.status(500).json({ error: 'Failed to delete favicon' });
    }
  });
}
