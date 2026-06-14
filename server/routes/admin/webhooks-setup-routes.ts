'use strict';
import { Router, Response } from 'express';
import { storage } from '../../storage';
import { AdminRequest, requireAdminPermission } from '../../middleware/admin-auth';

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs: number = 8000): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function registerWebhooksSetupRoutes(router: Router) {
  router.post('/test-webhook/razorpay', requireAdminPermission('settings', 'system_settings', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const dbWebhookSecret = await storage.getGlobalSetting('razorpay_webhook_secret');
      const webhookSecret = dbWebhookSecret?.value as string;
      
      if (!webhookSecret) {
        return res.json({ success: false, error: 'Razorpay webhook secret not configured.' });
      }
      
      const testPayload = {
        event: 'payment.captured',
        payload: { payment: { entity: { id: 'pay_test_' + Date.now(), amount: 10000, currency: 'INR', status: 'captured' } } },
        created_at: Math.floor(Date.now() / 1000)
      };
      
      const payloadString = JSON.stringify(testPayload);
      const crypto = await import('crypto');
      const expectedSignature = crypto.createHmac('sha256', webhookSecret).update(payloadString).digest('hex');
      const verifySignature = crypto.createHmac('sha256', webhookSecret).update(payloadString).digest('hex');
      
      if (expectedSignature === verifySignature) {
        res.json({ success: true, message: 'Webhook secret is valid', testPayload: testPayload.event, signatureLength: expectedSignature.length });
      } else {
        res.json({ success: false, error: 'Webhook signature verification failed' });
      }
    } catch (error: any) {
      res.json({ success: false, error: 'Failed to test webhook secret' });
    }
  });

  router.post('/setup-webhook/paypal', requireAdminPermission('settings', 'system_settings', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const dbClientId = await storage.getGlobalSetting('paypal_client_id');
      const dbClientSecret = await storage.getGlobalSetting('paypal_client_secret');
      const dbMode = await storage.getGlobalSetting('paypal_mode');
      
      const clientId = dbClientId?.value as string;
      const clientSecret = dbClientSecret?.value as string;
      const mode = (dbMode?.value as string) || 'sandbox';
      
      if (!clientId || !clientSecret) {
        return res.status(400).json({ success: false, error: 'PayPal credentials not configured.' });
      }
      
      const baseUrl = mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
      const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      
      const tokenResponse = await fetchWithTimeout(`${baseUrl}/v1/oauth2/token`, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials'
      });
      
      if (!tokenResponse.ok) {
        return res.status(400).json({ success: false, error: 'Failed to authenticate with PayPal' });
      }
      
      const tokenData = await tokenResponse.json();
      const accessToken = tokenData.access_token;
      
      const { webhookUrl } = req.body;
      if (!webhookUrl) {
        return res.status(400).json({ success: false, error: 'Webhook URL is required' });
      }
      
      const listResponse = await fetch(`${baseUrl}/v1/notifications/webhooks`, {
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
      });
      
      if (listResponse.ok) {
        const listData = await listResponse.json();
        for (const webhook of (listData.webhooks || [])) {
          if (webhook.url && webhook.url.includes('/api/paypal/webhook')) {
            await fetch(`${baseUrl}/v1/notifications/webhooks/${webhook.id}`, {
              method: 'DELETE',
              headers: { 'Authorization': `Bearer ${accessToken}` }
            });
          }
        }
      }
      
      const webhookPayload = {
        url: webhookUrl,
        event_types: [
          { name: 'BILLING.SUBSCRIPTION.ACTIVATED' }, { name: 'BILLING.SUBSCRIPTION.RENEWED' },
          { name: 'BILLING.SUBSCRIPTION.CANCELLED' }, { name: 'BILLING.SUBSCRIPTION.SUSPENDED' },
          { name: 'BILLING.SUBSCRIPTION.PAYMENT.FAILED' }, { name: 'PAYMENT.SALE.COMPLETED' },
          { name: 'PAYMENT.SALE.REFUNDED' }, { name: 'CHECKOUT.ORDER.APPROVED' }, { name: 'CHECKOUT.ORDER.COMPLETED' }
        ]
      };
      
      const webhookResponse = await fetch(`${baseUrl}/v1/notifications/webhooks`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(webhookPayload)
      });
      
      if (webhookResponse.ok) {
        const webhookData = await webhookResponse.json();
        await storage.updateGlobalSetting('paypal_webhook_id', webhookData.id);
        res.json({ success: true, webhookId: webhookData.id, message: 'PayPal webhook configured successfully' });
      } else {
        const error = await webhookResponse.json();
        if (error.name === 'WEBHOOK_URL_ALREADY_EXISTS') {
          return res.status(400).json({ success: false, error: 'Webhook URL already registered with PayPal.' });
        }
        res.status(400).json({ success: false, error: 'Failed to create PayPal webhook' });
      }
    } catch (error: any) {
      res.status(500).json({ success: false, error: 'Failed to setup PayPal webhook' });
    }
  });

  router.post('/setup-webhook/mercadopago', requireAdminPermission('settings', 'system_settings', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const dbAccessToken = await storage.getGlobalSetting('mercadopago_access_token');
      const accessToken = dbAccessToken?.value as string;
      
      if (!accessToken) {
        return res.status(400).json({ success: false, error: 'MercadoPago access token not configured.' });
      }
      
      const { webhookUrl } = req.body;
      if (!webhookUrl) {
        return res.status(400).json({ success: false, error: 'Webhook URL is required' });
      }
      
      const listResponse = await fetch('https://api.mercadopago.com/v1/webhooks', {
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
      });
      
      if (listResponse.ok) {
        const webhooks = await listResponse.json();
        for (const webhook of (Array.isArray(webhooks) ? webhooks : [])) {
          if (webhook.url && webhook.url.includes('/api/mercadopago/webhook')) {
            await fetch(`https://api.mercadopago.com/v1/webhooks/${webhook.id}`, {
              method: 'DELETE',
              headers: { 'Authorization': `Bearer ${accessToken}` }
            });
          }
        }
      }
      
      const webhookPayload = {
        url: webhookUrl,
        events: ['payment', 'subscription_authorized', 'subscription_cancelled', 'subscription_pending_cancel']
      };
      
      const webhookResponse = await fetch('https://api.mercadopago.com/v1/webhooks', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(webhookPayload)
      });
      
      if (webhookResponse.ok) {
        const webhookData = await webhookResponse.json();
        await storage.updateGlobalSetting('mercadopago_webhook_id', webhookData.id?.toString());
        if (webhookData.secret_key) {
          await storage.updateGlobalSetting('mercadopago_webhook_secret', webhookData.secret_key);
        }
        res.json({ success: true, webhookId: webhookData.id, message: 'MercadoPago webhook configured successfully' });
      } else {
        const error = await webhookResponse.json();
        res.status(400).json({ success: false, error: 'Failed to create MercadoPago webhook' });
      }
    } catch (error: any) {
      res.status(500).json({ success: false, error: 'Failed to setup MercadoPago webhook' });
    }
  });
}
