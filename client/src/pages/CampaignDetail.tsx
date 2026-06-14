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
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link, useLocation } from "wouter";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, PhoneCall, Download, CheckCircle2, XCircle, Clock, Loader2, TrendingUp, Users, Target, Pause, StopCircle, Play, Flame, ThermometerSun, Snowflake, RefreshCw, RotateCcw, Layers } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { format } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from 'react-i18next';
import { AuthStorage } from "@/lib/auth-storage";

interface Contact {
  id: string;
  firstName: string;
  lastName?: string;
  phone: string;
  email?: string;
  customFields?: Record<string, any>;
  status: string;
  createdAt: string;
  attemptCount?: number;
  lastAttemptAt?: string | null;
  nextRetryAt?: string | null;
}

interface Call {
  id: string;
  contactId: string | null;
  status: string;
  duration: number | null;
  startedAt: string | null;
  endedAt: string | null;
  classification: string | null;
  sentiment: string | null;
}

interface Campaign {
  id: string;
  name: string;
  type: string;
  status: string;
  totalContacts: number;
  completedCalls: number;
  successfulCalls: number;
  failedCalls: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  batchJobId: string | null;
  batchJobStatus: string | null;
  retryEnabled: boolean;
  retryMaxAttempts?: number;
  retryIntervalMinutes?: number;
  retryOnNoAnswer?: boolean;
  retryOnBusy?: boolean;
  retryOnFailed?: boolean;
  currentRetryPass?: number;
  batchJobHistory?: Array<{ batchJobId: string; pass: number; contactCount: number; createdAt: string }>;
}

interface BatchJobStats {
  pending: number;
  scheduled: number;
  dispatched: number;
  in_progress: number;
  completed: number;
  failed: number;
  total: number;
  progress: number;
}

export default function CampaignDetail() {
  const { t } = useTranslation();
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const currentUser = AuthStorage.getUser();
  const isAdmin = currentUser?.role === 'admin';

  const { data: campaign, isLoading: campaignLoading } = useQuery<Campaign>({
    queryKey: [`/api/campaigns/${id}`],
    enabled: !!id,
    refetchInterval: (query) => {
      const data = query.state.data as Campaign | undefined;
      return data?.status === 'running' || data?.status === 'in-progress' ? 3000 : false;
    },
  });

  const { data: contacts = [], isLoading: contactsLoading } = useQuery<Contact[]>({
    queryKey: [`/api/campaigns/${id}/contacts`],
    enabled: !!id,
    refetchInterval: (query) => {
      return campaign?.status === 'running' || campaign?.status === 'in-progress' ? 5000 : false;
    },
  });

  const { data: calls = [] } = useQuery<Call[]>({
    queryKey: [`/api/campaigns/${id}/calls`],
    enabled: !!id,
    refetchInterval: (query) => {
      return campaign?.status === 'running' || campaign?.status === 'in-progress' ? 3000 : false;
    },
  });

  const pauseMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/campaigns/${id}/pause`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}`] });
      toast({
        title: t('campaignDetail.toast.campaignPaused'),
        description: t('campaignDetail.toast.campaignPausedDesc'),
      });
    },
    onError: () => {
      toast({
        title: t('campaignDetail.toast.pauseFailed'),
        description: t('common.tryAgain'),
        variant: "destructive",
      });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/campaigns/${id}/resume`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}`] });
      toast({
        title: t('campaignDetail.toast.campaignResumed'),
        description: t('campaignDetail.toast.campaignResumedDesc'),
      });
    },
    onError: () => {
      toast({
        title: t('campaignDetail.toast.resumeFailed'),
        description: t('common.tryAgain'),
        variant: "destructive",
      });
    },
  });

  const stopMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/campaigns/${id}/stop`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}`] });
      toast({
        title: t('campaignDetail.toast.campaignStopped'),
        description: t('campaignDetail.toast.campaignStoppedDesc'),
      });
    },
    onError: () => {
      toast({
        title: t('campaignDetail.toast.stopFailed'),
        description: t('common.tryAgain'),
        variant: "destructive",
      });
    },
  });

  const cancelBatchMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/campaigns/${id}/batch/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/batch`] });
      toast({
        title: t('campaignDetail.toast.batchCancelled'),
        description: t('campaignDetail.toast.batchCancelledDesc'),
      });
    },
    onError: (error: any) => {
      toast({
        title: t('campaignDetail.toast.batchCancelFailed'),
        description: error.message || t('common.tryAgain'),
        variant: "destructive",
      });
    },
  });

  const retryBatchMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/campaigns/${id}/batch/retry`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${id}/batch`] });
      toast({
        title: t('campaignDetail.toast.retryInitiated'),
        description: t('campaignDetail.toast.retryInitiatedDesc'),
      });
    },
    onError: (error: any) => {
      toast({
        title: t('campaignDetail.toast.retryFailed'),
        description: error.message || t('common.tryAgain'),
        variant: "destructive",
      });
    },
  });

  const { data: batchJobData, isLoading: batchLoading } = useQuery<{ batchJob: any; stats: BatchJobStats }>({
    queryKey: [`/api/campaigns/${id}/batch`],
    enabled: !!id && !!campaign?.batchJobId,
    refetchInterval: (query) => {
      const data = query.state.data;
      const status = data?.batchJob?.status;
      return status === 'in_progress' || status === 'pending' || status === 'scheduled' ? 5000 : false;
    },
  });

  const handleExportCSV = async () => {
    try {
      const headers: Record<string, string> = {};
      const authHeader = AuthStorage.getAuthHeader();
      if (authHeader) {
        headers['Authorization'] = authHeader;
      }
      
      const response = await fetch(`/api/campaigns/${id}/export`, {
        headers
      });

      if (!response.ok) {
        throw new Error("Failed to export campaign");
      }

      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `campaign-export-${new Date().toISOString().split('T')[0]}.csv`;
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="(.+)"/);
        if (filenameMatch) {
          filename = filenameMatch[1];
        }
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: t('campaignDetail.toast.exportSuccess'),
        description: t('campaignDetail.toast.exportSuccessDesc'),
      });
    } catch (error) {
      toast({
        title: t('campaignDetail.toast.exportFailed'),
        description: t('campaignDetail.toast.exportFailedDesc'),
        variant: "destructive",
      });
    }
  };

  if (campaignLoading || contactsLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => setLocation("/app/campaigns")} data-testid="button-back">
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t('campaignDetail.backToCampaigns')}
        </Button>
        <Card className="p-16 text-center">
          <h3 className="text-lg font-semibold mb-2">{t('campaignDetail.notFound')}</h3>
          <p className="text-muted-foreground">{t('campaignDetail.notFoundDesc')}</p>
        </Card>
      </div>
    );
  }

  const progress = campaign.totalContacts > 0 
    ? Math.round((campaign.completedCalls / campaign.totalContacts) * 100)
    : 0;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <Badge className="bg-green-500/10 text-green-500 border-green-500/20">{t('campaignDetail.status.completed')}</Badge>;
      case "in_progress":
        return <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20">{t('campaignDetail.status.inProgress')}</Badge>;
      case "pending":
        return <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">{t('campaignDetail.status.pending')}</Badge>;
      case "scheduled":
        return <Badge className="bg-purple-500/10 text-purple-500 border-purple-500/20">{t('campaignDetail.status.scheduled')}</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  // Return the most-recent call for a contact (retries create additional rows).
  const getLatestCallForContact = (contactId: string) => {
    const contactCalls = calls.filter(c => c.contactId === contactId);
    if (contactCalls.length === 0) return undefined;
    // Sort by createdAt (always set) descending so the most-recent retry row wins.
    // Fall back to startedAt only when createdAt is identical (should not happen in practice).
    return contactCalls.reduce((latest, c) => {
      const latestTime = latest.createdAt ? new Date(latest.createdAt).getTime() : 0;
      const cTime = c.createdAt ? new Date(c.createdAt).getTime() : 0;
      if (cTime !== latestTime) return cTime > latestTime ? c : latest;
      const latestStarted = latest.startedAt ? new Date(latest.startedAt).getTime() : 0;
      const cStarted = c.startedAt ? new Date(c.startedAt).getTime() : 0;
      return cStarted > latestStarted ? c : latest;
    });
  };

  const getCallStatusIcon = (contactId: string) => {
    const call = getLatestCallForContact(contactId);
    if (!call) return <Clock className="h-4 w-4 text-muted-foreground" />;
    
    switch (call.status) {
      case "completed":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "credit_failed":
      case "failed":
      case "no-answer":
      case "busy":
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Clock className="h-4 w-4 text-yellow-500" />;
    }
  };

  const getCallStatus = (contactId: string) => {
    const call = getLatestCallForContact(contactId);
    if (!call) return t('campaignDetail.callStatus.pending');
    
    switch (call.status) {
      case "completed":
        return t('campaignDetail.callStatus.completed');
      case "credit_failed":
        return "Not Billed - Low Credits";
      case "failed":
        return t('campaignDetail.callStatus.failed');
      case "no-answer":
        return t('campaignDetail.callStatus.noAnswer');
      case "busy":
        return t('campaignDetail.callStatus.busy');
      case "in-progress":
      case "ringing":
        return t('campaignDetail.callStatus.inProgress');
      default:
        return call.status;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => setLocation("/app/campaigns")} data-testid="button-back">
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t('campaignDetail.backToCampaigns')}
        </Button>
        <div className="flex gap-2">
          {campaign.status === "in-progress" && (
            <Button 
              variant="outline" 
              data-testid="button-pause"
              onClick={() => pauseMutation.mutate()}
              disabled={pauseMutation.isPending}
            >
              {pauseMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Pause className="h-4 w-4 mr-2" />
              )}
              {t('campaignDetail.actions.pauseCampaign')}
            </Button>
          )}
          {campaign.status === "paused" && (
            <Button 
              variant="outline" 
              data-testid="button-resume"
              onClick={() => resumeMutation.mutate()}
              disabled={resumeMutation.isPending}
            >
              {resumeMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              {t('campaignDetail.actions.resumeCampaign')}
            </Button>
          )}
          {campaign.status === "failed" && (
            <Button 
              variant="outline" 
              data-testid="button-retry"
              onClick={() => resumeMutation.mutate()}
              disabled={resumeMutation.isPending}
            >
              {resumeMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4 mr-2" />
              )}
              {t('campaignDetail.actions.retryCampaign', 'Retry Campaign')}
            </Button>
          )}
          {(campaign.status === "in-progress" || campaign.status === "paused" || campaign.status === "pending") && (
            <Button 
              variant="destructive" 
              data-testid="button-stop"
              onClick={() => stopMutation.mutate()}
              disabled={stopMutation.isPending}
            >
              {stopMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <StopCircle className="h-4 w-4 mr-2" />
              )}
              {t('campaignDetail.actions.stopCampaign')}
            </Button>
          )}
          <Button variant="outline" onClick={handleExportCSV} data-testid="button-export">
            <Download className="h-4 w-4 mr-2" />
            {t('campaignDetail.actions.exportCSV')}
          </Button>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-3xl font-semibold text-foreground">{campaign.name}</h1>
          {campaign.retryEnabled && campaign.currentRetryPass !== undefined && campaign.currentRetryPass > 0 && (
            <Badge
              variant="outline"
              className="bg-orange-500/10 text-orange-600 border-orange-500/30"
              data-testid="badge-retry-pass"
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              Pass {campaign.currentRetryPass + 1}/{campaign.retryMaxAttempts ?? 3}
            </Badge>
          )}
          {campaign.retryEnabled && contacts.some(c => c.nextRetryAt) && (() => {
            const earliest = contacts
              .filter(c => c.nextRetryAt)
              .map(c => new Date(c.nextRetryAt!).getTime())
              .reduce((min, t) => Math.min(min, t), Infinity);
            return (
              <Badge
                variant="outline"
                className="bg-blue-500/10 text-blue-600 border-blue-500/30"
                data-testid="badge-next-retry-at"
              >
                <Clock className="h-3 w-3 mr-1" />
                Next retry at {format(new Date(earliest), 'h:mm a')}
              </Badge>
            );
          })()}
        </div>
        <p className="text-muted-foreground mt-1">{t('campaignDetail.campaignId')}: {campaign.id}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{t('campaignDetail.labels.status')}</p>
            <div>{getStatusBadge(campaign.status)}</div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{t('campaignDetail.labels.totalRecipients')}</p>
            <p className="text-2xl font-semibold">{campaign.totalContacts}</p>
          </div>
        </Card>
        <Card className="p-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{t('campaignDetail.labels.started')}</p>
            <p className="text-sm font-medium">
              {campaign.startedAt ? format(new Date(campaign.startedAt), "MMM d, yyyy 'at' h:mm a") : t('campaignDetail.labels.notStarted')}
            </p>
          </div>
        </Card>
        <Card className="p-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{t('campaignDetail.labels.progress')}</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                <div 
                  className="h-full bg-primary transition-all" 
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-sm font-medium">{progress}%</span>
            </div>
          </div>
        </Card>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-overview">{t('campaignDetail.tabs.overview')}</TabsTrigger>
          <TabsTrigger value="analytics" data-testid="tab-analytics">{t('campaignDetail.tabs.analytics')}</TabsTrigger>
          <TabsTrigger value="recipients" data-testid="tab-recipients">{t('campaignDetail.tabs.recipients')}</TabsTrigger>
          <TabsTrigger value="lead-quality" data-testid="tab-lead-quality">{t('campaignDetail.tabs.leadQuality')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="p-6" data-testid="card-successful-calls">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-green-500/10 rounded-lg">
                  <CheckCircle2 className="h-6 w-6 text-green-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('campaignDetail.stats.successfulCalls')}</p>
                  <p className="text-2xl font-semibold" data-testid="text-successful-calls-count">{campaign.successfulCalls}</p>
                  <p className="text-xs text-muted-foreground" data-testid="text-success-rate">
                    {campaign.completedCalls > 0 ? Math.round((campaign.successfulCalls / campaign.completedCalls) * 100) : 0}% {t('campaignDetail.stats.successRate')}
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-6" data-testid="card-failed-calls">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-red-500/10 rounded-lg">
                  <XCircle className="h-6 w-6 text-red-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('campaignDetail.stats.failedCalls')}</p>
                  <p className="text-2xl font-semibold" data-testid="text-failed-calls-count">{campaign.failedCalls}</p>
                  <p className="text-xs text-muted-foreground" data-testid="text-failure-rate">
                    {campaign.completedCalls > 0 ? Math.round((campaign.failedCalls / campaign.completedCalls) * 100) : 0}% {t('campaignDetail.stats.failureRate')}
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-6" data-testid="card-pending-calls">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-yellow-500/10 rounded-lg">
                  <Clock className="h-6 w-6 text-yellow-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('campaignDetail.stats.pendingCalls')}</p>
                  <p className="text-2xl font-semibold" data-testid="text-pending-calls-count">{campaign.totalContacts - campaign.completedCalls}</p>
                  <p className="text-xs text-muted-foreground" data-testid="text-remaining-percentage">
                    {campaign.totalContacts > 0 ? Math.round(((campaign.totalContacts - campaign.completedCalls) / campaign.totalContacts) * 100) : 0}% {t('campaignDetail.stats.remaining')}
                  </p>
                </div>
              </div>
            </Card>
          </div>

          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">{t('campaignDetail.sections.campaignDetails')}</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">{t('campaignDetail.labels.campaignType')}</p>
                <p className="font-medium">{campaign.type}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t('campaignDetail.labels.status')}</p>
                <div className="mt-1">{getStatusBadge(campaign.status)}</div>
              </div>
              <div>
                <p className="text-muted-foreground">{t('campaignDetail.labels.created')}</p>
                <p className="font-medium">{format(new Date(campaign.createdAt), "MMM d, yyyy 'at' h:mm a")}</p>
              </div>
              {campaign.completedAt && (
                <div>
                  <p className="text-muted-foreground">{t('campaignDetail.labels.completedAt')}</p>
                  <p className="font-medium">{format(new Date(campaign.completedAt), "MMM d, yyyy 'at' h:mm a")}</p>
                </div>
              )}
            </div>
          </Card>

          {campaign.batchJobId && (
            <Card className="p-6" data-testid="card-batch-job-status">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Layers className="h-5 w-5" />
                  {t('campaignDetail.batch.title')}
                </h3>
                <div className="flex gap-2">
                  {(batchJobData?.batchJob?.status === 'in_progress' || batchJobData?.batchJob?.status === 'pending' || batchJobData?.batchJob?.status === 'scheduled') && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => cancelBatchMutation.mutate()}
                      disabled={cancelBatchMutation.isPending}
                      data-testid="button-cancel-batch"
                    >
                      {cancelBatchMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <StopCircle className="h-4 w-4 mr-2" />
                      )}
                      {t('campaignDetail.batch.cancel')}
                    </Button>
                  )}
                  {(batchJobData?.stats?.failed ?? 0) > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => retryBatchMutation.mutate()}
                      disabled={retryBatchMutation.isPending}
                      data-testid="button-retry-batch"
                    >
                      {retryBatchMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <RotateCcw className="h-4 w-4 mr-2" />
                      )}
                      {t('campaignDetail.batch.retryFailed')}
                    </Button>
                  )}
                </div>
              </div>

              {batchLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : batchJobData?.batchJob ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">{t('campaignDetail.labels.status')}</p>
                      <Badge 
                        variant={
                          batchJobData.batchJob.status === 'completed' ? 'default' :
                          batchJobData.batchJob.status === 'in_progress' ? 'secondary' :
                          batchJobData.batchJob.status === 'failed' ? 'destructive' : 'outline'
                        }
                        className={
                          batchJobData.batchJob.status === 'completed' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                          batchJobData.batchJob.status === 'in_progress' ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' :
                          ''
                        }
                        data-testid="badge-batch-status"
                      >
                        {batchJobData.batchJob.status === 'in_progress' && (
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        )}
                        {batchJobData.batchJob.status}
                      </Badge>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t('campaignDetail.batch.jobId')}</p>
                      <p className="font-mono text-xs" data-testid="text-batch-job-id">
                        {campaign.batchJobId?.slice(0, 12)}...
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t('campaignDetail.batch.totalCalls')}</p>
                      <p className="font-medium" data-testid="text-batch-total-calls">
                        {batchJobData.stats?.total || batchJobData.batchJob.total_calls_scheduled || 0}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t('campaignDetail.batch.dispatched')}</p>
                      <p className="font-medium" data-testid="text-batch-dispatched">
                        {batchJobData.batchJob.total_calls_dispatched || 0}
                      </p>
                    </div>
                  </div>

                  {batchJobData.stats && (
                    <>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{t('campaignDetail.labels.progress')}</span>
                          <span className="font-medium" data-testid="text-batch-progress">
                            {batchJobData.stats.progress}%
                          </span>
                        </div>
                        <Progress value={batchJobData.stats.progress} className="h-2" />
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-slate-400" />
                          <span className="text-muted-foreground">{t('campaignDetail.batch.pending')}:</span>
                          <span className="font-medium" data-testid="text-batch-pending">
                            {batchJobData.stats.pending}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-blue-400" />
                          <span className="text-muted-foreground">{t('campaignDetail.batch.scheduled')}:</span>
                          <span className="font-medium" data-testid="text-batch-scheduled">
                            {batchJobData.stats.scheduled}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                          <span className="text-muted-foreground">{t('campaignDetail.batch.inProgress')}:</span>
                          <span className="font-medium" data-testid="text-batch-in-progress">
                            {batchJobData.stats.in_progress}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-green-400" />
                          <span className="text-muted-foreground">{t('campaignDetail.batch.completed')}:</span>
                          <span className="font-medium" data-testid="text-batch-completed">
                            {batchJobData.stats.completed}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-red-400" />
                          <span className="text-muted-foreground">{t('campaignDetail.batch.failed')}:</span>
                          <span className="font-medium" data-testid="text-batch-failed">
                            {batchJobData.stats.failed}
                          </span>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="text-center py-4 text-muted-foreground">
                  <p>{t('campaignDetail.batch.unavailable')}</p>
                  <p className="text-xs mt-1">{t('campaignDetail.batch.jobId')}: {campaign.batchJobId}</p>
                </div>
              )}
            </Card>
          )}

          {/* Retry Batch History */}
          {campaign.retryEnabled && campaign.batchJobHistory && campaign.batchJobHistory.length > 0 && (
            <Card className="p-6" data-testid="card-retry-history">
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <RotateCcw className="h-5 w-5" />
                Retry Pass History
              </h3>
              <div className="space-y-2">
                {campaign.batchJobHistory.map((entry, index) => (
                  <div key={entry.batchJobId} className="flex items-center justify-between text-sm py-2 border-b last:border-0" data-testid={`row-batch-history-${index}`}>
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="text-xs">
                        Pass {entry.pass + 1}
                      </Badge>
                      <span className="font-mono text-xs text-muted-foreground">{entry.batchJobId?.slice(0, 16)}...</span>
                    </div>
                    <div className="flex items-center gap-4 text-muted-foreground">
                      <span>{entry.contactCount} contacts</span>
                      <span>{format(new Date(entry.createdAt), 'MMM d, h:mm a')}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="p-6" data-testid="card-call-performance">
              <h3 className="text-lg font-semibold mb-4">{t('campaignDetail.analytics.callPerformance')}</h3>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-muted-foreground">{t('campaignDetail.analytics.completionRate')}</span>
                    <span className="font-medium" data-testid="text-completion-rate">
                      {campaign.totalContacts > 0 ? Math.round((campaign.completedCalls / campaign.totalContacts) * 100) : 0}%
                    </span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-500" 
                      style={{ width: `${campaign.totalContacts > 0 ? (campaign.completedCalls / campaign.totalContacts) * 100 : 0}%` }}
                      data-testid="progress-completion-rate"
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-muted-foreground">{t('campaignDetail.analytics.successRate')}</span>
                    <span className="font-medium" data-testid="text-analytics-success-rate">
                      {campaign.completedCalls > 0 ? Math.round((campaign.successfulCalls / campaign.completedCalls) * 100) : 0}%
                    </span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-green-500" 
                      style={{ width: `${campaign.completedCalls > 0 ? (campaign.successfulCalls / campaign.completedCalls) * 100 : 0}%` }}
                      data-testid="progress-success-rate"
                    />
                  </div>
                </div>
              </div>
            </Card>

            <Card className="p-6" data-testid="card-status-distribution">
              <h3 className="text-lg font-semibold mb-4">{t('campaignDetail.analytics.callStatusDistribution')}</h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center" data-testid="row-distribution-successful">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-green-500" />
                    <span className="text-sm">{t('campaignDetail.analytics.successful')}</span>
                  </div>
                  <span className="font-medium" data-testid="text-distribution-successful">{campaign.successfulCalls}</span>
                </div>
                <div className="flex justify-between items-center" data-testid="row-distribution-failed">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500" />
                    <span className="text-sm">{t('campaignDetail.analytics.failed')}</span>
                  </div>
                  <span className="font-medium" data-testid="text-distribution-failed">{campaign.failedCalls}</span>
                </div>
                <div className="flex justify-between items-center" data-testid="row-distribution-pending">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-yellow-500" />
                    <span className="text-sm">{t('campaignDetail.analytics.pending')}</span>
                  </div>
                  <span className="font-medium" data-testid="text-distribution-pending">{campaign.totalContacts - campaign.completedCalls}</span>
                </div>
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="p-6" data-testid="card-lead-quality-distribution">
              <h3 className="text-lg font-semibold mb-4">{t('campaignDetail.analytics.leadQualityDistribution')}</h3>
              <div className="space-y-4">
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <Flame className="h-4 w-4 text-red-500" />
                      <span className="text-sm">{t('campaignDetail.leads.hotLeads')}</span>
                    </div>
                    <span className="font-medium">{calls.filter(c => c.classification === "hot").length}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-red-500" 
                      style={{ width: `${calls.length > 0 ? (calls.filter(c => c.classification === "hot").length / calls.length) * 100 : 0}%` }}
                    />
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <ThermometerSun className="h-4 w-4 text-orange-500" />
                      <span className="text-sm">{t('campaignDetail.leads.warmLeads')}</span>
                    </div>
                    <span className="font-medium">{calls.filter(c => c.classification === "warm").length}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-orange-500" 
                      style={{ width: `${calls.length > 0 ? (calls.filter(c => c.classification === "warm").length / calls.length) * 100 : 0}%` }}
                    />
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <Snowflake className="h-4 w-4 text-blue-500" />
                      <span className="text-sm">{t('campaignDetail.leads.lostLeads')}</span>
                    </div>
                    <span className="font-medium">{calls.filter(c => c.classification === "cold" || c.classification === "lost").length}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-500" 
                      style={{ width: `${calls.length > 0 ? (calls.filter(c => c.classification === "cold" || c.classification === "lost").length / calls.length) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              </div>
            </Card>

            <Card className="p-6" data-testid="card-sentiment-distribution">
              <h3 className="text-lg font-semibold mb-4">{t('campaignDetail.analytics.sentimentAnalysis')}</h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-green-500" />
                    <span className="text-sm">{t('campaignDetail.sentiment.positive')}</span>
                  </div>
                  <span className="font-medium">{calls.filter(c => c.sentiment === "positive").length}</span>
                </div>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-gray-500" />
                    <span className="text-sm">{t('campaignDetail.sentiment.neutral')}</span>
                  </div>
                  <span className="font-medium">{calls.filter(c => c.sentiment === "neutral").length}</span>
                </div>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500" />
                    <span className="text-sm">{t('campaignDetail.sentiment.negative')}</span>
                  </div>
                  <span className="font-medium">{calls.filter(c => c.sentiment === "negative").length}</span>
                </div>
              </div>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="recipients">
          <Card>
            <div className="p-6 border-b">
              <h2 className="text-lg font-semibold">{t('campaignDetail.recipients.title')}</h2>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('campaignDetail.recipients.phoneNumber')}</TableHead>
                    <TableHead>{t('campaignDetail.recipients.name')}</TableHead>
                    <TableHead>{t('campaignDetail.recipients.email')}</TableHead>
                    <TableHead>{t('campaignDetail.recipients.language')}</TableHead>
                    <TableHead>{t('campaignDetail.recipients.city')}</TableHead>
                    <TableHead>{t('campaignDetail.labels.status')}</TableHead>
                    {campaign?.retryEnabled && <TableHead>Attempts</TableHead>}
                    <TableHead>{t('campaignDetail.recipients.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contacts.map((contact) => {
                    const call = getLatestCallForContact(contact.id);
                    return (
                      <TableRow key={contact.id}>
                        <TableCell className="font-medium">{contact.phone}</TableCell>
                        <TableCell>
                          {contact.firstName && contact.firstName.toLowerCase() !== 'unknown'
                            ? `${contact.firstName} ${contact.lastName || ""}`.trim()
                            : "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{contact.email || "—"}</TableCell>
                        <TableCell>
                          {contact.customFields?.language ? (
                            <Badge variant="outline" className="text-xs">
                              {contact.customFields.language === "en" && t('campaignDetail.languages.english')}
                              {contact.customFields.language === "hi" && t('campaignDetail.languages.hindi')}
                              {contact.customFields.language === "es" && t('campaignDetail.languages.spanish')}
                              {contact.customFields.language === "fr" && t('campaignDetail.languages.french')}
                              {contact.customFields.language === "de" && t('campaignDetail.languages.german')}
                              {contact.customFields.language === "it" && t('campaignDetail.languages.italian')}
                              {contact.customFields.language === "pt" && t('campaignDetail.languages.portuguese')}
                              {contact.customFields.language === "ja" && t('campaignDetail.languages.japanese')}
                              {contact.customFields.language === "ko" && t('campaignDetail.languages.korean')}
                              {contact.customFields.language === "zh" && t('campaignDetail.languages.chinese')}
                            </Badge>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {contact.customFields?.city || "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getCallStatusIcon(contact.id)}
                            <span className="text-sm">{getCallStatus(contact.id)}</span>
                          </div>
                        </TableCell>
                        {campaign?.retryEnabled && (
                          <TableCell data-testid={`text-attempts-${contact.id}`}>
                            <span className="text-sm text-muted-foreground">
                              {Math.min(Math.max(0, (contact.attemptCount ?? 1) - 1), campaign.retryMaxAttempts ?? 1)}
                              {campaign.retryMaxAttempts ? `/${campaign.retryMaxAttempts}` : ''}
                            </span>
                            {contact.nextRetryAt && (
                              <span className="block text-xs text-orange-500">
                                Retry scheduled
                              </span>
                            )}
                          </TableCell>
                        )}
                        <TableCell>
                          {call && (
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => setLocation(`/app/calls/${call.id}`)}
                              data-testid={`button-view-call-${contact.id}`}
                            >
                              <PhoneCall className="h-4 w-4 mr-2" />
                              {t('common.view')}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {contacts.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={campaign?.retryEnabled ? 8 : 7} className="text-center text-muted-foreground py-8">
                        {t('campaignDetail.recipients.noContacts')}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="lead-quality" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="p-6" data-testid="card-hot-leads">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-red-500/10 rounded-lg">
                  <Flame className="h-6 w-6 text-red-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('campaignDetail.leads.hotLeads')}</p>
                  <p className="text-2xl font-semibold" data-testid="text-hot-leads-count">
                    {calls.filter(c => c.classification === "hot").length}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {calls.length > 0 ? Math.round((calls.filter(c => c.classification === "hot").length / calls.length) * 100) : 0}% {t('campaignDetail.leads.ofLeads')}
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-6" data-testid="card-warm-leads">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-orange-500/10 rounded-lg">
                  <ThermometerSun className="h-6 w-6 text-orange-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('campaignDetail.leads.warmLeads')}</p>
                  <p className="text-2xl font-semibold" data-testid="text-warm-leads-count">
                    {calls.filter(c => c.classification === "warm").length}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {calls.length > 0 ? Math.round((calls.filter(c => c.classification === "warm").length / calls.length) * 100) : 0}% {t('campaignDetail.leads.ofLeads')}
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-6" data-testid="card-lost-leads">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-500/10 rounded-lg">
                  <Snowflake className="h-6 w-6 text-blue-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('campaignDetail.leads.lostLeads')}</p>
                  <p className="text-2xl font-semibold" data-testid="text-lost-leads-count">
                    {calls.filter(c => c.classification === "cold" || c.classification === "lost").length}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {calls.length > 0 ? Math.round((calls.filter(c => c.classification === "cold" || c.classification === "lost").length / calls.length) * 100) : 0}% {t('campaignDetail.leads.ofLeads')}
                  </p>
                </div>
              </div>
            </Card>
          </div>

          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">{t('campaignDetail.leads.classificationDetails')}</h3>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('campaignDetail.leads.contact')}</TableHead>
                    <TableHead>{t('campaignDetail.leads.phone')}</TableHead>
                    <TableHead>{t('campaignDetail.leads.classification')}</TableHead>
                    <TableHead>{t('campaignDetail.leads.sentiment')}</TableHead>
                    <TableHead>{t('campaignDetail.leads.callDuration')}</TableHead>
                    <TableHead>{t('campaignDetail.recipients.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {calls
                    .filter(call => call.classification === "hot" || call.classification === "warm" || call.classification === "cold" || call.classification === "lost")
                    .map((call) => {
                      const contact = contacts.find(c => c.id === call.contactId);
                      return (
                        <TableRow key={call.id} data-testid={`row-lead-${call.id}`}>
                          <TableCell className="font-medium">
                            {contact && contact.firstName && contact.firstName.toLowerCase() !== 'unknown'
                              ? `${contact.firstName} ${contact.lastName || ""}`
                              : (contact?.phone || "—")}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {contact?.phone || "—"}
                          </TableCell>
                          <TableCell>
                            {call.classification === "hot" && (
                              <Badge className="bg-red-500/10 text-red-500 border-red-500/20">
                                <Flame className="h-3 w-3 mr-1" />
                                {t('campaignDetail.leads.hot')}
                              </Badge>
                            )}
                            {call.classification === "warm" && (
                              <Badge className="bg-orange-500/10 text-orange-500 border-orange-500/20">
                                <ThermometerSun className="h-3 w-3 mr-1" />
                                {t('campaignDetail.leads.warm')}
                              </Badge>
                            )}
                            {(call.classification === "cold" || call.classification === "lost") && (
                              <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20">
                                <Snowflake className="h-3 w-3 mr-1" />
                                {t('campaignDetail.leads.lost')}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {call.sentiment && (
                              <Badge variant="outline" className="text-xs">
                                {call.sentiment}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {call.duration ? `${Math.floor(call.duration / 60)}:${(call.duration % 60).toString().padStart(2, '0')}` : "—"}
                          </TableCell>
                          <TableCell>
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => setLocation(`/app/calls/${call.id}`)}
                              data-testid={`button-view-lead-call-${call.id}`}
                            >
                              <PhoneCall className="h-4 w-4 mr-2" />
                              {t('campaignDetail.leads.viewCall')}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  {calls.filter(c => c.classification === "hot" || c.classification === "warm" || c.classification === "cold" || c.classification === "lost").length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        {t('campaignDetail.leads.noClassifiedLeads')}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
