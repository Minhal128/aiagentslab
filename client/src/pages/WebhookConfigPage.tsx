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
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Plus, Webhook as WebhookIcon, Send, CheckCircle2, XCircle, Clock, AlertCircle, Trash2, RefreshCw, Eye, Zap, Info, Phone, Megaphone, FileText, ChevronDown, ChevronUp, Shield, Filter } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { format } from "date-fns";
import { DataPagination, usePagination } from "@/components/ui/data-pagination";

interface Campaign {
  id: string;
  name: string;
  status: string;
}

interface Webhook {
  id: string;
  userId: string;
  name: string;
  url: string;
  description: string | null;
  method: string;
  secret: string;
  events: string[];
  campaignIds: string[] | null;
  authType: string | null;
  authCredentials: Record<string, any> | null;
  headers: Record<string, string> | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface WebhookLog {
  id: number;
  webhookId: string;
  event: string;
  payload: Record<string, any>;
  httpStatus: number | null;
  responseBody: string | null;
  responseTime: number | null;
  attemptNumber: number;
  maxAttempts: number;
  success: boolean;
  error: string | null;
  nextRetryAt: string | null;
  createdAt: string;
}

interface WebhookLimits {
  current: number;
  max: number;
  remaining: number;
}

export default function WebhookConfigPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [logsDialogOpen, setLogsDialogOpen] = useState(false);
  const [selectedWebhook, setSelectedWebhook] = useState<Webhook | null>(null);
  const [authSectionOpen, setAuthSectionOpen] = useState(false);
  const [filterSectionOpen, setFilterSectionOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    url: "",
    description: "",
    events: [] as string[],
    filterByCampaign: false,
    selectedCampaigns: [] as string[],
    authType: "none" as "none" | "basic" | "bearer" | "custom",
    authUsername: "",
    authPassword: "",
    authToken: "",
    authHeaders: "{}",
  });

  const eventGroups = [
    {
      name: t('webhooks.eventGroups.callEvents'),
      icon: Phone,
      description: t('webhooks.eventGroups.callEventsDesc'),
      events: [
        { value: "call.started", label: t('webhooks.events.callStarted'), description: t('webhooks.events.callStartedDesc') },
        { value: "call.ringing", label: t('webhooks.events.callRinging'), description: t('webhooks.events.callRingingDesc') },
        { value: "call.answered", label: t('webhooks.events.callAnswered'), description: t('webhooks.events.callAnsweredDesc') },
        { value: "call.completed", label: t('webhooks.events.callCompleted'), description: t('webhooks.events.callCompletedDesc') },
        { value: "call.failed", label: t('webhooks.events.callFailed'), description: t('webhooks.events.callFailedDesc') },
        { value: "call.transferred", label: t('webhooks.events.callTransferred'), description: t('webhooks.events.callTransferredDesc') },
        { value: "call.no_answer", label: t('webhooks.events.callNoAnswer'), description: t('webhooks.events.callNoAnswerDesc') },
        { value: "call.busy", label: t('webhooks.events.callBusy'), description: t('webhooks.events.callBusyDesc') },
        { value: "call.voicemail", label: t('webhooks.events.callVoicemail'), description: t('webhooks.events.callVoicemailDesc') },
      ]
    },
    {
      name: t('webhooks.eventGroups.inboundCallEvents'),
      icon: Phone,
      description: t('webhooks.eventGroups.inboundCallEventsDesc'),
      events: [
        { value: "inbound_call.received", label: t('webhooks.events.inboundCallReceived'), description: t('webhooks.events.inboundCallReceivedDesc') },
        { value: "inbound_call.answered", label: t('webhooks.events.inboundCallAnswered'), description: t('webhooks.events.inboundCallAnsweredDesc') },
        { value: "inbound_call.completed", label: t('webhooks.events.inboundCallCompleted'), description: t('webhooks.events.inboundCallCompletedDesc') },
        { value: "inbound_call.missed", label: t('webhooks.events.inboundCallMissed'), description: t('webhooks.events.inboundCallMissedDesc') },
      ]
    },
    {
      name: t('webhooks.eventGroups.campaignEvents'),
      icon: Megaphone,
      description: t('webhooks.eventGroups.campaignEventsDesc'),
      events: [
        { value: "campaign.started", label: t('webhooks.events.campaignStarted'), description: t('webhooks.events.campaignStartedDesc') },
        { value: "campaign.paused", label: t('webhooks.events.campaignPaused'), description: t('webhooks.events.campaignPausedDesc') },
        { value: "campaign.resumed", label: t('webhooks.events.campaignResumed'), description: t('webhooks.events.campaignResumedDesc') },
        { value: "campaign.completed", label: t('webhooks.events.campaignCompleted'), description: t('webhooks.events.campaignCompletedDesc') },
        { value: "campaign.failed", label: t('webhooks.events.campaignFailed'), description: t('webhooks.events.campaignFailedDesc') },
        { value: "campaign.cancelled", label: t('webhooks.events.campaignCancelled'), description: t('webhooks.events.campaignCancelledDesc') },
      ]
    },
    {
      name: t('webhooks.eventGroups.flowEvents'),
      icon: Zap,
      description: t('webhooks.eventGroups.flowEventsDesc'),
      events: [
        { value: "flow.started", label: t('webhooks.events.flowStarted'), description: t('webhooks.events.flowStartedDesc') },
        { value: "flow.completed", label: t('webhooks.events.flowCompleted'), description: t('webhooks.events.flowCompletedDesc') },
        { value: "flow.failed", label: t('webhooks.events.flowFailed'), description: t('webhooks.events.flowFailedDesc') },
      ]
    },
    {
      name: t('webhooks.eventGroups.appointmentEvents'),
      icon: Clock,
      description: t('webhooks.eventGroups.appointmentEventsDesc'),
      events: [
        { value: "appointment.booked", label: t('webhooks.events.appointmentBooked'), description: t('webhooks.events.appointmentBookedDesc') },
        { value: "appointment.confirmed", label: t('webhooks.events.appointmentConfirmed'), description: t('webhooks.events.appointmentConfirmedDesc') },
        { value: "appointment.cancelled", label: t('webhooks.events.appointmentCancelled'), description: t('webhooks.events.appointmentCancelledDesc') },
        { value: "appointment.rescheduled", label: t('webhooks.events.appointmentRescheduled'), description: t('webhooks.events.appointmentRescheduledDesc') },
        { value: "appointment.completed", label: t('webhooks.events.appointmentCompleted'), description: t('webhooks.events.appointmentCompletedDesc') },
        { value: "appointment.no_show", label: t('webhooks.events.appointmentNoShow'), description: t('webhooks.events.appointmentNoShowDesc') },
      ]
    },
    {
      name: t('webhooks.eventGroups.formEvents'),
      icon: FileText,
      description: t('webhooks.eventGroups.formEventsDesc'),
      events: [
        { value: "form.submitted", label: t('webhooks.events.formSubmitted'), description: t('webhooks.events.formSubmittedDesc') },
        { value: "form.lead_created", label: t('webhooks.events.formLeadCreated'), description: t('webhooks.events.formLeadCreatedDesc') },
      ]
    }
  ];

  const allEvents = eventGroups.flatMap(g => g.events.map(e => e.value));

  const { data: webhooks = [], isLoading, isError: webhooksError } = useQuery<Webhook[]>({
    queryKey: ["/api/webhooks"],
  });

  const { data: campaigns = [] } = useQuery<Campaign[]>({
    queryKey: ["/api/campaigns"],
  });

  const { data: limits } = useQuery<WebhookLimits>({
    queryKey: ["/api/webhooks/limits"],
  });

  const { data: logs = [], isLoading: logsLoading } = useQuery<WebhookLog[]>({
    queryKey: ["/api/webhooks", selectedWebhook?.id, "logs"],
    enabled: !!selectedWebhook?.id && logsDialogOpen,
  });

  const {
    currentPage,
    totalPages,
    totalItems,
    itemsPerPage,
    paginatedItems,
    handlePageChange,
    handleItemsPerPageChange,
  } = usePagination(webhooks, 10);

  const createMutation = useMutation({
    mutationFn: async () => {
      let authCredentials: Record<string, any> | null = null;
      let authType: string | null = null;
      
      if (formData.authType === "basic") {
        authType = "basic";
        authCredentials = {
          username: formData.authUsername,
          password: formData.authPassword,
        };
      } else if (formData.authType === "bearer") {
        authType = "bearer";
        authCredentials = { token: formData.authToken };
      } else if (formData.authType === "custom") {
        authType = "custom";
        try {
          authCredentials = JSON.parse(formData.authHeaders);
        } catch (e) {
          throw new Error(t('webhooks.errors.invalidJson'));
        }
      }

      const payload: any = {
        name: formData.name,
        url: formData.url,
        description: formData.description || null,
        events: formData.events,
        campaignIds: formData.filterByCampaign && formData.selectedCampaigns.length > 0 
          ? formData.selectedCampaigns 
          : null,
      };
      
      if (authType) {
        payload.authType = authType;
        payload.authCredentials = authCredentials;
      }

      const res = await apiRequest("POST", "/api/webhooks", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webhooks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/webhooks/limits"] });
      toast({ title: t('webhooks.toast.created') });
      handleCloseCreate();
    },
    onError: (error: any) => {
      toast({
        title: t('webhooks.toast.createFailed'),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/webhooks/${id}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webhooks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/webhooks/limits"] });
      toast({ title: t('webhooks.toast.deleted') });
    },
    onError: (error: any) => {
      toast({
        title: t('webhooks.toast.deleteFailed'),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const testMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/webhooks/${id}/test`, {});
      return res.json();
    },
    onSuccess: (_, id) => {
      toast({ title: t('webhooks.toast.testSent') });
      queryClient.invalidateQueries({ queryKey: ["/api/webhooks", id, "logs"] });
    },
    onError: (error: any) => {
      toast({
        title: t('webhooks.toast.testFailed'),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const retryMutation = useMutation({
    mutationFn: async (logId: number) => {
      await apiRequest("POST", `/api/webhooks/logs/${logId}/retry`, {});
    },
    onSuccess: () => {
      toast({ title: t('webhooks.toast.retryInitiated') });
      if (selectedWebhook) {
        queryClient.invalidateQueries({ queryKey: ["/api/webhooks", selectedWebhook.id, "logs"] });
      }
    },
    onError: (error: any) => {
      toast({
        title: t('webhooks.toast.retryFailed'),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleCloseCreate = () => {
    setCreateDialogOpen(false);
    setAuthSectionOpen(false);
    setFilterSectionOpen(false);
    setFormData({
      name: "",
      url: "",
      description: "",
      events: [],
      filterByCampaign: false,
      selectedCampaigns: [],
      authType: "none",
      authUsername: "",
      authPassword: "",
      authToken: "",
      authHeaders: "{}",
    });
  };

  const handleViewLogs = (webhook: Webhook) => {
    setSelectedWebhook(webhook);
    setLogsDialogOpen(true);
  };

  const toggleEvent = (event: string) => {
    if (formData.events.includes(event)) {
      setFormData({ ...formData, events: formData.events.filter((e) => e !== event) });
    } else {
      setFormData({ ...formData, events: [...formData.events, event] });
    }
  };

  const selectAllEvents = () => {
    setFormData({ ...formData, events: [...allEvents] });
  };

  const clearAllEvents = () => {
    setFormData({ ...formData, events: [] });
  };

  const selectGroupEvents = (groupEvents: string[]) => {
    const newEvents = Array.from(new Set([...formData.events, ...groupEvents]));
    setFormData({ ...formData, events: newEvents });
  };

  const clearGroupEvents = (groupEvents: string[]) => {
    setFormData({ ...formData, events: formData.events.filter(e => !groupEvents.includes(e)) });
  };

  const toggleCampaign = (campaignId: string) => {
    if (formData.selectedCampaigns.includes(campaignId)) {
      setFormData({ 
        ...formData, 
        selectedCampaigns: formData.selectedCampaigns.filter(id => id !== campaignId) 
      });
    } else {
      setFormData({ 
        ...formData, 
        selectedCampaigns: [...formData.selectedCampaigns, campaignId] 
      });
    }
  };

  const isGroupFullySelected = (groupEvents: string[]) => {
    return groupEvents.every(e => formData.events.includes(e));
  };

  const isGroupPartiallySelected = (groupEvents: string[]) => {
    return groupEvents.some(e => formData.events.includes(e)) && !isGroupFullySelected(groupEvents);
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground">{t('webhooks.loading')}</div>
        </div>
      </div>
    );
  }

  const totalWebhooks = webhooks.length;
  const activeWebhooks = webhooks.filter(w => w.isActive).length;
  const totalEvents = webhooks.reduce((sum, w) => sum + w.events.length, 0);

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-50 via-indigo-100/50 to-purple-50 dark:from-violet-950/40 dark:via-indigo-900/30 dark:to-purple-950/40 border border-violet-100 dark:border-violet-900/50 p-6 md:p-8">
        <div className="absolute inset-0 bg-grid-slate-200/50 dark:bg-grid-slate-700/20 [mask-image:linear-gradient(0deg,transparent,rgba(255,255,255,0.5))]" />
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/25">
              <Zap className="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-foreground" data-testid="text-page-title">
                {t('webhooks.title')}
              </h1>
              <p className="text-muted-foreground mt-0.5">{t('webhooks.subtitle')}</p>
            </div>
          </div>
          <Button 
            onClick={() => setCreateDialogOpen(true)} 
            className="bg-violet-600 hover:bg-violet-700 text-white"
            data-testid="button-create-webhook"
          >
            <Plus className="h-4 w-4 mr-2" />
            {t('webhooks.createWebhook')}
          </Button>
        </div>

        <div className="relative mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white/80 dark:bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-violet-100/50 dark:border-violet-800/30">
            <div className="flex items-center gap-2">
              <WebhookIcon className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              <div className="text-2xl font-bold text-violet-700 dark:text-violet-300">{totalWebhooks}</div>
            </div>
            <div className="text-violet-600/70 dark:text-violet-400/70 text-sm">{t('webhooks.stats.totalWebhooks')}</div>
          </div>
          <div className="bg-white/80 dark:bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-emerald-100/50 dark:border-emerald-800/30">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{activeWebhooks}</div>
            </div>
            <div className="text-emerald-600/70 dark:text-emerald-400/70 text-sm">{t('common.active')}</div>
          </div>
          <div className="bg-white/80 dark:bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-indigo-100/50 dark:border-indigo-800/30">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              <div className="text-2xl font-bold text-indigo-700 dark:text-indigo-300">{totalEvents}</div>
            </div>
            <div className="text-indigo-600/70 dark:text-indigo-400/70 text-sm">{t('webhooks.stats.eventSubscriptions')}</div>
          </div>
        </div>
      </div>

      {webhooks.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <WebhookIcon className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">{t('webhooks.empty.title')}</h3>
            <p className="text-sm text-muted-foreground text-center max-w-md mb-4">
              {t('webhooks.empty.description')}
            </p>
            <Button onClick={() => setCreateDialogOpen(true)} data-testid="button-create-first-webhook">
              <Plus className="h-4 w-4 mr-2" />
              {t('webhooks.empty.createFirst')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4">
            {paginatedItems.map((webhook) => (
              <Card key={webhook.id} className="hover-elevate" data-testid={`card-webhook-${webhook.id}`}>
                <CardHeader className="pb-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1 flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <WebhookIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <CardTitle className="text-lg truncate" data-testid={`text-webhook-name-${webhook.id}`}>
                          {webhook.name}
                        </CardTitle>
                        <Badge variant={webhook.isActive ? "default" : "secondary"} data-testid={`badge-status-${webhook.id}`}>
                          {webhook.isActive ? t('common.active') : t('common.inactive')}
                        </Badge>
                      </div>
                      <CardDescription className="text-sm break-all">{webhook.url}</CardDescription>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => testMutation.mutate(webhook.id)}
                        disabled={testMutation.isPending}
                        data-testid={`button-test-${webhook.id}`}
                      >
                        <Send className="h-4 w-4 sm:mr-2" />
                        <span className="hidden sm:inline">{t('webhooks.actions.test')}</span>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleViewLogs(webhook)}
                        data-testid={`button-view-logs-${webhook.id}`}
                      >
                        <Eye className="h-4 w-4 sm:mr-2" />
                        <span className="hidden sm:inline">{t('webhooks.actions.logs')}</span>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => deleteMutation.mutate(webhook.id)}
                        disabled={deleteMutation.isPending}
                        data-testid={`button-delete-${webhook.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="text-sm">
                      <span className="text-muted-foreground">{t('webhooks.labels.events')}: </span>
                      <span className="font-medium break-words">{webhook.events.join(", ")}</span>
                    </div>
                    {webhook.authType && (
                      <div className="text-sm">
                        <span className="text-muted-foreground">{t('webhooks.labels.auth')}: </span>
                        <Badge variant="outline" className="ml-1">
                          {webhook.authType}
                        </Badge>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <DataPagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={totalItems}
            itemsPerPage={itemsPerPage}
            onPageChange={handlePageChange}
            onItemsPerPageChange={handleItemsPerPageChange}
            data-testid="pagination-webhooks"
          />
        </>
      )}

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle data-testid="text-create-dialog-title">{t('webhooks.dialog.createTitle')}</DialogTitle>
            <DialogDescription>{t('webhooks.dialog.createDescription')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="webhook-name">{t('webhooks.labels.webhookName')} *</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-xs">
                    <p>{t('webhooks.tooltips.webhookName')}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <Input
                id="webhook-name"
                placeholder={t('webhooks.placeholders.webhookName')}
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                data-testid="input-webhook-name"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="webhook-url">{t('webhooks.labels.endpointUrl')} *</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-xs">
                    <p>{t('webhooks.tooltips.endpointUrl')}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <Input
                id="webhook-url"
                placeholder={t('webhooks.placeholders.endpointUrl')}
                value={formData.url}
                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                data-testid="input-webhook-url"
              />
            </div>

            <Card className="border-dashed">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-primary" />
                    <CardTitle className="text-base">{t('webhooks.labels.eventSubscriptions')} *</CardTitle>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs">
                        <p>{t('webhooks.tooltips.eventSubscriptions')}</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button 
                      type="button" 
                      variant="outline" 
                      size="sm" 
                      onClick={selectAllEvents}
                      data-testid="button-select-all-events"
                    >
                      {t('webhooks.actions.selectAll')}
                    </Button>
                    <Button 
                      type="button" 
                      variant="ghost" 
                      size="sm" 
                      onClick={clearAllEvents}
                      data-testid="button-clear-all-events"
                    >
                      {t('common.clear')}
                    </Button>
                  </div>
                </div>
                {formData.events.length > 0 && (
                  <p className="text-sm text-muted-foreground">{t('webhooks.labels.eventsSelected', { count: formData.events.length })}</p>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                {eventGroups.map((group) => {
                  const GroupIcon = group.icon;
                  const groupEventValues = group.events.map(e => e.value);
                  const isFullySelected = isGroupFullySelected(groupEventValues);
                  const isPartiallySelected = isGroupPartiallySelected(groupEventValues);
                  
                  return (
                    <div key={group.name} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <GroupIcon className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium">{group.name}</span>
                          <span className="text-xs text-muted-foreground">({group.events.length})</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button 
                            type="button" 
                            variant="ghost" 
                            size="sm" 
                            className="h-6 px-2 text-xs"
                            onClick={() => selectGroupEvents(groupEventValues)}
                          >
                            {t('common.all')}
                          </Button>
                          <Button 
                            type="button" 
                            variant="ghost" 
                            size="sm" 
                            className="h-6 px-2 text-xs"
                            onClick={() => clearGroupEvents(groupEventValues)}
                          >
                            {t('common.clear')}
                          </Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {group.events.map((event) => (
                          <div
                            key={event.value}
                            className={`p-3 border rounded-md cursor-pointer transition-colors ${
                              formData.events.includes(event.value) 
                                ? "border-primary bg-primary/5 dark:bg-primary/10" 
                                : "hover:bg-muted/50"
                            }`}
                            onClick={() => toggleEvent(event.value)}
                            data-testid={`event-option-${event.value}`}
                          >
                            <div className="flex items-start gap-2">
                              <Checkbox 
                                checked={formData.events.includes(event.value)}
                                className="mt-0.5"
                              />
                              <div>
                                <span className="text-sm font-medium">{event.label}</span>
                                <p className="text-xs text-muted-foreground mt-0.5">{event.description}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Collapsible open={filterSectionOpen} onOpenChange={setFilterSectionOpen}>
              <Card className="border-dashed">
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Filter className="h-4 w-4 text-primary" />
                        <CardTitle className="text-base">{t('webhooks.labels.campaignFilter')}</CardTitle>
                        <Badge variant="outline" className="text-xs">{t('common.optional')}</Badge>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent side="right" className="max-w-xs">
                            <p>{t('webhooks.tooltips.campaignFilter')}</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      {filterSectionOpen ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <CardDescription className="text-xs">
                      {formData.filterByCampaign && formData.selectedCampaigns.length > 0
                        ? t('webhooks.labels.filteringByCampaigns', { count: formData.selectedCampaigns.length })
                        : t('webhooks.labels.receivingFromAll')}
                    </CardDescription>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0 space-y-4">
                    <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                      <div>
                        <Label htmlFor="filter-toggle" className="font-medium">{t('webhooks.labels.filterBySpecific')}</Label>
                        <p className="text-xs text-muted-foreground">{t('webhooks.labels.filterBySpecificDesc')}</p>
                      </div>
                      <Switch
                        id="filter-toggle"
                        checked={formData.filterByCampaign}
                        onCheckedChange={(checked) => setFormData({ 
                          ...formData, 
                          filterByCampaign: checked,
                          selectedCampaigns: checked ? formData.selectedCampaigns : []
                        })}
                        data-testid="switch-filter-by-campaign"
                      />
                    </div>
                    
                    {formData.filterByCampaign && (
                      <div className="space-y-2">
                        <Label>{t('webhooks.labels.selectCampaigns')}</Label>
                        {campaigns.length === 0 ? (
                          <p className="text-sm text-muted-foreground py-2">{t('webhooks.labels.noCampaigns')}</p>
                        ) : (
                          <div className="grid gap-2 max-h-48 overflow-y-auto">
                            {campaigns.map((campaign) => (
                              <div
                                key={campaign.id}
                                className={`flex items-center gap-3 p-2 border rounded-md cursor-pointer transition-colors ${
                                  formData.selectedCampaigns.includes(campaign.id)
                                    ? "border-primary bg-primary/5"
                                    : "hover:bg-muted/50"
                                }`}
                                onClick={() => toggleCampaign(campaign.id)}
                                data-testid={`campaign-option-${campaign.id}`}
                              >
                                <Checkbox checked={formData.selectedCampaigns.includes(campaign.id)} />
                                <div className="flex-1 min-w-0">
                                  <span className="text-sm font-medium truncate">{campaign.name}</span>
                                </div>
                                <Badge variant="outline" className="text-xs shrink-0">
                                  {campaign.status}
                                </Badge>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            <Collapsible open={authSectionOpen} onOpenChange={setAuthSectionOpen}>
              <Card className="border-dashed">
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4 text-primary" />
                        <CardTitle className="text-base">{t('webhooks.labels.authentication')}</CardTitle>
                        <Badge variant="outline" className="text-xs">{t('common.optional')}</Badge>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent side="right" className="max-w-sm">
                            <div className="space-y-2">
                              <p className="font-medium">{t('webhooks.tooltips.authTitle')}</p>
                              <ul className="text-sm space-y-1.5 list-none pl-0">
                                <li><span className="font-medium">{t('webhooks.auth.none')}:</span> {t('webhooks.auth.noneDesc')}</li>
                                <li><span className="font-medium">{t('webhooks.auth.basic')}:</span> {t('webhooks.auth.basicDesc')}</li>
                                <li><span className="font-medium">{t('webhooks.auth.bearer')}:</span> {t('webhooks.auth.bearerDesc')}</li>
                                <li><span className="font-medium">{t('webhooks.auth.custom')}:</span> {t('webhooks.auth.customDesc')}</li>
                              </ul>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      {authSectionOpen ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <CardDescription className="text-xs">
                      {formData.authType === "none" 
                        ? t('webhooks.labels.noAuthConfigured')
                        : t('webhooks.labels.usingAuth', { type: formData.authType })}
                    </CardDescription>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0 space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="auth-type">{t('webhooks.labels.authType')}</Label>
                      <Select
                        value={formData.authType}
                        onValueChange={(value: any) => setFormData({ ...formData, authType: value })}
                      >
                        <SelectTrigger data-testid="select-auth-type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t('webhooks.auth.none')}</SelectItem>
                          <SelectItem value="basic">{t('webhooks.auth.basic')}</SelectItem>
                          <SelectItem value="bearer">{t('webhooks.auth.bearer')}</SelectItem>
                          <SelectItem value="custom">{t('webhooks.auth.custom')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {formData.authType === "basic" && (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label htmlFor="auth-username">{t('webhooks.labels.username')}</Label>
                          <Input
                            id="auth-username"
                            value={formData.authUsername}
                            onChange={(e) => setFormData({ ...formData, authUsername: e.target.value })}
                            data-testid="input-auth-username"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="auth-password">{t('webhooks.labels.password')}</Label>
                          <Input
                            id="auth-password"
                            type="password"
                            value={formData.authPassword}
                            onChange={(e) => setFormData({ ...formData, authPassword: e.target.value })}
                            data-testid="input-auth-password"
                          />
                        </div>
                      </div>
                    )}

                    {formData.authType === "bearer" && (
                      <div className="space-y-2">
                        <Label htmlFor="auth-token">{t('webhooks.labels.bearerToken')}</Label>
                        <Input
                          id="auth-token"
                          type="password"
                          placeholder={t('webhooks.placeholders.bearerToken')}
                          value={formData.authToken}
                          onChange={(e) => setFormData({ ...formData, authToken: e.target.value })}
                          data-testid="input-auth-token"
                        />
                      </div>
                    )}

                    {formData.authType === "custom" && (
                      <div className="space-y-2">
                        <Label htmlFor="auth-headers">{t('webhooks.labels.customHeaders')}</Label>
                        <Textarea
                          id="auth-headers"
                          placeholder={t('webhooks.placeholders.customHeaders')}
                          value={formData.authHeaders}
                          onChange={(e) => setFormData({ ...formData, authHeaders: e.target.value })}
                          rows={4}
                          data-testid="input-auth-headers"
                        />
                      </div>
                    )}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseCreate} data-testid="button-cancel-create">
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!formData.name || !formData.url || formData.events.length === 0 || createMutation.isPending}
              data-testid="button-submit-create"
            >
              {t('webhooks.createWebhook')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={logsDialogOpen} onOpenChange={setLogsDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle data-testid="text-logs-dialog-title">
              {t('webhooks.logs.title')}
            </DialogTitle>
            <DialogDescription>
              {selectedWebhook?.name} - {selectedWebhook?.url}
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="recent" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="recent">{t('webhooks.logs.recentDeliveries')}</TabsTrigger>
              <TabsTrigger value="failed">{t('webhooks.logs.failedDeliveries')}</TabsTrigger>
            </TabsList>

            <TabsContent value="recent" className="space-y-3 mt-4">
              <ScrollArea className="h-96">
                {logsLoading ? (
                  <div className="text-center py-12 text-muted-foreground">
                    {t('webhooks.logs.loading')}
                  </div>
                ) : logs.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    {t('webhooks.logs.noLogs')}
                  </div>
                ) : (
                  <div className="space-y-3 pr-4">
                    {logs.map((log) => (
                      <Card key={log.id} className={log.success ? "" : "border-destructive/50"}>
                        <CardHeader className="pb-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {log.success ? (
                                <CheckCircle2 className="h-4 w-4 text-green-500" />
                              ) : (
                                <XCircle className="h-4 w-4 text-destructive" />
                              )}
                              <span className="font-medium text-sm">{log.event}</span>
                              <Badge variant="outline" className="text-xs">
                                {t('webhooks.logs.attempt')} {log.attemptNumber}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              {log.responseTime && (
                                <span className="text-emerald-600 dark:text-emerald-400">{log.responseTime}ms</span>
                              )}
                              {format(new Date(log.createdAt), "MMM d, h:mm a")}
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          <div className="text-xs">
                            <span className="text-muted-foreground">{t('common.status')}: </span>
                            <Badge variant={log.success ? "default" : "destructive"}>
                              {log.httpStatus || t('webhooks.logs.noResponse')}
                            </Badge>
                          </div>
                          {log.error && (
                            <div className="text-xs text-destructive p-2 bg-destructive/10 rounded">
                              {log.error}
                            </div>
                          )}
                          {!log.success && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => retryMutation.mutate(log.id)}
                              disabled={retryMutation.isPending}
                              data-testid={`button-retry-${log.id}`}
                            >
                              <RefreshCw className="h-3 w-3 mr-2" />
                              {t('webhooks.actions.retry')}
                            </Button>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>

            <TabsContent value="failed" className="space-y-3 mt-4">
              <ScrollArea className="h-96">
                {logsLoading ? (
                  <div className="text-center py-12 text-muted-foreground">
                    {t('webhooks.logs.loading')}
                  </div>
                ) : logs.filter((l) => !l.success).length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    {t('webhooks.logs.noFailed')}
                  </div>
                ) : (
                  <div className="space-y-3 pr-4">
                    {logs
                      .filter((l) => !l.success)
                      .map((log) => (
                        <Card key={log.id} className="border-destructive/50">
                          <CardHeader className="pb-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <XCircle className="h-4 w-4 text-destructive" />
                                <span className="font-medium text-sm">{log.event}</span>
                                <Badge variant="outline" className="text-xs">
                                  {t('webhooks.logs.attempt')} {log.attemptNumber}/{log.maxAttempts}
                                </Badge>
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {format(new Date(log.createdAt), "MMM d, h:mm a")}
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-2">
                            {log.error && (
                              <div className="text-xs text-destructive p-2 bg-destructive/10 rounded">
                                {log.error}
                              </div>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => retryMutation.mutate(log.id)}
                              disabled={retryMutation.isPending}
                              data-testid={`button-retry-failed-${log.id}`}
                            >
                              <RefreshCw className="h-3 w-3 mr-2" />
                              {t('webhooks.actions.retryDelivery')}
                            </Button>
                          </CardContent>
                        </Card>
                      ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
}
