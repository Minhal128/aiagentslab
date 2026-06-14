'use strict';
import { db } from "../db";
import { 
  users, calls, campaigns, contacts, phoneNumbers, knowledgeBase,
  userSubscriptions, plans, incomingConnections, twilioOpenaiCalls, plivoCalls, sipCalls,
  appointments, forms, formSubmissions, webhookSubscriptions, promptTemplates,
  type Call, type User, type Campaign
} from "@shared/schema";
import { eq, sql, and, gte, lte, lt, desc, isNull, isNotNull, or, inArray } from "drizzle-orm";

export interface GrowthDataPoint {
  date: string;
  users: number;
  calls: number;
  campaigns: number;
}

export interface GlobalAnalyticsResult {
  totalUsers: number;
  totalCampaigns: number;
  totalCalls: number;
  successRate: number;
  qualifiedLeads: number;
  activeUsers: number;
  proPlanUsers: number;
  freePlanUsers: number;
  totalPhoneNumbers: number;
  totalContacts: number;
  totalKnowledgeBases: number;
  growthData: GrowthDataPoint[];
  userGrowthPercent: number;
  callGrowthPercent: number;
  campaignGrowthPercent: number;
}

export interface LeadDistributionItem {
  name: string;
  value: number;
}

export interface CampaignPerformanceItem {
  name: string;
  value: number;
  totalCalls: number;
  completedCalls: number;
}

export interface DailyCallsItem {
  date: string;
  count: number;
}

export interface TypeBreakdown {
  incoming: number;
  outgoing: number;
  batch: number;
  total: number;
}

export interface UserAnalyticsResult {
  totalCalls: number;
  successRate: number;
  qualifiedLeads: number;
  avgDuration: number;
  leadDistribution: LeadDistributionItem[];
  sentimentDistribution: LeadDistributionItem[];
  campaignPerformance: CampaignPerformanceItem[];
  dailyCalls: DailyCallsItem[];
  typeBreakdown: TypeBreakdown;
}

export interface CallTypeStats {
  count: number;
  trend: number;
  successRate: number;
  avgDuration: number;
}

export interface CampaignStats {
  count: number;
  active: number;
  completed: number;
  successRate: number;
  avgDuration: number;
  totalCalls: number;
}

export interface DailyBreakdownItem {
  date: string;
  incoming: number;
  outgoing: number;
}

export interface RecentCallItem {
  id: string;
  phoneNumber: string | null;
  status: string;
  duration: number | null;
  classification: string | null;
  callDirection: string | null;
  createdAt: Date;
  campaignId: string | null;
  incomingConnectionId: string | null;
  metadata: unknown;
  callType: string;
}

export interface DashboardDataResult {
  callTypeStats: {
    incoming: CallTypeStats;
    outgoing: CallTypeStats;
    campaign: CampaignStats;
  };
  weeklyCallsChart: DailyBreakdownItem[];
  leadDistribution: {
    hot: number;
    warm: number;
    cold: number;
    lost: number;
  };
  sentimentDistribution: {
    positive: number;
    neutral: number;
    negative: number;
  };
  recentCalls: RecentCallItem[];
  recentUsers: Array<{ id: string; email: string; createdAt: Date | null }>;
  userName: string;
  totalCalls: number;
  totalThisWeek: number;
  totalPrevWeek: number;
  weeklyTrend: number;
  appointmentsBooked: number;
  formsSubmitted: number;
  formsCount: number;
  knowledgeBaseCount: number;
  webhooksCount: number;
  templatesCount: number;
}

export async function calculateGlobalAnalytics(timeRange: string): Promise<GlobalAnalyticsResult> {
  const now = new Date();
  let startDate: Date;
  let previousStartDate: Date;
  let previousEndDate: Date;
  let groupByWeek = false;
  let isAllTime = false;
  
  switch (timeRange) {
    case '7d':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      previousEndDate = new Date(startDate.getTime());
      previousStartDate = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      break;
    case '30d':
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      previousEndDate = new Date(startDate.getTime());
      previousStartDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
      break;
    case '90d':
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      previousEndDate = new Date(startDate.getTime());
      previousStartDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
      groupByWeek = true;
      break;
    case 'all':
      startDate = new Date(0);
      previousStartDate = new Date(0);
      previousEndDate = new Date(0);
      groupByWeek = true;
      isAllTime = true;
      break;
    default:
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      previousEndDate = new Date(startDate.getTime());
      previousStartDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  }
  
  const allUsers = await db.select().from(users);
  const allPhoneNumbers = await db.select().from(phoneNumbers);
  const allContacts = await db.select().from(contacts);
  const allKnowledgeBases = await db.select().from(knowledgeBase);
  
  let filteredCalls: Call[] = [];
  const filteredCampaigns = await db.select().from(campaigns).where(gte(campaigns.createdAt, startDate));
  const filteredUsers = await db.select().from(users).where(gte(users.createdAt, startDate));
  
  try {
    filteredCalls = await db.select().from(calls).where(gte(calls.createdAt, startDate));
  } catch (callFetchError: any) {
    if (callFetchError?.code === '42703') {
      console.warn('[GlobalAnalytics] Missing database column (run pre-upgrade-cleanup.sql then drizzle-kit push):', callFetchError.message);
    } else {
      console.error('[GlobalAnalytics] Error fetching filtered calls:', callFetchError.message);
    }
  }

  let previousUsers: User[] = [];
  let previousCalls: Call[] = [];
  let previousCampaigns: Campaign[] = [];
  
  if (!isAllTime) {
    previousUsers = await db.select().from(users).where(
      and(gte(users.createdAt, previousStartDate), lt(users.createdAt, previousEndDate))
    );
    try {
      previousCalls = await db.select().from(calls).where(
        and(gte(calls.createdAt, previousStartDate), lt(calls.createdAt, previousEndDate))
      );
    } catch (callFetchError: any) {
      if (callFetchError?.code === '42703') {
        console.warn('[GlobalAnalytics] Missing database column for previous calls:', callFetchError.message);
      } else {
        console.error('[GlobalAnalytics] Error fetching previous calls:', callFetchError.message);
      }
    }
    previousCampaigns = await db.select().from(campaigns).where(
      and(gte(campaigns.createdAt, previousStartDate), lt(campaigns.createdAt, previousEndDate))
    );
  }
  
  const calculateGrowthPercent = (current: number, previous: number): number => {
    if (previous === 0) {
      return current > 0 ? 100 : 0;
    }
    return ((current - previous) / previous) * 100;
  };
  
  const userGrowthPercent = isAllTime ? 0 : calculateGrowthPercent(filteredUsers.length, previousUsers.length);
  const callGrowthPercent = isAllTime ? 0 : calculateGrowthPercent(filteredCalls.length, previousCalls.length);
  const campaignGrowthPercent = isAllTime ? 0 : calculateGrowthPercent(filteredCampaigns.length, previousCampaigns.length);
  
  const totalCalls = filteredCalls.length;
  const completedCalls = filteredCalls.filter(c => c.status === 'completed').length;
  const successRate = totalCalls > 0 ? (completedCalls / totalCalls) * 100 : 0;
  const qualifiedLeads = filteredCalls.filter(c => c.classification === 'hot' || c.classification === 'warm').length;
  
  const growthData = calculateGrowthData(
    filteredUsers, filteredCalls, filteredCampaigns,
    startDate, now, groupByWeek, isAllTime
  );
  
  const activeSubscriptions = await db
    .select({
      userId: userSubscriptions.userId,
      planName: plans.name,
      status: userSubscriptions.status,
      currentPeriodEnd: userSubscriptions.currentPeriodEnd,
    })
    .from(userSubscriptions)
    .innerJoin(plans, eq(userSubscriptions.planId, plans.id))
    .where(
      and(
        eq(userSubscriptions.status, 'active'),
        or(
          isNull(userSubscriptions.currentPeriodEnd),
          gte(userSubscriptions.currentPeriodEnd, now)
        )
      )
    );
  
  const proUserIds = new Set<string>();
  for (const sub of activeSubscriptions) {
    if (sub.planName !== 'free') {
      proUserIds.add(sub.userId);
    }
  }
  
  const proPlanUsers = proUserIds.size;
  const freePlanUsers = allUsers.length - proPlanUsers;
  
  return {
    totalUsers: filteredUsers.length,
    totalCampaigns: filteredCampaigns.length,
    totalCalls,
    successRate,
    qualifiedLeads,
    activeUsers: filteredUsers.filter(u => u.isActive).length,
    proPlanUsers,
    freePlanUsers,
    totalPhoneNumbers: allPhoneNumbers.length,
    totalContacts: allContacts.length,
    totalKnowledgeBases: allKnowledgeBases.length,
    growthData,
    userGrowthPercent: Math.round(userGrowthPercent * 10) / 10,
    callGrowthPercent: Math.round(callGrowthPercent * 10) / 10,
    campaignGrowthPercent: Math.round(campaignGrowthPercent * 10) / 10
  };
}

function calculateGrowthData(
  filteredUsers: User[],
  filteredCalls: Call[],
  filteredCampaigns: Campaign[],
  startDate: Date,
  now: Date,
  groupByWeek: boolean,
  isAllTime: boolean
): GrowthDataPoint[] {
  const growthMap = new Map<string, { users: number; calls: number; campaigns: number }>();
  
  const getIsoDateKey = (date: Date): string => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d.toISOString().split('T')[0];
  };
  
  const getMonthKey = (date: Date): string => {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  
  const formatDateLabel = (isoDate: string, isMonthly: boolean = false): string => {
    if (isMonthly) {
      const [year, month] = isoDate.split('-');
      const d = new Date(parseInt(year), parseInt(month) - 1, 1);
      return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    }
    const d = new Date(isoDate + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  
  let chartStartDate = startDate;
  let useMonthlyBuckets = false;
  
  if (isAllTime) {
    const allDates: Date[] = [];
    for (const user of filteredUsers) {
      if (user.createdAt) allDates.push(new Date(user.createdAt));
    }
    for (const call of filteredCalls) {
      if (call.createdAt) allDates.push(new Date(call.createdAt));
    }
    for (const campaign of filteredCampaigns) {
      if (campaign.createdAt) allDates.push(new Date(campaign.createdAt));
    }
    
    if (allDates.length > 0) {
      chartStartDate = allDates.reduce((min, d) => d < min ? d : min, allDates[0]);
      chartStartDate = new Date(chartStartDate.getFullYear(), chartStartDate.getMonth(), 1);
    } else {
      chartStartDate = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    }
    useMonthlyBuckets = true;
  }
  
  const startDateIso = useMonthlyBuckets ? getMonthKey(chartStartDate) : getIsoDateKey(chartStartDate);
  const nowDateIso = useMonthlyBuckets ? getMonthKey(now) : getIsoDateKey(now);
  
  const bucketKeys: string[] = [];
  const currentDate = new Date(chartStartDate);
  currentDate.setHours(0, 0, 0, 0);
  
  if (useMonthlyBuckets) {
    while (getMonthKey(currentDate) <= nowDateIso) {
      bucketKeys.push(getMonthKey(currentDate));
      currentDate.setMonth(currentDate.getMonth() + 1);
    }
  } else {
    const interval = groupByWeek ? 7 : 1;
    while (getIsoDateKey(currentDate) <= nowDateIso) {
      bucketKeys.push(getIsoDateKey(currentDate));
      currentDate.setDate(currentDate.getDate() + interval);
    }
  }
  
  if (bucketKeys.length === 0) {
    bucketKeys.push(startDateIso);
  }
  
  for (const key of bucketKeys) {
    growthMap.set(key, { users: 0, calls: 0, campaigns: 0 });
  }
  
  const getBucketKey = (date: Date): string | null => {
    if (useMonthlyBuckets) {
      const monthKey = getMonthKey(date);
      if (monthKey < startDateIso || monthKey > nowDateIso) {
        return null;
      }
      return growthMap.has(monthKey) ? monthKey : null;
    }
    
    const dateKey = getIsoDateKey(date);
    if (dateKey < startDateIso || dateKey > nowDateIso) {
      return null;
    }
    
    if (groupByWeek) {
      for (let i = bucketKeys.length - 1; i >= 0; i--) {
        if (dateKey >= bucketKeys[i]) {
          return bucketKeys[i];
        }
      }
      return bucketKeys[0];
    } else {
      return growthMap.has(dateKey) ? dateKey : null;
    }
  };
  
  for (const user of filteredUsers) {
    if (user.createdAt) {
      const bucketKey = getBucketKey(new Date(user.createdAt));
      if (bucketKey) {
        const entry = growthMap.get(bucketKey);
        if (entry) entry.users++;
      }
    }
  }
  
  for (const call of filteredCalls) {
    if (call.createdAt) {
      const bucketKey = getBucketKey(new Date(call.createdAt));
      if (bucketKey) {
        const entry = growthMap.get(bucketKey);
        if (entry) entry.calls++;
      }
    }
  }
  
  for (const campaign of filteredCampaigns) {
    if (campaign.createdAt) {
      const bucketKey = getBucketKey(new Date(campaign.createdAt));
      if (bucketKey) {
        const entry = growthMap.get(bucketKey);
        if (entry) entry.campaigns++;
      }
    }
  }
  
  return Array.from(growthMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([isoDate, data]) => ({ 
      date: formatDateLabel(isoDate, useMonthlyBuckets),
      ...data 
    }));
}

export async function calculateUserAnalytics(userId: string, timeRange: string = '7days', callType: string = 'all'): Promise<UserAnalyticsResult> {
  const now = new Date();
  let startDate = new Date();
  
  switch(timeRange) {
    case '7days': startDate.setDate(now.getDate() - 7); break;
    case '30days': startDate.setDate(now.getDate() - 30); break;
    case '90days': startDate.setDate(now.getDate() - 90); break;
    case 'year': startDate.setFullYear(now.getFullYear() - 1); break;
    case 'all': startDate = new Date(0); break;
    default: startDate.setDate(now.getDate() - 7);
  }

  const userCampaigns = await db.select().from(campaigns).where(eq(campaigns.userId, userId));
  const campaignIds = userCampaigns.map(c => c.id);

  const userIncomingConnections = await db.select().from(incomingConnections).where(eq(incomingConnections.userId, userId));
  const incomingConnectionIds = userIncomingConnections.map(c => c.id);

  let allUserCalls: Call[] = [];
  
  try {
    const directOwnershipCalls = await db.select()
      .from(calls)
      .where(and(eq(calls.userId, userId), gte(calls.createdAt, startDate)));
    allUserCalls.push(...directOwnershipCalls);
    
    if (campaignIds.length > 0) {
      const campaignCalls = await db.select()
        .from(calls)
        .where(and(inArray(calls.campaignId, campaignIds), gte(calls.createdAt, startDate)));
      for (const call of campaignCalls) {
        if (!allUserCalls.find(c => c.id === call.id)) {
          allUserCalls.push(call);
        }
      }
    }
    
    if (incomingConnectionIds.length > 0) {
      const incomingCalls = await db.select()
        .from(calls)
        .where(and(inArray(calls.incomingConnectionId, incomingConnectionIds), gte(calls.createdAt, startDate)));
      for (const call of incomingCalls) {
        if (!allUserCalls.find(c => c.id === call.id)) {
          allUserCalls.push(call);
        }
      }
    }

    const twilioOpenAICallsData = await db.select()
      .from(twilioOpenaiCalls)
      .where(and(eq(twilioOpenaiCalls.userId, userId), gte(twilioOpenaiCalls.createdAt, startDate)));

    for (const toc of twilioOpenAICallsData) {
      allUserCalls.push({
        id: toc.id,
        userId: toc.userId,
        campaignId: toc.campaignId,
        contactId: toc.contactId,
        phoneNumber: toc.fromNumber,
        status: toc.status,
        callDirection: toc.callDirection,
        duration: toc.duration,
        classification: null,
        sentiment: toc.sentiment,
        createdAt: toc.createdAt,
        metadata: toc.metadata,
        incomingConnectionId: null,
      } as Call);
    }

    const plivoAnalyticsCallsData = await db.select()
      .from(plivoCalls)
      .where(and(eq(plivoCalls.userId, userId), gte(plivoCalls.createdAt, startDate)));

    for (const pc of plivoAnalyticsCallsData) {
      allUserCalls.push({
        id: pc.id,
        userId: pc.userId,
        campaignId: pc.campaignId,
        contactId: pc.contactId,
        phoneNumber: pc.fromNumber,
        status: pc.status,
        callDirection: pc.callDirection,
        duration: pc.duration,
        classification: null,
        sentiment: pc.sentiment,
        createdAt: pc.createdAt,
        metadata: pc.metadata,
        incomingConnectionId: null,
      } as Call);
    }
  } catch (callFetchError: any) {
    if (callFetchError?.code === '42703') {
      console.warn('[Analytics] Missing database column (run pre-upgrade-cleanup.sql then drizzle-kit push):', callFetchError.message);
    } else {
      console.error('[Analytics] Error fetching calls:', callFetchError.message);
    }
  }

  const isBatchCall = (c: Call): boolean => {
    const meta = c.metadata as Record<string, any> | null;
    return !!(meta?.batch_call || meta?.batchId || meta?.batch_calling);
  };

  const incomingDirections = ['incoming', 'inbound', 'bridged', 'simulcall'];
  const outgoingDirections = ['outgoing', 'outbound'];
  
  const isIncomingCall = (c: Call): boolean => 
    incomingDirections.includes(c.callDirection || '') || !!c.incomingConnectionId;
  
  const isOutgoingCall = (c: Call): boolean => {
    if (isBatchCall(c)) return false;
    if (outgoingDirections.includes(c.callDirection || '')) return true;
    if (c.campaignId && !c.incomingConnectionId && !incomingDirections.includes(c.callDirection || '')) return true;
    if (!isIncomingCall(c)) return true;
    return false;
  };

  let filteredCalls = allUserCalls;
  if (callType === 'incoming') filteredCalls = allUserCalls.filter(isIncomingCall);
  else if (callType === 'outgoing') filteredCalls = allUserCalls.filter(isOutgoingCall);
  else if (callType === 'batch') filteredCalls = allUserCalls.filter(isBatchCall);

  const allCalls = filteredCalls;
  
  const typeBreakdown = {
    incoming: allUserCalls.filter(isIncomingCall).length,
    outgoing: allUserCalls.filter(isOutgoingCall).length,
    batch: allUserCalls.filter(isBatchCall).length,
    total: allUserCalls.length
  };

  const totalCalls = allCalls.length;
  const completedCalls = allCalls.filter(c => c.status === 'completed').length;
  const successRate = totalCalls > 0 ? (completedCalls / totalCalls) * 100 : 0;
  
  const qualifiedLeads = allCalls.filter(c => 
    c.classification === 'hot' || c.classification === 'warm'
  ).length;
  
  const totalDuration = allCalls.reduce((sum, call) => sum + (call.duration || 0), 0);
  const avgDuration = totalCalls > 0 ? totalDuration / totalCalls : 0;

  const leadCounts = {
    hot: allCalls.filter(c => c.classification === 'hot' || c.classification === 'qualified').length,
    warm: allCalls.filter(c => c.classification === 'warm' || c.classification === 'interested').length,
    cold: allCalls.filter(c => c.classification === 'cold' || c.classification === 'not_interested').length,
    lost: allCalls.filter(c => c.classification === 'lost' || c.classification === 'do_not_call').length
  };

  const leadDistribution = [
    { name: 'Hot', value: leadCounts.hot },
    { name: 'Warm', value: leadCounts.warm },
    { name: 'Cold', value: leadCounts.cold },
    { name: 'Lost', value: leadCounts.lost }
  ].filter(item => item.value > 0);

  const sentimentCounts = {
    positive: allCalls.filter(c => c.sentiment === 'positive').length,
    neutral: allCalls.filter(c => c.sentiment === 'neutral').length,
    negative: allCalls.filter(c => c.sentiment === 'negative').length
  };

  const sentimentDistribution = [
    { name: 'Positive', value: sentimentCounts.positive },
    { name: 'Neutral', value: sentimentCounts.neutral },
    { name: 'Negative', value: sentimentCounts.negative }
  ].filter(item => item.value > 0);

  const campaignPerformance = userCampaigns.map(campaign => {
    const campaignCalls = allCalls.filter(c => c.campaignId === campaign.id);
    const completed = campaignCalls.filter(c => c.status === 'completed').length;
    const total = campaignCalls.length;
    const rate = total > 0 ? (completed / total) * 100 : 0;
    
    return {
      name: campaign.name,
      value: parseFloat(rate.toFixed(1)),
      totalCalls: total,
      completedCalls: completed
    };
  });

  const dailyCalls = calculateDailyCalls(allCalls, timeRange);

  return {
    totalCalls,
    successRate: parseFloat(successRate.toFixed(1)),
    qualifiedLeads,
    avgDuration: Math.round(avgDuration),
    leadDistribution,
    sentimentDistribution,
    campaignPerformance,
    dailyCalls,
    typeBreakdown
  };
}

function calculateDailyCalls(allCalls: Call[], timeRange: string): { date: string; count: number }[] {
  const dailyCalls: { date: string; count: number }[] = [];
  
  let daysToShow = 7;
  if (timeRange === '30days') daysToShow = 30;
  else if (timeRange === '90days') daysToShow = 90;
  else if (timeRange === 'year') daysToShow = 365;
  
  if (daysToShow <= 14) {
    for (let i = daysToShow - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      
      const nextDay = new Date(date);
      nextDay.setDate(nextDay.getDate() + 1);
      
      const dayCount = allCalls.filter(call => {
        const callDate = new Date(call.createdAt);
        return callDate >= date && callDate < nextDay;
      }).length;
      
      dailyCalls.push({ date: date.toISOString(), count: dayCount });
    }
  } else if (daysToShow <= 90) {
    const weeksToShow = Math.ceil(daysToShow / 7);
    for (let i = weeksToShow - 1; i >= 0; i--) {
      const weekEnd = new Date();
      weekEnd.setDate(weekEnd.getDate() - (i * 7));
      weekEnd.setHours(23, 59, 59, 999);
      
      const weekStart = new Date(weekEnd);
      weekStart.setDate(weekStart.getDate() - 6);
      weekStart.setHours(0, 0, 0, 0);
      
      const weekCount = allCalls.filter(call => {
        const callDate = new Date(call.createdAt);
        return callDate >= weekStart && callDate <= weekEnd;
      }).length;
      
      dailyCalls.push({ date: weekStart.toISOString(), count: weekCount });
    }
  } else {
    for (let i = 11; i >= 0; i--) {
      const monthStart = new Date();
      monthStart.setMonth(monthStart.getMonth() - i);
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      
      const monthEnd = new Date(monthStart);
      monthEnd.setMonth(monthEnd.getMonth() + 1);
      monthEnd.setDate(0);
      monthEnd.setHours(23, 59, 59, 999);
      
      const monthCount = allCalls.filter(call => {
        const callDate = new Date(call.createdAt);
        return callDate >= monthStart && callDate <= monthEnd;
      }).length;
      
      dailyCalls.push({ date: monthStart.toISOString(), count: monthCount });
    }
  }

  return dailyCalls;
}

export async function calculateDashboardData(userId: string): Promise<DashboardDataResult> {
  const now = new Date();
  const weekAgo = new Date();
  weekAgo.setDate(now.getDate() - 7);

  const userCampaigns = await db.select().from(campaigns).where(eq(campaigns.userId, userId));
  const campaignIds = userCampaigns.map(c => c.id);

  const userIncomingConnections = await db.select().from(incomingConnections).where(eq(incomingConnections.userId, userId));
  const incomingConnectionIds = userIncomingConnections.map(c => c.id);

  let allUserCalls: Call[] = [];
  
  try {
    const directOwnershipCalls = await db.select().from(calls).where(eq(calls.userId, userId));
    allUserCalls.push(...directOwnershipCalls);
    
    if (campaignIds.length > 0) {
      const campaignCalls = await db.select().from(calls).where(inArray(calls.campaignId, campaignIds));
      for (const call of campaignCalls) {
        if (!allUserCalls.find(c => c.id === call.id)) {
          allUserCalls.push(call);
        }
      }
    }
    
    if (incomingConnectionIds.length > 0) {
      const incomingCalls = await db.select().from(calls).where(inArray(calls.incomingConnectionId, incomingConnectionIds));
      for (const call of incomingCalls) {
        if (!allUserCalls.find(c => c.id === call.id)) {
          allUserCalls.push(call);
        }
      }
    }

    const twilioOpenAICallsData = await db.select().from(twilioOpenaiCalls).where(eq(twilioOpenaiCalls.userId, userId));
    for (const toc of twilioOpenAICallsData) {
      allUserCalls.push({
        id: toc.id,
        userId: toc.userId,
        campaignId: toc.campaignId,
        contactId: toc.contactId,
        phoneNumber: toc.fromNumber,
        status: toc.status,
        callDirection: toc.callDirection,
        duration: toc.duration,
        classification: toc.classification,
        sentiment: toc.sentiment,
        createdAt: toc.createdAt,
        metadata: toc.metadata,
        incomingConnectionId: null,
      } as Call);
    }

    const plivoCallsData = await db.select().from(plivoCalls).where(eq(plivoCalls.userId, userId));
    for (const pc of plivoCallsData) {
      allUserCalls.push({
        id: pc.id,
        userId: pc.userId,
        campaignId: pc.campaignId,
        contactId: pc.contactId,
        phoneNumber: pc.fromNumber,
        status: pc.status,
        callDirection: pc.callDirection,
        duration: pc.duration,
        classification: pc.classification,
        sentiment: pc.sentiment,
        createdAt: pc.createdAt,
        metadata: pc.metadata,
        incomingConnectionId: null,
      } as Call);
    }

    const sipCallsData = await db.select().from(sipCalls).where(eq(sipCalls.userId, userId));
    for (const sc of sipCallsData) {
      allUserCalls.push({
        id: sc.id,
        userId: sc.userId,
        campaignId: sc.campaignId,
        contactId: sc.contactId,
        phoneNumber: sc.direction === 'inbound' ? sc.fromNumber : sc.toNumber,
        status: sc.status,
        callDirection: sc.direction === 'inbound' ? 'incoming' : 'outgoing',
        duration: sc.durationSeconds,
        classification: null,
        sentiment: null,
        createdAt: sc.createdAt,
        metadata: sc.metadata,
        incomingConnectionId: null,
      } as Call);
    }
  } catch (callFetchError: any) {
    if (callFetchError?.code === '42703') {
      console.warn('[Dashboard] Missing database column (run pre-upgrade-cleanup.sql then drizzle-kit push):', callFetchError.message);
    } else {
      console.error('[Dashboard] Error fetching calls:', callFetchError.message);
    }
  }

  const incomingDirections = ['incoming', 'inbound', 'bridged', 'simulcall'];
  const outgoingDirections = ['outgoing', 'outbound'];
  
  const isBatchCall = (c: Call): boolean => {
    const meta = c.metadata as Record<string, any> | null;
    return !!(meta?.batch_call || meta?.batchId || meta?.batch_calling);
  };

  const isIncomingCall = (c: Call): boolean => 
    incomingDirections.includes(c.callDirection || '') || !!c.incomingConnectionId;
  
  const isOutgoingCall = (c: Call): boolean => {
    if (isBatchCall(c)) return false;
    if (outgoingDirections.includes(c.callDirection || '')) return true;
    if (c.campaignId && !c.incomingConnectionId && !incomingDirections.includes(c.callDirection || '')) return true;
    if (!isIncomingCall(c)) return true;
    return false;
  };

  const prevWeekStart = new Date();
  prevWeekStart.setDate(now.getDate() - 14);
  
  const thisWeekCalls = allUserCalls.filter(c => new Date(c.createdAt) >= weekAgo);
  const prevWeekCalls = allUserCalls.filter(c => {
    const date = new Date(c.createdAt);
    return date >= prevWeekStart && date < weekAgo;
  });

  const incomingThisWeek = thisWeekCalls.filter(isIncomingCall);
  const outgoingThisWeek = thisWeekCalls.filter(isOutgoingCall);
  const incomingPrevWeek = prevWeekCalls.filter(isIncomingCall);
  const outgoingPrevWeek = prevWeekCalls.filter(isOutgoingCall);

  const calcTrend = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100);
  };

  const calcStats = (callList: Call[]) => {
    const completed = callList.filter(c => c.status === 'completed');
    const successRate = callList.length > 0 
      ? Math.round((completed.length / callList.length) * 100) 
      : 0;
    const avgDuration = completed.length > 0 
      ? Math.round(completed.reduce((sum, c) => sum + (c.duration || 0), 0) / completed.length)
      : 0;
    return { successRate, avgDuration };
  };

  const dailyBreakdown: Array<{ date: string; incoming: number; outgoing: number }> = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date();
    day.setDate(now.getDate() - i);
    day.setHours(0, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 999);

    const dayCalls = thisWeekCalls.filter(c => {
      const callDate = new Date(c.createdAt);
      return callDate >= day && callDate <= dayEnd;
    });

    dailyBreakdown.push({
      date: day.toISOString(),
      incoming: dayCalls.filter(isIncomingCall).length,
      outgoing: dayCalls.filter(isOutgoingCall).length
    });
  }

  const leadDistribution = {
    hot: allUserCalls.filter(c => c.classification?.toLowerCase() === 'hot' || c.classification?.toLowerCase() === 'qualified').length,
    warm: allUserCalls.filter(c => c.classification?.toLowerCase() === 'warm' || c.classification?.toLowerCase() === 'interested').length,
    cold: allUserCalls.filter(c => c.classification?.toLowerCase() === 'cold' || c.classification?.toLowerCase() === 'not_interested').length,
    lost: allUserCalls.filter(c => c.classification?.toLowerCase() === 'lost' || c.classification?.toLowerCase() === 'do_not_call').length
  };

  let recentCalls: Array<any> = [];
  try {
    recentCalls = await db.select({
      id: calls.id,
      phoneNumber: calls.phoneNumber,
      status: calls.status,
      duration: calls.duration,
      classification: calls.classification,
      callDirection: calls.callDirection,
      createdAt: calls.createdAt,
      campaignId: calls.campaignId,
      incomingConnectionId: calls.incomingConnectionId,
      metadata: calls.metadata
    })
    .from(calls)
    .where(eq(calls.userId, userId))
    .orderBy(desc(calls.createdAt))
    .limit(10);
  } catch (callFetchError: any) {
    if (callFetchError?.code === '42703') {
      console.warn('[Dashboard] Missing database column for recent calls:', callFetchError.message);
    } else {
      console.error('[Dashboard] Error fetching recent calls:', callFetchError.message);
    }
  }

  let recentUsers: Array<{ id: string; email: string; createdAt: Date | null }> = [];
  const [currentUser] = await db.select().from(users).where(eq(users.id, userId));
  if (currentUser?.role === 'admin' || currentUser?.role === 'super_admin') {
    recentUsers = await db.select({
      id: users.id,
      email: users.email,
      createdAt: users.createdAt
    })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(5);
  }

  const totalCampaigns = userCampaigns.length;
  const activeCampaigns = userCampaigns.filter(c => 
    c.status === 'in_progress' || c.status === 'scheduled' || c.status === 'pending'
  ).length;
  const completedCampaigns = userCampaigns.filter(c => c.status === 'completed').length;
  
  let allCampaignCalls: Call[] = [];
  if (campaignIds.length > 0) {
    try {
      allCampaignCalls = await db.select().from(calls).where(inArray(calls.campaignId, campaignIds));
    } catch (callFetchError: any) {
      if (callFetchError?.code === '42703') {
        console.warn('[Dashboard] Missing database column for campaign calls:', callFetchError.message);
      } else {
        console.error('[Dashboard] Error fetching campaign calls:', callFetchError.message);
      }
    }
  }
  
  const campaignCallsCompleted = allCampaignCalls.filter(c => c.status === 'completed');
  const campaignSuccessRate = allCampaignCalls.length > 0 
    ? Math.round((campaignCallsCompleted.length / allCampaignCalls.length) * 100)
    : 0;
  const campaignAvgDuration = campaignCallsCompleted.length > 0
    ? Math.round(campaignCallsCompleted.reduce((sum, c) => sum + (c.duration || 0), 0) / campaignCallsCompleted.length)
    : 0;

  const [appointmentsResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(appointments)
    .where(eq(appointments.userId, userId));
  const appointmentsCount = Number(appointmentsResult?.count || 0);

  const userForms = await db.select({ id: forms.id }).from(forms).where(eq(forms.userId, userId));
  const formsCount = userForms.length;
  
  let formSubmissionsCount = 0;
  if (userForms.length > 0) {
    const formIds = userForms.map(f => f.id);
    const [submissionsResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(formSubmissions)
      .where(inArray(formSubmissions.formId, formIds));
    formSubmissionsCount = Number(submissionsResult?.count || 0);
  }

  const [kbResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(knowledgeBase)
    .where(eq(knowledgeBase.userId, userId));
  const knowledgeBaseCount = Number(kbResult?.count || 0);

  const [webhooksResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(webhookSubscriptions)
    .where(eq(webhookSubscriptions.userId, userId));
  const webhooksCount = Number(webhooksResult?.count || 0);

  const [userTemplatesResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(promptTemplates)
    .where(eq(promptTemplates.userId, userId));
  const userTemplatesCount = Number(userTemplatesResult?.count || 0);
  
  const [systemTemplatesResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(promptTemplates)
    .where(eq(promptTemplates.isSystemTemplate, true));
  const systemTemplatesCount = Number(systemTemplatesResult?.count || 0);
  
  const templatesCount = userTemplatesCount + systemTemplatesCount;

  const sentimentDistribution = {
    positive: allUserCalls.filter(c => c.sentiment === 'positive').length,
    neutral: allUserCalls.filter(c => c.sentiment === 'neutral').length,
    negative: allUserCalls.filter(c => c.sentiment === 'negative').length
  };

  const incomingAllTime = allUserCalls.filter(isIncomingCall);
  const outgoingAllTime = allUserCalls.filter(isOutgoingCall);
  const incomingAllStats = calcStats(incomingAllTime);
  const outgoingAllStats = calcStats(outgoingAllTime);

  return {
    callTypeStats: {
      incoming: {
        count: incomingAllTime.length,
        trend: calcTrend(incomingThisWeek.length, incomingPrevWeek.length),
        successRate: incomingAllStats.successRate,
        avgDuration: incomingAllStats.avgDuration
      },
      outgoing: {
        count: outgoingAllTime.length,
        trend: calcTrend(outgoingThisWeek.length, outgoingPrevWeek.length),
        successRate: outgoingAllStats.successRate,
        avgDuration: outgoingAllStats.avgDuration
      },
      campaign: {
        count: totalCampaigns,
        active: activeCampaigns,
        completed: completedCampaigns,
        successRate: campaignSuccessRate,
        avgDuration: campaignAvgDuration,
        totalCalls: allCampaignCalls.length
      }
    },
    weeklyCallsChart: dailyBreakdown,
    leadDistribution,
    sentimentDistribution,
    recentCalls: recentCalls.map(c => ({
      ...c,
      callType: isBatchCall(c as Call) ? 'batch' : 
                (c.callDirection === 'incoming' || c.incomingConnectionId) ? 'incoming' : 'outgoing'
    })),
    recentUsers,
    userName: currentUser?.name || currentUser?.email?.split('@')[0] || 'User',
    totalCalls: allUserCalls.length,
    totalThisWeek: thisWeekCalls.length,
    totalPrevWeek: prevWeekCalls.length,
    weeklyTrend: calcTrend(thisWeekCalls.length, prevWeekCalls.length),
    appointmentsBooked: appointmentsCount,
    formsSubmitted: formSubmissionsCount,
    formsCount: formsCount,
    knowledgeBaseCount: knowledgeBaseCount,
    webhooksCount: webhooksCount,
    templatesCount: templatesCount
  };
}
