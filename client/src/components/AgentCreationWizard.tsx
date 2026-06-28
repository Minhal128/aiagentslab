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
import { useTranslation } from "react-i18next";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Phone,
  Clock,
  Target,
  BarChart3,
  Users,
  Sparkles,
  Mic,
  Bot,
  MessageSquare,
  Settings,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Wand2,
  Volume2,
  FileText,
  Play,
  Check,
  Loader2,
  ArrowRight,
  Zap,
  Info,
} from "lucide-react";
import VoiceSearchPicker from "@/components/VoiceSearchPicker";
import VoicePreviewButton from "@/components/VoicePreviewButton";
import OpenAIVoicePreviewButton from "@/components/OpenAIVoicePreviewButton";
import PromptTemplatesLibrary from "@/components/PromptTemplatesLibrary";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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

interface UseCase {
  id: string;
  title: string;
  description: string;
  icon: typeof Phone;
  color: string;
  presetVoiceTone: string;
  presetPersonality: string;
  suggestedPrompt: string;
  suggestedFirstMessage: string;
  suggestedVoiceStyle: "professional" | "friendly" | "casual" | "authoritative";
}

const useCases: UseCase[] = [
  {
    id: "receptionist",
    title: "Receptionist",
    description: "Handle incoming calls, route to departments, answer FAQs",
    icon: Phone,
    color: "emerald",
    presetVoiceTone: "professional",
    presetPersonality: "helpful",
    suggestedPrompt: "You are a professional virtual receptionist for {{company_name}}. Your role is to:\n- Greet callers warmly and professionally\n- Answer common questions about business hours, location, and services\n- Route calls to the appropriate department or person\n- Take messages when someone is unavailable\n- Maintain a calm and helpful demeanor at all times\n\nBe concise but friendly. If you don't know something, offer to take a message or transfer to someone who can help.",
    suggestedFirstMessage: "Thank you for calling {{company_name}}. My name is {{agent_name}}. How may I assist you today?",
    suggestedVoiceStyle: "professional",
  },
  {
    id: "appointment",
    title: "Appointment Setter",
    description: "Schedule meetings, qualify leads, manage bookings",
    icon: Clock,
    color: "blue",
    presetVoiceTone: "friendly",
    presetPersonality: "professional",
    suggestedPrompt: "You are an appointment scheduling assistant for {{company_name}}. Your responsibilities are:\n- Qualify callers to ensure they're a good fit\n- Check available time slots\n- Book appointments efficiently\n- Confirm date, time, and meeting details\n- Send confirmation information\n\nAsk qualifying questions naturally before booking. Be efficient with the caller's time while ensuring you gather all necessary information.",
    suggestedFirstMessage: "Hi there! Thanks for your interest in scheduling a meeting with {{company_name}}. I'd love to help you find a time that works. May I start by getting your name?",
    suggestedVoiceStyle: "friendly",
  },
  {
    id: "qualification",
    title: "Lead Qualification",
    description: "Screen prospects, score leads, gather requirements",
    icon: Target,
    color: "violet",
    presetVoiceTone: "confident",
    presetPersonality: "inquisitive",
    suggestedPrompt: "You are a lead qualification specialist for {{company_name}}. Your mission is to:\n- Understand the prospect's needs and pain points\n- Gather key information: budget, timeline, decision process\n- Score leads based on qualification criteria\n- Identify the best next steps for qualified leads\n- Politely disqualify poor-fit prospects\n\nAsk open-ended questions and listen carefully. Be conversational, not interrogative. Focus on understanding their situation before pitching solutions.",
    suggestedFirstMessage: "Hello! I'm reaching out from {{company_name}}. I'd love to learn a bit about your current situation to see if we might be able to help. Do you have a few minutes to chat?",
    suggestedVoiceStyle: "professional",
  },
  {
    id: "survey",
    title: "Survey & Feedback",
    description: "Conduct surveys, gather insights, collect feedback",
    icon: BarChart3,
    color: "amber",
    presetVoiceTone: "friendly",
    presetPersonality: "curious",
    suggestedPrompt: "You are a friendly survey conductor for {{company_name}}. Your goals are:\n- Make the survey feel like a natural conversation\n- Ask questions clearly and wait for complete responses\n- Probe for details when answers are vague\n- Thank respondents for their time and insights\n- Record feedback accurately\n\nKeep a warm, appreciative tone. Make respondents feel their opinions matter. Be patient and don't rush through questions.",
    suggestedFirstMessage: "Hi! I'm calling from {{company_name}} to gather some quick feedback about your recent experience with us. Your insights really help us improve. Would you have about 5 minutes to share your thoughts?",
    suggestedVoiceStyle: "friendly",
  },
  {
    id: "service",
    title: "Customer Service",
    description: "Resolve issues, answer questions, provide support",
    icon: Users,
    color: "rose",
    presetVoiceTone: "empathetic",
    presetPersonality: "patient",
    suggestedPrompt: "You are a customer service representative for {{company_name}}. Your priorities are:\n- Listen to customer concerns with empathy\n- Resolve issues quickly and effectively\n- Provide clear, accurate information\n- Escalate to a human agent when necessary\n- Follow up to ensure satisfaction\n\nAlways acknowledge the customer's feelings first. Stay calm even with frustrated callers. Focus on solutions, not blame.",
    suggestedFirstMessage: "Thank you for contacting {{company_name}} support. I'm here to help! What can I assist you with today?",
    suggestedVoiceStyle: "professional",
  },
  {
    id: "custom",
    title: "Custom Agent",
    description: "Build from scratch with full customization",
    icon: Sparkles,
    color: "slate",
    presetVoiceTone: "professional",
    presetPersonality: "helpful",
    suggestedPrompt: "",
    suggestedFirstMessage: "",
    suggestedVoiceStyle: "professional",
  },
];

const voiceToneOptions = [
  { value: "professional", label: "Professional", description: "Formal, polished, business-appropriate" },
  { value: "friendly", label: "Friendly", description: "Warm, approachable, personable" },
  { value: "empathetic", label: "Empathetic", description: "Understanding, compassionate, supportive" },
  { value: "confident", label: "Confident", description: "Assured, decisive, trustworthy" },
  { value: "casual", label: "Casual", description: "Relaxed, conversational, laid-back" },
];

const personalityOptions = [
  { value: "helpful", label: "Helpful", description: "Eager to assist and solve problems" },
  { value: "professional", label: "Professional", description: "Business-focused and efficient" },
  { value: "patient", label: "Patient", description: "Takes time to explain and understand" },
  { value: "inquisitive", label: "Inquisitive", description: "Asks questions to understand needs" },
  { value: "curious", label: "Curious", description: "Interested in learning more" },
  { value: "energetic", label: "Energetic", description: "Enthusiastic and positive" },
];


// OpenAI Realtime API voices
const openaiVoices = [
  { value: "alloy", label: "Alloy", description: "Neutral and balanced" },
  { value: "echo", label: "Echo", description: "Warm and conversational" },
  { value: "shimmer", label: "Shimmer", description: "Clear and expressive" },
  { value: "ash", label: "Ash", description: "Soft and gentle" },
  { value: "ballad", label: "Ballad", description: "Melodic and soothing" },
  { value: "coral", label: "Coral", description: "Bright and friendly" },
  { value: "sage", label: "Sage", description: "Calm and wise" },
  { value: "verse", label: "Verse", description: "Poetic and articulate" },
  { value: "cedar", label: "Cedar", description: "Deep and grounded" },
  { value: "marin", label: "Marin", description: "Fresh and lively" },
  { value: "arjun", label: "Arjun", description: "Warm Indian tone" },
  { value: "priya", label: "Priya", description: "Warm Indian female tone" },
];

interface AgentCreationWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

type WizardStep = "useCase" | "basics" | "personality" | "prompts" | "voice" | "review";

const steps: { id: WizardStep; title: string; icon: typeof Bot }[] = [
  { id: "useCase", title: "Use Case", icon: Target },
  { id: "basics", title: "Basic Info", icon: Bot },
  { id: "personality", title: "Personality", icon: MessageSquare },
  { id: "prompts", title: "Prompts", icon: FileText },
  { id: "voice", title: "Voice", icon: Mic },
  { id: "review", title: "Review", icon: CheckCircle2 },
];

export function AgentCreationWizard({ open, onOpenChange, onSuccess }: AgentCreationWizardProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState<WizardStep>("useCase");
  const [templatesOpen, setTemplatesOpen] = useState(false);

  // Fetch voice engine setting to check if Plivo+OpenAI or Twilio+OpenAI is enabled
  const { data: voiceEngineSettings } = useQuery<{ plivo_openai_engine_enabled: boolean; twilio_openai_engine_enabled: boolean; default_tts_model?: string }>({
    queryKey: ["/api/settings/voice-engine"],
    staleTime: 60000, // Cache for 1 minute
  });

  // Check if SIP plugin is enabled and which engines are allowed
  const { isSipPluginEnabled, sipEnginesAllowed } = usePluginStatus();
  const isElevenLabsSipAllowed = isSipPluginEnabled && sipEnginesAllowed.includes("elevenlabs-sip");
  const isOpenAISipAllowed = isSipPluginEnabled && sipEnginesAllowed.includes("openai-sip");

  // Fetch SIP phone numbers when SIP plugin is enabled
  const { data: sipPhoneNumbersResponse, isLoading: isSipNumbersLoading } = useQuery<{ success: boolean; data: SipPhoneNumber[] }>({
    queryKey: ["/api/sip/phone-numbers"],
    enabled: isSipPluginEnabled,
  });
  const sipPhoneNumbers = sipPhoneNumbersResponse?.data || [];

  const isPlivoEnabled = voiceEngineSettings?.plivo_openai_engine_enabled ?? false;
  const isTwilioOpenaiEnabled = voiceEngineSettings?.twilio_openai_engine_enabled ?? false;
  const isV3TtsModel = (voiceEngineSettings?.default_tts_model || '').includes('v3');
  const hasAlternateEngines = isPlivoEnabled || isTwilioOpenaiEnabled || isElevenLabsSipAllowed || isOpenAISipAllowed;

  const [formData, setFormData] = useState({
    useCase: "",
    name: "",
    elevenLabsVoiceId: "",
    language: "en",
    voiceTone: "professional",
    personality: "helpful",
    systemPrompt: "",
    firstMessage: "",
    voiceStability: 0.5,
    voiceSimilarityBoost: 0.85,
    voiceSpeed: 1.0,
    turnTimeout: 1.5,
    // Telephony provider selection
    telephonyProvider: "twilio" as "twilio" | "plivo" | "twilio_openai" | "elevenlabs-sip" | "openai-sip",
    openaiVoice: "alloy",
    // SIP phone number selection (for SIP engines)
    sipPhoneNumberId: "",
  });

  const selectedUseCase = useMemo(() => 
    useCases.find(uc => uc.id === formData.useCase),
    [formData.useCase]
  );

  const currentStepIndex = steps.findIndex(s => s.id === currentStep);
  const progress = ((currentStepIndex + 1) / steps.length) * 100;

  const canProceed = useMemo(() => {
    switch (currentStep) {
      case "useCase":
        return !!formData.useCase;
      case "basics":
        // Voice validation depends on telephony provider
        const isOpenAIProvider = formData.telephonyProvider === "plivo" || formData.telephonyProvider === "twilio_openai" || formData.telephonyProvider === "openai-sip";
        const hasValidVoice = isOpenAIProvider
          ? !!formData.openaiVoice 
          : !!formData.elevenLabsVoiceId;
        // SIP engines require a phone number selection
        const isSipEngine = formData.telephonyProvider === "elevenlabs-sip" || formData.telephonyProvider === "openai-sip";
        const hasSipPhoneNumber = !isSipEngine || !!formData.sipPhoneNumberId;
        return !!formData.name && hasValidVoice && hasSipPhoneNumber;
      case "personality":
        return !!formData.voiceTone && !!formData.personality;
      case "prompts":
        return !!formData.systemPrompt;
      case "voice":
        return true;
      case "review":
        return true;
      default:
        return false;
    }
  }, [currentStep, formData]);

  const validationHint = useMemo(() => {
    if (canProceed || currentStep !== "basics") return null;
    const missing: string[] = [];
    if (!formData.name) missing.push(t('wizard.hint.enterName', { defaultValue: 'enter an agent name' }));
    const isOpenAIProvider = formData.telephonyProvider === "plivo" || formData.telephonyProvider === "twilio_openai" || formData.telephonyProvider === "openai-sip";
    const isSipEngine = formData.telephonyProvider === "elevenlabs-sip" || formData.telephonyProvider === "openai-sip";
    if (isOpenAIProvider && !formData.openaiVoice) {
      missing.push(t('wizard.hint.selectVoice', { defaultValue: 'select a voice' }));
    } else if (!isOpenAIProvider && !formData.elevenLabsVoiceId) {
      missing.push(t('wizard.hint.selectVoice', { defaultValue: 'select a voice' }));
    }
    if (isSipEngine && !formData.sipPhoneNumberId) {
      missing.push(t('wizard.hint.selectSipNumber', { defaultValue: 'select a SIP phone number' }));
    }
    if (missing.length === 0) return null;
    return t('wizard.hint.toContinue', { 
      defaultValue: 'Please {{items}} to continue',
      items: missing.join(` ${t('wizard.hint.and', { defaultValue: 'and' })} `)
    });
  }, [canProceed, currentStep, formData, t]);

  const handleUseCaseSelect = (useCaseId: string) => {
    const useCase = useCases.find(uc => uc.id === useCaseId);
    if (useCase) {
      setFormData(prev => ({
        ...prev,
        useCase: useCaseId,
        voiceTone: useCase.presetVoiceTone,
        personality: useCase.presetPersonality,
        systemPrompt: useCase.suggestedPrompt,
        firstMessage: useCase.suggestedFirstMessage,
      }));
    }
  };

  const goNext = () => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < steps.length) {
      setCurrentStep(steps[nextIndex].id);
    }
  };

  const goBack = () => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(steps[prevIndex].id);
    }
  };

  const resetWizard = () => {
    setCurrentStep("useCase");
    setFormData({
      useCase: "",
      name: "",
      elevenLabsVoiceId: "",
      language: "en",
      voiceTone: "professional",
      personality: "helpful",
      systemPrompt: "",
      firstMessage: "",
      voiceStability: 0.5,
      voiceSimilarityBoost: 0.85,
      voiceSpeed: 1.0,
      turnTimeout: 1.5,
      telephonyProvider: "twilio",
      openaiVoice: "alloy",
      sipPhoneNumberId: "",
    });
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const isSipEngine = formData.telephonyProvider === "elevenlabs-sip" || formData.telephonyProvider === "openai-sip";
      const isOpenAIVoice = formData.telephonyProvider === "plivo" || formData.telephonyProvider === "twilio_openai" || formData.telephonyProvider === "openai-sip";
      const isElevenLabsVoice = formData.telephonyProvider === "twilio" || formData.telephonyProvider === "elevenlabs-sip";

      const payload = {
        type: "incoming",
        name: formData.name,
        elevenLabsVoiceId: isElevenLabsVoice ? formData.elevenLabsVoiceId : undefined,
        openaiModel: isOpenAIVoice ? "gpt-realtime-1.5" : undefined,
        language: formData.language,
        voiceTone: formData.voiceTone,
        personality: formData.personality,
        systemPrompt: formData.systemPrompt,
        firstMessage: formData.firstMessage || "Hello! How can I help you today?",
        voiceStability: formData.voiceStability,
        voiceSimilarityBoost: formData.voiceSimilarityBoost,
        voiceSpeed: formData.voiceSpeed,
        turnTimeout: formData.turnTimeout,
        temperature: 0.5,
        // Telephony provider configuration
        telephonyProvider: formData.telephonyProvider,
        openaiVoice: isOpenAIVoice ? formData.openaiVoice : undefined,
        // SIP configuration
        sipPhoneNumberId: isSipEngine ? formData.sipPhoneNumberId : undefined,
      };
      const res = await apiRequest("POST", "/api/agents", payload);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Agent Created!",
        description: `Your ${formData.name} agent is ready to use.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
      onOpenChange(false);
      resetWizard();
      onSuccess?.();
    },
    onError: (error: any) => {
      toast({
        title: "Creation Failed",
        description: error.message || "Failed to create agent. Please try again.",
        variant: "destructive",
      });
    },
  });

  const getColorClasses = (color: string, selected: boolean) => {
    const colors: Record<string, { bg: string; border: string; text: string; icon: string }> = {
      emerald: {
        bg: selected ? "bg-emerald-500/20 dark:bg-emerald-500/30" : "bg-muted/30 hover:bg-muted/50",
        border: selected ? "border-emerald-500/50" : "border-transparent hover:border-border",
        text: selected ? "text-emerald-700 dark:text-emerald-300" : "",
        icon: selected ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground",
      },
      blue: {
        bg: selected ? "bg-blue-500/20 dark:bg-blue-500/30" : "bg-muted/30 hover:bg-muted/50",
        border: selected ? "border-blue-500/50" : "border-transparent hover:border-border",
        text: selected ? "text-blue-700 dark:text-blue-300" : "",
        icon: selected ? "bg-blue-500/20 text-blue-600 dark:text-blue-400" : "bg-muted text-muted-foreground",
      },
      violet: {
        bg: selected ? "bg-violet-500/20 dark:bg-violet-500/30" : "bg-muted/30 hover:bg-muted/50",
        border: selected ? "border-violet-500/50" : "border-transparent hover:border-border",
        text: selected ? "text-violet-700 dark:text-violet-300" : "",
        icon: selected ? "bg-violet-500/20 text-violet-600 dark:text-violet-400" : "bg-muted text-muted-foreground",
      },
      amber: {
        bg: selected ? "bg-amber-500/20 dark:bg-amber-500/30" : "bg-muted/30 hover:bg-muted/50",
        border: selected ? "border-amber-500/50" : "border-transparent hover:border-border",
        text: selected ? "text-amber-700 dark:text-amber-300" : "",
        icon: selected ? "bg-amber-500/20 text-amber-600 dark:text-amber-400" : "bg-muted text-muted-foreground",
      },
      rose: {
        bg: selected ? "bg-rose-500/20 dark:bg-rose-500/30" : "bg-muted/30 hover:bg-muted/50",
        border: selected ? "border-rose-500/50" : "border-transparent hover:border-border",
        text: selected ? "text-rose-700 dark:text-rose-300" : "",
        icon: selected ? "bg-rose-500/20 text-rose-600 dark:text-rose-400" : "bg-muted text-muted-foreground",
      },
      slate: {
        bg: selected ? "bg-slate-500/20 dark:bg-slate-500/30" : "bg-muted/30 hover:bg-muted/50",
        border: selected ? "border-slate-500/50" : "border-transparent hover:border-border",
        text: selected ? "text-slate-700 dark:text-slate-300" : "",
        icon: selected ? "bg-slate-500/20 text-slate-600 dark:text-slate-400" : "bg-muted text-muted-foreground",
      },
    };
    return colors[color] || colors.slate;
  };

  const renderStep = () => {
    switch (currentStep) {
      case "useCase":
        return (
          <div className="space-y-4">
            <div className="text-center mb-6">
              <h3 className="text-lg font-semibold">What will your AI agent do?</h3>
              <p className="text-sm text-muted-foreground">
                Choose a use case to get started with optimized settings
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {useCases.map((useCase) => {
                const selected = formData.useCase === useCase.id;
                const colors = getColorClasses(useCase.color, selected);
                return (
                  <div
                    key={useCase.id}
                    className={`relative p-4 rounded-xl cursor-pointer transition-all duration-200 border-2 ${colors.bg} ${colors.border}`}
                    onClick={() => handleUseCaseSelect(useCase.id)}
                    data-testid={`usecase-${useCase.id}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0 ${colors.icon}`}>
                        <useCase.icon className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className={`font-semibold ${colors.text}`}>{useCase.title}</h4>
                          {selected && <Check className="h-4 w-4 text-emerald-500" />}
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {useCase.description}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );

      case "basics":
        return (
          <div className="space-y-6">
            <div className="text-center mb-6">
              <h3 className="text-lg font-semibold">Basic Information</h3>
              <p className="text-sm text-muted-foreground">
                Name your agent and choose its voice
              </p>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Agent Name <span className="text-destructive">*</span></Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder={selectedUseCase ? `My ${selectedUseCase.title} Agent` : "Enter agent name"}
                  data-testid="input-agent-name"
                />
              </div>

              {/* Telephony Provider Selection - Only show if alternate engines are enabled */}
              {hasAlternateEngines && (
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
                      onClick={() => setFormData(prev => ({ ...prev, telephonyProvider: "twilio", sipPhoneNumberId: "" }))}
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
                    {/* OpenAI + Twilio - Teal/Blue theme */}
                    {isTwilioOpenaiEnabled && (
                      <div
                        className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                          formData.telephonyProvider === "twilio_openai"
                            ? "border-brand bg-brand/10 dark:bg-brand/20"
                            : "border-border hover:border-brand/50 hover:bg-brand/5"
                        }`}
                        onClick={() => setFormData(prev => ({ ...prev, telephonyProvider: "twilio_openai", sipPhoneNumberId: "" }))}
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
                    {isPlivoEnabled && (
                      <div
                        className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                          formData.telephonyProvider === "plivo"
                            ? "border-emerald-500 bg-emerald-500/10 dark:bg-emerald-500/20"
                            : "border-border hover:border-emerald-400/50 hover:bg-emerald-500/5"
                        }`}
                        onClick={() => setFormData(prev => ({ ...prev, telephonyProvider: "plivo", sipPhoneNumberId: "" }))}
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
                    {isElevenLabsSipAllowed && (
                      <div
                        className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                          formData.telephonyProvider === "elevenlabs-sip"
                            ? "border-orange-500 bg-orange-500/10 dark:bg-orange-500/20"
                            : "border-border hover:border-orange-400/50 hover:bg-orange-500/5"
                        }`}
                        onClick={() => setFormData(prev => ({ ...prev, telephonyProvider: "elevenlabs-sip", sipPhoneNumberId: "" }))}
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
                    {isOpenAISipAllowed && (
                      <div
                        className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                          formData.telephonyProvider === "openai-sip"
                            ? "border-pink-500 bg-pink-500/10 dark:bg-pink-500/20"
                            : "border-border hover:border-pink-400/50 hover:bg-pink-500/5"
                        }`}
                        onClick={() => setFormData(prev => ({ ...prev, telephonyProvider: "openai-sip", sipPhoneNumberId: "" }))}
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

              {(formData.telephonyProvider === "elevenlabs-sip" || formData.telephonyProvider === "openai-sip") && (
                <div className="space-y-2">
                  <Label>{t('wizard.sipPhoneNumber', { defaultValue: 'SIP Phone Number' })} <span className="text-destructive">*</span></Label>
                  {(() => {
                    if (isSipNumbersLoading) {
                      return (
                        <div className="flex items-center gap-2 p-3">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          <span className="text-sm text-muted-foreground">{t('wizard.loadingSipNumbers', { defaultValue: 'Loading SIP phone numbers...' })}</span>
                        </div>
                      );
                    }
                    const filtered = sipPhoneNumbers.filter(p => 
                      p.engine === formData.telephonyProvider
                    );
                    if (filtered.length === 0) {
                      return (
                        <div className="flex items-start gap-2 p-3 rounded-md bg-muted/50 border border-border">
                          <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                          <p className="text-sm text-muted-foreground">
                            {t('wizard.noSipNumbers', { defaultValue: 'No SIP phone numbers available for this engine. Please set up a SIP trunk and import phone numbers in your' })}{' '}
                            <a href="/app/sip" target="_blank" className="text-primary underline underline-offset-2" data-testid="link-sip-settings">
                              {t('wizard.sipSettings', { defaultValue: 'SIP settings' })}
                            </a>{' '}
                            {t('wizard.first', { defaultValue: 'first.' })}
                          </p>
                        </div>
                      );
                    }
                    return (
                      <Select
                        value={formData.sipPhoneNumberId}
                        onValueChange={(value) => setFormData(prev => ({ ...prev, sipPhoneNumberId: value }))}
                      >
                        <SelectTrigger data-testid="select-sip-phone-number">
                          <div className="flex items-center gap-2">
                            <Phone className="h-4 w-4 text-muted-foreground" />
                            <SelectValue placeholder={t('wizard.selectSipNumber', { defaultValue: 'Select a SIP phone number' })} />
                          </div>
                        </SelectTrigger>
                        <SelectContent>
                          {filtered.map((num) => (
                            <SelectItem key={num.id} value={num.id}>
                              <span>{num.phoneNumber}</span>
                              {num.label && <span className="ml-2 text-muted-foreground">({num.label})</span>}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    );
                  })()}
                </div>
              )}

              <div className="grid grid-cols-1 lg:[grid-template-columns:repeat(2,minmax(0,1fr))] gap-4">
                <div className="space-y-2 relative min-w-0">
                  <Label>Voice <span className="text-destructive">*</span></Label>
                  {(formData.telephonyProvider === "plivo" || formData.telephonyProvider === "twilio_openai" || formData.telephonyProvider === "openai-sip") ? (
                    // OpenAI Voice Selector for Plivo, Twilio+OpenAI, or OpenAI SIP
                    <div className="flex gap-2 min-w-0">
                      <div className="flex-1 min-w-0">
                        <Select
                          value={formData.openaiVoice}
                          onValueChange={(value) => setFormData(prev => ({ ...prev, openaiVoice: value }))}
                        >
                          <SelectTrigger data-testid="select-openai-voice" className="w-full">
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
                        speed={formData.voiceSpeed}
                      />
                    </div>
                  ) : (
                    // ElevenLabs Voice Selector for Twilio or ElevenLabs SIP
                    <div className="flex gap-2 min-w-0">
                      <div className="flex-1 min-w-0">
                        <VoiceSearchPicker
                          value={formData.elevenLabsVoiceId}
                          onChange={(voiceId) => setFormData(prev => ({ ...prev, elevenLabsVoiceId: voiceId }))}
                          placeholder="Select a voice"
                        />
                      </div>
                      <VoicePreviewButton
                        voiceId={formData.elevenLabsVoiceId}
                        voiceSettings={{
                          stability: formData.voiceStability,
                          similarity_boost: formData.voiceSimilarityBoost,
                          speed: formData.voiceSpeed,
                        }}
                        onSettingsChange={(settings) => {
                          setFormData(prev => ({
                            ...prev,
                            voiceStability: settings.stability,
                            voiceSimilarityBoost: settings.similarity_boost,
                            voiceSpeed: settings.speed ?? prev.voiceSpeed,
                          }));
                        }}
                        previewText={formData.firstMessage || undefined}
                        language={formData.language || undefined}
                        compact
                      />
                    </div>
                  )}
                </div>

                <div className="space-y-2 min-w-0">
                  <Label>Language</Label>
                  <Select
                    value={formData.language}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, language: value }))}
                  >
                    <SelectTrigger data-testid="select-language">
                      <SelectValue placeholder="Select language" />
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
            </div>
          </div>
        );

      case "personality":
        return (
          <div className="space-y-6">
            <div className="text-center mb-6">
              <h3 className="text-lg font-semibold">Personality & Tone</h3>
              <p className="text-sm text-muted-foreground">
                Define how your agent sounds and behaves
              </p>
            </div>

            <div className="space-y-6">
              <div className="space-y-3">
                <Label className="text-sm font-medium">Voice Tone</Label>
                <div className="grid grid-cols-1 gap-2">
                  {voiceToneOptions.map((option) => (
                    <div
                      key={option.value}
                      className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                        formData.voiceTone === option.value
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50 hover:bg-muted/50"
                      }`}
                      onClick={() => setFormData(prev => ({ ...prev, voiceTone: option.value }))}
                      data-testid={`tone-${option.value}`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-medium">{option.label}</span>
                          <span className="text-xs text-muted-foreground ml-2">
                            {option.description}
                          </span>
                        </div>
                        {formData.voiceTone === option.value && (
                          <Check className="h-4 w-4 text-primary" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <Label className="text-sm font-medium">Personality</Label>
                <div className="grid grid-cols-2 gap-2">
                  {personalityOptions.map((option) => (
                    <div
                      key={option.value}
                      className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                        formData.personality === option.value
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50 hover:bg-muted/50"
                      }`}
                      onClick={() => setFormData(prev => ({ ...prev, personality: option.value }))}
                      data-testid={`personality-${option.value}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{option.label}</span>
                        {formData.personality === option.value && (
                          <Check className="h-3 w-3 text-primary" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {option.description}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );

      case "prompts":
        return (
          <div className="space-y-6">
            <div className="text-center mb-4">
              <h3 className="text-lg font-semibold">Configure Prompts</h3>
              <p className="text-sm text-muted-foreground">
                Customize what your agent says and how it behaves
              </p>
            </div>

            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTemplatesOpen(true)}
                data-testid="button-use-template"
              >
                <FileText className="h-4 w-4 mr-2" />
                Use Template
              </Button>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="systemPrompt">
                  System Prompt <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="systemPrompt"
                  value={formData.systemPrompt}
                  onChange={(e) => setFormData(prev => ({ ...prev, systemPrompt: e.target.value }))}
                  placeholder="Describe your agent's role, responsibilities, and behavior guidelines..."
                  className="min-h-[150px] resize-none"
                  data-testid="textarea-system-prompt"
                />
                <p className="text-xs text-muted-foreground">
                  Use {"{{variable}}"} syntax for dynamic values like {"{{company_name}}"} or {"{{agent_name}}"}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="firstMessage">First Message</Label>
                <Textarea
                  id="firstMessage"
                  value={formData.firstMessage}
                  onChange={(e) => setFormData(prev => ({ ...prev, firstMessage: e.target.value }))}
                  placeholder="What your agent says when answering a call..."
                  className="min-h-[80px] resize-none"
                  data-testid="textarea-first-message"
                />
                <p className="text-xs text-muted-foreground">
                  Best practices: Start warm and natural. Example: "Hi {'{{first_name}}'}, this is Sarah from ABC Corp, how's your day going?"
                </p>
                
                {/* Dynamic Variables Helper */}
                <div className="mt-2 p-3 bg-muted/50 rounded-md border border-muted">
                  <p className="text-xs font-medium text-foreground mb-2">Available Dynamic Variables</p>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {['{{first_name}}', '{{last_name}}', '{{contact_name}}', '{{email}}', '{{phone}}', '{{city}}', '{{company}}'].map((variable) => (
                      <Badge 
                        key={variable} 
                        variant="secondary" 
                        className="text-xs font-mono cursor-pointer hover-elevate"
                        onClick={() => {
                          setFormData(prev => ({ ...prev, firstMessage: prev.firstMessage + variable }));
                        }}
                        data-testid={`badge-wizard-variable-${variable.replace(/[{}]/g, '')}`}
                      >
                        {variable}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">Click to insert. Variables are replaced with contact data from your campaign CSV.</p>
                </div>
              </div>
            </div>

            <Dialog open={templatesOpen} onOpenChange={setTemplatesOpen}>
              <DialogContent className="max-w-4xl max-h-[80vh]">
                <DialogHeader>
                  <DialogTitle>Prompt Templates</DialogTitle>
                  <DialogDescription>
                    Choose a template to use as a starting point
                  </DialogDescription>
                </DialogHeader>
                <ScrollArea className="max-h-[60vh]">
                  <PromptTemplatesLibrary
                    mode="select"
                    onSelectTemplate={(template) => {
                      setFormData(prev => ({
                        ...prev,
                        systemPrompt: template.systemPrompt,
                        firstMessage: template.firstMessage || prev.firstMessage,
                        voiceTone: template.suggestedVoiceTone || prev.voiceTone,
                        personality: template.suggestedPersonality || prev.personality,
                      }));
                      setTemplatesOpen(false);
                      toast({
                        title: "Template Applied",
                        description: "Template has been applied to your agent.",
                      });
                    }}
                  />
                </ScrollArea>
              </DialogContent>
            </Dialog>
          </div>
        );

      case "voice":
        return (
          <div className="space-y-6">
            <div className="text-center mb-6">
              <h3 className="text-lg font-semibold">Fine-tune Voice</h3>
              <p className="text-sm text-muted-foreground">
                {(formData.telephonyProvider === "plivo" || formData.telephonyProvider === "twilio_openai")
                  ? "OpenAI voice settings are optimized automatically"
                  : "Adjust voice characteristics for the perfect sound"
                }
              </p>
            </div>

            {(formData.telephonyProvider === "plivo" || formData.telephonyProvider === "twilio_openai") ? (
              // OpenAI engine - show simplified voice info
              <div className="space-y-6">
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-4">
                      <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                        <Volume2 className="h-6 w-6 text-primary" />
                      </div>
                      <div>
                        <Label className="text-sm text-muted-foreground">Selected Voice</Label>
                        <p className="font-semibold text-lg">
                          {openaiVoices.find(v => v.value === formData.openaiVoice)?.label || formData.openaiVoice}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {openaiVoices.find(v => v.value === formData.openaiVoice)?.description}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 p-3 bg-muted/50 rounded-lg">
                      <p className="text-xs text-muted-foreground">
                        OpenAI Realtime voices are automatically optimized for natural conversation flow with low latency.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              // ElevenLabs Twilio - show full voice settings
              <div className="space-y-6">
                {isV3TtsModel ? (
                  <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg" data-testid="info-v3-voice-settings">
                    <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                    <p className="text-xs text-muted-foreground">
                      V3 Conversational model automatically optimizes voice quality. Use Expressive Mode and audio tags below to control how the agent sounds.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <Label className="text-sm font-medium">Stability</Label>
                          <p className="text-xs text-muted-foreground">Higher = more consistent, Lower = more expressive</p>
                        </div>
                        <span className="text-sm font-mono bg-muted px-2 py-1 rounded">
                          {Math.round(formData.voiceStability * 100)}%
                        </span>
                      </div>
                      <Slider
                        value={[formData.voiceStability]}
                        onValueChange={([value]) => setFormData(prev => ({ ...prev, voiceStability: value }))}
                        min={0}
                        max={1}
                        step={0.01}
                        className="w-full"
                        data-testid="slider-stability"
                      />
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <Label className="text-sm font-medium">Similarity</Label>
                          <p className="text-xs text-muted-foreground">How closely to match the original voice</p>
                        </div>
                        <span className="text-sm font-mono bg-muted px-2 py-1 rounded">
                          {Math.round(formData.voiceSimilarityBoost * 100)}%
                        </span>
                      </div>
                      <Slider
                        value={[formData.voiceSimilarityBoost]}
                        onValueChange={([value]) => setFormData(prev => ({ ...prev, voiceSimilarityBoost: value }))}
                        min={0}
                        max={1}
                        step={0.01}
                        className="w-full"
                        data-testid="slider-similarity"
                      />
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <Label className="text-sm font-medium">Speed</Label>
                          <p className="text-xs text-muted-foreground">Speaking rate (0.7x to 1.2x)</p>
                        </div>
                        <span className="text-sm font-mono bg-muted px-2 py-1 rounded">
                          {formData.voiceSpeed.toFixed(2)}x
                        </span>
                      </div>
                      <Slider
                        value={[formData.voiceSpeed]}
                        onValueChange={([value]) => setFormData(prev => ({ ...prev, voiceSpeed: value }))}
                        min={0.7}
                        max={1.2}
                        step={0.05}
                        className="w-full"
                        data-testid="slider-speed"
                      />
                    </div>
                  </>
                )}

                <div>
                  <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                    <div>
                      <Label className="text-sm font-medium">Response Delay</Label>
                      <p className="text-xs text-muted-foreground">How long the agent waits before responding (0.5s to 5.0s)</p>
                    </div>
                    <span className="text-sm font-mono bg-muted px-2 py-1 rounded">
                      {formData.turnTimeout.toFixed(1)}s
                    </span>
                  </div>
                  <Slider
                    value={[formData.turnTimeout]}
                    onValueChange={([value]) => setFormData(prev => ({ ...prev, turnTimeout: value }))}
                    min={0.5}
                    max={5.0}
                    step={0.1}
                    className="w-full"
                    data-testid="slider-turn-timeout"
                  />
                </div>

                <div className="flex justify-center pt-4">
                  <VoicePreviewButton
                    voiceId={formData.elevenLabsVoiceId}
                    voiceSettings={{
                      stability: formData.voiceStability,
                      similarity_boost: formData.voiceSimilarityBoost,
                      speed: formData.voiceSpeed,
                    }}
                    previewText={formData.firstMessage || undefined}
                    language={formData.language || undefined}
                  />
                </div>
              </div>
            )}
          </div>
        );

      case "review":
        return (
          <div className="space-y-6">
            <div className="text-center mb-6">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/20 mb-4">
                <CheckCircle2 className="h-6 w-6 text-emerald-500" />
              </div>
              <h3 className="text-lg font-semibold">Review Your Agent</h3>
              <p className="text-sm text-muted-foreground">
                Everything looks good! Review and create your agent.
              </p>
            </div>

            <div className="space-y-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-xs text-muted-foreground">Use Case</Label>
                      <p className="font-medium">{selectedUseCase?.title || "Custom"}</p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Name</Label>
                      <p className="font-medium">{formData.name}</p>
                    </div>
                    {hasAlternateEngines && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Telephony Provider</Label>
                        <p className="font-medium">
                          {formData.telephonyProvider === "plivo" 
                            ? "OpenAI + Plivo" 
                            : formData.telephonyProvider === "twilio_openai"
                              ? "OpenAI + Twilio"
                              : "ElevenLabs + Twilio"}
                        </p>
                      </div>
                    )}
                    <div>
                      <Label className="text-xs text-muted-foreground">Voice</Label>
                      <p className="font-medium">
                        {(formData.telephonyProvider === "plivo" || formData.telephonyProvider === "twilio_openai")
                          ? openaiVoices.find(v => v.value === formData.openaiVoice)?.label || formData.openaiVoice
                          : formData.elevenLabsVoiceId || "Not selected"
                        }
                      </p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Language</Label>
                      <p className="font-medium">{t(`agents.languages.${formData.language}`, { defaultValue: getLanguageLabel(formData.language) })}</p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Voice Tone</Label>
                      <p className="font-medium capitalize">{formData.voiceTone}</p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Personality</Label>
                      <p className="font-medium capitalize">{formData.personality}</p>
                    </div>
                    {formData.telephonyProvider === "twilio" && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Voice Speed</Label>
                        <p className="font-medium">{formData.voiceSpeed.toFixed(2)}x</p>
                      </div>
                    )}
                  </div>

                  <Separator className="my-4" />

                  <div className="space-y-3">
                    <div>
                      <Label className="text-xs text-muted-foreground">System Prompt</Label>
                      <p className="text-sm mt-1 line-clamp-3">{formData.systemPrompt}</p>
                    </div>
                    {formData.firstMessage && (
                      <div>
                        <Label className="text-xs text-muted-foreground">First Message</Label>
                        <p className="text-sm mt-1">{formData.firstMessage}</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) {
        resetWizard();
      }
      onOpenChange(isOpen);
    }}>
      <DialogContent className="max-w-3xl max-h-[90vh] p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="flex items-center gap-2">
                <Wand2 className="h-5 w-5 text-primary" />
                Create AI Agent
              </DialogTitle>
              <DialogDescription>
                Step {currentStepIndex + 1} of {steps.length}: {steps[currentStepIndex].title}
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              {steps.map((step, index) => (
                <div
                  key={step.id}
                  className={`h-2 w-2 rounded-full transition-colors ${
                    index < currentStepIndex
                      ? "bg-emerald-500"
                      : index === currentStepIndex
                      ? "bg-primary"
                      : "bg-muted"
                  }`}
                />
              ))}
            </div>
          </div>
          <Progress value={progress} className="h-1 mt-4" />
        </DialogHeader>

        <ScrollArea className="flex-1 max-h-[55vh]">
          <div className="p-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentStep}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
              >
                {renderStep()}
              </motion.div>
            </AnimatePresence>
          </div>
        </ScrollArea>

        <div className="flex items-center justify-between px-6 py-4 border-t bg-muted/30">
          <Button
            variant="ghost"
            onClick={goBack}
            disabled={currentStepIndex === 0}
            data-testid="button-wizard-back"
          >
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back
          </Button>

          {currentStep === "review" ? (
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
              className="min-w-[140px]"
              data-testid="button-wizard-create"
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4 mr-2" />
                  Create Agent
                </>
              )}
            </Button>
          ) : (
            <div className="flex flex-col items-end gap-1">
              <Button
                onClick={goNext}
                disabled={!canProceed}
                data-testid="button-wizard-next"
              >
                Continue
                <ChevronRight className="h-4 w-4 ml-2" />
              </Button>
              {validationHint && (
                <p className="text-xs text-muted-foreground" data-testid="text-wizard-hint">
                  {validationHint}
                </p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default AgentCreationWizard;
