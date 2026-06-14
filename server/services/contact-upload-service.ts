'use strict';
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
import Papa from "papaparse";
import { storage } from "../storage";
import type { Contact, InsertContact } from "@shared/schema";
import { batchInsertContacts, CONTACT_INSERT_RETAIN_RESULTS_THRESHOLD } from "../utils/batch-utils";

/**
 * Represents a contact parsed from a CSV file before database insertion.
 * Contains all fields needed to create a contact record.
 */
export interface ParsedContact {
  campaignId: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  customFields: Record<string, any> | null;
  status: string;
}

/**
 * Error thrown when the contact count exceeds the plan limit.
 */
/** Result of bulk contact creation (CSV upload). */
export interface CreateContactsForCampaignResult {
  contacts: Contact[];
  inserted: number;
  failed: number;
  skippedInvalid: number;
  /** True when `contacts` is empty to save memory (large uploads). */
  resultsTruncated: boolean;
}

export class PlanLimitExceededError extends Error {
  public upgradeRequired: boolean;
  public currentContacts: number;
  public maxContacts: number;
  public allowedContacts: number;

  constructor(
    message: string,
    currentContacts: number,
    maxContacts: number,
    allowedContacts: number
  ) {
    super(message);
    this.name = "PlanLimitExceededError";
    this.upgradeRequired = true;
    this.currentContacts = currentContacts;
    this.maxContacts = maxContacts;
    this.allowedContacts = allowedContacts;
  }
}

/**
 * Standard field names that should not be treated as custom fields.
 * These are recognized column names for first name, last name, phone, and email.
 */
const STANDARD_FIELD_NAMES = [
  "firstName", "FirstName", "first_name",
  "lastName", "LastName", "last_name",
  "name", "Name",
  "contact_name", "contactName", "Contact_Name",
  "phone", "Phone", "phone_number",
  "email", "Email"
];

/**
 * Service responsible for handling CSV contact uploads.
 * Handles parsing, validation, and creation of contacts from uploaded CSV files.
 */
export class ContactUploadService {
  /**
   * Parses contacts from CSV file content.
   * Supports multiple CSV formats:
   * - Standard format with firstName/lastName columns
   * - Legacy format with single "name" column (splits into first/last)
   * - ElevenLabs format with "phone_number" and "dynamic_data.*" columns
   * 
   * @param fileContent - The raw CSV file content as a string
   * @param campaignId - The campaign ID to associate contacts with
   * @returns Array of parsed contacts ready for validation and creation
   * 
   * @example
   * ```typescript
   * const contacts = service.parseContactsFromCSV(csvContent, "campaign-123");
   * ```
   */
  parseContactsFromCSV(fileContent: string, campaignId: string): ParsedContact[] {
    const parsed = Papa.parse(fileContent, {
      header: true,
      skipEmptyLines: true,
    });

    if (parsed.errors?.length) {
      const sample = parsed.errors.slice(0, 5).map((e) => e.message).join("; ");
      console.warn(
        `[Contact Upload] CSV parse reported ${parsed.errors.length} issue(s). First: ${sample}`
      );
    }

    return (parsed.data as Record<string, unknown>[]).map((row) => {
      return this.parseContactRow(row as Record<string, any>, campaignId);
    });
  }

  /**
   * Parses a single CSV row into a ParsedContact object.
   * Handles field mapping and custom field extraction.
   * 
   * @param row - The CSV row data as a key-value object
   * @param campaignId - The campaign ID to associate the contact with
   * @returns A parsed contact object
   */
  private parseContactRow(row: Record<string, any>, campaignId: string): ParsedContact {
    // Handle both "firstName/lastName" format, legacy "name" format, and ElevenLabs format
    let firstName = row.firstName || row.FirstName || row.first_name || "";
    let lastName = row.lastName || row.LastName || row.last_name || "";
    
    // ElevenLabs format uses "name" as full name and "phone_number" for phone
    const rawPhone = String(row.phone || row.Phone || row.phone_number || "");
    // Expand scientific notation phone numbers from Excel numeric columns (e.g. "9.20E+11" → "920000000000")
    const sciNotationPattern = /^[+-]?\d+\.?\d*[eE][+\-]?\d+$/;
    const phone = sciNotationPattern.test(rawPhone.trim())
      ? Math.round(parseFloat(rawPhone)).toString()
      : rawPhone;
    const email = row.email || row.Email || null;
    
    // If firstName is empty but name or contact_name exists, split the name
    if (!firstName && (row.name || row.Name || row.contact_name || row.contactName || row.Contact_Name)) {
      const fullName = row.name || row.Name || row.contact_name || row.contactName || row.Contact_Name || "";
      const parts = fullName.trim().split(/\s+/);
      firstName = parts[0] || "";
      lastName = parts.slice(1).join(" ") || "";
    }
    
    // Extract custom fields
    const customFields = this.extractCustomFields(row);
    
    return {
      campaignId,
      firstName: firstName || "Unknown",
      lastName: lastName || "",
      phone: phone,
      email: email,
      customFields: Object.keys(customFields).length > 0 ? customFields : null,
      status: "pending",
    };
  }

  /**
   * Extracts custom fields from a CSV row.
   * Handles two types of custom fields:
   * - ElevenLabs dynamic_data format (columns starting with "dynamic_data.")
   * - Flat custom fields (any column that's not a standard field)
   * 
   * @param row - The CSV row data as a key-value object
   * @returns Object containing all custom field key-value pairs
   */
  private extractCustomFields(row: Record<string, any>): Record<string, any> {
    const customFields: Record<string, any> = {};
    
    for (const key of Object.keys(row)) {
      // Handle ElevenLabs dynamic_data format
      if (key.startsWith("dynamic_data.")) {
        const fieldName = key.replace("dynamic_data.", "");
        if (row[key] && row[key].trim() !== "") {
          customFields[fieldName] = row[key];
        }
      }
      // Handle flat custom fields (any column that's not standard)
      else if (!STANDARD_FIELD_NAMES.includes(key)) {
        if (row[key] && String(row[key]).trim() !== "") {
          customFields[key] = row[key];
        }
      }
    }
    
    return customFields;
  }

  /**
   * Validates that adding new contacts won't exceed the plan's contact limit.
   * Throws a PlanLimitExceededError if the limit would be exceeded.
   * 
   * @param contactsCount - Number of new contacts to add
   * @param existingCount - Current number of contacts in the campaign
   * @param planLimit - Maximum contacts allowed per campaign by the plan
   * @param planDisplayName - Display name of the plan for error messages
   * @throws {PlanLimitExceededError} When adding contacts would exceed the limit
   * 
   * @example
   * ```typescript
   * try {
   *   service.validateContactsAgainstPlanLimit(50, 100, 100, "Pro");
   * } catch (error) {
   *   if (error instanceof PlanLimitExceededError) {
   *     // Handle limit exceeded
   *   }
   * }
   * ```
   */
  validateContactsAgainstPlanLimit(
    contactsCount: number,
    existingCount: number,
    planLimit: number,
    planDisplayName: string
  ): void {
    const newTotalContacts = existingCount + contactsCount;
    
    if (newTotalContacts > planLimit) {
      const allowedContacts = Math.max(0, planLimit - existingCount);
      throw new PlanLimitExceededError(
        `Contact limit exceeded. Your ${planDisplayName} allows maximum ${planLimit} contacts per campaign. You can only add ${allowedContacts} more contact(s).`,
        existingCount,
        planLimit,
        allowedContacts
      );
    }
  }

  /** Minimum digits in a phone number after stripping non-digits (E.164-friendly). */
  private static isDialablePhone(phone: string): boolean {
    const digits = phone.replace(/\D/g, "");
    return digits.length >= 7 && digits.length <= 18;
  }

  /**
   * Creates contacts in the database for a campaign.
   * Also updates the campaign's total contact count.
   * 
   * @param campaignId - The campaign ID to create contacts for
   * @param contacts - Array of parsed contacts to create
   * @param currentTotalContacts - The campaign's current total contact count
   * @returns Promise resolving to the created contact records
   * 
   * @example
   * ```typescript
   * const createdContacts = await service.createContactsForCampaign(
   *   "campaign-123",
   *   parsedContacts,
   *   50
   * );
   * ```
   */
  async createContactsForCampaign(
    campaignId: string,
    contacts: ParsedContact[],
    currentTotalContacts: number
  ): Promise<CreateContactsForCampaignResult> {
    const skippedInvalid = contacts.filter(
      (c) => !ContactUploadService.isDialablePhone(String(c.phone || ""))
    ).length;

    const insertContacts: InsertContact[] = contacts
      .filter((c) => ContactUploadService.isDialablePhone(String(c.phone || "")))
      .map((contact) => ({
        campaignId: contact.campaignId,
        firstName: contact.firstName,
        lastName: contact.lastName,
        phone: contact.phone,
        email: contact.email,
        customFields: contact.customFields,
        status: contact.status,
      }));

    const retainResults = insertContacts.length <= CONTACT_INSERT_RETAIN_RESULTS_THRESHOLD;

    const batchResult = await batchInsertContacts(insertContacts, '📋 [Contact Upload]', {
      retainResults,
    });

    if (!batchResult.success) {
      console.warn(`[Contact Upload] ⚠️ Some contacts failed to insert: ${batchResult.failed} failed`);
    }

    await storage.updateCampaign(campaignId, {
      totalContacts: currentTotalContacts + batchResult.inserted,
    });

    return {
      contacts: batchResult.results,
      inserted: batchResult.inserted,
      failed: batchResult.failed,
      skippedInvalid,
      resultsTruncated: !retainResults,
    };
  }

  /**
   * Reads file content from a multer file upload.
   * Handles both buffer-based and path-based uploads.
   * 
   * @param file - The multer file object from the request
   * @returns Promise resolving to the file content as a string
   * @throws {Error} When the file upload is invalid
   */
  async readFileContent(file: Express.Multer.File): Promise<string> {
    if (file.buffer) {
      return file.buffer.toString("utf-8");
    } else if (file.path) {
      const fs = await import("fs");
      const content = fs.readFileSync(file.path, "utf-8");
      fs.unlinkSync(file.path);
      return content;
    } else {
      throw new Error("Invalid file upload");
    }
  }
}

export const contactUploadService = new ContactUploadService();
