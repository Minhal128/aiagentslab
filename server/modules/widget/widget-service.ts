import { widgetStorage } from "./widget-storage";
import { nanoid } from "nanoid";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import type { WebsiteWidget, InsertWebsiteWidget } from "@shared/schema";

export interface BusinessHoursCheck {
  isOpen: boolean;
  reason?: string;
}

export class WidgetService {

  generateEmbedToken(): string {
    return `wgt_${nanoid(24)}`;
  }

  async createWidget(userId: string, data: Omit<InsertWebsiteWidget, 'userId' | 'embedToken'>): Promise<WebsiteWidget> {
    const embedToken = this.generateEmbedToken();
    return widgetStorage.createWidget({
      ...data,
      userId,
      embedToken,
    });
  }

  async getWidgetsByUser(userId: string): Promise<WebsiteWidget[]> {
    return widgetStorage.getWidgetsByUserId(userId);
  }

  async getWidgetById(id: string, userId?: string): Promise<WebsiteWidget | null> {
    const widget = await widgetStorage.getWidgetById(id);
    if (!widget) return null;
    if (userId && widget.userId !== userId) return null;
    return widget;
  }

  async getWidgetByToken(embedToken: string): Promise<WebsiteWidget | null> {
    return widgetStorage.getWidgetByEmbedToken(embedToken);
  }

  async updateWidget(id: string, userId: string, data: Partial<InsertWebsiteWidget>): Promise<WebsiteWidget | null> {
    return widgetStorage.updateWidget(id, userId, data);
  }

  async deleteWidget(id: string, userId: string): Promise<boolean> {
    return widgetStorage.deleteWidget(id, userId);
  }

  async regenerateEmbedToken(id: string, userId: string): Promise<WebsiteWidget | null> {
    const newToken = this.generateEmbedToken();
    return widgetStorage.updateWidget(id, userId, { embedToken: newToken });
  }

  validateDomain(widget: WebsiteWidget, requestDomain: string): boolean {
    if (!widget.allowedDomains || widget.allowedDomains.length === 0) {
      return true;
    }
    const normalizedDomain = requestDomain.toLowerCase().replace(/^www\./, '');
    return widget.allowedDomains.some(allowed => {
      const normalizedAllowed = allowed.toLowerCase().replace(/^www\./, '');
      if (normalizedAllowed.startsWith('*.')) {
        const baseDomain = normalizedAllowed.slice(2);
        return normalizedDomain === baseDomain || normalizedDomain.endsWith('.' + baseDomain);
      }
      return normalizedDomain === normalizedAllowed;
    });
  }

  checkBusinessHours(widget: WebsiteWidget): BusinessHoursCheck {
    if (!widget.businessHoursEnabled) {
      return { isOpen: true };
    }

    const timezone = widget.businessTimezone || 'America/New_York';
    const now = new Date();
    
    let localTime: Date;
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'long',
        hour12: false,
      });
      const parts = formatter.formatToParts(now);
      const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
      const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
      const dayName = parts.find(p => p.type === 'weekday')?.value?.toLowerCase() || '';
      
      const currentMinutes = hour * 60 + minute;
      
      const businessDays = widget.businessDays || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
      if (!businessDays.includes(dayName)) {
        return { isOpen: false, reason: 'Outside business days' };
      }
      
      const startTime = widget.businessHoursStart || '09:00';
      const endTime = widget.businessHoursEnd || '17:00';
      
      const [startHour, startMin] = startTime.split(':').map(Number);
      const [endHour, endMin] = endTime.split(':').map(Number);
      
      const startMinutes = startHour * 60 + startMin;
      const endMinutes = endHour * 60 + endMin;
      
      if (currentMinutes >= startMinutes && currentMinutes < endMinutes) {
        return { isOpen: true };
      }
      
      return { isOpen: false, reason: 'Outside business hours' };
    } catch (e) {
      console.error('Error checking business hours:', e);
      return { isOpen: true };
    }
  }

  async cleanupStaleSessions(widgetId: string): Promise<number> {
    const widget = await widgetStorage.getWidgetById(widgetId);
    if (!widget) return 0;
    
    const maxDurationMinutes = widget.maxCallDuration ? Math.ceil(widget.maxCallDuration / 60) : 30;
    const staleThresholdMs = (maxDurationMinutes + 5) * 60 * 1000;
    const cutoffTime = new Date(Date.now() - staleThresholdMs);
    
    const result = await db.execute(sql`
      UPDATE widget_call_sessions 
      SET status = 'completed', 
          ended_at = NOW()
      WHERE widget_id = ${widgetId}
        AND status IN ('active', 'pending', 'connecting')
        AND created_at < ${cutoffTime}
      RETURNING id
    `);
    
    const cleaned = result.rows?.length || 0;
    if (cleaned > 0) {
      console.log(`[Widget] Cleaned up ${cleaned} stale session(s) for widget ${widgetId} (older than ${maxDurationMinutes + 5} min)`);
    }
    return cleaned;
  }

  async checkConcurrentCallLimit(widgetId: string): Promise<{ allowed: boolean; currentCount: number; maxCount: number }> {
    const widget = await widgetStorage.getWidgetById(widgetId);
    if (!widget) {
      return { allowed: false, currentCount: 0, maxCount: 0 };
    }
    
    await this.cleanupStaleSessions(widgetId);
    
    const currentCount = await widgetStorage.getActiveSessionCount(widgetId);
    const maxCount = widget.maxConcurrentCalls;
    
    return {
      allowed: currentCount < maxCount,
      currentCount,
      maxCount,
    };
  }

  async checkCooldown(widgetId: string, visitorIp: string): Promise<{ allowed: boolean; remainingSeconds: number }> {
    const widget = await widgetStorage.getWidgetById(widgetId);
    if (!widget) {
      return { allowed: false, remainingSeconds: 0 };
    }
    
    // If cooldown is 0 or not set, no cooldown applies
    const cooldownMinutes = widget.cooldownMinutes || 0;
    if (cooldownMinutes <= 0) {
      return { allowed: true, remainingSeconds: 0 };
    }
    
    // Check last session from this IP
    const lastSession = await widgetStorage.getLastSessionByIp(widgetId, visitorIp);
    if (!lastSession || !lastSession.createdAt) {
      return { allowed: true, remainingSeconds: 0 };
    }
    
    const cooldownMs = cooldownMinutes * 60 * 1000;
    const lastSessionTime = new Date(lastSession.createdAt).getTime();
    const now = Date.now();
    const elapsed = now - lastSessionTime;
    
    if (elapsed >= cooldownMs) {
      return { allowed: true, remainingSeconds: 0 };
    }
    
    const remainingSeconds = Math.ceil((cooldownMs - elapsed) / 1000);
    return { allowed: false, remainingSeconds };
  }

  async checkUserCredits(userId: string, minCredits: number = 1): Promise<{ hasCredits: boolean; credits: number }> {
    const credits = await widgetStorage.getUserCredits(userId);
    return {
      hasCredits: credits >= minCredits,
      credits,
    };
  }

  async checkWidgetLimit(userId: string): Promise<{ allowed: boolean; currentCount: number; maxWidgets: number }> {
    let result: Awaited<ReturnType<typeof widgetStorage.getUserWithPlan>>;
    try {
      result = await widgetStorage.getUserWithPlan(userId);
    } catch (err) {
      console.error('[checkWidgetLimit] Error fetching user/plan (defaulting to maxWidgets=1):', err);
      // If the plan/subscription lookup fails (e.g. missing column in older DB),
      // fall back to a conservative default of 1 widget and enforce it properly.
      const currentCount = await widgetStorage.getWidgetCount(userId).catch(() => 0);
      const maxWidgets = 1;
      return { allowed: currentCount < maxWidgets, currentCount, maxWidgets };
    }

    if (!result) {
      return { allowed: false, currentCount: 0, maxWidgets: 0 };
    }
    
    const { plan, subscription } = result;
    const currentCount = await widgetStorage.getWidgetCount(userId);
    
    // Get effective max widgets (check for override in subscription)
    let maxWidgets = 1; // Default for free users when no plan row found
    if (plan) {
      maxWidgets = plan.maxWidgets ?? 1;
    }
    if (subscription?.overrideMaxWidgets !== null && subscription?.overrideMaxWidgets !== undefined) {
      maxWidgets = subscription.overrideMaxWidgets;
    }
    
    // -1 or 999 means unlimited
    const isUnlimited = maxWidgets === -1 || maxWidgets === 999;
    return {
      allowed: isUnlimited || currentCount < maxWidgets,
      currentCount,
      maxWidgets,
    };
  }

  async getWidgetStats(userId: string) {
    return widgetStorage.getWidgetStats(userId);
  }

  async getWidgetLimits(userId: string): Promise<{ currentCount: number; maxWidgets: number; remaining: number }> {
    const limitCheck = await this.checkWidgetLimit(userId);
    return {
      currentCount: limitCheck.currentCount,
      maxWidgets: limitCheck.maxWidgets,
      remaining: Math.max(0, limitCheck.maxWidgets - limitCheck.currentCount),
    };
  }

  generateEmbedCode(widget: WebsiteWidget, baseUrl: string): string {
    return `<!-- ${widget.brandName || widget.name} Voice Widget -->
<script>
  (function(w,d,s,o,f,js){
    w[o]=w[o]||function(){(w[o].q=w[o].q||[]).push(arguments)};
    js=d.createElement(s);js.id=o;js.src=f;js.async=1;
    (d.head||d.body).appendChild(js);
  }(window,document,'script','vw','${baseUrl}/widget/embed.js'));
  vw('init', '${widget.embedToken}');
</script>`;
  }
}

export const widgetService = new WidgetService();
