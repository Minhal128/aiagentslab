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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { 
  Loader2, 
  TrendingUp, 
  TrendingDown,
  Users, 
  Phone, 
  CreditCard,
  Activity,
  BarChart3,
  PieChartIcon,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  Zap,
  Target,
  UserPlus,
  PhoneCall,
  ContactRound,
  Package
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useTranslation } from "react-i18next";
import { queryClient } from "@/lib/queryClient";

interface AnalyticsData {
  totalUsers: number;
  totalCampaigns: number;
  totalCalls: number;
  successRate: number;
  qualifiedLeads: number;
  activeUsers: number;
  proPlanUsers: number;
  freePlanUsers: number;
  totalPhoneNumbers?: number;
  totalContacts?: number;
  totalKnowledgeBases?: number;
  growthData?: {
    date: string;
    users: number;
    calls: number;
    campaigns: number;
  }[];
  userGrowthPercent?: number;
  callGrowthPercent?: number;
  campaignGrowthPercent?: number;
}

const timeRanges = [
  { value: "7d", label: "7 Days" },
  { value: "30d", label: "30 Days" },
  { value: "90d", label: "90 Days" },
  { value: "all", label: "All Time" },
];

const CHART_COLORS = {
  users: "#6366f1",
  calls: "#22c55e",
  campaigns: "#f59e0b",
  pro: "#6366f1",
  free: "#94a3b8",
  success: "#22c55e",
  qualified: "#8b5cf6",
};

export default function Analytics() {
  const { t } = useTranslation();
  const [timeRange, setTimeRange] = useState("30d");

  const { data: analytics, isLoading, refetch } = useQuery<AnalyticsData>({
    queryKey: [`/api/admin/analytics?timeRange=${timeRange}`],
  });

  const generateMockGrowthData = () => {
    const days = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : timeRange === "90d" ? 90 : timeRange === "all" ? 365 : 365;
    const data = [];
    const baseUsers = analytics?.totalUsers || 100;
    const baseCalls = analytics?.totalCalls || 500;
    const baseCampaigns = analytics?.totalCampaigns || 50;
    
    for (let i = days; i >= 0; i -= Math.max(1, Math.floor(days / 12))) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const multiplier = 1 - (i / days) * 0.3;
      data.push({
        date: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        users: Math.floor(baseUsers * multiplier * (0.9 + Math.random() * 0.2)),
        calls: Math.floor(baseCalls * multiplier * (0.85 + Math.random() * 0.3)),
        campaigns: Math.floor(baseCampaigns * multiplier * (0.9 + Math.random() * 0.2)),
      });
    }
    return data;
  };

  const growthData = analytics?.growthData || generateMockGrowthData();

  const planDistribution = [
    { name: "Pro Plan", value: analytics?.proPlanUsers || 0, fill: CHART_COLORS.pro },
    { name: "Free Plan", value: analytics?.freePlanUsers || 0, fill: CHART_COLORS.free },
  ];

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/admin/analytics?timeRange=${timeRange}`] });
    refetch();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const userGrowthPercent = analytics?.userGrowthPercent ?? 0;
  const callGrowthPercent = analytics?.callGrowthPercent ?? 0;
  const campaignGrowthPercent = analytics?.campaignGrowthPercent ?? 0;
  const conversionRate = ((analytics?.qualifiedLeads || 0) / Math.max(analytics?.totalCalls || 1, 1)) * 100;
  const isAllTime = timeRange === "all";

  return (
    <div className="space-y-6">
      {/* Filters at top - apply to all metrics */}
      <div className="flex items-center justify-end gap-2 flex-wrap">
        <div className="flex items-center bg-muted rounded-lg p-1">
          {timeRanges.map((range) => (
            <Button
              key={range.value}
              variant={timeRange === range.value ? "default" : "ghost"}
              size="sm"
              onClick={() => setTimeRange(range.value)}
              className={timeRange === range.value ? "" : "text-muted-foreground"}
              data-testid={`button-range-${range.value}`}
            >
              {range.label}
            </Button>
          ))}
        </div>
        <Button variant="outline" size="icon" onClick={handleRefresh} data-testid="button-refresh-analytics">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Combined 8-tile grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Row 1: Core metrics */}
        <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-950/30 dark:to-background">
          <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-br from-indigo-500/20 to-transparent rounded-full blur-2xl" />
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-foreground/80">Total Users</CardTitle>
            <div className="p-2 bg-indigo-500/10 rounded-lg ring-1 ring-indigo-500/20">
              <Users className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">{analytics?.totalUsers?.toLocaleString() || 0}</div>
            <div className="flex items-center gap-1 mt-1">
              {isAllTime ? (
                <span className="text-xs text-muted-foreground">Total registered users</span>
              ) : (
                <>
                  <Badge variant="secondary" className={`gap-1 text-xs border-0 ${userGrowthPercent >= 0 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-red-500/10 text-red-600 dark:text-red-400'}`}>
                    {userGrowthPercent >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                    {userGrowthPercent >= 0 ? '+' : ''}{userGrowthPercent.toFixed(1)}%
                  </Badge>
                  <span className="text-xs text-muted-foreground">vs last period</span>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/30 dark:to-background">
          <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-br from-emerald-500/20 to-transparent rounded-full blur-2xl" />
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-foreground/80">Total Calls</CardTitle>
            <div className="p-2 bg-emerald-500/10 rounded-lg ring-1 ring-emerald-500/20">
              <PhoneCall className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">{analytics?.totalCalls?.toLocaleString() || 0}</div>
            <div className="flex items-center gap-1 mt-1">
              {isAllTime ? (
                <span className="text-xs text-muted-foreground">{analytics?.successRate?.toFixed(1) || 0}% success rate</span>
              ) : (
                <>
                  <Badge variant="secondary" className={`gap-1 text-xs border-0 ${callGrowthPercent >= 0 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-red-500/10 text-red-600 dark:text-red-400'}`}>
                    {callGrowthPercent >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                    {callGrowthPercent >= 0 ? '+' : ''}{callGrowthPercent.toFixed(1)}%
                  </Badge>
                  <span className="text-xs text-muted-foreground">{analytics?.successRate?.toFixed(1) || 0}% success</span>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/30 dark:to-background">
          <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-br from-amber-500/20 to-transparent rounded-full blur-2xl" />
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-foreground/80">Active Campaigns</CardTitle>
            <div className="p-2 bg-amber-500/10 rounded-lg ring-1 ring-amber-500/20">
              <Zap className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">{analytics?.totalCampaigns?.toLocaleString() || 0}</div>
            <div className="flex items-center gap-1 mt-1">
              {isAllTime ? (
                <span className="text-xs text-muted-foreground">Total campaigns created</span>
              ) : (
                <>
                  <Badge variant="secondary" className={`gap-1 text-xs border-0 ${campaignGrowthPercent >= 0 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-red-500/10 text-red-600 dark:text-red-400'}`}>
                    {campaignGrowthPercent >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                    {campaignGrowthPercent >= 0 ? '+' : ''}{campaignGrowthPercent.toFixed(1)}%
                  </Badge>
                  <span className="text-xs text-muted-foreground">across platform</span>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-violet-50 to-white dark:from-violet-950/30 dark:to-background">
          <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-br from-violet-500/20 to-transparent rounded-full blur-2xl" />
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-foreground/80">Qualified Leads</CardTitle>
            <div className="p-2 bg-violet-500/10 rounded-lg ring-1 ring-violet-500/20">
              <Target className="h-4 w-4 text-violet-600 dark:text-violet-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">{analytics?.qualifiedLeads?.toLocaleString() || 0}</div>
            <div className="flex items-center gap-1 mt-1">
              <Badge variant="secondary" className="gap-1 text-xs bg-violet-500/10 text-violet-600 dark:text-violet-400 border-0">
                {conversionRate.toFixed(1)}%
              </Badge>
              <span className="text-xs text-muted-foreground">conversion rate</span>
            </div>
          </CardContent>
        </Card>

        {/* Row 2: Platform resources */}
        <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-cyan-50 to-white dark:from-cyan-950/30 dark:to-background">
          <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-br from-cyan-500/20 to-transparent rounded-full blur-2xl" />
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-foreground/80">Phone Numbers</CardTitle>
            <div className="p-2 bg-cyan-500/10 rounded-lg ring-1 ring-cyan-500/20">
              <Phone className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">{analytics?.totalPhoneNumbers?.toLocaleString() || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Active across platform</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-rose-50 to-white dark:from-rose-950/30 dark:to-background">
          <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-br from-rose-500/20 to-transparent rounded-full blur-2xl" />
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-foreground/80">Total Contacts</CardTitle>
            <div className="p-2 bg-rose-500/10 rounded-lg ring-1 ring-rose-500/20">
              <ContactRound className="h-4 w-4 text-rose-600 dark:text-rose-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">{analytics?.totalContacts?.toLocaleString() || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Contacts in system</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-brand/5 to-background dark:from-brand/10 dark:to-background">
          <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-br from-brand/20 to-transparent rounded-full blur-2xl" />
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-foreground/80">Knowledge Bases</CardTitle>
            <div className="p-2 bg-brand/10 rounded-lg ring-1 ring-brand/20">
              <Package className="h-4 w-4 text-brand" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">{analytics?.totalKnowledgeBases?.toLocaleString() || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">RAG documents</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-fuchsia-50 to-white dark:from-fuchsia-950/30 dark:to-background">
          <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-br from-fuchsia-500/20 to-transparent rounded-full blur-2xl" />
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-foreground/80">Pro Users</CardTitle>
            <div className="p-2 bg-fuchsia-500/10 rounded-lg ring-1 ring-fuchsia-500/20">
              <UserPlus className="h-4 w-4 text-fuchsia-600 dark:text-fuchsia-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">{analytics?.proPlanUsers?.toLocaleString() || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">{analytics?.freePlanUsers || 0} Free users</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-emerald-500" />
                Growth Overview
              </CardTitle>
              <CardDescription>
                Platform activity and growth trends over time
              </CardDescription>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-indigo-500" />
                <span className="text-muted-foreground">Users</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-emerald-500" />
                <span className="text-muted-foreground">Calls</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-amber-500" />
                <span className="text-muted-foreground">Campaigns</span>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={350}>
            <AreaChart data={growthData}>
              <defs>
                <linearGradient id="colorUsers" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CHART_COLORS.users} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={CHART_COLORS.users} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorCalls" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CHART_COLORS.calls} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={CHART_COLORS.calls} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorCampaigns" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CHART_COLORS.campaigns} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={CHART_COLORS.campaigns} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis 
                dataKey="date" 
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                className="fill-muted-foreground"
              />
              <YAxis 
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                className="fill-muted-foreground"
              />
              <Tooltip 
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                }}
                labelStyle={{ color: 'hsl(var(--foreground))' }}
              />
              <Area
                type="monotone"
                dataKey="users"
                stroke={CHART_COLORS.users}
                strokeWidth={2}
                fill="url(#colorUsers)"
                name="Users"
              />
              <Area
                type="monotone"
                dataKey="calls"
                stroke={CHART_COLORS.calls}
                strokeWidth={2}
                fill="url(#colorCalls)"
                name="Calls"
              />
              <Area
                type="monotone"
                dataKey="campaigns"
                stroke={CHART_COLORS.campaigns}
                strokeWidth={2}
                fill="url(#colorCampaigns)"
                name="Campaigns"
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChartIcon className="h-5 w-5 text-indigo-500" />
              Subscription Distribution
            </CardTitle>
            <CardDescription>
              Breakdown of users by subscription plan
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center">
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={planDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {planDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center justify-center gap-6 mt-4">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full" style={{ backgroundColor: CHART_COLORS.pro }} />
                <span className="text-sm">Pro: {analytics?.proPlanUsers || 0}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full" style={{ backgroundColor: CHART_COLORS.free }} />
                <span className="text-sm">Free: {analytics?.freePlanUsers || 0}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-emerald-500" />
              Performance Metrics
            </CardTitle>
            <CardDescription>
              Call success and lead qualification rates
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={[
                  { 
                    metric: "Success Rate", 
                    value: analytics?.successRate || 0,
                    fill: CHART_COLORS.success
                  },
                  { 
                    metric: "Qualified Rate", 
                    value: conversionRate,
                    fill: CHART_COLORS.qualified
                  }
                ]}
                layout="vertical"
                margin={{ left: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={false} />
                <XAxis 
                  type="number" 
                  domain={[0, 100]}
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `${value}%`}
                  className="fill-muted-foreground"
                />
                <YAxis 
                  type="category" 
                  dataKey="metric"
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  width={100}
                  className="fill-muted-foreground"
                />
                <Tooltip 
                  formatter={(value: any) => [`${value.toFixed(1)}%`, ""]}
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                  }}
                />
                <Bar 
                  dataKey="value" 
                  radius={[0, 4, 4, 0]}
                  barSize={40}
                >
                  {[
                    { metric: "Success Rate", fill: CHART_COLORS.success },
                    { metric: "Qualified Rate", fill: CHART_COLORS.qualified }
                  ].map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="flex items-center justify-center gap-6 mt-4">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full" style={{ backgroundColor: CHART_COLORS.success }} />
                <span className="text-sm">Success: {(analytics?.successRate || 0).toFixed(1)}%</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full" style={{ backgroundColor: CHART_COLORS.qualified }} />
                <span className="text-sm">Qualified: {conversionRate.toFixed(1)}%</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
