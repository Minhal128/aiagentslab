import { URL } from 'url';
import dns from 'dns';
import { promisify } from 'util';
import net from 'net';

const dnsLookup = promisify(dns.lookup);

const BLOCKED_HOSTNAMES = [
  'localhost',
  '127.0.0.1',
  '[::1]',
  '0.0.0.0',
  '169.254.169.254',
  'metadata.google.internal',
];

function isPrivateIP(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 0) return true;
  }
  if (net.isIPv6(ip)) {
    if (ip === '::1' || ip === '::' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')) {
      return true;
    }
  }
  return false;
}

export async function validateWebhookUrl(url: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const parsed = new URL(url);

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, error: 'Only HTTP and HTTPS URLs are allowed' };
    }

    const hostname = parsed.hostname.replace(/^\[|\]$/g, '');

    if (BLOCKED_HOSTNAMES.includes(hostname)) {
      return { valid: false, error: 'Webhook URL must not point to a local or internal address' };
    }

    if (net.isIP(hostname)) {
      if (isPrivateIP(hostname)) {
        return { valid: false, error: 'Webhook URL must not point to a private IP address' };
      }
    } else {
      try {
        const { address } = await dnsLookup(hostname);
        if (isPrivateIP(address)) {
          return { valid: false, error: 'Webhook URL resolves to a private IP address' };
        }
      } catch {
        return { valid: false, error: 'Could not resolve webhook URL hostname' };
      }
    }

    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}
