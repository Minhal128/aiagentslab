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
import { useQuery } from "@tanstack/react-query";
import { useParams, Link, useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, CheckCircle2, XCircle, Clock, Loader2, Users, User, Mail, Layers, Eye } from "lucide-react";
import { format } from "date-fns";
import { useTranslation } from 'react-i18next';

interface Contact {
  id: string;
  firstName: string;
  lastName?: string;
  phone: string;
  email?: string;
  status: string;
  createdAt: string;
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

interface CampaignOwner {
  id: string;
  name: string;
  email: string;
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
  owner?: CampaignOwner;
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

export default function AdminCampaignDetail() {
  const { t } = useTranslation();
  const { id } = useParams();
  const [, setLocation] = useLocation();

  const { data: campaign, isLoading: campaignLoading } = useQuery<Campaign>({
    queryKey: [`/api/admin/campaigns/${id}`],
    enabled: !!id,
    refetchInterval: (query) => {
      const data = query.state.data as Campaign | undefined;
      return data?.status === 'running' || data?.status === 'in-progress' ? 5000 : false;
    },
  });

  const { data: contacts = [], isLoading: contactsLoading } = useQuery<Contact[]>({
    queryKey: [`/api/admin/campaigns/${id}/contacts`],
    enabled: !!id,
    refetchInterval: (query) => {
      return campaign?.status === 'running' || campaign?.status === 'in-progress' ? 10000 : false;
    },
  });

  const { data: calls = [] } = useQuery<Call[]>({
    queryKey: [`/api/admin/campaigns/${id}/calls`],
    enabled: !!id,
    refetchInterval: (query) => {
      return campaign?.status === 'running' || campaign?.status === 'in-progress' ? 5000 : false;
    },
  });

  const { data: batchJobData } = useQuery<{ batchJob: any; stats: BatchJobStats }>({
    queryKey: [`/api/admin/campaigns/${id}/batch`],
    enabled: !!id && !!campaign?.batchJobId,
    refetchInterval: (query) => {
      const data = query.state.data;
      const status = data?.batchJob?.status;
      return status === 'in_progress' || status === 'pending' || status === 'scheduled' ? 5000 : false;
    },
  });

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
        <Button variant="ghost" onClick={() => setLocation("/admin")} data-testid="button-back">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Admin
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
      case "in-progress":
      case "running":
        return <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20">{t('campaignDetail.status.inProgress')}</Badge>;
      case "pending":
        return <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">{t('campaignDetail.status.pending')}</Badge>;
      case "scheduled":
        return <Badge className="bg-purple-500/10 text-purple-500 border-purple-500/20">{t('campaignDetail.status.scheduled')}</Badge>;
      case "paused":
        return <Badge className="bg-orange-500/10 text-orange-500 border-orange-500/20">Paused</Badge>;
      case "failed":
        return <Badge className="bg-red-500/10 text-red-500 border-red-500/20">Failed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getCallStatusIcon = (contactId: string) => {
    const call = calls.find(c => c.contactId === contactId);
    if (!call) return <Clock className="h-4 w-4 text-muted-foreground" />;
    
    switch (call.status) {
      case "completed":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "failed":
      case "no-answer":
      case "busy":
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Clock className="h-4 w-4 text-yellow-500" />;
    }
  };

  const getCallStatus = (contactId: string) => {
    const call = calls.find(c => c.contactId === contactId);
    if (!call) return t('campaignDetail.callStatus.pending');
    
    switch (call.status) {
      case "completed":
        return t('campaignDetail.callStatus.completed');
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
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Button variant="ghost" onClick={() => setLocation("/admin")} data-testid="button-back">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Admin
        </Button>
        <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20">
          <Eye className="h-3 w-3 mr-1" />
          Admin View (Read Only)
        </Badge>
      </div>

      {campaign.owner && (
        <Card className="p-4 bg-muted/50">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-primary/10 rounded-lg">
              <User className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Campaign Owner</p>
              <div className="flex items-center gap-2">
                <p className="font-medium">{campaign.owner.name}</p>
                <span className="text-muted-foreground">•</span>
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Mail className="h-3 w-3" />
                  {campaign.owner.email}
                </div>
              </div>
            </div>
          </div>
        </Card>
      )}

      <div>
        <h1 className="text-3xl font-semibold text-foreground">{campaign.name}</h1>
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
          <TabsTrigger value="recipients" data-testid="tab-recipients">{t('campaignDetail.tabs.recipients')}</TabsTrigger>
          {campaign.batchJobId && (
            <TabsTrigger value="batch" data-testid="tab-batch">
              <Layers className="h-4 w-4 mr-1" />
              Batch Job
            </TabsTrigger>
          )}
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
                <p className="font-medium capitalize">{campaign.type}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t('campaignDetail.labels.created')}</p>
                <p className="font-medium">
                  {format(new Date(campaign.createdAt), "MMM d, yyyy")}
                </p>
              </div>
              {campaign.completedAt && (
                <div>
                  <p className="text-muted-foreground">{t('campaignDetail.labels.completed')}</p>
                  <p className="font-medium">
                    {format(new Date(campaign.completedAt), "MMM d, yyyy 'at' h:mm a")}
                  </p>
                </div>
              )}
              {campaign.batchJobId && (
                <div>
                  <p className="text-muted-foreground">Batch Job ID</p>
                  <p className="font-mono text-xs">{campaign.batchJobId}</p>
                </div>
              )}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="recipients">
          <Card>
            <div className="p-4 border-b">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-muted-foreground" />
                <h3 className="font-semibold">{t('campaignDetail.sections.recipients')}</h3>
                <Badge variant="secondary">{contacts.length}</Badge>
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('campaignDetail.table.name')}</TableHead>
                    <TableHead>{t('campaignDetail.table.phone')}</TableHead>
                    <TableHead>{t('campaignDetail.table.email')}</TableHead>
                    <TableHead>{t('campaignDetail.table.status')}</TableHead>
                  </TableRow>
                </TableHeader>
              <TableBody>
                {contacts.slice(0, 50).map((contact) => (
                  <TableRow key={contact.id} data-testid={`row-contact-${contact.id}`}>
                    <TableCell className="font-medium">
                      {contact.firstName} {contact.lastName || ""}
                    </TableCell>
                    <TableCell>{contact.phone}</TableCell>
                    <TableCell className="text-muted-foreground">{contact.email || "-"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getCallStatusIcon(contact.id)}
                        <span className="text-sm">{getCallStatus(contact.id)}</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              </Table>
            </div>
            {contacts.length > 50 && (
              <div className="p-4 border-t text-center text-sm text-muted-foreground">
                Showing 50 of {contacts.length} recipients
              </div>
            )}
          </Card>
        </TabsContent>

        {campaign.batchJobId && batchJobData?.stats && (
          <TabsContent value="batch">
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">ElevenLabs Batch Job Status</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 rounded-lg bg-muted/50">
                  <p className="text-sm text-muted-foreground">Pending</p>
                  <p className="text-2xl font-semibold">{batchJobData.stats.pending}</p>
                </div>
                <div className="p-4 rounded-lg bg-blue-500/10">
                  <p className="text-sm text-muted-foreground">In Progress</p>
                  <p className="text-2xl font-semibold text-blue-500">{batchJobData.stats.in_progress}</p>
                </div>
                <div className="p-4 rounded-lg bg-green-500/10">
                  <p className="text-sm text-muted-foreground">Completed</p>
                  <p className="text-2xl font-semibold text-green-500">{batchJobData.stats.completed}</p>
                </div>
                <div className="p-4 rounded-lg bg-red-500/10">
                  <p className="text-sm text-muted-foreground">Failed</p>
                  <p className="text-2xl font-semibold text-red-500">{batchJobData.stats.failed}</p>
                </div>
              </div>
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">Overall Progress</span>
                  <span className="text-sm font-medium">{batchJobData.stats.progress}%</span>
                </div>
                <Progress value={batchJobData.stats.progress} />
              </div>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
