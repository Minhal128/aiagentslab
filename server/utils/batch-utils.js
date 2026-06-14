import { db } from "../db.js";
import { calls, flowExecutions, contacts } from "../../shared/schema.js";
import { nanoid } from "nanoid";
const BATCH_SIZE = 500;
const LOG_INTERVAL = 1e3;
function chunkArray(array, chunkSize = BATCH_SIZE) {
  const chunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}
async function batchInsertCalls(callInserts, logPrefix = "[Batch Insert]") {
  const result = {
    success: true,
    inserted: 0,
    failed: 0,
    results: [],
    errors: []
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
    } catch (error) {
      result.failed += chunk.length;
      result.errors.push(`Chunk ${i + 1}: ${error.message}`);
      console.error(`${logPrefix} \u274C Chunk ${i + 1} failed: ${error.message}`);
      for (const callInsert of chunk) {
        try {
          const [singleInsert] = await db.insert(calls).values(callInsert).returning();
          result.results.push(singleInsert);
          result.inserted++;
          result.failed--;
        } catch (singleError) {
          console.warn(`${logPrefix} \u26A0\uFE0F Single insert failed for ${callInsert.phoneNumber}: ${singleError.message}`);
        }
      }
    }
  }
  result.success = result.failed === 0;
  console.log(`${logPrefix} \u2705 Batch insert complete: ${result.inserted} success, ${result.failed} failed`);
  return result;
}
async function batchInsertFlowExecutions(executions, logPrefix = "[Batch Insert]") {
  const result = {
    success: true,
    inserted: 0,
    failed: 0,
    results: [],
    errors: []
  };
  if (executions.length === 0) {
    return result;
  }
  const insertValues = executions.map((exec) => ({
    id: nanoid(),
    callId: exec.callId,
    flowId: exec.flowId,
    currentNodeId: null,
    status: "pending",
    variables: {},
    pathTaken: [],
    metadata: {
      campaignId: exec.campaignId,
      campaignName: exec.campaignName,
      contactPhone: exec.contactPhone,
      nativeExecution: true,
      telephonyProvider: exec.telephonyProvider
    }
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
    } catch (error) {
      result.failed += chunk.length;
      result.errors.push(`Chunk ${i + 1}: ${error.message}`);
      console.error(`${logPrefix} \u274C Chunk ${i + 1} failed: ${error.message}`);
      for (const execInsert of chunk) {
        try {
          const [singleInsert] = await db.insert(flowExecutions).values(execInsert).returning();
          result.results.push(singleInsert);
          result.inserted++;
          result.failed--;
        } catch (singleError) {
          console.warn(`${logPrefix} \u26A0\uFE0F Single insert failed: ${singleError.message}`);
        }
      }
    }
  }
  result.success = result.failed === 0;
  console.log(`${logPrefix} \u2705 Batch insert complete: ${result.inserted} success, ${result.failed} failed`);
  return result;
}
async function batchInsertContacts(contactInserts, logPrefix = "[Batch Insert]") {
  const result = {
    success: true,
    inserted: 0,
    failed: 0,
    results: [],
    errors: []
  };
  if (contactInserts.length === 0) {
    return result;
  }
  const chunks = chunkArray(contactInserts, BATCH_SIZE);
  const totalRecords = contactInserts.length;
  let processedCount = 0;
  console.log(`${logPrefix} Starting batch insert of ${totalRecords} contacts in ${chunks.length} chunks`);
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    try {
      const inserted = await db.insert(contacts).values(chunk).returning();
      result.results.push(...inserted);
      result.inserted += inserted.length;
      processedCount += chunk.length;
      if (processedCount % LOG_INTERVAL === 0 || i === chunks.length - 1) {
        console.log(`${logPrefix} Progress: ${processedCount}/${totalRecords} contacts (${Math.round(processedCount / totalRecords * 100)}%)`);
      }
    } catch (error) {
      result.failed += chunk.length;
      result.errors.push(`Chunk ${i + 1}: ${error.message}`);
      console.error(`${logPrefix} \u274C Chunk ${i + 1} failed: ${error.message}`);
      for (const contactInsert of chunk) {
        try {
          const [singleInsert] = await db.insert(contacts).values(contactInsert).returning();
          result.results.push(singleInsert);
          result.inserted++;
          result.failed--;
        } catch (singleError) {
          console.warn(`${logPrefix} \u26A0\uFE0F Single insert failed for ${contactInsert.phone}: ${singleError.message}`);
        }
      }
    }
  }
  result.success = result.failed === 0;
  console.log(`${logPrefix} \u2705 Batch insert complete: ${result.inserted} success, ${result.failed} failed`);
  return result;
}
async function processInChunks(items, processor, options = {}) {
  const {
    chunkSize = BATCH_SIZE,
    logPrefix = "[Chunk Process]",
    logInterval = LOG_INTERVAL
  } = options;
  const chunks = chunkArray(items, chunkSize);
  const results = [];
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
    } catch (error) {
      failedCount += chunk.length;
      console.error(`${logPrefix} \u274C Chunk ${i + 1} failed: ${error.message}`);
    }
  }
  console.log(`${logPrefix} \u2705 Complete: ${processedCount} processed, ${failedCount} failed`);
  return { results, processedCount, failedCount };
}
export {
  batchInsertCalls,
  batchInsertContacts,
  batchInsertFlowExecutions,
  chunkArray,
  processInChunks
};
