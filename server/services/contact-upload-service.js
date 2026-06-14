import Papa from "papaparse";
import { storage } from "../storage.js";
import { batchInsertContacts } from "../utils/batch-utils.js";
class PlanLimitExceededError extends Error {
  upgradeRequired;
  currentContacts;
  maxContacts;
  allowedContacts;
  constructor(message, currentContacts, maxContacts, allowedContacts) {
    super(message);
    this.name = "PlanLimitExceededError";
    this.upgradeRequired = true;
    this.currentContacts = currentContacts;
    this.maxContacts = maxContacts;
    this.allowedContacts = allowedContacts;
  }
}
const STANDARD_FIELD_NAMES = [
  "firstName",
  "FirstName",
  "first_name",
  "lastName",
  "LastName",
  "last_name",
  "name",
  "Name",
  "contact_name",
  "contactName",
  "Contact_Name",
  "phone",
  "Phone",
  "phone_number",
  "email",
  "Email"
];
class ContactUploadService {
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
  parseContactsFromCSV(fileContent, campaignId) {
    const parsed = Papa.parse(fileContent, {
      header: true,
      skipEmptyLines: true
    });
    return parsed.data.map((row) => {
      return this.parseContactRow(row, campaignId);
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
  parseContactRow(row, campaignId) {
    let firstName = row.firstName || row.FirstName || row.first_name || "";
    let lastName = row.lastName || row.LastName || row.last_name || "";
    const phone = row.phone || row.Phone || row.phone_number || "";
    const email = row.email || row.Email || null;
    if (!firstName && (row.name || row.Name || row.contact_name || row.contactName || row.Contact_Name)) {
      const fullName = row.name || row.Name || row.contact_name || row.contactName || row.Contact_Name || "";
      const parts = fullName.trim().split(/\s+/);
      firstName = parts[0] || "";
      lastName = parts.slice(1).join(" ") || "";
    }
    const customFields = this.extractCustomFields(row);
    return {
      campaignId,
      firstName: firstName || "Unknown",
      lastName: lastName || "",
      phone,
      email,
      customFields: Object.keys(customFields).length > 0 ? customFields : null,
      status: "pending"
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
  extractCustomFields(row) {
    const customFields = {};
    for (const key of Object.keys(row)) {
      if (key.startsWith("dynamic_data.")) {
        const fieldName = key.replace("dynamic_data.", "");
        if (row[key] && row[key].trim() !== "") {
          customFields[fieldName] = row[key];
        }
      } else if (!STANDARD_FIELD_NAMES.includes(key)) {
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
  validateContactsAgainstPlanLimit(contactsCount, existingCount, planLimit, planDisplayName) {
    const newTotalContacts = existingCount + contactsCount;
    if (newTotalContacts > planLimit) {
      const allowedContacts = planLimit - existingCount;
      throw new PlanLimitExceededError(
        `Contact limit exceeded. Your ${planDisplayName} allows maximum ${planLimit} contacts per campaign. You can only add ${allowedContacts} more contact(s).`,
        existingCount,
        planLimit,
        allowedContacts
      );
    }
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
  async createContactsForCampaign(campaignId, contacts, currentTotalContacts) {
    const insertContacts = contacts.map((contact) => ({
      campaignId: contact.campaignId,
      firstName: contact.firstName,
      lastName: contact.lastName,
      phone: contact.phone,
      email: contact.email,
      customFields: contact.customFields,
      status: contact.status
    }));
    const batchResult = await batchInsertContacts(insertContacts, "\u{1F4CB} [Contact Upload]");
    if (!batchResult.success) {
      console.warn(`[Contact Upload] \u26A0\uFE0F Some contacts failed to insert: ${batchResult.failed} failed`);
    }
    await storage.updateCampaign(campaignId, {
      totalContacts: currentTotalContacts + batchResult.inserted
    });
    return batchResult.results;
  }
  /**
   * Reads file content from a multer file upload.
   * Handles both buffer-based and path-based uploads.
   * 
   * @param file - The multer file object from the request
   * @returns Promise resolving to the file content as a string
   * @throws {Error} When the file upload is invalid
   */
  async readFileContent(file) {
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
const contactUploadService = new ContactUploadService();
export {
  ContactUploadService,
  PlanLimitExceededError,
  contactUploadService
};
