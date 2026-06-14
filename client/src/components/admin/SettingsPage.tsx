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
import { useState, useRef, useEffect, Suspense } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Settings, Search, Server, Sliders, Activity, BarChart3, Key, Phone, Loader2, Globe, Package, ArrowUpCircle, ChevronLeft, ChevronRight, Mail, MessageSquare, Shield } from "lucide-react";
import { useTranslation } from "react-i18next";
import { usePluginStatus } from "@/hooks/use-plugin-status";
import { usePluginRegistry } from "@/contexts/plugin-registry";
import GlobalSettings from "./GlobalSettings";
import SEOModule from "./SEOModule";
import AnalyticsModule from "./AnalyticsModule";
import ElevenLabsPool from "./ElevenLabsPool";
import AutoRestartModule from "./AutoRestartModule";
import SystemSettings from "./SystemSettings";
import AdminApiKeysModule from "./AdminApiKeysModule";
import LanguageManagement from "./LanguageManagement";
import PluginInstaller from "./PluginInstaller";
import SystemUpdate from "./SystemUpdate";

interface SettingsPageProps {
  onSwitchTab?: (tab: string) => void;
  initialSubTab?: string;
}

export default function SettingsPage({ onSwitchTab, initialSubTab }: SettingsPageProps) {
  const { t } = useTranslation();
  const { isRestApiPluginEnabled, isSipPluginEnabled } = usePluginStatus();
  const pluginRegistry = usePluginRegistry();
  const adminSettingsTabs = pluginRegistry.getAdminSettingsTabs();
  const [activeSubTab, setActiveSubTab] = useState(initialSubTab || "master");

  const tabsScrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScrollState = () => {
    const container = tabsScrollRef.current;
    if (container) {
      setCanScrollLeft(container.scrollLeft > 0);
      setCanScrollRight(container.scrollLeft < container.scrollWidth - container.clientWidth - 1);
    }
  };

  const scrollTabsLeft = () => {
    const container = tabsScrollRef.current;
    if (container) {
      container.scrollBy({ left: -200, behavior: 'smooth' });
    }
  };

  const scrollTabsRight = () => {
    const container = tabsScrollRef.current;
    if (container) {
      container.scrollBy({ left: 200, behavior: 'smooth' });
    }
  };

  useEffect(() => {
    checkScrollState();
    window.addEventListener('resize', checkScrollState);
    return () => window.removeEventListener('resize', checkScrollState);
  }, [(Array.isArray(adminSettingsTabs) ? adminSettingsTabs : []).length]);

  const pluginIconMap: Record<string, any> = {
    'Server': Phone,
    'Mail': Mail,
    'MessageSquare': MessageSquare,
    'Shield': Shield,
    'Settings': Settings,
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t("admin.settings.title") || "Settings"}</h2>
        <p className="text-muted-foreground">
          {t("admin.settings.description") || "Configure platform settings, SEO, and integrations"}
        </p>
      </div>

      <Tabs value={activeSubTab} onValueChange={setActiveSubTab} className="space-y-4">
        <div className="relative flex items-center -mx-4 md:-mx-8">
          {canScrollLeft && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute left-2 z-10 rounded-full bg-background/80 backdrop-blur-sm shadow-md border"
              onClick={scrollTabsLeft}
              data-testid="button-scroll-settings-tabs-left"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}

          <div
            ref={tabsScrollRef}
            className="overflow-x-auto flex-1 px-4 md:px-8 pb-2 scrollbar-thin"
            onScroll={checkScrollState}
          >
        <TabsList className="flex gap-1 h-auto w-max min-w-full p-1">
          <TabsTrigger value="master" data-testid="settings-tab-master" className="flex items-center gap-2">
            <Sliders className="h-4 w-4" />
            <span className="hidden sm:inline">{t("admin.settings.tabs.master")}</span>
            <span className="sm:hidden">Master</span>
          </TabsTrigger>
          <TabsTrigger value="elevenlabs" data-testid="settings-tab-elevenlabs" className="flex items-center gap-2">
            <Server className="h-4 w-4" />
            <span className="hidden sm:inline">{t("admin.settings.tabs.elevenlabs")}</span>
            <span className="sm:hidden">ElevenLabs</span>
          </TabsTrigger>
          <TabsTrigger value="seo" data-testid="settings-tab-seo" className="flex items-center gap-2">
            <Search className="h-4 w-4" />
            <span className="hidden sm:inline">{t("admin.settings.tabs.seo")}</span>
            <span className="sm:hidden">SEO</span>
          </TabsTrigger>
          <TabsTrigger value="analytics" data-testid="settings-tab-analytics" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            <span className="hidden sm:inline">{t("admin.settings.tabs.analytics") || "Analytics"}</span>
            <span className="sm:hidden">Analytics</span>
          </TabsTrigger>
          <TabsTrigger value="languages" data-testid="settings-tab-languages" className="flex items-center gap-2">
            <Globe className="h-4 w-4" />
            <span className="hidden sm:inline">{t("admin.settings.tabs.languages") || "Languages"}</span>
            <span className="sm:hidden">Lang</span>
          </TabsTrigger>
          {isRestApiPluginEnabled && (
            <TabsTrigger value="api-keys" data-testid="settings-tab-api-keys" className="flex items-center gap-2">
              <Key className="h-4 w-4" />
              <span className="hidden sm:inline">API Keys</span>
              <span className="sm:hidden">API</span>
            </TabsTrigger>
          )}
          <TabsTrigger value="plugins" data-testid="settings-tab-plugins" className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            <span className="hidden sm:inline">Plugins</span>
            <span className="sm:hidden">Plugins</span>
          </TabsTrigger>
          <TabsTrigger value="system" data-testid="settings-tab-system" className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            <span className="hidden sm:inline">{t("admin.settings.tabs.system")}</span>
            <span className="sm:hidden">System</span>
          </TabsTrigger>
          <TabsTrigger value="update" data-testid="settings-tab-update" className="flex items-center gap-2">
            <ArrowUpCircle className="h-4 w-4" />
            <span className="hidden sm:inline">App Update</span>
            <span className="sm:hidden">Update</span>
          </TabsTrigger>
          {(Array.isArray(adminSettingsTabs) ? adminSettingsTabs : []).map((tab) => {
            const IconComp = (tab.icon ? pluginIconMap[tab.icon] : undefined) || Settings;
            return (
              <TabsTrigger key={tab.id} value={tab.id} data-testid={`settings-tab-${tab.id}`} className="flex items-center gap-2">
                <IconComp className="h-4 w-4" />
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.label.substring(0, 3)}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>
          </div>

          {canScrollRight && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 z-10 rounded-full bg-background/80 backdrop-blur-sm shadow-md border"
              onClick={scrollTabsRight}
              data-testid="button-scroll-settings-tabs-right"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>

        <TabsContent value="master" className="space-y-4">
          <GlobalSettings onSwitchTab={(tab) => {
            if (tab === "elevenlabs") {
              setActiveSubTab("elevenlabs");
            } else {
              onSwitchTab?.(tab);
            }
          }} />
        </TabsContent>

        <TabsContent value="elevenlabs" className="space-y-4">
          <ElevenLabsPool />
        </TabsContent>

        <TabsContent value="seo" className="space-y-4">
          <SEOModule />
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <AnalyticsModule />
        </TabsContent>

        <TabsContent value="languages" className="space-y-4">
          <LanguageManagement />
        </TabsContent>

        {isRestApiPluginEnabled && (
          <TabsContent value="api-keys" className="space-y-4">
            <AdminApiKeysModule />
          </TabsContent>
        )}

        <TabsContent value="plugins" className="space-y-4">
          <PluginInstaller />
        </TabsContent>

        <TabsContent value="system" className="space-y-6">
          <SystemSettings />
          <AutoRestartModule />
        </TabsContent>

        <TabsContent value="update" className="space-y-4">
          <SystemUpdate />
        </TabsContent>

        {(Array.isArray(adminSettingsTabs) ? adminSettingsTabs : []).map((tab) => (
          <TabsContent key={tab.id} value={tab.id} className="space-y-4">
            <Suspense fallback={<div className="flex items-center justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>}>
              <tab.component />
            </Suspense>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
