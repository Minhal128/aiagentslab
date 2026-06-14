'use strict';
/**
 * Batch Processing Utilities
 * 
 * Provides chunked processing for large datasets to prevent memory issues
 * and ensure crash recovery. Used by campaign executor and contact upload.
 */

import { db } from '../db';
import { calls, flowExecutions, contacts } from '@shared/schema';
import type { InsertCall, InsertContact } from '@shared/schema';
import { nanoid } from 'nanoid';

const BATCH_SIZE = 500;
const LOG_INTERVAL = 1000;

/** Above this, omit `.returning()` on successful chunks to avoid holding 100k+ rows in memory. */
export const CONTACT_INSERT_RETAIN_RESULTS_THRESHOLD = 1_500;

export interface BatchInsertResult<T> {
  success: boolean;
  inserted: number;
  failed: number;
  results: T[];
  errors: string[];
}

export interface FlowExecutionInsert {
  callId: string;
  flowId: string;
  campaignId: string;
  campaignName: string;
  contactPhone: string;
  telephonyProvider: string;
}

/**
 * Split an array into chunks of specified size
 */
export function chunkArray<T>(array: T[], chunkSize: number = BATCH_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Batch insert call records with chunking and progress logging
 * Returns all successfully created records
 */
export async function batchInsertCalls(
  callInserts: InsertCall[],
  logPrefix: string = '[Batch Insert]'
): Promise<BatchInsertResult<typeof calls.$inferSelect>> {
  const result: BatchInsertResult<typeof calls.$inferSelect> = {
    success: true,
    inserted: 0,
    failed: 0,
    results: [],
    errors: [],
  };

  if (callInserts.length === 0) {
    return result;
  }

  const chunks = chunkArray(callInserts, BATCH_SIZE);
  const totalRecords = callInserts.length;
  let processedCount = 0;

  console.log(`${logPrefix} Starting batch insert of ${totalRecords} call records in ${chunks.length} chunks`);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    
    try {
      const inserted = await db.insert(calls).values(chunk).returning();
      result.results.push(...inserted);
      result.inserted += inserted.length;
      processedCount += chunk.length;

      if (processedCount % LOG_INTERVAL === 0 || i === chunks.length - 1) {
        console.log(`${logPrefix} Progress: ${processedCount}/${totalRecords} call records (${Math.round(processedCount / totalRecords * 100)}%)`);
      }
    } catch (error: any) {
      result.failed += chunk.length;
      result.errors.push(`Chunk ${i + 1}: ${error.message}`);
      console.error(`${logPrefix} ❌ Chunk ${i + 1} failed: ${error.message}`);
      
      for (const callInsert of chunk) {
        try {
          const [singleInsert] = await db.insert(calls).values(callInsert).returning();
          result.results.push(singleInsert);
          result.inserted++;
          result.failed--;
        } catch (singleError: any) {
          console.warn(`${logPrefix} ⚠️ Single insert failed for ${callInsert.phoneNumber}: ${singleError.message}`);
        }
      }
    }
  }

  result.success = result.failed === 0;
  console.log(`${logPrefix} ✅ Batch insert complete: ${result.inserted} success, ${result.failed} failed`);
  
  return result;
}

/**
 * Batch insert flow execution records with chunking
 */
export async function batchInsertFlowExecutions(
  executions: FlowExecutionInsert[],
  logPrefix: string = '[Batch Insert]'
): Promise<BatchInsertResult<typeof flowExecutions.$inferSelect>> {
  const result: BatchInsertResult<typeof flowExecutions.$inferSelect> = {
    success: true,
    inserted: 0,
    failed: 0,
    results: [],
    errors: [],
  };

  if (executions.length === 0) {
    return result;
  }

  const insertValues = executions.map(exec => ({
    id: nanoid(),
    callId: exec.callId,
    flowId: exec.flowId,
    currentNodeId: null,
    status: 'pending' as const,
    variables: {},
    pathTaken: [],
    metadata: {
      campaignId: exec.campaignId,
      campaignName: exec.campaignName,
      contactPhone: exec.contactPhone,
      nativeExecution: true,
      telephonyProvider: exec.telephonyProvider,
    },
  }));

  const chunks = chunkArray(insertValues, BATCH_SIZE);
  const totalRecords = insertValues.length;
  let processedCount = 0;

  console.log(`${logPrefix} Starting batch insert of ${totalRecords} flow execution records in ${chunks.length} chunks`);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    
    try {
      const inserted = await db.insert(flowExecutions).values(chunk).returning();
      result.results.push(...inserted);
      result.inserted += inserted.length;
      processedCount += chunk.length;

      if (processedCount % LOG_INTERVAL === 0 || i === chunks.length - 1) {
        console.log(`${logPrefix} Progress: ${processedCount}/${totalRecords} flow executions (${Math.round(processedCount / totalRecords * 100)}%)`);
      }
    } catch (error: any) {
      result.failed += chunk.length;
      result.errors.push(`Chunk ${i + 1}: ${error.message}`);
      console.error(`${logPrefix} ❌ Chunk ${i + 1} failed: ${error.message}`);
      
      for (const execInsert of chunk) {
        try {
          const [singleInsert] = await db.insert(flowExecutions).values(execInsert).returning();
          result.results.push(singleInsert);
          result.inserted++;
          result.failed--;
        } catch (singleError: any) {
          console.warn(`${logPrefix} ⚠️ Single insert failed: ${singleError.message}`);
        }
      }
    }
  }

  result.success = result.failed === 0;
  console.log(`${logPrefix} ✅ Batch insert complete: ${result.inserted} success, ${result.failed} failed`);
  
  return result;
}

export type BatchInsertContactsOptions = {
  /**
   * When false, successful multi-row inserts do not use `.returning()` and `results` stays empty.
   * Use for very large CSV uploads (50k+) to keep memory bounded.
   */
  retainResults?: boolean;
};

/**
 * Batch insert contacts with chunking and progress logging
 */
export async function batchInsertContacts(
  contactInserts: InsertContact[],
  logPrefix: string = '[Batch Insert]',
  options: BatchInsertContactsOptions = {}
): Promise<BatchInsertResult<typeof contacts.$inferSelect>> {
  const retainResults = options.retainResults !== false;

  const result: BatchInsertResult<typeof contacts.$inferSelect> = {
    success: true,
    inserted: 0,
    failed: 0,
    results: [],
    errors: [],
  };

  if (contactInserts.length === 0) {
    return result;
  }

  const chunks = chunkArray(contactInserts, BATCH_SIZE);
  const totalRecords = contactInserts.length;
  let processedCount = 0;

  console.log(`${logPrefix} Starting batch insert of ${totalRecords} contacts in ${chunks.length} chunks (retainResults=${retainResults})`);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    
    try {
      if (retainResults) {
        const inserted = await db.insert(contacts).values(chunk).returning();
        result.results.push(...inserted);
        result.inserted += inserted.length;
      } else {
        await db.insert(contacts).values(chunk);
        result.inserted += chunk.length;
      }
      processedCount += chunk.length;

      if (processedCount % LOG_INTERVAL === 0 || i === chunks.length - 1) {
        console.log(`${logPrefix} Progress: ${processedCount}/${totalRecords} contacts (${Math.round(processedCount / totalRecords * 100)}%)`);
      }
    } catch (error: any) {
      result.failed += chunk.length;
      result.errors.push(`Chunk ${i + 1}: ${error.message}`);
      console.error(`${logPrefix} ❌ Chunk ${i + 1} failed: ${error.message}`);
      
      for (const contactInsert of chunk) {
        try {
          if (retainResults) {
            const [singleInsert] = await db.insert(contacts).values(contactInsert).returning();
            result.results.push(singleInsert);
          } else {
            await db.insert(contacts).values(contactInsert);
          }
          result.inserted++;
          result.failed--;
        } catch (singleError: any) {
          console.warn(`${logPrefix} ⚠️ Single insert failed for ${contactInsert.phone}: ${singleError.message}`);
        }
      }
    }
  }

  result.success = result.failed === 0;
  console.log(`${logPrefix} ✅ Batch insert complete: ${result.inserted} success, ${result.failed} failed`);
  
  return result;
}

/**
 * Process items in chunks with a callback function
 * Useful for any chunked processing that doesn't fit the standard insert pattern
 */
export async function processInChunks<T, R>(
  items: T[],
  processor: (chunk: T[], chunkIndex: number) => Promise<R[]>,
  options: {
    chunkSize?: number;
    logPrefix?: string;
    logInterval?: number;
  } = {}
): Promise<{ results: R[]; processedCount: number; failedCount: number }> {
  const { 
    chunkSize = BATCH_SIZE, 
    logPrefix = '[Chunk Process]',
    logInterval = LOG_INTERVAL 
  } = options;

  const chunks = chunkArray(items, chunkSize);
  const results: R[] = [];
  let processedCount = 0;
  let failedCount = 0;

  console.log(`${logPrefix} Processing ${items.length} items in ${chunks.length} chunks`);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    
    try {
      const chunkResults = await processor(chunk, i);
      results.push(...chunkResults);
      processedCount += chunk.length;

      if (processedCount % logInterval === 0 || i === chunks.length - 1) {
        console.log(`${logPrefix} Progress: ${processedCount}/${items.length} (${Math.round(processedCount / items.length * 100)}%)`);
      }
    } catch (error: any) {
      failedCount += chunk.length;
      console.error(`${logPrefix} ❌ Chunk ${i + 1} failed: ${error.message}`);
    }
  }

  console.log(`${logPrefix} ✅ Complete: ${processedCount} processed, ${failedCount} failed`);
  
  return { results, processedCount, failedCount };
}
