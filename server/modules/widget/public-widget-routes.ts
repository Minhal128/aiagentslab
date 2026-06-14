import { Router, Request, Response, NextFunction } from "express";
import { widgetService } from "./widget-service";
import { widgetStorage } from "./widget-storage";
import { nanoid } from "nanoid";
import { db } from "../../db";
import { creditTransactions, users, calls, agents, appointments, appointmentSettings, elevenLabsCredentials, openaiCredentials } from "@shared/schema";
import { eq, sql, and } from "drizzle-orm";
import { OpenAIPoolService } from "../../engines/plivo/services/openai-pool.service";
import { OpenAIAgentFactory } from "../../engines/plivo/services/openai-agent-factory";
import { ElevenLabsPoolService } from "../../services/elevenlabs-pool";
import { ElevenLabsService } from "../../services/elevenlabs";
import { storage } from "../../storage";
import { CallInsightsService } from "../../services/call-insights.service";
import { RAGKnowledgeService } from "../../services/rag-knowledge";

const router = Router();

// CORS middleware for public widget endpoints - allows embedding on external websites
router.use((req: Request, res: Response, next: NextFunction) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Helper to check if OpenAI Realtime is available
async function isOpenAIRealtimeAvailable(): Promise<boolean> {
  try {
    const credential = await OpenAIPoolService.getAvailableCredential();
    return credential !== null;
  } catch {
    return false;
  }
}

// Engine-specific supported languages
// ElevenLabs supported languages - Flash v2.5 / Turbo v2.5 (32 languages)
// https://elevenlabs.io/docs/product/conversational-ai/guides/conversational-ai-guide-multi-language
const ELEVENLABS_LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Spanish', flag: '🇪🇸' },
  { code: 'fr', name: 'French', flag: '🇫🇷' },
  { code: 'de', name: 'German', flag: '🇩🇪' },
  { code: 'it', name: 'Italian', flag: '🇮🇹' },
  { code: 'pt', name: 'Portuguese', flag: '🇵🇹' },
  { code: 'pl', name: 'Polish', flag: '🇵🇱' },
  { code: 'hi', name: 'Hindi', flag: '🇮🇳' },
  { code: 'ar', name: 'Arabic', flag: '🇸🇦' },
  { code: 'zh', name: 'Chinese', flag: '🇨🇳' },
  { code: 'ja', name: 'Japanese', flag: '🇯🇵' },
  { code: 'ko', name: 'Korean', flag: '🇰🇷' },
  { code: 'nl', name: 'Dutch', flag: '🇳🇱' },
  { code: 'ru', name: 'Russian', flag: '🇷🇺' },
  { code: 'tr', name: 'Turkish', flag: '🇹🇷' },
  { code: 'sv', name: 'Swedish', flag: '🇸🇪' },
  { code: 'id', name: 'Indonesian', flag: '🇮🇩' },
  { code: 'fil', name: 'Filipino', flag: '🇵🇭' },
  { code: 'ms', name: 'Malay', flag: '🇲🇾' },
  { code: 'ta', name: 'Tamil', flag: '🇮🇳' },
  { code: 'uk', name: 'Ukrainian', flag: '🇺🇦' },
  { code: 'el', name: 'Greek', flag: '🇬🇷' },
  { code: 'cs', name: 'Czech', flag: '🇨🇿' },
  { code: 'fi', name: 'Finnish', flag: '🇫🇮' },
  { code: 'ro', name: 'Romanian', flag: '🇷🇴' },
  { code: 'da', name: 'Danish', flag: '🇩🇰' },
  { code: 'bg', name: 'Bulgarian', flag: '🇧🇬' },
  { code: 'hr', name: 'Croatian', flag: '🇭🇷' },
  { code: 'sk', name: 'Slovak', flag: '🇸🇰' },
  { code: 'hu', name: 'Hungarian', flag: '🇭🇺' },
  { code: 'no', name: 'Norwegian', flag: '🇳🇴' },
  { code: 'vi', name: 'Vietnamese', flag: '🇻🇳' },
];

// OpenAI Realtime supported languages - full list matching agent creation
const OPENAI_LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Spanish', flag: '🇪🇸' },
  { code: 'fr', name: 'French', flag: '🇫🇷' },
  { code: 'de', name: 'German', flag: '🇩🇪' },
  { code: 'it', name: 'Italian', flag: '🇮🇹' },
  { code: 'pt', name: 'Portuguese', flag: '🇵🇹' },
  { code: 'zh', name: 'Chinese', flag: '🇨🇳' },
  { code: 'ja', name: 'Japanese', flag: '🇯🇵' },
  { code: 'ko', name: 'Korean', flag: '🇰🇷' },
  { code: 'hi', name: 'Hindi', flag: '🇮🇳' },
  { code: 'ar', name: 'Arabic', flag: '🇸🇦' },
  { code: 'ru', name: 'Russian', flag: '🇷🇺' },
  { code: 'nl', name: 'Dutch', flag: '🇳🇱' },
  { code: 'pl', name: 'Polish', flag: '🇵🇱' },
  { code: 'sv', name: 'Swedish', flag: '🇸🇪' },
  { code: 'no', name: 'Norwegian', flag: '🇳🇴' },
  { code: 'da', name: 'Danish', flag: '🇩🇰' },
  { code: 'fi', name: 'Finnish', flag: '🇫🇮' },
  { code: 'el', name: 'Greek', flag: '🇬🇷' },
  { code: 'cs', name: 'Czech', flag: '🇨🇿' },
  { code: 'sk', name: 'Slovak', flag: '🇸🇰' },
  { code: 'hu', name: 'Hungarian', flag: '🇭🇺' },
  { code: 'ro', name: 'Romanian', flag: '🇷🇴' },
  { code: 'bg', name: 'Bulgarian', flag: '🇧🇬' },
  { code: 'hr', name: 'Croatian', flag: '🇭🇷' },
  { code: 'uk', name: 'Ukrainian', flag: '🇺🇦' },
  { code: 'tr', name: 'Turkish', flag: '🇹🇷' },
  { code: 'id', name: 'Indonesian', flag: '🇮🇩' },
  { code: 'ms', name: 'Malay', flag: '🇲🇾' },
  { code: 'vi', name: 'Vietnamese', flag: '🇻🇳' },
  { code: 'fil', name: 'Filipino', flag: '🇵🇭' },
  { code: 'ta', name: 'Tamil', flag: '🇮🇳' },
  { code: 'th', name: 'Thai', flag: '🇹🇭' },
  { code: 'he', name: 'Hebrew', flag: '🇮🇱' },
  { code: 'bn', name: 'Bengali', flag: '🇧🇩' },
  { code: 'te', name: 'Telugu', flag: '🇮🇳' },
  { code: 'mr', name: 'Marathi', flag: '🇮🇳' },
  { code: 'gu', name: 'Gujarati', flag: '🇮🇳' },
  { code: 'kn', name: 'Kannada', flag: '🇮🇳' },
  { code: 'ml', name: 'Malayalam', flag: '🇮🇳' },
  { code: 'pa', name: 'Punjabi', flag: '🇮🇳' },
  { code: 'ur', name: 'Urdu', flag: '🇵🇰' },
  { code: 'fa', name: 'Persian', flag: '🇮🇷' },
  { code: 'sw', name: 'Swahili', flag: '🇰🇪' },
  { code: 'af', name: 'Afrikaans', flag: '🇿🇦' },
  { code: 'ca', name: 'Catalan', flag: '🇪🇸' },
  { code: 'lt', name: 'Lithuanian', flag: '🇱🇹' },
  { code: 'lv', name: 'Latvian', flag: '🇱🇻' },
  { code: 'sl', name: 'Slovenian', flag: '🇸🇮' },
  { code: 'et', name: 'Estonian', flag: '🇪🇪' },
];

function getEngineLanguages(engine: 'elevenlabs' | 'openai'): typeof ELEVENLABS_LANGUAGES {
  return engine === 'elevenlabs' ? ELEVENLABS_LANGUAGES : OPENAI_LANGUAGES;
}

// Get languages supported by the specific agent
function getAgentSupportedLanguages(agent: any, engine: 'elevenlabs' | 'openai' | 'none'): typeof ELEVENLABS_LANGUAGES {
  const allLanguages = getEngineLanguages(engine === 'none' ? 'openai' : engine);
  
  // If agent has detectLanguageEnabled, show all languages for the engine
  if (agent?.detectLanguageEnabled) {
    return allLanguages;
  }
  
  // If agent has a specific language set, only show that language
  if (agent?.language) {
    const agentLang = allLanguages.find(l => l.code === agent.language);
    return agentLang ? [agentLang] : allLanguages;
  }
  
  // Default: show all languages for the engine
  return allLanguages;
}

// Helper to determine engine type for an agent
// Uses explicit column selection to avoid errors when production DB is missing newer columns
async function getAgentEngineType(agentId: string | null): Promise<{ engine: 'elevenlabs' | 'openai' | 'none', agent: any }> {
  if (!agentId) {
    return { engine: 'none', agent: null };
  }
  
  let agent: any = null;
  
  try {
    const [result] = await db.select({
      id: agents.id,
      name: agents.name,
      language: agents.language,
      elevenLabsAgentId: agents.elevenLabsAgentId,
      elevenLabsCredentialId: agents.elevenLabsCredentialId,
      systemPrompt: agents.systemPrompt,
      openaiVoice: agents.openaiVoice,
      knowledgeBaseIds: agents.knowledgeBaseIds,
      userId: agents.userId,
      detectLanguageEnabled: agents.detectLanguageEnabled,
    }).from(agents).where(eq(agents.id, agentId));
    agent = result;
  } catch (err: any) {
    if (err?.code === '42703') {
      console.warn(`[Widget] Column missing in agents table, using minimal query: ${err.message}`);
      const [result] = await db.select({
        id: agents.id,
        name: agents.name,
        language: agents.language,
        elevenLabsAgentId: agents.elevenLabsAgentId,
        elevenLabsCredentialId: agents.elevenLabsCredentialId,
        systemPrompt: agents.systemPrompt,
        openaiVoice: agents.openaiVoice,
        knowledgeBaseIds: agents.knowledgeBaseIds,
        userId: agents.userId,
      }).from(agents).where(eq(agents.id, agentId));
      agent = result;
    } else {
      throw err;
    }
  }
  
  if (!agent) {
    return { engine: 'none', agent: null };
  }
  
  // If agent has elevenLabsAgentId, it's an ElevenLabs agent
  if (agent.elevenLabsAgentId) {
    return { engine: 'elevenlabs', agent };
  }
  
  // Otherwise it's configured for OpenAI
  return { engine: 'openai', agent };
}

router.get('/widget/config/:token', async (req: Request, res: Response) => {
  try {
    const widget = await widgetService.getWidgetByToken(req.params.token);
    
    if (!widget) {
      return res.status(404).json({ error: 'Widget not found' });
    }
    
    const origin = req.headers.origin || req.headers.referer || '';
    let domain = '';
    try {
      const url = new URL(origin);
      domain = url.hostname;
    } catch {
      domain = origin.replace(/^https?:\/\//, '').split('/')[0];
    }
    
    if (domain && !widgetService.validateDomain(widget, domain)) {
      return res.status(403).json({ error: 'Domain not allowed' });
    }
    
    const businessHours = widgetService.checkBusinessHours(widget);
    const creditCheck = await widgetService.checkUserCredits(widget.userId, 1);
    const concurrentCheck = await widgetService.checkConcurrentCallLimit(widget.id);
    
    const appNameSetting = await storage.getGlobalSetting('app_name');
    const platformName = (appNameSetting?.value as string) || '';
    
    // Determine engine type and availability
    const { engine, agent } = await getAgentEngineType(widget.agentId);
    let engineAvailable = true;
    let unavailableReason: string | null = null;
    let resolvedCredentialId: string | null = null;
    let resolvedCredentialName: string | null = null;
    
    console.log(`[Widget Config] Widget ${widget.name} - Engine: ${engine}, Agent: ${agent?.name || 'none'}, AgentId: ${widget.agentId}`);
    
    if (engine === 'none') {
      // No agent configured - check if OpenAI is available as fallback
      engineAvailable = await isOpenAIRealtimeAvailable();
      console.log(`[Widget Config] No agent - OpenAI available: ${engineAvailable}`);
      if (!engineAvailable) {
        unavailableReason = 'engine_unavailable';
      }
    } else if (engine === 'openai') {
      // OpenAI agent - check if OpenAI Realtime is available
      engineAvailable = await isOpenAIRealtimeAvailable();
      console.log(`[Widget Config] OpenAI engine - available: ${engineAvailable}`);
      if (!engineAvailable) {
        unavailableReason = 'engine_disabled';
      }
    } else if (engine === 'elevenlabs') {
      // ElevenLabs agent - check if we have valid credentials
      // Use transaction for atomic credential reassignment to prevent race conditions
      const result = await db.transaction(async (tx) => {
        let credentialIdToUse: string | null = null;
        let available = true;
        let credentialName: string | null = null;
        
        // Reload agent inside transaction to get current state and prevent races
        const [currentAgent] = await tx.select({
          id: agents.id,
          name: agents.name,
          elevenLabsCredentialId: agents.elevenLabsCredentialId,
        })
          .from(agents)
          .where(eq(agents.id, agent.id))
          .limit(1);
        
        if (!currentAgent) {
          return { credentialIdToUse: null, credentialName: null, available: false };
        }
        
        if (currentAgent.elevenLabsCredentialId) {
          const credential = await ElevenLabsPoolService.getCredentialById(currentAgent.elevenLabsCredentialId);
          if (credential && credential.isActive) {
            credentialIdToUse = credential.id;
            credentialName = credential.name;
            console.log(`[Widget Config] ElevenLabs with assigned credential ${currentAgent.elevenLabsCredentialId} - available: true`);
          } else {
            // Assigned credential is inactive/missing - try fallback to any active credential
            console.log(`[Widget Config] ElevenLabs assigned credential ${currentAgent.elevenLabsCredentialId} is inactive/missing, trying fallback...`);
            // Use locking method to prevent race conditions in credential selection
            const fallbackCredential = await ElevenLabsPoolService.getLeastLoadedCredentialWithLock(tx);
            if (fallbackCredential) {
              const oldCredentialId = currentAgent.elevenLabsCredentialId;
              credentialIdToUse = fallbackCredential.id;
              credentialName = fallbackCredential.name;
              console.log(`[Widget Config] ElevenLabs using fallback credential ${fallbackCredential.id} (${fallbackCredential.name}) - available: true`);
              
              // All updates within transaction for atomicity
              // 1. Update the agent to use this active credential (with returning to check if updated)
              const updateResult = await tx.update(agents)
                .set({ elevenLabsCredentialId: fallbackCredential.id })
                .where(and(
                  eq(agents.id, currentAgent.id),
                  eq(agents.elevenLabsCredentialId, oldCredentialId) // Only update if credential hasn't changed
                ))
                .returning({ id: agents.id });
              
              // Only adjust counters if the update actually modified the agent
              if (updateResult.length > 0) {
                // 2. Increment new credential count
                await tx.update(elevenLabsCredentials)
                  .set({ 
                    totalAssignedAgents: sql`${elevenLabsCredentials.totalAssignedAgents} + 1`,
                    updatedAt: new Date() 
                  })
                  .where(eq(elevenLabsCredentials.id, fallbackCredential.id));
                
                // 3. Decrement old credential count (if different)
                if (oldCredentialId && oldCredentialId !== fallbackCredential.id) {
                  await tx.update(elevenLabsCredentials)
                    .set({ 
                      totalAssignedAgents: sql`GREATEST(0, ${elevenLabsCredentials.totalAssignedAgents} - 1)`,
                      updatedAt: new Date() 
                    })
                    .where(eq(elevenLabsCredentials.id, oldCredentialId));
                }
                console.log(`[Widget Config] Updated agent ${currentAgent.name} to use fallback credential ${fallbackCredential.name}`);
              } else {
                // Concurrent request already reassigned - re-read agent to get actual credential
                console.log(`[Widget Config] Agent ${currentAgent.name} already reassigned by concurrent request, re-reading...`);
                const [updatedAgent] = await tx.select({
                  id: agents.id,
                  elevenLabsCredentialId: agents.elevenLabsCredentialId,
                })
                  .from(agents)
                  .where(eq(agents.id, currentAgent.id))
                  .limit(1);
                
                if (updatedAgent?.elevenLabsCredentialId) {
                  const actualCredential = await ElevenLabsPoolService.getCredentialById(updatedAgent.elevenLabsCredentialId);
                  if (actualCredential && actualCredential.isActive) {
                    credentialIdToUse = actualCredential.id;
                    credentialName = actualCredential.name;
                    console.log(`[Widget Config] Using actual assigned credential: ${actualCredential.name}`);
                  } else {
                    available = false;
                    console.log(`[Widget Config] Actual assigned credential is inactive`);
                  }
                } else {
                  available = false;
                  console.log(`[Widget Config] Agent has no credential after race`);
                }
              }
            } else {
              available = false;
              console.log(`[Widget Config] ElevenLabs no fallback credential available - available: false`);
            }
          }
        } else {
          // No assigned credential - try to get any available credential and assign it
          // Use locking method to prevent race conditions in credential selection
          const credential = await ElevenLabsPoolService.getLeastLoadedCredentialWithLock(tx);
          if (credential) {
            credentialIdToUse = credential.id;
            credentialName = credential.name;
            // All updates within transaction for atomicity
            const updateResult = await tx.update(agents)
              .set({ elevenLabsCredentialId: credential.id })
              .where(and(
                eq(agents.id, currentAgent.id),
                sql`${agents.elevenLabsCredentialId} IS NULL` // Only update if still unassigned
              ))
              .returning({ id: agents.id });
            
            // Only increment counter if the update actually modified the agent
            if (updateResult.length > 0) {
              await tx.update(elevenLabsCredentials)
                .set({ 
                  totalAssignedAgents: sql`${elevenLabsCredentials.totalAssignedAgents} + 1`,
                  updatedAt: new Date() 
                })
                .where(eq(elevenLabsCredentials.id, credential.id));
              console.log(`[Widget Config] Assigned agent ${currentAgent.name} to credential ${credential.name}`);
            } else {
              // Concurrent request already assigned - re-read agent to get actual credential
              console.log(`[Widget Config] Agent ${currentAgent.name} already assigned by concurrent request, re-reading...`);
              const [updatedAgent] = await tx.select({
                id: agents.id,
                elevenLabsCredentialId: agents.elevenLabsCredentialId,
              })
                .from(agents)
                .where(eq(agents.id, currentAgent.id))
                .limit(1);
              
              if (updatedAgent?.elevenLabsCredentialId) {
                const actualCredential = await ElevenLabsPoolService.getCredentialById(updatedAgent.elevenLabsCredentialId);
                if (actualCredential && actualCredential.isActive) {
                  credentialIdToUse = actualCredential.id;
                  credentialName = actualCredential.name;
                  console.log(`[Widget Config] Using actual assigned credential: ${actualCredential.name}`);
                } else {
                  available = false;
                  console.log(`[Widget Config] Actual assigned credential is inactive`);
                }
              } else {
                available = false;
                console.log(`[Widget Config] Agent has no credential after race`);
              }
            }
          } else {
            available = false;
          }
          console.log(`[Widget Config] ElevenLabs with pool credential - available: ${available}`);
        }
        
        return { credentialIdToUse, credentialName, available };
      });
      
      engineAvailable = result.available;
      resolvedCredentialId = result.credentialIdToUse;
      resolvedCredentialName = result.credentialName;
      if (!engineAvailable) {
        unavailableReason = 'engine_unavailable';
      }
    }
    
    const isAvailable = widget.status === 'active' && 
                        businessHours.isOpen && 
                        creditCheck.hasCredits && 
                        concurrentCheck.allowed &&
                        engineAvailable;
    
    console.log(`[Widget Config] Availability check - status: ${widget.status}, businessOpen: ${businessHours.isOpen}, hasCredits: ${creditCheck.hasCredits}, concurrent: ${concurrentCheck.allowed}, engine: ${engineAvailable} => isAvailable: ${isAvailable}`);
    
    if (widget.status !== 'active') {
      unavailableReason = 'engine_disabled';
    } else if (!businessHours.isOpen) {
      unavailableReason = 'outside_hours';
    } else if (!creditCheck.hasCredits) {
      unavailableReason = 'no_credits';
    } else if (!concurrentCheck.allowed) {
      unavailableReason = 'busy';
    }
    
    // Get agent-specific supported languages (filters based on agent's language config)
    const finalEngine = engine === 'none' ? 'openai' : engine;
    const supportedLanguages = getAgentSupportedLanguages(agent, engine);
    
    res.json({
      name: widget.brandName || widget.name,
      brandName: widget.brandName,
      buttonLabel: widget.buttonLabel,
      platformName,
      iconUrl: widget.iconUrl,
      iconPath: (widget as any).iconPath,
      primaryColor: widget.primaryColor,
      accentColor: widget.accentColor,
      backgroundColor: widget.backgroundColor,
      textColor: widget.textColor,
      welcomeMessage: widget.welcomeMessage,
      launcherText: widget.launcherText,
      offlineMessage: widget.offlineMessage,
      lowCreditsMessage: widget.lowCreditsMessage,
      maxCallDuration: widget.maxCallDuration,
      requireTermsAcceptance: widget.requireTermsAcceptance,
      isAvailable,
      unavailableReason,
      engine: finalEngine,
      supportedLanguages,
      credentialId: resolvedCredentialId,
      credentialName: resolvedCredentialName,
    });
  } catch (error) {
    console.error('Error fetching widget config:', error);
    res.status(500).json({ error: 'Failed to fetch widget config' });
  }
});

router.post('/widget/session/start', async (req: Request, res: Response) => {
  try {
    const { embedToken, visitorDomain } = req.body;
    
    if (!embedToken) {
      return res.status(400).json({ error: 'Embed token required' });
    }
    
    const widget = await widgetService.getWidgetByToken(embedToken);
    if (!widget) {
      return res.status(404).json({ error: 'Widget not found' });
    }
    
    if (widget.status !== 'active') {
      return res.status(403).json({ error: 'Widget is not active' });
    }
    
    if (visitorDomain && !widgetService.validateDomain(widget, visitorDomain)) {
      return res.status(403).json({ error: 'Domain not allowed' });
    }
    
    const businessHours = widgetService.checkBusinessHours(widget);
    if (!businessHours.isOpen) {
      return res.status(403).json({ error: 'Outside business hours', message: widget.offlineMessage });
    }
    
    const creditCheck = await widgetService.checkUserCredits(widget.userId, 1);
    if (!creditCheck.hasCredits) {
      return res.status(403).json({ error: 'Insufficient credits', message: widget.lowCreditsMessage });
    }
    
    const concurrentCheck = await widgetService.checkConcurrentCallLimit(widget.id);
    if (!concurrentCheck.allowed) {
      return res.status(429).json({ error: 'Too many concurrent calls', message: 'Please try again in a moment' });
    }
    
    // Get visitor IP for cooldown check
    const visitorIp = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '';
    const cleanedIp = typeof visitorIp === 'string' ? visitorIp.split(',')[0].trim() : '';
    
    // Check cooldown period for this IP
    const cooldownCheck = await widgetService.checkCooldown(widget.id, cleanedIp);
    if (!cooldownCheck.allowed) {
      const remainingMinutes = Math.ceil(cooldownCheck.remainingSeconds / 60);
      return res.status(429).json({ 
        error: 'Cooldown period active', 
        message: `Please wait ${remainingMinutes} minute${remainingMinutes > 1 ? 's' : ''} before starting another call`,
        remainingSeconds: cooldownCheck.remainingSeconds
      });
    }
    
    // Determine engine type
    const { engine } = await getAgentEngineType(widget.agentId);
    
    const sessionToken = `ws_${nanoid(32)}`;
    
    const session = await widgetStorage.createSession({
      widgetId: widget.id,
      userId: widget.userId,
      sessionToken,
      visitorIp: cleanedIp,
      visitorDomain: visitorDomain || null,
      status: 'pending',
    });
    
    res.json({
      sessionId: session.id,
      sessionToken,
      maxDuration: widget.maxCallDuration,
      engine: engine === 'none' ? 'openai' : engine,
    });
  } catch (error) {
    console.error('Error starting widget session:', error);
    res.status(500).json({ error: 'Failed to start session' });
  }
});

router.post('/widget/session/:sessionId/connect', async (req: Request, res: Response) => {
  try {
    const { sessionToken } = req.body;
    const session = await widgetStorage.getSessionById(req.params.sessionId);
    
    if (!session || session.sessionToken !== sessionToken) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    if (session.status !== 'pending') {
      return res.status(400).json({ error: 'Session already started' });
    }
    
    await widgetStorage.updateSession(session.id, {
      status: 'connecting',
      startedAt: new Date(),
    });
    
    const widget = await widgetStorage.getWidgetById(session.widgetId);
    if (!widget) {
      return res.status(404).json({ error: 'Widget not found' });
    }
    
    // Determine engine type
    const { engine } = await getAgentEngineType(widget.agentId);
    
    res.json({
      success: true,
      widgetId: widget.id,
      agentId: widget.agentId,
      agentType: widget.agentType,
      engine: engine === 'none' ? 'openai' : engine,
    });
  } catch (error) {
    console.error('Error connecting session:', error);
    res.status(500).json({ error: 'Failed to connect session' });
  }
});

router.post('/widget/session/:sessionId/end', async (req: Request, res: Response) => {
  try {
    const { sessionToken, duration, transcript, sentiment, conversationId } = req.body;
    const session = await widgetStorage.getSessionById(req.params.sessionId);
    
    if (!session || session.sessionToken !== sessionToken) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    // Check if session is already completed (idempotency check)
    if (session.status === 'completed') {
      console.log(`[Widget] Session ${session.id} already completed, skipping duplicate end request`);
      return res.json({ success: true, alreadyEnded: true });
    }
    
    const durationSeconds = duration || 0;
    const durationMinutes = Math.ceil(durationSeconds / 60);
    const creditsUsed = durationMinutes;
    
    // Use atomic update with returning to handle race conditions
    // Only proceed if we successfully transition from non-completed to completed
    const updateResult = await db.execute(sql`
      UPDATE widget_call_sessions 
      SET status = 'completed', 
          duration = ${durationSeconds}, 
          credits_used = ${creditsUsed}, 
          transcript = ${transcript || null}, 
          sentiment = ${sentiment || null}, 
          ended_at = NOW()
      WHERE id = ${session.id} AND status != 'completed'
      RETURNING id
    `);
    
    // If no rows updated, another request already completed the session
    if (!updateResult.rows || updateResult.rows.length === 0) {
      console.log(`[Widget] Session ${session.id} was completed by concurrent request, skipping`);
      return res.json({ success: true, alreadyEnded: true });
    }
    
    const widget = await widgetStorage.getWidgetById(session.widgetId);
    if (widget && creditsUsed > 0) {
      // Use INSERT ... ON CONFLICT DO NOTHING for idempotent credit transaction
      // The partial unique index has WHERE (reference IS NOT NULL), so we use column syntax
      const insertResult = await db.execute(sql`
        INSERT INTO credit_transactions (id, user_id, type, amount, description, reference, widget_id, created_at)
        VALUES (gen_random_uuid(), ${session.userId}, 'widget_call', ${-creditsUsed}, 
                ${'Widget call: ' + widget.name}, ${session.id}, ${widget.id}, NOW())
        ON CONFLICT (user_id, reference) WHERE reference IS NOT NULL DO NOTHING
        RETURNING id
      `);
      
      // Only deduct credits if we successfully inserted the transaction
      if (insertResult.rows && insertResult.rows.length > 0) {
        await db.update(users)
          .set({ credits: sql`GREATEST(${users.credits} - ${creditsUsed}, 0)` })
          .where(eq(users.id, session.userId));
      } else {
        console.log(`[Widget] Credit transaction already exists for session ${session.id}, skipping credit deduction`);
      }
      
      // Create call record with agent reference if available
      const { engine, agent } = await getAgentEngineType(widget.agentId);
      
      // Determine the engine type to know where recording comes from
      const actualEngine = engine === 'none' ? 'openai' : engine;
      
      // Generate AI insights if transcript is available (especially for OpenAI widget calls)
      let aiSummary: string | null = null;
      let classification: string | null = null;
      let analyzedSentiment: string | null = sentiment || null;
      
      if (transcript && transcript.trim().length > 0) {
        try {
          console.log(`[Widget] Generating AI insights for session ${session.id}`);
          
          // Get OpenAI API key from database (env var fallback is handled by service)
          let openaiApiKey: string | undefined;
          try {
            const [anyCredential] = await db
              .select()
              .from(openaiCredentials)
              .where(eq(openaiCredentials.isActive, true))
              .limit(1);
            if (anyCredential?.apiKey) {
              openaiApiKey = anyCredential.apiKey;
            }
          } catch (credError) {
            console.warn('[Widget] Could not fetch OpenAI credential from database:', credError);
          }
          
          const insights = await CallInsightsService.analyzeTranscript(
            transcript,
            {
              callId: session.id,
              agentName: agent?.name || widget.name,
              duration: durationSeconds,
            },
            openaiApiKey
          );
          
          if (insights) {
            aiSummary = insights.aiSummary;
            classification = insights.classification;
            analyzedSentiment = insights.sentiment;
            console.log(`[Widget] AI insights generated: classification=${classification}, sentiment=${analyzedSentiment}`);
          }
        } catch (insightError) {
          console.error('[Widget] Failed to generate AI insights:', insightError);
        }
      }
      
      // Check if call record already exists for this session (additional idempotency)
      const existingCall = await db.execute(
        sql`SELECT id FROM calls WHERE metadata->>'sessionId' = ${session.id} LIMIT 1`
      );
      
      if (!existingCall.rows || existingCall.rows.length === 0) {
        await db.insert(calls).values({
          userId: session.userId,
          widgetId: widget.id,
          status: 'completed',
          callDirection: 'incoming',
          duration: durationSeconds,
          transcript: transcript || null,
          sentiment: analyzedSentiment,
          aiSummary: aiSummary,
          classification: classification,
          startedAt: session.startedAt,
          endedAt: new Date(),
          // Set elevenLabsConversationId for ElevenLabs calls so RecordingService can fetch recordings
          elevenLabsConversationId: actualEngine === 'elevenlabs' && conversationId ? conversationId : null,
          metadata: {
            source: 'widget',
            engine: actualEngine,
            sessionId: session.id,
            conversationId: conversationId || null,
            agentId: widget.agentId || null,
            widgetName: widget.name || null,
          },
        });
        
        await widgetStorage.incrementWidgetStats(widget.id, durationMinutes);
      } else {
        console.log(`[Widget] Call record already exists for session ${session.id}, skipping`);
      }
      
      if (actualEngine === 'elevenlabs' && conversationId && (!transcript || transcript.trim().length === 0)) {
        setImmediate(() => {
          setTimeout(async () => {
            try {
              console.log(`[Widget] Fetching ElevenLabs conversation details for session ${session.id} (conversationId: ${conversationId})`);
              
              let credential = null;
              if (agent?.elevenLabsCredentialId) {
                credential = await ElevenLabsPoolService.getCredentialById(agent.elevenLabsCredentialId);
              }
              if (!credential) {
                credential = await ElevenLabsPoolService.getLeastLoadedCredential();
              }
              if (!credential) {
                console.warn(`[Widget] No ElevenLabs credential available to fetch conversation details`);
                return;
              }
              
              const elService = new ElevenLabsService(credential.apiKey);
              const conversationDetails = await elService.getConversationDetails(conversationId);
              
              const transcriptText = conversationDetails.transcript?.map((entry: any) =>
                `${entry.role.toUpperCase()} (${entry.time_in_call_secs}s): ${entry.message}`
              ).join('\n') || '';
              
              const elAiSummary = typeof conversationDetails.analysis === 'string'
                ? conversationDetails.analysis
                : (conversationDetails.analysis?.transcript_summary || conversationDetails.analysis?.summary || null);
              
              if (transcriptText || elAiSummary || conversationDetails.call_duration_secs) {
                await db.execute(sql`
                  UPDATE calls
                  SET transcript = COALESCE(NULLIF(transcript, ''), ${transcriptText || null}),
                      ai_summary = COALESCE(ai_summary, ${elAiSummary || null}),
                      duration = COALESCE(duration, ${conversationDetails.call_duration_secs || null})
                  WHERE elevenlabs_conversation_id = ${conversationId}
                `);
                console.log(`[Widget] Updated call record with ElevenLabs transcript/summary for session ${session.id}`);
              } else {
                console.log(`[Widget] No transcript/summary available from ElevenLabs yet for session ${session.id}`);
              }
            } catch (fetchError: any) {
              console.warn(`[Widget] Failed to fetch ElevenLabs conversation details (non-fatal):`, fetchError?.message || fetchError);
            }
          }, 5000);
        });
      }
    }
    
    res.json({ success: true, creditsUsed });
  } catch (error) {
    console.error('Error ending session:', error);
    res.status(500).json({ error: 'Failed to end session' });
  }
});

router.post('/widget/session/:sessionId/heartbeat', async (req: Request, res: Response) => {
  try {
    const { sessionToken } = req.body;
    const session = await widgetStorage.getSessionById(req.params.sessionId);
    
    if (!session || session.sessionToken !== sessionToken) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    if (session.status === 'pending') {
      await widgetStorage.updateSession(session.id, { status: 'active' });
    }
    
    const widget = await widgetStorage.getWidgetById(session.widgetId);
    if (!widget) {
      return res.status(404).json({ error: 'Widget not found' });
    }
    
    const creditCheck = await widgetService.checkUserCredits(widget.userId, 1);
    
    res.json({
      continue: creditCheck.hasCredits,
      remainingCredits: creditCheck.credits,
    });
  } catch (error) {
    console.error('Error processing heartbeat:', error);
    res.status(500).json({ error: 'Failed to process heartbeat' });
  }
});

router.post('/widget/session/:sessionId/ephemeral-token', async (req: Request, res: Response) => {
  try {
    const { sessionToken } = req.body;
    const session = await widgetStorage.getSessionById(req.params.sessionId);
    
    if (!session || session.sessionToken !== sessionToken) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    if (session.status !== 'pending' && session.status !== 'active' && session.status !== 'connecting') {
      return res.status(400).json({ error: 'Session expired or completed' });
    }
    
    const widget = await widgetStorage.getWidgetById(session.widgetId);
    if (!widget) {
      return res.status(404).json({ error: 'Widget not found' });
    }
    
    // Determine engine type based on agent configuration
    const { engine, agent } = await getAgentEngineType(widget.agentId);
    
    // ========== ELEVENLABS PATH ==========
    if (engine === 'elevenlabs' && agent?.elevenLabsAgentId) {
      console.log(`[Widget] Using ElevenLabs engine for agent ${agent.name} (${agent.elevenLabsAgentId})`);
      
      // Get ElevenLabs credential
      let credential = null;
      if (agent.elevenLabsCredentialId) {
        credential = await ElevenLabsPoolService.getCredentialById(agent.elevenLabsCredentialId);
      }
      if (!credential) {
        credential = await ElevenLabsPoolService.getLeastLoadedCredential();
      }
      
      if (!credential) {
        return res.status(503).json({ error: 'ElevenLabs service unavailable. Please try again later.' });
      }
      
      // Create ElevenLabs service with the credential
      const elevenLabsService = new ElevenLabsService(credential.apiKey);
      
      try {
        // Get signed URL for WebSocket connection
        const wsAuth = await elevenLabsService.getConversationWebSocketAuth(agent.elevenLabsAgentId);
        
        if (!wsAuth.signed_url) {
          throw new Error('Failed to get signed URL from ElevenLabs');
        }
        
        console.log(`[Widget] ElevenLabs signed URL obtained for agent ${agent.elevenLabsAgentId}`);
        
        await widgetStorage.updateSession(session.id, {
          status: 'active',
          startedAt: new Date(),
        });
        
        // Return ElevenLabs response format
        res.json({
          engine: 'elevenlabs',
          signed_url: wsAuth.signed_url,
          agent_id: agent.elevenLabsAgentId,
          maxDuration: widget.maxCallDuration,
          appointmentBookingEnabled: (agent as any).appointmentBookingEnabled || (widget as any).appointmentBookingEnabled || false,
          language: agent.language || 'en',
        });
        
      } catch (elevenLabsError: any) {
        console.error('[Widget] ElevenLabs signed URL error:', elevenLabsError);
        return res.status(500).json({ error: 'Failed to connect to ElevenLabs. Please try again.' });
      }
      
      return;
    }
    
    // ========== OPENAI PATH ==========
    console.log(`[Widget] Using OpenAI engine${agent ? ` for agent ${agent.name}` : ' (no agent)'}`);
    
    const credential = await OpenAIPoolService.getAvailableCredential();
    if (!credential) {
      return res.status(503).json({ error: 'AI service unavailable. Please try again later.' });
    }
    
    let systemPrompt = widget.welcomeMessage || 'Hello! How can I help you today?';
    let voice = 'alloy';
    let agentAppointmentBookingEnabled = false;
    let knowledgeBaseIds: string[] = [];
    
    if (agent) {
      systemPrompt = agent.systemPrompt || systemPrompt;
      voice = agent.openaiVoice || voice;
      agentAppointmentBookingEnabled = (agent as any).appointmentBookingEnabled || false;
      knowledgeBaseIds = agent.knowledgeBaseIds || [];
    }
    
    const appointmentEnabled = (widget as any).appointmentBookingEnabled || agentAppointmentBookingEnabled;
    const tools: any[] = [];
    
    if (appointmentEnabled) {
      tools.push({
        type: 'function',
        name: 'book_appointment',
        description: 'Books an appointment for the caller. Call this when the user wants to schedule an appointment. Collect their name, phone number, email (optional), preferred date/time, and reason for the appointment.',
        parameters: {
          type: 'object',
          properties: {
            customerName: {
              type: 'string',
              description: 'Full name of the person booking the appointment'
            },
            customerPhone: {
              type: 'string',
              description: 'Phone number to contact the customer'
            },
            customerEmail: {
              type: 'string',
              description: 'Email address (optional)'
            },
            appointmentDate: {
              type: 'string',
              description: 'Preferred date for the appointment in YYYY-MM-DD format'
            },
            appointmentTime: {
              type: 'string',
              description: 'Preferred time in HH:MM format (24-hour)'
            },
            notes: {
              type: 'string',
              description: 'Reason for appointment or additional notes'
            }
          },
          required: ['customerName', 'customerPhone', 'appointmentDate', 'appointmentTime']
        }
      });
      
      systemPrompt += '\n\nIMPORTANT: You have the ability to book appointments. When a user expresses interest in booking an appointment, you MUST collect ALL of the following information before calling the book_appointment function:\n1. Their full name (ask: "May I have your full name please?")\n2. Their phone number (ask: "What phone number can we reach you at?")\n3. Their preferred date (ask: "What date works best for you?" - convert to YYYY-MM-DD format)\n4. Their preferred time (ask: "What time would you prefer?" - convert to HH:MM 24-hour format)\n5. Optionally their email and reason for the appointment\n\nDo NOT call the book_appointment function until you have confirmed all required details (name, phone, date, time). Once you have all the information, call the book_appointment function to complete the booking and confirm the appointment details with the caller.';
    }
    
    // Add knowledge base lookup tool if agent has knowledge bases
    if (knowledgeBaseIds.length > 0) {
      tools.push({
        type: 'function',
        name: 'lookup_knowledge_base',
        description: 'Search the knowledge base for relevant information to answer user questions. Use this when you need facts, policies, product details, or any information that might be stored.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query to find relevant information. Be specific and include key terms.'
            }
          },
          required: ['query']
        }
      });
    }
    
    const modelMapping: Record<string, string> = {
      'gpt-realtime-1.5': 'gpt-realtime-1.5',
      'gpt-realtime': 'gpt-realtime',
      'gpt-realtime-mini': 'gpt-realtime-mini',
      'gpt-4o-realtime-preview': 'gpt-realtime-1.5',
      'gpt-4o-mini-realtime-preview': 'gpt-realtime-mini',
      'gpt-4o-realtime': 'gpt-realtime-1.5',
      'gpt-4o-mini-realtime': 'gpt-realtime-mini',
      'gpt-4o-realtime-preview-2024-12-17': 'gpt-realtime-1.5',
      'gpt-4o-mini-realtime-preview-2024-12-17': 'gpt-realtime-mini',
    };
    const rawModel = (agent as any).openaiModel || 'gpt-realtime-1.5';
    const openaiModel = modelMapping[rawModel] || rawModel;
    
    const sessionConfig: any = {
      type: 'realtime',
      model: openaiModel,
      instructions: systemPrompt,
      audio: {
        output: {
          voice,
        },
        input: {
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
          },
          transcription: {
            model: 'whisper-1',
          },
        },
      },
    };
    
    if (tools.length > 0) {
      sessionConfig.tools = tools;
    }
    
    const ephemeralResponse = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${credential.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ session: sessionConfig }),
    });
    
    if (!ephemeralResponse.ok) {
      const errorData = await ephemeralResponse.text();
      console.error('[Widget] OpenAI Realtime API Error:', {
        status: ephemeralResponse.status,
        statusText: ephemeralResponse.statusText,
        body: errorData,
        credentialId: credential.id,
        model: openaiModel
      });
      
      let userMessage = 'Failed to initialize AI session';
      try {
        const parsed = JSON.parse(errorData);
        if (parsed.error?.message) {
          if (parsed.error.message.includes('does not exist') || parsed.error.message.includes('not found')) {
            userMessage = 'OpenAI Realtime API access not available. Please check your API key permissions.';
          } else if (parsed.error.message.includes('quota') || parsed.error.message.includes('rate')) {
            userMessage = 'AI service is temporarily busy. Please try again in a moment.';
          } else if (parsed.error.message.includes('invalid') || parsed.error.message.includes('unauthorized')) {
            userMessage = 'AI service authentication failed. Please contact support.';
          }
        }
      } catch (e) {}
      
      return res.status(500).json({ error: userMessage });
    }
    
    const tokenData = await ephemeralResponse.json();
    console.log('[Widget] OpenAI Realtime client_secrets response:', JSON.stringify(tokenData));
    
    await widgetStorage.updateSession(session.id, {
      status: 'active',
      startedAt: new Date(),
    });
    
    res.json({
      engine: 'openai',
      client_secret: tokenData.client_secret?.value || tokenData.value || tokenData.client_secret,
      model: openaiModel,
      maxDuration: widget.maxCallDuration,
      appointmentBookingEnabled: appointmentEnabled,
    });
  } catch (error) {
    console.error('Error getting ephemeral token:', error);
    res.status(500).json({ error: 'Failed to get ephemeral token' });
  }
});

router.post('/widget/session/:sessionId/book-appointment', async (req: Request, res: Response) => {
  try {
    const { sessionToken, customerName, customerPhone, customerEmail, appointmentDate, appointmentTime, notes } = req.body;
    const session = await widgetStorage.getSessionById(req.params.sessionId);
    
    if (!session || session.sessionToken !== sessionToken) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    const widget = await widgetStorage.getWidgetById(session.widgetId);
    if (!widget) {
      return res.status(404).json({ error: 'Widget not found' });
    }
    
    if (!customerName || !customerPhone || !appointmentDate || !appointmentTime) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: customerName, customerPhone, appointmentDate, appointmentTime' 
      });
    }
    
    const dateTimeString = `${appointmentDate}T${appointmentTime}:00`;
    const scheduledAt = new Date(dateTimeString);
    
    if (isNaN(scheduledAt.getTime())) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid date or time format' 
      });
    }
    
    if (scheduledAt < new Date()) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot book appointments in the past' 
      });
    }
    
    const [settings] = await db
      .select()
      .from(appointmentSettings)
      .where(eq(appointmentSettings.userId, widget.userId));
    
    const dayOfWeek = scheduledAt.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase() as keyof typeof settings.workingHours;
    
    if (settings?.workingHours) {
      const daySettings = settings.workingHours[dayOfWeek];
      if (daySettings && !daySettings.enabled) {
        return res.status(400).json({ 
          success: false, 
          message: `Appointments are not available on ${dayOfWeek}s` 
        });
      }
      
      if (daySettings && daySettings.enabled) {
        if (appointmentTime < daySettings.start || appointmentTime >= daySettings.end) {
          return res.status(400).json({ 
            success: false, 
            message: `Appointments are only available between ${daySettings.start} and ${daySettings.end}` 
          });
        }
      }
    }
    
    const slotDuration = 30;
    const slotEnd = new Date(scheduledAt.getTime() + slotDuration * 60000);
    
    const existingAppointments = await db
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.userId, widget.userId),
          eq(appointments.status, 'scheduled')
        )
      );
    
    const hasConflict = existingAppointments.some(apt => {
      const aptDateTime = new Date(`${apt.appointmentDate}T${apt.appointmentTime}`);
      const aptEnd = new Date(aptDateTime.getTime() + (apt.duration || 30) * 60000);
      return (scheduledAt < aptEnd && slotEnd > aptDateTime);
    });
    
    const allowOverlapping = settings?.allowOverlapping || false;
    if (hasConflict && !allowOverlapping) {
      return res.status(400).json({ 
        success: false, 
        message: 'This time slot is not available. Please choose a different time.' 
      });
    }
    
    const appointmentId = `appt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const [appointment] = await db.insert(appointments).values({
      id: appointmentId,
      userId: widget.userId,
      contactName: customerName,
      contactPhone: customerPhone,
      contactEmail: customerEmail || null,
      appointmentDate: appointmentDate,
      appointmentTime: appointmentTime,
      duration: slotDuration,
      notes: notes || null,
      status: 'scheduled',
      metadata: {
        source: 'widget',
        widgetId: widget.id,
        widgetName: widget.name,
        sessionId: session.id,
      },
    }).returning();
    
    console.log(`[Widget] Appointment booked: ${appointment.id} for ${customerName} at ${scheduledAt.toISOString()}`);
    
    res.json({
      success: true,
      message: `Appointment confirmed for ${customerName} on ${appointmentDate} at ${appointmentTime}`,
      appointmentId: appointment.id,
      scheduledAt: scheduledAt.toISOString(),
    });
  } catch (error) {
    console.error('Error booking appointment:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to book appointment. Please try again.' 
    });
  }
});

// Knowledge Base lookup endpoint for widget sessions
router.post('/widget/session/:sessionId/knowledge-lookup', async (req: Request, res: Response) => {
  try {
    const { sessionToken, query } = req.body;
    const session = await widgetStorage.getSessionById(req.params.sessionId);
    
    if (!session || session.sessionToken !== sessionToken) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    const widget = await widgetStorage.getWidgetById(session.widgetId);
    if (!widget) {
      return res.status(404).json({ error: 'Widget not found' });
    }
    
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ 
        found: false, 
        message: 'Query is required' 
      });
    }
    
    // Get the agent's knowledge base IDs
    let knowledgeBaseIds: string[] = [];
    if (widget.agentId) {
      const [agent] = await db
        .select({
          knowledgeBaseIds: agents.knowledgeBaseIds,
        })
        .from(agents)
        .where(eq(agents.id, widget.agentId))
        .limit(1);
      
      if (agent && agent.knowledgeBaseIds && agent.knowledgeBaseIds.length > 0) {
        knowledgeBaseIds = agent.knowledgeBaseIds;
      }
    }
    
    if (knowledgeBaseIds.length === 0) {
      return res.json({ 
        found: false, 
        message: 'No knowledge base configured for this agent.' 
      });
    }
    
    console.log(`[Widget KB] Searching for: "${query.substring(0, 50)}..." in ${knowledgeBaseIds.length} knowledge bases`);
    
    const results = await RAGKnowledgeService.searchKnowledge(
      query,
      knowledgeBaseIds,
      widget.userId,
      5 // max results
    );
    
    if (results.length === 0) {
      return res.json({ 
        found: false, 
        message: 'No relevant information found in the knowledge base.' 
      });
    }
    
    // Format results for the agent
    const formattedResults = RAGKnowledgeService.formatResultsForAgent(results, 800);
    
    console.log(`[Widget KB] Found ${results.length} results for session ${session.id}`);
    
    res.json({
      found: true,
      content: formattedResults,
      resultCount: results.length,
    });
  } catch (error) {
    console.error('Error in knowledge lookup:', error);
    res.status(500).json({ 
      found: false, 
      message: 'Failed to search knowledge base. Please try again.' 
    });
  }
});

export default router;
