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
import { Switch, Route, useLocation, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Zap, Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { TeamMemberSidebar } from "@/components/TeamMemberSidebar";
import { AdminTeamMemberSidebar } from "@/components/AdminTeamMemberSidebar";
import { ThemeProvider } from "@/components/ThemeProvider";
import { BrandingProvider, useBranding } from "@/components/BrandingProvider";
import { DirectionProvider } from "@/components/DirectionProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageSelector } from "@/components/LanguageSelector";
import { useEffect, useState } from "react";
import { AuthStorage } from "./lib/auth-storage";
import { TeamAuth } from "./lib/team-auth";
import { useQuery } from "@tanstack/react-query";
import Dashboard from "@/pages/Dashboard";
import Campaigns from "@/pages/Campaigns";
import CampaignDetail from "@/pages/CampaignDetail";
import Calls from "@/pages/Calls";
import CallDetail from "@/pages/CallDetail";
import Analytics from "@/pages/Analytics";
import Billing from "@/pages/Billing";
import PaymentResult from "@/pages/PaymentResult";
import KnowledgeBase from "@/pages/KnowledgeBase";
import Agents from "@/pages/Agents";
import Voices from "@/pages/Voices";
import PhoneNumbers from "@/pages/PhoneNumbers";
import AllContacts from "@/pages/AllContacts";
import Settings from "@/pages/Settings";
import Login from "@/pages/Login";
import LandingPage from "@/pages/LandingPage";
import AdminDashboard from "@/pages/AdminDashboard";
import AdminCampaignDetail from "@/pages/AdminCampaignDetail";
import PrivacyPolicy from "@/pages/policies/PrivacyPolicy";
import TermsOfService from "@/pages/policies/TermsOfService";
import CookiePolicy from "@/pages/policies/CookiePolicy";
import InstallWizard from "@/pages/InstallWizard";
import NotFound from "@/pages/not-found";
import FlowsPage from "@/pages/FlowsPage";
import CRMPage from "@/pages/CRMPage";
import WidgetsPage from "@/pages/WidgetsPage";
import FlowBuilderPage from "@/pages/FlowBuilderPage";
import FlowExecutionLogsPage from "@/pages/FlowExecutionLogsPage";
import WebhookConfigPage from "@/pages/WebhookConfigPage";
import FormsPage from "@/pages/FormsPage";
import AppointmentsPage from "@/pages/AppointmentsPage";
import FlowTemplatesPage from "@/pages/FlowTemplatesPage";
import IncomingConnections from "@/pages/IncomingConnections";
import ToolsPage from "@/pages/ToolsPage";
import GoogleCallbackPage from "@/pages/GoogleCallbackPage";
import PromptTemplates from "@/pages/PromptTemplates";
import TransactionHistory from "@/pages/TransactionHistory";
import Blog from "@/pages/Blog";
import BlogPost from "@/pages/BlogPost";
import Contact from "@/pages/Contact";
import LoginPage from "@/pages/LoginPage";
import TeamMemberLogin from "@/pages/TeamMemberLogin";
import AdminTeamLogin from "@/pages/AdminTeamLogin";
import FeaturesPage from "@/pages/FeaturesPage";
import PricingPage from "@/pages/PricingPage";
import UseCasesPage from "@/pages/UseCasesPage";
import IntegrationsPage from "@/pages/IntegrationsPage";
import { ScrollToTop } from "@/components/ScrollToTop";
import { NotificationBell } from "@/components/NotificationBell";
import { HeaderBannerNotifications } from "@/components/HeaderBannerNotifications";
import { DemoModeBanner } from "@/components/DemoModeBanner";
import { CookieConsentBanner } from "@/components/CookieConsentBanner";
import { AnalyticsScripts } from "@/components/AnalyticsScripts";
import { SessionTimeoutDialog } from "@/components/SessionTimeoutDialog";
import { useActivityTimeout } from "@/hooks/useActivityTimeout";
import { useCallback } from "react";
import { apiRequest } from "@/lib/queryClient";
import { PluginRegistryProvider, usePluginRegistry } from "@/contexts/plugin-registry";
import { PluginBootstrapper } from "@/components/plugin-bootstrapper";
import { DynamicLanguagesProvider } from "@/contexts/dynamic-languages";

function PluginConversationsPage() {
  const registry = usePluginRegistry();
  const routes = registry.getRoutes();
  const conversationRoute = routes.find(r => r.id === 'messaging-conversations');
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (conversationRoute) return;
    const timer = setTimeout(() => setTimedOut(true), 10000);
    return () => clearTimeout(timer);
  }, [conversationRoute]);

  if (!conversationRoute) {
    if (timedOut) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center gap-4">
          <AlertTriangle className="w-10 h-10 text-amber-500" />
          <div>
            <h3 className="text-lg font-medium mb-1" data-testid="text-conversations-error">Conversations Unavailable</h3>
            <p className="text-sm text-muted-foreground max-w-md mb-4">
              The messaging plugin could not be loaded. This may be due to a configuration issue or a temporary error.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
              data-testid="button-conversations-retry"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh page
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center h-full text-center gap-4">
        <Loader2 className="w-10 h-10 text-muted-foreground animate-spin" />
        <div>
          <h3 className="text-lg font-medium mb-1" data-testid="text-conversations-loading">Loading Conversations</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            The messaging plugin is loading. Please wait a moment or refresh the page.
          </p>
        </div>
      </div>
    );
  }

  const ConversationComponent = conversationRoute.component;

  return (
    <div className="-mx-4 md:-mx-10 lg:-mx-16 xl:-mx-20 -my-4 md:-my-6 h-[calc(100vh-3.5rem)]">
      <ConversationComponent />
    </div>
  );
}

function SessionTimeoutWrapper({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  
  const handleTimeout = useCallback(() => {
    // Logout request sends HttpOnly cookie automatically via credentials: 'include'
    fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    }).catch(() => {});
    AuthStorage.clearAuth();
    queryClient.clear();
    setLocation('/login');
  }, [setLocation]);

  const { isWarningVisible, remainingTime, dismissWarning } = useActivityTimeout({
    enabled: AuthStorage.isAuthenticated(),
    onTimeout: handleTimeout,
    warningThresholdMs: 5 * 60 * 1000,
  });

  return (
    <>
      {children}
      <SessionTimeoutDialog
        open={isWarningVisible}
        remainingTime={remainingTime}
        onContinue={dismissWarning}
        onLogout={handleTimeout}
      />
    </>
  );
}


function PublicRouter() {
  return (
    <>
      <ScrollToTop />
      <Switch>
        <Route path="/" component={LandingPage} />
        <Route path="/login" component={LoginPage} />
        <Route path="/register" component={LoginPage} />
        <Route path="/team/login" component={TeamMemberLogin} />
        <Route path="/admin/team/login" component={AdminTeamLogin} />
        <Route path="/features" component={FeaturesPage} />
        <Route path="/pricing" component={PricingPage} />
        <Route path="/use-cases" component={UseCasesPage} />
        <Route path="/integrations" component={IntegrationsPage} />
        <Route path="/contact" component={Contact} />
        <Route path="/blog/:slug" component={BlogPost} />
        <Route path="/blog" component={Blog} />
        <Route path="/privacy" component={PrivacyPolicy} />
        <Route path="/terms" component={TermsOfService} />
        <Route path="/cookies" component={CookiePolicy} />
        <Route component={LandingPage} />
      </Switch>
    </>
  );
}

function AdminRouter() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };
  const { branding, currentLogo } = useBranding();

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex flex-col h-screen w-full">
        <DemoModeBanner />
        <div className="flex flex-1 overflow-hidden">
          <AppSidebar />
          <div className="flex flex-col flex-1 overflow-hidden">
            <header className="flex items-center justify-between h-14 px-4 md:px-6 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="md:hidden" data-testid="button-mobile-menu" />
              <div className="md:hidden">
                {currentLogo ? (
                  <img 
                    src={currentLogo} 
                    alt={branding.app_name} 
                    className="h-7 w-auto max-w-[120px] object-contain"
                  />
                ) : (
                  <Zap className="h-6 w-6 text-primary" />
                )}
              </div>
            </div>
            <div className="flex-1" />
            <div className="flex items-center gap-2">
              <HeaderBannerNotifications />
              <NotificationBell />
              <LanguageSelector variant="compact" />
              <ThemeToggle />
            </div>
          </header>
          <main className="flex-1 overflow-auto">
            <div className="max-w-7xl mx-auto px-4 md:px-8 py-6">
              <Switch>
                <Route path="/">
                  <Redirect to="/admin" />
                </Route>
                <Route path="/admin" component={AdminDashboard} />
                <Route path="/admin/dashboard" component={AdminDashboard} />
                <Route path="/admin/campaigns/:id" component={AdminCampaignDetail} />
                <Route component={NotFound} />
              </Switch>
            </div>
          </main>
          </div>
        </div>
      </div>
    </SidebarProvider>
  );
}

function UserRouter() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };
  const { branding, currentLogo } = useBranding();

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="flex items-center justify-between h-14 px-4 md:px-6 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="md:hidden" data-testid="button-mobile-menu" />
              <div className="md:hidden">
                {currentLogo ? (
                  <img 
                    src={currentLogo} 
                    alt={branding.app_name} 
                    className="h-7 w-auto max-w-[120px] object-contain"
                  />
                ) : (
                  <Zap className="h-6 w-6 text-primary" />
                )}
              </div>
            </div>
            <div className="flex-1" />
            <div className="flex items-center gap-2">
              <HeaderBannerNotifications />
              <NotificationBell />
              <LanguageSelector variant="compact" />
              <ThemeToggle />
            </div>
          </header>
          <main className="flex-1 overflow-auto">
            <div className="w-full px-4 md:px-10 lg:px-16 xl:px-20 py-4 md:py-6">
              <Switch>
                <Route path="/">
                  <Redirect to="/app" />
                </Route>
                <Route path="/app" component={Dashboard} />
                <Route path="/app/dashboard" component={Dashboard} />
                <Route path="/app/campaigns/:id" component={CampaignDetail} />
                <Route path="/app/campaigns" component={Campaigns} />
                <Route path="/app/calls/:id" component={CallDetail} />
                <Route path="/app/calls" component={Calls} />
                <Route path="/app/contacts" component={AllContacts} />
                <Route path="/app/analytics" component={Analytics} />
                <Route path="/app/crm" component={CRMPage} />
                <Route path="/app/tools/widgets" component={WidgetsPage} />
                <Route path="/app/billing" component={Billing} />
                <Route path="/app/payment-result" component={PaymentResult} />
                <Route path="/app/transaction-history">
                  <Redirect to="/app/billing?tab=history" />
                </Route>
                <Route path="/app/upgrade">
                  <Redirect to="/app/billing?tab=plans" />
                </Route>
                <Route path="/app/knowledge-base" component={KnowledgeBase} />
                <Route path="/app/agents" component={Agents} />
                <Route path="/app/conversations" component={PluginConversationsPage} />
                <Route path="/app/prompt-templates" component={PromptTemplates} />
                <Route path="/app/incoming-connections" component={IncomingConnections} />
                <Route path="/app/voices" component={Voices} />
                <Route path="/app/phone-numbers" component={PhoneNumbers} />
                <Route path="/app/google-callback" component={GoogleCallbackPage} />
                <Route path="/app/tools" component={ToolsPage} />
                <Route path="/app/flows/new" component={FlowBuilderPage} />
                <Route path="/app/flows/execution">
                  <Redirect to="/app/flows?tab=execution" />
                </Route>
                <Route path="/app/flows/webhooks" component={WebhookConfigPage} />
                <Route path="/app/flows/forms" component={FormsPage} />
                <Route path="/app/flows/appointments" component={AppointmentsPage} />
                <Route path="/app/flows/templates">
                  <Redirect to="/app/flows?tab=templates" />
                </Route>
                <Route path="/app/flows/:id" component={FlowBuilderPage} />
                <Route path="/app/flows" component={FlowsPage} />
                <Route path="/app/outbound" component={() => <div className="text-center py-16 text-muted-foreground">Outbound page coming soon</div>} />
                <Route path="/app/settings" component={Settings} />
                <Route path="/app/developers" component={() => <div className="text-center py-16 text-muted-foreground">Developers page coming soon</div>} />
                <Route component={NotFound} />
              </Switch>
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function TeamMemberRouter() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };
  const { branding, currentLogo } = useBranding();

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <TeamMemberSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="flex items-center justify-between h-14 px-4 md:px-6 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="md:hidden" data-testid="button-mobile-menu" />
              <div className="md:hidden">
                {currentLogo ? (
                  <img 
                    src={currentLogo} 
                    alt={branding.app_name} 
                    className="h-7 w-auto max-w-[120px] object-contain"
                  />
                ) : (
                  <Zap className="h-6 w-6 text-primary" />
                )}
              </div>
            </div>
            <div className="flex-1" />
            <div className="flex items-center gap-2">
              <LanguageSelector variant="compact" />
              <ThemeToggle />
            </div>
          </header>
          <main className="flex-1 overflow-auto">
            <div className="w-full px-4 md:px-10 lg:px-16 xl:px-20 py-4 md:py-6">
              <Switch>
                <Route path="/">
                  <Redirect to="/app" />
                </Route>
                <Route path="/app" component={Dashboard} />
                <Route path="/app/dashboard" component={Dashboard} />
                <Route path="/app/campaigns/:id" component={CampaignDetail} />
                <Route path="/app/campaigns" component={Campaigns} />
                <Route path="/app/calls/:id" component={CallDetail} />
                <Route path="/app/calls" component={Calls} />
                <Route path="/app/contacts" component={AllContacts} />
                <Route path="/app/analytics" component={Analytics} />
                <Route path="/app/crm" component={CRMPage} />
                <Route path="/app/tools/widgets" component={WidgetsPage} />
                <Route path="/app/tools" component={ToolsPage} />
                <Route path="/app/billing" component={Billing} />
                <Route path="/app/transaction-history">
                  <Redirect to="/app/billing?tab=history" />
                </Route>
                <Route path="/app/upgrade">
                  <Redirect to="/app/billing?tab=plans" />
                </Route>
                <Route path="/app/knowledge-base" component={KnowledgeBase} />
                <Route path="/app/agents" component={Agents} />
                <Route path="/app/conversations" component={PluginConversationsPage} />
                <Route path="/app/prompt-templates" component={PromptTemplates} />
                <Route path="/app/incoming-connections" component={IncomingConnections} />
                <Route path="/app/voices" component={Voices} />
                <Route path="/app/phone-numbers" component={PhoneNumbers} />
                <Route path="/app/flows/new" component={FlowBuilderPage} />
                <Route path="/app/flows/execution">
                  <Redirect to="/app/flows?tab=execution" />
                </Route>
                <Route path="/app/flows/webhooks" component={WebhookConfigPage} />
                <Route path="/app/flows/forms" component={FormsPage} />
                <Route path="/app/flows/appointments" component={AppointmentsPage} />
                <Route path="/app/flows/templates">
                  <Redirect to="/app/flows?tab=templates" />
                </Route>
                <Route path="/app/flows/:id" component={FlowBuilderPage} />
                <Route path="/app/flows" component={FlowsPage} />
                <Route path="/app/settings" component={Settings} />
                <Route path="/admin" component={AdminDashboard} />
                <Route component={NotFound} />
              </Switch>
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function AdminTeamMemberRouter() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };
  const { branding, currentLogo } = useBranding();

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AdminTeamMemberSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="flex items-center justify-between h-14 px-4 md:px-6 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="md:hidden" data-testid="button-mobile-menu" />
              <div className="md:hidden">
                {currentLogo ? (
                  <img 
                    src={currentLogo} 
                    alt={branding.app_name} 
                    className="h-7 w-auto max-w-[120px] object-contain"
                  />
                ) : (
                  <Zap className="h-6 w-6 text-primary" />
                )}
              </div>
            </div>
            <div className="flex-1" />
            <div className="flex items-center gap-2">
              <LanguageSelector variant="compact" />
              <ThemeToggle />
            </div>
          </header>
          <main className="flex-1 overflow-auto">
            <div className="max-w-7xl mx-auto px-4 md:px-8 py-6">
              <Switch>
                <Route path="/">
                  <Redirect to="/admin" />
                </Route>
                <Route path="/admin" component={AdminDashboard} />
                <Route path="/admin/dashboard" component={AdminDashboard} />
                <Route path="/admin/campaigns/:id" component={AdminCampaignDetail} />
                <Route component={NotFound} />
              </Switch>
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

interface User {
  id: string;
  name: string;
  email: string;
  role?: string;
  credits?: number;
}

function AdminGuard({ children }: { children: React.ReactNode }) {
  // Fetch user from server to validate admin access
  const { data: user, isLoading: userLoading, isError } = useQuery<User>({
    queryKey: ["/api/auth/me"],
    retry: false,
  });

  // Handle auth errors
  useEffect(() => {
    if (isError) {
      AuthStorage.clearAuth();
      window.location.href = "/login";
    }
  }, [isError]);

  // Show loading while fetching user data
  if (userLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  // If no user data at all (shouldn't happen after loading), redirect to login
  if (!user) {
    console.log("AdminGuard - No user data, redirecting to /login");
    return <Redirect to="/login" />;
  }

  const hasAdminAccess = user.role === 'admin';
  
  // If user doesn't have admin access, redirect to user panel
  if (!hasAdminAccess) {
    console.log("AdminGuard - User is not authorized for admin panel, redirecting to /app");
    return <Redirect to="/app" />;
  }

  console.log("AdminGuard - User has admin access, rendering admin panel");
  return <>{children}</>;
}

interface AdminTeamMemberInfo {
  id: string;
  email: string;
  status: string;
  role?: {
    id: string;
    name: string;
  };
}

function AdminTeamGuard({ children }: { children: React.ReactNode }) {
  // Validate admin team member JWT token via server
  const { data: authData, isLoading, isError } = useQuery<{ 
    member: AdminTeamMemberInfo; 
    team: { id: string; name: string }; 
    permissions: Record<string, Record<string, any>> 
  }>({
    queryKey: ["/api/admin/team/auth/me"],
    queryFn: async () => {
      const token = TeamAuth.getToken();
      if (!token) throw new Error("No token");
      const response = await fetch("/api/admin/team/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Invalid session");
      return response.json();
    },
    retry: false,
  });

  // Handle auth errors
  useEffect(() => {
    if (isError) {
      TeamAuth.clearAuth();
      window.location.href = "/admin/team/login";
    }
  }, [isError]);

  // Show loading while validating token
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  // If no auth data, redirect to admin team login
  if (!authData || !authData.member) {
    console.log("AdminTeamGuard - No valid session, redirecting to /admin/team/login");
    TeamAuth.clearAuth();
    return <Redirect to="/admin/team/login" />;
  }

  // Check member status
  if (authData.member.status !== 'active') {
    console.log("AdminTeamGuard - Member not active, redirecting to /admin/team/login");
    TeamAuth.clearAuth();
    return <Redirect to="/admin/team/login" />;
  }

  console.log("AdminTeamGuard - Admin team member validated, rendering admin panel");
  return <>{children}</>;
}

function UserGuard({ children }: { children: React.ReactNode }) {
  const [isTeamMember, setIsTeamMember] = useState(() => TeamAuth.isAuthenticated());
  const [teamAuthValid, setTeamAuthValid] = useState<boolean | null>(null);
  const [teamAuthLoading, setTeamAuthLoading] = useState(isTeamMember);

  // Fetch user from server (for regular users)
  const { data: user, isLoading, isError } = useQuery<User>({
    queryKey: ["/api/auth/me"],
    retry: false,
    enabled: !isTeamMember, // Only fetch for non-team-members
  });

  // Validate team member session
  useEffect(() => {
    if (isTeamMember) {
      setTeamAuthLoading(true);
      TeamAuth.validateSession().then(result => {
        setTeamAuthValid(result.valid);
        setTeamAuthLoading(false);
        if (!result.valid) {
          TeamAuth.clearAuth();
        }
      });
    }
  }, [isTeamMember]);

  // Handle auth errors for regular users
  useEffect(() => {
    if (!isTeamMember && isError) {
      AuthStorage.clearAuth();
      window.location.href = "/login";
    }
  }, [isError, isTeamMember]);

  // Show loading state
  if (isTeamMember ? teamAuthLoading : isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  // Team member authentication check
  if (isTeamMember) {
    if (teamAuthValid === false) {
      return <Redirect to="/team/login" />;
    }
    // Team member is valid, render children
    return <>{children}</>;
  }

  // Regular user authentication check
  if (!user) {
    return <Redirect to="/login" />;
  }

  return <>{children}</>;
}

function Router() {
  const [location] = useLocation();
  // Initialize auth state synchronously from localStorage to prevent flash
  // Check both regular user auth AND team member auth
  const [isAuthenticated, setIsAuthenticated] = useState(() => 
    AuthStorage.isAuthenticated() || TeamAuth.isAuthenticated()
  );
  const [isTeamMember, setIsTeamMember] = useState(() => TeamAuth.isAuthenticated());
  const [isAdminTeamMember, setIsAdminTeamMember] = useState(() => TeamAuth.isAdminTeamMember());
  const [isChecking, setIsChecking] = useState(true);

  // Check installation status
  const { data: installStatus } = useQuery<{ installed: boolean }>({
    queryKey: ["/api/installer/status"],
    retry: false,
  });

  // Verify auth state and mark checking complete
  useEffect(() => {
    // Re-verify from storage in case it changed
    const regularAuth = AuthStorage.isAuthenticated();
    const teamAuth = TeamAuth.isAuthenticated();
    const adminTeamAuth = TeamAuth.isAdminTeamMember();
    setIsAuthenticated(regularAuth || teamAuth);
    setIsTeamMember(teamAuth);
    setIsAdminTeamMember(adminTeamAuth);
    setIsChecking(false);
  }, []);

  // Debug logging
  useEffect(() => {
    console.log("Router - Current location:", location);
    console.log("Router - isAuthenticated:", isAuthenticated);
    console.log("Router - location.startsWith('/admin'):", location.startsWith('/admin'));
    console.log("Router - location.startsWith('/app'):", location.startsWith('/app'));
  }, [location, isAuthenticated]);

  if (isChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  // Installation check - if not installed, redirect to installer unless already on /install
  if (installStatus && !installStatus.installed && location !== '/install') {
    console.log("Router - Not installed, redirecting to /install");
    return <Redirect to="/install" />;
  }

  // Block installer if already installed
  if (location === '/install' && installStatus?.installed) {
    console.log("Router - Already installed, redirecting to /login");
    return <Redirect to="/login" />;
  }

  // Installer route (public, no auth required)
  if (location === '/install') {
    console.log("Router - Rendering InstallWizard");
    return <InstallWizard />;
  }

  // Redirect authenticated users away from login/register immediately
  // This prevents the flash when page reloads after login
  if (isAuthenticated && (location === '/login' || location === '/register')) {
    // Admin team members go to /admin
    if (isAdminTeamMember) {
      console.log("Router - Authenticated admin team member on auth page, redirecting to /admin");
      return <Redirect to="/admin" />;
    }
    // User team members go to /app
    if (isTeamMember) {
      console.log("Router - Authenticated team member on auth page, redirecting to /app");
      return <Redirect to="/app" />;
    }
    const user = AuthStorage.getUser();
    const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
    const redirectTo = isAdmin ? '/admin' : '/app';
    console.log("Router - Authenticated user on auth page, redirecting to", redirectTo);
    return <Redirect to={redirectTo} />;
  }

  // Redirect authenticated team members away from team login page
  if (isTeamMember && location === '/team/login') {
    const redirectTo = isAdminTeamMember ? '/admin' : '/app';
    console.log("Router - Authenticated team member on team login page, redirecting to", redirectTo);
    return <Redirect to={redirectTo} />;
  }

  // Redirect authenticated admin team members away from admin team login page
  if (isAdminTeamMember && location === '/admin/team/login') {
    console.log("Router - Authenticated admin team member on admin team login page, redirecting to /admin");
    return <Redirect to="/admin" />;
  }

  // Admin routes - protected by server-side validation
  // Check this BEFORE public routes to prevent flash during login transition
  if (location.startsWith('/admin') && !location.startsWith('/admin/team/login')) {
    // Admin team members get the AdminTeamGuard + AdminTeamMemberRouter with permission-based sidebar
    if (isAdminTeamMember) {
      console.log("Router - Rendering AdminTeamGuard + AdminTeamMemberRouter (admin team member)");
      return (
        <AdminTeamGuard>
          <AdminTeamMemberRouter />
        </AdminTeamGuard>
      );
    }
    console.log("Router - Rendering AdminGuard + AdminRouter");
    return (
      <AdminGuard>
        <AdminRouter />
      </AdminGuard>
    );
  }

  // User routes (/app) - protected by server-side validation
  // Check this BEFORE public routes to prevent flash during login transition
  if (location.startsWith('/app')) {
    // Team members get the TeamMemberRouter with permission-based sidebar
    if (isTeamMember) {
      console.log("Router - Rendering UserGuard + TeamMemberRouter (team member)");
      return (
        <UserGuard>
          <TeamMemberRouter />
        </UserGuard>
      );
    }
    console.log("Router - Rendering UserGuard + UserRouter");
    return (
      <UserGuard>
        <UserRouter />
      </UserGuard>
    );
  }

  // Public routes (landing, login, register)
  console.log("Router - Rendering PublicRouter");
  return <PublicRouter />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <DirectionProvider>
          <BrandingProvider>
            <PluginRegistryProvider>
              <PluginBootstrapper>
                <DynamicLanguagesProvider>
                  <TooltipProvider>
                    <AnalyticsScripts />
                    <SessionTimeoutWrapper>
                      <Router />
                    </SessionTimeoutWrapper>
                    <Toaster />
                    <CookieConsentBanner />
                  </TooltipProvider>
                </DynamicLanguagesProvider>
              </PluginBootstrapper>
            </PluginRegistryProvider>
          </BrandingProvider>
        </DirectionProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
