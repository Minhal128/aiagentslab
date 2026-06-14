import { db } from "../../db";
import { websiteWidgets, widgetCallSessions, users, userSubscriptions, plans } from "@shared/schema";
import { eq, and, desc, sql, isNull } from "drizzle-orm";
import type { WebsiteWidget, InsertWebsiteWidget, WidgetCallSession, InsertWidgetCallSession, Plan, UserSubscription } from "@shared/schema";

export class WidgetStorage {
  
  async createWidget(data: InsertWebsiteWidget): Promise<WebsiteWidget> {
    const [widget] = await db.insert(websiteWidgets).values(data).returning();
    return widget;
  }

  async getWidgetById(id: string): Promise<WebsiteWidget | null> {
    const [widget] = await db.select().from(websiteWidgets).where(eq(websiteWidgets.id, id)).limit(1);
    return widget || null;
  }

  async getWidgetByEmbedToken(embedToken: string): Promise<WebsiteWidget | null> {
    const [widget] = await db.select().from(websiteWidgets).where(eq(websiteWidgets.embedToken, embedToken)).limit(1);
    return widget || null;
  }

  async getWidgetsByUserId(userId: string): Promise<WebsiteWidget[]> {
    return db.select().from(websiteWidgets)
      .where(eq(websiteWidgets.userId, userId))
      .orderBy(desc(websiteWidgets.createdAt));
  }

  async updateWidget(id: string, userId: string, data: Partial<InsertWebsiteWidget>): Promise<WebsiteWidget | null> {
    const [widget] = await db.update(websiteWidgets)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(websiteWidgets.id, id), eq(websiteWidgets.userId, userId)))
      .returning();
    return widget || null;
  }

  async deleteWidget(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(websiteWidgets)
      .where(and(eq(websiteWidgets.id, id), eq(websiteWidgets.userId, userId)));
    return (result.rowCount ?? 0) > 0;
  }

  async incrementWidgetStats(widgetId: string, durationMinutes: number): Promise<void> {
    await db.update(websiteWidgets)
      .set({
        totalCalls: sql`${websiteWidgets.totalCalls} + 1`,
        totalMinutes: sql`${websiteWidgets.totalMinutes} + ${durationMinutes}`,
        updatedAt: new Date(),
      })
      .where(eq(websiteWidgets.id, widgetId));
  }

  async createSession(data: InsertWidgetCallSession): Promise<WidgetCallSession> {
    const [session] = await db.insert(widgetCallSessions).values(data).returning();
    return session;
  }

  async getSessionById(id: string): Promise<WidgetCallSession | null> {
    const [session] = await db.select().from(widgetCallSessions).where(eq(widgetCallSessions.id, id)).limit(1);
    return session || null;
  }

  async getSessionByToken(sessionToken: string): Promise<WidgetCallSession | null> {
    const [session] = await db.select().from(widgetCallSessions)
      .where(eq(widgetCallSessions.sessionToken, sessionToken))
      .limit(1);
    return session || null;
  }

  async updateSession(id: string, data: Partial<InsertWidgetCallSession>): Promise<WidgetCallSession | null> {
    const [session] = await db.update(widgetCallSessions)
      .set(data)
      .where(eq(widgetCallSessions.id, id))
      .returning();
    return session || null;
  }

  async getActiveSessionsForWidget(widgetId: string): Promise<WidgetCallSession[]> {
    return db.select().from(widgetCallSessions)
      .where(and(
        eq(widgetCallSessions.widgetId, widgetId),
        sql`${widgetCallSessions.status} IN ('active', 'pending', 'connecting')`
      ));
  }

  async getActiveSessionCount(widgetId: string): Promise<number> {
    const sessions = await this.getActiveSessionsForWidget(widgetId);
    return sessions.length;
  }

  async getSessionsByWidgetId(widgetId: string, limit: number = 50): Promise<WidgetCallSession[]> {
    return db.select().from(widgetCallSessions)
      .where(eq(widgetCallSessions.widgetId, widgetId))
      .orderBy(desc(widgetCallSessions.createdAt))
      .limit(limit);
  }

  async getUserCredits(userId: string): Promise<number> {
    const [user] = await db.select({ credits: users.credits })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return user?.credits ?? 0;
  }

  async getUserWithPlan(userId: string): Promise<{ user: typeof users.$inferSelect; plan: Plan | null; subscription: UserSubscription | null } | null> {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return null;
    
    const [subscription] = await db.select()
      .from(userSubscriptions)
      .where(and(
        eq(userSubscriptions.userId, userId),
        eq(userSubscriptions.status, 'active')
      ))
      .limit(1);
    
    let plan: Plan | null = null;
    if (subscription) {
      const [p] = await db.select().from(plans).where(eq(plans.id, subscription.planId)).limit(1);
      plan = p || null;
    }
    
    if (!plan) {
      const [freePlan] = await db.select().from(plans).where(eq(plans.name, user.planType || 'free')).limit(1);
      plan = freePlan || null;
    }
    
    return { user, plan, subscription };
  }

  async getWidgetCount(userId: string): Promise<number> {
    const widgets = await this.getWidgetsByUserId(userId);
    return widgets.length;
  }

  async getWidgetStats(userId: string): Promise<{ totalWidgets: number; totalCalls: number; totalMinutes: number; widgetStats: Array<{ id: string; name: string; calls: number; minutes: number; status: string }> }> {
    const widgets = await this.getWidgetsByUserId(userId);
    const totalWidgets = widgets.length;
    const totalCalls = widgets.reduce((sum, w) => sum + w.totalCalls, 0);
    const totalMinutes = widgets.reduce((sum, w) => sum + w.totalMinutes, 0);
    const widgetStats = widgets.map(w => ({
      id: w.id,
      name: w.name,
      calls: w.totalCalls,
      minutes: w.totalMinutes,
      status: w.status
    }));
    return { totalWidgets, totalCalls, totalMinutes, widgetStats };
  }

  async getLastSessionByIp(widgetId: string, visitorIp: string): Promise<WidgetCallSession | null> {
    const [session] = await db.select().from(widgetCallSessions)
      .where(and(
        eq(widgetCallSessions.widgetId, widgetId),
        eq(widgetCallSessions.visitorIp, visitorIp)
      ))
      .orderBy(desc(widgetCallSessions.createdAt))
      .limit(1);
    return session || null;
  }
}

export const widgetStorage = new WidgetStorage();
