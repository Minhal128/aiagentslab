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
 * ElevenLabs Batch Calling Service
 * 
 * Handles bulk outbound calling through ElevenLabs Batch Calling API.
 * Uses raw fetch API for consistency with the rest of the project.
 * 
 * API Documentation: https://elevenlabs.io/docs/api-reference/batch-calling
 */

import { ExternalServiceError } from '../utils/errors';
import { enrichDynamicDataWithContactInfo } from '../utils/contact-variable-substitution';
import FormData from 'form-data';

// ElevenLabs Batch Calling API base URL (global endpoint - batch calling not available on regional endpoints)
const ELEVENLABS_API_BASE_URL = "https://api.elevenlabs.io/v1";

// Batch Job Status from ElevenLabs API
export type BatchJobStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

// Recipient status from ElevenLabs API
export type RecipientStatus = 
  | 'pending' 
  | 'in_progress' 
  | 'completed' 
  | 'failed' 
  | 'no_response'
  | 'cancelled';

// Recipient for batch creation
export interface BatchRecipient {
  phone_number: string;
  name?: string;
  email?: string;
  dynamic_data?: Record<string, string>;
}

// Request to create a batch
export interface CreateBatchRequest {
  call_name: string;
  agent_id: string;
  recipients: BatchRecipient[];
  scheduled_time_unix?: number | null;
  agent_phone_number_id: string;
}

// Recipient in batch response (with status)
export interface BatchRecipientResponse {
  recipient_id: string;
  phone_number: string;
  name?: string;
  email?: string;
  dynamic_data?: Record<string, string>;
  status: RecipientStatus;
  conversation_id?: string;
  call_duration_secs?: number;
  error_message?: string;
}

// Batch job response from ElevenLabs API
export interface BatchJob {
  id: string;
  name: string;
  agent_id: string;
  created_at_unix: number;
  scheduled_time_unix: number;
  total_calls_dispatched: number;
  total_calls_scheduled: number;
  last_updated_at_unix: number;
  status: BatchJobStatus;
  agent_name: string;
  phone_number_id?: string | null;
  phone_provider?: 'twilio' | 'sip_trunk' | null;
}

// Detailed batch job with recipients
export interface BatchJobWithRecipients extends BatchJob {
  recipients: BatchRecipientResponse[];
}

// List response from ElevenLabs API
export interface ListBatchesResponse {
  batch_calls: BatchJob[];
  next_doc?: string | null;
  has_more?: boolean;
}

export class BatchCallingService {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Make a request to the ElevenLabs API
   */
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${ELEVENLABS_API_BASE_URL}${endpoint}`;
    
    console.log(`[BatchCalling] API Request: ${options.method || 'GET'} ${endpoint}`);
    
    const response = await fetch(url, {
      ...options,
      headers: {
        "xi-api-key": this.apiKey,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorDetail = errorText;
      
      // Try to parse JSON error for more details
      try {
        const errorJson = JSON.parse(errorText);
        errorDetail = errorJson.detail?.message || errorJson.detail || errorJson.message || errorText;
      } catch {
        // Keep original error text
      }
      
      console.error(`[BatchCalling] ❌ API Error: ${response.status} - ${errorDetail}`);
      throw new ExternalServiceError(
        'ElevenLabs',
        `ElevenLabs Batch API error: ${response.status} - ${errorDetail}`,
        undefined,
        { 
          operation: endpoint,
          statusCode: response.status,
          responseBody: errorText
        }
      );
    }

    return response.json();
  }

  /**
   * Create a batch calling job using JSON payload
   * 
   * POST /v1/convai/batch-calling/submit (application/json)
   * 
   * ElevenLabs batch calling API requires:
   * - call_name: Name for the batch job
   * - agent_id: The ElevenLabs agent ID
   * - agent_phone_number_id: The ElevenLabs phone number ID
   * - recipients: Array of { phone_number, conversation_initiation_client_data: { dynamic_variables } }
   * - scheduled_time_unix: Unix timestamp for scheduling
   * - timezone: Timezone string (e.g., "Asia/Kolkata")
   * - whatsapp_params: null for voice calls
   * 
   * Dynamic variables (contact_name, city, etc.) are nested in:
   * recipients[].conversation_initiation_client_data.dynamic_variables
   * 
   * @param request - The batch creation request
   * @returns The created batch job
   */
  async createBatch(request: CreateBatchRequest): Promise<BatchJob> {
    console.log(`[BatchCalling] Creating batch job: ${request.call_name} with ${request.recipients.length} recipients`);
    console.log(`   Agent ID: ${request.agent_id}`);
    console.log(`   Phone Number ID: ${request.agent_phone_number_id}`);
    
    if (!request.agent_phone_number_id) {
      throw new ExternalServiceError(
        'ElevenLabs',
        'agent_phone_number_id is required for batch calling',
        undefined,
        { operation: 'createBatch', field: 'agent_phone_number_id' }
      );
    }

    // Build recipients array with dynamic_data for variable substitution
    const recipients = request.recipients.map(r => {
      // All dynamic variables go into conversation_initiation_client_data.dynamic_variables
      // This is the correct structure per ElevenLabs batch calling API
      const dynamic_variables: Record<string, string> = {};
      
      // Add name if present
      if (r.name) {
        dynamic_variables.name = r.name;
        dynamic_variables.contact_name = r.name;
      }
      
      // Add email if present
      if (r.email) {
        dynamic_variables.email = r.email;
      }
      
      // Add all custom dynamic data fields
      if (r.dynamic_data && typeof r.dynamic_data === 'object') {
        for (const [key, value] of Object.entries(r.dynamic_data)) {
          if (value !== null && value !== undefined) {
            dynamic_variables[key] = typeof value === 'string' ? value : String(value);
          }
        }
      }
      
      return {
        phone_number: r.phone_number,
        conversation_initiation_client_data: {
          dynamic_variables,
        },
      };
    });

    // Build request payload with correct field names per ElevenLabs API
    const payload = {
      call_name: request.call_name,
      agent_id: request.agent_id,
      agent_phone_number_id: request.agent_phone_number_id,
      recipients,
      scheduled_time_unix: request.scheduled_time_unix || Math.floor(Date.now() / 1000) + 60, // Schedule for 1 min from now if not specified
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      whatsapp_params: null, // Not using WhatsApp
    };

    console.log(`[BatchCalling] Submitting batch via JSON...`);
    console.log(`   Call Name: ${payload.call_name}`);
    console.log(`   Agent ID: ${payload.agent_id}`);
    console.log(`   Phone Number ID: ${payload.agent_phone_number_id}`);
    console.log(`   Recipients: ${recipients.length}`);
    console.log(`   Scheduled Time Unix: ${payload.scheduled_time_unix}`);
    console.log(`   Timezone: ${payload.timezone}`);
    console.log(`   First recipient dynamic_variables:`, JSON.stringify(recipients[0]?.conversation_initiation_client_data?.dynamic_variables || {}, null, 2));

    // Submit via JSON API
    const url = `${ELEVENLABS_API_BASE_URL}/convai/batch-calling/submit`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorDetail = errorText;
      
      try {
        const errorJson = JSON.parse(errorText);
        errorDetail = errorJson.detail?.message || errorJson.detail || errorJson.message || errorText;
      } catch {
        // Keep original error text
      }
      
      console.error(`[BatchCalling] ❌ API Error: ${response.status} - ${errorDetail}`);
      throw new ExternalServiceError(
        'ElevenLabs',
        `ElevenLabs Batch API error: ${response.status} - ${errorDetail}`,
        undefined,
        { 
          operation: '/convai/batch-calling/submit',
          statusCode: response.status,
          responseBody: errorText
        }
      );
    }

    const responseData = await response.json();
    console.log(`[BatchCalling] API Response:`, JSON.stringify(responseData, null, 2));

    // Validate response has required batch ID
    const batchId = responseData.id || responseData.batch_call_id;
    if (!batchId) {
      console.error(`[BatchCalling] ❌ API returned no batch ID:`, responseData);
      throw new ExternalServiceError(
        'ElevenLabs',
        'ElevenLabs API returned empty batch ID - batch creation may have failed',
        undefined,
        { operation: '/convai/batch-calling/submit', response: responseData }
      );
    }

    const batch: BatchJob = {
      id: batchId,
      name: responseData.name || request.call_name,
      agent_id: responseData.agent_id || request.agent_id,
      created_at_unix: responseData.created_at_unix || Math.floor(Date.now() / 1000),
      scheduled_time_unix: responseData.scheduled_time_unix || 0,
      total_calls_dispatched: responseData.total_calls_dispatched || 0,
      total_calls_scheduled: responseData.total_calls_scheduled || request.recipients.length,
      last_updated_at_unix: responseData.last_updated_at_unix || Math.floor(Date.now() / 1000),
      status: (responseData.status as BatchJobStatus) || 'pending',
      agent_name: responseData.agent_name || '',
      phone_number_id: responseData.phone_number_id || request.agent_phone_number_id,
      phone_provider: responseData.phone_provider as 'twilio' | 'sip_trunk' | null,
    };

    console.log(`[BatchCalling] ✅ Created batch job: ${batch.id} (status: ${batch.status})`);
    return batch;
  }

  /**
   * List all batch calling jobs for the workspace
   * 
   * GET /v1/convai/batch-calling
   * 
   * @param limit - Maximum number of results (default: 100)
   * @param lastDoc - Pagination cursor
   * @returns List of batch jobs
   */
  async listBatches(limit: number = 100, lastDoc?: string): Promise<ListBatchesResponse> {
    let endpoint = `/convai/batch-calling?limit=${limit}`;
    if (lastDoc) {
      endpoint += `&last_doc=${encodeURIComponent(lastDoc)}`;
    }

    const response = await this.request<any>(endpoint);

    // Filter out entries with missing IDs and log warning
    const rawBatches = response.batch_calls || [];
    const validBatches = rawBatches.filter((b: any) => {
      if (!b.batch_call_id) {
        console.warn(`[BatchCalling] ⚠️ Skipping batch entry with missing ID`);
        return false;
      }
      return true;
    });

    const batchCalls: BatchJob[] = validBatches.map((b: any) => ({
      id: b.batch_call_id,
      name: b.name || '',
      agent_id: b.agent_id || '',
      created_at_unix: b.created_at_unix || 0,
      scheduled_time_unix: b.scheduled_time_unix || 0,
      total_calls_dispatched: b.total_calls_dispatched || 0,
      total_calls_scheduled: b.total_calls_scheduled || 0,
      last_updated_at_unix: b.last_updated_at_unix || 0,
      status: b.status || 'pending',
      agent_name: b.agent_name || '',
      phone_number_id: b.phone_number_id,
      phone_provider: b.phone_provider,
    }));

    return {
      batch_calls: batchCalls,
      next_doc: response.last_doc,
      has_more: response.has_more,
    };
  }

  /**
   * Get detailed information about a batch job including all recipients
   * 
   * GET /v1/convai/batch-calling/{batch_id}
   * 
   * @param batchId - The batch job ID
   * @returns Detailed batch job with recipient statuses
   */
  async getBatch(batchId: string): Promise<BatchJobWithRecipients> {
    console.log(`[BatchCalling] Getting batch details: ${batchId}`);
    
    const response = await this.request<any>(`/convai/batch-calling/${batchId}`);

    const recipients: BatchRecipientResponse[] = (response.recipients || []).map((r: any) => ({
      recipient_id: r.recipient_id || '',
      phone_number: r.phone_number || '',
      name: r.name,
      email: r.email,
      dynamic_data: r.dynamic_data,
      status: r.status || 'pending',
      conversation_id: r.conversation_id,
      call_duration_secs: r.call_duration_secs,
      error_message: r.error_message,
    }));

    const batch: BatchJobWithRecipients = {
      id: response.batch_call_id || batchId,
      name: response.name || '',
      agent_id: response.agent_id || '',
      created_at_unix: response.created_at_unix || 0,
      scheduled_time_unix: response.scheduled_time_unix || 0,
      total_calls_dispatched: response.total_calls_dispatched || 0,
      total_calls_scheduled: response.total_calls_scheduled || 0,
      last_updated_at_unix: response.last_updated_at_unix || 0,
      status: (response.status as BatchJobStatus) || 'pending',
      agent_name: response.agent_name || '',
      phone_number_id: response.phone_number_id,
      phone_provider: response.phone_provider as 'twilio' | 'sip_trunk' | null,
      recipients,
    };

    return batch;
  }

  /**
   * Cancel a running batch job
   * 
   * POST /v1/convai/batch-calling/{batch_id}/cancel
   * 
   * Sets all pending recipients to cancelled status.
   * 
   * @param batchId - The batch job ID to cancel
   * @returns The updated batch job
   */
  async cancelBatch(batchId: string): Promise<BatchJob> {
    console.log(`[BatchCalling] Cancelling batch job: ${batchId}`);
    
    const response = await this.request<any>(`/convai/batch-calling/${batchId}/cancel`, {
      method: 'POST',
    });

    const batch: BatchJob = {
      id: response.batch_call_id || batchId,
      name: response.name || '',
      agent_id: response.agent_id || '',
      created_at_unix: response.created_at_unix || 0,
      scheduled_time_unix: response.scheduled_time_unix || 0,
      total_calls_dispatched: response.total_calls_dispatched || 0,
      total_calls_scheduled: response.total_calls_scheduled || 0,
      last_updated_at_unix: response.last_updated_at_unix || 0,
      status: (response.status as BatchJobStatus) || 'cancelled',
      agent_name: response.agent_name || '',
      phone_number_id: response.phone_number_id,
      phone_provider: response.phone_provider as 'twilio' | 'sip_trunk' | null,
    };

    console.log(`[BatchCalling] Cancelled batch job: ${batchId} (new status: ${batch.status})`);
    return batch;
  }

  /**
   * Retry a batch job
   * 
   * POST /v1/convai/batch-calling/{batch_id}/retry
   * 
   * Retries failed and no-response recipients.
   * 
   * @param batchId - The batch job ID to retry
   * @returns The updated batch job
   */
  async retryBatch(batchId: string): Promise<BatchJob> {
    console.log(`[BatchCalling] Retrying batch job: ${batchId}`);
    
    const response = await this.request<any>(`/convai/batch-calling/${batchId}/retry`, {
      method: 'POST',
    });

    const batch: BatchJob = {
      id: response.batch_call_id || batchId,
      name: response.name || '',
      agent_id: response.agent_id || '',
      created_at_unix: response.created_at_unix || 0,
      scheduled_time_unix: response.scheduled_time_unix || 0,
      total_calls_dispatched: response.total_calls_dispatched || 0,
      total_calls_scheduled: response.total_calls_scheduled || 0,
      last_updated_at_unix: response.last_updated_at_unix || 0,
      status: (response.status as BatchJobStatus) || 'pending',
      agent_name: response.agent_name || '',
      phone_number_id: response.phone_number_id,
      phone_provider: response.phone_provider as 'twilio' | 'sip_trunk' | null,
    };

    console.log(`[BatchCalling] Retried batch job: ${batchId} (new status: ${batch.status})`);
    return batch;
  }

  /**
   * Helper: Normalize phone number to E.164 format
   * ElevenLabs batch API requires phone numbers with + prefix
   * 
   * @param phone - Raw phone number string
   * @returns Normalized E.164 phone number
   */
  static normalizePhoneNumber(phone: string): string {
    if (!phone) return phone;

    // Handle scientific notation from Excel exports (e.g. "9.20E+11" → "920000000000")
    // Excel stores large numbers like phone numbers in scientific notation when
    // the column is numeric instead of text.
    const sciNotationPattern = /^[+-]?\d+\.?\d*[eE][+\-]?\d+$/;
    if (sciNotationPattern.test(phone.trim())) {
      const expanded = Math.round(parseFloat(phone)).toString();
      console.log(`[BatchCalling] Scientific notation phone expanded: ${phone} → ${expanded}`);
      phone = expanded;
    }

    // Remove all non-digit characters except leading +
    let cleaned = phone.replace(/[^\d+]/g, '');
    
    // Remove any + that's not at the start
    if (cleaned.includes('+') && !cleaned.startsWith('+')) {
      cleaned = cleaned.replace(/\+/g, '');
    }
    
    // Extract just digits for validation
    const digitsOnly = cleaned.replace(/\+/g, '');
    
    // E.164 validation: should be 7-15 digits (international numbers)
    if (digitsOnly.length < 7) {
      console.warn(`[BatchCalling] Phone number too short for E.164: ${phone} → ${cleaned}`);
    } else if (digitsOnly.length > 15) {
      console.warn(`[BatchCalling] Phone number too long for E.164: ${phone} → ${cleaned}`);
    }
    
    // If already has + prefix, return as-is
    if (cleaned.startsWith('+')) {
      return cleaned;
    }
    
    // Add + prefix for E.164 format
    const normalized = `+${cleaned}`;
    console.log(`[BatchCalling] Normalized phone: ${phone} → ${normalized}`);
    return normalized;
  }

  /**
   * Helper: Convert contacts to ElevenLabs batch recipients format
   * 
   * @param contacts - Array of contact objects from database
   * @returns Array of batch recipients
   */
  static contactsToBatchRecipients(contacts: Array<{
    firstName: string;
    lastName?: string | null;
    phone: string;
    email?: string | null;
    customFields?: Record<string, any> | null;
  }>): BatchRecipient[] {
    return contacts.map(contact => {
      const recipient: BatchRecipient = {
        phone_number: BatchCallingService.normalizePhoneNumber(contact.phone),
        name: contact.lastName 
          ? `${contact.firstName} ${contact.lastName}` 
          : contact.firstName,
      };

      if (contact.email) {
        recipient.email = contact.email;
      }

      // Build dynamic_data with contact variables for ElevenLabs template substitution
      // This enables {{contact_name}}, {{contact_phone}}, etc. in agent prompts/messages
      const customFieldsData: Record<string, string> = {};
      if (contact.customFields && typeof contact.customFields === 'object') {
        for (const [key, value] of Object.entries(contact.customFields)) {
          if (value !== null && value !== undefined) {
            customFieldsData[key] = String(value);
          }
        }
      }
      
      // Enrich with contact info (contact_name, contact_phone, etc.)
      recipient.dynamic_data = enrichDynamicDataWithContactInfo(
        {
          firstName: contact.firstName,
          lastName: contact.lastName,
          phone: contact.phone,
          email: contact.email,
        },
        Object.keys(customFieldsData).length > 0 ? customFieldsData : null
      );

      // Debug: Log what enrichDynamicDataWithContactInfo returned
      console.log(`[BatchCalling] Contact enrichment for ${contact.phone}:`, {
        input: {
          firstName: contact.firstName,
          lastName: contact.lastName,
          customFieldsData: customFieldsData
        },
        output: {
          contact_name: recipient.dynamic_data?.contact_name,
          all_keys: Object.keys(recipient.dynamic_data || {})
        }
      });

      return recipient;
    });
  }

  /**
   * Helper: Get summary statistics from batch job
   */
  static getBatchStats(batch: BatchJobWithRecipients): {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    failed: number;
    noResponse: number;
    cancelled: number;
  } {
    const stats = {
      total: batch.recipients.length,
      pending: 0,
      inProgress: 0,
      completed: 0,
      failed: 0,
      noResponse: 0,
      cancelled: 0,
    };

    for (const recipient of batch.recipients) {
      switch (recipient.status) {
        case 'pending':
          stats.pending++;
          break;
        case 'in_progress':
          stats.inProgress++;
          break;
        case 'completed':
          stats.completed++;
          break;
        case 'failed':
          stats.failed++;
          break;
        case 'no_response':
          stats.noResponse++;
          break;
        case 'cancelled':
          stats.cancelled++;
          break;
      }
    }

    return stats;
  }
}
