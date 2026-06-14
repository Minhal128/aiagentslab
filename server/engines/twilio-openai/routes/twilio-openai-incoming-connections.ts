import { Router, Response } from "express";
import { db } from "../../../db";
import { incomingConnections, agents, phoneNumbers, insertIncomingConnectionSchema, campaigns } from "@shared/schema";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { authenticateToken, type AuthRequest } from "../../../middleware/auth";
import { getDomain } from "../../../utils/domain";

const router = Router();

router.get("/", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const connections = await db
      .select({
        id: incomingConnections.id,
        agentId: incomingConnections.agentId,
        phoneNumberId: incomingConnections.phoneNumberId,
        createdAt: incomingConnections.createdAt,
        updatedAt: incomingConnections.updatedAt,
        agent: {
          id: agents.id,
          name: agents.name,
          language: agents.language,
          systemPrompt: agents.systemPrompt,
          personality: agents.personality,
          voiceTone: agents.voiceTone,
          firstMessage: agents.firstMessage,
          transferPhoneNumber: agents.transferPhoneNumber,
          transferEnabled: agents.transferEnabled,
          openaiVoice: agents.openaiVoice,
        },
        phoneNumber: {
          id: phoneNumbers.id,
          phoneNumber: phoneNumbers.phoneNumber,
          friendlyName: phoneNumbers.friendlyName,
          country: phoneNumbers.country,
          status: phoneNumbers.status,
        },
      })
      .from(incomingConnections)
      .leftJoin(agents, eq(incomingConnections.agentId, agents.id))
      .leftJoin(phoneNumbers, eq(incomingConnections.phoneNumberId, phoneNumbers.id))
      .where(
        and(
          eq(incomingConnections.userId, userId),
          eq(agents.telephonyProvider, "twilio_openai")
        )
      );

    // Get ALL incoming connections for this user (any telephony provider) to avoid conflicts
    const allUserConnections = await db
      .select({ phoneNumberId: incomingConnections.phoneNumberId })
      .from(incomingConnections)
      .where(eq(incomingConnections.userId, userId));
    
    const allConnectedPhoneIds = allUserConnections.map((c) => c.phoneNumberId);
    
    // Include both 'active' (user-purchased) and 'assigned' (admin-assigned) phone numbers
    const availableNumbers = await db
      .select()
      .from(phoneNumbers)
      .where(
        and(
          eq(phoneNumbers.userId, userId),
          eq(phoneNumbers.isSystemPool, false),
          inArray(phoneNumbers.status, ["active", "assigned"])
        )
      );

    // Filter out ALL phone numbers that are already connected (any engine)
    const availablePhoneNumbers = availableNumbers.filter(
      (pn) => !allConnectedPhoneIds.includes(pn.id)
    );

    const activeStatuses = ['pending', 'running', 'scheduled', 'paused'];
    const phoneIdsToCheck = availablePhoneNumbers.map(pn => pn.id);
    
    const activeCampaigns = phoneIdsToCheck.length > 0 ? await db
      .select({
        phoneNumberId: campaigns.phoneNumberId,
        campaignName: campaigns.name,
        campaignStatus: campaigns.status,
      })
      .from(campaigns)
      .where(
        and(
          inArray(campaigns.phoneNumberId, phoneIdsToCheck),
          inArray(campaigns.status, activeStatuses),
          isNull(campaigns.deletedAt)
        )
      ) : [];

    const conflictMap = new Map<string, { campaignName: string; campaignStatus: string }>();
    for (const campaign of activeCampaigns) {
      if (campaign.phoneNumberId && !conflictMap.has(campaign.phoneNumberId)) {
        conflictMap.set(campaign.phoneNumberId, {
          campaignName: campaign.campaignName,
          campaignStatus: campaign.campaignStatus,
        });
      }
    }

    const availablePhoneNumbersWithConflict = availablePhoneNumbers.map(pn => {
      const conflict = conflictMap.get(pn.id);
      return {
        ...pn,
        isConflicted: !!conflict,
        conflictReason: conflict 
          ? `Used by campaign "${conflict.campaignName}" (${conflict.campaignStatus})`
          : null,
        conflictCampaignName: conflict?.campaignName || null,
        conflictCampaignStatus: conflict?.campaignStatus || null,
      };
    });

    const twilioOpenaiAgents = await db
      .select()
      .from(agents)
      .where(
        and(
          eq(agents.userId, userId), 
          eq(agents.type, "incoming"), 
          eq(agents.isActive, true),
          eq(agents.telephonyProvider, "twilio_openai")
        )
      );

    res.json({
      connections,
      availablePhoneNumbers: availablePhoneNumbersWithConflict,
      availableAgents: twilioOpenaiAgents,
      stats: {
        totalConnections: connections.length,
        availableNumbers: availablePhoneNumbersWithConflict.filter(pn => !pn.isConflicted).length,
        totalAgents: twilioOpenaiAgents.length,
      },
    });
  } catch (error: any) {
    console.error("[Twilio-OpenAI] Error fetching incoming connections:", error);
    res.status(500).json({ message: "Failed to fetch incoming connections" });
  }
});

router.post("/", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const validatedData = insertIncomingConnectionSchema.parse({
      ...req.body,
      userId,
    });

    const { agentId, phoneNumberId } = validatedData;

    const agent = await db
      .select()
      .from(agents)
      .where(
        and(
          eq(agents.id, agentId), 
          eq(agents.userId, userId), 
          eq(agents.type, "incoming"),
          eq(agents.telephonyProvider, "twilio_openai")
        )
      )
      .limit(1);

    if (!agent.length) {
      return res.status(404).json({ message: "Twilio+OpenAI incoming agent not found" });
    }

    const phoneNumber = await db
      .select({
        id: phoneNumbers.id,
        phoneNumber: phoneNumbers.phoneNumber,
        twilioSid: phoneNumbers.twilioSid,
        userId: phoneNumbers.userId,
        isSystemPool: phoneNumbers.isSystemPool,
      })
      .from(phoneNumbers)
      .where(
        and(
          eq(phoneNumbers.id, phoneNumberId),
          eq(phoneNumbers.userId, userId),
          eq(phoneNumbers.isSystemPool, false)
        )
      )
      .limit(1);

    if (!phoneNumber.length) {
      return res.status(404).json({ message: "Phone number not found or not owned by user" });
    }

    const existingConnection = await db
      .select()
      .from(incomingConnections)
      .where(eq(incomingConnections.phoneNumberId, phoneNumberId))
      .limit(1);

    if (existingConnection.length) {
      return res.status(400).json({ message: "Phone number is already connected to an agent" });
    }

    const [newConnection] = await db
      .insert(incomingConnections)
      .values({
        userId,
        agentId,
        phoneNumberId,
      })
      .returning();

    const domain = getDomain();
    const webhookUrl = `${domain}/api/twilio-openai/voice/incoming`;
    
    try {
      const { twilioService } = await import("../../../services/twilio");
      await twilioService.updatePhoneNumber(phoneNumber[0].twilioSid!, { voiceUrl: webhookUrl });
      console.log(`[Twilio-OpenAI] Updated webhook for ${phoneNumber[0].phoneNumber} to ${webhookUrl}`);
    } catch (webhookError: any) {
      console.error("[Twilio-OpenAI] Failed to update webhook:", webhookError);
    }

    res.status(201).json({
      message: "Incoming connection created",
      connection: newConnection,
    });
  } catch (error: any) {
    console.error("[Twilio-OpenAI] Error creating incoming connection:", error);
    if (error.name === "ZodError") {
      return res.status(400).json({ message: "Validation error", errors: error.errors });
    }
    res.status(500).json({ message: "Failed to create incoming connection" });
  }
});

// POST /api/twilio-openai/incoming-connections/:id/resync-webhook - Resync webhook URL for existing connection
router.post("/:id/resync-webhook", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const connection = await db
      .select({
        id: incomingConnections.id,
        phoneNumberId: incomingConnections.phoneNumberId,
        phoneNumber: phoneNumbers.phoneNumber,
        twilioSid: phoneNumbers.twilioSid,
      })
      .from(incomingConnections)
      .leftJoin(phoneNumbers, eq(incomingConnections.phoneNumberId, phoneNumbers.id))
      .where(and(eq(incomingConnections.id, id), eq(incomingConnections.userId, userId)))
      .limit(1);

    if (!connection.length) {
      return res.status(404).json({ message: "Connection not found" });
    }

    const domain = getDomain();
    const webhookUrl = `${domain}/api/twilio-openai/voice/incoming`;

    try {
      const { twilioService } = await import("../../../services/twilio");
      await twilioService.updatePhoneNumber(connection[0].twilioSid!, { voiceUrl: webhookUrl });
      console.log(`[Twilio-OpenAI] Resynced webhook for ${connection[0].phoneNumber} to ${webhookUrl}`);
      res.json({ message: "Webhook URL updated successfully", webhookUrl });
    } catch (webhookError: any) {
      console.error("[Twilio-OpenAI] Failed to resync webhook:", webhookError);
      res.status(500).json({ message: "Failed to update webhook URL", error: webhookError.message });
    }
  } catch (error: any) {
    console.error("[Twilio-OpenAI] Error resyncing webhook:", error);
    res.status(500).json({ message: "Failed to resync webhook" });
  }
});

router.delete("/:id", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const connection = await db
      .select({
        id: incomingConnections.id,
        phoneNumberId: incomingConnections.phoneNumberId,
        phoneNumber: phoneNumbers.phoneNumber,
        twilioSid: phoneNumbers.twilioSid,
      })
      .from(incomingConnections)
      .leftJoin(phoneNumbers, eq(incomingConnections.phoneNumberId, phoneNumbers.id))
      .where(and(eq(incomingConnections.id, id), eq(incomingConnections.userId, userId)))
      .limit(1);

    if (!connection.length) {
      return res.status(404).json({ message: "Connection not found" });
    }

    await db.delete(incomingConnections).where(eq(incomingConnections.id, id));

    res.json({ message: "Incoming connection deleted" });
  } catch (error: any) {
    console.error("[Twilio-OpenAI] Error deleting incoming connection:", error);
    res.status(500).json({ message: "Failed to delete incoming connection" });
  }
});

export const twilioOpenaiIncomingConnectionsRoutes = router;
