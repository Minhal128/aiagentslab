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
import { useState, useMemo } from "react";
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DataPagination, usePagination } from "@/components/ui/data-pagination";
import { Plus, Search, Trash2, Edit, Bot, Upload, Sparkles, GitBranch, CheckCircle2, XCircle, Mic, Brain, Settings2, Wrench, Check, FileText, History, Info } from "lucide-react";
import { AuthStorage } from "@/lib/auth-storage";
import PromptTemplatesLibrary from "@/components/PromptTemplatesLibrary";
import Voices from "@/pages/Voices";
import PromptTemplates from "@/pages/PromptTemplates";
import AgentVersionHistory from "@/components/AgentVersionHistory";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import VoiceSearchPicker from "@/components/VoiceSearchPicker";
import VoicePreviewButton from "@/components/VoicePreviewButton";
import OpenAIVoicePreviewButton from "@/components/OpenAIVoicePreviewButton";
import AgentCreationWizard from "@/components/AgentCreationWizard";
import { Wand2 } from "lucide-react";
import { SUPPORTED_LANGUAGES, getLanguageLabel, isProviderSupported } from "@/lib/languages";
import { LanguageOptionLabel } from "@/components/LanguageProviderBadges";
import { usePluginStatus } from "@/hooks/use-plugin-status";

interface SipPhoneNumber {
  id: string;
  phoneNumber: string;
  label?: string;
  trunkId: string;
  engine: string;
}

interface Agent {
  id: string;
  type: 'incoming' | 'flow';
  name: string;
  voiceTone: string;
  personality: string;
  systemPrompt: string;
  elevenLabsAgentId: string | null;
  elevenLabsVoiceId: string | null;
  agentLink: string | null;
  language: string | null;
  llmModel: string | null;
  firstMessage: string | null;
  temperature: number | null;
  knowledgeBaseIds: string[] | null;
  config: any;
  flowId: string | null;
  maxDurationSeconds: number | null;
  voiceStability: number | null;
  voiceSimilarityBoost: number | null;
  voiceSpeed: number | null;
  turnTimeout: number | null;
  transferEnabled: boolean | null;
  transferPhoneNumber: string | null;
  detectLanguageEnabled: boolean | null;
  endConversationEnabled: boolean | null;
  appointmentBookingEnabled: boolean | null;
  appointmentDoctorName: string | null;
  expressiveMode: boolean | null;
  telephonyProvider: 'twilio' | 'plivo' | 'twilio_openai' | 'elevenlabs-sip' | 'openai-sip' | null;
  openaiVoice: string | null;
  createdAt: string;
}

// OpenAI Realtime API voice options (for Plivo+OpenAI and Twilio+OpenAI engines)
const openaiVoices = [
  { value: "alloy", label: "Alloy", description: "Versatile and balanced" },
  { value: "echo", label: "Echo", description: "Warm and confident" },
  { value: "shimmer", label: "Shimmer", description: "Clear and expressive" },
  { value: "ash", label: "Ash", description: "Soft and gentle" },
  { value: "ballad", label: "Ballad", description: "Melodic and soothing" },
  { value: "coral", label: "Coral", description: "Bright and friendly" },
  { value: "sage", label: "Sage", description: "Calm and wise" },
  { value: "verse", label: "Verse", description: "Poetic and articulate" },
  { value: "cedar", label: "Cedar", description: "Deep and grounded" },
  { value: "marin", label: "Marin", description: "Fresh and lively" },
  { value: "arjun", label: "Arjun", description: "Warm Indian tone" },
];

interface Voice {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
  preview_url?: string;
}

interface KnowledgeBaseItem {
  id: string;
  type: string;
  title: string;
  content?: string;
  url?: string;
  fileUrl?: string;
  elevenLabsDocId: string | null;
  storageSize: number;
  createdAt: string;
}

// LLM cost estimates per minute (in USD)
const MODEL_COSTS: Record<string, { llm: number; name: string; speed: string }> = {
  // ElevenLabs Models
  "glm-45-air-fp8": { llm: 0.0106, name: "GLM-4.5-Air", speed: "Balanced" },
  "qwen3-30b-a3b": { llm: 0.0033, name: "Qwen3-30B-A3B", speed: "Ultra Fast" },
  "gpt-oss-120b": { llm: 0.02, name: "GPT-OSS-120B", speed: "High Quality" },
  
  // Google Models
  "gemini-2.5-flash": { llm: 0.005, name: "Gemini 2.5 Flash", speed: "Very Fast" },
  "gemini-2.5-flash-lite": { llm: 0.003, name: "Gemini 2.5 Flash Lite", speed: "Ultra Fast" },
  "gemini-2.0-flash": { llm: 0.004, name: "Gemini 2.0 Flash", speed: "Very Fast" },
  "gemini-2.0-flash-lite": { llm: 0.002, name: "Gemini 2.0 Flash Lite", speed: "Ultra Fast" },
  
  // OpenAI Models
  "gpt-4o": { llm: 0.02, name: "GPT-4o", speed: "Balanced" },
  "gpt-4o-mini": { llm: 0.006, name: "GPT-4o Mini", speed: "Fast" },
  "gpt-4-turbo": { llm: 0.04, name: "GPT-4 Turbo", speed: "High Quality" },
  "gpt-3.5-turbo": { llm: 0.003, name: "GPT-3.5 Turbo", speed: "Very Fast" },
  
  // Anthropic Models
  "claude-3-5-sonnet": { llm: 0.06, name: "Claude 3.5 Sonnet", speed: "High Quality" },
  "claude-3-haiku": { llm: 0.01, name: "Claude 3 Haiku", speed: "Fast" },
};

const VOICE_COST = 0.10; // $0.10 per minute for voice service

function EstimatedCost({ model }: { model: string }) {
  const { t } = useTranslation();
  const modelInfo = MODEL_COSTS[model];
  
  // Fetch LLM margin from admin settings
  const { data: marginData } = useQuery<{ llm_margin_percentage: number }>({
    queryKey: ["/api/settings/llm-margin"],
  });
  
  if (!modelInfo) return null;
  
  const marginPercentage = marginData?.llm_margin_percentage || 30;
  const baseLlmCost = modelInfo.llm;
  const llmCostWithMargin = baseLlmCost * (1 + marginPercentage / 100);
  const totalCost = VOICE_COST + llmCostWithMargin;
  
  return (
    <div className="mt-2 p-3 bg-secondary/50 rounded-md text-xs">
      <div className="font-medium mb-1">{t('agents.cost.estimatedBreakdown', { margin: marginPercentage })}</div>
      <div className="space-y-1">
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t('agents.cost.voiceService')}</span>
          <span>${VOICE_COST.toFixed(3)}/min</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t('agents.cost.llm', { model: modelInfo.name })}</span>
          <span>${llmCostWithMargin.toFixed(3)}/min</span>
        </div>
        <div className="h-px bg-border my-2" />
        <div className="flex justify-between font-medium">
          <span>{t('agents.cost.totalCost')}</span>
          <span className="text-primary">${totalCost.toFixed(3)}/min</span>
        </div>
        <div className="mt-2 text-muted-foreground">
          {t('agents.cost.speed')} {modelInfo.speed} • {t('agents.cost.minCall')} ${(totalCost * 60).toFixed(2)}
        </div>
      </div>
    </div>
  );
}

export default function Agents() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'agents' | 'templates' | 'voices'>('agents');
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<'all' | 'incoming' | 'flow'>('all');
  const [engineFilter, setEngineFilter] = useState<'all' | 'twilio' | 'plivo' | 'twilio_openai' | 'elevenlabs-sip' | 'openai-sip'>('all');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [knowledgeUploadOpen, setKnowledgeUploadOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [deletingAgent, setDeletingAgent] = useState<Agent | null>(null);
  const [formData, setFormData] = useState({
    type: "incoming" as 'incoming' | 'flow',
    name: "",
    voiceTone: "professional",
    personality: "helpful",
    systemPrompt: "",
    elevenLabsVoiceId: "",
    language: "en",
    llmModel: "gpt-4o-mini",
    firstMessage: "Hello! How can I help you today?",
    temperature: 0.5,
    knowledgeBaseIds: [] as string[],
    transferNumber: "",
    transferKeywords: [] as string[],
    // System Tools configuration
    transferEnabled: false,
    transferPhoneNumber: "",
    detectLanguageEnabled: false,
    endConversationEnabled: false,
    appointmentBookingEnabled: false,
    appointmentDoctorName: "",
    messagingEmailEnabled: false,
    messagingWhatsappEnabled: false,
    messagingEmailTemplate: "",
    messagingWhatsappTemplate: "",
    messagingWhatsappVariables: "",
    expressiveMode: false,
    // Flow Agent specific fields
    flowId: "",
    maxDurationSeconds: 600,
    voiceStability: 0.5,
    voiceSimilarityBoost: 0.85,
    voiceSpeed: 1.0,
    turnTimeout: 1.5,
    // Telephony Provider selection (Twilio/ElevenLabs, Plivo/OpenAI, Twilio/OpenAI, or SIP engines)
    telephonyProvider: "twilio" as "twilio" | "plivo" | "twilio_openai" | "elevenlabs-sip" | "openai-sip",
    openaiVoice: "alloy",
    // SIP phone number selection (for SIP engines)
    sipPhoneNumberId: "",
  });
  const [knowledgeData, setKnowledgeData] = useState({
    title: "",
    type: "document",
    content: "",
  });
  
  // Animation state for success/failure feedback
  const [animationState, setAnimationState] = useState<'idle' | 'success' | 'error'>('idle');

  const { data: agents = [], isLoading: agentsLoading } = useQuery<Agent[]>({
    queryKey: ["/api/agents"],
  });

  const { data: voices = [] } = useQuery<Voice[]>({
    queryKey: ["/api/elevenlabs/voices"],
  });

  // Voice lookup helper - only uses account voices
  const getVoiceName = useMemo(() => {
    const voiceMap = new Map(voices.map(v => [v.voice_id, v.name]));
    return (voiceId: string | null): string | null => {
      if (!voiceId) return null;
      return voiceMap.get(voiceId) || null;
    };
  }, [voices]);

  const { data: knowledgeBase = [] } = useQuery<KnowledgeBaseItem[]>({
    queryKey: ["/api/knowledge-base"],
  });

  // Fetch available LLM models for current user (filtered by plan tier)
  const { data: availableLLMModels = [] } = useQuery<Array<{
    id: string;
    modelId: string;
    name: string;
    provider: string;
    tier: 'free' | 'pro';
    isActive: boolean;
  }>>({
    queryKey: ["/api/llm-models/available"],
  });

  const { data: flows = [] } = useQuery<Array<{ id: string; name: string; description: string }>>({
    queryKey: ["/api/flow-automation/flows"],
  });

  // Fetch voice engine settings to check if Plivo+OpenAI or Twilio+OpenAI is enabled
  const { data: voiceEngineSettings } = useQuery<{ plivo_openai_engine_enabled: boolean; twilio_openai_engine_enabled: boolean; default_tts_model?: string }>({
    queryKey: ["/api/settings/voice-engine"],
    staleTime: 60000,
  });

  const isPlivoEnabled = voiceEngineSettings?.plivo_openai_engine_enabled ?? false;
  const isTwilioOpenaiEnabled = voiceEngineSettings?.twilio_openai_engine_enabled ?? false;
  const isV3TtsModel = (voiceEngineSettings?.default_tts_model || '').includes('v3');

  // Check if SIP plugin is enabled and which engines are allowed
  const { isSipPluginEnabled, sipEnginesAllowed } = usePluginStatus();
  const isElevenLabsSipAllowed = isSipPluginEnabled && sipEnginesAllowed.includes("elevenlabs-sip");
  const isOpenAISipAllowed = isSipPluginEnabled && sipEnginesAllowed.includes("openai-sip");

  // Fetch SIP phone numbers when SIP plugin is enabled
  const { data: sipPhoneNumbersResponse } = useQuery<{ success: boolean; data: SipPhoneNumber[] }>({
    queryKey: ["/api/sip/phone-numbers"],
    enabled: isSipPluginEnabled,
  });
  const sipPhoneNumbers = sipPhoneNumbersResponse?.data || [];

  const hasAlternateEngines = isPlivoEnabled || isTwilioOpenaiEnabled || isElevenLabsSipAllowed || isOpenAISipAllowed;

  const { data: emailTemplatesResponse } = useQuery<{ success: boolean; data: Array<{ id: string; name: string }> }>({
    queryKey: ["/api/messaging/email-templates"],
    staleTime: 60000,
  });
  const emailTemplates = emailTemplatesResponse?.data || [];
  const hasEmailTemplates = emailTemplates.length > 0;

  const { data: whatswaySettingsResponse } = useQuery<{ success: boolean; data: any }>({
    queryKey: ["/api/messaging/whatsway/settings"],
    staleTime: 60000,
  });
  const { data: metaWhatsAppSettingsResponse } = useQuery<{ success: boolean; data: any }>({
    queryKey: ["/api/messaging/meta-whatsapp/settings"],
    staleTime: 60000,
  });
  const isWhatsAppActive = !!(whatswaySettingsResponse?.data?.isActive || metaWhatsAppSettingsResponse?.data?.isActive);

  const { data: whatswayTemplatesResponse } = useQuery<{ success: boolean; data: Array<{ name: string; id?: string; components?: any[] }> }>({
    queryKey: ["/api/messaging/whatsway/templates"],
    enabled: !!(whatswaySettingsResponse?.data?.isActive),
    staleTime: 60000,
  });
  const { data: metaTemplatesResponse } = useQuery<{ success: boolean; data: Array<{ name: string; id?: string; components?: any[] }> }>({
    queryKey: ["/api/messaging/meta-whatsapp/templates"],
    enabled: !!(metaWhatsAppSettingsResponse?.data?.isActive),
    staleTime: 60000,
  });
  const whatsappTemplates = whatswayTemplatesResponse?.data || metaTemplatesResponse?.data || [];

  const getWhatsAppTemplateVariables = (templateName: string): number[] => {
    const template = whatsappTemplates.find(t => t.name === templateName);
    if (!template?.components) return [];
    const bodyComponent = template.components.find((c: any) => c.type === 'BODY');
    if (!bodyComponent?.text) return [];
    const matches = bodyComponent.text.match(/\{\{(\d+)\}\}/g) || [];
    return matches.map((m: string) => parseInt(m.replace(/[{}]/g, '')));
  };

  const getWhatsAppTemplateHeaderInfo = (templateName: string): { format: string; hasVariable: boolean; text?: string } | null => {
    const template = whatsappTemplates.find(t => t.name === templateName);
    if (!template?.components) return null;
    const headerComp = template.components.find((c: any) => c.type === 'HEADER');
    if (!headerComp) return null;
    const format = (headerComp.format || '').toUpperCase();
    if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(format)) {
      return { format, hasVariable: true, text: headerComp.text };
    }
    if (format === 'TEXT' && headerComp.text) {
      const matches = headerComp.text.match(/\{\{\d+\}\}/g) || [];
      if (matches.length > 0) return { format, hasVariable: true, text: headerComp.text };
    }
    return null;
  };

  const getWhatsAppTemplateButtonVariables = (templateName: string): Array<{ index: number; label: string; url: string }> => {
    const template = whatsappTemplates.find(t => t.name === templateName);
    if (!template?.components) return [];
    const buttonsComponent = template.components.find((c: any) => c.type === 'BUTTONS' || c.type === 'buttons');
    if (!buttonsComponent?.buttons || !Array.isArray(buttonsComponent.buttons)) return [];
    const result: Array<{ index: number; label: string; url: string }> = [];
    buttonsComponent.buttons.forEach((btn: any, index: number) => {
      if (btn.type === 'URL' && btn.url && btn.url.includes('{{')) {
        result.push({ index, label: btn.text || `Button ${index + 1}`, url: btn.url });
      }
    });
    return result;
  };

  const parseWhatsAppVariables = (varsJson: string): Record<string, { mode: 'fixed' | 'collect'; value: string; componentType?: string }> => {
    try {
      if (!varsJson) return {};
      const parsed = JSON.parse(varsJson);
      const result: Record<string, { mode: 'fixed' | 'collect'; value: string; componentType?: string }> = {};
      for (const [key, val] of Object.entries(parsed)) {
        if (typeof val === 'string') {
          result[key] = { mode: 'collect', value: val };
        } else if (val && typeof val === 'object' && 'mode' in (val as any)) {
          result[key] = val as { mode: 'fixed' | 'collect'; value: string; componentType?: string };
        }
      }
      return result;
    } catch {
      return {};
    }
  };

  // Fetch OpenAI Realtime models (for Plivo+OpenAI or Twilio+OpenAI engine)
  const { data: openaiModelsData } = useQuery<{
    tier: 'free' | 'pro';
    models: string[];
    description: string;
    allTiers: Record<string, { models: string[]; description: string }>;
  }>({
    queryKey: ["/api/plivo/openai/models"],
    enabled: isPlivoEnabled || isTwilioOpenaiEnabled || formData.telephonyProvider === "plivo" || formData.telephonyProvider === "twilio_openai",
    staleTime: 60000,
  });

  // OpenAI Realtime models with display info
  const openaiRealtimeModels = useMemo(() => {
    if (!openaiModelsData?.models) return [];
    
    const modelInfo: Record<string, { name: string; tier: 'free' | 'pro'; description: string }> = {
      'gpt-realtime-2': { name: 'GPT Realtime 2', tier: 'pro', description: 'Advanced GPT-5-class reasoning realtime voice model' },
      'gpt-realtime-translate': { name: 'GPT Realtime Translate', tier: 'pro', description: 'Live translation model from 70+ languages' },
      'gpt-realtime-whisper': { name: 'GPT Realtime Whisper', tier: 'pro', description: 'Streaming live speech-to-text transcription model' },
      'gpt-realtime-1.5': { name: 'GPT Realtime 1.5', tier: 'pro', description: 'The best voice model for audio in, audio out' },
      'gpt-realtime': { name: 'GPT Realtime', tier: 'pro', description: 'Realtime text and audio inputs and outputs' },
      'gpt-realtime-mini': { name: 'GPT Realtime Mini', tier: 'free', description: 'A cost-efficient version of GPT Realtime' },
      'gpt-4o-realtime-preview': { name: 'GPT-4o Realtime Preview', tier: 'pro', description: 'Preview model for projects without GA access' },
      'gpt-4o-mini-realtime-preview': { name: 'GPT-4o Mini Realtime Preview', tier: 'free', description: 'Preview mini model for projects without GA access' },
    };
    
    return openaiModelsData.models.map(modelId => {
      const info = modelInfo[modelId] || { name: modelId, tier: 'free' as const, description: 'OpenAI Realtime model' };
      return {
        id: modelId,
        modelId,
        name: info.name,
        tier: info.tier,
        description: info.description,
      };
    });
  }, [openaiModelsData]);

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest("POST", "/api/agents", data);
      return res.json();
    },
    onSuccess: () => {
      // Trigger success animation
      setAnimationState('success');
      setTimeout(() => {
        setAnimationState('idle');
        queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
        setCreateDialogOpen(false);
        resetForm();
      }, 1500);
      toast({ title: t('agents.toast.created') });
    },
    onError: (error: any) => {
      // Trigger error animation
      setAnimationState('error');
      setTimeout(() => setAnimationState('idle'), 600);
      toast({
        title: t('agents.toast.createFailed'),
        description: error.message || t('agents.toast.tryAgain'),
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<typeof formData> }) => {
      const res = await apiRequest("PATCH", `/api/agents/${id}`, data);
      return res.json();
    },
    onSuccess: (data) => {
      // Trigger success animation
      setAnimationState('success');
      setTimeout(() => {
        setAnimationState('idle');
        queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
        setEditingAgent(null);
        resetForm();
      }, 1500);
      
      if (data.warning) {
        toast({ 
          title: t('agents.toast.updated'),
          description: data.warning,
        });
      } else {
        toast({ title: t('agents.toast.updated') });
      }
    },
    onError: (error: any) => {
      // Trigger error animation
      setAnimationState('error');
      setTimeout(() => setAnimationState('idle'), 600);
      toast({
        title: t('agents.toast.updateFailed'),
        description: error.message || t('agents.toast.tryAgain'),
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/agents/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
      setDeletingAgent(null);
      toast({ title: t('agents.toast.deleted') });
    },
    onError: (error: any) => {
      toast({
        title: t('agents.toast.deleteFailed'),
        description: error.message || t('agents.toast.tryAgain'),
        variant: "destructive",
      });
    },
  });

  const uploadKnowledgeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/knowledge-base", knowledgeData);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge-base"] });
      setKnowledgeUploadOpen(false);
      setKnowledgeData({ title: "", type: "document", content: "" });
      toast({ title: t('agents.toast.knowledgeUploaded') });
    },
    onError: (error: any) => {
      toast({
        title: t('agents.toast.knowledgeUploadFailed'),
        description: error.message || t('agents.toast.tryAgain'),
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setFormData({
      type: "incoming" as 'incoming' | 'flow',
      name: "",
      voiceTone: "professional",
      personality: "helpful",
      systemPrompt: "",
      elevenLabsVoiceId: "",
      language: "en",
      llmModel: "gpt-4o-mini",
      firstMessage: "Hello! How can I help you today?",
      temperature: 0.5,
      knowledgeBaseIds: [],
      transferNumber: "",
      transferKeywords: [],
      // System Tools configuration
      transferEnabled: false,
      transferPhoneNumber: "",
      detectLanguageEnabled: false,
      endConversationEnabled: false,
      appointmentBookingEnabled: false,
      appointmentDoctorName: "",
      messagingEmailEnabled: false,
      messagingWhatsappEnabled: false,
      messagingEmailTemplate: "",
      messagingWhatsappTemplate: "",
      messagingWhatsappVariables: "",
      expressiveMode: false,
      flowId: "",
      maxDurationSeconds: 600,
      voiceStability: 0.5,
      voiceSimilarityBoost: 0.85,
      voiceSpeed: 1.0,
      turnTimeout: 1.5,
      // Telephony Provider selection
      telephonyProvider: "twilio" as "twilio" | "plivo" | "twilio_openai" | "elevenlabs-sip" | "openai-sip",
      openaiVoice: "alloy",
      sipPhoneNumberId: "",
    });
  };

  const handleCreate = () => {
    if (!formData.name) {
      toast({
        title: t('agents.toast.missingFields'),
        description: t('agents.toast.pleaseEnterName'),
        variant: "destructive",
      });
      return;
    }

    // Incoming Agent validation
    if (formData.type === 'incoming') {
      // Voice validation depends on telephony provider
      const isOpenAIVoice = formData.telephonyProvider === "plivo" || formData.telephonyProvider === "twilio_openai" || formData.telephonyProvider === "openai-sip";
      const hasValidVoice = isOpenAIVoice
        ? !!formData.openaiVoice 
        : !!formData.elevenLabsVoiceId;
      // Note: SIP phone number selection moved to campaign level
      if (!hasValidVoice) {
        toast({
          title: t('agents.toast.missingFields'),
          description: t('agents.toast.pleaseSelectVoice'),
          variant: "destructive",
        });
        return;
      }
      if (!formData.systemPrompt) {
        toast({
          title: t('agents.toast.missingFields'),
          description: t('agents.toast.systemPromptRequired'),
          variant: "destructive",
        });
        return;
      }
      // Validate call transfer configuration
      if (formData.transferEnabled && !formData.transferPhoneNumber.trim()) {
        toast({
          title: t('agents.toast.missingTransferPhone'),
          description: t('agents.toast.transferPhoneRequired'),
          variant: "destructive",
        });
        return;
      }
      if (formData.messagingEmailEnabled && !formData.messagingEmailTemplate) {
        toast({
          title: t('agents.toast.missingFields'),
          description: "Please select an email template when email sending is enabled.",
          variant: "destructive",
        });
        return;
      }
      if (formData.messagingWhatsappEnabled && !formData.messagingWhatsappTemplate) {
        toast({
          title: t('agents.toast.missingFields'),
          description: "Please select a WhatsApp template when WhatsApp sending is enabled.",
          variant: "destructive",
        });
        return;
      }
    }

    // Flow Agent validation
    if (formData.type === 'flow') {
      if (!formData.flowId) {
        toast({
          title: t('agents.toast.missingFields'),
          description: t('agents.toast.flowRequired'),
          variant: "destructive",
        });
        return;
      }
      // Voice validation depends on telephony provider for flow agents
      const isOpenAIVoiceFlow = formData.telephonyProvider === "plivo" || formData.telephonyProvider === "twilio_openai" || formData.telephonyProvider === "openai-sip";
      const hasValidVoice = isOpenAIVoiceFlow
        ? !!formData.openaiVoice 
        : !!formData.elevenLabsVoiceId;
      // Note: SIP phone number selection moved to campaign level
      if (!hasValidVoice) {
        toast({
          title: t('agents.toast.missingFields'),
          description: t('agents.toast.pleaseSelectVoice'),
          variant: "destructive",
        });
        return;
      }
    }

    createMutation.mutate(formData);
  };

  const handleEdit = (agent: Agent) => {
    setEditingAgent(agent);
    setFormData({
      type: agent.type || "incoming",
      name: agent.name,
      voiceTone: agent.voiceTone || "professional",
      personality: agent.personality || "helpful",
      systemPrompt: agent.systemPrompt || "",
      elevenLabsVoiceId: agent.elevenLabsVoiceId || "",
      language: agent.language || "en",
      llmModel: agent.llmModel || "gpt-4o-mini",
      firstMessage: agent.firstMessage || "Hello! How can I help you today?",
      temperature: agent.temperature ?? 0.5,
      knowledgeBaseIds: agent.knowledgeBaseIds || [],
      transferNumber: agent.config?.transferRules?.number || "",
      transferKeywords: agent.config?.transferRules?.keywords || [],
      // System Tools configuration
      transferEnabled: agent.transferEnabled ?? false,
      transferPhoneNumber: agent.transferPhoneNumber || "",
      detectLanguageEnabled: agent.detectLanguageEnabled ?? false,
      endConversationEnabled: agent.endConversationEnabled ?? false,
      appointmentBookingEnabled: agent.appointmentBookingEnabled ?? false,
      appointmentDoctorName: (agent as any).appointmentDoctorName || "",
      messagingEmailEnabled: (agent as any).messagingEmailEnabled ?? false,
      messagingWhatsappEnabled: (agent as any).messagingWhatsappEnabled ?? false,
      messagingEmailTemplate: (agent as any).messagingEmailTemplate || "",
      messagingWhatsappTemplate: (agent as any).messagingWhatsappTemplate || "",
      messagingWhatsappVariables: (agent as any).messagingWhatsappVariables || "",
      expressiveMode: agent.expressiveMode ?? false,
      flowId: agent.flowId || "",
      maxDurationSeconds: agent.maxDurationSeconds ?? 600,
      voiceStability: agent.voiceStability ?? 0.5,
      voiceSimilarityBoost: agent.voiceSimilarityBoost ?? 0.85,
      voiceSpeed: agent.voiceSpeed ?? 1.0,
      turnTimeout: agent.turnTimeout ?? 1.5,
      // Telephony Provider selection
      telephonyProvider: (agent.telephonyProvider || "twilio") as "twilio" | "plivo" | "twilio_openai" | "elevenlabs-sip" | "openai-sip",
      openaiVoice: agent.openaiVoice || "alloy",
      sipPhoneNumberId: (agent as any).sipPhoneNumberId || "",
    });
  };

  const handleUpdate = () => {
    if (!editingAgent) return;
    
    // Validate call transfer configuration for incoming agents
    if (formData.type === 'incoming' && formData.transferEnabled && !formData.transferPhoneNumber.trim()) {
      toast({
        title: t('agents.toast.missingTransferPhone'),
        description: t('agents.toast.transferPhoneRequired'),
        variant: "destructive",
      });
      return;
    }
    if (formData.type === 'incoming' && formData.messagingEmailEnabled && !formData.messagingEmailTemplate) {
      toast({
        title: t('agents.toast.missingFields'),
        description: "Please select an email template when email sending is enabled.",
        variant: "destructive",
      });
      return;
    }
    if (formData.type === 'incoming' && formData.messagingWhatsappEnabled && !formData.messagingWhatsappTemplate) {
      toast({
        title: t('agents.toast.missingFields'),
        description: "Please select a WhatsApp template when WhatsApp sending is enabled.",
        variant: "destructive",
      });
      return;
    }
    
    updateMutation.mutate({ id: editingAgent.id, data: formData });
  };

  const filteredAgents = agents
    .filter((agent) => {
      // Filter by type
      if (typeFilter !== 'all' && agent.type !== typeFilter) {
        return false;
      }
      // Filter by engine/telephony provider
      if (engineFilter !== 'all') {
        const agentProvider = agent.telephonyProvider || 'twilio';
        if (agentProvider !== engineFilter) {
          return false;
        }
      }
      // Filter by search query
      return agent.name.toLowerCase().includes(searchQuery.toLowerCase());
    });

  // Pagination for agents grid
  const {
    currentPage,
    totalPages,
    totalItems,
    itemsPerPage,
    paginatedItems,
    handlePageChange,
    handleItemsPerPageChange,
  } = usePagination(filteredAgents, 9);

  const incomingCount = agents.filter(a => a.type === 'incoming').length;
  const flowCount = agents.filter(a => a.type === 'flow').length;

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'agents' | 'templates' | 'voices')} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-3 mb-6">
          <TabsTrigger value="agents" className="flex items-center gap-2" data-testid="tab-agents">
            <Bot className="h-4 w-4" />
            {t('nav.agents')}
          </TabsTrigger>
          <TabsTrigger value="templates" className="flex items-center gap-2" data-testid="tab-templates">
            <FileText className="h-4 w-4" />
            {t('nav.promptTemplates')}
          </TabsTrigger>
          <TabsTrigger value="voices" className="flex items-center gap-2" data-testid="tab-voices">
            <Mic className="h-4 w-4" />
            {t('nav.voices')}
          </TabsTrigger>
        </TabsList>

        {/* Prompt Templates Tab */}
        <TabsContent value="templates" className="mt-0">
          <PromptTemplates />
        </TabsContent>

        {/* Voices Tab */}
        <TabsContent value="voices" className="mt-0">
          <Voices />
        </TabsContent>

        {/* Agents Tab */}
        <TabsContent value="agents" className="mt-0 space-y-6">
      {/* Page Header with Light Gradient */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-50 via-indigo-50 to-violet-50 dark:from-blue-950/40 dark:via-indigo-950/40 dark:to-violet-950/40 border border-blue-100 dark:border-blue-900/50 p-6 md:p-8">
        <div className="absolute inset-0 bg-grid-slate-200/50 dark:bg-grid-slate-700/20 [mask-image:linear-gradient(0deg,transparent,rgba(255,255,255,0.5))]" />
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/25">
              <Bot className="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-foreground">{t('agents.title')}</h1>
              <p className="text-muted-foreground mt-0.5">{t('agents.description')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              onClick={() => setWizardOpen(true)}
              variant="outline"
              className="border-violet-200 dark:border-violet-800 hover:bg-violet-50 dark:hover:bg-violet-950"
              data-testid="button-wizard-agent"
            >
              <Wand2 className="h-4 w-4 mr-2 text-violet-600 dark:text-violet-400" />
              {t('agents.guidedWizard', 'Guided Wizard')}
            </Button>
            <Button 
              onClick={() => setCreateDialogOpen(true)} 
              disabled={createDialogOpen} 
              className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg"
              data-testid="button-create-agent"
            >
              <Plus className="h-4 w-4 mr-2" />
              {t('agents.createNew')}
            </Button>
          </div>
        </div>
        
        {/* Stats Row */}
        <div className="relative mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white/80 dark:bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-blue-100/50 dark:border-blue-800/30">
            <div className="text-2xl font-bold text-blue-700 dark:text-blue-300">{agents.length}</div>
            <div className="text-blue-600/70 dark:text-blue-400/70 text-sm">{t('agents.stats.totalAgents')}</div>
          </div>
          <div className="bg-white/80 dark:bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-emerald-100/50 dark:border-emerald-800/30">
            <div className="flex items-center gap-2">
              <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{incomingCount}</div>
              <Sparkles className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />
            </div>
            <div className="text-emerald-600/70 dark:text-emerald-400/70 text-sm">{t('agents.type.incoming')}</div>
          </div>
          <div className="bg-white/80 dark:bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-violet-100/50 dark:border-violet-800/30">
            <div className="flex items-center gap-2">
              <div className="text-2xl font-bold text-violet-700 dark:text-violet-300">{flowCount}</div>
              <GitBranch className="h-4 w-4 text-violet-500 dark:text-violet-400" />
            </div>
            <div className="text-violet-600/70 dark:text-violet-400/70 text-sm">{t('agents.type.flow')}</div>
          </div>
        </div>
      </div>

      {/* Filters and Search Row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        {/* Type Filter Tabs */}
        <div className="flex items-center gap-2 p-1 bg-muted/50 rounded-lg">
          <Button
            variant={typeFilter === 'all' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setTypeFilter('all')}
            className={typeFilter === 'all' ? '' : 'text-muted-foreground'}
            data-testid="button-filter-all"
          >
            {t('common.all')} ({agents.length})
          </Button>
          <Button
            variant={typeFilter === 'incoming' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setTypeFilter('incoming')}
            className={typeFilter === 'incoming' ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'text-muted-foreground hover:text-emerald-600'}
            data-testid="button-filter-incoming"
          >
            <Sparkles className="h-4 w-4 mr-1.5" />
            {t('agents.type.incoming')} ({incomingCount})
          </Button>
          <Button
            variant={typeFilter === 'flow' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setTypeFilter('flow')}
            className={typeFilter === 'flow' ? 'bg-violet-600 hover:bg-violet-700 text-white' : 'text-muted-foreground hover:text-violet-600'}
            data-testid="button-filter-flow"
          >
            <GitBranch className="h-4 w-4 mr-1.5" />
            {t('agents.type.flow')} ({flowCount})
          </Button>
        </div>

        {/* Engine Filter Dropdown - Show if multiple engines exist */}
        {hasAlternateEngines && (
          <Select
            value={engineFilter}
            onValueChange={(value) => setEngineFilter(value as typeof engineFilter)}
          >
            <SelectTrigger className="w-48" data-testid="select-engine-filter">
              <SelectValue placeholder="Filter by engine" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Engines</SelectItem>
              <SelectItem value="twilio">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-violet-500" />
                  ElevenLabs + Twilio
                </div>
              </SelectItem>
              {isTwilioOpenaiEnabled && (
                <SelectItem value="twilio_openai">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-brand" />
                    OpenAI + Twilio
                  </div>
                </SelectItem>
              )}
              {isPlivoEnabled && (
                <SelectItem value="plivo">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-emerald-500" />
                    OpenAI + Plivo
                  </div>
                </SelectItem>
              )}
              {isElevenLabsSipAllowed && (
                <SelectItem value="elevenlabs-sip">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-orange-500" />
                    ElevenLabs SIP
                  </div>
                </SelectItem>
              )}
              {isOpenAISipAllowed && (
                <SelectItem value="openai-sip">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-pink-500" />
                    OpenAI SIP
                  </div>
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        )}

        {/* Search */}
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('agents.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            data-testid="input-search-agents"
          />
        </div>
      </div>

      {agentsLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="p-6 animate-pulse">
              <div className="h-6 bg-muted rounded w-3/4 mb-4" />
              <div className="h-4 bg-muted rounded w-full mb-2" />
              <div className="h-4 bg-muted rounded w-2/3" />
            </Card>
          ))}
        </div>
      ) : filteredAgents.length === 0 ? (
        <div className="relative overflow-hidden rounded-2xl border border-dashed border-muted-foreground/25 p-12 text-center">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-violet-500/5" />
          <div className="relative">
            <div className="h-16 w-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-blue-500/20 to-violet-500/20 flex items-center justify-center">
              <Bot className="h-8 w-8 text-blue-600 dark:text-blue-400" />
            </div>
            <h3 className="text-xl font-semibold mb-2">
              {searchQuery ? t('agents.noAgentsFound') : t('agents.noAgents')}
            </h3>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              {searchQuery 
                ? t('agents.noMatchingSearch') 
                : t('agents.getStarted')}
            </p>
            {!searchQuery && (
              <Button 
                onClick={() => setCreateDialogOpen(true)} 
                disabled={createDialogOpen}
                className="bg-gradient-to-r from-blue-600 to-violet-600 text-white"
              >
                <Plus className="h-4 w-4 mr-2" />
                {t('agents.createFirstAgent')}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {paginatedItems.map((agent) => {
            const isOpenAIProvider = agent.telephonyProvider === "plivo" || agent.telephonyProvider === "twilio_openai" || agent.telephonyProvider === "openai-sip";
            const voiceName = isOpenAIProvider 
              ? openaiVoices.find(v => v.value === agent.openaiVoice)?.label || null
              : getVoiceName(agent.elevenLabsVoiceId);
            const languageName = agent.language ? t(`agents.languages.${agent.language}`, { defaultValue: getLanguageLabel(agent.language) }) : t('agents.languages.en');

            const isIncoming = agent.type === 'incoming';
            const cardGradient = isIncoming 
              ? 'from-emerald-500/5 via-transparent to-brand/5 dark:from-emerald-500/10 dark:to-brand/10'
              : 'from-violet-500/5 via-transparent to-indigo-500/5 dark:from-violet-500/10 dark:to-indigo-500/10';
            const iconBg = isIncoming 
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' 
              : 'bg-violet-500/10 text-violet-600 dark:text-violet-400';
            const borderColor = isIncoming 
              ? 'border-emerald-500/20 hover:border-emerald-500/40' 
              : 'border-violet-500/20 hover:border-violet-500/40';

            return (
              <Card 
                key={agent.id} 
                className={`relative overflow-hidden border ${borderColor} transition-all duration-200 hover-elevate group`} 
                data-testid={`card-agent-${agent.id}`}
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${cardGradient}`} />
                <div className="relative p-5">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className={`h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
                        {isIncoming ? <Sparkles className="h-5 w-5" /> : <GitBranch className="h-5 w-5" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold truncate" data-testid="text-agent-name">
                          {agent.name}
                        </h3>
                        <Badge 
                          variant="outline"
                          className={`mt-1 text-xs ${isIncoming 
                            ? 'border-emerald-500/50 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10' 
                            : 'border-violet-500/50 text-violet-700 dark:text-violet-300 bg-violet-500/10'}`}
                          data-testid={`badge-agent-type-${agent.type}`}
                        >
                          {isIncoming ? t('agents.type.incoming') : t('agents.type.flow')}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <AgentVersionHistory 
                        agentId={agent.id} 
                        agentName={agent.name} 
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleEdit(agent)}
                        data-testid="button-edit-agent"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setDeletingAgent(agent)}
                        data-testid="button-delete-agent"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Mic className="h-3.5 w-3.5" />
                      <span data-testid="text-agent-voice">{voiceName || t('agents.voiceNotSet')}</span>
                      <span className="text-muted-foreground/50">•</span>
                      <span data-testid="text-agent-language">{languageName}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span className="capitalize">{agent.voiceTone}</span>
                      <span className="text-muted-foreground/50">•</span>
                      <span className="capitalize">{agent.personality}</span>
                    </div>
                    {agent.config?.model && MODEL_COSTS[agent.config.model] && (
                      <div className={`flex items-center gap-2 text-xs font-medium ${isIncoming ? 'text-emerald-600 dark:text-emerald-400' : 'text-violet-600 dark:text-violet-400'}`}>
                        <span>≈ ${(VOICE_COST + MODEL_COSTS[agent.config.model].llm).toFixed(3)}/min</span>
                        <span className="opacity-50">•</span>
                        <span>{MODEL_COSTS[agent.config.model].speed}</span>
                      </div>
                    )}
                  </div>
                  
                  {agent.systemPrompt && (
                    <p className="mt-3 text-xs text-muted-foreground line-clamp-2 border-t border-border/50 pt-3">
                      {agent.systemPrompt}
                    </p>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
        
        {/* Pagination */}
        <DataPagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={totalItems}
          itemsPerPage={itemsPerPage}
          onPageChange={handlePageChange}
          onItemsPerPageChange={handleItemsPerPageChange}
          itemsPerPageOptions={[9, 18, 27, 45]}
          data-testid="agents-pagination"
        />
        </div>
      )}

      <Dialog open={createDialogOpen || !!editingAgent} onOpenChange={(open) => {
        if (!open) {
          setCreateDialogOpen(false);
          setEditingAgent(null);
          resetForm();
        }
      }}>
        <DialogContent className={`max-w-2xl flex flex-col max-h-[85vh] p-0 gap-0 overflow-hidden ${animationState === 'error' ? 'animate-shake' : ''}`}>
          {/* Success Animation Overlay */}
          {animationState === 'success' && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/90 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-4 animate-in zoom-in-50 fade-in duration-300">
                <div className="h-20 w-20 rounded-full bg-gradient-to-br from-emerald-400 to-green-500 flex items-center justify-center shadow-lg shadow-emerald-500/30">
                  <CheckCircle2 className="h-10 w-10 text-white animate-in zoom-in-75 duration-300 delay-150" />
                </div>
                <div className="text-center">
                  <p className="text-lg font-semibold text-foreground">
                    {editingAgent ? t('agents.create.agentUpdated') : t('agents.create.agentCreated')}
                  </p>
                  <p className="text-sm text-muted-foreground">{t('agents.create.readyToUse')}</p>
                </div>
              </div>
            </div>
          )}
          
          {/* Fixed Header */}
          <DialogHeader className="px-6 pt-6 pb-4 border-b flex-shrink-0">
            <DialogTitle>{editingAgent ? t('agents.create.editTitle') : t('agents.create.title')}</DialogTitle>
            <DialogDescription>
              {t('agents.create.dialogDescription')}
            </DialogDescription>
          </DialogHeader>

          {/* Scrollable Form Content */}
          <div className="flex-1 overflow-y-auto px-6">
          <div className="space-y-4 py-4">
            {/* Agent Type Selector */}
            <div className="space-y-3">
              <Label className="text-base font-semibold">{t('agents.create.typeRequired')} <span className="text-destructive">*</span></Label>
              <div className="grid grid-cols-2 gap-4">
                <div 
                  className={`relative p-4 rounded-xl cursor-pointer transition-all duration-200 ${
                    formData.type === 'incoming' 
                      ? 'bg-gradient-to-br from-emerald-500/20 via-emerald-400/10 to-brand/20 dark:from-emerald-500/30 dark:via-emerald-400/15 dark:to-brand/25 border-2 border-emerald-500/50 shadow-lg shadow-emerald-500/10' 
                      : 'bg-muted/30 hover:bg-muted/50 border-2 border-transparent hover:border-border'
                  }`}
                  onClick={() => setFormData({ ...formData, type: 'incoming' })}
                  data-testid="card-type-incoming"
                >
                  <div className="flex items-start gap-3">
                    <div className={`h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${
                      formData.type === 'incoming' 
                        ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' 
                        : 'bg-muted text-muted-foreground'
                    }`}>
                      <Sparkles className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className={`font-semibold ${formData.type === 'incoming' ? 'text-emerald-700 dark:text-emerald-300' : ''}`}>{t('agents.create.incomingAgent')}</h4>
                        {formData.type === 'incoming' && (
                          <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {t('agents.create.incomingDescription')}
                      </p>
                    </div>
                  </div>
                </div>

                <div 
                  className={`relative p-4 rounded-xl cursor-pointer transition-all duration-200 ${
                    formData.type === 'flow' 
                      ? 'bg-gradient-to-br from-violet-500/20 via-purple-400/10 to-indigo-500/20 dark:from-violet-500/30 dark:via-purple-400/15 dark:to-indigo-500/25 border-2 border-violet-500/50 shadow-lg shadow-violet-500/10' 
                      : 'bg-muted/30 hover:bg-muted/50 border-2 border-transparent hover:border-border'
                  }`}
                  onClick={() => setFormData({ ...formData, type: 'flow' })}
                  data-testid="card-type-flow"
                >
                  <div className="flex items-start gap-3">
                    <div className={`h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${
                      formData.type === 'flow' 
                        ? 'bg-violet-500/20 text-violet-600 dark:text-violet-400' 
                        : 'bg-muted text-muted-foreground'
                    }`}>
                      <GitBranch className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className={`font-semibold ${formData.type === 'flow' ? 'text-violet-700 dark:text-violet-300' : ''}`}>{t('agents.create.flowAgent')}</h4>
                        {formData.type === 'flow' && (
                          <div className="h-2 w-2 rounded-full bg-violet-500 animate-pulse" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {t('agents.create.flowDescription')}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Agent Name - Common for both types */}
            <div className="space-y-2">
              <Label htmlFor="agent-name">
                {t('agents.create.nameRequired')} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="agent-name"
                placeholder={formData.type === 'incoming' ? t('agents.create.incomingPlaceholder') : t('agents.create.flowPlaceholder')}
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                data-testid="input-agent-name"
              />
            </div>

            {/* Incoming Agent Specific Fields - Voice & Personality */}
            {formData.type === 'incoming' && (
              <>
                {/* Voice & Personality Section Header */}
                <div className="flex items-center gap-2 pt-2">
                  <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                    <Mic className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <Label className="text-sm font-semibold text-blue-700 dark:text-blue-300">{t('agents.create.voicePersonality')}</Label>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center">
                      <Label htmlFor="voice-tone">{t('agents.create.voiceTone')}</Label>
                      <InfoTooltip content={t('agents.create.voiceToneTooltip')} />
                    </div>
                    <Select
                      value={formData.voiceTone}
                      onValueChange={(value) => setFormData({ ...formData, voiceTone: value })}
                    >
                      <SelectTrigger id="voice-tone" data-testid="select-voice-tone">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="professional">{t('agents.voiceTones.professional')}</SelectItem>
                        <SelectItem value="friendly">{t('agents.voiceTones.friendly')}</SelectItem>
                        <SelectItem value="casual">{t('agents.voiceTones.casual')}</SelectItem>
                        <SelectItem value="formal">{t('agents.voiceTones.formal')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center">
                      <Label htmlFor="personality">{t('agents.create.personality')}</Label>
                      <InfoTooltip content={t('agents.create.personalityTooltip')} />
                    </div>
                    <Select
                      value={formData.personality}
                      onValueChange={(value) => setFormData({ ...formData, personality: value })}
                    >
                      <SelectTrigger id="personality" data-testid="select-personality">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="helpful">{t('agents.personalities.helpful')}</SelectItem>
                        <SelectItem value="enthusiastic">{t('agents.personalities.enthusiastic')}</SelectItem>
                        <SelectItem value="empathetic">{t('agents.personalities.empathetic')}</SelectItem>
                        <SelectItem value="direct">{t('agents.personalities.direct')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            )}

            {/* Flow Agent Specific Fields */}
            {formData.type === 'flow' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center">
                    <Label htmlFor="flow-select">
                      {t('agents.create.conversationFlowRequired')} <span className="text-destructive">*</span>
                    </Label>
                    <InfoTooltip content={t('agents.create.conversationFlowTooltip')} />
                  </div>
                  <Select
                    value={formData.flowId}
                    onValueChange={(value) => setFormData({ ...formData, flowId: value })}
                  >
                    <SelectTrigger id="flow-select" data-testid="select-flow">
                      <SelectValue placeholder={t('agents.create.selectFlow')} />
                    </SelectTrigger>
                    <SelectContent>
                      {flows.length === 0 ? (
                        <SelectItem value="no-flows-available" disabled>{t('agents.create.noFlowsAvailable')}</SelectItem>
                      ) : (
                        flows.map((flow) => (
                          <SelectItem key={flow.id} value={flow.id}>
                            {flow.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  {flows.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      {t('agents.create.createFlowFirst')}
                    </p>
                  )}
                </div>

                {/* Max Conversation Duration */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <Label>{t('agents.create.maxConversationDuration')}</Label>
                      <InfoTooltip content={t('agents.create.maxDurationTooltip')} />
                    </div>
                    <span className="text-sm text-muted-foreground">{Math.round(formData.maxDurationSeconds / 60)} min</span>
                  </div>
                  <Slider
                    min={60}
                    max={1800}
                    step={60}
                    value={[formData.maxDurationSeconds]}
                    onValueChange={(value) => setFormData({ ...formData, maxDurationSeconds: value[0] })}
                    data-testid="slider-max-duration"
                  />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>1 min</span>
                    <span>30 min</span>
                  </div>
                </div>

                {/* Voice Settings for Flow Agents - Only show for ElevenLabs-based engines */}
                {formData.telephonyProvider !== "plivo" && formData.telephonyProvider !== "twilio_openai" && formData.telephonyProvider !== "openai-sip" && (
                  <div className="space-y-3 border-t pt-4">
                    <Label className="text-base">{t('agents.create.voiceFineTuning')}</Label>
                    
                    {isV3TtsModel ? (
                      <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg" data-testid="info-v3-voice-settings-natural">
                        <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                        <p className="text-xs text-muted-foreground">
                          {t('agents.create.v3VoiceNote', 'V3 Conversational model automatically optimizes voice quality. Use Expressive Mode and audio tags to control how the agent sounds.')}
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center">
                              <Label>{t('agents.create.stability')}</Label>
                              <InfoTooltip content={t('agents.create.stabilityTooltip')} />
                            </div>
                            <span className="text-sm text-muted-foreground">{Math.round(formData.voiceStability * 100)}%</span>
                          </div>
                          <Slider
                            min={0}
                            max={1}
                            step={0.05}
                            value={[formData.voiceStability]}
                            onValueChange={(value) => setFormData({ ...formData, voiceStability: value[0] })}
                            data-testid="slider-voice-stability"
                          />
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center">
                              <Label>{t('agents.create.similarityBoost')}</Label>
                              <InfoTooltip content={t('agents.create.similarityBoostTooltip')} />
                            </div>
                            <span className="text-sm text-muted-foreground">{Math.round(formData.voiceSimilarityBoost * 100)}%</span>
                          </div>
                          <Slider
                            min={0}
                            max={1}
                            step={0.05}
                            value={[formData.voiceSimilarityBoost]}
                            onValueChange={(value) => setFormData({ ...formData, voiceSimilarityBoost: value[0] })}
                            data-testid="slider-voice-similarity"
                          />
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center">
                              <Label>{t('agents.create.speechSpeed')}</Label>
                              <InfoTooltip content={t('agents.create.speechSpeedTooltip')} />
                            </div>
                            <span className="text-sm text-muted-foreground">{formData.voiceSpeed.toFixed(2)}x</span>
                          </div>
                          <Slider
                            min={0.7}
                            max={1.2}
                            step={0.05}
                            value={[formData.voiceSpeed]}
                            onValueChange={(value) => setFormData({ ...formData, voiceSpeed: value[0] })}
                            data-testid="slider-voice-speed"
                          />
                        </div>
                      </>
                    )}

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center">
                          <Label>{t('agents.create.responseDelay', 'Response Delay')}</Label>
                          <InfoTooltip content={t('agents.create.responseDelayTooltip', 'How long the agent waits after the caller stops speaking before responding. Lower values make the agent respond faster, higher values give more natural pauses.')} />
                        </div>
                        <span className="text-sm text-muted-foreground">{formData.turnTimeout.toFixed(1)}s</span>
                      </div>
                      <Slider
                        min={0.5}
                        max={5.0}
                        step={0.1}
                        value={[formData.turnTimeout]}
                        onValueChange={(value) => setFormData({ ...formData, turnTimeout: value[0] })}
                        data-testid="slider-natural-turn-timeout"
                      />
                    </div>

                    <div className="border-t pt-3 mt-3">
                      <label className="flex items-center gap-3 cursor-pointer" data-testid="label-flow-expressive-mode">
                        <Checkbox
                          checked={formData.expressiveMode}
                          onCheckedChange={(checked) => setFormData({ ...formData, expressiveMode: checked as boolean })}
                          data-testid="checkbox-flow-expressive-mode"
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium">{t('agents.create.expressiveMode')}</span>
                            <Badge variant="secondary" className="text-[10px] no-default-hover-elevate no-default-active-elevate">
                              <Sparkles className="h-2.5 w-2.5 mr-0.5" />
                              {t('common.new', 'New')}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">{t('agents.create.expressiveModeDesc')}</p>
                        </div>
                      </label>
                    </div>
                  </div>
                )}

                {/* System Tools Section for Flow Agents - Only show for ElevenLabs-based engines */}
                {formData.telephonyProvider !== "plivo" && formData.telephonyProvider !== "twilio_openai" && formData.telephonyProvider !== "openai-sip" && (
                  <div className="space-y-4 border-t pt-4">
                    <div className="flex items-center">
                      <Label className="text-base">{t('agents.create.systemTools')}</Label>
                      <InfoTooltip content={t('agents.create.systemToolsTooltip')} />
                    </div>
                    
                    {/* Language Detection Toggle */}
                    <label className="flex items-center gap-3 cursor-pointer" data-testid="label-flow-enable-language-detection">
                      <Checkbox
                        checked={formData.detectLanguageEnabled}
                        onCheckedChange={(checked) => setFormData({ ...formData, detectLanguageEnabled: checked as boolean })}
                        data-testid="checkbox-flow-enable-language-detection"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-1">
                          <span className="text-sm font-medium">{t('agents.create.enableLanguageDetection')}</span>
                          <InfoTooltip content={t('agents.create.languageDetectionTooltip')} />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {t('agents.create.languageDetectionDescription')}
                        </p>
                      </div>
                    </label>
                  </div>
                )}

                {/* Telephony Provider Selection for Flow Agents */}
                {(hasAlternateEngines || formData.telephonyProvider === "plivo" || formData.telephonyProvider === "twilio_openai") && (
                  <div className="space-y-2 border-t pt-4">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                        <Settings2 className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                      </div>
                      <Label className="text-sm font-semibold text-amber-700 dark:text-amber-300">Voice Engine</Label>
                    </div>
                    <div className={`grid gap-3 ${isPlivoEnabled && isTwilioOpenaiEnabled ? 'grid-cols-3' : 'grid-cols-2'}`}>
                      {/* ElevenLabs + Twilio - Purple theme */}
                      <div
                        className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                          formData.telephonyProvider === "twilio"
                            ? "border-violet-500 bg-violet-500/10 dark:bg-violet-500/20"
                            : "border-border hover:border-violet-400/50 hover:bg-violet-500/5"
                        }`}
                        onClick={() => setFormData({ 
                          ...formData, 
                          telephonyProvider: "twilio",
                          llmModel: availableLLMModels.length > 0 ? availableLLMModels[0].modelId : "gpt-4o-mini"
                        })}
                        data-testid="flow-provider-twilio"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium text-violet-700 dark:text-violet-300">ElevenLabs + Twilio</span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Premium voice, 30+ languages
                            </p>
                          </div>
                          {formData.telephonyProvider === "twilio" && (
                            <Check className="h-4 w-4 text-violet-600" />
                          )}
                        </div>
                      </div>
                      {/* OpenAI + Twilio - Teal theme */}
                      {(isTwilioOpenaiEnabled || formData.telephonyProvider === "twilio_openai") && (
                        <div
                          className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                            formData.telephonyProvider === "twilio_openai"
                              ? "border-brand bg-brand/10 dark:bg-brand/20"
                              : "border-border hover:border-brand/50 hover:bg-brand/5"
                          }`}
                          onClick={() => setFormData({ 
                            ...formData, 
                            telephonyProvider: "twilio_openai",
                            llmModel: "gpt-realtime-1.5"
                          })}
                          data-testid="flow-provider-twilio-openai"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-medium text-brand">OpenAI + Twilio</span>
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                Real-time AI, international
                              </p>
                            </div>
                            {formData.telephonyProvider === "twilio_openai" && (
                              <Check className="h-4 w-4 text-brand" />
                            )}
                          </div>
                        </div>
                      )}
                      {/* OpenAI + Plivo - Green theme */}
                      {(isPlivoEnabled || formData.telephonyProvider === "plivo") && (
                        <div
                          className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                            formData.telephonyProvider === "plivo"
                              ? "border-emerald-500 bg-emerald-500/10 dark:bg-emerald-500/20"
                              : "border-border hover:border-emerald-400/50 hover:bg-emerald-500/5"
                          }`}
                          onClick={() => setFormData({ 
                            ...formData, 
                            telephonyProvider: "plivo",
                            llmModel: "gpt-realtime-1.5"
                          })}
                          data-testid="flow-provider-plivo"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-medium text-emerald-700 dark:text-emerald-300">OpenAI + Plivo</span>
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                Real-time AI, India numbers
                              </p>
                            </div>
                            {formData.telephonyProvider === "plivo" && (
                              <Check className="h-4 w-4 text-emerald-600" />
                            )}
                          </div>
                        </div>
                      )}
                      {/* ElevenLabs SIP - Orange theme */}
                      {(isElevenLabsSipAllowed || formData.telephonyProvider === "elevenlabs-sip") && (
                        <div
                          className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                            formData.telephonyProvider === "elevenlabs-sip"
                              ? "border-orange-500 bg-orange-500/10 dark:bg-orange-500/20"
                              : "border-border hover:border-orange-400/50 hover:bg-orange-500/5"
                          }`}
                          onClick={() => setFormData({ 
                            ...formData, 
                            telephonyProvider: "elevenlabs-sip",
                            llmModel: availableLLMModels.length > 0 ? availableLLMModels[0].modelId : "gpt-4o-mini"
                          })}
                          data-testid="flow-provider-elevenlabs-sip"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-medium text-orange-700 dark:text-orange-300">ElevenLabs SIP</span>
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-orange-300 text-orange-600 dark:border-orange-600 dark:text-orange-400">Plugin</Badge>
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                Your own SIP trunk
                              </p>
                            </div>
                            {formData.telephonyProvider === "elevenlabs-sip" && (
                              <Check className="h-4 w-4 text-orange-600" />
                            )}
                          </div>
                        </div>
                      )}
                      {/* OpenAI SIP - Pink theme */}
                      {(isOpenAISipAllowed || formData.telephonyProvider === "openai-sip") && (
                        <div
                          className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                            formData.telephonyProvider === "openai-sip"
                              ? "border-pink-500 bg-pink-500/10 dark:bg-pink-500/20"
                              : "border-border hover:border-pink-400/50 hover:bg-pink-500/5"
                          }`}
                          onClick={() => setFormData({ 
                            ...formData, 
                            telephonyProvider: "openai-sip",
                            llmModel: "gpt-realtime-1.5"
                          })}
                          data-testid="flow-provider-openai-sip"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-medium text-pink-700 dark:text-pink-300">OpenAI SIP</span>
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-pink-300 text-pink-600 dark:border-pink-600 dark:text-pink-400">Plugin</Badge>
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                Your own SIP trunk
                              </p>
                            </div>
                            {formData.telephonyProvider === "openai-sip" && (
                              <Check className="h-4 w-4 text-pink-600" />
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Note: SIP Phone Number selection is done at campaign level, not agent level */}

                {/* Voice Selection for Flow Agents */}
                <div className="space-y-2">
                  <div className="flex items-center">
                    <Label htmlFor="flow-voice">
                      Voice <span className="text-destructive">*</span>
                    </Label>
                    <InfoTooltip content={t('agents.create.voiceTooltip')} />
                  </div>
                  {(formData.telephonyProvider === "plivo" || formData.telephonyProvider === "twilio_openai" || formData.telephonyProvider === "openai-sip") ? (
                    <Select
                      value={formData.openaiVoice}
                      onValueChange={(value) => setFormData({ ...formData, openaiVoice: value })}
                    >
                      <SelectTrigger id="flow-voice" data-testid="select-flow-openai-voice">
                        <SelectValue placeholder="Select OpenAI voice" />
                      </SelectTrigger>
                      <SelectContent>
                        {openaiVoices.map((voice) => (
                          <SelectItem key={voice.value} value={voice.value}>
                            <div className="flex flex-col">
                              <span>{voice.label}</span>
                              <span className="text-xs text-muted-foreground">{voice.description}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <VoiceSearchPicker
                          value={formData.elevenLabsVoiceId}
                          onChange={(voiceId) => setFormData({ ...formData, elevenLabsVoiceId: voiceId })}
                          placeholder={t('agents.create.selectVoicePlaceholder')}
                        />
                      </div>
                      <VoicePreviewButton 
                        voiceId={formData.elevenLabsVoiceId}
                        voiceSettings={{
                          stability: formData.voiceStability ?? 0.5,
                          similarity_boost: formData.voiceSimilarityBoost ?? 0.75,
                          speed: formData.voiceSpeed ?? 1.0,
                        }}
                        onSettingsChange={(settings) => {
                          setFormData({
                            ...formData,
                            voiceStability: settings.stability,
                            voiceSimilarityBoost: settings.similarity_boost,
                            voiceSpeed: settings.speed,
                          });
                        }}
                        previewText={formData.firstMessage || undefined}
                        language={formData.language || undefined}
                        compact
                      />
                    </div>
                  )}
                </div>

                {/* Flow Agent Configuration Section */}
                <div className="space-y-4 border-t pt-4">
                  <Label className="text-base">{t('agents.create.agentConfiguration')}</Label>
                  
                  {/* LLM Model for Flow Agents - Show OpenAI models for OpenAI-based engines */}
                  <div className="space-y-2">
                    <div className="flex items-center">
                      <Label htmlFor="flow-model">
                        {(formData.telephonyProvider === "plivo" || formData.telephonyProvider === "twilio_openai" || formData.telephonyProvider === "openai-sip") ? "OpenAI Model" : t('agents.create.llmModelRequired')} <span className="text-destructive">*</span>
                      </Label>
                      <InfoTooltip content={(formData.telephonyProvider === "plivo" || formData.telephonyProvider === "twilio_openai" || formData.telephonyProvider === "openai-sip") ? "Select the OpenAI Realtime model for voice conversations" : t('agents.create.llmModelTooltip')} />
                    </div>
                    {(formData.telephonyProvider === "plivo" || formData.telephonyProvider === "twilio_openai" || formData.telephonyProvider === "openai-sip") ? (
                      <Select
                        value={formData.llmModel}
                        onValueChange={(value) => setFormData({ ...formData, llmModel: value })}
                      >
                        <SelectTrigger id="flow-model" data-testid="select-flow-model">
                          <SelectValue placeholder={openaiRealtimeModels.length === 0 ? "Loading models..." : "Select OpenAI model"} />
                        </SelectTrigger>
                        <SelectContent>
                          {openaiRealtimeModels.length === 0 ? (
                            <SelectItem value="gpt-realtime-1.5">
                              GPT Realtime 1.5 (Default)
                            </SelectItem>
                          ) : (
                            openaiRealtimeModels.map((model) => (
                              <SelectItem key={model.id} value={model.modelId}>
                                <div className="flex items-center gap-2">
                                  <span>{model.name}</span>
                                  {model.tier === 'free' ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                                      <Check className="h-3 w-3" />
                                      {t('agents.create.free')}
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gradient-to-r from-violet-500/20 to-purple-500/20 text-violet-700 dark:text-violet-300 border border-violet-300/50 dark:border-violet-500/30">
                                      <Sparkles className="h-3 w-3" />
                                      {t('agents.create.pro')}
                                    </span>
                                  )}
                                </div>
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Select
                        value={formData.llmModel}
                        onValueChange={(value) => setFormData({ ...formData, llmModel: value })}
                      >
                        <SelectTrigger id="flow-model" data-testid="select-flow-model">
                          <SelectValue placeholder={availableLLMModels.length === 0 ? t('agents.create.noModelsAvailable') : t('agents.create.selectAModel')} />
                        </SelectTrigger>
                        <SelectContent>
                          {availableLLMModels.length === 0 ? (
                            <SelectItem value="no-models" disabled>
                              {t('agents.create.noModelsAvailable')}
                            </SelectItem>
                          ) : (
                            availableLLMModels.map((model) => (
                              <SelectItem key={model.id} value={model.modelId}>
                                <div className="flex items-center gap-2">
                                  <span>{model.name}</span>
                                  {model.tier === 'free' ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                                      <Check className="h-3 w-3" />
                                      {t('agents.create.free')}
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gradient-to-r from-violet-500/20 to-purple-500/20 text-violet-700 dark:text-violet-300 border border-violet-300/50 dark:border-violet-500/30">
                                      <Sparkles className="h-3 w-3" />
                                      {t('agents.create.pro')}
                                    </span>
                                  )}
                                </div>
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {(formData.telephonyProvider === "plivo" || formData.telephonyProvider === "twilio_openai" || formData.telephonyProvider === "openai-sip") ? "OpenAI Realtime models for low-latency voice AI" : t('agents.create.chooseModelFlow')}
                    </p>
                  </div>

                  {/* Temperature for Flow Agents - Extended range for OpenAI */}
                  <div className="space-y-2">
                    <div className="flex items-center">
                      <Label>{t('agents.create.temperature')}</Label>
                      <InfoTooltip content={(formData.telephonyProvider === "plivo" || formData.telephonyProvider === "twilio_openai" || formData.telephonyProvider === "openai-sip") ? "OpenAI temperature (0-2): Higher values make output more random" : t('agents.create.temperatureTooltip')} />
                    </div>
                    <div className="space-y-4">
                      <Slider
                        min={0}
                        max={(formData.telephonyProvider === "plivo" || formData.telephonyProvider === "twilio_openai" || formData.telephonyProvider === "openai-sip") ? 2 : 1}
                        step={0.1}
                        value={[formData.temperature]}
                        onValueChange={(value) => setFormData({ ...formData, temperature: value[0] })}
                        data-testid="slider-flow-temperature"
                      />
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{t('agents.create.current')}: {formData.temperature.toFixed(1)}</span>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant={formData.temperature === 0.0 ? "default" : "outline"}
                            size="sm"
                            onClick={() => setFormData({ ...formData, temperature: 0.0 })}
                            data-testid="button-flow-temp-deterministic"
                          >
                            {t('agents.create.deterministic')}
                          </Button>
                          <Button
                            type="button"
                            variant={formData.temperature === 0.5 ? "default" : "outline"}
                            size="sm"
                            onClick={() => setFormData({ ...formData, temperature: 0.5 })}
                            data-testid="button-flow-temp-creative"
                          >
                            {t('agents.create.creative')}
                          </Button>
                          <Button
                            type="button"
                            variant={formData.temperature === 1.0 ? "default" : "outline"}
                            size="sm"
                            onClick={() => setFormData({ ...formData, temperature: 1.0 })}
                            data-testid="button-flow-temp-more-creative"
                          >
                            {t('agents.create.moreCreative')}
                          </Button>
                          {(formData.telephonyProvider === "plivo" || formData.telephonyProvider === "twilio_openai" || formData.telephonyProvider === "openai-sip") && (
                            <Button
                              type="button"
                              variant={formData.temperature === 2.0 ? "default" : "outline"}
                              size="sm"
                              onClick={() => setFormData({ ...formData, temperature: 2.0 })}
                              data-testid="button-flow-temp-very-creative"
                            >
                              Very Creative
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* System Prompt */}
                  <div className="space-y-2">
                    <div className="flex items-center">
                      <Label htmlFor="flow-system-prompt">{t('agents.create.systemPrompt')}</Label>
                      <InfoTooltip content={t('agents.create.systemPromptTooltip')} />
                    </div>
                    <Textarea
                      id="flow-system-prompt"
                      placeholder={t('agents.create.systemPromptPlaceholderFlow')}
                      value={formData.systemPrompt}
                      onChange={(e) => setFormData({ ...formData, systemPrompt: e.target.value })}
                      rows={4}
                      data-testid="input-flow-system-prompt"
                    />
                    <p className="text-xs text-muted-foreground">
                      {t('agents.create.systemPromptHint')}
                    </p>
                  </div>

                  {/* First Message */}
                  <div className="space-y-2">
                    <div className="flex items-center">
                      <Label htmlFor="flow-first-message">{t('agents.create.firstMessage')}</Label>
                      <InfoTooltip content={t('agents.create.firstMessageTooltip')} />
                    </div>
                    <Textarea
                      id="flow-first-message"
                      placeholder={t('agents.create.firstMessagePlaceholderFlow')}
                      value={formData.firstMessage}
                      onChange={(e) => setFormData({ ...formData, firstMessage: e.target.value })}
                      rows={2}
                      data-testid="input-flow-first-message"
                    />
                    <p className="text-xs text-muted-foreground">
                      {t('agents.create.firstMessageHint')}
                    </p>
                    
                    {/* Dynamic Variables Helper for Flow Agents */}
                    <div className="mt-3 p-3 bg-muted/50 rounded-md border border-muted">
                      <p className="text-xs font-medium text-foreground mb-2">{t('agents.create.dynamicVariablesTitle')}</p>
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {['{{first_name}}', '{{last_name}}', '{{contact_name}}', '{{email}}', '{{phone}}', '{{city}}', '{{company}}'].map((variable) => (
                          <Badge 
                            key={variable} 
                            variant="secondary" 
                            className="text-xs font-mono cursor-pointer hover-elevate"
                            onClick={() => {
                              const textarea = document.getElementById('flow-first-message') as HTMLTextAreaElement;
                              if (textarea) {
                                const start = textarea.selectionStart;
                                const end = textarea.selectionEnd;
                                const newValue = formData.firstMessage.substring(0, start) + variable + formData.firstMessage.substring(end);
                                setFormData({ ...formData, firstMessage: newValue });
                              }
                            }}
                            data-testid={`badge-flow-variable-${variable.replace(/[{}]/g, '')}`}
                          >
                            {variable}
                          </Badge>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">{t('agents.create.dynamicVariablesFromCSV')}</p>
                    </div>
                  </div>

                  {/* Knowledge Base */}
                  <div className="space-y-2">
                    <div className="flex items-center">
                      <Label>{t('agents.create.knowledgeBase')}</Label>
                      <InfoTooltip content={t('agents.create.knowledgeBaseTooltip')} />
                    </div>
                    <div className="border rounded-md p-4 max-h-48 overflow-y-auto space-y-2">
                      {knowledgeBase.length === 0 ? (
                        <p className="text-sm text-muted-foreground" data-testid="text-flow-no-knowledge-base">{t('agents.create.noKnowledgeItems')}</p>
                      ) : (
                        knowledgeBase.map((kb) => (
                          <label
                            key={kb.id}
                            className="flex items-center gap-2 cursor-pointer hover-elevate rounded-md p-2"
                            data-testid={`label-flow-kb-${kb.id}`}
                          >
                            <Checkbox
                              checked={formData.knowledgeBaseIds.includes(kb.id)}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setFormData({
                                    ...formData,
                                    knowledgeBaseIds: [...formData.knowledgeBaseIds, kb.id],
                                  });
                                } else {
                                  setFormData({
                                    ...formData,
                                    knowledgeBaseIds: formData.knowledgeBaseIds.filter((id) => id !== kb.id),
                                  });
                                }
                              }}
                              data-testid={`checkbox-flow-kb-${kb.id}`}
                            />
                            <span className="text-sm">{kb.title}</span>
                          </label>
                        ))
                      )}
                    </div>
                    {knowledgeBase.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        {t('agents.create.addKnowledgeHint')}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Voice & Language Section - Common for both types */}
            <div className="flex items-center gap-2 pt-2">
              <div className="h-8 w-8 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                <Mic className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
              </div>
              <Label className="text-sm font-semibold text-cyan-700 dark:text-cyan-300">{t('agents.create.voiceLanguage')}</Label>
            </div>

            {/* Telephony Provider Selection - Show only for INCOMING agents if alternate engines are enabled */}
            {formData.type === 'incoming' && (hasAlternateEngines || formData.telephonyProvider === "plivo" || formData.telephonyProvider === "twilio_openai") && (
              <div className="space-y-2">
                <Label>Telephony Provider</Label>
                <div className={`grid gap-3 ${isPlivoEnabled && isTwilioOpenaiEnabled ? 'grid-cols-3' : 'grid-cols-2'}`}>
                  {/* ElevenLabs + Twilio - Purple theme */}
                  <div
                    className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                      formData.telephonyProvider === "twilio"
                        ? "border-violet-500 bg-violet-500/10 dark:bg-violet-500/20"
                        : "border-border hover:border-violet-400/50 hover:bg-violet-500/5"
                    }`}
                    onClick={() => setFormData({ 
                      ...formData, 
                      telephonyProvider: "twilio",
                      llmModel: availableLLMModels.length > 0 ? availableLLMModels[0].modelId : "gpt-4o-mini"
                    })}
                    data-testid="provider-twilio"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-violet-700 dark:text-violet-300">ElevenLabs + Twilio</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Premium voice quality, 30+ languages
                        </p>
                      </div>
                      {formData.telephonyProvider === "twilio" && (
                        <Check className="h-4 w-4 text-violet-600" />
                      )}
                    </div>
                  </div>
                  {/* OpenAI + Twilio - Teal theme */}
                  {(isTwilioOpenaiEnabled || formData.telephonyProvider === "twilio_openai") && (
                    <div
                      className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                        formData.telephonyProvider === "twilio_openai"
                          ? "border-brand bg-brand/10 dark:bg-brand/20"
                          : "border-border hover:border-brand/50 hover:bg-brand/5"
                      }`}
                      onClick={() => setFormData({ 
                        ...formData, 
                        telephonyProvider: "twilio_openai",
                        llmModel: "gpt-realtime-1.5"
                      })}
                      data-testid="provider-twilio-openai"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-brand">OpenAI + Twilio</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Real-time AI, international
                          </p>
                        </div>
                        {formData.telephonyProvider === "twilio_openai" && (
                          <Check className="h-4 w-4 text-brand" />
                        )}
                      </div>
                    </div>
                  )}
                  {/* OpenAI + Plivo - Green theme */}
                  {(isPlivoEnabled || formData.telephonyProvider === "plivo") && (
                    <div
                      className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                        formData.telephonyProvider === "plivo"
                          ? "border-emerald-500 bg-emerald-500/10 dark:bg-emerald-500/20"
                          : "border-border hover:border-emerald-400/50 hover:bg-emerald-500/5"
                      }`}
                      onClick={() => setFormData({ 
                        ...formData, 
                        telephonyProvider: "plivo",
                        llmModel: "gpt-realtime-1.5"
                      })}
                      data-testid="provider-plivo"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-emerald-700 dark:text-emerald-300">OpenAI + Plivo</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Real-time AI, India numbers
                          </p>
                        </div>
                        {formData.telephonyProvider === "plivo" && (
                          <Check className="h-4 w-4 text-emerald-600" />
                        )}
                      </div>
                    </div>
                  )}
                  {/* ElevenLabs SIP - Orange theme */}
                  {(isElevenLabsSipAllowed || formData.telephonyProvider === "elevenlabs-sip") && (
                    <div
                      className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                        formData.telephonyProvider === "elevenlabs-sip"
                          ? "border-orange-500 bg-orange-500/10 dark:bg-orange-500/20"
                          : "border-border hover:border-orange-400/50 hover:bg-orange-500/5"
                      }`}
                      onClick={() => setFormData({ 
                        ...formData, 
                        telephonyProvider: "elevenlabs-sip",
                        llmModel: availableLLMModels.length > 0 ? availableLLMModels[0].modelId : "gpt-4o-mini"
                      })}
                      data-testid="provider-elevenlabs-sip"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-orange-700 dark:text-orange-300">ElevenLabs SIP</span>
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-orange-300 text-orange-600 dark:border-orange-600 dark:text-orange-400">Plugin</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Your own SIP trunk
                          </p>
                        </div>
                        {formData.telephonyProvider === "elevenlabs-sip" && (
                          <Check className="h-4 w-4 text-orange-600" />
                        )}
                      </div>
                    </div>
                  )}
                  {/* OpenAI SIP - Pink theme */}
                  {(isOpenAISipAllowed || formData.telephonyProvider === "openai-sip") && (
                    <div
                      className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                        formData.telephonyProvider === "openai-sip"
                          ? "border-pink-500 bg-pink-500/10 dark:bg-pink-500/20"
                          : "border-border hover:border-pink-400/50 hover:bg-pink-500/5"
                      }`}
                      onClick={() => setFormData({ 
                        ...formData, 
                        telephonyProvider: "openai-sip",
                        llmModel: "gpt-realtime-1.5"
                      })}
                      data-testid="provider-openai-sip"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-pink-700 dark:text-pink-300">OpenAI SIP</span>
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-pink-300 text-pink-600 dark:border-pink-600 dark:text-pink-400">Plugin</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Your own SIP trunk
                          </p>
                        </div>
                        {formData.telephonyProvider === "openai-sip" && (
                          <Check className="h-4 w-4 text-pink-600" />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Note: SIP Phone Number selection is done at campaign level, not agent level */}

            <div className="grid grid-cols-2 gap-4 overflow-visible">
              <div className="space-y-2 relative z-20">
                <div className="flex items-center">
                  <Label htmlFor="voice">
                    {t('agents.create.voiceRequired')} <span className="text-destructive">*</span>
                  </Label>
                  <InfoTooltip content={t('agents.create.voiceTooltip')} />
                </div>
                {(formData.telephonyProvider === "plivo" || formData.telephonyProvider === "twilio_openai" || formData.telephonyProvider === "openai-sip") ? (
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <Select
                        value={formData.openaiVoice}
                        onValueChange={(value) => setFormData({ ...formData, openaiVoice: value })}
                      >
                        <SelectTrigger data-testid="select-openai-voice">
                          <SelectValue placeholder="Select OpenAI voice" />
                        </SelectTrigger>
                        <SelectContent>
                          {openaiVoices.map((voice) => (
                            <SelectItem key={voice.value} value={voice.value}>
                              <div className="flex flex-col">
                                <span>{voice.label}</span>
                                <span className="text-xs text-muted-foreground">{voice.description}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <OpenAIVoicePreviewButton
                      voiceId={formData.openaiVoice}
                      voiceName={openaiVoices.find(v => v.value === formData.openaiVoice)?.label}
                      speed={formData.voiceSpeed ?? 1.0}
                    />
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <VoiceSearchPicker
                        value={formData.elevenLabsVoiceId}
                        onChange={(voiceId) => setFormData({ ...formData, elevenLabsVoiceId: voiceId })}
                        placeholder={t('agents.create.selectVoicePlaceholder')}
                      />
                    </div>
                    <VoicePreviewButton 
                      voiceId={formData.elevenLabsVoiceId}
                      voiceSettings={{
                        stability: formData.voiceStability ?? 0.5,
                        similarity_boost: formData.voiceSimilarityBoost ?? 0.75,
                        speed: formData.voiceSpeed ?? 1.0,
                      }}
                      onSettingsChange={(settings) => {
                        setFormData({
                          ...formData,
                          voiceStability: settings.stability,
                          voiceSimilarityBoost: settings.similarity_boost,
                          voiceSpeed: settings.speed,
                        });
                      }}
                      previewText={formData.firstMessage || undefined}
                      language={formData.language || undefined}
                      compact
                    />
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center">
                  <Label htmlFor="language">
                    {t('agents.create.languageRequired')} <span className="text-destructive">*</span>
                  </Label>
                  <InfoTooltip content={t('agents.create.languageTooltip')} />
                </div>
                <Select
                  value={formData.language}
                  onValueChange={(value) => setFormData({ ...formData, language: value })}
                >
                  <SelectTrigger id="language" data-testid="select-language">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_LANGUAGES
                      .filter((lang) => {
                        const isElevenLabs = formData.telephonyProvider === "twilio" || formData.telephonyProvider === "elevenlabs-sip";
                        const providerType = isElevenLabs ? "elevenlabs" : "openai";
                        return isProviderSupported(lang.value, providerType);
                      })
                      .map((lang) => (
                        <SelectItem 
                          key={lang.value} 
                          value={lang.value}
                        >
                          <LanguageOptionLabel 
                            label={t(`agents.languages.${lang.value}`, { defaultValue: lang.label })} 
                            providers={lang.providers} 
                            compact 
                          />
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Incoming Agent LLM and Prompt Configuration */}
            {formData.type === 'incoming' && (
              <>
                {/* AI Model Section Header */}
                <div className="flex items-center gap-2 pt-2">
                  <div className="h-8 w-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                    <Brain className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <Label className="text-sm font-semibold text-amber-700 dark:text-amber-300">{t('agents.create.aiModelBehavior')}</Label>
                </div>

                {/* LLM Model for Incoming Agents - Show OpenAI models for OpenAI-based engines */}
                <div className="space-y-2">
                  <div className="flex items-center">
                    <Label htmlFor="model">
                      {(formData.telephonyProvider === "plivo" || formData.telephonyProvider === "twilio_openai" || formData.telephonyProvider === "openai-sip") ? "OpenAI Model" : t('agents.create.llmModelRequired')} <span className="text-destructive">*</span>
                    </Label>
                    <InfoTooltip content={(formData.telephonyProvider === "plivo" || formData.telephonyProvider === "twilio_openai" || formData.telephonyProvider === "openai-sip") ? "Select the OpenAI Realtime model for voice conversations" : t('agents.create.llmModelTooltip')} />
                  </div>
                  {(formData.telephonyProvider === "plivo" || formData.telephonyProvider === "twilio_openai" || formData.telephonyProvider === "openai-sip") ? (
                    <Select
                      value={formData.llmModel}
                      onValueChange={(value) => setFormData({ ...formData, llmModel: value })}
                    >
                      <SelectTrigger id="model" data-testid="select-model">
                        <SelectValue placeholder={openaiRealtimeModels.length === 0 ? "Loading models..." : "Select OpenAI model"} />
                      </SelectTrigger>
                      <SelectContent>
                        {openaiRealtimeModels.length === 0 ? (
                          <SelectItem value="gpt-realtime-1.5">
                            GPT Realtime 1.5 (Default)
                          </SelectItem>
                        ) : (
                          openaiRealtimeModels.map((model) => (
                            <SelectItem key={model.id} value={model.modelId}>
                              <div className="flex items-center gap-2">
                                <span>{model.name}</span>
                                {model.tier === 'free' ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                                    <Check className="h-3 w-3" />
                                    {t('agents.create.free')}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gradient-to-r from-violet-500/20 to-purple-500/20 text-violet-700 dark:text-violet-300 border border-violet-300/50 dark:border-violet-500/30">
                                    <Sparkles className="h-3 w-3" />
                                    {t('agents.create.pro')}
                                  </span>
                                )}
                              </div>
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Select
                      value={formData.llmModel}
                      onValueChange={(value) => setFormData({ ...formData, llmModel: value })}
                    >
                      <SelectTrigger id="model" data-testid="select-model">
                        <SelectValue placeholder={availableLLMModels.length === 0 ? t('agents.create.noModelsAvailable') : t('agents.create.selectAModel')} />
                      </SelectTrigger>
                      <SelectContent>
                        {availableLLMModels.length === 0 ? (
                          <SelectItem value="no-models" disabled>
                            {t('agents.create.noModelsAvailable')}
                          </SelectItem>
                        ) : (
                          availableLLMModels.map((model) => (
                            <SelectItem key={model.id} value={model.modelId}>
                              <div className="flex items-center gap-2">
                                <span>{model.name}</span>
                                {model.tier === 'free' ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                                    <Check className="h-3 w-3" />
                                    {t('agents.create.free')}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gradient-to-r from-violet-500/20 to-purple-500/20 text-violet-700 dark:text-violet-300 border border-violet-300/50 dark:border-violet-500/30">
                                    <Sparkles className="h-3 w-3" />
                                    {t('agents.create.pro')}
                                  </span>
                                )}
                              </div>
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {(formData.telephonyProvider === "plivo" || formData.telephonyProvider === "twilio_openai" || formData.telephonyProvider === "openai-sip") ? "OpenAI Realtime models for low-latency voice AI" : t('agents.create.chooseModel')}
                  </p>
                </div>

                {/* Temperature for Incoming Agents - Extended range for OpenAI */}
                <div className="space-y-2">
                  <div className="flex items-center">
                    <Label>{t('agents.create.temperature')}</Label>
                    <InfoTooltip content={(formData.telephonyProvider === "plivo" || formData.telephonyProvider === "twilio_openai" || formData.telephonyProvider === "openai-sip") ? "OpenAI temperature (0-2): Higher values make output more random" : t('agents.create.temperatureTooltipFull')} />
                  </div>
                  <div className="space-y-4">
                    <Slider
                      min={0}
                      max={(formData.telephonyProvider === "plivo" || formData.telephonyProvider === "twilio_openai" || formData.telephonyProvider === "openai-sip") ? 2 : 1}
                      step={0.1}
                      value={[formData.temperature]}
                      onValueChange={(value) => setFormData({ ...formData, temperature: value[0] })}
                      data-testid="slider-temperature"
                    />
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{t('agents.create.current')}: {formData.temperature.toFixed(1)}</span>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant={formData.temperature === 0.0 ? "default" : "outline"}
                          size="sm"
                          onClick={() => setFormData({ ...formData, temperature: 0.0 })}
                          data-testid="button-temp-deterministic"
                        >
                          {t('agents.create.deterministic')}
                        </Button>
                        <Button
                          type="button"
                          variant={formData.temperature === 0.5 ? "default" : "outline"}
                          size="sm"
                          onClick={() => setFormData({ ...formData, temperature: 0.5 })}
                          data-testid="button-temp-creative"
                        >
                          {t('agents.create.creative')}
                        </Button>
                        <Button
                          type="button"
                          variant={formData.temperature === 1.0 ? "default" : "outline"}
                          size="sm"
                          onClick={() => setFormData({ ...formData, temperature: 1.0 })}
                          data-testid="button-temp-more-creative"
                        >
                          {t('agents.create.moreCreative')}
                        </Button>
                        {(formData.telephonyProvider === "plivo" || formData.telephonyProvider === "twilio_openai" || formData.telephonyProvider === "openai-sip") && (
                          <Button
                            type="button"
                            variant={formData.temperature === 2.0 ? "default" : "outline"}
                            size="sm"
                            onClick={() => setFormData({ ...formData, temperature: 2.0 })}
                            data-testid="button-temp-very-creative"
                          >
                            Very Creative
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

            {/* Voice Fine-Tuning Section for Incoming Agents - Only show for ElevenLabs-based engines */}
            {formData.telephonyProvider !== "plivo" && formData.telephonyProvider !== "twilio_openai" && formData.telephonyProvider !== "openai-sip" && (
              <div className="space-y-3 border-t pt-4">
                <Label className="text-base">{t('agents.create.voiceFineTuning')}</Label>
                
                {isV3TtsModel ? (
                  <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg" data-testid="info-v3-voice-settings-incoming">
                    <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                    <p className="text-xs text-muted-foreground">
                      {t('agents.create.v3VoiceNote', 'V3 Conversational model automatically optimizes voice quality. Use Expressive Mode and audio tags to control how the agent sounds.')}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center">
                          <Label>{t('agents.create.stability')}</Label>
                          <InfoTooltip content={t('agents.create.stabilityTooltip')} />
                        </div>
                        <span className="text-sm text-muted-foreground">{Math.round(formData.voiceStability * 100)}%</span>
                      </div>
                      <Slider
                        min={0}
                        max={1}
                        step={0.05}
                        value={[formData.voiceStability]}
                        onValueChange={(value) => setFormData({ ...formData, voiceStability: value[0] })}
                        data-testid="slider-incoming-voice-stability"
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center">
                          <Label>{t('agents.create.similarityBoost')}</Label>
                          <InfoTooltip content={t('agents.create.similarityBoostTooltip')} />
                        </div>
                        <span className="text-sm text-muted-foreground">{Math.round(formData.voiceSimilarityBoost * 100)}%</span>
                      </div>
                      <Slider
                        min={0}
                        max={1}
                        step={0.05}
                        value={[formData.voiceSimilarityBoost]}
                        onValueChange={(value) => setFormData({ ...formData, voiceSimilarityBoost: value[0] })}
                        data-testid="slider-incoming-voice-similarity"
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center">
                          <Label>{t('agents.create.speechSpeed')}</Label>
                          <InfoTooltip content={t('agents.create.speechSpeedTooltip')} />
                        </div>
                        <span className="text-sm text-muted-foreground">{formData.voiceSpeed.toFixed(2)}x</span>
                      </div>
                      <Slider
                        min={0.7}
                        max={1.2}
                        step={0.05}
                        value={[formData.voiceSpeed]}
                        onValueChange={(value) => setFormData({ ...formData, voiceSpeed: value[0] })}
                        data-testid="slider-incoming-voice-speed"
                      />
                    </div>
                  </>
                )}

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <Label>{t('agents.create.responseDelay', 'Response Delay')}</Label>
                      <InfoTooltip content={t('agents.create.responseDelayTooltip', 'How long the agent waits after the caller stops speaking before responding. Lower values make the agent respond faster, higher values give more natural pauses.')} />
                    </div>
                    <span className="text-sm text-muted-foreground">{formData.turnTimeout.toFixed(1)}s</span>
                  </div>
                  <Slider
                    min={0.5}
                    max={5.0}
                    step={0.1}
                    value={[formData.turnTimeout]}
                    onValueChange={(value) => setFormData({ ...formData, turnTimeout: value[0] })}
                    data-testid="slider-incoming-turn-timeout"
                  />
                </div>

                <div className="border-t pt-3 mt-3">
                  <label className="flex items-center gap-3 cursor-pointer" data-testid="label-incoming-expressive-mode">
                    <Checkbox
                      checked={formData.expressiveMode}
                      onCheckedChange={(checked) => setFormData({ ...formData, expressiveMode: checked as boolean })}
                      data-testid="checkbox-incoming-expressive-mode"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{t('agents.create.expressiveMode')}</span>
                        <Badge variant="secondary" className="text-[10px] no-default-hover-elevate no-default-active-elevate">
                          <Sparkles className="h-2.5 w-2.5 mr-0.5" />
                          {t('common.new', 'New')}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{t('agents.create.expressiveModeDesc')}</p>
                    </div>
                  </label>
                </div>
              </div>
            )}

            <PromptTemplatesLibrary
              mode="select"
              onSelectTemplate={(template) => {
                setFormData({ 
                  ...formData, 
                  systemPrompt: template.systemPrompt,
                  firstMessage: template.firstMessage || formData.firstMessage,
                  voiceTone: template.suggestedVoiceTone || formData.voiceTone,
                  personality: template.suggestedPersonality || formData.personality,
                });
              }}
            />

            <div className="space-y-2">
              <div className="flex items-center">
                <Label htmlFor="system-prompt">
                  {t('agents.create.systemPromptRequired')} <span className="text-destructive">*</span>
                </Label>
                <InfoTooltip content={t('agents.create.systemPromptTooltipFull')} />
              </div>
              <Textarea
                id="system-prompt"
                placeholder={t('agents.create.systemPromptPlaceholder')}
                value={formData.systemPrompt}
                onChange={(e) => setFormData({ ...formData, systemPrompt: e.target.value })}
                rows={8}
                data-testid="input-system-prompt"
              />
              <p className="text-xs text-muted-foreground">
                {t('agents.create.systemPromptTip')}
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center">
                <Label htmlFor="first-message">{t('agents.create.firstMessage')}</Label>
                <InfoTooltip content={t('agents.create.firstMessageTooltipFull')} />
              </div>
              <Textarea
                id="first-message"
                placeholder={t('agents.create.firstMessagePlaceholder')}
                value={formData.firstMessage}
                onChange={(e) => setFormData({ ...formData, firstMessage: e.target.value })}
                rows={2}
                data-testid="input-first-message"
              />
              <p className="text-xs text-muted-foreground">
                {t('agents.create.firstMessageTip')}
              </p>
              
              {/* Dynamic Variables Helper */}
              <div className="mt-3 p-3 bg-muted/50 rounded-md border border-muted">
                <p className="text-xs font-medium text-foreground mb-2">{t('agents.create.dynamicVariablesTitle')}</p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {['{{first_name}}', '{{last_name}}', '{{contact_name}}', '{{email}}', '{{phone}}', '{{city}}', '{{company}}'].map((variable) => (
                    <Badge 
                      key={variable} 
                      variant="secondary" 
                      className="text-xs font-mono cursor-pointer hover-elevate"
                      onClick={() => {
                        const textarea = document.getElementById('first-message') as HTMLTextAreaElement;
                        if (textarea) {
                          const start = textarea.selectionStart;
                          const end = textarea.selectionEnd;
                          const newValue = formData.firstMessage.substring(0, start) + variable + formData.firstMessage.substring(end);
                          setFormData({ ...formData, firstMessage: newValue });
                        }
                      }}
                      data-testid={`badge-variable-${variable.replace(/[{}]/g, '')}`}
                    >
                      {variable}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{t('agents.create.dynamicVariablesFromCSV')}</p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center">
                <Label>{t('agents.create.knowledgeBase')}</Label>
                <InfoTooltip content={t('agents.create.knowledgeBaseTooltipFull')} />
              </div>
              <div className="border rounded-md p-4 max-h-48 overflow-y-auto space-y-2">
                {knowledgeBase.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('agents.create.noKnowledgeItems')}</p>
                ) : (
                  knowledgeBase.map((kb) => (
                    <label
                      key={kb.id}
                      className="flex items-center gap-2 cursor-pointer hover-elevate rounded-md p-2"
                      data-testid={`label-kb-${kb.id}`}
                    >
                      <Checkbox
                        checked={formData.knowledgeBaseIds.includes(kb.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setFormData({
                              ...formData,
                              knowledgeBaseIds: [...formData.knowledgeBaseIds, kb.id],
                            });
                          } else {
                            setFormData({
                              ...formData,
                              knowledgeBaseIds: formData.knowledgeBaseIds.filter(id => id !== kb.id),
                            });
                          }
                        }}
                        data-testid={`checkbox-kb-${kb.id}`}
                      />
                      <span className="text-sm">{kb.title}</span>
                    </label>
                  ))
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {t('agents.create.selectKnowledgeHint')}
              </p>
            </div>

            {/* System Tools Section - Now for ALL Agent types (Incoming and Flow) */}
            {(formData.type === 'incoming' || formData.type === 'flow') && (
              <div className="space-y-4 pt-4">
                {/* System Tools Section Header */}
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-rose-500/10 flex items-center justify-center">
                    <Wrench className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                  </div>
                  <div className="flex items-center gap-1">
                    <Label className="text-sm font-semibold text-rose-700 dark:text-rose-300">{t('agents.create.systemTools')}</Label>
                    <InfoTooltip content={t('agents.systemTools.description')} />
                  </div>
                </div>
                
                {/* Call Transfer Toggle */}
                <div className="space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer" data-testid="label-enable-transfer">
                    <Checkbox
                      checked={formData.transferEnabled}
                      onCheckedChange={(checked) => setFormData({ ...formData, transferEnabled: checked as boolean })}
                      data-testid="checkbox-enable-transfer"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-1">
                        <span className="text-sm font-medium">{t('agents.systemTools.enableCallTransfer')}</span>
                        <InfoTooltip content={t('agents.systemTools.callTransferTooltip')} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t('agents.systemTools.callTransferDescription')}
                      </p>
                    </div>
                  </label>
                  
                  {formData.transferEnabled && (
                    <div className="ml-7 space-y-2">
                      <Label htmlFor="transfer-phone" className="text-sm font-normal">
                        {t('agents.systemTools.transferPhoneNumber')} <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="transfer-phone"
                        placeholder="+1234567890"
                        value={formData.transferPhoneNumber}
                        onChange={(e) => setFormData({ ...formData, transferPhoneNumber: e.target.value })}
                        data-testid="input-transfer-phone"
                      />
                      <p className="text-xs text-muted-foreground">
                        {t('agents.systemTools.transferPhoneHint')}
                      </p>
                    </div>
                  )}
                </div>

                {/* Language Detection Toggle - All engines support this */}
                <label className="flex items-center gap-3 cursor-pointer" data-testid="label-enable-language-detection">
                    <Checkbox
                      checked={formData.detectLanguageEnabled}
                      onCheckedChange={(checked) => setFormData({ ...formData, detectLanguageEnabled: checked as boolean })}
                      data-testid="checkbox-enable-language-detection"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-1">
                        <span className="text-sm font-medium">{t('agents.create.enableLanguageDetection')}</span>
                        <InfoTooltip content={t('agents.systemTools.languageDetectionTooltip')} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t('agents.systemTools.languageDetectionDescription')}
                      </p>
                    </div>
                </label>

                {/* End Conversation Toggle - All engines support this */}
                <label className="flex items-center gap-3 cursor-pointer" data-testid="label-enable-end-conversation">
                    <Checkbox
                      checked={formData.endConversationEnabled}
                      onCheckedChange={(checked) => setFormData({ ...formData, endConversationEnabled: checked as boolean })}
                      data-testid="checkbox-enable-end-conversation"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-1">
                        <span className="text-sm font-medium">{t('agents.systemTools.enableEndConversation')}</span>
                        <InfoTooltip content={t('agents.systemTools.endConversationTooltip')} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t('agents.systemTools.endConversationDescription')}
                      </p>
                    </div>
                </label>

                {/* Appointment Booking Toggle - Supported for all agent types */}
                {(formData.type === "incoming" || formData.type === "flow") && (
                  <div className="space-y-2">
                    <label className="flex items-center gap-3 cursor-pointer" data-testid="label-enable-appointment-booking">
                      <Checkbox
                        checked={formData.appointmentBookingEnabled}
                        onCheckedChange={(checked) => setFormData({ ...formData, appointmentBookingEnabled: checked as boolean })}
                        data-testid="checkbox-enable-appointment-booking"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-1">
                          <span className="text-sm font-medium">{t('agents.systemTools.enableAppointmentBooking')}</span>
                          <InfoTooltip content={t('agents.systemTools.appointmentBookingTooltip')} />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {t('agents.systemTools.appointmentBookingDescription')}
                        </p>
                      </div>
                    </label>

                    {/* Doctor Name — used in WhatsApp appointment confirmation ({{3}} template variable) */}
                    {formData.appointmentBookingEnabled && isWhatsAppActive && formData.messagingWhatsappEnabled && (
                      <div className="ml-8 space-y-1">
                        <Label className="text-xs text-muted-foreground block">
                          {t('agents.systemTools.appointmentDoctorName', "Doctor's Name")}
                        </Label>
                        <Input
                          placeholder={t('agents.systemTools.appointmentDoctorNamePlaceholder', 'e.g. Smith (used as "Dr. Smith" in WhatsApp confirmation)')}
                          value={formData.appointmentDoctorName}
                          onChange={(e) => setFormData({ ...formData, appointmentDoctorName: e.target.value })}
                          data-testid="input-appointment-doctor-name"
                        />
                        <p className="text-xs text-muted-foreground">
                          {t('agents.systemTools.appointmentDoctorNameDescription', 'Shown as "Doctor: Dr. [name]" in the WhatsApp confirmation. Defaults to the agent name if left blank.')}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {hasEmailTemplates && (
                  <div className="space-y-2">
                    <label className="flex items-center gap-3 cursor-pointer" data-testid="label-enable-messaging-email">
                      <Checkbox
                        checked={formData.messagingEmailEnabled}
                        onCheckedChange={(checked) => setFormData({ ...formData, messagingEmailEnabled: checked as boolean, messagingEmailTemplate: checked ? formData.messagingEmailTemplate : "" })}
                        data-testid="checkbox-enable-messaging-email"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-1">
                          <span className="text-sm font-medium">{t('agents.systemTools.enableMessagingEmail', 'Enable Email Sending')}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {t('agents.systemTools.messagingEmailDescription', 'Allow this agent to send emails to callers using your email templates.')}
                        </p>
                      </div>
                    </label>
                    {formData.messagingEmailEnabled && (
                      <div className="ml-8">
                        <Label className="text-xs text-muted-foreground mb-1 block">{t('agents.systemTools.selectEmailTemplate', 'Select Email Template')} <span className="text-destructive">*</span></Label>
                        <Select
                          value={formData.messagingEmailTemplate}
                          onValueChange={(value) => setFormData({ ...formData, messagingEmailTemplate: value })}
                        >
                          <SelectTrigger data-testid="select-email-template">
                            <SelectValue placeholder={t('agents.systemTools.selectTemplatePlaceholder', 'Choose a template...')} />
                          </SelectTrigger>
                          <SelectContent>
                            {emailTemplates.map((template) => (
                              <SelectItem key={template.id || template.name} value={template.name} data-testid={`select-email-template-${template.name}`}>
                                {template.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                )}

                {isWhatsAppActive && (
                  <div className="space-y-2">
                    <label className="flex items-center gap-3 cursor-pointer" data-testid="label-enable-messaging-whatsapp">
                      <Checkbox
                        checked={formData.messagingWhatsappEnabled}
                        onCheckedChange={(checked) => setFormData({ ...formData, messagingWhatsappEnabled: checked as boolean, messagingWhatsappTemplate: checked ? formData.messagingWhatsappTemplate : "" })}
                        data-testid="checkbox-enable-messaging-whatsapp"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-1">
                          <span className="text-sm font-medium">{t('agents.systemTools.enableMessagingWhatsapp', 'Enable WhatsApp Sending')}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {t('agents.systemTools.messagingWhatsappDescription', 'Allow this agent to send WhatsApp messages to callers via WhatsWay.')}
                        </p>
                      </div>
                    </label>
                    {formData.messagingWhatsappEnabled && whatsappTemplates.length > 0 && (
                      <div className="ml-8 space-y-3">
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1 block">{t('agents.systemTools.selectWhatsappTemplate', 'Select WhatsApp Template')} <span className="text-destructive">*</span></Label>
                          <Select
                            value={formData.messagingWhatsappTemplate}
                            onValueChange={(value) => {
                              const varIndices = getWhatsAppTemplateVariables(value);
                              const buttonVars = getWhatsAppTemplateButtonVariables(value);
                              const headerInfo = getWhatsAppTemplateHeaderInfo(value);
                              const existingVars = parseWhatsAppVariables(formData.messagingWhatsappVariables);
                              const newVars: Record<string, { mode: 'fixed' | 'collect'; value: string; componentType?: string }> = {};
                              varIndices.forEach(idx => {
                                newVars[String(idx)] = existingVars[String(idx)] || { mode: 'collect', value: '' };
                              });
                              buttonVars.forEach(btn => {
                                const key = `btn_${btn.index}`;
                                newVars[key] = existingVars[key] || { mode: 'fixed', value: '', componentType: 'button' };
                              });
                              if (headerInfo?.hasVariable) {
                                newVars['header_value'] = existingVars['header_value'] || { mode: 'fixed', value: '', componentType: 'header', header_type: headerInfo.format.toLowerCase() };
                              }
                              const hasVars = varIndices.length > 0 || buttonVars.length > 0 || !!headerInfo?.hasVariable;
                              setFormData({ ...formData, messagingWhatsappTemplate: value, messagingWhatsappVariables: hasVars ? JSON.stringify(newVars) : '' });
                            }}
                          >
                            <SelectTrigger data-testid="select-whatsapp-template">
                              <SelectValue placeholder={t('agents.systemTools.selectTemplatePlaceholder', 'Choose a template...')} />
                            </SelectTrigger>
                            <SelectContent>
                              {whatsappTemplates.map((template) => (
                                <SelectItem key={template.name} value={template.name} data-testid={`select-whatsapp-template-${template.name}`}>
                                  {template.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {formData.messagingWhatsappTemplate && (() => {
                          const varIndices = getWhatsAppTemplateVariables(formData.messagingWhatsappTemplate);
                          const buttonVarDefs = getWhatsAppTemplateButtonVariables(formData.messagingWhatsappTemplate);
                          const headerInfo = getWhatsAppTemplateHeaderInfo(formData.messagingWhatsappTemplate);
                          if (varIndices.length === 0 && buttonVarDefs.length === 0 && !headerInfo?.hasVariable) return null;
                          const currentVars = parseWhatsAppVariables(formData.messagingWhatsappVariables);
                          const selectedTemplate = whatsappTemplates.find(t => t.name === formData.messagingWhatsappTemplate);
                          const bodyComponent = selectedTemplate?.components?.find((c: any) => c.type === 'BODY');
                          let sectionCount = 0;
                          return (
                            <div className="space-y-2 p-3 rounded-md border bg-muted/30">
                              {headerInfo?.hasVariable && (() => {
                                sectionCount++;
                                const headerConfig = currentVars['header_value'] || currentVars['header'] || { mode: 'fixed' as const, value: '', componentType: 'header', header_type: headerInfo.format.toLowerCase() };
                                const isMedia = ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerInfo.format);
                                return (
                                  <div>
                                    <Label className="text-xs font-medium block">Header Variable</Label>
                                    <p className="text-xs text-muted-foreground mb-2">
                                      {isMedia
                                        ? `This template requires a ${headerInfo.format.toLowerCase()} URL for the header.`
                                        : `Header text has a variable: ${headerInfo.text || ''}`}
                                    </p>
                                    <Input
                                      value={headerConfig.value}
                                      onChange={(e) => {
                                        const updated = { ...currentVars, header_value: { mode: 'fixed' as const, value: e.target.value, componentType: 'header', header_type: headerInfo.format.toLowerCase() } };
                                        setFormData({ ...formData, messagingWhatsappVariables: JSON.stringify(updated) });
                                      }}
                                      placeholder={isMedia ? `Enter ${headerInfo.format.toLowerCase()} URL` : 'Enter header text value'}
                                      className="text-sm"
                                      data-testid="input-whatsapp-header-var"
                                    />
                                  </div>
                                );
                              })()}
                              {varIndices.length > 0 && (() => {
                                const needsBorder = sectionCount > 0;
                                sectionCount++;
                                return (
                                  <div className={needsBorder ? "pt-2 mt-2 border-t" : ""}>
                                    <Label className="text-xs font-medium block">Template Variables</Label>
                                    {bodyComponent?.text && (
                                      <p className="text-xs text-muted-foreground italic break-words">{bodyComponent.text}</p>
                                    )}
                                    <p className="text-xs text-muted-foreground">For each variable, choose whether to use a fixed value or let the AI collect it from the caller.</p>
                                    {varIndices.map(idx => {
                                      const varConfig = currentVars[String(idx)] || { mode: 'collect' as const, value: '' };
                                      return (
                                        <div key={idx} className="space-y-1.5">
                                          <div className="flex items-center gap-2">
                                            <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">{`{{${idx}}}`}</span>
                                            <Select
                                              value={varConfig.mode}
                                              onValueChange={(mode) => {
                                                const updated = { ...currentVars, [String(idx)]: { ...varConfig, mode: mode as 'fixed' | 'collect', value: '' } };
                                                setFormData({ ...formData, messagingWhatsappVariables: JSON.stringify(updated) });
                                              }}
                                            >
                                              <SelectTrigger className="w-[160px] text-xs" data-testid={`select-whatsapp-var-mode-${idx}`}>
                                                <SelectValue />
                                              </SelectTrigger>
                                              <SelectContent>
                                                <SelectItem value="fixed">Fixed value</SelectItem>
                                                <SelectItem value="collect">Collect from caller</SelectItem>
                                              </SelectContent>
                                            </Select>
                                            <Input
                                              value={varConfig.value}
                                              onChange={(e) => {
                                                const updated = { ...currentVars, [String(idx)]: { ...varConfig, value: e.target.value } };
                                                setFormData({ ...formData, messagingWhatsappVariables: JSON.stringify(updated) });
                                              }}
                                              placeholder={varConfig.mode === 'fixed' ? 'Enter exact value (e.g. SAVE20)' : 'Describe what to collect (e.g. Customer name)'}
                                              className="text-sm flex-1"
                                              data-testid={`input-whatsapp-var-${idx}`}
                                            />
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              })()}
                              {buttonVarDefs.length > 0 && (() => {
                                const needsBorder = sectionCount > 0;
                                return (
                                  <div className={needsBorder ? "pt-2 mt-2 border-t" : ""}>
                                    <Label className="text-xs font-medium block">Button Variables</Label>
                                    <p className="text-xs text-muted-foreground mb-2">URL buttons with dynamic parameters require a value for the variable portion of the URL.</p>
                                    {buttonVarDefs.map(btn => {
                                      const key = `btn_${btn.index}`;
                                      const btnConfig = currentVars[key] || { mode: 'fixed' as const, value: '', componentType: 'button' };
                                      return (
                                        <div key={key} className="space-y-1.5">
                                          <div className="flex items-center gap-2">
                                            <span className="text-xs font-mono text-muted-foreground whitespace-nowrap truncate max-w-[140px]" title={btn.url}>{btn.label}</span>
                                            <Input
                                              value={btnConfig.value}
                                              onChange={(e) => {
                                                const updated = { ...currentVars, [key]: { mode: 'fixed' as const, value: e.target.value, componentType: 'button' } };
                                                setFormData({ ...formData, messagingWhatsappVariables: JSON.stringify(updated) });
                                              }}
                                              placeholder={`Dynamic URL value (e.g. order-123)`}
                                              className="text-sm flex-1"
                                              data-testid={`input-whatsapp-btn-var-${btn.index}`}
                                            />
                                          </div>
                                          <p className="text-xs text-muted-foreground ml-1 break-all">{btn.url}</p>
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              })()}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
              </>
            )}
          </div>
          </div>

          {/* Fixed Footer */}
          <div className="flex justify-end gap-2 px-6 py-4 border-t flex-shrink-0">
            <Button
              variant="outline"
              onClick={() => {
                setCreateDialogOpen(false);
                setEditingAgent(null);
                resetForm();
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={editingAgent ? handleUpdate : handleCreate}
              disabled={createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-agent"
            >
              {createMutation.isPending || updateMutation.isPending
                ? t('common.saving')
                : editingAgent
                ? t('agents.create.updateAgent')
                : t('agents.create.createAgent')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingAgent} onOpenChange={() => setDeletingAgent(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('agents.delete.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('agents.delete.description', { name: deletingAgent?.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingAgent && deleteMutation.mutate(deletingAgent.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={knowledgeUploadOpen} onOpenChange={setKnowledgeUploadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('agents.knowledge.uploadTitle')}</DialogTitle>
            <DialogDescription>
              {t('agents.knowledge.uploadDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="knowledge-title">{t('agents.knowledge.titleLabel')} *</Label>
              <Input
                id="knowledge-title"
                placeholder={t('agents.knowledge.titlePlaceholder')}
                value={knowledgeData.title}
                onChange={(e) => setKnowledgeData({ ...knowledgeData, title: e.target.value })}
                data-testid="input-knowledge-title"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="knowledge-content">{t('agents.knowledge.contentLabel')} *</Label>
              <Textarea
                id="knowledge-content"
                placeholder={t('agents.knowledge.contentPlaceholder')}
                rows={10}
                value={knowledgeData.content}
                onChange={(e) => setKnowledgeData({ ...knowledgeData, content: e.target.value })}
                data-testid="input-knowledge-content"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setKnowledgeUploadOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => uploadKnowledgeMutation.mutate()}
              disabled={!knowledgeData.title || !knowledgeData.content || uploadKnowledgeMutation.isPending}
              data-testid="button-upload-knowledge-submit"
            >
              {uploadKnowledgeMutation.isPending ? t('agents.knowledge.uploading') : t('agents.knowledge.uploadButton')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Guided Agent Creation Wizard */}
      <AgentCreationWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
        }}
      />
      </TabsContent>
      </Tabs>
    </div>
  );
}
