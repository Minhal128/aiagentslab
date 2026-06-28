import { db } from '../../../db';
import { emailTemplates } from '@shared/schema';
import { eq, or, ilike } from 'drizzle-orm';
import { emailService } from '../../../services/email-service';

function substituteVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\s*\w+\s*)\}\}/g, (_, key) => {
    const k = key.trim();
    return vars[k] ?? vars[k.toLowerCase()] ?? '';
  });
}

async function sendEmailByName(
  _userId: string,
  templateName: string,
  recipientEmail: string,
  variables: Record<string, string> = {},
  _meta?: { callId?: string; agentId?: string }
): Promise<{ success: boolean; error?: string }> {
  if (!recipientEmail || !templateName) {
    return { success: false, error: 'Missing recipient email or template name.' };
  }

  const [template] = await db
    .select()
    .from(emailTemplates)
    .where(
      or(
        eq(emailTemplates.templateType, templateName),
        ilike(emailTemplates.name, templateName)
      )
    )
    .limit(1);

  if (!template) {
    return { success: false, error: `Email template "${templateName}" not found.` };
  }

  if (!template.isActive) {
    return { success: false, error: `Email template "${templateName}" is disabled.` };
  }

  const subject = substituteVars(template.subject, variables);
  const htmlBody = substituteVars(template.htmlBody, variables);

  return emailService.sendEmail(recipientEmail, subject, htmlBody);
}

export const emailTemplateService = { sendEmailByName };

// Class form for callers that do `new EmailTemplateService()`
export class EmailTemplateService {
  sendEmailByName = sendEmailByName;
}
