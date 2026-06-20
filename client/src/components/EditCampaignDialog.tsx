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
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { Upload, ChevronDown, ChevronUp, Clock, Calendar, Pencil, RotateCcw } from "lucide-react";
import { AuthStorage } from "@/lib/auth-storage";

interface Agent {
  id: string;
  name: string;
  personality: string;
  type: 'incoming' | 'natural' | 'flow';
  telephonyProvider: 'twilio' | 'plivo' | 'plivo_openai' | 'twilio_openai' | 'elevenlabs-sip' | 'openai-sip' | null;
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

interface Campaign {
  id: string;
  name: string;
  type: string;
  goal?: string;
  script?: string;
  agentId: string;
  phoneNumberId: string;
  plivoPhoneNumberId?: string;
  sipPhoneNumberId?: string;
  scheduleEnabled?: boolean;
  scheduleTimeStart?: string;
  scheduleTimeEnd?: string;
  scheduleDays?: string[];
  scheduleTimezone?: string;
  retryEnabled?: boolean;
  retryMaxAttempts?: number;
  retryIntervalMinutes?: number;
  retryOnNoAnswer?: boolean;
  retryOnBusy?: boolean;
  retryOnFailed?: boolean;
}

interface EditCampaignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign: Campaign | null;
}

export function EditCampaignDialog({ open, onOpenChange, campaign }: EditCampaignDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [showContactsSection, setShowContactsSection] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    type: "Lead Qualification",
    goal: "",
    script: "",
    agentId: "",
    phoneNumberId: "",
    plivoPhoneNumberId: "",
    sipPhoneNumberId: "",
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

  useEffect(() => {
    if (campaign) {
      setFormData({
        name: campaign.name || "",
        type: campaign.type || "Lead Qualification",
        goal: campaign.goal || "",
        script: campaign.script || "",
        agentId: campaign.agentId || "",
        phoneNumberId: campaign.phoneNumberId || "",
        plivoPhoneNumberId: campaign.plivoPhoneNumberId || "",
        sipPhoneNumberId: campaign.sipPhoneNumberId || "",
        scheduleEnabled: campaign.scheduleEnabled || false,
        scheduleTimeStart: campaign.scheduleTimeStart || "09:00",
        scheduleTimeEnd: campaign.scheduleTimeEnd || "17:00",
        scheduleDays: campaign.scheduleDays || [],
        scheduleTimezone: campaign.scheduleTimezone || "America/New_York",
        retryEnabled: campaign.retryEnabled || false,
        retryMaxAttempts: campaign.retryMaxAttempts ?? 3,
        retryIntervalMinutes: campaign.retryIntervalMinutes ?? 60,
        retryOnNoAnswer: campaign.retryOnNoAnswer !== false,
        retryOnBusy: campaign.retryOnBusy || false,
        retryOnFailed: campaign.retryOnFailed || false,
      });
    }
  }, [campaign]);

  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ["/api/agents"],
    enabled: open,
    staleTime: 0,
  });

  const { data: phoneNumbers = [] } = useQuery<PhoneNumber[]>({
    queryKey: ["/api/phone-numbers"],
    enabled: open,
  });

  const { data: plivoPhoneNumbers = [] } = useQuery<PlivoPhoneNumber[]>({
    queryKey: ["/api/plivo/phone-numbers"],
    enabled: open,
  });

  const { data: sipPhoneNumbersResponse } = useQuery<{ success: boolean; data: SipPhoneNumber[] }>({
    queryKey: ["/api/sip/phone-numbers"],
    enabled: open,
  });

  const sipPhoneNumbers = sipPhoneNumbersResponse?.data || [];

  // Determine agent type for phone number selection
  const selectedAgent = agents.find(a => a.id === formData.agentId);
  const isElevenLabsSipAgent = selectedAgent?.telephonyProvider === 'elevenlabs-sip';
  const isPlivoAgent = selectedAgent?.telephonyProvider === 'plivo' || selectedAgent?.telephonyProvider === 'plivo_openai';

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!campaign) return;
      // Send null instead of empty string for phone number fields to avoid FK constraint errors
      const payload = {
        ...formData,
        phoneNumberId: formData.phoneNumberId || null,
        plivoPhoneNumberId: formData.plivoPhoneNumberId || null,
        sipPhoneNumberId: formData.sipPhoneNumberId || null,
      };
      const res = await apiRequest("PATCH", `/api/campaigns/${campaign.id}`, payload);
      return res.json();
    },
    onSuccess: async () => {
      if (csvFile && campaign) {
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
          
          toast({ title: t("campaigns.toast.csvUploadSuccess") });
        } catch (error) {
          toast({
            title: t("campaigns.toast.csvUploadFailed"),
            description: t("campaigns.toast.csvCheckFormat"),
            variant: "destructive",
          });
        }
      }

      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      toast({ title: t("campaigns.toast.updatedSuccess") });
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({
        title: t("campaigns.toast.updateFailed"),
        description: error.message || t("common.tryAgain"),
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    if (!formData.name) {
      toast({ title: t("campaigns.toast.nameRequired"), description: t("campaigns.toast.pleaseEnterCampaignName"), variant: "destructive" });
      return;
    }
    // Check for agent and appropriate phone number based on agent type
    const hasPhoneNumber = isElevenLabsSipAgent 
      ? formData.sipPhoneNumberId 
      : isPlivoAgent 
        ? formData.plivoPhoneNumberId 
        : formData.phoneNumberId;
    if (!formData.agentId || !hasPhoneNumber) {
      toast({ title: t("campaigns.toast.missingRequired"), description: t("campaigns.toast.selectAgentAndPhone"), variant: "destructive" });
      return;
    }
    updateMutation.mutate();
  };

  const dayKeys = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center shadow-md">
              <Pencil className="h-5 w-5 text-white" />
            </div>
            <div>
              <DialogTitle>{t("campaigns.edit.title")}</DialogTitle>
              <DialogDescription>{t("campaigns.edit.subtitle")}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-2">
            <Label htmlFor="edit-campaign-name">{t("campaigns.edit.name")}</Label>
            <Input
              id="edit-campaign-name"
              placeholder={t("campaigns.edit.namePlaceholder")}
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              data-testid="input-edit-campaign-name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-campaign-type">{t("campaigns.edit.type")}</Label>
            <Select value={formData.type} onValueChange={(value) => setFormData({ ...formData, type: value })}>
              <SelectTrigger data-testid="select-edit-campaign-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Lead Qualification">{t("campaigns.create.typeOptions.lead")}</SelectItem>
                <SelectItem value="Feedback Collection">{t("campaigns.create.typeOptions.feedback")}</SelectItem>
                <SelectItem value="Promotional">{t("campaigns.create.typeOptions.promotional")}</SelectItem>
                <SelectItem value="Payment Reminder">{t("campaigns.create.typeOptions.payment")}</SelectItem>
                <SelectItem value="Event Promotion">{t("campaigns.create.typeOptions.event")}</SelectItem>
                <SelectItem value="Other">{t("campaigns.create.typeOptions.other")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-campaign-goal">{t("campaigns.edit.goalOptional")}</Label>
            <Textarea
              id="edit-campaign-goal"
              placeholder={t("campaigns.edit.goalPlaceholder")}
              value={formData.goal}
              onChange={(e) => setFormData({ ...formData, goal: e.target.value })}
              rows={2}
              data-testid="input-edit-campaign-goal"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-agent-select">{t("campaigns.edit.agentRequired")}</Label>
            <Select 
              value={formData.agentId} 
              onValueChange={(value) => {
                const newAgent = agents.find(a => a.id === value);
                const newIsElevenLabsSipAgent = newAgent?.telephonyProvider === 'elevenlabs-sip';
                const newIsPlivoAgent = newAgent?.telephonyProvider === 'plivo' || newAgent?.telephonyProvider === 'plivo_openai';
                // Clear phone numbers when switching between agent types
                setFormData({ 
                  ...formData, 
                  agentId: value,
                  phoneNumberId: (newIsElevenLabsSipAgent || newIsPlivoAgent) ? "" : formData.phoneNumberId,
                  plivoPhoneNumberId: newIsPlivoAgent ? formData.plivoPhoneNumberId : "",
                  sipPhoneNumberId: newIsElevenLabsSipAgent ? formData.sipPhoneNumberId : ""
                });
              }}
            >
              <SelectTrigger data-testid="select-edit-agent">
                <SelectValue placeholder={t("campaigns.edit.agentPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {agents
                  .filter(agent => agent.type !== 'incoming')
                  .filter(agent => {
                    // Exclude OpenAI SIP agents - they don't support outbound calls
                    if (agent.telephonyProvider === 'openai-sip') return false;
                    return true;
                  })
                  .map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name} - {agent.personality} [{getEngineLabel(agent.telephonyProvider)}]
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-phone-select">{t("campaigns.edit.phoneRequired")}</Label>
            {isElevenLabsSipAgent ? (
              <Select 
                value={formData.sipPhoneNumberId} 
                onValueChange={(value) => setFormData({ ...formData, sipPhoneNumberId: value })}
              >
                <SelectTrigger data-testid="select-edit-phone">
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
            ) : isPlivoAgent ? (
              <Select 
                value={formData.plivoPhoneNumberId} 
                onValueChange={(value) => setFormData({ ...formData, plivoPhoneNumberId: value })}
              >
                <SelectTrigger data-testid="select-edit-phone">
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
            ) : (
              <Select 
                value={formData.phoneNumberId} 
                onValueChange={(value) => setFormData({ ...formData, phoneNumberId: value })}
              >
                <SelectTrigger data-testid="select-edit-phone">
                  <SelectValue placeholder={t("campaigns.edit.phonePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {phoneNumbers.map((phone) => (
                    <SelectItem key={phone.id} value={phone.id}>
                      {phone.friendlyName || phone.phoneNumber}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {isElevenLabsSipAgent && sipPhoneNumbers.filter(p => p.engine === 'elevenlabs-sip').length === 0 && (
              <p className="text-sm text-muted-foreground">No ElevenLabs SIP phone numbers available. Import a phone number with an ElevenLabs SIP trunk first.</p>
            )}
            {isPlivoAgent && plivoPhoneNumbers.length === 0 && (
              <p className="text-sm text-muted-foreground">No Plivo phone numbers available. Purchase a Plivo phone number first.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-campaign-script">{t("campaigns.edit.customScriptOptional")}</Label>
            <Textarea
              id="edit-campaign-script"
              placeholder={t("campaigns.edit.scriptPlaceholder")}
              value={formData.script}
              onChange={(e) => setFormData({ ...formData, script: e.target.value })}
              rows={3}
              data-testid="input-edit-campaign-script"
            />
          </div>

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
                data-testid="switch-edit-schedule-enabled"
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
                      <Label htmlFor="edit-schedule-time-start">{t("campaigns.schedule.startTime")}</Label>
                      <InfoTooltip content={t("campaigns.schedule.startTimeTooltip")} />
                    </div>
                    <Input
                      id="edit-schedule-time-start"
                      type="time"
                      value={formData.scheduleTimeStart}
                      onChange={(e) => setFormData({ ...formData, scheduleTimeStart: e.target.value })}
                      data-testid="input-edit-schedule-time-start"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center">
                      <Label htmlFor="edit-schedule-time-end">{t("campaigns.schedule.endTime")}</Label>
                      <InfoTooltip content={t("campaigns.schedule.endTimeTooltip")} />
                    </div>
                    <Input
                      id="edit-schedule-time-end"
                      type="time"
                      value={formData.scheduleTimeEnd}
                      onChange={(e) => setFormData({ ...formData, scheduleTimeEnd: e.target.value })}
                      data-testid="input-edit-schedule-time-end"
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
                          id={`edit-day-${day}`}
                          checked={formData.scheduleDays.includes(day)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setFormData({ ...formData, scheduleDays: [...formData.scheduleDays, day] });
                            } else {
                              setFormData({ ...formData, scheduleDays: formData.scheduleDays.filter(d => d !== day) });
                            }
                          }}
                          data-testid={`checkbox-edit-day-${day}`}
                        />
                        <Label htmlFor={`edit-day-${day}`} className="text-sm font-normal cursor-pointer">
                          {t(`campaigns.schedule.days.${day}`)}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center">
                    <Label htmlFor="edit-schedule-timezone">{t("campaigns.schedule.timezone")}</Label>
                    <InfoTooltip content={t("campaigns.schedule.timezoneTooltip")} />
                  </div>
                  <Select 
                    value={formData.scheduleTimezone} 
                    onValueChange={(value) => setFormData({ ...formData, scheduleTimezone: value })}
                  >
                    <SelectTrigger data-testid="select-edit-schedule-timezone">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="America/New_York">{t("campaigns.schedule.timezones.eastern")}</SelectItem>
                      <SelectItem value="America/Chicago">{t("campaigns.schedule.timezones.central")}</SelectItem>
                      <SelectItem value="America/Denver">{t("campaigns.schedule.timezones.mountain")}</SelectItem>
                      <SelectItem value="America/Los_Angeles">{t("campaigns.schedule.timezones.pacific")}</SelectItem>
                      <SelectItem value="America/Phoenix">{t("campaigns.schedule.timezones.arizona")}</SelectItem>
                      <SelectItem value="America/Anchorage">{t("campaigns.schedule.timezones.alaska")}</SelectItem>
                      <SelectItem value="Pacific/Honolulu">{t("campaigns.schedule.timezones.hawaii")}</SelectItem>
                      <SelectItem value="Europe/London">{t("campaigns.schedule.timezones.london")}</SelectItem>
                      <SelectItem value="Europe/Paris">{t("campaigns.schedule.timezones.paris")}</SelectItem>
                      <SelectItem value="Asia/Tokyo">{t("campaigns.schedule.timezones.tokyo")}</SelectItem>
                      <SelectItem value="Asia/Dubai">{t("campaigns.schedule.timezones.dubai")}</SelectItem>
                      <SelectItem value="Australia/Sydney">{t("campaigns.schedule.timezones.sydney")}</SelectItem>
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
                data-testid="switch-edit-retry-enabled"
              />
            </div>
            <p className="text-sm text-muted-foreground">
              Contacts that don't answer will be automatically retried at a set interval.
            </p>

            {formData.retryEnabled && (
              <div className="space-y-4 pl-7">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="edit-retry-max-attempts">Max Attempts</Label>
                    <Select
                      value={String(formData.retryMaxAttempts)}
                      onValueChange={(v) => setFormData({ ...formData, retryMaxAttempts: parseInt(v) })}
                    >
                      <SelectTrigger id="edit-retry-max-attempts" data-testid="select-edit-retry-max-attempts">
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
                    <Label htmlFor="edit-retry-interval">Retry Interval</Label>
                    <Select
                      value={String(formData.retryIntervalMinutes)}
                      onValueChange={(v) => setFormData({ ...formData, retryIntervalMinutes: parseInt(v) })}
                    >
                      <SelectTrigger id="edit-retry-interval" data-testid="select-edit-retry-interval">
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
                        id="edit-retry-no-answer"
                        checked={formData.retryOnNoAnswer}
                        onCheckedChange={(checked) => setFormData({ ...formData, retryOnNoAnswer: !!checked })}
                        data-testid="checkbox-edit-retry-no-answer"
                      />
                      <Label htmlFor="edit-retry-no-answer" className="text-sm font-normal cursor-pointer">
                        No Answer
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="edit-retry-busy"
                        checked={formData.retryOnBusy}
                        onCheckedChange={(checked) => setFormData({ ...formData, retryOnBusy: !!checked })}
                        data-testid="checkbox-edit-retry-busy"
                      />
                      <Label htmlFor="edit-retry-busy" className="text-sm font-normal cursor-pointer">
                        Busy
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="edit-retry-failed"
                        checked={formData.retryOnFailed}
                        onCheckedChange={(checked) => setFormData({ ...formData, retryOnFailed: !!checked })}
                        data-testid="checkbox-edit-retry-failed"
                      />
                      <Label htmlFor="edit-retry-failed" className="text-sm font-normal cursor-pointer">
                        Call Failed
                      </Label>
                    </div>
                  </div>
                </div>

                {/* Plain-language summary */}
                {formData.retryMaxAttempts > 1 && (
                  <div className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground" data-testid="text-edit-retry-summary">
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

          <div className="border-t pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowContactsSection(!showContactsSection)}
              className="w-full justify-between"
              data-testid="button-toggle-contacts-section"
            >
              <span>{showContactsSection ? t("campaigns.edit.hideContacts") : t("campaigns.edit.addContacts")}</span>
              {showContactsSection ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
            <p className="text-sm text-muted-foreground mt-2">
              {showContactsSection ? t("campaigns.edit.addNewContacts") : t("campaigns.edit.clickToAddContacts")}
            </p>
          </div>

          {showContactsSection && (
            <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="space-y-2">
                <Label htmlFor="edit-contacts-csv">{t("campaigns.contacts.uploadCSVFile")}</Label>
                <div className="border-2 border-dashed rounded-md p-6 text-center hover-elevate">
                  <input
                    id="edit-contacts-csv"
                    type="file"
                    accept=".csv"
                    onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                    className="hidden"
                    data-testid="input-edit-csv-file"
                  />
                  <label htmlFor="edit-contacts-csv" className="cursor-pointer">
                    <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                    {csvFile ? (
                      <p className="text-sm font-medium">{csvFile.name}</p>
                    ) : (
                      <>
                        <p className="text-sm font-medium">{t("campaigns.contacts.clickToUploadCSV")}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {t("campaigns.contacts.includeColumns")}
                        </p>
                      </>
                    )}
                  </label>
                </div>
              </div>

              <div className="bg-muted p-3 rounded-md">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium">{t("campaigns.contacts.csvFormatExample")}</p>
                  <a 
                    href="/campaign_template.csv"
                    download="campaign_template.csv"
                    className="text-xs text-primary hover:underline"
                    data-testid="link-edit-download-sample-csv"
                  >
                    {t("campaigns.contacts.downloadSampleCSV")}
                  </a>
                </div>
                <code className="text-xs block bg-background p-2 rounded">
                  phone_number,first_name,last_name,contact_name,email,city,company,language<br />
                  +12345678900,John,Smith,John Smith,john@example.com,London,Acme Inc,en<br />
                  +48517067931,Anna,Kowalska,Anna Kowalska,anna@example.pl,Warsaw,Tech Corp,pl
                </code>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-edit">
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={updateMutation.isPending} data-testid="button-save-campaign-edit">
            {updateMutation.isPending ? t("campaigns.actions.saving") : t("campaigns.actions.saveChanges")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
