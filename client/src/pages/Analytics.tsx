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
import { AnalyticsChart } from "@/components/AnalyticsChart";
import { MetricCard } from "@/components/MetricCard";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, Phone, Users, TrendingUp, Clock, Loader2, PhoneIncoming, PhoneOutgoing, Target, BarChart3 } from "lucide-react";
import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from 'react-i18next';
import { AuthStorage } from "@/lib/auth-storage";

interface TypeBreakdown {
  incoming: number;
  outgoing: number;
  batch: number;
  campaigns: number;
  total: number;
}

interface AnalyticsData {
  totalCalls: number;
  successRate: number;
  qualifiedLeads: number;
  avgDuration: number;
  leadDistribution: Array<{ name: string; value: number }>;
  sentimentDistribution: Array<{ name: string; value: number }>;
  campaignPerformance: Array<{ name: string; value: number }>;
  dailyCalls: Array<{ date: string; count: number }>;
  typeBreakdown?: TypeBreakdown;
}

export default function Analytics() {
  const { t } = useTranslation();
  const [timeRange, setTimeRange] = useState("7days");
  const [callType, setCallType] = useState("all");
  const [isExporting, setIsExporting] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const currentUser = AuthStorage.getUser();
  const isAdmin = currentUser?.role === 'admin';

  const { data: analytics, isLoading, error } = useQuery<AnalyticsData>({
    queryKey: ['/api/analytics', timeRange, callType],
    queryFn: async () => {
      const headers: Record<string, string> = {};
      const authHeader = AuthStorage.getAuthHeader();
      if (authHeader) {
        headers['Authorization'] = authHeader;
      }
      const response = await fetch(`/api/analytics?timeRange=${timeRange}&callType=${callType}`, {
        credentials: 'include',
        headers
      });
      if (!response.ok) throw new Error('Failed to fetch analytics');
      return response.json();
    }
  });

  const formatDuration = (seconds: number) => {
    if (!seconds) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getTimeRangeLabel = () => {
    switch (timeRange) {
      case '7days': return t('analytics.timeRange.last7Days');
      case '30days': return t('analytics.timeRange.last30Days');
      case '90days': return t('analytics.timeRange.last90Days');
      case 'year': return t('analytics.timeRange.thisYear');
      default: return t('analytics.timeRange.last7Days');
    }
  };

  const getCallTypeLabel = () => {
    switch (callType) {
      case 'all': return t('analytics.callTypes.all');
      case 'incoming': return t('analytics.callTypes.incoming');
      case 'outgoing': return t('analytics.callTypes.outgoing');
      case 'batch': return t('analytics.callTypes.campaigns');
      default: return t('analytics.callTypes.all');
    }
  };

  const handleExportPDF = async () => {
    setIsExporting(true);
    try {
      const response = await apiRequest('POST', '/api/analytics/export-pdf', {
        timeRange,
        callType
      });
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `analytics-report-${new Date().toISOString().split('T')[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast({
        title: t('analytics.toast.reportExported'),
        description: t('analytics.toast.reportExportedDesc')
      });
    } catch (error) {
      toast({
        title: t('analytics.toast.exportFailed'),
        description: t('analytics.toast.exportFailedDesc'),
        variant: "destructive"
      });
    } finally {
      setIsExporting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const {
    totalCalls = 0,
    successRate = 0,
    qualifiedLeads = 0,
    avgDuration = 0,
    leadDistribution = [],
    sentimentDistribution = [],
    campaignPerformance = [],
    dailyCalls = [],
    typeBreakdown = { incoming: 0, outgoing: 0, batch: 0, campaigns: 0, total: 0 }
  } = analytics || {};

  const formattedDailyCalls = dailyCalls.map(d => ({
    name: new Date(d.date).toLocaleDateString('en-US', { weekday: 'short' }),
    value: d.count
  }));

  const getCallVolumeTitle = () => {
    if (timeRange === 'year') return t('analytics.monthlyCallVolume');
    if (timeRange === '30days' || timeRange === '90days') return t('analytics.weeklyCallVolume');
    return t('analytics.dailyCallVolume');
  };

  return (
    <div className="space-y-6" ref={reportRef}>
      {/* Page Header with Purple/Violet Gradient */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-purple-50 via-violet-100/50 to-fuchsia-50 dark:from-purple-950/40 dark:via-violet-900/30 dark:to-fuchsia-950/40 border border-purple-100 dark:border-purple-900/50 p-6 md:p-8">
        <div className="absolute inset-0 bg-grid-slate-200/50 dark:bg-grid-slate-700/20 [mask-image:linear-gradient(0deg,transparent,rgba(255,255,255,0.5))]" />
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center shadow-lg shadow-purple-500/25">
              <BarChart3 className="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-foreground" data-testid="text-analytics-title">{t('analytics.title')}</h1>
              <p className="text-muted-foreground mt-0.5">{t('analytics.subtitle')}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-[150px] bg-white/80 dark:bg-white/10 border-purple-200 dark:border-purple-800" data-testid="select-time-range">
                <SelectValue placeholder={t('analytics.selectPeriod')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7days">{t('analytics.timeRange.last7Days')}</SelectItem>
                <SelectItem value="30days">{t('analytics.timeRange.last30Days')}</SelectItem>
                <SelectItem value="90days">{t('analytics.timeRange.last90Days')}</SelectItem>
                <SelectItem value="year">{t('analytics.timeRange.thisYear')}</SelectItem>
              </SelectContent>
            </Select>
            <Button 
              className="bg-purple-600 hover:bg-purple-700 text-white"
              onClick={handleExportPDF}
              disabled={isExporting}
              data-testid="button-export-report"
            >
              {isExporting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              {t('analytics.exportReport')}
            </Button>
          </div>
        </div>
      </div>

      <Tabs value={callType} onValueChange={setCallType} className="w-full">
        <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-grid" data-testid="tabs-call-type">
          <TabsTrigger value="all" className="flex items-center gap-2" data-testid="tab-all-calls">
            <Phone className="h-4 w-4" />
            <span className="hidden sm:inline">{t('analytics.callTypes.all')}</span>
            <span className="sm:hidden">{t('analytics.callTypes.allShort')}</span>
            {typeBreakdown.total > 0 && (
              <span className="ml-1 text-xs bg-muted px-1.5 py-0.5 rounded-full">{typeBreakdown.total}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="incoming" className="flex items-center gap-2" data-testid="tab-incoming-calls">
            <PhoneIncoming className="h-4 w-4" />
            <span className="hidden sm:inline">{t('analytics.callTypes.incoming')}</span>
            <span className="sm:hidden">{t('analytics.callTypes.incomingShort')}</span>
            {typeBreakdown.incoming > 0 && (
              <span className="ml-1 text-xs bg-muted px-1.5 py-0.5 rounded-full">{typeBreakdown.incoming}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="outgoing" className="flex items-center gap-2" data-testid="tab-outgoing-calls">
            <PhoneOutgoing className="h-4 w-4" />
            <span className="hidden sm:inline">{t('analytics.callTypes.outgoing')}</span>
            <span className="sm:hidden">{t('analytics.callTypes.outgoingShort')}</span>
            {typeBreakdown.outgoing > 0 && (
              <span className="ml-1 text-xs bg-muted px-1.5 py-0.5 rounded-full">{typeBreakdown.outgoing}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="batch" className="flex items-center gap-2" data-testid="tab-campaign-calls">
            <Target className="h-4 w-4" />
            <span className="hidden sm:inline">{t('analytics.callTypes.campaigns')}</span>
            <span className="sm:hidden">{t('analytics.callTypes.campaignsShort')}</span>
            {typeBreakdown.batch > 0 && (
              <span className="ml-1 text-xs bg-muted px-1.5 py-0.5 rounded-full">{typeBreakdown.batch}</span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value={callType} className="mt-6 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <MetricCard
              title={t('analytics.totalCalls')}
              value={totalCalls.toLocaleString()}
              icon={Phone}
              trend={totalCalls > 0 ? { value: 0, direction: "up" as const } : undefined}
              testId="metric-total-calls"
              gradientClassName="bg-gradient-to-br from-cyan-500/20 via-sky-500/10 to-transparent dark:from-cyan-950/40 dark:via-sky-950/20 dark:to-slate-950/10"
              iconClassName="text-cyan-600 dark:text-cyan-400"
            />
            <MetricCard
              title={t('analytics.successRate')}
              value={`${successRate}%`}
              icon={TrendingUp}
              trend={successRate > 0 ? { value: 0, direction: "up" as const } : undefined}
              testId="metric-success-rate"
              gradientClassName="bg-gradient-to-br from-emerald-500/20 via-green-500/10 to-transparent dark:from-emerald-950/40 dark:via-green-950/20 dark:to-slate-950/10"
              iconClassName="text-emerald-600 dark:text-emerald-400"
            />
            <MetricCard
              title={t('analytics.qualifiedLeads')}
              value={qualifiedLeads.toLocaleString()}
              icon={Users}
              trend={qualifiedLeads > 0 ? { value: 0, direction: "up" as const } : undefined}
              testId="metric-qualified-leads"
              gradientClassName="bg-gradient-to-br from-blue-500/20 via-indigo-500/10 to-transparent dark:from-blue-950/40 dark:via-indigo-950/20 dark:to-slate-950/10"
              iconClassName="text-blue-600 dark:text-blue-400"
            />
            <MetricCard
              title={t('analytics.avgDurationLabel')}
              value={formatDuration(avgDuration)}
              icon={Clock}
              subtitle={t('analytics.minutesPerCall')}
              testId="metric-avg-duration"
              gradientClassName="bg-gradient-to-br from-violet-500/20 via-purple-500/10 to-transparent dark:from-violet-950/40 dark:via-purple-950/20 dark:to-slate-950/10"
              iconClassName="text-violet-600 dark:text-violet-400"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <AnalyticsChart 
              title={getCallVolumeTitle()} 
              type="bar" 
              data={formattedDailyCalls.length > 0 ? formattedDailyCalls : [{ name: t('analytics.noData'), value: 0 }]} 
              testId="chart-calls-this-week"
            />
            <AnalyticsChart 
              title={t('analytics.leadDistribution')} 
              type="pie" 
              data={leadDistribution.length > 0 ? leadDistribution : [{ name: t('analytics.noData'), value: 1 }]} 
              testId="chart-lead-distribution"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <AnalyticsChart 
              title={t('analytics.campaignSuccessRate')} 
              type="bar" 
              data={campaignPerformance.length > 0 ? campaignPerformance : [{ name: t('analytics.noCampaigns'), value: 0 }]} 
              xAxisKey="name"
              dataKey="value"
              testId="chart-campaign-success"
            />
            <AnalyticsChart 
              title={t('analytics.sentimentAnalysis')} 
              type="pie" 
              data={sentimentDistribution.length > 0 ? sentimentDistribution : [{ name: t('analytics.noData'), value: 1 }]} 
              testId="chart-sentiment-analysis"
            />
          </div>

          {callType === 'all' && typeBreakdown.total > 0 && (
            <Card data-testid="card-call-breakdown">
              <CardHeader>
                <CardTitle className="text-lg">{t('analytics.callTypeBreakdown')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="p-4 bg-gradient-to-br from-emerald-500/15 via-green-500/10 to-transparent dark:from-emerald-950/30 dark:via-green-950/15 dark:to-slate-950/5 rounded-lg border border-emerald-200/20 dark:border-emerald-800/20">
                    <div className="flex items-center justify-center gap-2 mb-1">
                      <PhoneIncoming className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      <span className="text-sm text-muted-foreground">{t('analytics.callTypes.incoming')}</span>
                    </div>
                    <p className="text-2xl font-bold" data-testid="breakdown-incoming">{typeBreakdown.incoming}</p>
                  </div>
                  <div className="p-4 bg-gradient-to-br from-blue-500/15 via-indigo-500/10 to-transparent dark:from-blue-950/30 dark:via-indigo-950/15 dark:to-slate-950/5 rounded-lg border border-blue-200/20 dark:border-blue-800/20">
                    <div className="flex items-center justify-center gap-2 mb-1">
                      <PhoneOutgoing className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      <span className="text-sm text-muted-foreground">{t('analytics.callTypes.outgoing')}</span>
                    </div>
                    <p className="text-2xl font-bold" data-testid="breakdown-outgoing">{typeBreakdown.outgoing}</p>
                  </div>
                  <div className="p-4 bg-gradient-to-br from-violet-500/15 via-purple-500/10 to-transparent dark:from-violet-950/30 dark:via-purple-950/15 dark:to-slate-950/5 rounded-lg border border-violet-200/20 dark:border-violet-800/20">
                    <div className="flex items-center justify-center gap-2 mb-1">
                      <Target className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                      <span className="text-sm text-muted-foreground">{t('analytics.callTypes.campaigns')}</span>
                    </div>
                    <p className="text-2xl font-bold" data-testid="breakdown-campaigns">{typeBreakdown.batch}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
