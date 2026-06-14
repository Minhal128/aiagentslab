'use strict';
import { Router, Response } from 'express';
import { storage } from '../../storage';
import { AdminRequest, requireAdminPermission } from '../../middleware/admin-auth';
import nodemailer from 'nodemailer';
import { emailService } from '../../services/email-service';

export function registerSmtpRoutes(router: Router) {
  router.get('/smtp', requireAdminPermission('communications', 'email_settings', 'read'), async (req: AdminRequest, res: Response) => {
    try {
      const smtpKeys = ['smtp_host', 'smtp_port', 'smtp_username', 'smtp_password', 'smtp_from_email', 'smtp_from_name', 'smtp_secure'];
      const smtpSettings: Record<string, any> = {};
      
      for (const key of smtpKeys) {
        const setting = await storage.getGlobalSetting(key);
        if (setting) {
          if (key === 'smtp_password') {
            // Return as smtp_password_set for frontend compatibility
            smtpSettings['smtp_password_set'] = setting.value ? true : false;
          } else {
            smtpSettings[key] = setting.value;
          }
        }
      }
      
      res.json(smtpSettings);
    } catch (error) {
      console.error('Error fetching SMTP settings:', error);
      res.status(500).json({ error: 'Failed to fetch SMTP settings' });
    }
  });

  router.patch('/smtp', requireAdminPermission('communications', 'email_settings', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const { smtp_host, smtp_port, smtp_username, smtp_password, smtp_from_email, smtp_from_name, smtp_secure } = req.body;
      
      if (smtp_host !== undefined) await storage.updateGlobalSetting('smtp_host', smtp_host);
      if (smtp_port !== undefined) await storage.updateGlobalSetting('smtp_port', smtp_port);
      if (smtp_username !== undefined) await storage.updateGlobalSetting('smtp_username', smtp_username);
      // Only update password if it's not the masked placeholder
      if (smtp_password !== undefined && smtp_password !== '********' && smtp_password !== '') {
        await storage.updateGlobalSetting('smtp_password', smtp_password);
      }
      if (smtp_from_email !== undefined) await storage.updateGlobalSetting('smtp_from_email', smtp_from_email);
      if (smtp_from_name !== undefined) await storage.updateGlobalSetting('smtp_from_name', smtp_from_name);
      if (smtp_secure !== undefined) await storage.updateGlobalSetting('smtp_secure', smtp_secure);
      
      // Reinitialize the email service with new settings so OTP and other emails work
      const reinitialized = await emailService.reinitializeFromDatabase();
      console.log(`📧 Email service reinitialized after SMTP settings update: ${reinitialized}`);
      
      res.json({ success: true, emailServiceReinitialized: reinitialized });
    } catch (error) {
      console.error('Error updating SMTP settings:', error);
      res.status(500).json({ error: 'Failed to update SMTP settings' });
    }
  });

  router.post('/smtp/test', requireAdminPermission('communications', 'email_settings', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const { testEmail } = req.body;
      
      if (!testEmail) {
        return res.status(400).json({ error: 'Test email address is required' });
      }
      
      const smtpHost = await storage.getGlobalSetting('smtp_host');
      const smtpPort = await storage.getGlobalSetting('smtp_port');
      const smtpUsername = await storage.getGlobalSetting('smtp_username');
      const smtpPassword = await storage.getGlobalSetting('smtp_password');
      const smtpFromEmail = await storage.getGlobalSetting('smtp_from_email');
      const smtpFromName = await storage.getGlobalSetting('smtp_from_name');
      const smtpSecure = await storage.getGlobalSetting('smtp_secure');
      
      if (!smtpHost?.value || !smtpPort?.value || !smtpUsername?.value || !smtpPassword?.value) {
        return res.status(400).json({ error: 'SMTP settings are not fully configured' });
      }
      
      const portNum = Number(smtpPort.value);
      const transporter = nodemailer.createTransport({
        host: smtpHost.value as string,
        port: portNum,
        secure: portNum === 465 || smtpSecure?.value === true || smtpSecure?.value === 'true',
        requireTLS: portNum === 587,
        auth: { user: smtpUsername.value as string, pass: smtpPassword.value as string },
        tls: {
          rejectUnauthorized: false,
        },
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 15000,
      });
      
      await transporter.sendMail({
        from: `"${smtpFromName?.value || 'Test'}" <${smtpFromEmail?.value || smtpUsername.value}>`,
        to: testEmail,
        subject: 'SMTP Test Email',
        text: 'This is a test email to verify your SMTP configuration.',
        html: '<p>This is a test email to verify your SMTP configuration.</p><p>If you received this email, your SMTP settings are working correctly.</p>'
      });
      
      await emailService.reinitializeFromDatabase();
      console.log('📧 Email service reinitialized after successful SMTP test');
      
      res.json({ success: true, message: 'Test email sent successfully' });
    } catch (error: any) {
      console.error('Error sending test email:', error);
      
      const errorCode = error.code || '';
      const errorMsg = error.message || '';
      let friendlyMessage = `Failed to send test email: ${errorMsg}`;
      
      if (errorCode === 'ETIMEDOUT') {
        friendlyMessage = 'Could not connect to SMTP server — the connection timed out. Please check the hostname and port are correct, and that the server is reachable from your network.';
      } else if (errorCode === 'ECONNREFUSED') {
        friendlyMessage = 'Connection refused by SMTP server. The server may be down, or the port may be incorrect. Common ports: 465 (SSL), 587 (STARTTLS), 25 (plain).';
      } else if (errorCode === 'EAUTH' || errorMsg.toLowerCase().includes('invalid login') || errorMsg.toLowerCase().includes('authentication')) {
        friendlyMessage = 'Authentication failed. Please check your SMTP username and password are correct.';
      } else if (errorCode === 'ESOCKET') {
        friendlyMessage = 'Network error connecting to SMTP server. Please check your server hostname and ensure there are no firewall restrictions.';
      } else if (errorCode === 'EAI_AGAIN' || errorCode === 'ENOTFOUND') {
        friendlyMessage = `SMTP server hostname could not be resolved. Please check the hostname "${error.hostname || 'unknown'}" is spelled correctly.`;
      } else if (errorMsg.includes('CERT_HAS_EXPIRED') || errorMsg.includes('certificate') || errorMsg.includes('SSL')) {
        friendlyMessage = 'SSL/TLS certificate error. The SMTP server\'s certificate may be expired or invalid.';
      } else if (errorMsg.includes('STARTTLS')) {
        friendlyMessage = 'The SMTP server requires a secure connection (STARTTLS) but failed to upgrade. Try using port 465 with SSL instead.';
      }
      
      res.status(500).json({ 
        error: friendlyMessage,
        details: errorMsg,
        code: errorCode
      });
    }
  });
}
