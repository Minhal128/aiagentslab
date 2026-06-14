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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, CreditCard, Settings, BarChart, Phone, Package, Bell, ListOrdered, Loader2, CheckCircle2, XCircle, ContactRound, DollarSign, RefreshCw, Server, Receipt, Mail, MessageSquare, Headphones, ShieldAlert, Brain, Power, Mic, Sparkles, Building2, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import UserManagement from "@/components/admin/UserManagement";
import PlanManagement from "@/components/admin/PlanManagement";
import LLMModelsManagement from "@/components/admin/LLMModelsManagement";
import CreditPackages from "@/components/admin/CreditPackages";
import SettingsPage from "@/components/admin/SettingsPage";
import Analytics from "@/components/admin/Analytics";
import PhoneNumbers from "@/components/admin/PhoneNumbers";
import Notifications from "@/components/admin/Notifications";
import BatchJobsMonitor from "@/components/admin/BatchJobsMonitor";
import AllContactsAdmin from "@/components/admin/AllContactsAdmin";
import PaymentsSettings from "@/components/admin/PaymentsSettings";
import TransactionsManagement from "@/components/admin/TransactionsManagement";
import CreditBackfillManagement from "@/components/admin/CreditBackfillManagement";
import EmailSettingsManagement from "@/components/admin/EmailSettingsManagement";
import CallMonitoring from "@/components/admin/CallMonitoring";
import BannedWordsManagement from "@/components/admin/BannedWordsManagement";
import OpenAIPoolManagement from "@/components/admin/OpenAIPoolManagement";
import PlivoSettings from "@/components/admin/PlivoSettings";
import { Badge } from "@/components/ui/badge";
import { Suspense } from "react";
import { usePluginRegistry } from "@/contexts/plugin-registry";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { AuthStorage } from "@/lib/auth-storage";
import { useToast } from "@/hooks/use-toast";
import { usePluginStatus } from "@/hooks/use-plugin-status";

interface ConnectionStatus {
  connected: boolean;
  error?: string;
  accountName?: string;
  accountStatus?: string;
  voiceCount?: number;
  details?: string;
}

export default function AdminDashboard() {
  const [location] = useLocation();
  const [activeTab, setActiveTab] = useState("analytics");
  const [twilioStatus, setTwilioStatus] = useState<ConnectionStatus | null>(null);
  const [elevenLabsStatus, setElevenLabsStatus] = useState<ConnectionStatus | null>(null);
  const [openaiStatus, setOpenaiStatus] = useState<ConnectionStatus | null>(null);
  const [openaiRealtimeStatus, setOpenaiRealtimeStatus] = useState<ConnectionStatus | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const { isTeamManagementPluginEnabled } = usePluginStatus();
  const pluginRegistry = usePluginRegistry();
  const adminMenuItems = pluginRegistry.getAdminMenuItems();
  const adminSettingsTabs = pluginRegistry.getAdminSettingsTabs();

  // Fetch application version
  const { data: versionData } = useQuery<{ version: string }>({
    queryKey: ["/api/system/version"],
    staleTime: Infinity,
  });

  // Get analytics summary
  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ["/api/admin/analytics"],
  });

  // Get global settings to check configuration
  // Auto-refresh every 60 minutes and on window focus to keep connection status current
  const { data: settings, isLoading: settingsLoading, refetch: refetchSettings, isFetching } = useQuery({
    queryKey: ["/api/admin/settings"],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/admin/settings?t=${Date.now()}`);
      if (!response.ok) {
        throw new Error('Failed to fetch settings');
      }
      return response.json();
    },
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: 60 * 60 * 1000, // 60 minutes
    staleTime: 0,
  });

  // Promise chain for serialized connection checks - ensures every trigger runs in order
  const checkChainRef = useRef<Promise<void>>(Promise.resolve());
  const wasFetchingRef = useRef(false);
  const hasCheckedRef = useRef(false);

  // Scroll state for admin tabs
  const tabsScrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Check scroll state
  const checkScrollState = () => {
    const container = tabsScrollRef.current;
    if (container) {
      setCanScrollLeft(container.scrollLeft > 0);
      setCanScrollRight(container.scrollLeft < container.scrollWidth - container.clientWidth - 1);
    }
  };

  // Scroll handlers
  const scrollLeft = () => {
    const container = tabsScrollRef.current;
    if (container) {
      container.scrollBy({ left: -200, behavior: 'smooth' });
    }
  };

  const scrollRight = () => {
    const container = tabsScrollRef.current;
    if (container) {
      container.scrollBy({ left: 200, behavior: 'smooth' });
    }
  };

  // Check scroll state on mount, resize, and when admin menu items change
  useEffect(() => {
    checkScrollState();
    window.addEventListener('resize', checkScrollState);
    return () => window.removeEventListener('resize', checkScrollState);
  }, [(Array.isArray(adminMenuItems) ? adminMenuItems : []).length]);

  // Perform the actual connection test - internal function
  const performConnectionCheck = async (settingsToUse: any): Promise<void> => {
    setCheckingStatus(true);
    
    try {
      // Test Twilio connection
      if (settingsToUse?.twilio_configured) {
        try {
          const twilioResponse = await apiRequest("POST", "/api/admin/test-connection/twilio");
          const twilioResult = await twilioResponse.json();
          setTwilioStatus(twilioResult as ConnectionStatus);
        } catch (err) {
          setTwilioStatus({ connected: false, error: `Test failed: ${err instanceof Error ? err.message : 'Unknown error'}` });
        }
      } else {
        setTwilioStatus({ connected: false, error: 'Not configured' });
      }

      // Test ElevenLabs connection
      if (settingsToUse?.elevenlabs_configured) {
        try {
          const elevenLabsResponse = await apiRequest("POST", "/api/admin/test-connection/elevenlabs");
          const elevenLabsResult = await elevenLabsResponse.json();
          setElevenLabsStatus(elevenLabsResult as ConnectionStatus);
        } catch (err) {
          setElevenLabsStatus({ connected: false, error: `Test failed: ${err instanceof Error ? err.message : 'Unknown error'}` });
        }
      } else {
        setElevenLabsStatus({ connected: false, error: 'Not configured' });
      }

      // Test OpenAI connection (embeddings/GPT models)
      if (settingsToUse?.openai_configured) {
        try {
          const openaiResponse = await apiRequest("POST", "/api/admin/test-connection/openai");
          const openaiResult = await openaiResponse.json();
          setOpenaiStatus(openaiResult as ConnectionStatus);
        } catch (err) {
          setOpenaiStatus({ connected: false, error: `Test failed: ${err instanceof Error ? err.message : 'Unknown error'}` });
        }
      } else {
        setOpenaiStatus({ connected: false, error: 'Not configured' });
      }

      // Test OpenAI Realtime Voice API connection
      if (settingsToUse?.openai_realtime_configured) {
        try {
          const realtimeResponse = await apiRequest("POST", "/api/admin/test-connection/openai-realtime");
          const realtimeResult = await realtimeResponse.json();
          setOpenaiRealtimeStatus(realtimeResult as ConnectionStatus);
        } catch (err) {
          setOpenaiRealtimeStatus({ connected: false, error: `Test failed: ${err instanceof Error ? err.message : 'Unknown error'}` });
        }
      } else {
        setOpenaiRealtimeStatus({ connected: false, error: 'Not configured' });
      }
    } catch (error) {
      console.error('Error checking API connections:', error);
      setTwilioStatus({ connected: false, error: 'Check failed' });
      setElevenLabsStatus({ connected: false, error: 'Check failed' });
      setOpenaiStatus({ connected: false, error: 'Check failed' });
      setOpenaiRealtimeStatus({ connected: false, error: 'Check failed' });
    } finally {
      setCheckingStatus(false);
    }
  };

  // Queue a connection check - chains onto existing promise to ensure serial execution
  const checkAPIConnections = (currentSettings?: any) => {
    const settingsToUse = currentSettings || settings;
    if (!settingsToUse) return;
    
    // Chain this check onto the existing promise chain
    checkChainRef.current = checkChainRef.current
      .then(() => performConnectionCheck(settingsToUse))
      .catch((err) => {
        console.error('Connection check chain error:', err);
        // Reset error states on chain failure
        setTwilioStatus({ connected: false, error: 'Check failed' });
        setElevenLabsStatus({ connected: false, error: 'Check failed' });
        setOpenaiStatus({ connected: false, error: 'Check failed' });
        setOpenaiRealtimeStatus({ connected: false, error: 'Check failed' });
        setCheckingStatus(false);
      });
  };

  // Manual refresh handler for recovery
  const handleManualRefresh = async () => {
    await refetchSettings();
  };

  // Force refresh connection status when navigating to /admin
  useEffect(() => {
    if (location?.startsWith('/admin')) {
      refetchSettings();
    }
  }, [location]);

  // Check connections when settings fetch completes (for route navigation, 60-min interval, and window focus)
  useEffect(() => {
    if (wasFetchingRef.current && !isFetching && settings) {
      // Fetch just completed, check connections with fresh data
      checkAPIConnections(settings);
    }
    wasFetchingRef.current = isFetching;
  }, [isFetching, settings]);

  // Initial check when settings first loads
  useEffect(() => {
    if (settings && !hasCheckedRef.current) {
      hasCheckedRef.current = true;
      checkAPIConnections(settings);
    }
    // Reset flag if settings becomes unavailable (e.g., after error)
    if (!settings) {
      hasCheckedRef.current = false;
    }
  }, [settings]);

  return (
    <div className="p-4 md:p-8 space-y-6 md:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-4xl font-bold">Platform Analytics</h1>
          <p className="text-muted-foreground mt-1 md:mt-2 text-sm md:text-base">
            Monitor platform performance and system health
          </p>
        </div>
        <div className="flex items-center gap-2 md:gap-3 flex-wrap">
              <div 
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
                  twilioStatus?.connected 
                    ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800' 
                    : 'bg-slate-50 dark:bg-slate-900/30 border-slate-200 dark:border-slate-700'
                }`}
                data-testid={twilioStatus?.connected ? "status-twilio-connected" : "status-twilio-disconnected"}
                title={twilioStatus?.error || undefined}
              >
                <div className={`p-1 rounded-full ${
                  twilioStatus?.connected 
                    ? 'bg-emerald-500' 
                    : 'bg-slate-400'
                }`}>
                  <Phone className="h-3 w-3 text-white" />
                </div>
                <div className="flex flex-col">
                  <span className={`text-xs font-medium ${
                    twilioStatus?.connected 
                      ? 'text-emerald-700 dark:text-emerald-400' 
                      : 'text-slate-600 dark:text-slate-400'
                  }`}>
                    Twilio
                  </span>
                  <span className={`text-[10px] ${
                    twilioStatus?.connected 
                      ? 'text-emerald-600/70 dark:text-emerald-500/70' 
                      : 'text-slate-500 dark:text-slate-500'
                  }`}>
                    {twilioStatus?.connected ? 'Connected' : 'Not Connected'}
                  </span>
                </div>
              </div>
              
              <div 
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
                  elevenLabsStatus?.connected 
                    ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800' 
                    : 'bg-slate-50 dark:bg-slate-900/30 border-slate-200 dark:border-slate-700'
                }`}
                data-testid={elevenLabsStatus?.connected ? "status-elevenlabs-connected" : "status-elevenlabs-disconnected"}
                title={elevenLabsStatus?.error || undefined}
              >
                <div className={`p-1 rounded-full ${
                  elevenLabsStatus?.connected 
                    ? 'bg-emerald-500' 
                    : 'bg-slate-400'
                }`}>
                  <Server className="h-3 w-3 text-white" />
                </div>
                <div className="flex flex-col">
                  <span className={`text-xs font-medium ${
                    elevenLabsStatus?.connected 
                      ? 'text-emerald-700 dark:text-emerald-400' 
                      : 'text-slate-600 dark:text-slate-400'
                  }`}>
                    ElevenLabs
                  </span>
                  <span className={`text-[10px] ${
                    elevenLabsStatus?.connected 
                      ? 'text-emerald-600/70 dark:text-emerald-500/70' 
                      : 'text-slate-500 dark:text-slate-500'
                  }`}>
                    {elevenLabsStatus?.connected 
                      ? elevenLabsStatus.voiceCount !== undefined 
                        ? `${elevenLabsStatus.voiceCount} voices` 
                        : 'Connected'
                      : 'Not Connected'}
                  </span>
                </div>
              </div>

              {/* OpenAI Status Indicator */}
              <div 
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
                  openaiStatus?.connected 
                    ? 'bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800' 
                    : 'bg-slate-50 dark:bg-slate-900/30 border-slate-200 dark:border-slate-700'
                }`}
                data-testid={openaiStatus?.connected ? "status-openai-connected" : "status-openai-disconnected"}
                title={openaiStatus?.error || undefined}
              >
                <div className={`p-1 rounded-full ${
                  openaiStatus?.connected 
                    ? 'bg-purple-500' 
                    : 'bg-slate-400'
                }`}>
                  <Sparkles className="h-3 w-3 text-white" />
                </div>
                <div className="flex flex-col">
                  <span className={`text-xs font-medium ${
                    openaiStatus?.connected 
                      ? 'text-purple-700 dark:text-purple-400' 
                      : 'text-slate-600 dark:text-slate-400'
                  }`}>
                    OpenAI
                  </span>
                  <span className={`text-[10px] ${
                    openaiStatus?.connected 
                      ? 'text-purple-600/70 dark:text-purple-500/70' 
                      : 'text-slate-500 dark:text-slate-500'
                  }`}>
                    {openaiStatus?.connected 
                      ? (openaiStatus as any).modelCount !== undefined 
                        ? `${(openaiStatus as any).modelCount} models` 
                        : 'Connected'
                      : 'Not Connected'}
                  </span>
                </div>
              </div>

              {/* OpenAI Realtime Voice API Status Indicator */}
              <div 
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
                  openaiRealtimeStatus?.connected 
                    ? 'bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800' 
                    : 'bg-slate-50 dark:bg-slate-900/30 border-slate-200 dark:border-slate-700'
                }`}
                data-testid={openaiRealtimeStatus?.connected ? "status-openai-voice-connected" : "status-openai-voice-disconnected"}
                title={openaiRealtimeStatus?.error || undefined}
              >
                <div className={`p-1 rounded-full ${
                  openaiRealtimeStatus?.connected 
                    ? 'bg-orange-500' 
                    : 'bg-slate-400'
                }`}>
                  <Mic className="h-3 w-3 text-white" />
                </div>
                <div className="flex flex-col">
                  <span className={`text-xs font-medium ${
                    openaiRealtimeStatus?.connected 
                      ? 'text-orange-700 dark:text-orange-400' 
                      : 'text-slate-600 dark:text-slate-400'
                  }`}>
                    OpenAI Voice
                  </span>
                  <span className={`text-[10px] ${
                    openaiRealtimeStatus?.connected 
                      ? 'text-orange-600/70 dark:text-orange-500/70' 
                      : 'text-slate-500 dark:text-slate-500'
                  }`}>
                    {openaiRealtimeStatus?.connected 
                      ? (openaiRealtimeStatus as any).keyCount !== undefined 
                        ? `${(openaiRealtimeStatus as any).keyCount} keys` 
                        : 'Connected'
                      : 'Not Connected'}
                  </span>
                </div>
              </div>

              {/* Version Badge */}
              <div 
                className="flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800"
                data-testid="status-version"
                title="Application Version"
              >
                <div className="p-1 rounded-full bg-blue-500">
                  <Power className="h-3 w-3 text-white" />
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-blue-700 dark:text-blue-400">
                    Version
                  </span>
                  <span className="text-[10px] text-blue-600/70 dark:text-blue-500/70">
                    v{versionData?.version || '1.0.0'}
                  </span>
                </div>
              </div>
              
              <Button 
                variant="ghost" 
                size="icon"
                onClick={handleManualRefresh}
                disabled={checkingStatus || isFetching}
                title={checkingStatus ? "Refreshing..." : "Refresh connection status"}
                data-testid="button-refresh-status"
              >
                <RefreshCw className={`h-4 w-4 ${checkingStatus || isFetching ? 'animate-spin' : ''}`} />
              </Button>
        </div>
      </div>

      {/* Main Admin Tabs - Menu first */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <div className="relative flex items-center -mx-4 md:-mx-8">
          {/* Left scroll arrow */}
          {canScrollLeft && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute left-2 z-10 rounded-full bg-background/80 backdrop-blur-sm shadow-md border"
              onClick={scrollLeft}
              data-testid="button-scroll-tabs-left"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
          
          <div 
            ref={tabsScrollRef}
            className="overflow-x-auto flex-1 px-4 md:px-8 pb-2 scrollbar-thin"
            onScroll={checkScrollState}
          >
            <TabsList className="flex gap-1 h-auto w-max min-w-full">
            <TabsTrigger value="analytics" className="text-xs md:text-sm whitespace-nowrap" data-testid="tab-analytics">
              <BarChart className="h-4 w-4 mr-1 md:mr-2" />
              <span className="hidden sm:inline">Analytics</span>
              <span className="sm:hidden">Stats</span>
            </TabsTrigger>
            <TabsTrigger value="users" className="text-xs md:text-sm whitespace-nowrap" data-testid="tab-users">
              <Users className="h-4 w-4 mr-1 md:mr-2" />
              Users
            </TabsTrigger>
            <TabsTrigger value="contacts" className="text-xs md:text-sm whitespace-nowrap" data-testid="tab-contacts">
              <ContactRound className="h-4 w-4 mr-1 md:mr-2" />
              Contacts
            </TabsTrigger>
            <TabsTrigger value="billing" className="text-xs md:text-sm whitespace-nowrap" data-testid="tab-billing">
              <CreditCard className="h-4 w-4 mr-1 md:mr-2" />
              Billing
            </TabsTrigger>
            <TabsTrigger value="phones" className="text-xs md:text-sm whitespace-nowrap" data-testid="tab-phones">
              <Phone className="h-4 w-4 mr-1 md:mr-2" />
              Phones
            </TabsTrigger>
            <TabsTrigger value="queue" className="text-xs md:text-sm whitespace-nowrap" data-testid="tab-batch-jobs">
              <ListOrdered className="h-4 w-4 mr-1 md:mr-2" />
              <span className="hidden sm:inline">Batch Jobs</span>
              <span className="sm:hidden">Jobs</span>
            </TabsTrigger>
            <TabsTrigger value="calls" className="text-xs md:text-sm whitespace-nowrap" data-testid="tab-calls">
              <Headphones className="h-4 w-4 mr-1 md:mr-2" />
              <span className="hidden sm:inline">Call Monitoring</span>
              <span className="sm:hidden">Calls</span>
            </TabsTrigger>
            <TabsTrigger value="communications" className="text-xs md:text-sm whitespace-nowrap" data-testid="tab-communications">
              <MessageSquare className="h-4 w-4 mr-1 md:mr-2" />
              <span className="hidden sm:inline">Communications</span>
              <span className="sm:hidden">Comms</span>
            </TabsTrigger>
            <TabsTrigger value="voice-ai" className="text-xs md:text-sm whitespace-nowrap" data-testid="tab-voice-ai">
              <Brain className="h-4 w-4 mr-1 md:mr-2" />
              <span className="hidden sm:inline">Voice AI</span>
              <span className="sm:hidden">Voice</span>
            </TabsTrigger>
            {(Array.isArray(adminMenuItems) ? adminMenuItems : []).map((item) => (
              <TabsTrigger key={item.id} value={item.id} className="text-xs md:text-sm whitespace-nowrap" data-testid={`tab-${item.id}`}>
                {item.icon === 'Users' && <Building2 className="h-4 w-4 mr-1 md:mr-2" />}
                {item.icon === 'Server' && <Server className="h-4 w-4 mr-1 md:mr-2" />}
                {item.label}
              </TabsTrigger>
            ))}
            <TabsTrigger value="settings" className="text-xs md:text-sm whitespace-nowrap" data-testid="tab-settings">
              <Settings className="h-4 w-4 mr-1 md:mr-2" />
              Settings
            </TabsTrigger>
          </TabsList>
          </div>
          
          {/* Right scroll arrow */}
          {canScrollRight && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 z-10 rounded-full bg-background/80 backdrop-blur-sm shadow-md border"
              onClick={scrollRight}
              data-testid="button-scroll-tabs-right"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>

        <TabsContent value="analytics" className="space-y-4">
          <Analytics />
        </TabsContent>

        <TabsContent value="users" className="space-y-4">
          <UserManagement />
        </TabsContent>

        <TabsContent value="contacts" className="space-y-4">
          <AllContactsAdmin />
        </TabsContent>

        <TabsContent value="billing" className="space-y-4">
          <BillingPanel />
        </TabsContent>

        <TabsContent value="phones" className="space-y-4">
          <PhoneNumbers />
        </TabsContent>

        <TabsContent value="queue" className="space-y-4">
          <BatchJobsMonitor />
        </TabsContent>

        <TabsContent value="calls" className="space-y-4">
          <CallsPanel />
        </TabsContent>

        <TabsContent value="communications" className="space-y-4">
          <CommunicationsPanel />
        </TabsContent>

        <TabsContent value="voice-ai" className="space-y-4">
          <VoiceAIPanel />
        </TabsContent>

        {(Array.isArray(adminMenuItems) ? adminMenuItems : []).map((item) => (
          <TabsContent key={item.id} value={item.id} className="space-y-4">
            <Suspense fallback={<div className="flex items-center justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
              <item.component />
            </Suspense>
          </TabsContent>
        ))}

        <TabsContent value="settings" className="space-y-4">
          <SettingsPage onSwitchTab={setActiveTab} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function BillingPanel() {
  const [activeSubTab, setActiveSubTab] = useState("plans");
  
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Billing</h2>
        <p className="text-muted-foreground">
          Manage subscription plans, credits, transactions, and payment gateways
        </p>
      </div>
      
      <Tabs value={activeSubTab} onValueChange={setActiveSubTab}>
        <TabsList>
          <TabsTrigger value="plans" data-testid="subtab-plans">
            <Package className="h-4 w-4 mr-2" />
            Plans
          </TabsTrigger>
          <TabsTrigger value="credits" data-testid="subtab-credits">
            <CreditCard className="h-4 w-4 mr-2" />
            Credits
          </TabsTrigger>
          <TabsTrigger value="transactions" data-testid="subtab-transactions">
            <Receipt className="h-4 w-4 mr-2" />
            Transactions
          </TabsTrigger>
          <TabsTrigger value="backfill" data-testid="subtab-credit-backfill">
            <RefreshCw className="h-4 w-4 mr-2" />
            Backfill
          </TabsTrigger>
          <TabsTrigger value="payments" data-testid="subtab-payments">
            <DollarSign className="h-4 w-4 mr-2" />
            Payments
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="plans" className="mt-6 space-y-4">
          <PlanManagement />
          <LLMModelsManagement />
        </TabsContent>
        
        <TabsContent value="credits" className="mt-6">
          <CreditPackages />
        </TabsContent>
        
        <TabsContent value="transactions" className="mt-6">
          <TransactionsManagement />
        </TabsContent>

        <TabsContent value="backfill" className="mt-6">
          <CreditBackfillManagement />
        </TabsContent>
        
        <TabsContent value="payments" className="mt-6">
          <PaymentsSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CallsPanel() {
  const [activeSubTab, setActiveSubTab] = useState("monitoring");
  
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Call Monitoring</h2>
        <p className="text-muted-foreground">
          Monitor all calls, detect content violations, and manage banned words
        </p>
      </div>
      
      <Tabs value={activeSubTab} onValueChange={setActiveSubTab}>
        <TabsList>
          <TabsTrigger value="monitoring" data-testid="subtab-call-monitoring">
            <Headphones className="h-4 w-4 mr-2" />
            All Calls
          </TabsTrigger>
          <TabsTrigger value="banned-words" data-testid="subtab-banned-words">
            <ShieldAlert className="h-4 w-4 mr-2" />
            Banned Words
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="monitoring" className="mt-6">
          <CallMonitoring />
        </TabsContent>
        
        <TabsContent value="banned-words" className="mt-6">
          <BannedWordsManagement />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CommunicationsPanel() {
  const [activeSubTab, setActiveSubTab] = useState("email-settings");
  
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Communications</h2>
        <p className="text-muted-foreground">
          Manage email templates, notifications, and communication settings
        </p>
      </div>
      
      <Tabs value={activeSubTab} onValueChange={setActiveSubTab}>
        <TabsList>
          <TabsTrigger value="email-settings" data-testid="subtab-email-settings">
            <Mail className="h-4 w-4 mr-2" />
            Email Settings
          </TabsTrigger>
          <TabsTrigger value="notifications" data-testid="subtab-notifications">
            <Bell className="h-4 w-4 mr-2" />
            In-App Notifications
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="email-settings" className="mt-6">
          <EmailSettingsManagement />
        </TabsContent>
        
        <TabsContent value="notifications" className="mt-6">
          <Notifications />
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface VoiceEngineSettings {
  plivo_openai_engine_enabled: boolean;
  twilio_openai_engine_enabled: boolean;
  twilio_kyc_required: boolean;
  plivo_kyc_required: boolean;
}

function VoiceAIPanel() {
  const { toast } = useToast();
  
  const { data: voiceEngineSettings, isLoading: settingsLoading } = useQuery<VoiceEngineSettings>({
    queryKey: ["/api/settings/voice-engine"],
  });

  const updatePlivoEngineSetting = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await apiRequest("PATCH", "/api/admin/settings/plivo_openai_engine_enabled", { value: enabled });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to update setting");
      }
      return { enabled, engine: "plivo" };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/voice-engine"] });
      toast({ 
        title: "Voice engine setting updated",
        description: data.enabled 
          ? "Plivo + OpenAI engine has been enabled" 
          : "Plivo + OpenAI engine has been disabled"
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to update setting",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const updateTwilioOpenaiEngineSetting = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await apiRequest("PATCH", "/api/admin/settings/twilio_openai_engine_enabled", { value: enabled });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to update setting");
      }
      return { enabled, engine: "twilio_openai" };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/voice-engine"] });
      toast({ 
        title: "Voice engine setting updated",
        description: data.enabled 
          ? "Twilio + OpenAI engine has been enabled" 
          : "Twilio + OpenAI engine has been disabled"
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to update setting",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const isPlivoEngineEnabled = voiceEngineSettings?.plivo_openai_engine_enabled ?? false;
  const isTwilioOpenaiEngineEnabled = voiceEngineSettings?.twilio_openai_engine_enabled ?? false;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Voice AI Engine</h2>
        <p className="text-muted-foreground">
          Manage OpenAI and Plivo configurations for the Voice AI engine
        </p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Power className="h-5 w-5" />
                <div>
                  <CardTitle className="text-lg">Twilio + OpenAI Realtime</CardTitle>
                  <CardDescription>
                    Use OpenAI Realtime API with Twilio telephony
                  </CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {settingsLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <>
                    <Label htmlFor="twilio-openai-toggle" className="text-sm text-muted-foreground">
                      {isTwilioOpenaiEngineEnabled ? "Enabled" : "Disabled"}
                    </Label>
                    <Switch
                      id="twilio-openai-toggle"
                      checked={isTwilioOpenaiEngineEnabled}
                      onCheckedChange={(checked) => updateTwilioOpenaiEngineSetting.mutate(checked)}
                      disabled={updateTwilioOpenaiEngineSetting.isPending}
                      data-testid="switch-twilio-openai-engine"
                    />
                  </>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-sm text-muted-foreground">
              OpenAI Realtime voices with Twilio for international calling.
            </p>
            {isTwilioOpenaiEngineEnabled && (
              <div className="mt-3 flex items-center gap-2">
                <Badge variant="secondary" className="text-green-600 border-green-600">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Active
                </Badge>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Power className="h-5 w-5" />
                <div>
                  <CardTitle className="text-lg">Plivo + OpenAI Realtime</CardTitle>
                  <CardDescription>
                    Use OpenAI Realtime API with Plivo telephony
                  </CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {settingsLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <>
                    <Label htmlFor="plivo-openai-toggle" className="text-sm text-muted-foreground">
                      {isPlivoEngineEnabled ? "Enabled" : "Disabled"}
                    </Label>
                    <Switch
                      id="plivo-openai-toggle"
                      checked={isPlivoEngineEnabled}
                      onCheckedChange={(checked) => updatePlivoEngineSetting.mutate(checked)}
                      disabled={updatePlivoEngineSetting.isPending}
                      data-testid="switch-plivo-openai-engine"
                    />
                  </>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-sm text-muted-foreground">
              OpenAI Realtime voices with Plivo for Indian numbers.
            </p>
            {isPlivoEngineEnabled && (
              <div className="mt-3 flex items-center gap-2">
                <Badge variant="secondary" className="text-green-600 border-green-600">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Active
                </Badge>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      
      <div className="space-y-6">
        <OpenAIPoolManagement />
        <PlivoSettings />
      </div>
    </div>
  );
}