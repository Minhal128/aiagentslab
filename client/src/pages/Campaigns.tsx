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
import { useLocation } from "wouter";
import { useTranslation } from 'react-i18next';
import { CampaignCard } from "@/components/CampaignCard";
import { Status } from "@/components/StatusBadge";
import { CreateCampaignDialog } from "@/components/CreateCampaignDialog";
import { EditCampaignDialog } from "@/components/EditCampaignDialog";
import { CampaignDetailsDialog } from "@/components/CampaignDetailsDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Search, Target, Play, CheckCircle2, Clock, Trash2, RotateCcw, AlertTriangle, Phone } from "lucide-react";
import { Card } from "@/components/ui/card";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { DataPagination, usePagination } from "@/components/ui/data-pagination";
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

interface Campaign {
  id: string;
  name: string;
  type: string;
  status: string;
  totalContacts: number;
  completedCalls: number;
  successfulCalls: number;
  deletedAt?: string | null;
  phoneNumberId?: string | null;
  errorMessage?: string | null;
  errorCode?: string | null;
}

interface User {
  id: string;
  name: string;
  email: string;
  planType: string;
}

const mockCampaigns = [
  {
    id: "1",
    name: "Q4 Lead Qualification Drive",
    type: "Lead Qualification",
    status: "in_progress" as const,
    totalContacts: 500,
    completedCalls: 325,
    successRate: 87.3,
  },
  {
    id: "2",
    name: "Customer Feedback Survey",
    type: "Feedback Collection",
    status: "pending" as const,
    totalContacts: 1000,
    completedCalls: 0,
  },
  {
    id: "3",
    name: "Holiday Promotion 2024",
    type: "Promotional",
    status: "scheduled" as const,
    totalContacts: 2500,
    completedCalls: 0,
    schedule: "Dec 15, 2024 at 9:00 AM",
  },
  {
    id: "4",
    name: "Payment Reminder Q3",
    type: "Payment Reminder",
    status: "completed" as const,
    totalContacts: 750,
    completedCalls: 750,
    successRate: 92.1,
  },
  {
    id: "5",
    name: "Product Launch Announcement",
    type: "Promotional",
    status: "in_progress" as const,
    totalContacts: 1200,
    completedCalls: 480,
    successRate: 84.5,
  },
  {
    id: "6",
    name: "Event Registration Follow-up",
    type: "Event Promotion",
    status: "pending" as const,
    totalContacts: 300,
    completedCalls: 0,
  },
];

export default function Campaigns() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [viewingCampaign, setViewingCampaign] = useState<Campaign | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("active");
  const [restoringCampaignId, setRestoringCampaignId] = useState<string | null>(null);
  const [showPhoneNumberAlert, setShowPhoneNumberAlert] = useState(false);

  const { data: user, isLoading: userLoading } = useQuery<User>({
    queryKey: ["/api/auth/me"],
  });

  const { data: campaigns = [], isLoading } = useQuery<Campaign[]>({
    queryKey: ["/api/campaigns"],
  });

  const isPro = user?.planType === "pro";
  const campaignsWithoutPhoneNumber = campaigns.filter(c => !c.phoneNumberId && c.status !== 'completed');
  const unassignedIds = campaignsWithoutPhoneNumber.map(c => c.id);

  useEffect(() => {
    if (userLoading || isLoading || !user || !isPro || unassignedIds.length === 0) {
      return;
    }

    const sessionKey = `phone_alert_dismissed_${user.id}`;
    try {
      const dismissedData = sessionStorage.getItem(sessionKey);
      
      if (dismissedData) {
        const { ids: dismissedIds } = JSON.parse(dismissedData);
        const dismissedSet = new Set(dismissedIds || []);
        const hasNewUnassigned = unassignedIds.some(id => !dismissedSet.has(id));
        
        if (!hasNewUnassigned) {
          return;
        }
      }
    } catch {
      sessionStorage.removeItem(sessionKey);
    }
    
    setShowPhoneNumberAlert(true);
  }, [userLoading, isLoading, user, isPro, unassignedIds.join(',')]);

  const handleDismissAlert = () => {
    if (user) {
      const sessionKey = `phone_alert_dismissed_${user.id}`;
      sessionStorage.setItem(sessionKey, JSON.stringify({ ids: unassignedIds }));
    }
    setShowPhoneNumberAlert(false);
  };

  const { data: deletedCampaigns = [], isLoading: deletedLoading } = useQuery<Campaign[]>({
    queryKey: ["/api/campaigns/deleted"],
  });

  const restoreMutation = useMutation({
    mutationFn: async (campaignId: string) => {
      setRestoringCampaignId(campaignId);
      const res = await apiRequest("PATCH", `/api/campaigns/${campaignId}/restore`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns/deleted"] });
      toast({ title: t('campaigns.restoredSuccess') });
      setRestoringCampaignId(null);
    },
    onError: (error: any) => {
      toast({
        title: t('campaigns.restoreFailed'),
        description: error.message || t('common.tryAgain'),
        variant: "destructive",
      });
      setRestoringCampaignId(null);
    },
  });

  const filteredCampaigns = campaigns.filter((campaign) => {
    const matchesSearch = campaign.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || campaign.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const filteredDeletedCampaigns = deletedCampaigns.filter((campaign) => {
    const matchesSearch = campaign.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch;
  });

  const activePagination = usePagination(filteredCampaigns, 9);
  const deletedPagination = usePagination(filteredDeletedCampaigns, 9);

  const activeCount = campaigns.filter(c => c.status === 'in_progress').length;
  const completedCount = campaigns.filter(c => c.status === 'completed').length;
  const pendingCount = campaigns.filter(c => c.status === 'pending' || c.status === 'scheduled').length;
  const deletedCount = deletedCampaigns.length;

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-orange-50 via-orange-100/50 to-amber-50 dark:from-orange-950/40 dark:via-orange-900/30 dark:to-amber-950/40 border border-orange-100 dark:border-orange-900/50 p-6 md:p-8">
        <div className="absolute inset-0 bg-grid-slate-200/50 dark:bg-grid-slate-700/20 [mask-image:linear-gradient(0deg,transparent,rgba(255,255,255,0.5))]" />
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center shadow-lg shadow-orange-500/25">
              <Target className="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-foreground">{t('campaigns.title')}</h1>
              <p className="text-muted-foreground mt-0.5">{t('campaigns.description')}</p>
            </div>
          </div>
          <Button 
            onClick={() => setCreateDialogOpen(true)} 
            className="bg-gradient-to-r from-orange-600 to-amber-600 text-white shadow-lg"
            data-testid="button-create-campaign"
          >
            <Plus className="h-4 w-4 mr-2" />
            {t('campaigns.createNew')}
          </Button>
        </div>
        
        <div className="relative mt-6 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="bg-white/80 dark:bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-orange-100/50 dark:border-orange-800/30">
            <div className="text-2xl font-bold text-orange-700 dark:text-orange-300">{campaigns.length}</div>
            <div className="text-orange-600/70 dark:text-orange-400/70 text-sm">{t('campaigns.totalCampaigns')}</div>
          </div>
          <div className="bg-white/80 dark:bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-emerald-100/50 dark:border-emerald-800/30">
            <div className="flex items-center gap-2">
              <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{activeCount}</div>
              <Play className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />
            </div>
            <div className="text-emerald-600/70 dark:text-emerald-400/70 text-sm">{t('campaigns.status.active')}</div>
          </div>
          <div className="bg-white/80 dark:bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-blue-100/50 dark:border-blue-800/30">
            <div className="flex items-center gap-2">
              <div className="text-2xl font-bold text-blue-700 dark:text-blue-300">{completedCount}</div>
              <CheckCircle2 className="h-4 w-4 text-blue-500 dark:text-blue-400" />
            </div>
            <div className="text-blue-600/70 dark:text-blue-400/70 text-sm">{t('campaigns.status.completed')}</div>
          </div>
          <div className="bg-white/80 dark:bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-amber-100/50 dark:border-amber-800/30">
            <div className="flex items-center gap-2">
              <div className="text-2xl font-bold text-amber-700 dark:text-amber-300">{pendingCount}</div>
              <Clock className="h-4 w-4 text-amber-500 dark:text-amber-400" />
            </div>
            <div className="text-amber-600/70 dark:text-amber-400/70 text-sm">{t('campaigns.status.pending')}</div>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <TabsList>
            <TabsTrigger value="active" data-testid="tab-active-campaigns">
              {t('campaigns.activeCampaigns')} ({campaigns.length})
            </TabsTrigger>
            <TabsTrigger value="deleted" data-testid="tab-deleted-campaigns">
              <Trash2 className="h-4 w-4 mr-1" />
              {t('campaigns.deletedCampaigns')} ({deletedCount})
            </TabsTrigger>
          </TabsList>
          
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto sm:flex-1 sm:justify-end">
            <div className="relative w-full sm:w-auto sm:min-w-[250px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('campaigns.searchPlaceholder')}
                className="pl-9"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                data-testid="input-search-campaigns"
              />
            </div>
            {activeTab === "active" && (
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-[180px]" data-testid="select-filter-status">
                  <SelectValue placeholder={t('campaigns.filterByStatus')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('campaigns.allStatus')}</SelectItem>
                  <SelectItem value="pending">{t('campaigns.status.pending')}</SelectItem>
                  <SelectItem value="in_progress">{t('campaigns.status.active')}</SelectItem>
                  <SelectItem value="completed">{t('campaigns.status.completed')}</SelectItem>
                  <SelectItem value="scheduled">{t('campaigns.status.scheduled')}</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        <TabsContent value="active" className="space-y-4">
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="p-6 animate-pulse">
                  <div className="h-6 bg-muted rounded w-3/4 mb-4" />
                  <div className="h-4 bg-muted rounded w-full mb-2" />
                  <div className="h-4 bg-muted rounded w-2/3" />
                </Card>
              ))}
            </div>
          ) : campaigns.length === 0 ? (
            <div className="relative overflow-hidden rounded-2xl border border-dashed border-muted-foreground/25 p-12 text-center">
              <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 via-transparent to-amber-500/5" />
              <div className="relative">
                <div className="h-16 w-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-orange-500/20 to-amber-500/20 flex items-center justify-center">
                  <Target className="h-8 w-8 text-orange-600 dark:text-orange-400" />
                </div>
                <h3 className="text-xl font-semibold mb-2">{t('campaigns.noActiveCampaigns')}</h3>
                <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                  {t('campaigns.getStartedCreate')}
                </p>
                <Button 
                  onClick={() => setCreateDialogOpen(true)}
                  className="bg-gradient-to-r from-orange-600 to-amber-600 text-white"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {t('campaigns.createFirstCampaign')}
                </Button>
              </div>
            </div>
          ) : filteredCampaigns.length === 0 ? (
            <div className="relative overflow-hidden rounded-2xl border border-dashed border-muted-foreground/25 p-12 text-center">
              <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 via-transparent to-amber-500/5" />
              <div className="relative">
                <p className="text-muted-foreground">{t('campaigns.noMatchingCampaigns')}</p>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {activePagination.paginatedItems.map((campaign) => {
                  const successRate = campaign.completedCalls > 0 
                    ? ((campaign.successfulCalls / campaign.completedCalls) * 100).toFixed(1)
                    : undefined;
                  
                  return (
                    <CampaignCard
                      key={campaign.id}
                      id={campaign.id}
                      name={campaign.name}
                      type={campaign.type}
                      status={campaign.status as Status}
                      totalContacts={campaign.totalContacts}
                      completedCalls={campaign.completedCalls}
                      successRate={successRate ? parseFloat(successRate) : undefined}
                      errorMessage={campaign.errorMessage}
                      errorCode={campaign.errorCode}
                      retryEnabled={campaign.retryEnabled}
                      currentRetryPass={campaign.currentRetryPass}
                      retryMaxAttempts={campaign.retryMaxAttempts}
                      onView={() => setLocation(`/app/campaigns/${campaign.id}`)}
                      onEdit={() => setEditingCampaign(campaign)}
                    />
                  );
                })}
              </div>
              <DataPagination
                currentPage={activePagination.currentPage}
                totalPages={activePagination.totalPages}
                totalItems={activePagination.totalItems}
                itemsPerPage={activePagination.itemsPerPage}
                onPageChange={activePagination.handlePageChange}
                onItemsPerPageChange={activePagination.handleItemsPerPageChange}
                itemsPerPageOptions={[9, 18, 27]}
                data-testid="pagination-active-campaigns"
              />
            </>
          )}
        </TabsContent>

        <TabsContent value="deleted" className="space-y-4">
          {deletedLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="p-6 animate-pulse">
                  <div className="h-6 bg-muted rounded w-3/4 mb-4" />
                  <div className="h-4 bg-muted rounded w-full mb-2" />
                  <div className="h-4 bg-muted rounded w-2/3" />
                </Card>
              ))}
            </div>
          ) : deletedCampaigns.length === 0 ? (
            <div className="relative overflow-hidden rounded-2xl border border-dashed border-muted-foreground/25 p-12 text-center">
              <div className="absolute inset-0 bg-gradient-to-br from-gray-500/5 via-transparent to-gray-500/5" />
              <div className="relative">
                <div className="h-16 w-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-gray-500/20 to-gray-500/20 flex items-center justify-center">
                  <Trash2 className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="text-xl font-semibold mb-2">{t('campaigns.noDeletedCampaigns')}</h3>
                <p className="text-muted-foreground max-w-md mx-auto">
                  {t('campaigns.permanentlyRemoved')}
                </p>
              </div>
            </div>
          ) : filteredDeletedCampaigns.length === 0 ? (
            <div className="relative overflow-hidden rounded-2xl border border-dashed border-muted-foreground/25 p-12 text-center">
              <div className="absolute inset-0 bg-gradient-to-br from-gray-500/5 via-transparent to-gray-500/5" />
              <div className="relative">
                <p className="text-muted-foreground">{t('campaigns.noMatchingDeleted')}</p>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {deletedPagination.paginatedItems.map((campaign) => (
                  <Card key={campaign.id} className="p-6 relative overflow-hidden opacity-75 hover:opacity-100 transition-opacity" data-testid={`card-deleted-campaign-${campaign.id}`}>
                    <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-gray-400 via-gray-500 to-gray-400" />
                    
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-semibold text-foreground truncate mb-1" data-testid="text-deleted-campaign-name">
                          {campaign.name}
                        </h3>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm text-muted-foreground font-medium">{campaign.type}</span>
                          <span className="text-muted-foreground">•</span>
                          <span className="text-sm text-destructive">{t('campaigns.status.deleted')}</span>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => restoreMutation.mutate(campaign.id)}
                        disabled={restoringCampaignId === campaign.id}
                        data-testid={`button-restore-campaign-${campaign.id}`}
                      >
                        <RotateCcw className={`h-4 w-4 mr-1 ${restoringCampaignId === campaign.id ? 'animate-spin' : ''}`} />
                        {restoringCampaignId === campaign.id ? t('campaigns.restoring') : t('campaigns.actions.restore')}
                      </Button>
                    </div>

                    <div className="space-y-2 text-sm text-muted-foreground">
                      <div className="flex justify-between gap-2">
                        <span>{t('campaigns.details.totalContacts')}</span>
                        <span className="font-medium">{campaign.totalContacts}</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span>{t('campaigns.completedCalls')}</span>
                        <span className="font-medium">{campaign.completedCalls}</span>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
              <DataPagination
                currentPage={deletedPagination.currentPage}
                totalPages={deletedPagination.totalPages}
                totalItems={deletedPagination.totalItems}
                itemsPerPage={deletedPagination.itemsPerPage}
                onPageChange={deletedPagination.handlePageChange}
                onItemsPerPageChange={deletedPagination.handleItemsPerPageChange}
                itemsPerPageOptions={[9, 18, 27]}
                data-testid="pagination-deleted-campaigns"
              />
            </>
          )}
        </TabsContent>
      </Tabs>

      <CreateCampaignDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
      <EditCampaignDialog 
        campaign={editingCampaign as any} 
        open={!!editingCampaign} 
        onOpenChange={(open: boolean) => !open && setEditingCampaign(null)} 
      />
      <CampaignDetailsDialog 
        campaign={viewingCampaign} 
        open={!!viewingCampaign} 
        onOpenChange={(open: boolean) => !open && setViewingCampaign(null)} 
      />

      <AlertDialog open={showPhoneNumberAlert} onOpenChange={setShowPhoneNumberAlert}>
        <AlertDialogContent data-testid="dialog-phone-number-required">
          <AlertDialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="h-12 w-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
              </div>
              <AlertDialogTitle className="text-xl">
                {t('campaigns.phoneNumberRequired', 'Phone Number Required')}
              </AlertDialogTitle>
            </div>
            <AlertDialogDescription className="text-base">
              {t('campaigns.proUserPhoneNumberMessage', 
                `You have ${campaignsWithoutPhoneNumber.length} campaign(s) that need a phone number assigned. As a Pro user, you need to use your own phone number for campaigns.`
              ).replace('${count}', String(campaignsWithoutPhoneNumber.length))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          {campaignsWithoutPhoneNumber.length > 0 && (
            <div className="my-4 max-h-32 overflow-y-auto">
              <p className="text-sm text-muted-foreground mb-2">{t('campaigns.affectedCampaigns', 'Affected campaigns:')}</p>
              <ul className="space-y-1">
                {campaignsWithoutPhoneNumber.slice(0, 5).map(campaign => (
                  <li key={campaign.id} className="text-sm flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    {campaign.name}
                  </li>
                ))}
                {campaignsWithoutPhoneNumber.length > 5 && (
                  <li className="text-sm text-muted-foreground">
                    {t('campaigns.andMoreCampaigns', `...and ${campaignsWithoutPhoneNumber.length - 5} more`).replace('${count}', String(campaignsWithoutPhoneNumber.length - 5))}
                  </li>
                )}
              </ul>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel 
              onClick={handleDismissAlert}
              data-testid="button-dismiss-phone-alert"
            >
              {t('common.remindLater', 'Remind Me Later')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowPhoneNumberAlert(false);
                setLocation('/app/phone-numbers');
              }}
              className="bg-gradient-to-r from-orange-600 to-amber-600 text-white"
              data-testid="button-get-phone-number"
            >
              <Phone className="h-4 w-4 mr-2" />
              {t('campaigns.getPhoneNumber', 'Get Phone Number')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
