import { db } from "./db.js";
import { nanoid } from "nanoid";
import {
  users,
  agents,
  knowledgeBase,
  campaigns,
  contacts,
  calls,
  creditTransactions,
  tools,
  voices,
  plans,
  userSubscriptions,
  phoneNumbers,
  usageRecords,
  globalSettings,
  creditPackages,
  webhookSubscriptions,
  webhookDeliveryLogs,
  phoneNumberRentals,
  notifications,
  incomingConnections,
  emailTemplates,
  promptTemplates,
  agentVersions,
  seoSettings,
  analyticsScripts,
  paymentTransactions,
  refunds,
  invoices,
  paymentWebhookQueue,
  emailNotificationSettings,
  bannedWords,
  contentViolations,
  twilioOpenaiCalls,
  plivoCalls,
  demoSessions,
  websiteWidgets,
  sipCalls
} from "../shared/schema.js";
import { eq, sql, and, gte, lte, desc, asc, isNull, isNotNull, or, inArray } from "drizzle-orm";
import { calculateGlobalAnalytics, calculateUserAnalytics, calculateDashboardData } from "./storage/analytics-helpers.js";
class DbStorage {
  // Users
  async getUser(id) {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }
  async getUserByEmail(email) {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }
  async createUser(insertUser) {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }
  async updateUserCredits(userId, credits) {
    await db.update(users).set({ credits }).where(eq(users.id, userId));
  }
  // Agents
  async getAgent(id) {
    const [agent] = await db.select().from(agents).where(eq(agents.id, id));
    return agent;
  }
  async getUserAgents(userId) {
    return db.select().from(agents).where(eq(agents.userId, userId));
  }
  async createAgent(insertAgent) {
    const [agent] = await db.insert(agents).values(insertAgent).returning();
    return agent;
  }
  async updateAgent(id, agent) {
    await db.update(agents).set(agent).where(eq(agents.id, id));
  }
  async deleteAgent(id) {
    await db.delete(agents).where(eq(agents.id, id));
  }
  // Knowledge Base
  async getKnowledgeBaseItem(id) {
    const [item] = await db.select().from(knowledgeBase).where(eq(knowledgeBase.id, id));
    return item;
  }
  async getUserKnowledgeBase(userId) {
    return db.select().from(knowledgeBase).where(eq(knowledgeBase.userId, userId));
  }
  async getUserKnowledgeBaseCount(userId) {
    const result = await db.select({ count: sql`count(*)` }).from(knowledgeBase).where(eq(knowledgeBase.userId, userId));
    return Number(result[0]?.count || 0);
  }
  async createKnowledgeBaseItem(insertItem) {
    const [item] = await db.insert(knowledgeBase).values(insertItem).returning();
    return item;
  }
  async updateKnowledgeBaseItem(id, item) {
    await db.update(knowledgeBase).set(item).where(eq(knowledgeBase.id, id));
  }
  async deleteKnowledgeBaseItem(id) {
    await db.delete(knowledgeBase).where(eq(knowledgeBase.id, id));
  }
  // Campaigns
  async getCampaign(id) {
    const [campaign] = await db.select().from(campaigns).where(and(
      eq(campaigns.id, id),
      isNull(campaigns.deletedAt)
    ));
    return campaign;
  }
  async getCampaignIncludingDeleted(id) {
    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id));
    return campaign;
  }
  async getUserCampaigns(userId) {
    return db.select().from(campaigns).where(and(
      eq(campaigns.userId, userId),
      isNull(campaigns.deletedAt)
    )).orderBy(desc(campaigns.createdAt));
  }
  async getUserDeletedCampaigns(userId) {
    return db.select().from(campaigns).where(and(
      eq(campaigns.userId, userId),
      isNotNull(campaigns.deletedAt)
    )).orderBy(desc(campaigns.createdAt));
  }
  async createCampaign(insertCampaign) {
    const [campaign] = await db.insert(campaigns).values(insertCampaign).returning();
    return campaign;
  }
  async updateCampaign(id, campaign) {
    await db.update(campaigns).set(campaign).where(eq(campaigns.id, id));
  }
  async deleteCampaign(id) {
    await db.update(campaigns).set({ deletedAt: /* @__PURE__ */ new Date() }).where(eq(campaigns.id, id));
  }
  async restoreCampaign(id) {
    await db.update(campaigns).set({ deletedAt: null }).where(eq(campaigns.id, id));
  }
  // Contacts
  async getContact(id) {
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, id));
    return contact;
  }
  async getCampaignContacts(campaignId) {
    return db.select().from(contacts).where(eq(contacts.campaignId, campaignId));
  }
  async getUserContacts(userId) {
    const results = await db.select({
      contact: contacts,
      campaign: campaigns
    }).from(contacts).innerJoin(campaigns, eq(contacts.campaignId, campaigns.id)).where(and(
      eq(campaigns.userId, userId),
      isNull(campaigns.deletedAt)
    ));
    return results.map((r) => ({
      ...r.contact,
      campaign: r.campaign ? { id: r.campaign.id, name: r.campaign.name } : null
    }));
  }
  async getUserContactsDeduplicated(userId) {
    const results = await db.select({
      contact: contacts,
      campaign: campaigns
    }).from(contacts).innerJoin(campaigns, eq(contacts.campaignId, campaigns.id)).where(and(
      eq(campaigns.userId, userId),
      isNull(campaigns.deletedAt)
    )).orderBy(desc(contacts.createdAt));
    const phoneGroups = /* @__PURE__ */ new Map();
    for (const result of results) {
      const { contact, campaign } = result;
      const phone = contact.phone;
      if (!phoneGroups.has(phone)) {
        phoneGroups.set(phone, {
          phone,
          email: contact.email,
          names: /* @__PURE__ */ new Set(),
          namesList: [],
          campaigns: /* @__PURE__ */ new Set(),
          campaignsList: [],
          statuses: /* @__PURE__ */ new Set(),
          latestContactId: contact.id,
          latestStatus: contact.status,
          latestEmail: contact.email,
          latestCreatedAt: contact.createdAt,
          source: "campaign",
          callCount: 0
        });
      }
      const group = phoneGroups.get(phone);
      const nameKey = `${contact.firstName.toLowerCase()}|${(contact.lastName || "").toLowerCase()}`;
      if (!group.names.has(nameKey)) {
        group.names.add(nameKey);
        group.namesList.push({
          firstName: contact.firstName,
          lastName: contact.lastName
        });
      }
      if (!group.campaigns.has(campaign.id) && campaign) {
        group.campaigns.add(campaign.id);
        group.campaignsList.push({
          id: campaign.id,
          name: campaign.name
        });
      }
      group.statuses.add(contact.status);
      if (contact.createdAt > group.latestCreatedAt) {
        group.latestContactId = contact.id;
        group.latestStatus = contact.status;
        group.latestEmail = contact.email;
        group.latestCreatedAt = contact.createdAt;
      }
    }
    const callsWithoutContacts = await db.select({
      phoneNumber: calls.phoneNumber,
      callDirection: calls.callDirection,
      createdAt: calls.createdAt,
      status: calls.status
    }).from(calls).where(and(
      eq(calls.userId, userId),
      isNull(calls.contactId),
      isNotNull(calls.phoneNumber)
    )).orderBy(desc(calls.createdAt));
    for (const call of callsWithoutContacts) {
      const phone = call.phoneNumber;
      if (!phone || phone === "Unknown Caller" || phone === "unknown") continue;
      const callStatus = call.callDirection === "incoming" ? "incoming_call" : "outgoing_call";
      if (!phoneGroups.has(phone)) {
        phoneGroups.set(phone, {
          phone,
          email: null,
          names: /* @__PURE__ */ new Set(),
          namesList: [],
          campaigns: /* @__PURE__ */ new Set(),
          campaignsList: [],
          statuses: /* @__PURE__ */ new Set([callStatus]),
          latestContactId: `call-${phone}`,
          // Virtual ID for call-only contacts
          latestStatus: callStatus,
          latestEmail: null,
          latestCreatedAt: call.createdAt,
          source: "call",
          callCount: 1
        });
      } else {
        const group = phoneGroups.get(phone);
        group.callCount = (group.callCount || 0) + 1;
        group.statuses.add(callStatus);
        if (call.createdAt > group.latestCreatedAt) {
          group.latestStatus = callStatus;
          group.latestCreatedAt = call.createdAt;
        }
      }
    }
    return Array.from(phoneGroups.values()).map((group) => ({
      id: group.latestContactId,
      phone: group.phone,
      email: group.latestEmail,
      names: group.namesList,
      campaigns: group.campaignsList,
      status: group.latestStatus,
      allStatuses: Array.from(group.statuses),
      source: group.source,
      callCount: group.callCount
    }));
  }
  async createContact(insertContact) {
    const [contact] = await db.insert(contacts).values(insertContact).returning();
    return contact;
  }
  async createContacts(insertContacts) {
    return db.insert(contacts).values(insertContacts).returning();
  }
  async deleteContact(id) {
    await db.delete(contacts).where(eq(contacts.id, id));
  }
  // Calls
  async getCall(id) {
    const [call] = await db.select().from(calls).where(eq(calls.id, id));
    return call;
  }
  async getCallWithDetails(id) {
    const elevenLabsResults = await db.select({
      call: calls,
      campaign: campaigns,
      contact: contacts,
      incomingConnection: incomingConnections,
      widget: websiteWidgets
    }).from(calls).leftJoin(campaigns, eq(calls.campaignId, campaigns.id)).leftJoin(contacts, eq(calls.contactId, contacts.id)).leftJoin(incomingConnections, eq(calls.incomingConnectionId, incomingConnections.id)).leftJoin(websiteWidgets, eq(calls.widgetId, websiteWidgets.id)).where(eq(calls.id, id));
    if (elevenLabsResults.length > 0) {
      const r = elevenLabsResults[0];
      const metadataEngine = r.call.metadata?.engine;
      const engine = metadataEngine || "elevenlabs";
      return {
        ...r.call,
        engine,
        campaign: r.campaign ? { id: r.campaign.id, name: r.campaign.name } : null,
        contact: r.contact ? { id: r.contact.id, firstName: r.contact.firstName, lastName: r.contact.lastName, phone: r.contact.phone } : null,
        incomingConnection: r.incomingConnection ? { id: r.incomingConnection.id, agentId: r.incomingConnection.agentId } : null,
        widget: r.widget ? { id: r.widget.id, name: r.widget.name } : null
      };
    }
    const twilioOpenAIResults = await db.select({
      call: twilioOpenaiCalls,
      campaign: campaigns,
      contact: contacts,
      agent: agents
    }).from(twilioOpenaiCalls).leftJoin(campaigns, eq(twilioOpenaiCalls.campaignId, campaigns.id)).leftJoin(contacts, eq(twilioOpenaiCalls.contactId, contacts.id)).leftJoin(agents, eq(twilioOpenaiCalls.agentId, agents.id)).where(eq(twilioOpenaiCalls.id, id));
    if (twilioOpenAIResults.length > 0) {
      const r = twilioOpenAIResults[0];
      return {
        id: r.call.id,
        userId: r.call.userId,
        campaignId: r.call.campaignId,
        contactId: r.call.contactId,
        agentId: r.call.agentId,
        phoneNumber: r.call.fromNumber,
        fromNumber: r.call.fromNumber,
        toNumber: r.call.toNumber,
        twilioSid: r.call.twilioCallSid,
        status: r.call.status,
        callDirection: r.call.callDirection === "inbound" ? "incoming" : r.call.callDirection === "outbound" ? "outgoing" : r.call.callDirection,
        duration: r.call.duration,
        recordingUrl: r.call.recordingUrl,
        transcript: r.call.transcript,
        aiSummary: r.call.aiSummary,
        sentiment: r.call.sentiment,
        wasTransferred: r.call.wasTransferred,
        transferredTo: r.call.transferredTo,
        transferredAt: r.call.transferredAt,
        startedAt: r.call.startedAt,
        endedAt: r.call.endedAt,
        createdAt: r.call.createdAt,
        metadata: r.call.metadata,
        engine: "twilio-openai",
        openaiSessionId: r.call.openaiSessionId,
        openaiVoice: r.call.openaiVoice,
        openaiModel: r.call.openaiModel,
        campaign: r.campaign ? { id: r.campaign.id, name: r.campaign.name } : null,
        contact: r.contact ? { id: r.contact.id, firstName: r.contact.firstName, lastName: r.contact.lastName, phone: r.contact.phone } : null,
        incomingConnection: null,
        agent: r.agent ? { id: r.agent.id, name: r.agent.name } : null
      };
    }
    const plivoResults = await db.select({
      call: plivoCalls,
      campaign: campaigns,
      contact: contacts,
      agent: agents
    }).from(plivoCalls).leftJoin(campaigns, eq(plivoCalls.campaignId, campaigns.id)).leftJoin(contacts, eq(plivoCalls.contactId, contacts.id)).leftJoin(agents, eq(plivoCalls.agentId, agents.id)).where(eq(plivoCalls.id, id));
    if (plivoResults.length > 0) {
      const r = plivoResults[0];
      return {
        id: r.call.id,
        userId: r.call.userId,
        campaignId: r.call.campaignId,
        contactId: r.call.contactId,
        agentId: r.call.agentId,
        phoneNumber: r.call.fromNumber,
        fromNumber: r.call.fromNumber,
        toNumber: r.call.toNumber,
        plivoCallUuid: r.call.plivoCallUuid,
        status: r.call.status,
        callDirection: r.call.callDirection === "inbound" ? "incoming" : r.call.callDirection === "outbound" ? "outgoing" : r.call.callDirection,
        duration: r.call.duration,
        recordingUrl: r.call.recordingUrl,
        transcript: r.call.transcript,
        aiSummary: r.call.aiSummary,
        sentiment: r.call.sentiment,
        leadQualityScore: r.call.leadQualityScore,
        keyPoints: r.call.keyPoints,
        nextActions: r.call.nextActions,
        wasTransferred: r.call.wasTransferred,
        transferredTo: r.call.transferredTo,
        transferredAt: r.call.transferredAt,
        startedAt: r.call.startedAt,
        answeredAt: r.call.answeredAt,
        endedAt: r.call.endedAt,
        createdAt: r.call.createdAt,
        metadata: r.call.metadata,
        engine: "plivo-openai",
        openaiSessionId: r.call.openaiSessionId,
        openaiVoice: r.call.openaiVoice,
        openaiModel: r.call.openaiModel,
        campaign: r.campaign ? { id: r.campaign.id, name: r.campaign.name } : null,
        contact: r.contact ? { id: r.contact.id, firstName: r.contact.firstName, lastName: r.contact.lastName, phone: r.contact.phone } : null,
        incomingConnection: null,
        agent: r.agent ? { id: r.agent.id, name: r.agent.name } : null
      };
    }
    return void 0;
  }
  async getCampaignCalls(campaignId) {
    return db.select().from(calls).where(eq(calls.campaignId, campaignId));
  }
  async getUserCalls(userId) {
    const results = await db.select({ calls }).from(calls).leftJoin(campaigns, eq(calls.campaignId, campaigns.id)).leftJoin(incomingConnections, eq(calls.incomingConnectionId, incomingConnections.id)).where(
      or(
        eq(calls.userId, userId),
        and(isNotNull(calls.campaignId), eq(campaigns.userId, userId)),
        and(isNotNull(calls.incomingConnectionId), eq(incomingConnections.userId, userId))
      )
    );
    return results.map((r) => r.calls);
  }
  async getUserCallsWithDetails(userId) {
    const elevenLabsResults = await db.select({
      call: calls,
      campaign: campaigns,
      contact: contacts,
      incomingConnection: incomingConnections,
      widget: websiteWidgets
    }).from(calls).leftJoin(campaigns, eq(calls.campaignId, campaigns.id)).leftJoin(contacts, eq(calls.contactId, contacts.id)).leftJoin(incomingConnections, eq(calls.incomingConnectionId, incomingConnections.id)).leftJoin(websiteWidgets, eq(calls.widgetId, websiteWidgets.id)).where(
      or(
        // Primary filter: Direct user ownership (guaranteed isolation)
        eq(calls.userId, userId),
        // Fallback for legacy calls: Check via campaign ownership
        and(isNotNull(calls.campaignId), eq(campaigns.userId, userId)),
        // Fallback for legacy calls: Check via incoming connection ownership
        and(isNotNull(calls.incomingConnectionId), eq(incomingConnections.userId, userId))
      )
    ).orderBy(sql`${calls.createdAt} DESC`);
    const elevenLabsCalls = elevenLabsResults.map((r) => {
      const metadataEngine = r.call.metadata?.engine;
      const engine = metadataEngine || "elevenlabs";
      return {
        ...r.call,
        engine,
        campaign: r.campaign ? { id: r.campaign.id, name: r.campaign.name } : null,
        contact: r.contact ? { id: r.contact.id, firstName: r.contact.firstName, lastName: r.contact.lastName, phone: r.contact.phone } : null,
        incomingConnection: r.incomingConnection ? { id: r.incomingConnection.id, agentId: r.incomingConnection.agentId } : null,
        widget: r.widget ? { id: r.widget.id, name: r.widget.name } : null
      };
    });
    const twilioOpenAIResults = await db.select({
      call: twilioOpenaiCalls,
      campaign: campaigns,
      contact: contacts,
      agent: agents
    }).from(twilioOpenaiCalls).leftJoin(campaigns, eq(twilioOpenaiCalls.campaignId, campaigns.id)).leftJoin(contacts, eq(twilioOpenaiCalls.contactId, contacts.id)).leftJoin(agents, eq(twilioOpenaiCalls.agentId, agents.id)).where(eq(twilioOpenaiCalls.userId, userId)).orderBy(sql`${twilioOpenaiCalls.createdAt} DESC`);
    const twilioOpenAICalls = twilioOpenAIResults.map((r) => ({
      id: r.call.id,
      userId: r.call.userId,
      campaignId: r.call.campaignId,
      contactId: r.call.contactId,
      agentId: r.call.agentId,
      phoneNumber: r.call.fromNumber,
      fromNumber: r.call.fromNumber,
      toNumber: r.call.toNumber,
      twilioSid: r.call.twilioCallSid,
      status: r.call.status,
      callDirection: r.call.callDirection === "inbound" ? "incoming" : "outgoing",
      duration: r.call.duration,
      recordingUrl: r.call.recordingUrl,
      transcript: r.call.transcript,
      aiSummary: r.call.aiSummary,
      sentiment: r.call.sentiment,
      wasTransferred: r.call.wasTransferred,
      transferredTo: r.call.transferredTo,
      transferredAt: r.call.transferredAt,
      startedAt: r.call.startedAt,
      endedAt: r.call.endedAt,
      createdAt: r.call.createdAt,
      metadata: r.call.metadata,
      engine: "twilio-openai",
      openaiSessionId: r.call.openaiSessionId,
      openaiVoice: r.call.openaiVoice,
      openaiModel: r.call.openaiModel,
      campaign: r.campaign ? { id: r.campaign.id, name: r.campaign.name } : null,
      contact: r.contact ? { id: r.contact.id, firstName: r.contact.firstName, lastName: r.contact.lastName, phone: r.contact.phone } : null,
      incomingConnection: null,
      agent: r.agent ? { id: r.agent.id, name: r.agent.name } : null
    }));
    const plivoResults = await db.select({
      call: plivoCalls,
      campaign: campaigns,
      contact: contacts,
      agent: agents
    }).from(plivoCalls).leftJoin(campaigns, eq(plivoCalls.campaignId, campaigns.id)).leftJoin(contacts, eq(plivoCalls.contactId, contacts.id)).leftJoin(agents, eq(plivoCalls.agentId, agents.id)).where(eq(plivoCalls.userId, userId)).orderBy(sql`${plivoCalls.createdAt} DESC`);
    const plivoOpenAICalls = plivoResults.map((r) => ({
      id: r.call.id,
      userId: r.call.userId,
      campaignId: r.call.campaignId,
      contactId: r.call.contactId,
      agentId: r.call.agentId,
      phoneNumber: r.call.fromNumber,
      fromNumber: r.call.fromNumber,
      toNumber: r.call.toNumber,
      plivoCallUuid: r.call.plivoCallUuid,
      status: r.call.status,
      callDirection: r.call.callDirection === "inbound" ? "incoming" : "outgoing",
      duration: r.call.duration,
      recordingUrl: r.call.recordingUrl,
      transcript: r.call.transcript,
      aiSummary: r.call.aiSummary,
      sentiment: r.call.sentiment,
      leadQualityScore: r.call.leadQualityScore,
      keyPoints: r.call.keyPoints,
      nextActions: r.call.nextActions,
      wasTransferred: r.call.wasTransferred,
      transferredTo: r.call.transferredTo,
      transferredAt: r.call.transferredAt,
      startedAt: r.call.startedAt,
      answeredAt: r.call.answeredAt,
      endedAt: r.call.endedAt,
      createdAt: r.call.createdAt,
      metadata: r.call.metadata,
      engine: "plivo-openai",
      openaiSessionId: r.call.openaiSessionId,
      openaiVoice: r.call.openaiVoice,
      openaiModel: r.call.openaiModel,
      campaign: r.campaign ? { id: r.campaign.id, name: r.campaign.name } : null,
      contact: r.contact ? { id: r.contact.id, firstName: r.contact.firstName, lastName: r.contact.lastName, phone: r.contact.phone } : null,
      incomingConnection: null,
      agent: r.agent ? { id: r.agent.id, name: r.agent.name } : null
    }));
    const sipCallResults = await db.select({
      call: sipCalls,
      agent: agents,
      contact: contacts
    }).from(sipCalls).leftJoin(agents, eq(sipCalls.agentId, agents.id)).leftJoin(contacts, eq(sipCalls.contactId, contacts.id)).where(eq(sipCalls.userId, userId)).orderBy(sql`${sipCalls.createdAt} DESC`);
    const sipCallsFormatted = sipCallResults.map((r) => ({
      id: r.call.id,
      userId: r.call.userId,
      campaignId: r.call.campaignId,
      contactId: r.call.contactId,
      agentId: r.call.agentId,
      phoneNumber: r.call.direction === "inbound" ? r.call.fromNumber : r.call.toNumber,
      fromNumber: r.call.fromNumber,
      toNumber: r.call.toNumber,
      status: r.call.status,
      callDirection: r.call.direction === "inbound" ? "incoming" : "outgoing",
      duration: r.call.durationSeconds,
      recordingUrl: r.call.recordingUrl,
      transcript: r.call.transcript,
      aiSummary: r.call.aiSummary,
      startedAt: r.call.startedAt,
      answeredAt: r.call.answeredAt,
      endedAt: r.call.endedAt,
      createdAt: r.call.createdAt,
      metadata: r.call.metadata,
      engine: r.call.engine,
      sipTrunkId: r.call.sipTrunkId,
      sipPhoneNumberId: r.call.sipPhoneNumberId,
      elevenlabsConversationId: r.call.elevenlabsConversationId,
      creditsUsed: r.call.creditsUsed,
      campaign: null,
      contact: r.contact ? { id: r.contact.id, firstName: r.contact.firstName, lastName: r.contact.lastName, phone: r.contact.phone } : null,
      incomingConnection: null,
      agent: r.agent ? { id: r.agent.id, name: r.agent.name } : null
    }));
    const allCalls = [...elevenLabsCalls, ...twilioOpenAICalls, ...plivoOpenAICalls, ...sipCallsFormatted];
    allCalls.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });
    return allCalls;
  }
  async createCall(insertCall) {
    const [call] = await db.insert(calls).values(insertCall).returning();
    return call;
  }
  async updateCall(id, call) {
    await db.update(calls).set(call).where(eq(calls.id, id));
  }
  // Credit Transactions
  async getCreditTransaction(id) {
    const [transaction] = await db.select().from(creditTransactions).where(eq(creditTransactions.id, id));
    return transaction;
  }
  async getUserCreditTransactions(userId) {
    return db.select().from(creditTransactions).where(eq(creditTransactions.userId, userId));
  }
  async createCreditTransaction(insertTransaction) {
    const [transaction] = await db.insert(creditTransactions).values(insertTransaction).returning();
    return transaction;
  }
  // Atomic credit purchase: creates transaction + adds credits in single DB transaction
  async addCreditsAtomic(userId, credits, description, stripePaymentId) {
    await db.transaction(async (tx) => {
      await tx.insert(creditTransactions).values({
        userId,
        type: "credit",
        amount: credits,
        description,
        stripePaymentId
      });
      await tx.execute(sql`
        UPDATE users 
        SET credits = COALESCE(credits, 0) + ${credits}
        WHERE id = ${userId}
      `);
    });
  }
  // Tools
  async getTool(id) {
    const [tool] = await db.select().from(tools).where(eq(tools.id, id));
    return tool;
  }
  async getUserTools(userId) {
    return db.select().from(tools).where(eq(tools.userId, userId));
  }
  async createTool(insertTool) {
    const [tool] = await db.insert(tools).values(insertTool).returning();
    return tool;
  }
  async updateTool(id, tool) {
    await db.update(tools).set(tool).where(eq(tools.id, id));
  }
  async deleteTool(id) {
    await db.delete(tools).where(eq(tools.id, id));
  }
  // Phone Number Rentals
  async createPhoneNumberRental(insertRental) {
    const [rental] = await db.insert(phoneNumberRentals).values(insertRental).returning();
    return rental;
  }
  async getPhoneNumberRentals(phoneNumberId) {
    return db.select().from(phoneNumberRentals).where(eq(phoneNumberRentals.phoneNumberId, phoneNumberId)).orderBy(desc(phoneNumberRentals.createdAt));
  }
  // Voices
  async getVoice(id) {
    const [voice] = await db.select().from(voices).where(eq(voices.id, id));
    return voice;
  }
  async getUserVoices(userId) {
    return db.select().from(voices).where(eq(voices.userId, userId));
  }
  async createVoice(insertVoice) {
    const [voice] = await db.insert(voices).values(insertVoice).returning();
    return voice;
  }
  async deleteVoice(id) {
    await db.delete(voices).where(eq(voices.id, id));
  }
  // Plans
  async getPlan(id) {
    const [plan] = await db.select().from(plans).where(eq(plans.id, id));
    return plan;
  }
  async getPlanByName(name) {
    const [plan] = await db.select().from(plans).where(eq(plans.name, name));
    return plan;
  }
  async getAllPlans() {
    return db.select().from(plans).where(eq(plans.isActive, true));
  }
  async createPlan(insertPlan) {
    const [plan] = await db.insert(plans).values(insertPlan).returning();
    return plan;
  }
  async updatePlan(id, plan) {
    const result = await db.update(plans).set(plan).where(eq(plans.id, id)).returning({ id: plans.id });
    if (result.length === 0) {
      throw new Error(`Failed to update plan: Plan with id '${id}' not found`);
    }
  }
  async deletePlan(id) {
    await db.delete(plans).where(eq(plans.id, id));
  }
  // Global Settings
  async getGlobalSetting(key) {
    const [setting] = await db.select().from(globalSettings).where(eq(globalSettings.key, key));
    if (setting && setting.value !== null && setting.value !== void 0) {
      let val = setting.value;
      if (typeof val === "string" && val.startsWith('"') && val.endsWith('"')) {
        try {
          val = JSON.parse(val);
        } catch {
        }
      }
      return { ...setting, value: val };
    }
    return setting;
  }
  async updateGlobalSetting(key, value) {
    try {
      const jsonValue = JSON.stringify(value);
      await db.execute(sql`
        INSERT INTO global_settings (id, key, value, updated_at)
        VALUES (gen_random_uuid(), ${key}, ${jsonValue}::jsonb, NOW())
        ON CONFLICT (key) DO UPDATE SET 
          value = ${jsonValue}::jsonb,
          updated_at = NOW()
      `);
      console.log(`\u2705 [Settings] Saved setting '${key}' successfully`);
    } catch (error) {
      console.error(`\u274C [Settings] Failed to save setting '${key}':`, error.message);
      throw new Error(`Failed to save setting '${key}': ${error.message}`);
    }
  }
  // Credit Packages
  async getCreditPackage(id) {
    const [pack] = await db.select().from(creditPackages).where(eq(creditPackages.id, id));
    return pack;
  }
  async getAllCreditPackages() {
    return db.select().from(creditPackages).where(eq(creditPackages.isActive, true));
  }
  async createCreditPackage(insertPack) {
    const [pack] = await db.insert(creditPackages).values(insertPack).returning();
    return pack;
  }
  async updateCreditPackage(id, pack) {
    const result = await db.update(creditPackages).set(pack).where(eq(creditPackages.id, id)).returning({ id: creditPackages.id });
    if (result.length === 0) {
      throw new Error(`Failed to update credit package: Package with id '${id}' not found`);
    }
  }
  // Admin Functions
  async getAllUsers() {
    return db.select().from(users).orderBy(desc(users.createdAt));
  }
  async getAllAdminUsers() {
    return db.select().from(users).where(
      sql`${users.role} = 'admin'`
    ).orderBy(desc(users.createdAt));
  }
  async updateUser(id, user) {
    const result = await db.update(users).set(user).where(eq(users.id, id)).returning({ id: users.id });
    if (result.length === 0) {
      throw new Error(`Failed to update user: User with id '${id}' not found`);
    }
  }
  async getSystemPhoneNumbers() {
    const results = await db.select({
      phone: phoneNumbers,
      user: users
    }).from(phoneNumbers).leftJoin(users, eq(phoneNumbers.userId, users.id));
    return results.map((r) => ({
      ...r.phone,
      userEmail: r.user?.email
    }));
  }
  async getGlobalAnalytics(timeRange) {
    return calculateGlobalAnalytics(timeRange);
  }
  // User Subscriptions
  async getUserSubscription(userId) {
    const result = await db.select({
      subscription: userSubscriptions,
      plan: plans
    }).from(userSubscriptions).leftJoin(plans, eq(userSubscriptions.planId, plans.id)).where(eq(userSubscriptions.userId, userId)).orderBy(desc(userSubscriptions.createdAt)).limit(1);
    if (result.length > 0 && result[0].subscription && result[0].plan) {
      return {
        ...result[0].subscription,
        plan: result[0].plan
      };
    }
    const [freePlan] = await db.select().from(plans).where(eq(plans.name, "free")).limit(1);
    if (!freePlan) {
      return null;
    }
    return null;
  }
  async getAllUserSubscriptions() {
    return await db.select().from(userSubscriptions);
  }
  async getUserSubscriptionByPaystackCode(subscriptionCode) {
    const [subscription] = await db.select().from(userSubscriptions).where(eq(userSubscriptions.paystackSubscriptionCode, subscriptionCode)).limit(1);
    return subscription;
  }
  async createUserSubscription(insertSubscription) {
    const [subscription] = await db.insert(userSubscriptions).values(insertSubscription).returning();
    return subscription;
  }
  async updateUserSubscription(id, subscription) {
    await db.update(userSubscriptions).set(subscription).where(eq(userSubscriptions.id, id));
  }
  async updateUserSubscriptionByUserId(userId, subscription) {
    await db.update(userSubscriptions).set({ ...subscription, updatedAt: /* @__PURE__ */ new Date() }).where(eq(userSubscriptions.userId, userId));
  }
  // Get effective limits for a user - merges plan defaults with per-user overrides
  async getUserEffectiveLimits(userId) {
    const subscriptionWithPlan = await this.getUserSubscription(userId);
    const defaultLimits = {
      maxAgents: 1,
      maxCampaigns: 1,
      maxContactsPerCampaign: 5,
      maxWebhooks: 3,
      maxKnowledgeBases: 5,
      maxFlows: 3,
      maxPhoneNumbers: 0,
      includedCredits: 0,
      sources: {
        maxAgents: "plan",
        maxCampaigns: "plan",
        maxContactsPerCampaign: "plan",
        maxWebhooks: "plan",
        maxKnowledgeBases: "plan",
        maxFlows: "plan",
        maxPhoneNumbers: "plan",
        includedCredits: "plan"
      },
      planName: "free",
      planDisplayName: "Free"
    };
    if (!subscriptionWithPlan || !subscriptionWithPlan.plan) {
      const [freePlan] = await db.select().from(plans).where(eq(plans.name, "free")).limit(1);
      if (freePlan) {
        return {
          maxAgents: freePlan.maxAgents,
          maxCampaigns: freePlan.maxCampaigns,
          maxContactsPerCampaign: freePlan.maxContactsPerCampaign,
          maxWebhooks: freePlan.maxWebhooks ?? 3,
          maxKnowledgeBases: freePlan.maxKnowledgeBases ?? 5,
          maxFlows: freePlan.maxFlows ?? 3,
          maxPhoneNumbers: freePlan.maxPhoneNumbers ?? 0,
          includedCredits: freePlan.includedCredits,
          sources: {
            maxAgents: "plan",
            maxCampaigns: "plan",
            maxContactsPerCampaign: "plan",
            maxWebhooks: "plan",
            maxKnowledgeBases: "plan",
            maxFlows: "plan",
            maxPhoneNumbers: "plan",
            includedCredits: "plan"
          },
          planName: freePlan.name,
          planDisplayName: freePlan.displayName
        };
      }
      return defaultLimits;
    }
    const plan = subscriptionWithPlan.plan;
    const sub = subscriptionWithPlan;
    return {
      maxAgents: sub.overrideMaxAgents ?? plan.maxAgents,
      maxCampaigns: sub.overrideMaxCampaigns ?? plan.maxCampaigns,
      maxContactsPerCampaign: sub.overrideMaxContactsPerCampaign ?? plan.maxContactsPerCampaign,
      maxWebhooks: sub.overrideMaxWebhooks ?? plan.maxWebhooks ?? 3,
      maxKnowledgeBases: sub.overrideMaxKnowledgeBases ?? plan.maxKnowledgeBases ?? 5,
      maxFlows: sub.overrideMaxFlows ?? plan.maxFlows ?? 3,
      maxPhoneNumbers: sub.overrideMaxPhoneNumbers ?? plan.maxPhoneNumbers ?? 0,
      includedCredits: sub.overrideIncludedCredits ?? plan.includedCredits,
      sources: {
        maxAgents: sub.overrideMaxAgents !== null ? "override" : "plan",
        maxCampaigns: sub.overrideMaxCampaigns !== null ? "override" : "plan",
        maxContactsPerCampaign: sub.overrideMaxContactsPerCampaign !== null ? "override" : "plan",
        maxWebhooks: sub.overrideMaxWebhooks !== null ? "override" : "plan",
        maxKnowledgeBases: sub.overrideMaxKnowledgeBases !== null ? "override" : "plan",
        maxFlows: sub.overrideMaxFlows !== null ? "override" : "plan",
        maxPhoneNumbers: sub.overrideMaxPhoneNumbers !== null ? "override" : "plan",
        includedCredits: sub.overrideIncludedCredits !== null ? "override" : "plan"
      },
      planName: plan.name,
      planDisplayName: plan.displayName
    };
  }
  // Phone Numbers
  async getPhoneNumber(id) {
    const [phoneNumber] = await db.select().from(phoneNumbers).where(eq(phoneNumbers.id, id));
    return phoneNumber;
  }
  async getUserPhoneNumbers(userId) {
    return db.select().from(phoneNumbers).where(eq(phoneNumbers.userId, userId));
  }
  async getAllPhoneNumbers() {
    return db.select().from(phoneNumbers);
  }
  async createPhoneNumber(insertPhoneNumber) {
    const [phoneNumber] = await db.insert(phoneNumbers).values(insertPhoneNumber).returning();
    return phoneNumber;
  }
  async updatePhoneNumber(id, phoneNumber) {
    await db.update(phoneNumbers).set(phoneNumber).where(eq(phoneNumbers.id, id));
  }
  async deletePhoneNumber(id) {
    await db.delete(phoneNumbers).where(eq(phoneNumbers.id, id));
  }
  // Usage Records
  async createUsageRecord(insertRecord) {
    const [record] = await db.insert(usageRecords).values(insertRecord).returning();
    return record;
  }
  async getUserUsageRecords(userId) {
    return db.select().from(usageRecords).where(eq(usageRecords.userId, userId));
  }
  // Analytics methods - delegate to extracted helper functions
  async getUserAnalytics(userId, timeRange = "7days", callType = "all") {
    return calculateUserAnalytics(userId, timeRange, callType);
  }
  async getDashboardData(userId) {
    return calculateDashboardData(userId);
  }
  // Webhooks (Subscriptions)
  async getWebhook(id) {
    const [webhook] = await db.select().from(webhookSubscriptions).where(eq(webhookSubscriptions.id, id));
    return webhook;
  }
  async getUserWebhooks(userId) {
    return await db.select().from(webhookSubscriptions).where(eq(webhookSubscriptions.userId, userId)).orderBy(desc(webhookSubscriptions.createdAt));
  }
  async getUserWebhookCount(userId) {
    const result = await db.select({ count: sql`count(*)` }).from(webhookSubscriptions).where(eq(webhookSubscriptions.userId, userId));
    return Number(result[0]?.count || 0);
  }
  async getWebhooksForEvent(userId, event, campaignId) {
    const allUserWebhooks = await db.select().from(webhookSubscriptions).where(and(
      eq(webhookSubscriptions.userId, userId),
      eq(webhookSubscriptions.isActive, true)
    ));
    return allUserWebhooks.filter((webhook) => {
      if (!webhook.events.includes(event)) return false;
      if (campaignId && webhook.campaignIds && webhook.campaignIds.length > 0) {
        return webhook.campaignIds.includes(campaignId);
      }
      return true;
    });
  }
  async createWebhook(webhook) {
    const [newWebhook] = await db.insert(webhookSubscriptions).values({
      ...webhook,
      id: nanoid()
    }).returning();
    return newWebhook;
  }
  async updateWebhook(id, webhook) {
    const updateData = { ...webhook, updatedAt: /* @__PURE__ */ new Date() };
    await db.update(webhookSubscriptions).set(updateData).where(eq(webhookSubscriptions.id, id));
  }
  async deleteWebhook(id) {
    await db.delete(webhookSubscriptions).where(eq(webhookSubscriptions.id, id));
  }
  // Webhook Delivery Logs
  async getWebhookLog(id) {
    const [log] = await db.select().from(webhookDeliveryLogs).where(eq(webhookDeliveryLogs.id, id));
    return log;
  }
  async getWebhookLogs(webhookId, limit = 50) {
    return await db.select().from(webhookDeliveryLogs).where(eq(webhookDeliveryLogs.webhookId, webhookId)).orderBy(desc(webhookDeliveryLogs.createdAt)).limit(limit);
  }
  async createWebhookLog(log) {
    const [newLog] = await db.insert(webhookDeliveryLogs).values(log).returning();
    return newLog;
  }
  async updateWebhookLog(id, log) {
    await db.update(webhookDeliveryLogs).set(log).where(eq(webhookDeliveryLogs.id, id));
  }
  async getFailedWebhookLogs(limit = 100) {
    return await db.select().from(webhookDeliveryLogs).where(and(
      eq(webhookDeliveryLogs.success, false),
      isNotNull(webhookDeliveryLogs.nextRetryAt)
    )).orderBy(asc(webhookDeliveryLogs.nextRetryAt)).limit(limit);
  }
  // Notifications
  async getNotification(id) {
    const [notification] = await db.select().from(notifications).where(eq(notifications.id, id));
    return notification;
  }
  async getUserNotifications(userId, limit = 50) {
    return await db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(limit);
  }
  async getUnreadNotificationCount(userId) {
    const result = await db.select({ count: sql`count(*)` }).from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
    return Number(result[0]?.count || 0);
  }
  async createNotification(notification) {
    const [newNotification] = await db.insert(notifications).values(notification).returning();
    return newNotification;
  }
  async markNotificationAsRead(id) {
    await db.update(notifications).set({ isRead: true }).where(eq(notifications.id, id));
  }
  async markAllNotificationsAsRead(userId) {
    await db.update(notifications).set({ isRead: true }).where(eq(notifications.userId, userId));
  }
  async getBannerNotifications(userId) {
    return await db.select().from(notifications).where(and(
      eq(notifications.userId, userId),
      or(
        eq(notifications.displayType, "banner"),
        eq(notifications.displayType, "both")
      ),
      eq(notifications.isDismissed, false),
      or(
        isNull(notifications.expiresAt),
        gte(notifications.expiresAt, /* @__PURE__ */ new Date())
      )
    )).orderBy(desc(notifications.priority), desc(notifications.createdAt));
  }
  async dismissNotification(id, userId) {
    if (userId) {
      await db.update(notifications).set({ isDismissed: true }).where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
    } else {
      await db.update(notifications).set({ isDismissed: true }).where(eq(notifications.id, id));
    }
  }
  async deleteNotification(id) {
    await db.delete(notifications).where(eq(notifications.id, id));
  }
  // Email Templates
  async getEmailTemplates() {
    return await db.select().from(emailTemplates).orderBy(emailTemplates.templateType);
  }
  async getEmailTemplate(templateType) {
    const [template] = await db.select().from(emailTemplates).where(eq(emailTemplates.templateType, templateType));
    return template;
  }
  async updateEmailTemplate(id, data) {
    await db.update(emailTemplates).set({ ...data, updatedAt: /* @__PURE__ */ new Date() }).where(eq(emailTemplates.id, id));
  }
  async createEmailTemplate(data) {
    const [template] = await db.insert(emailTemplates).values(data).returning();
    return template;
  }
  // Prompt Templates
  async getPromptTemplate(id) {
    const [template] = await db.select().from(promptTemplates).where(eq(promptTemplates.id, id));
    return template;
  }
  async getUserPromptTemplates(userId) {
    return await db.select().from(promptTemplates).where(eq(promptTemplates.userId, userId)).orderBy(desc(promptTemplates.createdAt));
  }
  async getSystemPromptTemplates() {
    return await db.select().from(promptTemplates).where(eq(promptTemplates.isSystemTemplate, true)).orderBy(asc(promptTemplates.category), asc(promptTemplates.name));
  }
  async getPublicPromptTemplates() {
    return await db.select().from(promptTemplates).where(eq(promptTemplates.isPublic, true)).orderBy(desc(promptTemplates.usageCount), asc(promptTemplates.name));
  }
  async createPromptTemplate(template) {
    const [newTemplate] = await db.insert(promptTemplates).values(template).returning();
    return newTemplate;
  }
  async updatePromptTemplate(id, template) {
    await db.update(promptTemplates).set({ ...template, updatedAt: /* @__PURE__ */ new Date() }).where(eq(promptTemplates.id, id));
  }
  async deletePromptTemplate(id) {
    await db.delete(promptTemplates).where(eq(promptTemplates.id, id));
  }
  async incrementPromptTemplateUsage(id) {
    await db.update(promptTemplates).set({
      usageCount: sql`${promptTemplates.usageCount} + 1`,
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq(promptTemplates.id, id));
  }
  // Agent Versions
  async getAgentVersion(id) {
    const [version] = await db.select().from(agentVersions).where(eq(agentVersions.id, id));
    return version;
  }
  async getAgentVersions(agentId) {
    return await db.select().from(agentVersions).where(eq(agentVersions.agentId, agentId)).orderBy(desc(agentVersions.versionNumber));
  }
  async getAgentVersionByNumber(agentId, versionNumber) {
    const [version] = await db.select().from(agentVersions).where(and(
      eq(agentVersions.agentId, agentId),
      eq(agentVersions.versionNumber, versionNumber)
    ));
    return version;
  }
  async getLatestAgentVersion(agentId) {
    const [version] = await db.select().from(agentVersions).where(eq(agentVersions.agentId, agentId)).orderBy(desc(agentVersions.versionNumber)).limit(1);
    return version;
  }
  async createAgentVersion(version) {
    const [newVersion] = await db.insert(agentVersions).values(version).returning();
    return newVersion;
  }
  // SEO Settings
  async getSeoSettings() {
    const [settings] = await db.select().from(seoSettings).limit(1);
    return settings;
  }
  async updateSeoSettings(settings) {
    const existing = await this.getSeoSettings();
    if (existing) {
      const updateData = { ...settings, updatedAt: /* @__PURE__ */ new Date() };
      const [updated] = await db.update(seoSettings).set(updateData).where(eq(seoSettings.id, existing.id)).returning();
      return updated;
    } else {
      const [created] = await db.insert(seoSettings).values(settings).returning();
      return created;
    }
  }
  // Analytics Scripts
  async getAnalyticsScript(id) {
    const [script] = await db.select().from(analyticsScripts).where(eq(analyticsScripts.id, id));
    return script;
  }
  async getAllAnalyticsScripts() {
    return db.select().from(analyticsScripts).orderBy(desc(analyticsScripts.loadPriority), asc(analyticsScripts.createdAt));
  }
  async getEnabledAnalyticsScripts() {
    return db.select().from(analyticsScripts).where(eq(analyticsScripts.enabled, true)).orderBy(desc(analyticsScripts.loadPriority), asc(analyticsScripts.createdAt));
  }
  async createAnalyticsScript(script) {
    const [created] = await db.insert(analyticsScripts).values(script).returning();
    return created;
  }
  async updateAnalyticsScript(id, script) {
    const updateData = { ...script, updatedAt: /* @__PURE__ */ new Date() };
    await db.update(analyticsScripts).set(updateData).where(eq(analyticsScripts.id, id));
  }
  async deleteAnalyticsScript(id) {
    await db.delete(analyticsScripts).where(eq(analyticsScripts.id, id));
  }
  // Payment Transactions
  async getPaymentTransaction(id) {
    const [transaction] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.id, id));
    return transaction;
  }
  async getPaymentTransactionByGatewayId(gateway, gatewayTransactionId) {
    const [transaction] = await db.select().from(paymentTransactions).where(and(
      eq(paymentTransactions.gateway, gateway),
      eq(paymentTransactions.gatewayTransactionId, gatewayTransactionId)
    ));
    return transaction;
  }
  async getUserPaymentTransactions(userId) {
    return db.select().from(paymentTransactions).where(eq(paymentTransactions.userId, userId)).orderBy(desc(paymentTransactions.createdAt));
  }
  async getAllPaymentTransactions(filters) {
    const conditions = [];
    if (filters?.gateway) {
      conditions.push(eq(paymentTransactions.gateway, filters.gateway));
    }
    if (filters?.type) {
      conditions.push(eq(paymentTransactions.type, filters.type));
    }
    if (filters?.status) {
      conditions.push(eq(paymentTransactions.status, filters.status));
    }
    if (filters?.startDate) {
      conditions.push(gte(paymentTransactions.createdAt, filters.startDate));
    }
    if (filters?.endDate) {
      conditions.push(lte(paymentTransactions.createdAt, filters.endDate));
    }
    if (conditions.length > 0) {
      return db.select().from(paymentTransactions).where(and(...conditions)).orderBy(desc(paymentTransactions.createdAt));
    }
    return db.select().from(paymentTransactions).orderBy(desc(paymentTransactions.createdAt));
  }
  async createPaymentTransaction(transaction) {
    const [created] = await db.insert(paymentTransactions).values(transaction).returning();
    return created;
  }
  async updatePaymentTransaction(id, transaction) {
    await db.update(paymentTransactions).set({ ...transaction, updatedAt: /* @__PURE__ */ new Date() }).where(eq(paymentTransactions.id, id));
  }
  async getPaymentAnalytics(startDate, endDate) {
    const revenueStatuses = ["completed", "refunded", "partially_refunded"];
    const conditions = [];
    if (startDate) conditions.push(gte(paymentTransactions.createdAt, startDate));
    if (endDate) conditions.push(lte(paymentTransactions.createdAt, endDate));
    const transactions = await db.select().from(paymentTransactions).where(
      conditions.length > 0 ? and(
        inArray(paymentTransactions.status, revenueStatuses),
        ...conditions
      ) : inArray(paymentTransactions.status, revenueStatuses)
    );
    const dateConditions = [];
    if (startDate) dateConditions.push(gte(paymentTransactions.createdAt, startDate));
    if (endDate) dateConditions.push(lte(paymentTransactions.createdAt, endDate));
    const allTransactions = await db.select().from(paymentTransactions).where(dateConditions.length > 0 ? and(...dateConditions) : void 0);
    const refundConditions = [];
    if (startDate) refundConditions.push(gte(refunds.createdAt, startDate));
    if (endDate) refundConditions.push(lte(refunds.createdAt, endDate));
    const allRefunds = await db.select().from(refunds).where(refundConditions.length > 0 ? and(...refundConditions) : void 0);
    let totalRevenue = 0;
    const revenueByGateway = {};
    const revenueByType = {};
    const transactionsByStatus = {};
    for (const tx of transactions) {
      const amount = parseFloat(tx.amount || "0");
      totalRevenue += amount;
      revenueByGateway[tx.gateway] = (revenueByGateway[tx.gateway] || 0) + amount;
      revenueByType[tx.type] = (revenueByType[tx.type] || 0) + amount;
    }
    for (const tx of allTransactions) {
      transactionsByStatus[tx.status] = (transactionsByStatus[tx.status] || 0) + 1;
    }
    let totalRefunded = 0;
    for (const refund of allRefunds) {
      totalRefunded += parseFloat(refund.amount || "0");
    }
    return {
      totalRevenue,
      revenueByGateway,
      revenueByType,
      transactionCount: allTransactions.length,
      transactionsByStatus,
      refundCount: allRefunds.length,
      totalRefunded
    };
  }
  // Refunds
  async getRefund(id) {
    const [refund] = await db.select().from(refunds).where(eq(refunds.id, id));
    return refund;
  }
  async getTransactionRefunds(transactionId) {
    return db.select().from(refunds).where(eq(refunds.transactionId, transactionId)).orderBy(desc(refunds.createdAt));
  }
  async getUserRefunds(userId) {
    return db.select().from(refunds).where(eq(refunds.userId, userId)).orderBy(desc(refunds.createdAt));
  }
  async getAllRefunds() {
    return db.select().from(refunds).orderBy(desc(refunds.createdAt));
  }
  async createRefund(refund) {
    const [created] = await db.insert(refunds).values(refund).returning();
    return created;
  }
  async updateRefund(id, refund) {
    await db.update(refunds).set({ ...refund, updatedAt: /* @__PURE__ */ new Date() }).where(eq(refunds.id, id));
  }
  // Invoices
  async getInvoice(id) {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
    return invoice;
  }
  async getInvoiceByNumber(invoiceNumber) {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.invoiceNumber, invoiceNumber));
    return invoice;
  }
  async getTransactionInvoice(transactionId) {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.transactionId, transactionId));
    return invoice;
  }
  async getUserInvoices(userId) {
    return db.select().from(invoices).where(eq(invoices.userId, userId)).orderBy(desc(invoices.createdAt));
  }
  async getAllInvoices() {
    return db.select().from(invoices).orderBy(desc(invoices.createdAt));
  }
  async createInvoice(invoice) {
    const [created] = await db.insert(invoices).values(invoice).returning();
    return created;
  }
  async updateInvoice(id, invoice) {
    await db.update(invoices).set({ ...invoice, updatedAt: /* @__PURE__ */ new Date() }).where(eq(invoices.id, id));
  }
  async getNextInvoiceNumber() {
    const year = (/* @__PURE__ */ new Date()).getFullYear();
    const [prefixSetting] = await db.select().from(globalSettings).where(eq(globalSettings.key, "invoice_prefix"));
    let rawPrefix = prefixSetting?.value ? String(prefixSetting.value).replace(/"/g, "") : "INV";
    const prefix = rawPrefix.replace(/[^A-Za-z0-9_]/g, "").substring(0, 10) || "INV";
    const [startSetting] = await db.select().from(globalSettings).where(eq(globalSettings.key, "invoice_start_number"));
    const startNumber = startSetting?.value ? parseInt(String(startSetting.value).replace(/"/g, ""), 10) || 1 : 1;
    const likePattern = `${prefix}-${year}-%`;
    const result = await db.execute(sql`
      SELECT MAX(CAST(SPLIT_PART(${invoices.invoiceNumber}, '-', 3) AS INTEGER)) as max_num
      FROM ${invoices}
      WHERE ${invoices.invoiceNumber} LIKE ${likePattern}
    `);
    let nextNum = startNumber;
    const maxNum = result.rows?.[0]?.max_num;
    if (maxNum !== null && maxNum !== void 0 && !isNaN(Number(maxNum))) {
      nextNum = Math.max(Number(maxNum) + 1, startNumber);
    }
    return `${prefix}-${year}-${String(nextNum).padStart(5, "0")}`;
  }
  async getNextRefundNoteNumber() {
    const [prefixSetting] = await db.select().from(globalSettings).where(eq(globalSettings.key, "refund_note_prefix"));
    let rawPrefix = prefixSetting?.value ? String(prefixSetting.value).replace(/"/g, "") : "RF";
    const prefix = rawPrefix.replace(/[^A-Za-z0-9]/g, "").substring(0, 10) || "RF";
    const result = await db.execute(sql`
      SELECT MAX(
        CAST(
          REGEXP_REPLACE(refund_note_number, '^[A-Za-z]+', '', 'g') 
          AS INTEGER
        )
      ) as max_num
      FROM refunds
      WHERE refund_note_number ~ ${`^${prefix}[0-9]+$`}
    `);
    let nextNum = 1;
    const maxNum = result.rows?.[0]?.max_num;
    if (maxNum !== null && maxNum !== void 0 && !isNaN(Number(maxNum))) {
      nextNum = Number(maxNum) + 1;
    }
    return `${prefix}${String(nextNum).padStart(2, "0")}`;
  }
  // Payment Webhook Queue
  async getWebhookQueueItem(id) {
    const [item] = await db.select().from(paymentWebhookQueue).where(eq(paymentWebhookQueue.id, id));
    return item;
  }
  async getPendingWebhooks() {
    return db.select().from(paymentWebhookQueue).where(eq(paymentWebhookQueue.status, "pending")).orderBy(asc(paymentWebhookQueue.receivedAt));
  }
  async getWebhookByEventId(gateway, eventId) {
    const [item] = await db.select().from(paymentWebhookQueue).where(and(
      eq(paymentWebhookQueue.gateway, gateway),
      eq(paymentWebhookQueue.eventId, eventId)
    ));
    return item;
  }
  async createWebhookQueueItem(item) {
    const [created] = await db.insert(paymentWebhookQueue).values(item).returning();
    return created;
  }
  async updateWebhookQueueItem(id, item) {
    await db.update(paymentWebhookQueue).set(item).where(eq(paymentWebhookQueue.id, id));
  }
  async getExpiredWebhooks() {
    const now = /* @__PURE__ */ new Date();
    return db.select().from(paymentWebhookQueue).where(and(
      eq(paymentWebhookQueue.status, "pending"),
      lte(paymentWebhookQueue.expiresAt, now)
    ));
  }
  async getRetryableWebhooks() {
    const now = /* @__PURE__ */ new Date();
    return db.select().from(paymentWebhookQueue).where(and(
      or(
        eq(paymentWebhookQueue.status, "pending"),
        eq(paymentWebhookQueue.status, "failed")
      ),
      sql`${paymentWebhookQueue.attemptCount} < ${paymentWebhookQueue.maxAttempts}`,
      or(
        isNull(paymentWebhookQueue.nextRetryAt),
        lte(paymentWebhookQueue.nextRetryAt, now)
      ),
      gte(paymentWebhookQueue.expiresAt, now)
    )).orderBy(asc(paymentWebhookQueue.receivedAt));
  }
  // Email Notification Settings
  async getEmailNotificationSetting(eventType) {
    const [setting] = await db.select().from(emailNotificationSettings).where(eq(emailNotificationSettings.eventType, eventType));
    return setting;
  }
  async getAllEmailNotificationSettings() {
    return db.select().from(emailNotificationSettings).orderBy(asc(emailNotificationSettings.category), asc(emailNotificationSettings.eventType));
  }
  async getEmailNotificationSettingsByCategory(category) {
    return db.select().from(emailNotificationSettings).where(eq(emailNotificationSettings.category, category)).orderBy(asc(emailNotificationSettings.eventType));
  }
  async createEmailNotificationSetting(setting) {
    const [created] = await db.insert(emailNotificationSettings).values(setting).returning();
    return created;
  }
  async updateEmailNotificationSetting(eventType, setting) {
    await db.update(emailNotificationSettings).set({ ...setting, updatedAt: /* @__PURE__ */ new Date() }).where(eq(emailNotificationSettings.eventType, eventType));
  }
  // Admin Call Monitoring
  async getAdminCalls(options) {
    const page = options.page || 1;
    const pageSize = options.pageSize || 20;
    const offset = (page - 1) * pageSize;
    const conditions = [];
    if (options.userId) {
      conditions.push(eq(calls.userId, options.userId));
    }
    if (options.status) {
      conditions.push(eq(calls.status, options.status));
    }
    if (options.startDate) {
      conditions.push(gte(calls.createdAt, options.startDate));
    }
    if (options.endDate) {
      conditions.push(lte(calls.createdAt, options.endDate));
    }
    if (options.search) {
      conditions.push(
        or(
          sql`${calls.phoneNumber} ILIKE ${`%${options.search}%`}`,
          sql`${calls.transcript} ILIKE ${`%${options.search}%`}`
        )
      );
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : void 0;
    const violationCountSubquery = db.select({
      callId: contentViolations.callId,
      count: sql`count(*)`.as("violation_count"),
      summary: sql`string_agg(${contentViolations.detectedWord}, ', ' ORDER BY ${contentViolations.createdAt} DESC)`.as("violation_summary")
    }).from(contentViolations).groupBy(contentViolations.callId).as("violation_counts");
    let query = db.select({
      call: calls,
      user: {
        id: users.id,
        email: users.email,
        name: users.name
      },
      campaign: {
        id: campaigns.id,
        name: campaigns.name
      },
      violationCount: sql`COALESCE(${violationCountSubquery.count}, 0)`,
      violationSummary: sql`${violationCountSubquery.summary}`
    }).from(calls).leftJoin(users, eq(calls.userId, users.id)).leftJoin(campaigns, eq(calls.campaignId, campaigns.id)).leftJoin(violationCountSubquery, eq(calls.id, violationCountSubquery.callId));
    if (whereClause) {
      query = query.where(whereClause);
    }
    if (options.hasViolations === true) {
      query = query.where(sql`COALESCE(${violationCountSubquery.count}, 0) > 0`);
    } else if (options.hasViolations === false) {
      query = query.where(sql`COALESCE(${violationCountSubquery.count}, 0) = 0`);
    }
    const results = await query.orderBy(desc(calls.createdAt)).limit(pageSize).offset(offset);
    const countResult = await db.select({ count: sql`count(*)` }).from(calls).where(whereClause);
    const totalItems = Number(countResult[0]?.count || 0);
    const totalPages = Math.ceil(totalItems / pageSize);
    return {
      data: results.map((r) => ({
        ...r.call,
        user: r.user,
        campaign: r.campaign,
        violationCount: Number(r.violationCount),
        violationSummary: r.violationSummary || null
      })),
      pagination: { page, pageSize, totalItems, totalPages }
    };
  }
  async getAdminCallById(id) {
    const [result] = await db.select({
      call: calls,
      user: {
        id: users.id,
        email: users.email,
        name: users.name
      },
      campaign: {
        id: campaigns.id,
        name: campaigns.name
      },
      contact: {
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        phone: contacts.phone,
        email: contacts.email
      }
    }).from(calls).leftJoin(users, eq(calls.userId, users.id)).leftJoin(campaigns, eq(calls.campaignId, campaigns.id)).leftJoin(contacts, eq(calls.contactId, contacts.id)).where(eq(calls.id, id));
    if (!result) return void 0;
    const violations = await this.getViolationsByCallId(id);
    return {
      ...result.call,
      user: result.user,
      campaign: result.campaign,
      contact: result.contact,
      violations
    };
  }
  async getUserById(id) {
    return this.getUser(id);
  }
  // Content Violations
  async getViolationsByCallId(callId) {
    return db.select().from(contentViolations).where(eq(contentViolations.callId, callId)).orderBy(desc(contentViolations.createdAt));
  }
  async getContentViolations(options) {
    const page = options.page || 1;
    const pageSize = options.pageSize || 20;
    const offset = (page - 1) * pageSize;
    const conditions = [];
    if (options.userId) {
      conditions.push(eq(contentViolations.userId, options.userId));
    }
    if (options.status) {
      conditions.push(eq(contentViolations.status, options.status));
    }
    if (options.severity) {
      conditions.push(eq(contentViolations.severity, options.severity));
    }
    if (options.startDate) {
      conditions.push(gte(contentViolations.createdAt, options.startDate));
    }
    if (options.endDate) {
      conditions.push(lte(contentViolations.createdAt, options.endDate));
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : void 0;
    let query = db.select({
      violation: contentViolations,
      user: {
        id: users.id,
        email: users.email,
        name: users.name
      },
      call: {
        id: calls.id,
        phoneNumber: calls.phoneNumber,
        status: calls.status
      }
    }).from(contentViolations).leftJoin(users, eq(contentViolations.userId, users.id)).leftJoin(calls, eq(contentViolations.callId, calls.id));
    if (whereClause) {
      query = query.where(whereClause);
    }
    const results = await query.orderBy(desc(contentViolations.createdAt)).limit(pageSize).offset(offset);
    const countResult = await db.select({ count: sql`count(*)` }).from(contentViolations).where(whereClause);
    const totalItems = Number(countResult[0]?.count || 0);
    const totalPages = Math.ceil(totalItems / pageSize);
    return {
      data: results.map((r) => ({
        ...r.violation,
        user: r.user,
        call: r.call
      })),
      pagination: { page, pageSize, totalItems, totalPages }
    };
  }
  async updateContentViolation(id, data) {
    const [updated] = await db.update(contentViolations).set(data).where(eq(contentViolations.id, id)).returning();
    return updated;
  }
  async createContentViolation(data) {
    const [violation] = await db.insert(contentViolations).values(data).returning();
    return violation;
  }
  // Banned Words
  async getBannedWords() {
    return db.select().from(bannedWords).orderBy(asc(bannedWords.word));
  }
  async getActiveBannedWords() {
    return db.select().from(bannedWords).where(eq(bannedWords.isActive, true)).orderBy(asc(bannedWords.word));
  }
  async createBannedWord(data) {
    const [word] = await db.insert(bannedWords).values(data).returning();
    return word;
  }
  async updateBannedWord(id, data) {
    const [updated] = await db.update(bannedWords).set({ ...data, updatedAt: /* @__PURE__ */ new Date() }).where(eq(bannedWords.id, id)).returning();
    return updated;
  }
  async deleteBannedWord(id) {
    const result = await db.delete(bannedWords).where(eq(bannedWords.id, id)).returning();
    return result.length > 0;
  }
  async getCallsWithTranscripts() {
    return db.select().from(calls).where(and(
      isNotNull(calls.transcript),
      sql`${calls.transcript} != ''`
    ));
  }
  // Demo Sessions - Browser-based demo calls
  async createDemoSession(data) {
    const [session] = await db.insert(demoSessions).values(data).returning();
    return session;
  }
  async getDemoSession(id) {
    const [session] = await db.select().from(demoSessions).where(eq(demoSessions.id, id));
    return session;
  }
  async getDemoSessionByToken(token) {
    const [session] = await db.select().from(demoSessions).where(eq(demoSessions.sessionToken, token));
    return session;
  }
  async updateDemoSession(id, data) {
    await db.update(demoSessions).set(data).where(eq(demoSessions.id, id));
  }
  async getActiveDemoSessionCount() {
    const result = await db.select({ count: sql`count(*)` }).from(demoSessions).where(eq(demoSessions.status, "active"));
    return Number(result[0]?.count || 0);
  }
  async getRecentDemoSessionByIp(ip, cooldownMinutes) {
    const cooldownTime = new Date(Date.now() - cooldownMinutes * 60 * 1e3);
    const [session] = await db.select().from(demoSessions).where(and(
      eq(demoSessions.visitorIp, ip),
      gte(demoSessions.createdAt, cooldownTime)
    )).orderBy(desc(demoSessions.createdAt)).limit(1);
    return session;
  }
  async getDemoSessionStats(days = 30) {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1e3);
    const sessions = await db.select().from(demoSessions).where(gte(demoSessions.createdAt, startDate));
    const completed = sessions.filter((s) => s.status === "completed");
    const totalDuration = completed.reduce((sum, s) => sum + (s.duration || 0), 0);
    const languageBreakdown = {};
    for (const session of sessions) {
      languageBreakdown[session.language] = (languageBreakdown[session.language] || 0) + 1;
    }
    return {
      totalSessions: sessions.length,
      completedSessions: completed.length,
      averageDuration: completed.length > 0 ? Math.round(totalDuration / completed.length) : 0,
      languageBreakdown
    };
  }
}
const storage = new DbStorage();
export {
  DbStorage,
  storage
};
