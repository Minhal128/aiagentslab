/**
 * Contact Variable Substitution Utility
 * 
 * Provides helper functions to substitute contact variables ({{contact_name}}, {{contact_phone}}, etc.)
 * in agent messages and prompts.
 * 
 * Two main use cases:
 * 1. ElevenLabs Batch Calling: enrichDynamicDataWithContactInfo() adds contact fields to dynamic_data
 *    (ElevenLabs performs the substitution)
 * 2. OpenAI/Direct Calls: substituteContactVariables() performs substitution before API call
 */

export interface ContactInfo {
  firstName: string;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
  customFields?: Record<string, any> | null;
}

/**
 * Substitute contact variables in a text string
 * 
 * Replaces placeholders like {{contact_name}}, {{contact_phone}}, {{contact_email}}
 * with actual contact values. Also supports custom fields.
 * 
 * @param text - The text containing placeholders (e.g., "Hi {{contact_name}}")
 * @param contact - Contact information object
 * @returns Text with placeholders replaced
 * 
 * @example
 * substituteContactVariables("Hi {{contact_name}}, calling about {{custom_field}}", {
 *   firstName: "John",
 *   lastName: "Doe",
 *   customFields: { custom_field: "your order" }
 * });
 * // Returns: "Hi John Doe, calling about your order"
 */
export function substituteContactVariables(
  text: string | null | undefined,
  contact: ContactInfo
): string {
  if (!text) return '';
  
  let result = text;
  
  const fullName = contact.lastName 
    ? `${contact.firstName} ${contact.lastName}`.trim()
    : contact.firstName;
  
  // Double-brace format variables ({{contact_name}})
  const doubleBraceVars: Record<string, string> = {
    contact_name: fullName,
    contact_first_name: contact.firstName || '',
    contact_last_name: contact.lastName || '',
    contact_phone: contact.phone || '',
    contact_email: contact.email || '',
    name: fullName,
    first_name: contact.firstName || '',
    last_name: contact.lastName || '',
    phone: contact.phone || '',
    email: contact.email || '',
  };
  
  // Legacy single-brace format variables ({firstName})
  const singleBraceVars: Record<string, string> = {
    firstName: contact.firstName || '',
    lastName: contact.lastName || '',
    phone: contact.phone || '',
    email: contact.email || '',
    name: fullName,
  };
  
  // Add custom fields to both formats
  if (contact.customFields && typeof contact.customFields === 'object') {
    for (const [key, value] of Object.entries(contact.customFields)) {
      if (value !== null && value !== undefined) {
        const strValue = String(value);
        doubleBraceVars[key] = strValue;
        singleBraceVars[key] = strValue;
      }
    }
  }
  
  // Replace double-brace format: {{variable}}
  for (const [key, value] of Object.entries(doubleBraceVars)) {
    result = result.split(`{{${key}}}`).join(value);
  }
  
  // Replace single-brace format: {variable} (legacy)
  for (const [key, value] of Object.entries(singleBraceVars)) {
    result = result.split(`{${key}}`).join(value);
  }
  
  return result;
}

/**
 * Enrich dynamic_data object with contact information for ElevenLabs Batch API
 * 
 * ElevenLabs Batch Calling API uses dynamic_data for variable substitution.
 * This function adds standard contact fields to dynamic_data so that
 * {{contact_name}}, {{contact_phone}}, etc. work in agent prompts/messages.
 * 
 * @param contact - Contact information object
 * @param existingDynamicData - Existing dynamic_data from customFields (optional)
 * @returns Enriched dynamic_data object ready for ElevenLabs API
 * 
 * @example
 * enrichDynamicDataWithContactInfo({
 *   firstName: "John",
 *   lastName: "Doe",
 *   phone: "+1234567890"
 * }, { company: "Acme" });
 * // Returns: { contact_name: "John Doe", contact_phone: "+1234567890", ..., company: "Acme" }
 */
export function enrichDynamicDataWithContactInfo(
  contact: ContactInfo,
  existingDynamicData?: Record<string, string> | null
): Record<string, string> {
  // Check if firstName is empty or "Unknown" (default value when not provided)
  const hasValidFirstName = contact.firstName && contact.firstName !== 'Unknown' && contact.firstName.trim() !== '';
  
  // Check if custom field provides contact_name - this takes priority over derived name
  // Support multiple casing variants: contact_name, contactName, Contact_Name
  // Only use custom contact_name if it's non-empty after trimming
  const rawCustomContactName = existingDynamicData?.contact_name || existingDynamicData?.contactName || existingDynamicData?.Contact_Name;
  const customContactName = rawCustomContactName && String(rawCustomContactName).trim() !== '' 
    ? String(rawCustomContactName).trim() 
    : null;
  
  // Derive fullName from firstName/lastName
  const derivedFullName = hasValidFirstName
    ? (contact.lastName ? `${contact.firstName} ${contact.lastName}`.trim() : contact.firstName)
    : '';
  
  // Priority: non-empty custom contact_name > derived fullName
  const fullName = customContactName || derivedFullName;
  
  const enrichedData: Record<string, string> = {
    contact_name: fullName,
    contact_first_name: hasValidFirstName ? contact.firstName : '',
    contact_phone: contact.phone || '',
    name: fullName,
    first_name: hasValidFirstName ? contact.firstName : '',
    phone: contact.phone || '',
  };
  
  if (contact.lastName) {
    enrichedData.contact_last_name = contact.lastName;
    enrichedData.last_name = contact.lastName;
  }
  
  if (contact.email) {
    enrichedData.contact_email = contact.email;
    enrichedData.email = contact.email;
  }
  
  // Add all custom fields to dynamic_data
  if (existingDynamicData && typeof existingDynamicData === 'object') {
    for (const [key, value] of Object.entries(existingDynamicData)) {
      if (value !== null && value !== undefined) {
        const strValue = String(value);
        // Override if key doesn't exist OR if current value is empty
        if (!enrichedData[key] || enrichedData[key] === '') {
          enrichedData[key] = strValue;
        }
      }
    }
  }
  
  return enrichedData;
}

/**
 * Build contact info object from various sources
 * 
 * Helper to create ContactInfo from different data shapes
 */
export function buildContactInfo(data: {
  firstName?: string;
  first_name?: string;
  lastName?: string | null;
  last_name?: string | null;
  phone?: string | null;
  phoneNumber?: string | null;
  phone_number?: string | null;
  email?: string | null;
  customFields?: Record<string, any> | null;
  custom_fields?: Record<string, any> | null;
}): ContactInfo {
  return {
    firstName: data.firstName || data.first_name || '',
    lastName: data.lastName || data.last_name || null,
    phone: data.phone || data.phoneNumber || data.phone_number || null,
    email: data.email || null,
    customFields: data.customFields || data.custom_fields || null,
  };
}
