'use strict';
import { Router, Response } from 'express';
import { storage } from '../../storage';
import { AdminRequest, requireAdminPermission } from '../../middleware/admin-auth';
import { db } from '../../db';
import { eq } from 'drizzle-orm';
import { openaiCredentials } from '@shared/schema';
import { ElevenLabsPoolService } from '../../services/elevenlabs-pool';

async function safeParseResponse(response: globalThis.Response): Promise<{ data: any; isJson: boolean; rawText?: string }> {
  const text = await response.text();
  try {
    const data = JSON.parse(text);
    return { data, isJson: true };
  } catch {
    return { data: null, isJson: false, rawText: text };
  }
}

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

export function registerConnectionsRoutes(router: Router) {
  router.post('/test-connection/twilio', requireAdminPermission('settings', 'system_settings', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const dbSid = await storage.getGlobalSetting('twilio_account_sid');
      const dbToken = await storage.getGlobalSetting('twilio_auth_token');
      
      const accountSid = (dbSid?.value as string) || process.env.TWILIO_ACCOUNT_SID;
      const authToken = (dbToken?.value as string) || process.env.TWILIO_AUTH_TOKEN;
      
      if (!accountSid || !authToken) {
        return res.json({ connected: false, error: 'Twilio credentials not configured' });
      }
      
      const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
      const response = await fetchWithTimeout(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`, {
        headers: { 'Authorization': `Basic ${auth}` }
      });
      
      const { data, isJson, rawText } = await safeParseResponse(response);
      
      if (response.ok && isJson && data) {
        res.json({ connected: true, accountName: data.friendly_name, accountStatus: data.status });
      } else {
        res.json({ connected: false, error: `Twilio API error: ${response.status} ${response.statusText}`, details: isJson ? JSON.stringify(data) : (rawText?.substring(0, 200) || 'Unknown error') });
      }
    } catch (error: any) {
      const isTimeout = error.name === 'AbortError';
      res.json({ connected: false, error: isTimeout ? 'Connection timed out. Twilio API may be unreachable.' : (error.message || 'Failed to test Twilio connection') });
    }
  });

  router.post('/test-connection/elevenlabs', requireAdminPermission('settings', 'system_settings', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const poolStats = await ElevenLabsPoolService.getPoolStats();
      const envApiKey = process.env.ELEVENLABS_API_KEY;
      
      if (poolStats.totalKeys > 0) {
        try {
          const credential = await ElevenLabsPoolService.getAvailableCredential();
          if (credential) {
            const voicesResponse = await fetchWithTimeout('https://api.elevenlabs.io/v2/voices?page_size=10', { headers: { 'xi-api-key': credential.apiKey } });
            const agentsResponse = await fetchWithTimeout('https://api.elevenlabs.io/v1/convai/agents', { headers: { 'xi-api-key': credential.apiKey } });
            
            const voicesParsed = await safeParseResponse(voicesResponse);
            const agentsParsed = await safeParseResponse(agentsResponse);
            
            if (voicesResponse.ok && agentsResponse.ok && voicesParsed.isJson && agentsParsed.isJson) {
              const healthyCount = poolStats.credentials.filter(c => c.healthStatus === 'healthy').length;
              return res.json({ 
                connected: true,
                voiceCount: voicesParsed.data?.total_count || voicesParsed.data?.voices?.length || 0,
                agentCount: agentsParsed.data?.agents?.length || 0,
                source: `Pool (${poolStats.totalKeys} keys, ${healthyCount} healthy)`,
                apiVersion: 'v2 (voices) + v1 (agents)'
              });
            }
          }
        } catch (poolError: any) {
          console.error('Pool key test failed, trying env var:', poolError);
        }
      }
      
      if (!envApiKey) {
        return res.json({ connected: false, error: 'ElevenLabs API key not configured (no env var or pool keys)' });
      }
      
      const voicesResponse = await fetchWithTimeout('https://api.elevenlabs.io/v2/voices?page_size=10', { headers: { 'xi-api-key': envApiKey } });
      const agentsResponse = await fetchWithTimeout('https://api.elevenlabs.io/v1/convai/agents', { headers: { 'xi-api-key': envApiKey } });
      
      const voicesParsed = await safeParseResponse(voicesResponse);
      const agentsParsed = await safeParseResponse(agentsResponse);
      
      if (voicesResponse.ok && agentsResponse.ok && voicesParsed.isJson && agentsParsed.isJson) {
        res.json({ 
          connected: true,
          voiceCount: voicesParsed.data?.total_count || voicesParsed.data?.voices?.length || 0,
          agentCount: agentsParsed.data?.agents?.length || 0,
          source: 'Environment variable',
          apiVersion: 'v2 (voices) + v1 (agents)'
        });
      } else {
        res.json({ connected: false, error: !voicesResponse.ok ? `ElevenLabs v2 voices API error: ${voicesResponse.status}` : `ElevenLabs v1 agents API error: ${agentsResponse.status}` });
      }
    } catch (error: any) {
      const isTimeout = error.name === 'AbortError';
      res.json({ connected: false, error: isTimeout ? 'Connection timed out.' : (error.message || 'Failed to test ElevenLabs connection') });
    }
  });

  router.post('/test-connection/openai', requireAdminPermission('settings', 'system_settings', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const dbApiKey = await storage.getGlobalSetting('openai_api_key');
      const apiKey = (dbApiKey?.value as string) || process.env.OPENAI_API_KEY;
      
      if (!apiKey) {
        return res.json({ connected: false, error: 'OpenAI API key not configured' });
      }
      
      const response = await fetchWithTimeout('https://api.openai.com/v1/models', { headers: { 'Authorization': `Bearer ${apiKey}` } });
      const { data, isJson, rawText } = await safeParseResponse(response);
      
      if (response.ok && isJson && data) {
        res.json({ 
          connected: true,
          modelCount: data.data?.length || 0,
          hasEmbeddings: data.data?.some((m: any) => m.id.includes('embedding')) || false,
          source: dbApiKey?.value ? 'Database' : 'Environment variable'
        });
      } else {
        res.json({ connected: false, error: `OpenAI API error: ${response.status} ${response.statusText}` });
      }
    } catch (error: any) {
      const isTimeout = error.name === 'AbortError';
      res.json({ connected: false, error: isTimeout ? 'Connection timed out.' : (error.message || 'Failed to test OpenAI connection') });
    }
  });

  router.post('/test-connection/openai-realtime', requireAdminPermission('settings', 'system_settings', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const credentials = await db.select().from(openaiCredentials).where(eq(openaiCredentials.isActive, true));
      
      if (!credentials || credentials.length === 0) {
        return res.json({ connected: false, error: 'No OpenAI Realtime credentials configured', keyCount: 0 });
      }
      
      const firstCredential = credentials[0];
      const modelsResponse = await fetchWithTimeout('https://api.openai.com/v1/models', { headers: { 'Authorization': `Bearer ${firstCredential.apiKey}` } });
      
      if (!modelsResponse.ok) {
        const { data, isJson, rawText } = await safeParseResponse(modelsResponse);
        return res.json({ connected: false, error: `OpenAI API error: ${modelsResponse.status}`, keyCount: credentials.length, details: isJson ? JSON.stringify(data) : rawText?.substring(0, 200) });
      }
      
      const modelsData = await modelsResponse.json();
      const hasRealtimeModels = modelsData.data?.some((m: any) => m.id.includes('realtime')) || false;
      
      let realtimeSessionsWorking = false;
      let realtimeError = '';
      
      try {
        const realtimeResponse = await fetchWithTimeout('https://api.openai.com/v1/realtime/client_secrets', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${firstCredential.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session: {
              type: 'realtime',
              model: 'gpt-realtime-mini'
            }
          })
        });
        
        if (realtimeResponse.ok) {
          realtimeSessionsWorking = true;
        } else {
          const errorText = await realtimeResponse.text();
          try {
            const parsed = JSON.parse(errorText);
            realtimeError = parsed.error?.message || `HTTP ${realtimeResponse.status}`;
          } catch {
            realtimeError = `HTTP ${realtimeResponse.status}: ${errorText.substring(0, 100)}`;
          }
        }
      } catch (e: any) {
        realtimeError = e.message || 'Failed to test realtime endpoint';
      }
      
      res.json({ 
        connected: realtimeSessionsWorking,
        keyCount: credentials.length,
        freeKeys: credentials.filter(c => c.modelTier === 'free').length,
        proKeys: credentials.filter(c => c.modelTier === 'pro').length,
        hasRealtimeModels,
        realtimeSessionsWorking,
        realtimeError: realtimeError || undefined,
        source: 'Credential Pool'
      });
    } catch (error: any) {
      const isTimeout = error.name === 'AbortError';
      res.json({ connected: false, error: isTimeout ? 'Connection timed out.' : (error.message || 'Failed to test OpenAI Realtime connection') });
    }
  });

  router.post('/test-connection/stripe', requireAdminPermission('settings', 'system_settings', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const dbSecretKey = await storage.getGlobalSetting('stripe_secret_key');
      const secretKey = (dbSecretKey?.value as string) || process.env.STRIPE_SECRET_KEY;
      
      if (!secretKey) {
        return res.json({ connected: false, error: 'Stripe secret key not configured' });
      }
      
      const response = await fetchWithTimeout('https://api.stripe.com/v1/balance', { headers: { 'Authorization': `Bearer ${secretKey}` } });
      const { data, isJson, rawText } = await safeParseResponse(response);
      
      if (response.ok && isJson && data) {
        res.json({ 
          connected: true,
          mode: !secretKey.includes('_test_') ? 'live' : 'test',
          currency: (data.available?.[0]?.currency || 'usd').toUpperCase(),
          availableBalance: ((data.available?.[0]?.amount || 0) / 100).toFixed(2),
          source: dbSecretKey?.value ? 'Database' : 'Environment variable'
        });
      } else {
        res.json({ connected: false, error: `Stripe API error: ${isJson && data?.error?.message ? data.error.message : response.statusText}` });
      }
    } catch (error: any) {
      const isTimeout = error.name === 'AbortError';
      res.json({ connected: false, error: isTimeout ? 'Connection timed out.' : (error.message || 'Failed to test Stripe connection') });
    }
  });

  router.post('/test-connection/paypal', requireAdminPermission('settings', 'system_settings', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const dbClientId = await storage.getGlobalSetting('paypal_client_id');
      const dbClientSecret = await storage.getGlobalSetting('paypal_client_secret');
      const dbMode = await storage.getGlobalSetting('paypal_mode');
      
      const clientId = dbClientId?.value as string;
      const clientSecret = dbClientSecret?.value as string;
      const mode = (dbMode?.value as string) || 'sandbox';
      
      if (!clientId || !clientSecret) {
        return res.json({ connected: false, error: 'PayPal credentials not configured' });
      }
      
      const baseUrl = mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
      const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      
      const tokenResponse = await fetchWithTimeout(`${baseUrl}/v1/oauth2/token`, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials'
      });
      
      const { data: tokenData, isJson, rawText } = await safeParseResponse(tokenResponse);
      
      if (tokenResponse.ok && isJson && tokenData) {
        res.json({ connected: true, mode, tokenType: tokenData.token_type, source: 'Database' });
      } else {
        res.json({ connected: false, error: `PayPal API error (${mode} mode): ${isJson ? (tokenData?.error_description || tokenData?.error) : tokenResponse.statusText}` });
      }
    } catch (error: any) {
      const isTimeout = error.name === 'AbortError';
      res.json({ connected: false, error: isTimeout ? 'Connection timed out.' : `Connection failed: ${error.message}` });
    }
  });

  router.post('/test-connection/paystack', requireAdminPermission('settings', 'system_settings', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const dbSecretKey = await storage.getGlobalSetting('paystack_secret_key');
      const secretKey = dbSecretKey?.value as string;
      
      if (!secretKey) {
        return res.json({ connected: false, error: 'Paystack secret key not configured' });
      }
      
      const response = await fetchWithTimeout('https://api.paystack.co/balance', { headers: { 'Authorization': `Bearer ${secretKey}` } });
      const { data, isJson, rawText } = await safeParseResponse(response);
      
      if (response.ok && isJson && data) {
        const balance = data.data?.[0];
        res.json({ connected: true, currency: balance?.currency || 'NGN', balance: balance?.balance ? (balance.balance / 100).toFixed(2) : '0.00', source: 'Database' });
      } else {
        res.json({ connected: false, error: `Paystack API error: ${isJson && data?.message ? data.message : response.statusText}` });
      }
    } catch (error: any) {
      const isTimeout = error.name === 'AbortError';
      res.json({ connected: false, error: isTimeout ? 'Connection timed out.' : (error.message || 'Failed to test Paystack connection') });
    }
  });

  router.post('/test-connection/mercadopago', requireAdminPermission('settings', 'system_settings', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const dbAccessToken = await storage.getGlobalSetting('mercadopago_access_token');
      const accessToken = dbAccessToken?.value as string;
      
      if (!accessToken) {
        return res.json({ connected: false, error: 'MercadoPago access token not configured' });
      }
      
      const response = await fetchWithTimeout('https://api.mercadopago.com/users/me', { headers: { 'Authorization': `Bearer ${accessToken}` } });
      const { data, isJson, rawText } = await safeParseResponse(response);
      
      if (response.ok && isJson && data) {
        res.json({ connected: true, countryId: data.country_id, email: data.email, source: 'Database' });
      } else {
        res.json({ connected: false, error: `MercadoPago API error: ${isJson && data?.message ? data.message : response.statusText}` });
      }
    } catch (error: any) {
      const isTimeout = error.name === 'AbortError';
      res.json({ connected: false, error: isTimeout ? 'Connection timed out.' : (error.message || 'Failed to test MercadoPago connection') });
    }
  });

  router.post('/test-connection/razorpay', requireAdminPermission('settings', 'system_settings', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const dbKeyId = await storage.getGlobalSetting('razorpay_key_id');
      const dbKeySecret = await storage.getGlobalSetting('razorpay_key_secret');
      
      const keyId = (dbKeyId?.value as string) || process.env.RAZORPAY_KEY_ID;
      const keySecret = (dbKeySecret?.value as string) || process.env.RAZORPAY_KEY_SECRET;
      
      if (!keyId || !keySecret) {
        return res.json({ connected: false, error: 'Razorpay credentials not configured' });
      }
      
      const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
      const response = await fetchWithTimeout('https://api.razorpay.com/v1/payments?count=1', { headers: { 'Authorization': `Basic ${auth}` } });
      
      if (response.ok) {
        res.json({ connected: true, mode: !keyId.includes('test') ? 'live' : 'test', source: dbKeyId?.value ? 'Database' : 'Environment variable' });
      } else {
        const { data, isJson, rawText } = await safeParseResponse(response);
        res.json({ connected: false, error: `Razorpay API error: ${isJson && data?.error?.description ? data.error.description : response.statusText}` });
      }
    } catch (error: any) {
      const isTimeout = error.name === 'AbortError';
      res.json({ connected: false, error: isTimeout ? 'Connection timed out.' : (error.message || 'Failed to test Razorpay connection') });
    }
  });

  router.post('/validate-credentials/razorpay', requireAdminPermission('settings', 'system_settings', 'update'), async (req: AdminRequest, res: Response) => {
    try {
      const { key_id, key_secret } = req.body;

      const dbKeyId = await storage.getGlobalSetting('razorpay_key_id');
      const dbKeySecret = await storage.getGlobalSetting('razorpay_key_secret');

      const finalKeyId = (key_id && key_id.trim()) || (dbKeyId?.value as string) || process.env.RAZORPAY_KEY_ID;
      const finalKeySecret = (key_secret && key_secret.trim()) || (dbKeySecret?.value as string) || process.env.RAZORPAY_KEY_SECRET;

      if (!finalKeyId || !finalKeySecret) {
        return res.json({ valid: false, error: 'Razorpay Key ID and Key Secret are required' });
      }

      const auth = Buffer.from(`${finalKeyId}:${finalKeySecret}`).toString('base64');
      const response = await fetchWithTimeout('https://api.razorpay.com/v1/payments?count=1', { headers: { 'Authorization': `Basic ${auth}` } });

      if (response.ok) {
        res.json({ valid: true, mode: !finalKeyId.includes('test') ? 'live' : 'test' });
      } else {
        const { data, isJson } = await safeParseResponse(response);
        res.json({ valid: false, error: `Razorpay API error: ${isJson && data?.error?.description ? data.error.description : response.statusText}` });
      }
    } catch (error: any) {
      const isTimeout = error.name === 'AbortError';
      res.json({ valid: false, error: isTimeout ? 'Connection timed out.' : (error.message || 'Failed to validate Razorpay credentials') });
    }
  });
}
