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
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useTranslation } from 'react-i18next';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, Webhook, ExternalLink, Copy, CheckCircle, XCircle, Clock, Crown, Zap, Lock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';

interface Webhook {
  id: string;
  campaignId: string | null;
  name: string;
  url: string;
  secret: string;
  isActive: boolean;
  createdAt: string;
  campaign?: {
    id: string;
    name: string;
  };
}

interface WebhookDelivery {
  id: string;
  webhookId: string;
  callId: string;
  status: 'success' | 'failed';
  responseCode: number | null;
  responseBody: string | null;
  errorMessage: string | null;
  attemptCount: number;
  createdAt: string;
}

interface User {
  id: string;
  email: string;
  name: string;
  planType: string;
  credits: number;
}

export default function Integrations() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isDeliveryLogsOpen, setIsDeliveryLogsOpen] = useState(false);
  const [selectedWebhookId, setSelectedWebhookId] = useState<string | null>(null);
  const [webhookToDelete, setWebhookToDelete] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    url: '',
    campaignId: '',
  });

  const { data: user, isLoading: userLoading, isError: userError } = useQuery<User>({
    queryKey: ['/api/auth/me'],
  });

  const { data: limits, isLoading: limitsLoading, isError: limitsError } = useQuery<{
    webhooks: { current: number; max: number; remaining: number };
  }>({
    queryKey: ["/api/user/limits"],
    enabled: !!user,
  });

  const { data: webhooks = [], isLoading } = useQuery<Webhook[]>({
    queryKey: ['/api/webhooks'],
  });

  const { data: campaigns = [] } = useQuery<any[]>({
    queryKey: ['/api/campaigns'],
  });

  const { data: deliveryLogs = [] } = useQuery<WebhookDelivery[]>({
    queryKey: ['/api/webhooks', selectedWebhookId, 'deliveries'],
    enabled: !!selectedWebhookId && isDeliveryLogsOpen,
  });

  const createWebhookMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiRequest('POST', '/api/webhooks', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/webhooks'] });
      toast({
        title: t('integrations.toast.created'),
        description: t('integrations.toast.createdDesc'),
      });
      setIsCreateDialogOpen(false);
      setFormData({ name: '', url: '', campaignId: '' });
    },
    onError: (error: any) => {
      toast({
        title: t('integrations.toast.createFailed'),
        description: error.message || t('integrations.toast.createFailedDesc'),
        variant: 'destructive',
      });
    },
  });

  const updateWebhookMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      return await apiRequest('PUT', `/api/webhooks/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/webhooks'] });
      toast({
        title: t('integrations.toast.updated'),
        description: t('integrations.toast.updatedDesc'),
      });
    },
    onError: (error: any) => {
      toast({
        title: t('integrations.toast.updateFailed'),
        description: error.message || t('integrations.toast.updateFailedDesc'),
        variant: 'destructive',
      });
    },
  });

  const deleteWebhookMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest('DELETE', `/api/webhooks/${id}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/webhooks'] });
      toast({
        title: t('integrations.toast.deleted'),
        description: t('integrations.toast.deletedDesc'),
      });
      setWebhookToDelete(null);
    },
    onError: (error: any) => {
      toast({
        title: t('integrations.toast.deleteFailed'),
        description: error.message || t('integrations.toast.deleteFailedDesc'),
        variant: 'destructive',
      });
    },
  });

  const testWebhookMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest('POST', `/api/webhooks/${id}/test`, {});
    },
    onSuccess: () => {
      toast({
        title: t('integrations.toast.testSent'),
        description: t('integrations.toast.testSentDesc'),
      });
    },
    onError: (error: any) => {
      toast({
        title: t('integrations.toast.testFailed'),
        description: error.message || t('integrations.toast.testFailedDesc'),
        variant: 'destructive',
      });
    },
  });

  const handleCreateWebhook = () => {
    if (!formData.name || !formData.url) {
      toast({
        title: t('integrations.toast.missingFields'),
        description: t('integrations.toast.missingFieldsDesc'),
        variant: 'destructive',
      });
      return;
    }

    createWebhookMutation.mutate({
      name: formData.name,
      url: formData.url,
      campaignId: formData.campaignId || null,
    });
  };

  const handleToggleActive = (webhook: Webhook) => {
    updateWebhookMutation.mutate({
      id: webhook.id,
      data: { isActive: !webhook.isActive },
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: t('integrations.toast.copied'),
      description: t('integrations.toast.copiedDesc'),
    });
  };

  const viewDeliveryLogs = (webhookId: string) => {
    setSelectedWebhookId(webhookId);
    setIsDeliveryLogsOpen(true);
  };

  if (userLoading || (!!user && limitsLoading)) {
    return (
      <div className="container mx-auto py-8 px-4">
        <div className="text-center py-16 text-muted-foreground">{t('integrations.loading')}</div>
      </div>
    );
  }

  if (userError) {
    return (
      <div className="container mx-auto py-8 px-4">
        <Card className="p-8 text-center">
          <h2 className="text-xl font-semibold mb-2">{t('integrations.error.title')}</h2>
          <p className="text-muted-foreground">
            {t('integrations.error.description')}
          </p>
        </Card>
      </div>
    );
  }

  const isWebhookLocked = !!user && !limitsError && !limitsLoading && (limits?.webhooks?.max ?? 0) === 0;

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">{t('integrations.title')}</h1>
          <p className="text-muted-foreground">
            {t('integrations.subtitle')}
          </p>
        </div>
        {!isWebhookLocked && (
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-webhook">
                <Plus className="w-4 h-4 mr-2" />
                {t('integrations.createWebhook')}
              </Button>
            </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('integrations.dialog.createTitle')}</DialogTitle>
              <DialogDescription>
                {t('integrations.dialog.createDescription')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">{t('integrations.form.nameLabel')}</Label>
                <Input
                  id="name"
                  data-testid="input-webhook-name"
                  placeholder={t('integrations.form.namePlaceholder')}
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="url">{t('integrations.form.urlLabel')}</Label>
                <Input
                  id="url"
                  data-testid="input-webhook-url"
                  placeholder={t('integrations.form.urlPlaceholder')}
                  value={formData.url}
                  onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="campaign">{t('integrations.form.campaignLabel')}</Label>
                <Select
                  value={formData.campaignId || "all"}
                  onValueChange={(value) => setFormData({ ...formData, campaignId: value === "all" ? "" : value })}
                >
                  <SelectTrigger data-testid="select-webhook-campaign">
                    <SelectValue placeholder={t('integrations.form.allCampaigns')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('integrations.form.allCampaigns')}</SelectItem>
                    {campaigns.map((campaign) => (
                      <SelectItem key={campaign.id} value={campaign.id}>
                        {campaign.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsCreateDialogOpen(false)}
                data-testid="button-cancel-create"
              >
                {t('common.cancel')}
              </Button>
              <Button
                onClick={handleCreateWebhook}
                disabled={createWebhookMutation.isPending}
                data-testid="button-submit-create"
              >
                {createWebhookMutation.isPending ? t('integrations.actions.creating') : t('common.create')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        )}
      </div>

      {isWebhookLocked ? (
        <Card className="p-8 text-center">
          <div className="max-w-2xl mx-auto space-y-6">
            <div className="flex justify-center">
              <div className="relative">
                <Webhook className="w-20 h-20 text-muted-foreground/30" />
                <Lock className="w-8 h-8 text-primary absolute -bottom-1 -right-1 bg-background rounded-full p-1" />
              </div>
            </div>
            
            <div className="space-y-3">
              <h2 className="text-2xl font-bold">{t('integrations.unlock.title')}</h2>
              <p className="text-muted-foreground text-lg">
                {t('integrations.unlock.description')}
              </p>
            </div>

            <div className="bg-muted/50 rounded-lg p-6 space-y-4">
              <h3 className="font-semibold text-lg mb-4">{t('integrations.unlock.proFeaturesTitle')}</h3>
              <div className="grid gap-3 text-left">
                <div className="flex items-start gap-3">
                  <Zap className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium">{t('integrations.unlock.realTimeEvents')}</p>
                    <p className="text-sm text-muted-foreground">{t('integrations.unlock.realTimeEventsDesc')}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Zap className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium">{t('integrations.unlock.crmAutoSync')}</p>
                    <p className="text-sm text-muted-foreground">{t('integrations.unlock.crmAutoSyncDesc')}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Zap className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium">{t('integrations.unlock.customWorkflows')}</p>
                    <p className="text-sm text-muted-foreground">{t('integrations.unlock.customWorkflowsDesc')}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Zap className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium">{t('integrations.unlock.secureReliable')}</p>
                    <p className="text-sm text-muted-foreground">{t('integrations.unlock.secureReliableDesc')}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-4">
              <Button 
                size="lg" 
                className="gap-2"
                onClick={() => setLocation('/app/upgrade')}
                data-testid="button-upgrade-to-pro"
              >
                <Crown className="w-5 h-5" />
                {t('integrations.unlock.upgradeButton')}
              </Button>
              <p className="text-sm text-muted-foreground mt-3">
                {t('integrations.unlock.upgradeDesc')}
              </p>
            </div>
          </div>
        </Card>
      ) : isLoading ? (
        <div className="text-center py-16 text-muted-foreground">{t('integrations.loadingWebhooks')}</div>
      ) : webhooks.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Webhook className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">{t('integrations.empty.title')}</h3>
            <p className="text-muted-foreground text-center mb-4">
              {t('integrations.empty.description')}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {webhooks.map((webhook) => (
            <Card key={webhook.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <CardTitle>{webhook.name}</CardTitle>
                      <Badge variant={webhook.isActive ? 'default' : 'secondary'}>
                        {webhook.isActive ? t('integrations.status.active') : t('integrations.status.inactive')}
                      </Badge>
                    </div>
                    <CardDescription className="flex items-center gap-2 mt-2">
                      <ExternalLink className="w-3 h-3" />
                      {webhook.url}
                    </CardDescription>
                    {webhook.campaign && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {t('integrations.webhook.campaign')}: {webhook.campaign.name}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={webhook.isActive}
                      onCheckedChange={() => handleToggleActive(webhook)}
                      data-testid={`switch-webhook-active-${webhook.id}`}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  <div className="flex items-center gap-2 px-3 py-2 bg-muted rounded-md flex-1 min-w-0">
                    <code className="text-xs truncate flex-1">
                      {t('integrations.webhook.secret')}: {webhook.secret.substring(0, 20)}...
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => copyToClipboard(webhook.secret)}
                      data-testid={`button-copy-secret-${webhook.id}`}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => testWebhookMutation.mutate(webhook.id)}
                    disabled={testWebhookMutation.isPending}
                    data-testid={`button-test-webhook-${webhook.id}`}
                  >
                    {t('integrations.actions.testWebhook')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => viewDeliveryLogs(webhook.id)}
                    data-testid={`button-view-logs-${webhook.id}`}
                  >
                    {t('integrations.actions.viewLogs')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setWebhookToDelete(webhook.id)}
                    data-testid={`button-delete-webhook-${webhook.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={isDeliveryLogsOpen} onOpenChange={setIsDeliveryLogsOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('integrations.dialog.logsTitle')}</DialogTitle>
            <DialogDescription>
              {t('integrations.dialog.logsDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {deliveryLogs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {t('integrations.logs.noLogs')}
              </div>
            ) : (
              deliveryLogs.map((log) => (
                <Card key={log.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {log.status === 'success' ? (
                          <CheckCircle className="w-5 h-5 text-green-600" />
                        ) : (
                          <XCircle className="w-5 h-5 text-red-600" />
                        )}
                        <span className="font-medium">
                          {log.status === 'success' ? t('integrations.logs.success') : t('integrations.logs.failed')}
                        </span>
                        {log.responseCode && (
                          <Badge variant="outline">{t('integrations.logs.http')} {log.responseCode}</Badge>
                        )}
                        <Badge variant="secondary">{t('integrations.logs.attempt')} {log.attemptCount}</Badge>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {new Date(log.createdAt).toLocaleString()}
                      </span>
                    </div>
                    {log.errorMessage && (
                      <p className="text-sm text-red-600 mt-2">{log.errorMessage}</p>
                    )}
                    {log.responseBody && (
                      <details className="mt-2">
                        <summary className="text-sm cursor-pointer text-muted-foreground hover:text-foreground">
                          {t('integrations.logs.viewResponse')}
                        </summary>
                        <pre className="text-xs bg-muted p-2 rounded mt-2 overflow-x-auto">
                          {log.responseBody}
                        </pre>
                      </details>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!webhookToDelete} onOpenChange={() => setWebhookToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('integrations.dialog.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('integrations.dialog.deleteDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => webhookToDelete && deleteWebhookMutation.mutate(webhookToDelete)}
              data-testid="button-confirm-delete"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
