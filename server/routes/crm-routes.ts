'use strict';
/**
 * ============================================================
 * CRM Routes - Lead Management API
 * Isolated module for CRM functionality
 * ============================================================
 */

import { Router, Request, Response } from 'express';
import { CRMStorage, DEFAULT_STAGES } from '../storage/crm-storage';
import { insertLeadSchema, insertLeadStageSchema, insertLeadNoteSchema, AI_LEAD_CATEGORIES, AI_CATEGORY_LABELS, AI_CATEGORY_COLORS, AI_CATEGORY_PRIORITY, determineAICategory, type AILeadCategory } from '@shared/schema';
import { z } from 'zod';
// Team Management - uses adapter for optional plugin loading
import { getTeamService } from '../plugins/team-management-adapter';

interface AuthRequest extends Request {
  userId?: string;
  isTeamMember?: boolean;
  teamMember?: {
    memberId: string;
    teamId: string;
    userId: string;
    roleId: string;
    permissions: any;
    isAdminTeam?: boolean;
  };
}

async function logTeamActivity(
  req: AuthRequest, 
  action: string, 
  targetType: string, 
  targetId?: string, 
  metadata?: Record<string, any>
) {
  if (req.isTeamMember && req.teamMember) {
    try {
      const TeamService = getTeamService();
      if (TeamService) {
        await TeamService.logActivity(
          req.teamMember.teamId,
          req.teamMember.memberId,
          action,
          targetType,
          targetId,
          metadata,
          req.ip
        );
      }
    } catch (err) {
      console.error('[CRM] Failed to log team activity:', err);
    }
  }
}

const router = Router();

// Middleware to ensure user is authenticated
const requireAuth = (req: AuthRequest, res: Response, next: Function) => {
  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// ============================================================
// Lead Stages Endpoints
// ============================================================

router.get('/stages', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const stages = await CRMStorage.ensureDefaultStages(req.userId!);
    res.json(stages);
  } catch (error: any) {
    console.error('[CRM] Error fetching stages:', error);
    res.status(500).json({ error: 'Failed to fetch stages' });
  }
});

router.post('/stages', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const data = insertLeadStageSchema.parse({
      ...req.body,
      userId: req.userId,
    });

    const stage = await CRMStorage.createStage(data);
    res.json(stage);
  } catch (error: any) {
    console.error('[CRM] Error creating stage:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid data', details: error.errors });
    }
    res.status(500).json({ error: 'Failed to create stage' });
  }
});

router.patch('/stages/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, color } = req.body;

    const stage = await CRMStorage.updateStage(id, req.userId!, { name, color });
    if (!stage) {
      return res.status(404).json({ error: 'Stage not found' });
    }

    res.json(stage);
  } catch (error: any) {
    console.error('[CRM] Error updating stage:', error);
    res.status(500).json({ error: 'Failed to update stage' });
  }
});

router.delete('/stages/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const deleted = await CRMStorage.deleteStage(id, req.userId!);

    if (!deleted) {
      return res.status(400).json({ error: 'Cannot delete default stage' });
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('[CRM] Error deleting stage:', error);
    res.status(500).json({ error: 'Failed to delete stage' });
  }
});

router.post('/stages/reorder', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { stageIds } = req.body;

    if (!Array.isArray(stageIds)) {
      return res.status(400).json({ error: 'stageIds must be an array' });
    }

    await CRMStorage.reorderStages(req.userId!, stageIds);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[CRM] Error reordering stages:', error);
    res.status(500).json({ error: 'Failed to reorder stages' });
  }
});

// ============================================================
// Lead Sources (Campaigns & Incoming Connections)
// ============================================================

router.get('/sources', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const [campaigns, incomingConnections] = await Promise.all([
      CRMStorage.getUserCampaigns(req.userId!),
      CRMStorage.getUserIncomingConnections(req.userId!),
    ]);

    res.json({
      campaigns,
      incomingConnections,
    });
  } catch (error: any) {
    console.error('[CRM] Error fetching sources:', error);
    res.status(500).json({ error: 'Failed to fetch sources' });
  }
});

// ============================================================
// Leads Endpoints
// ============================================================

router.get('/leads', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { sourceType, sourceId, stage, minScore, maxScore, startDate, endDate, search } = req.query;

    // Get user's filter preferences
    const prefs = await CRMStorage.getCategoryPreferences(req.userId!);

    const filters = {
      stage: stage as string | undefined,
      minScore: minScore ? parseInt(minScore as string) : undefined,
      maxScore: maxScore ? parseInt(maxScore as string) : undefined,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      search: search as string | undefined,
      hideLeadsWithoutPhone: prefs?.hideLeadsWithoutPhone ?? false,
    };

    let leads;
    if (sourceType && sourceId && sourceId !== 'all') {
      leads = await CRMStorage.getLeadsBySource(
        req.userId!,
        sourceType as 'campaign' | 'incoming',
        sourceId as string,
        filters
      );
    } else if (sourceType && sourceType !== 'all') {
      leads = await CRMStorage.getLeadsBySourceType(
        req.userId!,
        sourceType as 'campaign' | 'incoming',
        filters
      );
    } else {
      leads = await CRMStorage.getAllLeads(req.userId!, filters);
    }

    res.json(leads);
  } catch (error: any) {
    console.error('[CRM] Error fetching leads:', error);
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

router.get('/leads/kanban', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { sourceType, sourceId } = req.query;

    if (!sourceType || !sourceId) {
      return res.status(400).json({ error: 'sourceType and sourceId are required' });
    }

    // Get user's filter preferences
    const prefs = await CRMStorage.getCategoryPreferences(req.userId!);
    const hideLeadsWithoutPhone = prefs?.hideLeadsWithoutPhone ?? false;

    const [stages, leads, counts] = await Promise.all([
      CRMStorage.ensureDefaultStages(req.userId!),
      CRMStorage.getLeadsBySource(
        req.userId!,
        sourceType as 'campaign' | 'incoming',
        sourceId as string,
        { hideLeadsWithoutPhone }
      ),
      CRMStorage.getLeadCountsByStage(
        req.userId!,
        sourceType as 'campaign' | 'incoming',
        sourceId as string,
        { hideLeadsWithoutPhone }
      ),
    ]);

    // Group leads by stage
    const leadsGrouped: Record<string, typeof leads> = {};
    for (const stage of stages) {
      const stageName = DEFAULT_STAGES.find(s => s.name === stage.name)?.stage || stage.name.toLowerCase().replace(/\s+/g, '_');
      leadsGrouped[stageName] = leads.filter(l => l.stage === stageName);
    }

    res.json({
      stages,
      leads: leadsGrouped,
      counts: counts.reduce((acc, c) => ({ ...acc, [c.stage]: c.count }), {}),
    });
  } catch (error: any) {
    console.error('[CRM] Error fetching kanban data:', error);
    res.status(500).json({ error: 'Failed to fetch kanban data' });
  }
});

// ============================================================
// AI-Categorized Leads (Paginated) - Only qualified prospects
// ============================================================

/**
 * Get AI category definitions (labels, colors, order)
 */
router.get('/leads/ai-categories', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    res.json({
      categories: AI_CATEGORY_PRIORITY.map(cat => ({
        id: cat,
        label: AI_CATEGORY_LABELS[cat],
        color: AI_CATEGORY_COLORS[cat],
      })),
    });
  } catch (error: any) {
    console.error('[CRM] Error fetching AI categories:', error);
    res.status(500).json({ error: 'Failed to fetch AI categories' });
  }
});

/**
 * Get paginated leads filtered by AI category
 * Only returns leads that qualify (aiCategory is not null)
 * Now applies user's filter preferences (hideLeadsWithoutPhone, hiddenCategories)
 */
router.get('/leads/categorized', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { 
      aiCategory, 
      sourceType, 
      sourceId, 
      search, 
      sortBy,
      limit,
      offset 
    } = req.query;

    // Get user's filter preferences
    const prefs = await CRMStorage.getCategoryPreferences(req.userId!);

    const result = await CRMStorage.getPaginatedLeadsByCategory(req.userId!, {
      aiCategory: aiCategory as AILeadCategory | undefined,
      sourceType: sourceType === 'all' ? undefined : sourceType as 'campaign' | 'incoming' | undefined,
      sourceId: sourceId === 'all' ? undefined : sourceId as string | undefined,
      search: search as string | undefined,
      sortBy: sortBy as 'newest' | 'oldest' | 'score-high' | 'score-low' | undefined,
      limit: limit ? parseInt(limit as string) : 50,
      offset: offset ? parseInt(offset as string) : 0,
      hideLeadsWithoutPhone: prefs?.hideLeadsWithoutPhone ?? false,
      hiddenCategories: prefs?.hiddenCategories ?? [],
    });

    res.json(result);
  } catch (error: any) {
    console.error('[CRM] Error fetching categorized leads:', error);
    res.status(500).json({ error: 'Failed to fetch categorized leads' });
  }
});

/**
 * Get lead counts by AI category
 * Now applies user's filter preferences (hideLeadsWithoutPhone, hiddenCategories)
 */
router.get('/leads/category-counts', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { sourceType, sourceId } = req.query;

    // Get user's filter preferences
    const prefs = await CRMStorage.getCategoryPreferences(req.userId!);

    const counts = await CRMStorage.getLeadCountsByCategory(req.userId!, {
      sourceType: sourceType === 'all' ? undefined : sourceType as 'campaign' | 'incoming' | undefined,
      sourceId: sourceId === 'all' ? undefined : sourceId as string | undefined,
      hideLeadsWithoutPhone: prefs?.hideLeadsWithoutPhone ?? false,
      hiddenCategories: prefs?.hiddenCategories ?? [],
    });

    // Calculate total qualified leads
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);

    res.json({
      counts,
      total,
      categories: AI_CATEGORY_PRIORITY.map(cat => ({
        id: cat,
        label: AI_CATEGORY_LABELS[cat],
        color: AI_CATEGORY_COLORS[cat],
        count: counts[cat],
      })),
    });
  } catch (error: any) {
    console.error('[CRM] Error fetching category counts:', error);
    res.status(500).json({ error: 'Failed to fetch category counts' });
  }
});

/**
 * AI-categorized Kanban view - shows 6 fixed columns with leads
 * Now applies user's filter preferences (hideLeadsWithoutPhone, hiddenCategories)
 */
router.get('/leads/ai-kanban', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { sourceType, sourceId, limit } = req.query;

    const leadsPerColumn = limit ? parseInt(limit as string) : 20;

    // Get user's filter preferences
    const prefs = await CRMStorage.getCategoryPreferences(req.userId!);
    const hideLeadsWithoutPhone = prefs?.hideLeadsWithoutPhone ?? false;
    const hiddenCategories = prefs?.hiddenCategories ?? [];

    // Fetch leads for each category in parallel
    const categoryResults = await Promise.all(
      AI_CATEGORY_PRIORITY.map(async (category) => {
        const result = await CRMStorage.getLeadsByAICategory(req.userId!, category, {
          sourceType: sourceType === 'all' ? undefined : sourceType as 'campaign' | 'incoming' | undefined,
          sourceId: sourceId === 'all' ? undefined : sourceId as string | undefined,
          limit: leadsPerColumn,
          offset: 0,
          hideLeadsWithoutPhone,
          hiddenCategories,
        });

        // Enrich leads with notes count
        const enrichedLeads = await CRMStorage.enrichLeadsWithNotesCount(result.leads);

        return {
          category,
          label: AI_CATEGORY_LABELS[category],
          color: AI_CATEGORY_COLORS[category],
          leads: enrichedLeads,
          total: result.total,
          hasMore: result.hasMore,
        };
      })
    );

    // Build response
    const columns = categoryResults.reduce((acc, result) => {
      acc[result.category] = {
        leads: result.leads,
        total: result.total,
        hasMore: result.hasMore,
      };
      return acc;
    }, {} as Record<AILeadCategory, { leads: any[]; total: number; hasMore: boolean }>);

    res.json({
      categories: categoryResults.map(r => ({
        id: r.category,
        label: r.label,
        color: r.color,
        total: r.total,
      })),
      columns,
    });
  } catch (error: any) {
    console.error('[CRM] Error fetching AI kanban data:', error);
    res.status(500).json({ error: 'Failed to fetch AI kanban data' });
  }
});

/**
 * Load more leads for a specific AI category (infinite scroll)
 */
router.get('/leads/ai-kanban/:category', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { category } = req.params;
    const { sourceType, sourceId, limit, offset } = req.query;

    if (!Object.values(AI_LEAD_CATEGORIES).includes(category as AILeadCategory)) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    const result = await CRMStorage.getLeadsByAICategory(
      req.userId!,
      category as AILeadCategory,
      {
        sourceType: sourceType === 'all' ? undefined : sourceType as 'campaign' | 'incoming' | undefined,
        sourceId: sourceId === 'all' ? undefined : sourceId as string | undefined,
        limit: limit ? parseInt(limit as string) : 20,
        offset: offset ? parseInt(offset as string) : 0,
      }
    );

    // Enrich leads with notes count
    const enrichedLeads = await CRMStorage.enrichLeadsWithNotesCount(result.leads);

    res.json({ ...result, leads: enrichedLeads });
  } catch (error: any) {
    console.error('[CRM] Error loading more leads:', error);
    res.status(500).json({ error: 'Failed to load more leads' });
  }
});

/**
 * Manually set a lead's AI category (for drag-and-drop)
 */
router.patch('/leads/:id/ai-category', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { aiCategory } = req.body;

    if (!aiCategory || !Object.values(AI_LEAD_CATEGORIES).includes(aiCategory)) {
      return res.status(400).json({ error: 'Invalid AI category' });
    }

    const lead = await CRMStorage.getLeadById(id, req.userId!);
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const updatedLead = await CRMStorage.updateLead(id, req.userId!, { aiCategory });

    // Log activity
    await CRMStorage.createActivity({
      leadId: id,
      userId: req.userId!,
      activityType: 'stage_change',
      title: 'Category Changed',
      description: `Lead moved to ${aiCategory.replace(/_/g, ' ')}`,
    });

    res.json(updatedLead);
  } catch (error: any) {
    console.error('[CRM] Error updating lead AI category:', error);
    res.status(500).json({ error: 'Failed to update lead AI category' });
  }
});

/**
 * Recategorize a single lead (manually trigger AI categorization)
 */
router.post('/leads/:id/recategorize', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const lead = await CRMStorage.getLeadById(id, req.userId!);

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const aiCategory = determineAICategory({
      hasAppointment: lead.hasAppointment,
      hasFormSubmission: lead.hasFormSubmission,
      hasTransfer: lead.hasTransfer,
      hasCallback: lead.hasCallback,
      callbackScheduled: lead.callbackScheduled,
      leadScore: lead.leadScore,
      sentiment: lead.sentiment,
    });

    const updatedLead = await CRMStorage.updateLead(id, req.userId!, { aiCategory });

    res.json(updatedLead);
  } catch (error: any) {
    console.error('[CRM] Error recategorizing lead:', error);
    res.status(500).json({ error: 'Failed to recategorize lead' });
  }
});

/**
 * Backfill all leads with AI categorization
 */
router.post('/leads/backfill-categories', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const allLeads = await CRMStorage.getAllLeads(req.userId!);
    
    let updated = 0;
    for (const lead of allLeads) {
      const aiCategory = determineAICategory({
        hasAppointment: lead.hasAppointment,
        hasFormSubmission: lead.hasFormSubmission,
        hasTransfer: lead.hasTransfer,
        hasCallback: lead.hasCallback,
        callbackScheduled: lead.callbackScheduled,
        leadScore: lead.leadScore,
        sentiment: lead.sentiment,
      });

      if (aiCategory !== lead.aiCategory) {
        await CRMStorage.updateLead(lead.id, req.userId!, { aiCategory });
        updated++;
      }
    }

    res.json({ 
      success: true, 
      message: `Categorized ${updated} leads out of ${allLeads.length} total`,
      updated,
      total: allLeads.length,
    });
  } catch (error: any) {
    console.error('[CRM] Error backfilling categories:', error);
    res.status(500).json({ error: 'Failed to backfill categories' });
  }
});

router.get('/leads/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const lead = await CRMStorage.getLeadById(id, req.userId!);

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    res.json(lead);
  } catch (error: any) {
    console.error('[CRM] Error fetching lead:', error);
    res.status(500).json({ error: 'Failed to fetch lead' });
  }
});

router.patch('/leads/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    
    // Get current lead state before update
    const previousLead = await CRMStorage.getLeadById(id, req.userId!);
    if (!previousLead) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    
    const previousStage = previousLead.stage;
    const previousStageId = previousLead.stageId;
    
    const lead = await CRMStorage.updateLead(id, req.userId!, req.body);

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    // Log activity if stage or stageId actually changed after update
    const stageChanged = lead.stage !== previousStage || lead.stageId !== previousStageId;
    if (stageChanged) {
      const stages = await CRMStorage.getStagesByUser(req.userId!);
      const fromStageName = stages.find(s => s.id === previousStageId)?.name || previousStage;
      const toStageName = stages.find(s => s.id === lead.stageId)?.name || lead.stage;
      await CRMStorage.logStageChange(id, req.userId!, previousStage, lead.stage, fromStageName, toStageName);
    }

    res.json(lead);
  } catch (error: any) {
    console.error('[CRM] Error updating lead:', error);
    res.status(500).json({ error: 'Failed to update lead' });
  }
});

router.patch('/leads/:id/stage', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { stage, stageId } = req.body;

    if (!stage) {
      return res.status(400).json({ error: 'stage is required' });
    }

    const lead = await CRMStorage.updateLeadStage(id, req.userId!, stage, stageId);

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    res.json(lead);
  } catch (error: any) {
    console.error('[CRM] Error updating lead stage:', error);
    res.status(500).json({ error: 'Failed to update lead stage' });
  }
});

// ============================================================
// Bulk Actions
// ============================================================

router.post('/leads/bulk/ai-category', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { ids, aiCategory } = req.body;

    if (!Array.isArray(ids) || !aiCategory) {
      return res.status(400).json({ error: 'ids array and aiCategory are required' });
    }

    if (!Object.values(AI_LEAD_CATEGORIES).includes(aiCategory)) {
      return res.status(400).json({ error: 'Invalid AI category' });
    }

    let updated = 0;
    for (const id of ids) {
      const lead = await CRMStorage.getLeadById(id, req.userId!);
      if (lead) {
        await CRMStorage.updateLead(id, req.userId!, { aiCategory });
        await CRMStorage.createActivity({
          leadId: id,
          userId: req.userId!,
          activityType: 'stage_change',
          title: 'Category Changed',
          description: `Lead moved to ${aiCategory.replace(/_/g, ' ')}`,
        });
        updated++;
      }
    }

    res.json({ success: true, count: updated });
  } catch (error: any) {
    console.error('[CRM] Error bulk updating AI category:', error);
    res.status(500).json({ error: 'Failed to bulk update AI category' });
  }
});

router.post('/leads/bulk/stage', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { ids, stage, stageId } = req.body;

    if (!Array.isArray(ids) || !stage) {
      return res.status(400).json({ error: 'ids array and stage are required' });
    }

    // Get stage name for activity logging
    const stages = await CRMStorage.getStagesByUser(req.userId!);
    const targetStage = stages.find(s => s.id === stageId || s.name.toLowerCase().replace(/\s+/g, '_') === stage);
    const stageName = targetStage?.name || stage;

    // Get current leads to log stage changes
    const currentLeads = await Promise.all(
      ids.map(id => CRMStorage.getLeadById(id, req.userId!))
    );

    const count = await CRMStorage.bulkUpdateStage(ids, req.userId!, stage, stageId);

    // Log activity for each lead
    for (const lead of currentLeads) {
      if (lead && lead.stage !== stage) {
        const fromStageName = stages.find(s => s.id === lead.stageId)?.name || lead.stage;
        await CRMStorage.logStageChange(lead.id, req.userId!, lead.stage, stage, fromStageName, stageName);
      }
    }

    // Log team member activity
    await logTeamActivity(req, 'bulk_update_stage', 'leads', undefined, {
      leadCount: ids.length,
      toStage: stageName,
    });

    res.json({ success: true, updated: count });
  } catch (error: any) {
    console.error('[CRM] Error bulk updating stage:', error);
    res.status(500).json({ error: 'Failed to bulk update stage' });
  }
});

router.post('/leads/bulk/tags', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { ids, tags } = req.body;

    if (!Array.isArray(ids) || !Array.isArray(tags)) {
      return res.status(400).json({ error: 'ids and tags must be arrays' });
    }

    const count = await CRMStorage.bulkAddTags(ids, req.userId!, tags);

    // Log tag activities
    for (const leadId of ids) {
      for (const tag of tags) {
        await CRMStorage.logTagChange(leadId, req.userId!, 'added', tag);
      }
    }

    // Log team member activity
    await logTeamActivity(req, 'bulk_add_tags', 'leads', undefined, {
      leadCount: ids.length,
      tags: tags,
    });

    res.json({ success: true, updated: count });
  } catch (error: any) {
    console.error('[CRM] Error bulk adding tags:', error);
    res.status(500).json({ error: 'Failed to bulk add tags' });
  }
});

router.post('/leads/bulk/assign', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { ids, assignedUserId } = req.body;

    if (!Array.isArray(ids) || !assignedUserId) {
      return res.status(400).json({ error: 'ids array and assignedUserId are required' });
    }

    const count = await CRMStorage.bulkAssign(ids, req.userId!, assignedUserId);

    // Log team member activity
    await logTeamActivity(req, 'bulk_assign_leads', 'leads', undefined, {
      leadCount: ids.length,
      assignedToUserId: assignedUserId,
    });

    res.json({ success: true, updated: count });
  } catch (error: any) {
    console.error('[CRM] Error bulk assigning:', error);
    res.status(500).json({ error: 'Failed to bulk assign' });
  }
});

// ============================================================
// Lead Notes
// ============================================================

router.get('/leads/:leadId/notes', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { leadId } = req.params;
    const notes = await CRMStorage.getNotesByLead(leadId);
    res.json(notes);
  } catch (error: any) {
    console.error('[CRM] Error fetching notes:', error);
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

router.post('/leads/:leadId/notes', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { leadId } = req.params;
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }

    const note = await CRMStorage.createNote({
      leadId,
      userId: req.userId!,
      content,
    });

    // Log note activity
    await CRMStorage.logNoteAdded(leadId, req.userId!, note.id, content);

    // Log team member activity
    await logTeamActivity(req, 'add_note', 'lead', leadId, {
      noteId: note.id,
      contentPreview: content.substring(0, 100),
    });

    res.json(note);
  } catch (error: any) {
    console.error('[CRM] Error creating note:', error);
    res.status(500).json({ error: 'Failed to create note' });
  }
});

router.patch('/notes/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }

    const note = await CRMStorage.updateNote(id, req.userId!, content);

    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }

    res.json(note);
  } catch (error: any) {
    console.error('[CRM] Error updating note:', error);
    res.status(500).json({ error: 'Failed to update note' });
  }
});

router.delete('/notes/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const deleted = await CRMStorage.deleteNote(id, req.userId!);

    if (!deleted) {
      return res.status(404).json({ error: 'Note not found' });
    }

    // Log team member activity
    await logTeamActivity(req, 'delete_note', 'note', id);

    res.json({ success: true });
  } catch (error: any) {
    console.error('[CRM] Error deleting note:', error);
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

// ============================================================
// Lead Activities (Activity Timeline)
// ============================================================

router.get('/leads/:leadId/activities', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { leadId } = req.params;
    const activities = await CRMStorage.getActivitiesByLead(leadId, req.userId!);
    res.json(activities);
  } catch (error: any) {
    console.error('[CRM] Error fetching activities:', error);
    res.status(500).json({ error: 'Failed to fetch activities' });
  }
});

router.post('/leads/bulk/delete', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }

    const deletedCount = await CRMStorage.bulkDeleteLeads(ids, req.userId!);

    // Log team member activity
    await logTeamActivity(req, 'bulk_delete_leads', 'leads', undefined, {
      deletedCount,
    });

    res.json({ deleted: deletedCount });
  } catch (error: any) {
    console.error('[CRM] Error bulk deleting leads:', error);
    res.status(500).json({ error: 'Failed to bulk delete leads' });
  }
});

// ============================================================
// Analytics
// ============================================================

router.get('/analytics', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const analytics = await CRMStorage.getAnalytics(req.userId!);
    res.json(analytics);
  } catch (error: any) {
    console.error('[CRM] Error fetching analytics:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// ============================================================
// CSV Export
// ============================================================

router.get('/export/csv', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const leads = await CRMStorage.getAllLeads(req.userId!);
    const stages = await CRMStorage.getStagesByUser(req.userId!);
    const notes = await Promise.all(leads.map(l => CRMStorage.getNotesByLead(l.id)));

    // Create stage name lookup
    const stageNameMap = new Map<string, string>();
    for (const stage of stages) {
      stageNameMap.set(stage.id, stage.name);
    }

    // Group leads by stage
    const leadsByStage = new Map<string, typeof leads>();
    for (const lead of leads) {
      const stageName = lead.stageId ? (stageNameMap.get(lead.stageId) || lead.stage) : lead.stage;
      if (!leadsByStage.has(stageName)) {
        leadsByStage.set(stageName, []);
      }
      leadsByStage.get(stageName)!.push(lead);
    }

    // Build CSV content
    const csvRows: string[] = [];
    
    // Header row
    csvRows.push([
      'Stage',
      'First Name',
      'Last Name',
      'Phone',
      'Email',
      'Company',
      'Source Type',
      'Lead Score',
      'Sentiment',
      'AI Summary',
      'AI Next Action',
      'Has Appointment',
      'Appointment Date',
      'Has Form Submission',
      'Has Transfer',
      'Transferred To',
      'Has Callback',
      'Callback Scheduled',
      'Tags',
      'Notes',
      'Created At',
      'Updated At'
    ].map(col => `"${col}"`).join(','));

    // Data rows grouped by stage
    let leadIndex = 0;
    Array.from(leadsByStage.entries()).sort((a, b) => {
      const aStage = stages.find(s => s.name === a[0]);
      const bStage = stages.find(s => s.name === b[0]);
      return (aStage?.order || 0) - (bStage?.order || 0);
    }).forEach(([stageName, stageLeads]) => {
      for (const lead of stageLeads) {
        const leadNotes = notes[leadIndex] || [];
        const notesText = leadNotes.map(n => n.content).join(' | ');
        
        csvRows.push([
          stageName,
          lead.firstName || '',
          lead.lastName || '',
          lead.phone || '',
          lead.email || '',
          lead.company || '',
          lead.sourceType || '',
          lead.leadScore?.toString() || '',
          lead.sentiment || '',
          lead.aiSummary || '',
          lead.aiNextAction || '',
          lead.hasAppointment ? 'Yes' : 'No',
          lead.appointmentDate ? new Date(lead.appointmentDate).toISOString() : '',
          lead.hasFormSubmission ? 'Yes' : 'No',
          lead.hasTransfer ? 'Yes' : 'No',
          lead.transferredTo || '',
          lead.hasCallback ? 'Yes' : 'No',
          lead.callbackScheduled ? new Date(lead.callbackScheduled).toISOString() : '',
          (lead.tags || []).join(', '),
          notesText,
          lead.createdAt ? new Date(lead.createdAt).toISOString() : '',
          lead.updatedAt ? new Date(lead.updatedAt).toISOString() : ''
        ].map(col => `"${String(col).replace(/"/g, '""')}"`).join(','));
        
        leadIndex++;
      }
    });

    const csvContent = csvRows.join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="leads-export-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csvContent);
  } catch (error: any) {
    console.error('[CRM] Error exporting CSV:', error);
    res.status(500).json({ error: 'Failed to export CSV' });
  }
});

// Get all unique tags
router.get('/tags', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const tags = await CRMStorage.getAllUniqueTags(req.userId!);
    res.json(tags);
  } catch (error: any) {
    console.error('[CRM] Error fetching tags:', error);
    res.status(500).json({ error: 'Failed to fetch tags' });
  }
});

// ============================================================
// Category Preferences (Colors, Order, Sorting)
// ============================================================

router.get('/preferences', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const prefs = await CRMStorage.getOrCreateCategoryPreferences(req.userId!);
    res.json(prefs);
  } catch (error: any) {
    console.error('[CRM] Error fetching preferences:', error);
    res.status(500).json({ error: 'Failed to fetch preferences' });
  }
});

router.patch('/preferences', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { 
      columnOrder, 
      colorOverrides, 
      columnSortPreferences,
      hideLeadsWithoutPhone,
      categoryPipelineMappings,
      hotScoreThreshold,
      warmScoreThreshold,
      hiddenCategories
    } = req.body;
    const prefs = await CRMStorage.updateCategoryPreferences(req.userId!, {
      columnOrder,
      colorOverrides,
      columnSortPreferences,
      hideLeadsWithoutPhone,
      categoryPipelineMappings,
      hotScoreThreshold,
      warmScoreThreshold,
      hiddenCategories,
    });
    res.json(prefs);
  } catch (error: any) {
    console.error('[CRM] Error updating preferences:', error);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

router.patch('/preferences/color/:categoryId', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { categoryId } = req.params;
    const { color } = req.body;
    if (!color) {
      return res.status(400).json({ error: 'color is required' });
    }
    const prefs = await CRMStorage.updateCategoryColor(req.userId!, categoryId, color);
    res.json(prefs);
  } catch (error: any) {
    console.error('[CRM] Error updating color:', error);
    res.status(500).json({ error: 'Failed to update color' });
  }
});

router.patch('/preferences/order', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { columnOrder } = req.body;
    if (!Array.isArray(columnOrder)) {
      return res.status(400).json({ error: 'columnOrder must be an array' });
    }
    const prefs = await CRMStorage.updateColumnOrder(req.userId!, columnOrder);
    res.json(prefs);
  } catch (error: any) {
    console.error('[CRM] Error updating order:', error);
    res.status(500).json({ error: 'Failed to update order' });
  }
});

router.patch('/preferences/sort/:categoryId', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { categoryId } = req.params;
    const { sortBy } = req.body;
    if (!['newest', 'oldest', 'score-high', 'score-low'].includes(sortBy)) {
      return res.status(400).json({ error: 'sortBy must be one of: newest, oldest, score-high, score-low' });
    }
    const prefs = await CRMStorage.updateColumnSort(req.userId!, categoryId, sortBy);
    res.json(prefs);
  } catch (error: any) {
    console.error('[CRM] Error updating sort:', error);
    res.status(500).json({ error: 'Failed to update sort' });
  }
});

export default router;
