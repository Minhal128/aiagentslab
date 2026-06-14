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
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Upload, Loader2, Clock, Calendar, CheckCircle2, Target, RotateCcw } from "lucide-react";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { AuthStorage } from "@/lib/auth-storage";
import { TimezoneEnforcementModal } from "@/components/TimezoneEnforcementModal";
import { PhoneConflictDialog, PhoneConflictState, initialPhoneConflictState } from "./PhoneConflictDialog";
import { usePluginStatus } from "@/hooks/use-plugin-status";

interface Agent {
  id: string;
  name: string;
  personality: string;
  type: 'incoming' | 'natural' | 'flow';
  telephonyProvider: 'twilio' | 'plivo' | 'plivo_openai' | 'twilio_openai' | 'elevenlabs-sip' | 'openai-sip' | null;
  sipPhoneNumberId?: string | null;
}

const getEngineLabel = (provider: string | null): string => {
  switch (provider) {
    case 'plivo': 
    case 'plivo_openai': return 'Plivo+OpenAI';
    case 'twilio_openai': return 'Twilio+OpenAI';
    case 'elevenlabs-sip': return 'ElevenLabs SIP';
    case 'openai-sip': return 'OpenAI SIP';
    default: return 'Twilio+ElevenLabs';
  }
};


interface PhoneNumber {
  id: string;
  phoneNumber: string;
  friendlyName?: string;
}

interface SipPhoneNumber {
  id: string;
  phoneNumber: string;
  label?: string;
  trunkId: string;
  engine: string;
}

interface PlivoPhoneNumber {
  id: string;
  phoneNumber: string;
  friendlyName?: string;
}

interface UserData {
  id: number;
  email: string;
  name: string;
  timezone?: string | null;
}

interface CreateCampaignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}


export function CreateCampaignDialog({ open, onOpenChange }: CreateCampaignDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { isSipPluginEnabled } = usePluginStatus();
  const [animationState, setAnimationState] = useState<'idle' | 'success' | 'error'>('idle');
  const [formData, setFormData] = useState({
    name: "",
    type: "Lead Qualification",
    goal: "",
    script: "",
    flowId: "",
    agentId: "",
    phoneNumberId: "",
    sipPhoneNumberId: "",
    plivoPhoneNumberId: "",
    transferNumber: "",
    transferKeywords: [] as string[],
    scheduleEnabled: false,
    scheduleTimeStart: "09:00",
    scheduleTimeEnd: "17:00",
    scheduleDays: [] as string[],
    scheduleTimezone: "America/New_York",
    retryEnabled: false,
    retryMaxAttempts: 3,
    retryIntervalMinutes: 60,
    retryOnNoAnswer: true,
    retryOnBusy: false,
    retryOnFailed: false,
  });
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [step, setStep] = useState(1);
  const [conflictDialog, setConflictDialog] = useState<PhoneConflictState>(initialPhoneConflictState);
  const [showTimezoneModal, setShowTimezoneModal] = useState(false);

  const { data: userData } = useQuery<UserData>({
    queryKey: ["/api/auth/me"],
    enabled: open,
  });

  useEffect(() => {
    if (open && userData) {
      if (!userData.timezone) {
        setShowTimezoneModal(true);
      } else {
        setFormData(prev => ({ ...prev, scheduleTimezone: userData.timezone! }));
      }
    }
  }, [open, userData]);

  const handleTimezoneSet = () => {
    setShowTimezoneModal(false);
    queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
  };

  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ["/api/agents"],
    enabled: open,
  });


  const { data: phoneNumbers = [] } = useQuery<PhoneNumber[]>({
    queryKey: ["/api/phone-numbers"],
    enabled: open,
  });

  const { data: sipPhoneNumbersResponse } = useQuery<{ success: boolean; data: SipPhoneNumber[] }>({
    queryKey: ["/api/sip/phone-numbers"],
    enabled: open && isSipPluginEnabled,
  });

  const sipPhoneNumbers = sipPhoneNumbersResponse?.data || [];

  const { data: plivoPhoneNumbers = [] } = useQuery<PlivoPhoneNumber[]>({
    queryKey: ["/api/plivo/phone-numbers"],
    enabled: open,
  });

  const selectedAgent = agents.find(a => a.id === formData.agentId);
  const isElevenLabsSipAgent = selectedAgent?.telephonyProvider === 'elevenlabs-sip';
  const isSipAgent = selectedAgent?.telephonyProvider === 'elevenlabs-sip' || selectedAgent?.telephonyProvider === 'openai-sip';
  const isPlivoAgent = selectedAgent?.telephonyProvider === 'plivo' || selectedAgent?.telephonyProvider === 'plivo_openai';
  const isTwilioAgent = !selectedAgent?.telephonyProvider || selectedAgent?.telephonyProvider === 'twilio' || selectedAgent?.telephonyProvider === 'twilio_openai';

  const { data: flows = [] } = useQuery<Array<{ id: string; name: string; description?: string }>>({
    queryKey: ["/api/flow-automation/flows"],
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = { ...formData };
      if (payload.flowId) {
        payload.script = "";
      }
      const res = await apiRequest("POST", "/api/campaigns", payload);
      return res.json();
    },
    onSuccess: async (campaign) => {
      if (csvFile) {
        const formDataUpload = new FormData();
        formDataUpload.append("file", csvFile);

        try {
          const uploadHeaders: Record<string, string> = {};
          const authHeader = AuthStorage.getAuthHeader();
          if (authHeader) {
            uploadHeaders["Authorization"] = authHeader;
          }
          
          const res = await fetch(`/api/campaigns/${campaign.id}/contacts/upload`, {
            method: "POST",
            headers: uploadHeaders,
            body: formDataUpload,
          });

          if (!res.ok) {
            throw new Error("Failed to upload CSV contacts");
          }
        } catch (error) {
          toast({
            title: t("campaigns.toast.csvUploadFailed"),
            description: t("campaigns.toast.csvUploadFailedDesc"),
            variant: "destructive",
          });
        }
      }

      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      setAnimationState('success');
      toast({ title: t("campaigns.toast.createdSuccess") });
      setTimeout(() => {
        setAnimationState('idle');
        handleClose();
      }, 1500);
    },
    onError: (error: any) => {
      setAnimationState('error');
      setTimeout(() => setAnimationState('idle'), 600);
      
      // Check for phone conflict (409)
      if (error.status === 409 || error.conflictType) {
        setConflictDialog({
          isOpen: true,
          title: error.error || "Phone Number Conflict",
          message: error.message || error.error || "This phone number has a conflict.",
          conflictType: error.conflictType,
          connectedAgentName: error.connectedAgentName,
          campaignName: error.campaignName,
        });
        return;
      }
      
      toast({
        title: t("campaigns.toast.createFailed"),
        description: error.message || t("common.tryAgain"),
        variant: "destructive",
      });
    },
  });

  const resetFormState = () => {
    setFormData({
      name: "",
      type: "Lead Qualification",
      goal: "",
      script: "",
      flowId: "",
      agentId: "",
      phoneNumberId: "",
      sipPhoneNumberId: "",
      plivoPhoneNumberId: "",
      transferNumber: "",
      transferKeywords: [],
      scheduleEnabled: false,
      scheduleTimeStart: "09:00",
      scheduleTimeEnd: "17:00",
      scheduleDays: [],
      scheduleTimezone: "America/New_York",
      retryEnabled: false,
      retryMaxAttempts: 3,
      retryIntervalMinutes: 60,
      retryOnNoAnswer: true,
      retryOnBusy: false,
      retryOnFailed: false,
    });
    setCsvFile(null);
    setStep(1);
    setAnimationState('idle');
  };

  const handleClose = () => {
    resetFormState();
    onOpenChange(false);
  };

  const handleNext = () => {
    if (step === 1 && !formData.name) {
      toast({ title: t("campaigns.toast.pleaseEnterName"), variant: "destructive" });
      return;
    }
    if (step === 2) {
      if (!formData.agentId) {
        toast({ title: t("campaigns.toast.pleaseSelectAgent"), variant: "destructive" });
        return;
      }
      if (isElevenLabsSipAgent) {
        if (!isSipPluginEnabled) {
          toast({ title: "SIP Plugin is disabled. Please select a different agent or contact your administrator.", variant: "destructive" });
          return;
        }
        if (!formData.sipPhoneNumberId) {
          toast({ title: t("campaigns.toast.pleaseSelectPhone"), variant: "destructive" });
          return;
        }
      } else if (isPlivoAgent) {
        if (!formData.plivoPhoneNumberId) {
          toast({ title: t("campaigns.toast.pleaseSelectPhone"), variant: "destructive" });
          return;
        }
      } else {
        if (!formData.phoneNumberId) {
          toast({ title: t("campaigns.toast.pleaseSelectPhone"), variant: "destructive" });
          return;
        }
      }
    }
    setStep(step + 1);
  };

  const handleSubmit = () => {
    if (!formData.agentId) {
      toast({ title: t("campaigns.toast.pleaseSelectAgent"), variant: "destructive" });
      return;
    }
    createMutation.mutate();
  };

  const handleOpenChange = (isOpen: boolean) => {
    onOpenChange(isOpen);
    if (!isOpen) {
      resetFormState();
    }
  };

  const dayKeys = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

  return (
    <>
      <TimezoneEnforcementModal
        open={showTimezoneModal}
        onOpenChange={(isOpen) => {
          setShowTimezoneModal(isOpen);
          if (!isOpen && !userData?.timezone) {
            onOpenChange(false);
          }
        }}
        onSuccess={handleTimezoneSet}
      />
      <Dialog open={open && !showTimezoneModal} onOpenChange={handleOpenChange}>
        <DialogContent className={`max-w-2xl flex flex-col max-h-[85vh] p-0 gap-0 overflow-hidden ${animationState === 'error' ? 'animate-shake' : ''}`}>
        {animationState === 'success' && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/90 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-4 animate-in zoom-in-50 fade-in duration-300">
              <div className="h-20 w-20 rounded-full bg-gradient-to-br from-orange-400 to-amber-500 flex items-center justify-center shadow-lg shadow-orange-500/30">
                <CheckCircle2 className="h-10 w-10 text-white animate-in zoom-in-75 duration-300 delay-150" />
              </div>
              <div className="text-center">
                <p className="text-lg font-semibold text-foreground">{t("campaigns.create.successTitle")}</p>
                <p className="text-sm text-muted-foreground">{t("campaigns.create.successSubtitle")}</p>
              </div>
            </div>
          </div>
        )}
        
        <DialogHeader className="px-6 pt-6 pb-4 border-b flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center shadow-md">
              <Target className="h-5 w-5 text-white" />
            </div>
            <div>
              <DialogTitle>{t("campaigns.create.title")}</DialogTitle>
              <DialogDescription>{t("campaigns.create.subtitle")}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6">
        <div className="flex items-center justify-center gap-2 py-4">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
                  step >= s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}
              >
                {s}
              </div>
              {s < 3 && <div className={`h-0.5 w-12 ${step > s ? "bg-primary" : "bg-muted"}`} />}
            </div>
          ))}
        </div>

        <div className="space-y-6 py-4">
          {step === 1 && (
            <div className="space-y-4">
              <h3 className="font-semibold text-lg">{t("campaigns.create.step1Title")}</h3>
              <div className="space-y-2">
                <Label htmlFor="campaign-name">{t("campaigns.create.nameRequired")}</Label>
                <Input
                  id="campaign-name"
                  placeholder={t("campaigns.create.namePlaceholder")}
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  data-testid="input-campaign-name"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center">
                  <Label htmlFor="campaign-type">{t("campaigns.create.typeRequired")}</Label>
                  <InfoTooltip content={t("campaigns.create.typeTooltip")} />
                </div>
                <Select value={formData.type} onValueChange={(value) => setFormData({ ...formData, type: value })}>
                  <SelectTrigger data-testid="select-campaign-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Lead Qualification">{t("campaigns.create.typeOptions.lead")}</SelectItem>
                    <SelectItem value="Feedback Collection">{t("campaigns.create.typeOptions.feedback")}</SelectItem>
                    <SelectItem value="Promotional">{t("campaigns.create.typeOptions.promotional")}</SelectItem>
                    <SelectItem value="Payment Reminder">{t("campaigns.create.typeOptions.payment")}</SelectItem>
                    <SelectItem value="Event Promotion">{t("campaigns.create.typeOptions.event")}</SelectItem>
                    <SelectItem value="Survey">{t("campaigns.create.typeOptions.survey")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <div className="flex items-center">
                  <Label htmlFor="campaign-goal">{t("campaigns.create.goalOptional")}</Label>
                  <InfoTooltip content={t("campaigns.create.goalTooltip")} />
                </div>
                <Textarea
                  id="campaign-goal"
                  placeholder={t("campaigns.create.goalPlaceholder")}
                  value={formData.goal}
                  onChange={(e) => setFormData({ ...formData, goal: e.target.value })}
                  rows={3}
                  data-testid="input-campaign-goal"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h3 className="font-semibold text-lg">{t("campaigns.create.step2Title")}</h3>
              
              <div className="space-y-2">
                <Label htmlFor="agent-select">{t("campaigns.create.selectAgentRequired")}</Label>
                <Select value={formData.agentId} onValueChange={(value) => setFormData({ ...formData, agentId: value })}>
                  <SelectTrigger data-testid="select-agent">
                    <SelectValue placeholder={agents.filter(a => a.type !== 'incoming').length === 0 ? t("campaigns.create.noAgentsAvailable") : t("campaigns.create.agentPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {agents
                      .filter(agent => agent.type !== 'incoming')
                      .filter(agent => {
                        // Always exclude OpenAI SIP agents - they don't support outbound calls
                        if (agent.telephonyProvider === 'openai-sip') {
                          return false;
                        }
                        // Filter out ElevenLabs SIP agents when SIP plugin is disabled
                        if (agent.telephonyProvider === 'elevenlabs-sip' && !isSipPluginEnabled) {
                          return false;
                        }
                        return true;
                      })
                      .map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>
                          {agent.name} - {agent.personality} ({agent.type === 'flow' ? t("agents.type.flow") : t("agents.type.natural")}) [{getEngineLabel(agent.telephonyProvider)}]
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {agents.filter(a => a.type !== 'incoming').length === 0 && (
                  <p className="text-sm text-muted-foreground">{t("campaigns.create.goToAgentsPage")}</p>
                )}
                {agents.filter(a => a.type !== 'incoming').length > 0 && 
                 agents.filter(a => a.type !== 'incoming').filter(a => {
                   // Same filter logic as dropdown
                   if (a.telephonyProvider === 'openai-sip') return false;
                   if (a.telephonyProvider === 'elevenlabs-sip' && !isSipPluginEnabled) return false;
                   return true;
                 }).length === 0 && (
                  <p className="text-sm text-muted-foreground">All your agents use SIP telephony, but the SIP Engine plugin is disabled. Contact your administrator or create a Twilio/Plivo agent.</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone-select">{t("campaigns.create.phoneNumberRequired")}</Label>
                {isElevenLabsSipAgent && !isSipPluginEnabled ? (
                  <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20">
                    <p className="text-sm text-destructive font-medium">SIP Plugin is disabled</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      The selected agent uses SIP telephony, but the SIP Engine plugin is currently disabled. 
                      Please contact your administrator to enable the SIP Engine plugin, or select a different agent.
                    </p>
                  </div>
                ) : isElevenLabsSipAgent && isSipPluginEnabled ? (
                  <>
                    <Select value={formData.sipPhoneNumberId} onValueChange={(value) => setFormData({ ...formData, sipPhoneNumberId: value })}>
                      <SelectTrigger data-testid="select-phone">
                        <SelectValue placeholder={sipPhoneNumbers.filter(p => p.engine === 'elevenlabs-sip').length === 0 ? "No ElevenLabs SIP phone numbers available" : "Select an ElevenLabs SIP phone number"} />
                      </SelectTrigger>
                      <SelectContent>
                        {sipPhoneNumbers
                          .filter(phone => phone.engine === 'elevenlabs-sip')
                          .map((phone) => (
                          <SelectItem key={phone.id} value={phone.id}>
                            {phone.label || phone.phoneNumber}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {sipPhoneNumbers.filter(p => p.engine === 'elevenlabs-sip').length === 0 && (
                      <p className="text-sm text-muted-foreground">No ElevenLabs SIP phone numbers available. Import a phone number with an ElevenLabs SIP trunk first.</p>
                    )}
                  </>
                ) : isPlivoAgent ? (
                  <>
                    <Select value={formData.plivoPhoneNumberId} onValueChange={(value) => setFormData({ ...formData, plivoPhoneNumberId: value })}>
                      <SelectTrigger data-testid="select-phone">
                        <SelectValue placeholder={plivoPhoneNumbers.length === 0 ? "No Plivo phone numbers available" : "Select a Plivo phone number"} />
                      </SelectTrigger>
                      <SelectContent>
                        {plivoPhoneNumbers.map((phone) => (
                          <SelectItem key={phone.id} value={phone.id}>
                            {phone.friendlyName || phone.phoneNumber}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {plivoPhoneNumbers.length === 0 && (
                      <p className="text-sm text-muted-foreground">No Plivo phone numbers available. Purchase a Plivo phone number first.</p>
                    )}
                  </>
                ) : (
                  <>
                    <Select value={formData.phoneNumberId} onValueChange={(value) => setFormData({ ...formData, phoneNumberId: value })}>
                      <SelectTrigger data-testid="select-phone">
                        <SelectValue placeholder={phoneNumbers.length === 0 ? t("campaigns.create.noPhoneNumbers") : t("campaigns.create.phoneNumberPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        {phoneNumbers.map((phone) => (
                          <SelectItem key={phone.id} value={phone.id}>
                            {phone.friendlyName || phone.phoneNumber}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {phoneNumbers.length === 0 && (
                      <p className="text-sm text-muted-foreground">{t("campaigns.create.goToPhoneNumbers")}</p>
                    )}
                  </>
                )}
              </div>

              {/* Hide flow and script options for flow agents - they already have flow and prompt attached */}
              {selectedAgent?.type !== 'flow' && (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center">
                      <Label htmlFor="flow-select">{t("campaigns.create.visualFlowOptional")}</Label>
                      <InfoTooltip content={t("campaigns.create.flowTooltip")} />
                    </div>
                    <Select 
                      value={formData.flowId} 
                      onValueChange={(value) => setFormData({ ...formData, flowId: value === "none" ? "" : value, script: value === "none" ? formData.script : "" })}
                    >
                      <SelectTrigger data-testid="select-flow">
                        <SelectValue placeholder={flows.length === 0 ? t("campaigns.create.noFlowsAvailable") : t("campaigns.create.flowPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t("campaigns.create.noneUseAgentScript")}</SelectItem>
                        {flows.map((flow) => (
                          <SelectItem key={flow.id} value={flow.id}>
                            {flow.name}
                            {flow.description && ` - ${flow.description}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {flows.length === 0 && (
                      <p className="text-sm text-muted-foreground">{t("campaigns.create.goToFlowBuilder")}</p>
                    )}
                  </div>

                  {!formData.flowId && (
                    <div className="space-y-2">
                      <div className="flex items-center">
                        <Label htmlFor="campaign-script">{t("campaigns.create.customScriptOptional")}</Label>
                        <InfoTooltip content={t("campaigns.create.scriptTooltip")} />
                      </div>
                      <Textarea
                        id="campaign-script"
                        placeholder={t("campaigns.create.scriptPlaceholder")}
                        value={formData.script}
                        onChange={(e) => setFormData({ ...formData, script: e.target.value })}
                        rows={4}
                        data-testid="input-campaign-script"
                      />
                    </div>
                  )}
                </>
              )}

              <div className="space-y-4 border-t pt-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="h-5 w-5" />
                    <Label className="text-base">{t("campaigns.schedule.titleOptional")}</Label>
                    <InfoTooltip content={t("campaigns.schedule.tooltip")} />
                  </div>
                  <Switch
                    checked={formData.scheduleEnabled}
                    onCheckedChange={(checked) => setFormData({ ...formData, scheduleEnabled: checked })}
                    data-testid="switch-schedule-enabled"
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  {t("campaigns.schedule.description")}
                </p>

                {formData.scheduleEnabled && (
                  <div className="space-y-4 pl-7">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <div className="flex items-center">
                          <Label htmlFor="schedule-time-start">{t("campaigns.schedule.startTime")}</Label>
                          <InfoTooltip content={t("campaigns.schedule.startTimeTooltip")} />
                        </div>
                        <Input
                          id="schedule-time-start"
                          type="time"
                          value={formData.scheduleTimeStart}
                          onChange={(e) => setFormData({ ...formData, scheduleTimeStart: e.target.value })}
                          data-testid="input-schedule-time-start"
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center">
                          <Label htmlFor="schedule-time-end">{t("campaigns.schedule.endTime")}</Label>
                          <InfoTooltip content={t("campaigns.schedule.endTimeTooltip")} />
                        </div>
                        <Input
                          id="schedule-time-end"
                          type="time"
                          value={formData.scheduleTimeEnd}
                          onChange={(e) => setFormData({ ...formData, scheduleTimeEnd: e.target.value })}
                          data-testid="input-schedule-time-end"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center">
                        <Label>{t("campaigns.schedule.daysOfWeek")}</Label>
                        <InfoTooltip content={t("campaigns.schedule.daysTooltip")} />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {dayKeys.map((day) => (
                          <div key={day} className="flex items-center gap-2">
                            <Checkbox
                              id={`day-${day}`}
                              checked={formData.scheduleDays.includes(day)}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setFormData({ ...formData, scheduleDays: [...formData.scheduleDays, day] });
                                } else {
                                  setFormData({ ...formData, scheduleDays: formData.scheduleDays.filter(d => d !== day) });
                                }
                              }}
                              data-testid={`checkbox-day-${day}`}
                            />
                            <Label htmlFor={`day-${day}`} className="text-sm font-normal cursor-pointer">
                              {t(`campaigns.schedule.days.${day}`)}
                            </Label>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center">
                        <Label htmlFor="schedule-timezone">{t("campaigns.schedule.timezone")}</Label>
                        <InfoTooltip content={t("campaigns.schedule.timezoneTooltip")} />
                      </div>
                      <Select 
                        value={formData.scheduleTimezone} 
                        onValueChange={(value) => setFormData({ ...formData, scheduleTimezone: value })}
                      >
                        <SelectTrigger data-testid="select-schedule-timezone">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {/* Universal */}
                          <SelectItem value="UTC">UTC (Coordinated Universal Time)</SelectItem>
                          {/* Americas */}
                          <SelectItem value="America/New_York">Eastern Time (US & Canada)</SelectItem>
                          <SelectItem value="America/Chicago">Central Time (US & Canada)</SelectItem>
                          <SelectItem value="America/Denver">Mountain Time (US & Canada)</SelectItem>
                          <SelectItem value="America/Los_Angeles">Pacific Time (US & Canada)</SelectItem>
                          <SelectItem value="America/Anchorage">Alaska</SelectItem>
                          <SelectItem value="America/Toronto">Toronto</SelectItem>
                          <SelectItem value="America/Vancouver">Vancouver</SelectItem>
                          <SelectItem value="America/Mexico_City">Mexico City</SelectItem>
                          <SelectItem value="America/Sao_Paulo">São Paulo</SelectItem>
                          <SelectItem value="America/Buenos_Aires">Buenos Aires</SelectItem>
                          <SelectItem value="America/Lima">Lima</SelectItem>
                          <SelectItem value="America/Bogota">Bogota</SelectItem>
                          {/* Europe */}
                          <SelectItem value="Europe/London">London</SelectItem>
                          <SelectItem value="Europe/Paris">Paris</SelectItem>
                          <SelectItem value="Europe/Berlin">Berlin</SelectItem>
                          <SelectItem value="Europe/Madrid">Madrid</SelectItem>
                          <SelectItem value="Europe/Rome">Rome</SelectItem>
                          <SelectItem value="Europe/Amsterdam">Amsterdam</SelectItem>
                          <SelectItem value="Europe/Brussels">Brussels</SelectItem>
                          <SelectItem value="Europe/Zurich">Zurich</SelectItem>
                          <SelectItem value="Europe/Moscow">Moscow</SelectItem>
                          <SelectItem value="Europe/Istanbul">Istanbul</SelectItem>
                          {/* Asia */}
                          <SelectItem value="Asia/Dubai">Dubai</SelectItem>
                          <SelectItem value="Asia/Kolkata">Mumbai/New Delhi</SelectItem>
                          <SelectItem value="Asia/Singapore">Singapore</SelectItem>
                          <SelectItem value="Asia/Hong_Kong">Hong Kong</SelectItem>
                          <SelectItem value="Asia/Shanghai">Shanghai</SelectItem>
                          <SelectItem value="Asia/Tokyo">Tokyo</SelectItem>
                          <SelectItem value="Asia/Seoul">Seoul</SelectItem>
                          <SelectItem value="Asia/Jakarta">Jakarta</SelectItem>
                          <SelectItem value="Asia/Manila">Manila</SelectItem>
                          {/* Africa */}
                          <SelectItem value="Africa/Cairo">Cairo</SelectItem>
                          <SelectItem value="Africa/Lagos">Lagos</SelectItem>
                          <SelectItem value="Africa/Johannesburg">Johannesburg</SelectItem>
                          <SelectItem value="Africa/Nairobi">Nairobi</SelectItem>
                          {/* Oceania */}
                          <SelectItem value="Australia/Sydney">Sydney</SelectItem>
                          <SelectItem value="Australia/Melbourne">Melbourne</SelectItem>
                          <SelectItem value="Australia/Perth">Perth</SelectItem>
                          <SelectItem value="Pacific/Auckland">Auckland</SelectItem>
                          <SelectItem value="Pacific/Honolulu">Hawaii</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </div>

              {/* Retry Settings */}
              <div className="space-y-4 border-t pt-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <RotateCcw className="h-5 w-5" />
                    <Label className="text-base">Auto-Retry Missed Calls</Label>
                    <InfoTooltip content="Automatically re-call contacts who didn't answer, were busy, or failed. Each contact is called up to the maximum attempt limit." />
                  </div>
                  <Switch
                    checked={formData.retryEnabled}
                    onCheckedChange={(checked) => setFormData({ ...formData, retryEnabled: checked })}
                    data-testid="switch-retry-enabled"
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  Contacts that don't answer will be automatically retried at a set interval.
                </p>

                {formData.retryEnabled && (
                  <div className="space-y-4 pl-7">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="retry-max-attempts">Max Attempts</Label>
                        <Select
                          value={String(formData.retryMaxAttempts)}
                          onValueChange={(v) => setFormData({ ...formData, retryMaxAttempts: parseInt(v) })}
                        >
                          <SelectTrigger id="retry-max-attempts" data-testid="select-retry-max-attempts">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[1, 2, 3, 4, 5].map((n) => (
                              <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">Total calls per contact (including first)</p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="retry-interval">Retry Interval</Label>
                        <Select
                          value={String(formData.retryIntervalMinutes)}
                          onValueChange={(v) => setFormData({ ...formData, retryIntervalMinutes: parseInt(v) })}
                        >
                          <SelectTrigger id="retry-interval" data-testid="select-retry-interval">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="15">15 minutes</SelectItem>
                            <SelectItem value="30">30 minutes</SelectItem>
                            <SelectItem value="60">1 hour</SelectItem>
                            <SelectItem value="120">2 hours</SelectItem>
                            <SelectItem value="240">4 hours</SelectItem>
                            <SelectItem value="480">8 hours</SelectItem>
                            <SelectItem value="1440">24 hours</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">Wait time between retry attempts</p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Retry When</Label>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="retry-no-answer"
                            checked={formData.retryOnNoAnswer}
                            onCheckedChange={(checked) => setFormData({ ...formData, retryOnNoAnswer: !!checked })}
                            data-testid="checkbox-retry-no-answer"
                          />
                          <Label htmlFor="retry-no-answer" className="text-sm font-normal cursor-pointer">
                            No Answer
                          </Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="retry-busy"
                            checked={formData.retryOnBusy}
                            onCheckedChange={(checked) => setFormData({ ...formData, retryOnBusy: !!checked })}
                            data-testid="checkbox-retry-busy"
                          />
                          <Label htmlFor="retry-busy" className="text-sm font-normal cursor-pointer">
                            Busy
                          </Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="retry-failed"
                            checked={formData.retryOnFailed}
                            onCheckedChange={(checked) => setFormData({ ...formData, retryOnFailed: !!checked })}
                            data-testid="checkbox-retry-failed"
                          />
                          <Label htmlFor="retry-failed" className="text-sm font-normal cursor-pointer">
                            Call Failed
                          </Label>
                        </div>
                      </div>
                    </div>

                    {/* Plain-language summary */}
                    {formData.retryMaxAttempts > 1 && (
                      <div className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground" data-testid="text-retry-summary">
                        {`The system will call each contact up to ${formData.retryMaxAttempts} time${formData.retryMaxAttempts > 1 ? 's' : ''} total, waiting ${
                          formData.retryIntervalMinutes >= 1440 ? '24 hours' :
                          formData.retryIntervalMinutes >= 480 ? '8 hours' :
                          formData.retryIntervalMinutes >= 240 ? '4 hours' :
                          formData.retryIntervalMinutes >= 120 ? '2 hours' :
                          formData.retryIntervalMinutes >= 60 ? '1 hour' :
                          formData.retryIntervalMinutes >= 30 ? '30 minutes' : '15 minutes'
                        } between attempts.`}
                      </div>
                    )}
                  </div>
                )}
              </div>

            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h3 className="font-semibold text-lg">{t("campaigns.create.step3Title")}</h3>
              
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="contacts-csv">{t("campaigns.create.uploadCSV")}</Label>
                  <div className="border-2 border-dashed rounded-md p-8 text-center hover-elevate">
                    <input
                      id="contacts-csv"
                      type="file"
                      accept=".csv"
                      onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                      className="hidden"
                      data-testid="input-csv-file"
                    />
                    <label htmlFor="contacts-csv" className="cursor-pointer">
                      <Upload className="h-10 w-10 mx-auto mb-2 text-muted-foreground" />
                      {csvFile ? (
                        <p className="text-sm font-medium">{csvFile.name}</p>
                      ) : (
                        <>
                          <p className="text-sm font-medium">{t("campaigns.create.clickToUpload")}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {t("campaigns.create.csvRequiredOptional")}
                          </p>
                        </>
                      )}
                    </label>
                  </div>
                </div>

                <div className="bg-muted p-4 rounded-md">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium">{t("campaigns.create.csvFormatExample")}</p>
                    <a 
                      href="/campaign_template.csv"
                      download="campaign_template.csv"
                      className="text-xs text-primary hover:underline"
                      data-testid="link-download-sample-csv"
                    >
                      {t("campaigns.create.downloadTemplate")}
                    </a>
                  </div>
                  <code className="text-xs block bg-background p-2 rounded">
                    phone_number,first_name,last_name,contact_name,email,city,company,language<br />
                    +12345678900,John,Smith,John Smith,john@example.com,London,Acme Inc,en<br />
                    +48517067931,Anna,Kowalska,Anna Kowalska,anna@example.pl,Warsaw,Tech Corp,pl
                  </code>
                  <p className="text-xs text-muted-foreground mt-2">
                    {t("campaigns.create.customColumnsInfo")}
                  </p>
                </div>
              </div>

              <p className="text-sm text-muted-foreground">
                {t("campaigns.create.skipContactsInfo")}
              </p>
            </div>
          )}
        </div>
        </div>

        <div className="flex justify-between gap-2 px-6 py-4 border-t flex-shrink-0">
          <Button variant="outline" onClick={handleClose}>
            {t("common.cancel")}
          </Button>
          <div className="flex gap-2">
            {step > 1 && (
              <Button variant="outline" onClick={() => setStep(step - 1)}>
                {t("common.back")}
              </Button>
            )}
            {step < 3 ? (
              <Button onClick={handleNext} data-testid="button-next-step">
                {t("common.next")}
              </Button>
            ) : (
              <Button
                onClick={handleSubmit}
                disabled={createMutation.isPending || !formData.agentId || (isElevenLabsSipAgent ? (!isSipPluginEnabled || !formData.sipPhoneNumberId) : isPlivoAgent ? !formData.plivoPhoneNumberId : !formData.phoneNumberId)}
                data-testid="button-create-campaign"
              >
                {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {t("campaigns.actions.createCampaign")}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
      </Dialog>

      <PhoneConflictDialog
        open={conflictDialog.isOpen}
        onClose={() => setConflictDialog(initialPhoneConflictState)}
        title={conflictDialog.title}
        message={conflictDialog.message}
        conflictType={conflictDialog.conflictType}
        connectedAgentName={conflictDialog.connectedAgentName}
        campaignName={conflictDialog.campaignName}
      />
    </>
  );
}
