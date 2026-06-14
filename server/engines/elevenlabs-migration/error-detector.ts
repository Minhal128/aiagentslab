/**
 * @fileoverview ElevenLabs Migration Engine - Error Detection
 * @copyright Diploy - 2024-2025. All rights reserved.
 * @license See LICENSE.md for license information
 * 
 * Detects concurrency limit errors from ElevenLabs API responses
 * to trigger automatic migration to available keys.
 */

import { ConcurrencyError } from './types';

const CONCURRENCY_ERROR_PATTERNS = [
  /concurrency/i,
  /concurrent.*limit/i,
  /rate.*limit/i,
  /too.*many.*requests/i,
  /capacity.*exceeded/i,
  /max.*connections/i,
  /connection.*limit/i,
  /resource.*exhausted/i,
  /quota.*exceeded/i,
  /limit.*reached/i,
  /maximum.*concurrent/i,
];

const CONCURRENCY_STATUS_CODES = [429, 503, 509];

/**
 * Detect if an error is a concurrency limit error from ElevenLabs
 * 
 * @param error - The error object or string to analyze
 * @returns ConcurrencyError object with detection result
 */
export function detectConcurrencyError(error: any): ConcurrencyError {
  const result: ConcurrencyError = {
    isConcurrencyError: false,
    message: '',
  };

  if (!error) {
    return result;
  }

  let errorMessage = '';
  let statusCode: number | undefined;
  let rawError = '';

  if (typeof error === 'string') {
    errorMessage = error;
    rawError = error;
  } else if (error instanceof Error) {
    errorMessage = error.message;
    rawError = error.message;
    
    if ('statusCode' in error) {
      statusCode = (error as any).statusCode;
    }
    if ('status' in error) {
      statusCode = (error as any).status;
    }
    if ('details' in error && typeof (error as any).details === 'object') {
      const details = (error as any).details;
      if (details.statusCode) statusCode = details.statusCode;
      if (details.responseBody) rawError = details.responseBody;
    }
  } else if (typeof error === 'object') {
    errorMessage = error.message || error.error || JSON.stringify(error);
    statusCode = error.statusCode || error.status;
    rawError = error.responseBody || JSON.stringify(error);
    
    if (error.detail) {
      if (typeof error.detail === 'string') {
        errorMessage = error.detail;
      } else if (error.detail.message) {
        errorMessage = error.detail.message;
      }
    }
  }

  if (statusCode && CONCURRENCY_STATUS_CODES.includes(statusCode)) {
    result.isConcurrencyError = true;
    result.message = `Rate limit or concurrency error (HTTP ${statusCode})`;
    result.statusCode = statusCode;
    result.rawError = rawError;
    return result;
  }

  for (const pattern of CONCURRENCY_ERROR_PATTERNS) {
    if (pattern.test(errorMessage) || pattern.test(rawError)) {
      result.isConcurrencyError = true;
      result.message = `Concurrency limit detected: ${errorMessage}`;
      result.statusCode = statusCode;
      result.rawError = rawError;
      return result;
    }
  }

  result.message = errorMessage;
  result.statusCode = statusCode;
  result.rawError = rawError;
  return result;
}

/**
 * Check if an error is recoverable through migration
 * Some errors (like invalid API key) are not recoverable
 * 
 * @param error - The error to check
 * @returns boolean indicating if migration could help
 */
export function isRecoverableError(error: any): boolean {
  const concurrencyResult = detectConcurrencyError(error);
  
  if (concurrencyResult.isConcurrencyError) {
    return true;
  }

  const unrecoverablePatterns = [
    /invalid.*api.*key/i,
    /unauthorized/i,
    /authentication.*failed/i,
    /forbidden/i,
    /not.*found/i,
    /invalid.*agent/i,
    /invalid.*phone/i,
    /validation.*error/i,
  ];

  const errorMessage = typeof error === 'string' 
    ? error 
    : error?.message || error?.error || '';

  for (const pattern of unrecoverablePatterns) {
    if (pattern.test(errorMessage)) {
      return false;
    }
  }

  const statusCode = error?.statusCode || error?.status;
  if (statusCode && [401, 403, 404, 422].includes(statusCode)) {
    return false;
  }

  return concurrencyResult.isConcurrencyError;
}

/**
 * Simple boolean check for concurrency limit errors
 * Convenience wrapper around detectConcurrencyError
 * 
 * @param error - The error to check
 * @returns boolean indicating if this is a concurrency error
 */
export function isConcurrencyLimitError(error: any): boolean {
  return detectConcurrencyError(error).isConcurrencyError;
}

/**
 * Format error for logging
 * 
 * @param error - The error to format
 * @returns Formatted error string
 */
export function formatErrorForLog(error: any): string {
  if (typeof error === 'string') {
    return error;
  }
  
  if (error instanceof Error) {
    const details = (error as any).details;
    if (details) {
      return `${error.message} | Details: ${JSON.stringify(details)}`;
    }
    return error.message;
  }
  
  if (typeof error === 'object') {
    return JSON.stringify(error, null, 2);
  }
  
  return String(error);
}
