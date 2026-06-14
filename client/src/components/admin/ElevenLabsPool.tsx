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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, CheckCircle2, Plus, Trash2, RefreshCw, Server, Activity, Info, ExternalLink, Save, Loader2, Copy, Check, Webhook, Globe, Eye, EyeOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import type { ElevenLabsCredential } from "@shared/schema";

const TTS_MODEL_IDS = [
  "eleven_v3_conversational",
  "eleven_turbo_v2_5",
  "eleven_flash_v2_5",
  "eleven_turbo_v2",
  "eleven_flash_v2",
  "eleven_multilingual_v2",
];

interface PoolStats {
  totalKeys: number;
  totalCapacity: number;
  totalLoad: number;
  availableCapacity: number;
  utilizationPercent: number;
  totalAgents: number;
  credentials: Array<{
    id: string;
    name: string;
    maxConcurrency: number;
    currentLoad: number;
    totalAssignedAgents: number;
    utilizationPercent: number;
    healthStatus: string;
    isActive: boolean;
    hasWebhookSecret: boolean;
  }>;
}

export default function ElevenLabsPool() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newApiKey, setNewApiKey] = useState("");
  const [newWebhookSecret, setNewWebhookSecret] = useState("");
  const [maxConcurrency, setMaxConcurrency] = useState(30);
  const [isTestingKey, setIsTestingKey] = useState(false);
  const [showNewWebhookSecret, setShowNewWebhookSecret] = useState(false);
  const [selectedTtsModel, setSelectedTtsModel] = useState("eleven_v3_conversational");
  const [ttsModelHasChanges, setTtsModelHasChanges] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
      toast({
        title: t("common.copied"),
        description: t("admin.elevenLabsPool.copiedToClipboard"),
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: t("common.error"),
        description: t("admin.elevenLabsPool.copyFailed"),
      });
    }
  };

  // Get the production domain for webhook URL
  const getWebhookUrl = () => {
    const domain = window.location.hostname;
    const protocol = window.location.protocol;
    // Use the current domain or fallback to production
    return `${protocol}//${domain}/api/webhooks/elevenlabs`;
  };

  const { data: ttsModelSetting } = useQuery<{ default_tts_model: string }>({
    queryKey: ["/api/admin/settings/default_tts_model"],
  });

  useEffect(() => {
    if (ttsModelSetting?.default_tts_model) {
      setSelectedTtsModel(ttsModelSetting.default_tts_model);
    }
  }, [ttsModelSetting]);

  const updateTtsModelMutation = useMutation({
    mutationFn: async (model: string) => {
      return apiRequest("PATCH", "/api/admin/settings/default_tts_model", { value: model });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings/default_tts_model"] });
      setTtsModelHasChanges(false);
      toast({
        title: t("common.success"),
        description: t("admin.elevenLabsPool.ttsModelUpdated"),
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: t("common.error"),
        description: error.message || t("admin.elevenLabsPool.ttsUpdateFailed"),
      });
    },
  });

  const { data: stats, isLoading: statsLoading } = useQuery<PoolStats>({
    queryKey: ["/api/admin/elevenlabs-pool/stats"],
    refetchInterval: 5000,
  });

  const { data: credentials, isLoading: credentialsLoading } = useQuery<Omit<ElevenLabsCredential, "apiKey">[]>({
    queryKey: ["/api/admin/elevenlabs-pool"],
    refetchInterval: 10000,
  });

  const addCredentialMutation = useMutation({
    mutationFn: async (data: { name: string; apiKey: string; maxConcurrency: number; webhookSecret: string }) => {
      return apiRequest("POST", "/api/admin/elevenlabs-pool", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/elevenlabs-pool"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/elevenlabs-pool/stats"] });
      setIsAddDialogOpen(false);
      setNewKeyName("");
      setNewApiKey("");
      setNewWebhookSecret("");
      setMaxConcurrency(30);
      toast({
        title: t("common.success"),
        description: t("admin.elevenLabsPool.keyAdded"),
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: t("common.error"),
        description: error.message || t("admin.elevenLabsPool.addFailed"),
      });
    },
  });

  const testKeyMutation = useMutation({
    mutationFn: async (apiKey: string) => {
      const response = await apiRequest("POST", "/api/admin/elevenlabs-pool/test", { apiKey });
      return response.json();
    },
    onSuccess: (data: any) => {
      if (data.valid) {
        toast({
          title: t("admin.elevenLabsPool.validApiKey"),
          description: t("admin.elevenLabsPool.apiKeyValid"),
        });
      } else {
        toast({
          variant: "destructive",
          title: t("admin.elevenLabsPool.invalidApiKey"),
          description: t("admin.elevenLabsPool.apiKeyInvalid"),
        });
      }
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: t("admin.elevenLabsPool.testFailed"),
        description: t("admin.elevenLabsPool.testFailedDesc"),
      });
    },
  });

  const deleteCredentialMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/admin/elevenlabs-pool/${id}`);
      return response.json();
    },
    onSuccess: (data: { success: boolean; message?: string; unassignedAgents?: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/elevenlabs-pool"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/elevenlabs-pool/stats"] });
      toast({
        title: t("common.success"),
        description: data?.message || t("admin.elevenLabsPool.credentialDeleted"),
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: t("common.error"),
        description: error.message || t("admin.elevenLabsPool.deleteFailed"),
      });
    },
  });

  const healthCheckMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/admin/elevenlabs-pool/health-check");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/elevenlabs-pool"] });
      toast({
        title: t("common.success"),
        description: t("admin.elevenLabsPool.healthChecksComplete"),
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: t("common.error"),
        description: t("admin.elevenLabsPool.healthCheckFailed"),
      });
    },
  });

  const syncAgentsMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/admin/elevenlabs-pool/sync-agents");
      return response.json();
    },
    onSuccess: (data: { synced: number; total: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/elevenlabs-pool"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/elevenlabs-pool/stats"] });
      toast({
        title: t("admin.elevenLabsPool.agentsSynced"),
        description: t("admin.elevenLabsPool.agentsSyncedDesc", { count: data.synced }),
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: t("common.error"),
        description: error.message || t("admin.elevenLabsPool.syncFailed"),
      });
    },
  });


  const handleTestKey = async () => {
    if (!newApiKey) {
      toast({
        variant: "destructive",
        title: t("common.error"),
        description: t("admin.elevenLabsPool.enterApiKeyToTest"),
      });
      return;
    }

    setIsTestingKey(true);
    await testKeyMutation.mutateAsync(newApiKey);
    setIsTestingKey(false);
  };

  const getUtilizationColor = (percent: number) => {
    if (percent >= 90) return "text-red-600";
    if (percent >= 80) return "text-orange-600";
    if (percent >= 60) return "text-yellow-600";
    return "text-green-600";
  };

  const getUtilizationBgColor = (percent: number) => {
    if (percent >= 90) return "bg-red-100 dark:bg-red-950";
    if (percent >= 80) return "bg-orange-100 dark:bg-orange-950";
    if (percent >= 60) return "bg-yellow-100 dark:bg-yellow-950";
    return "bg-green-100 dark:bg-green-950";
  };

  if (statsLoading || credentialsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
          <p className="mt-2 text-muted-foreground">{t("admin.elevenLabsPool.loadingStats")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("admin.elevenLabsPool.totalCapacity")}</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalCapacity || 0}</div>
            <p className="text-xs text-muted-foreground">{t("admin.elevenLabsPool.capacityDesc", { count: stats?.totalKeys || 0 })}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("admin.elevenLabsPool.currentLoad")}</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalLoad || 0}</div>
            <p className="text-xs text-muted-foreground">{t("admin.elevenLabsPool.slotsAvailable", { count: stats?.availableCapacity || 0 })}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("admin.elevenLabsPool.utilization")}</CardTitle>
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${getUtilizationColor(stats?.utilizationPercent || 0)}`}>
              {stats?.utilizationPercent?.toFixed(1) || 0}%
            </div>
            <Progress value={stats?.utilizationPercent || 0} className="mt-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("admin.elevenLabsPool.totalAgents")}</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalAgents || 0}</div>
            <p className="text-xs text-muted-foreground">{t("admin.elevenLabsPool.assignedToKeys")}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                {t("admin.elevenLabsPool.defaultTtsModel")}
                <a
                  href="https://elevenlabs.io/docs/models"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-primary"
                  title={t("admin.elevenLabsPool.viewModelDocs")}
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </CardTitle>
              <CardDescription>
                {t("admin.elevenLabsPool.ttsModelDesc")}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tts-model">{t("admin.elevenLabsPool.ttsModelLabel")}</Label>
              <Select
                value={selectedTtsModel}
                onValueChange={(value) => {
                  setSelectedTtsModel(value);
                  setTtsModelHasChanges(value !== ttsModelSetting?.default_tts_model);
                }}
              >
                <SelectTrigger id="tts-model" data-testid="select-tts-model">
                  <SelectValue placeholder={t("admin.elevenLabsPool.ttsModelPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {TTS_MODEL_IDS.map((modelId) => (
                    <SelectItem key={modelId} value={modelId}>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{t(`admin.elevenLabsPool.ttsModels.${modelId}.name`)}</span>
                        <span className="text-muted-foreground text-xs">- {t(`admin.elevenLabsPool.ttsModels.${modelId}.description`)}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Info className="h-3 w-3" />
                {t("admin.elevenLabsPool.nonEnglishNote")}
              </p>
            </div>
            <div className="flex justify-end">
              <Button
                onClick={() => updateTtsModelMutation.mutate(selectedTtsModel)}
                disabled={!ttsModelHasChanges || updateTtsModelMutation.isPending}
                data-testid="button-save-tts-model"
              >
                {updateTtsModelMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {t("common.saving")}
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    {t("common.save")}
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Webhook Configuration Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Webhook className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="flex items-center gap-2">
                {t("admin.elevenLabsPool.webhookConfig.title", "Webhook Configuration")}
                <a
                  href="https://elevenlabs.io/docs/api-reference/conversational-ai/webhooks"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-primary"
                  title={t("admin.elevenLabsPool.webhookConfig.viewDocs", "View ElevenLabs Webhook Documentation")}
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </CardTitle>
              <CardDescription>
                {t("admin.elevenLabsPool.webhookConfig.description", "Configure webhooks in your ElevenLabs dashboard to sync call data automatically")}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Webhook URL */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Globe className="h-4 w-4" />
              {t("admin.elevenLabsPool.webhookConfig.webhookUrl", "Webhook URL")}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={getWebhookUrl()}
                className="font-mono text-sm bg-muted"
                data-testid="input-webhook-url"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => copyToClipboard(getWebhookUrl(), 'webhookUrl')}
                data-testid="button-copy-webhook-url"
              >
                {copiedField === 'webhookUrl' ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("admin.elevenLabsPool.webhookConfig.webhookUrlHint", "Add this URL in your ElevenLabs dashboard under Agent Settings → Webhooks")}
            </p>
          </div>

          {/* Required Events */}
          <div className="space-y-2">
            <Label>{t("admin.elevenLabsPool.webhookConfig.requiredEvents", "Required Events to Select")}</Label>
            <div className="grid gap-2 md:grid-cols-3">
              <div className="flex items-center gap-2 p-3 rounded-md bg-muted">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <div>
                  <p className="text-sm font-medium">post_call_transcription</p>
                  <p className="text-xs text-muted-foreground">{t("admin.elevenLabsPool.webhookConfig.transcriptionDesc", "Conversation data & transcripts")}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 p-3 rounded-md bg-muted">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <div>
                  <p className="text-sm font-medium">post_call_audio</p>
                  <p className="text-xs text-muted-foreground">{t("admin.elevenLabsPool.webhookConfig.audioDesc", "Call recording audio")}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 p-3 rounded-md bg-muted">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <div>
                  <p className="text-sm font-medium">call_initiation_failure</p>
                  <p className="text-xs text-muted-foreground">{t("admin.elevenLabsPool.webhookConfig.failureDesc", "Failed call attempts")}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Setup Instructions */}
          <div className="space-y-2">
            <Label>{t("admin.elevenLabsPool.webhookConfig.setupSteps", "Setup Steps")}</Label>
            <div className="p-4 rounded-md bg-muted space-y-3">
              <div className="flex items-start gap-3">
                <Badge variant="outline" className="mt-0.5">1</Badge>
                <p className="text-sm">{t("admin.elevenLabsPool.webhookConfig.step1", "Go to ElevenLabs Dashboard → Conversational AI → Your Agent → Settings → Webhooks")}</p>
              </div>
              <div className="flex items-start gap-3">
                <Badge variant="outline" className="mt-0.5">2</Badge>
                <p className="text-sm">{t("admin.elevenLabsPool.webhookConfig.step2", "Click 'Add Webhook' and paste the Webhook URL above")}</p>
              </div>
              <div className="flex items-start gap-3">
                <Badge variant="outline" className="mt-0.5">3</Badge>
                <p className="text-sm">{t("admin.elevenLabsPool.webhookConfig.step3", "Select all three events: post_call_transcription, post_call_audio, call_initiation_failure")}</p>
              </div>
              <div className="flex items-start gap-3">
                <Badge variant="outline" className="mt-0.5">4</Badge>
                <p className="text-sm">{t("admin.elevenLabsPool.webhookConfig.step4", "Copy the webhook secret from your ElevenLabs agent and add it when creating each API Key below")}</p>
              </div>
              <div className="flex items-center gap-2 p-2 rounded-md bg-amber-500/10 border border-amber-500/20 mt-2">
                <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Each API key requires its own unique webhook secret from the corresponding ElevenLabs account.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t("admin.elevenLabsPool.title")}</CardTitle>
              <CardDescription>{t("admin.elevenLabsPool.description")}</CardDescription>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => syncAgentsMutation.mutate()}
                disabled={syncAgentsMutation.isPending}
                data-testid="button-sync-agents"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${syncAgentsMutation.isPending ? "animate-spin" : ""}`} />
                {t("admin.elevenLabsPool.syncAgents")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => healthCheckMutation.mutate()}
                disabled={healthCheckMutation.isPending}
                data-testid="button-health-check"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${healthCheckMutation.isPending ? "animate-spin" : ""}`} />
                {t("admin.elevenLabsPool.healthCheck")}
              </Button>
              <Button size="sm" onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-key">
                <Plus className="h-4 w-4 mr-2" />
                {t("admin.elevenLabsPool.addApiKey")}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {!credentials || credentials.length === 0 ? (
              <div className="text-center py-12">
                <Server className="h-12 w-12 mx-auto text-muted-foreground" />
                <h3 className="mt-4 text-lg font-medium">{t("admin.elevenLabsPool.noApiKeys")}</h3>
                <p className="mt-2 text-muted-foreground">{t("admin.elevenLabsPool.noApiKeysDesc")}</p>
                <Button className="mt-4" onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-first-key">
                  <Plus className="h-4 w-4 mr-2" />
                  {t("admin.elevenLabsPool.addFirstKey")}
                </Button>
              </div>
            ) : (
              (Array.isArray(stats?.credentials) ? stats.credentials : []).map((cred) => (
                <Card key={cred.id} className={`${getUtilizationBgColor(cred.utilizationPercent)}`}>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium text-lg">{cred.name}</h4>
                          {cred.healthStatus === "healthy" ? (
                            <Badge variant="outline" className="border-green-600 text-green-600">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              {t("admin.elevenLabsPool.healthy")}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-red-600 text-red-600">
                              <AlertCircle className="h-3 w-3 mr-1" />
                              {t("admin.elevenLabsPool.unhealthy")}
                            </Badge>
                          )}
                          {cred.hasWebhookSecret ? (
                            <Badge variant="outline" className="border-blue-600 text-blue-600">
                              <Webhook className="h-3 w-3 mr-1" />
                              HMAC
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-orange-500 text-orange-500">
                              <AlertCircle className="h-3 w-3 mr-1" />
                              No Secret
                            </Badge>
                          )}
                        </div>

                        <div className="mt-4 grid grid-cols-4 gap-4">
                          <div>
                            <p className="text-sm text-muted-foreground">{t("admin.elevenLabsPool.currentLoad")}</p>
                            <p className="text-2xl font-bold">
                              {cred.currentLoad} / {cred.maxConcurrency}
                            </p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">{t("admin.elevenLabsPool.utilization")}</p>
                            <p className={`text-2xl font-bold ${getUtilizationColor(cred.utilizationPercent)}`}>
                              {cred.utilizationPercent.toFixed(1)}%
                            </p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">{t("admin.elevenLabsPool.assignedAgents")}</p>
                            <p className="text-2xl font-bold">{cred.totalAssignedAgents}</p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">{t("admin.elevenLabsPool.maxConcurrency")}</p>
                            <p className="text-2xl font-bold">{cred.maxConcurrency}</p>
                          </div>
                        </div>

                        <div className="mt-4">
                          <Progress value={cred.utilizationPercent} className="h-2" />
                        </div>
                      </div>

                      <div className="ml-4 flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            if (
                              confirm(
                                t("admin.elevenLabsPool.deleteConfirm", { name: cred.name }) +
                                  (cred.totalAssignedAgents > 0
                                    ? ` ${t("admin.elevenLabsPool.deleteConfirmAgents", { count: cred.totalAssignedAgents })}`
                                    : "")
                              )
                            ) {
                              deleteCredentialMutation.mutate(cred.id);
                            }
                          }}
                          disabled={deleteCredentialMutation.isPending}
                          data-testid={`button-delete-${cred.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.elevenLabsPool.addKeyTitle")}</DialogTitle>
            <DialogDescription>{t("admin.elevenLabsPool.addKeyDescription")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="name">{t("admin.elevenLabsPool.friendlyName")}</Label>
              <Input
                id="name"
                placeholder={t("admin.elevenLabsPool.friendlyNamePlaceholder")}
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                data-testid="input-key-name"
              />
            </div>

            <div>
              <Label htmlFor="apiKey">{t("admin.elevenLabsPool.apiKeyLabel")}</Label>
              <Input
                id="apiKey"
                type="password"
                placeholder={t("admin.elevenLabsPool.apiKeyPlaceholder")}
                value={newApiKey}
                onChange={(e) => setNewApiKey(e.target.value)}
                data-testid="input-api-key"
              />
            </div>

            <div>
              <Label htmlFor="maxConcurrency">{t("admin.elevenLabsPool.maxConcurrencyLabel")}</Label>
              <Input
                id="maxConcurrency"
                type="number"
                value={maxConcurrency}
                onChange={(e) => setMaxConcurrency(parseInt(e.target.value) || 30)}
                data-testid="input-max-concurrency"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t("admin.elevenLabsPool.maxConcurrencyHint")}
              </p>
            </div>

            <div>
              <Label htmlFor="webhookSecret">
                Webhook Secret (HMAC) <span className="text-destructive">*</span>
              </Label>
              <div className="relative">
                <Input
                  id="webhookSecret"
                  type={showNewWebhookSecret ? "text" : "password"}
                  placeholder="Enter the webhook secret from ElevenLabs dashboard"
                  value={newWebhookSecret}
                  onChange={(e) => setNewWebhookSecret(e.target.value)}
                  data-testid="input-webhook-secret"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowNewWebhookSecret(!showNewWebhookSecret)}
                  data-testid="button-toggle-webhook-secret"
                >
                  {showNewWebhookSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Each API key requires its own webhook secret. Get it from your ElevenLabs agent settings → Webhook Secret.
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={handleTestKey}
              disabled={isTestingKey || !newApiKey}
              data-testid="button-test-key"
            >
              {isTestingKey ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t("admin.elevenLabsPool.testing")}
                </>
              ) : (
                t("admin.elevenLabsPool.testKey")
              )}
            </Button>
            <Button
              onClick={() => addCredentialMutation.mutate({ name: newKeyName, apiKey: newApiKey, maxConcurrency, webhookSecret: newWebhookSecret })}
              disabled={addCredentialMutation.isPending || !newKeyName || !newApiKey || !newWebhookSecret}
              data-testid="button-add-key-submit"
            >
              {addCredentialMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t("admin.elevenLabsPool.adding")}
                </>
              ) : (
                t("admin.elevenLabsPool.addKey")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
