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
import { Router } from "express";
import { db } from "../db";
import { incomingConnections, agents, phoneNumbers, insertIncomingConnectionSchema, campaigns } from "@shared/schema";
import { eq, and, isNull, or, inArray, ne } from "drizzle-orm";
import { type AuthRequest } from "../middleware/auth";
import { authenticateHybrid } from "../middleware/hybrid-auth";
import { twilioService } from "../services/twilio";
import { getDomain } from "../utils/domain";
import { PhoneMigrator } from "../engines/elevenlabs-migration";

const router = Router();

// GET /api/incoming-connections - List all connections for the user
router.get("/", authenticateHybrid, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Get all connections with agent and phone number details
    // Filter to only include Twilio + ElevenLabs connections (exclude plivo and twilio_openai agents)
    const allConnections = await db
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
          elevenLabsAgentId: agents.elevenLabsAgentId,
          systemPrompt: agents.systemPrompt,
          personality: agents.personality,
          voiceTone: agents.voiceTone,
          firstMessage: agents.firstMessage,
          transferPhoneNumber: agents.transferPhoneNumber,
          transferEnabled: agents.transferEnabled,
          telephonyProvider: agents.telephonyProvider,
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
      .where(eq(incomingConnections.userId, userId));
    
    // Filter out connections with OpenAI-based agents (plivo or twilio_openai) for UI display
    const connections = allConnections.filter(c => {
      const provider = c.agent?.telephonyProvider;
      return !provider || provider === 'twilio'; // Include null/undefined or 'twilio' (ElevenLabs)
    });

    // Get available phone numbers (owned by user, not in system pool, not already connected)
    // Use ALL connections (not filtered) to compute availability - prevents showing numbers already assigned to other engines
    const connectedPhoneIds = allConnections.map((c) => c.phoneNumberId);
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

    const availablePhoneNumbers = availableNumbers.filter(
      (pn) => !connectedPhoneIds.includes(pn.id)
    );

    // Check which available phones have active campaign conflicts
    // Active campaigns = pending, running, scheduled, paused
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

    // Create a map of phone ID -> campaign conflict info
    const conflictMap = new Map<string, { campaignName: string; campaignStatus: string }>();
    for (const campaign of activeCampaigns) {
      if (campaign.phoneNumberId && !conflictMap.has(campaign.phoneNumberId)) {
        conflictMap.set(campaign.phoneNumberId, {
          campaignName: campaign.campaignName,
          campaignStatus: campaign.campaignStatus,
        });
      }
    }

    // Enhance available phone numbers with conflict status
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

    // Get incoming agents (type='incoming') for connection selection
    // Filter to only include Twilio + ElevenLabs agents (exclude plivo and twilio_openai)
    const allIncomingAgents = await db
      .select()
      .from(agents)
      .where(and(eq(agents.userId, userId), eq(agents.type, "incoming"), eq(agents.isActive, true)));
    
    // Filter out OpenAI-based agents
    const incomingAgents = allIncomingAgents.filter(a => {
      const provider = a.telephonyProvider;
      return !provider || provider === 'twilio'; // Include null/undefined or 'twilio' (ElevenLabs)
    });

    res.json({
      connections,
      allConnections,
      availablePhoneNumbers: availablePhoneNumbersWithConflict,
      incomingAgents,
      stats: {
        totalConnections: allConnections.length,
        elevenLabsConnections: connections.length,
        availableNumbers: availablePhoneNumbersWithConflict.filter(pn => !pn.isConflicted).length,
        totalAgents: incomingAgents.length,
      },
    });
  } catch (error: any) {
    console.error("Error fetching incoming connections:", error);
    res.status(500).json({ message: "Failed to fetch incoming connections" });
  }
});

// POST /api/incoming-connections - Create a new connection
router.post("/", authenticateHybrid, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Validate request body using Zod schema
    const validatedData = insertIncomingConnectionSchema.parse({
      ...req.body,
      userId,
    });

    const { agentId, phoneNumberId } = validatedData;

    // Verify agent exists, belongs to user, and is type='incoming'
    const agent = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.userId, userId), eq(agents.type, "incoming")))
      .limit(1);

    if (!agent.length) {
      return res.status(404).json({ message: "Incoming agent not found or invalid type" });
    }

    // Verify phone number exists, belongs to user, and is not in system pool
    const phoneNumber = await db
      .select({
        id: phoneNumbers.id,
        phoneNumber: phoneNumbers.phoneNumber,
        twilioSid: phoneNumbers.twilioSid,
        elevenLabsPhoneNumberId: phoneNumbers.elevenLabsPhoneNumberId,
        elevenLabsCredentialId: phoneNumbers.elevenLabsCredentialId,
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

    // Check if phone number is already connected (new system)
    const existingConnection = await db
      .select()
      .from(incomingConnections)
      .where(eq(incomingConnections.phoneNumberId, phoneNumberId))
      .limit(1);

    if (existingConnection.length) {
      return res.status(400).json({ message: "Phone number is already connected to an agent" });
    }

    // Check if phone number has assignment via deprecated incoming_agents system
    const deprecatedAssignment = await db
      .select({
        assignedIncomingAgentId: phoneNumbers.assignedIncomingAgentId,
      })
      .from(phoneNumbers)
      .where(eq(phoneNumbers.id, phoneNumberId))
      .limit(1);

    if (deprecatedAssignment.length && deprecatedAssignment[0].assignedIncomingAgentId) {
      return res.status(400).json({ 
        message: "Phone number is assigned via legacy system. Please unassign it first.",
        legacySystem: true 
      });
    }

    // ========================================
    // PHONE CONFLICT CHECK: Ensure phone is not being used by active campaigns
    // A phone used for outbound campaigns cannot be used for incoming calls
    // ========================================
    const activeCampaignStatuses = ['pending', 'running', 'scheduled', 'paused'];
    const activeCampaignCheck = await db
      .select({ id: campaigns.id, name: campaigns.name, status: campaigns.status })
      .from(campaigns)
      .where(
        and(
          eq(campaigns.phoneNumberId, phoneNumberId),
          or(
            eq(campaigns.status, 'pending'),
            eq(campaigns.status, 'running'),
            eq(campaigns.status, 'scheduled'),
            eq(campaigns.status, 'paused')
          )
        )
      )
      .limit(1);
    
    if (activeCampaignCheck.length > 0) {
      const campaign = activeCampaignCheck[0];
      return res.status(409).json({
        message: `This phone number is being used by campaign "${campaign.name}" (status: ${campaign.status}). A phone number can only be used for either incoming calls OR outbound campaigns, not both.`,
        error: "Phone number conflict",
        suggestion: "Please either purchase a new phone number for incoming calls, or wait for the campaign to complete (or cancel it) and select a different phone number for the campaign.",
        conflictType: "active_campaign",
        campaignName: campaign.name,
        campaignStatus: campaign.status
      });
    }

    // ========================================
    // PRE-FLIGHT CHECKS (before creating connection)
    // Order: Credential check → Migration → Verification
    // ========================================
    
    // Import pool service for credential management
    const elevenLabsPoolModule = await import('../services/elevenlabs-pool');
    
    // STEP 0: Ensure agent is synced with ElevenLabs (has elevenLabsAgentId)
    if (!agent[0].elevenLabsAgentId) {
      return res.status(400).json({
        message: "Agent is not synced with ElevenLabs. Please sync the agent first before connecting a phone number.",
        error: "Agent missing elevenLabsAgentId",
        suggestion: "Go to Agents and ensure the agent is properly synced with ElevenLabs."
      });
    }
    
    // STEP 1: Ensure agent has a credential (auto-assign if missing)
    let agentCredentialId = agent[0].elevenLabsCredentialId;
    if (!agentCredentialId) {
      console.log(`📞 [Incoming Connection] Agent missing credential - auto-assigning from pool...`);
      const leastLoadedCredential = await elevenLabsPoolModule.ElevenLabsPoolService.getLeastLoadedCredential();
      
      if (!leastLoadedCredential) {
        return res.status(400).json({
          message: "No active ElevenLabs credentials available. Please configure ElevenLabs API keys in admin settings.",
          error: "No active credentials in pool"
        });
      }
      
      // Update the agent with the assigned credential
      await db.update(agents)
        .set({ elevenLabsCredentialId: leastLoadedCredential.id })
        .where(eq(agents.id, agent[0].id));
      
      await elevenLabsPoolModule.ElevenLabsPoolService.updateAssignmentCount(leastLoadedCredential.id, true);
      
      agentCredentialId = leastLoadedCredential.id;
      agent[0].elevenLabsCredentialId = leastLoadedCredential.id;
      console.log(`✅ [Incoming Connection] Credential auto-assigned: ${leastLoadedCredential.name}`);
    }
    
    // STEP 2: Check credential alignment and migrate if needed
    // This must happen BEFORE verification to ensure phone is on correct account
    if (phoneNumber[0].elevenLabsCredentialId && 
        phoneNumber[0].elevenLabsCredentialId !== agentCredentialId) {
      console.log(`📞 [Incoming Connection] Phone on different credential - initiating migration`);
      console.log(`   Phone credential: ${phoneNumber[0].elevenLabsCredentialId}`);
      console.log(`   Agent credential: ${agentCredentialId}`);
      
      try {
        const migrationResult = await PhoneMigrator.syncPhoneToAgentCredential(
          phoneNumberId,
          agentId
        );
        
        if (migrationResult.success) {
          console.log(`✅ [Incoming Connection] Phone migrated: ${migrationResult.oldElevenLabsPhoneId} -> ${migrationResult.newElevenLabsPhoneId}`);
          phoneNumber[0].elevenLabsPhoneNumberId = migrationResult.newElevenLabsPhoneId;
          phoneNumber[0].elevenLabsCredentialId = migrationResult.newCredentialId;
        } else {
          console.error(`❌ [Incoming Connection] Migration failed: ${migrationResult.error}`);
          return res.status(400).json({
            message: "Failed to migrate phone number to agent's ElevenLabs account. The phone and agent must be on the same API key.",
            error: migrationResult.error
          });
        }
      } catch (migrationError: any) {
        console.error(`❌ [Incoming Connection] Migration error: ${migrationError.message}`);
        return res.status(500).json({
          message: "Phone number migration failed. Please try again or contact support.",
          error: migrationError.message
        });
      }
    }
    
    // STEP 3: Verify phone exists on ElevenLabs (after migration, on correct credential)
    // This handles stale IDs - phones that were deleted from ElevenLabs but still in DB
    console.log(`📞 [Incoming Connection] Verifying phone ${phoneNumber[0].phoneNumber} on ElevenLabs...`);
    
    const verifyResult = await PhoneMigrator.verifyAndEnsurePhoneExists(
      phoneNumberId,
      agentCredentialId,
      agent[0].elevenLabsAgentId || undefined // Pass agent ID for assignment after re-import
    );
    
    if (!verifyResult.success) {
      console.error(`❌ [Incoming Connection] Phone verification failed: ${verifyResult.error}`);
      return res.status(400).json({
        message: "Phone number is not available on ElevenLabs. Please try re-syncing your phone numbers.",
        error: verifyResult.error,
        suggestion: "Go to Phone Numbers and click 'Sync' to refresh your phone number status."
      });
    }
    
    // Update local variable with verified/re-imported phone ID
    if (verifyResult.wasReimported && verifyResult.elevenLabsPhoneId) {
      console.log(`✅ [Incoming Connection] Phone was re-imported: ${verifyResult.elevenLabsPhoneId}`);
      phoneNumber[0].elevenLabsPhoneNumberId = verifyResult.elevenLabsPhoneId;
      phoneNumber[0].elevenLabsCredentialId = agentCredentialId;
    }
    
    console.log(`✅ [Incoming Connection] Phone verified: ${verifyResult.elevenLabsPhoneId}`);
    
    // ========================================
    // CREATE CONNECTION (after all pre-flight checks pass)
    // ========================================

    // Create the connection
    const [newConnection] = await db
      .insert(incomingConnections)
      .values({
        userId,
        agentId,
        phoneNumberId,
      })
      .returning();

    // Get the full connection with agent and phone details first
    const fullConnection = await db
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
        },
        phoneNumber: {
          id: phoneNumbers.id,
          phoneNumber: phoneNumbers.phoneNumber,
          friendlyName: phoneNumbers.friendlyName,
        },
      })
      .from(incomingConnections)
      .leftJoin(agents, eq(incomingConnections.agentId, agents.id))
      .leftJoin(phoneNumbers, eq(incomingConnections.phoneNumberId, phoneNumbers.id))
      .where(eq(incomingConnections.id, newConnection.id))
      .limit(1);

    // Sync agent assignment to ElevenLabs (native integration)
    // Note: Migration and verification already done in pre-flight checks above
    try {
      console.log(`📞 [ElevenLabs Sync] Assigning agent to phone number in ElevenLabs`);
      
      // Guard: Verify ElevenLabs IDs are present (should be set by now from pre-flight)
      if (!phoneNumber[0].elevenLabsPhoneNumberId || !agent[0].elevenLabsAgentId) {
        console.warn(`⚠️  [ElevenLabs Sync] Missing ElevenLabs IDs after pre-flight - skipping assignment sync`);
        console.warn(`   Phone has EL ID: ${!!phoneNumber[0].elevenLabsPhoneNumberId}`);
        console.warn(`   Agent has EL ID: ${!!agent[0].elevenLabsAgentId}`);
        return res.status(201).json(fullConnection[0]);
      }
      
      // Resolve credential (already ensured in pre-flight)
      const credential = await elevenLabsPoolModule.ElevenLabsPoolService.getCredentialById(agentCredentialId);
      
      if (!credential) {
        console.warn(`⚠️  [ElevenLabs Sync] Credential not found - skipping assignment sync`);
        return res.status(201).json(fullConnection[0]);
      }
      
      if (!credential.isActive) {
        console.warn(`⚠️  [ElevenLabs Sync] Credential is inactive - skipping assignment sync`);
        return res.status(201).json(fullConnection[0]);
      }
      
      // Use the credential for agent assignment
      const elevenLabsModule = await import('../services/elevenlabs');
      const elevenLabsService = new elevenLabsModule.ElevenLabsService(credential.apiKey);
      
      await elevenLabsService.assignAgentToPhoneNumber(
        phoneNumber[0].elevenLabsPhoneNumberId!,
        agent[0].elevenLabsAgentId!
      );
      
      console.log(`✅ [ElevenLabs Sync] Agent assigned to phone number successfully using credential: ${credential.name}`);
      
      // Configure ElevenLabs webhook on agent to receive call completion notifications
      try {
        const domain = getDomain();
        const webhookUrl = `${domain}/api/webhooks/elevenlabs`;
        const webhookSecret = process.env.ELEVENLABS_WEBHOOK_SECRET;
        
        console.log(`🔗 [ElevenLabs Webhook] Configuring webhook for agent: ${agent[0].elevenLabsAgentId}`);
        await elevenLabsService.configureAgentWebhook(agent[0].elevenLabsAgentId, {
          webhookUrl,
          events: ['conversation.completed'],
          secret: webhookSecret,
        });
        console.log(`✅ [ElevenLabs Webhook] Webhook configured: ${webhookUrl}`);
      } catch (webhookError: any) {
        console.error('⚠️  [ElevenLabs Webhook] Failed to configure webhook:', webhookError.message);
      }
      
      // Configure Twilio to route calls to ElevenLabs native endpoint
      if (phoneNumber[0].twilioSid) {
        try {
          await twilioService.configurePhoneWebhookForElevenLabs(phoneNumber[0].twilioSid, phoneNumber[0].phoneNumber);
        } catch (twilioError: any) {
          console.error('⚠️  [Twilio Config] Failed to configure Twilio webhook:', twilioError);
          // Don't fail - the ElevenLabs side is configured, Twilio can be fixed manually
        }
      } else {
        console.warn(`⚠️  [Twilio Config] No Twilio SID found for phone number - skipping webhook config`);
      }
    } catch (elevenLabsError: any) {
      console.error('⚠️  [ElevenLabs Sync] Failed to assign agent in ElevenLabs:', elevenLabsError);
      // Don't fail the whole request - connection is created in DB
      // Admin can manually sync later if needed
    }

    // Return the full connection
    res.status(201).json(fullConnection[0]);
  } catch (error: any) {
    console.error("Error creating incoming connection:", error);
    res.status(500).json({ message: "Failed to create incoming connection" });
  }
});

// POST /api/incoming-connections/:id/sync-webhook - Sync webhook configuration for an existing connection
router.post("/:id/sync-webhook", authenticateHybrid, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    const { id } = req.params;
    
    // Get connection with agent details
    const connection = await db
      .select({
        id: incomingConnections.id,
        agentId: incomingConnections.agentId,
        agent: {
          elevenLabsAgentId: agents.elevenLabsAgentId,
          elevenLabsCredentialId: agents.elevenLabsCredentialId,
          name: agents.name,
        },
      })
      .from(incomingConnections)
      .leftJoin(agents, eq(incomingConnections.agentId, agents.id))
      .where(and(eq(incomingConnections.id, id), eq(incomingConnections.userId, userId)))
      .limit(1);
    
    if (!connection.length) {
      return res.status(404).json({ message: "Connection not found" });
    }
    
    const conn = connection[0];
    
    if (!conn.agent?.elevenLabsAgentId || !conn.agent?.elevenLabsCredentialId) {
      return res.status(400).json({ message: "Connection agent is not properly configured" });
    }
    
    console.log(`🔄 [Webhook Sync] Syncing webhook for connection ${id}, agent: ${conn.agent.name}`);
    
    // Get the credential
    const elevenLabsPoolModule = await import('../services/elevenlabs-pool');
    const credential = await elevenLabsPoolModule.ElevenLabsPoolService.getCredentialById(
      conn.agent.elevenLabsCredentialId
    );
    
    if (!credential) {
      return res.status(500).json({ message: "ElevenLabs credential not found" });
    }
    
    // Configure webhook on the agent
    const elevenLabsModule = await import('../services/elevenlabs');
    const elevenLabsService = new elevenLabsModule.ElevenLabsService(credential.apiKey);
    
    const domain = getDomain();
    const webhookUrl = `${domain}/api/webhooks/elevenlabs`;
    const webhookSecret = process.env.ELEVENLABS_WEBHOOK_SECRET;
    
    console.log(`🔗 [Webhook Sync] Configuring webhook: ${webhookUrl}`);
    
    await elevenLabsService.configureAgentWebhook(conn.agent.elevenLabsAgentId, {
      webhookUrl,
      events: ['conversation.completed'],
      secret: webhookSecret,
    });
    
    console.log(`✅ [Webhook Sync] Webhook configured successfully for agent: ${conn.agent.name}`);
    
    res.json({ 
      success: true, 
      message: "Webhook configured successfully",
      webhookUrl,
    });
  } catch (error: any) {
    console.error("Error syncing webhook:", error);
    res.status(500).json({ message: "Failed to sync webhook" });
  }
});

// DELETE /api/incoming-connections/:id - Delete a connection
router.delete("/:id", authenticateHybrid, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    const { id } = req.params;

    // Verify connection exists and belongs to user - get full details including agent credential for ElevenLabs sync
    const connection = await db
      .select({
        id: incomingConnections.id,
        agentId: incomingConnections.agentId,
        phoneNumberId: incomingConnections.phoneNumberId,
        phoneNumber: {
          elevenLabsPhoneNumberId: phoneNumbers.elevenLabsPhoneNumberId,
          twilioSid: phoneNumbers.twilioSid,
        },
        agent: {
          elevenLabsCredentialId: agents.elevenLabsCredentialId,
        },
      })
      .from(incomingConnections)
      .leftJoin(phoneNumbers, eq(incomingConnections.phoneNumberId, phoneNumbers.id))
      .leftJoin(agents, eq(incomingConnections.agentId, agents.id))
      .where(and(eq(incomingConnections.id, id), eq(incomingConnections.userId, userId)))
      .limit(1);

    if (!connection.length) {
      return res.status(404).json({ message: "Connection not found" });
    }

    // Unassign agent from phone number in ElevenLabs (native integration)
    if (connection[0].phoneNumber?.elevenLabsPhoneNumberId && connection[0].agent?.elevenLabsCredentialId) {
      try {
        console.log(`📞 [ElevenLabs Sync] Unassigning agent from phone number in ElevenLabs`);
        
        // Use the connection's agent credential for unassignment
        const elevenLabsPoolModule = await import('../services/elevenlabs-pool');
        const credential = await elevenLabsPoolModule.ElevenLabsPoolService.getCredentialById(
          connection[0].agent.elevenLabsCredentialId
        );
        
        if (credential) {
          // Import ElevenLabsService class
          const elevenLabsModule = await import('../services/elevenlabs');
          const elevenLabsService = new elevenLabsModule.ElevenLabsService(credential.apiKey);
          
          await elevenLabsService.unassignAgentFromPhoneNumber(
            connection[0].phoneNumber.elevenLabsPhoneNumberId
          );
          
          console.log(`✅ [ElevenLabs Sync] Agent unassigned from phone number successfully using credential: ${credential.name}`);
        } else {
          console.warn(`⚠️  [ElevenLabs Sync] Credential not found - skipping unassignment sync`);
        }
      } catch (elevenLabsError: any) {
        console.error('⚠️  [ElevenLabs Sync] Failed to unassign agent in ElevenLabs:', elevenLabsError);
        // Continue with deletion even if ElevenLabs sync fails
      }
    }

    // Clear Twilio webhook (remove ElevenLabs routing)
    if (connection[0].phoneNumber?.twilioSid) {
      try {
        await twilioService.clearPhoneWebhook(connection[0].phoneNumber.twilioSid);
      } catch (twilioError: any) {
        console.error('⚠️  [Twilio Config] Failed to clear Twilio webhook:', twilioError);
        // Continue with deletion even if Twilio sync fails
      }
    }

    // Delete the connection from database
    await db.delete(incomingConnections).where(eq(incomingConnections.id, id));

    res.json({ message: "Connection deleted successfully" });
  } catch (error: any) {
    console.error("Error deleting incoming connection:", error);
    res.status(500).json({ message: "Failed to delete incoming connection" });
  }
});

export default router;
