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
import { Users, BookOpen, Mic, Link as LinkIcon, Phone, Settings, ChevronsUpDown, Plus, BarChart3, Home, Target, LogOut, Coins, Shield, CreditCard, TrendingUp, UserCheck, Workflow, Webhook, ClipboardList, Calendar, Layout, FileText, Wrench, Globe, Bot, ContactRound, MessageSquare } from "lucide-react";
import { usePluginStatus } from "@/hooks/use-plugin-status";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Link, useLocation, useRoute } from "wouter";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from 'react-i18next';
import { useBranding } from "@/components/BrandingProvider";
import { AuthStorage } from "@/lib/auth-storage";

interface User {
  id: string;
  name: string;
  email: string;
  role?: string;
  credits?: number;
  planType?: string;
}

export function AppSidebar() {
  const [location, setLocation] = useLocation();
  const { t } = useTranslation();
  const { branding, currentLogo, showLogo, showFavicon } = useBranding();
  const { setOpenMobile, isMobile } = useSidebar();

  const handleNavClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  const topItems = [
    { title: t('nav.home'), url: "/app", icon: Home },
  ];

  const buildItems = [
    { title: t('nav.campaigns'), url: "/app/campaigns", icon: Target, hasPlus: true, iconColor: "text-orange-500" },
    { title: t('nav.agents'), url: "/app/agents", icon: Bot, hasPlus: true, iconColor: "text-blue-500" },
    { title: t('nav.knowledgeBase'), url: "/app/knowledge-base", icon: BookOpen, iconColor: "text-violet-500" },
    { title: t('nav.flowBuilder'), url: "/app/flows", icon: Workflow, iconColor: "text-indigo-500" },
    { title: t('nav.tools', 'Tools'), url: "/app/tools", icon: Wrench, iconColor: "text-slate-500" },
  ];

  const telephonyItems = [
    { title: t('nav.allContacts'), url: "/app/contacts", icon: UserCheck, iconColor: "text-brand" },
    { title: t('nav.phoneNumbers'), url: "/app/phone-numbers", icon: Phone, iconColor: "text-emerald-500" },
  ];

  const { isEnabled: isMessagingEnabled } = usePluginStatus('messaging') as { isEnabled: boolean };

  const monitorItems = [
    ...(isMessagingEnabled ? [{ title: t('nav.conversations', 'Conversations'), url: "/app/conversations", icon: MessageSquare, iconColor: "text-green-500" }] : []),
    { title: t('nav.calls'), url: "/app/calls", icon: Phone, iconColor: "text-blue-500" },
    { title: t('nav.analytics'), url: "/app/analytics", icon: BarChart3, iconColor: "text-purple-500" },
  ];


  // Fetch current user data including credits - ONLY from server, no localStorage fallback
  const { data: user, isLoading: userLoading } = useQuery<User>({
    queryKey: ["/api/auth/me"],
  });

  // If no user data from server, don't render (security: prevents localStorage spoofing)
  if (userLoading || !user) {
    return null;
  }

  const userName = user.name || "User";
  const userInitial = userName.charAt(0).toUpperCase() || "U";
  
  // Check if user is on any paid plan (not just "pro")
  const isPaidPlan = user.planType && user.planType !== "free";
  
  // Format plan name for display (capitalize first letter)
  const planDisplayName = user.planType 
    ? user.planType.charAt(0).toUpperCase() + user.planType.slice(1) 
    : "Free";

  // Credits from user data
  const remainingCredits = user.credits || 0;
  

  const handleLogout = () => {
    // Logout request clears the HttpOnly refresh token cookie on the server
    fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    }).catch(() => {});
    AuthStorage.clearAuth();
    window.location.href = "/";
  };

  return (
    <Sidebar collapsible="icon">
      {/* Header with responsive logo */}
      <SidebarHeader className="px-3 py-3 border-b border-sidebar-border">
        {/* When expanded: Logo on left, toggle on right */}
        <div className="flex items-center justify-between gap-2 group-data-[collapsible=icon]:hidden">
          {showLogo && (
            <img 
              src={currentLogo!} 
              alt={branding.app_name} 
              className="h-8 w-auto max-w-[140px] object-contain"
            />
          )}
          <SidebarTrigger 
            className="h-6 w-6 shrink-0" 
            data-testid="button-sidebar-toggle" 
          />
        </div>
        {/* When collapsed: Favicon + toggle stacked */}
        <div className="hidden group-data-[collapsible=icon]:flex flex-col items-center gap-2">
          {showFavicon && (
            <img 
              src={branding.favicon_url!} 
              alt={branding.app_name} 
              className="h-6 w-6 object-contain"
            />
          )}
          <SidebarTrigger 
            className="h-5 w-5 shrink-0" 
            data-testid="button-sidebar-toggle-collapsed" 
          />
        </div>
      </SidebarHeader>

      <SidebarContent className="group-data-[collapsible=icon]:px-0 px-2 py-1">
        {/* Home */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {topItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                    tooltip={item.title}
                    data-testid={`link-${item.title.toLowerCase()}`}
                  >
                    <Link href={item.url} onClick={handleNavClick}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Build Section */}
        <SidebarGroup>
          <SidebarGroupLabel className="px-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">{t('sidebar.build')}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {buildItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                    tooltip={item.title}
                    data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    <Link href={item.url} onClick={handleNavClick}>
                      <item.icon className={`h-4 w-4 ${item.iconColor || ''}`} />
                      <span>{item.title}</span>
                      {item.hasPlus && (
                        <Plus className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Telephony Section */}
        <SidebarGroup>
          <SidebarGroupLabel className="px-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">{t('sidebar.telephony')}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {telephonyItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                    tooltip={item.title}
                    data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    <Link href={item.url} onClick={handleNavClick}>
                      <item.icon className={`h-4 w-4 ${item.iconColor || ''}`} />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Monitor Section */}
        <SidebarGroup>
          <SidebarGroupLabel className="px-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">{t('sidebar.monitor')}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {monitorItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                    tooltip={item.title}
                    data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    <Link href={item.url} onClick={handleNavClick}>
                      <item.icon className={`h-4 w-4 ${item.iconColor || ''}`} />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Billing & Credits */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={location === "/app/billing"}
                  tooltip={t('nav.billingCredits') || 'Billing & Credits'}
                  data-testid="link-billing-credits"
                >
                  <Link href="/app/billing" onClick={handleNavClick}>
                    <CreditCard className="h-4 w-4 text-amber-500" />
                    <span>{t('nav.billingCredits') || 'Billing & Credits'}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Settings */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={location === "/app/settings"}
                  tooltip={t('nav.settings') || 'Settings'}
                  data-testid="link-settings"
                >
                  <Link href="/app/settings" onClick={handleNavClick}>
                    <Settings className="h-4 w-4" />
                    <span>{t('nav.settings') || 'Settings'}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Admin - Show for admins only */}
        {user.role === 'admin' && (
          <SidebarGroup>
            <SidebarGroupLabel className="px-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">{t('nav.administration')}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location === "/admin"}
                    tooltip={t('nav.adminDashboard')}
                    data-testid="link-admin-dashboard"
                  >
                    <Link href="/admin" onClick={handleNavClick}>
                      <Shield className="h-4 w-4" />
                      <span>{t('nav.adminDashboard')}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Credit Status - Silver Shiny Design */}
        <div className="mx-2 my-2 group-data-[collapsible=icon]:hidden">
          <div className="relative overflow-hidden rounded-xl border border-slate-300/60 dark:border-slate-600/60 p-3 bg-gradient-to-br from-slate-100 via-slate-50 to-white dark:from-slate-800 dark:via-slate-700 dark:to-slate-800 shadow-sm">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent dark:via-white/10 -translate-x-full animate-[shimmer_3s_ease-in-out_infinite]" style={{ backgroundSize: '200% 100%' }} />
            <div className="relative">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-600 dark:to-slate-700 shadow-inner">
                    <Coins className="h-4 w-4 text-slate-600 dark:text-slate-300" />
                  </div>
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t('sidebar.credits')}</span>
                </div>
                {isPaidPlan ? (
                  <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide bg-gradient-to-r from-amber-400/90 to-yellow-500/90 text-amber-900 dark:from-amber-500 dark:to-yellow-600 dark:text-amber-950 shadow-sm border border-amber-500/30 dark:border-yellow-600/30">
                    {planDisplayName}
                  </span>
                ) : (
                  <Button 
                    variant="ghost" 
                    size="sm"
                    className="h-6 px-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-600/60"
                    onClick={() => setLocation("/app/billing?tab=plans")}
                    data-testid="button-upgrade-inline"
                  >
                    {t('sidebar.upgrade')}
                  </Button>
                )}
              </div>
              <div className="mt-1.5 text-xl font-bold bg-gradient-to-r from-slate-700 via-slate-600 to-slate-700 dark:from-slate-100 dark:via-slate-200 dark:to-slate-100 bg-clip-text text-transparent">
                {remainingCredits.toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      </SidebarContent>

      {/* Footer */}
      <SidebarFooter className="px-2 py-1.5 mt-auto border-t border-sidebar-border">
        {/* User Profile Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <div 
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover-elevate cursor-pointer"
              data-testid="button-user-menu"
            >
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-primary text-primary-foreground text-xs font-medium">
                  {userInitial}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col flex-1 min-w-0">
                <span className="text-xs font-medium text-sidebar-foreground truncate">
                  {userName}
                </span>
                <span className="text-xs text-muted-foreground truncate">{t('sidebar.myWorkspace')}</span>
              </div>
              <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72 p-0">
            {/* Credits Section - Silver Shiny Design */}
            <div className="relative overflow-hidden m-2 rounded-xl border border-slate-300/60 dark:border-slate-600/60 p-4 bg-gradient-to-br from-slate-100 via-slate-50 to-white dark:from-slate-800 dark:via-slate-700 dark:to-slate-800 shadow-sm">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent dark:via-white/10 -translate-x-full animate-[shimmer_3s_ease-in-out_infinite]" style={{ backgroundSize: '200% 100%' }} />
              <div className="relative space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-600 dark:to-slate-700 shadow-inner">
                      <Coins className="h-4 w-4 text-slate-600 dark:text-slate-300" />
                    </div>
                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t('sidebar.credits')}</span>
                  </div>
                  {isPaidPlan ? (
                    <span className="inline-flex items-center rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide bg-gradient-to-r from-amber-400/90 to-yellow-500/90 text-amber-900 dark:from-amber-500 dark:to-yellow-600 dark:text-amber-950 shadow-sm border border-amber-500/30 dark:border-yellow-600/30">
                      {planDisplayName}
                    </span>
                  ) : (
                    <Button 
                      variant="default" 
                      size="sm"
                      className="h-7 px-3 text-xs font-semibold"
                      onClick={() => setLocation("/app/billing?tab=plans")}
                      data-testid="button-upgrade-dropdown"
                    >
                      {t('sidebar.upgrade')}
                    </Button>
                  )}
                </div>
                <div className="text-2xl font-bold bg-gradient-to-r from-slate-700 via-slate-600 to-slate-700 dark:from-slate-100 dark:via-slate-200 dark:to-slate-100 bg-clip-text text-transparent">
                  {remainingCredits.toLocaleString()} <span className="text-sm font-medium text-slate-500 dark:text-slate-400">credits</span>
                </div>
              </div>
            </div>
            <DropdownMenuSeparator />
            
            {/* Account Settings */}
            <DropdownMenuItem 
              onClick={() => setLocation("/app/settings")}
              className="cursor-pointer"
              data-testid="link-account-settings"
            >
              <Settings className="mr-2 h-4 w-4" />
              <span>{t('nav.accountSettings')}</span>
            </DropdownMenuItem>
            
            <DropdownMenuSeparator />
            
            {/* Log out */}
            <DropdownMenuItem 
              onClick={handleLogout}
              className="cursor-pointer text-destructive focus:text-destructive"
              data-testid="button-logout"
            >
              <LogOut className="mr-2 h-4 w-4" />
              <span>{t('auth.logout')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
