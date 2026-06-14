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
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { Loader2, AlertCircle, RefreshCw, Activity, Cpu, MemoryStick, Server, CheckCircle2, Info, ChevronDown, ChevronUp } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

interface AutoRestartSettings {
  auto_restart_enabled: boolean;
  auto_restart_ram_percent: number;
  auto_restart_cpu_percent: number;
}

interface ResourceStatus {
  settings: {
    enabled: boolean;
    ramPercent: number;
    cpuPercent: number;
  };
  current: {
    ramPercent: number;
    ramUsedGB: number;
    ramTotalGB: number;
    cpuPercent: number;
    cpuLoadAvg1m: number;
    cpuCores: number;
    cpuMethod: 'process' | 'loadavg';
    processMemoryMB: number;
  };
  watchdogActive: boolean;
  environment: 'development' | 'production';
}

export default function AutoRestartModule() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [formData, setFormData] = useState<Partial<AutoRestartSettings>>({});
  const [isRefreshingResources, setIsRefreshingResources] = useState(false);
  const [showEnvDocs, setShowEnvDocs] = useState(false);

  const { data: settings, isLoading } = useQuery<AutoRestartSettings>({
    queryKey: ["/api/admin/settings"],
    select: (data: any) => ({
      auto_restart_enabled: data.auto_restart_enabled ?? false,
      auto_restart_ram_percent: data.auto_restart_ram_percent ?? 75,
      auto_restart_cpu_percent: data.auto_restart_cpu_percent ?? 85
    })
  });

  const { 
    data: resourceStatus, 
    refetch: refetchResourceStatus, 
    isLoading: isLoadingResources, 
    isError: isResourceError 
  } = useQuery<ResourceStatus>({
    queryKey: ["/api/admin/resource-status"],
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (settings) {
      setFormData(settings);
    }
  }, [settings]);

  const updateSetting = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: any }) => {
      return apiRequest("PATCH", `/api/admin/settings/${key}`, { value });
    },
    onSuccess: async (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings"] });
      if (variables.key.startsWith('auto_restart_')) {
        queryClient.invalidateQueries({ queryKey: ["/api/admin/resource-status"] });
        await refetchResourceStatus();
      }
      toast({
        title: t("admin.settings.settingsUpdated"),
        description: t("admin.settings.autoRestart.title"),
      });
    },
    onError: (error: any) => {
      toast({
        title: t("admin.settings.updateFailed"),
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const handleChange = (key: keyof AutoRestartSettings, value: any) => {
    let clampedValue = value;
    
    if (key === 'auto_restart_ram_percent') {
      const numValue = Number(value);
      if (isNaN(numValue)) {
        clampedValue = 75;
      } else {
        clampedValue = Math.max(50, Math.min(95, numValue));
      }
    } else if (key === 'auto_restart_cpu_percent') {
      const numValue = Number(value);
      if (isNaN(numValue)) {
        clampedValue = 85;
      } else {
        clampedValue = Math.max(20, Math.min(95, numValue));
      }
    }
    
    setFormData((prev) => ({ ...prev, [key]: clampedValue }));
    updateSetting.mutate({ key, value: clampedValue });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t("admin.settings.autoRestart.title")}</h2>
        <p className="text-muted-foreground">
          {t("admin.settings.autoRestart.description")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <div className={`p-3 rounded-xl ${
                formData.auto_restart_enabled 
                  ? 'bg-emerald-500/10 ring-1 ring-emerald-500/20' 
                  : 'bg-muted ring-1 ring-border'
              }`}>
                <Activity className={`h-6 w-6 ${
                  formData.auto_restart_enabled ? 'text-emerald-500' : 'text-muted-foreground'
                }`} />
              </div>
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Server className="h-5 w-5" />
                  {t("admin.settings.autoRestart.enableToggle")}
                </CardTitle>
                <CardDescription>
                  {t("admin.settings.autoRestart.enableToggleDesc")}
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="auto-restart-toggle" className="text-sm">
                {formData.auto_restart_enabled 
                  ? t("admin.settings.autoRestart.enabled") 
                  : t("admin.settings.autoRestart.disabled")}
              </Label>
              <Switch
                id="auto-restart-toggle"
                checked={formData.auto_restart_enabled || false}
                onCheckedChange={(checked) => handleChange("auto_restart_enabled", checked)}
                data-testid="switch-auto-restart-enabled"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoadingResources && !resourceStatus && (
            <div className="flex items-center justify-center p-4 bg-muted/50 rounded-lg">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span className="text-sm text-muted-foreground">
                {t("admin.settings.autoRestart.loadingStatus")}
              </span>
            </div>
          )}
          
          {isResourceError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="flex items-center justify-between gap-4">
                <span className="text-sm">
                  {t("admin.settings.autoRestart.statusError")}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchResourceStatus()}
                  data-testid="button-retry-resources"
                >
                  {t("common.tryAgain")}
                </Button>
              </AlertDescription>
            </Alert>
          )}
          
          {resourceStatus && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">{t("admin.settings.autoRestart.watchdogStatus")}</h4>
                <Badge variant={resourceStatus.watchdogActive ? "default" : "secondary"}>
                  {resourceStatus.watchdogActive 
                    ? <><CheckCircle2 className="h-3 w-3 mr-1" />{t("admin.settings.autoRestart.watchdogActive")}</>
                    : t("admin.settings.autoRestart.watchdogInactive")}
                </Badge>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg" data-testid="container-resource-status">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <MemoryStick className="h-4 w-4" />
                    {t("admin.settings.autoRestart.currentRam")}
                  </div>
                  <Progress 
                    value={resourceStatus.current.ramPercent ?? 0} 
                    className={`h-2 ${(resourceStatus.current.ramPercent ?? 0) > (formData.auto_restart_ram_percent || 75) ? 'bg-red-100' : ''}`}
                    data-testid="progress-ram"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span data-testid="text-ram-usage">
                      {(resourceStatus.current.ramUsedGB ?? 0).toFixed(1)} GB / {(resourceStatus.current.ramTotalGB ?? 0).toFixed(1)} GB
                    </span>
                    <span 
                      className={(resourceStatus.current.ramPercent ?? 0) > (formData.auto_restart_ram_percent || 75) ? 'text-red-500 font-medium' : ''}
                      data-testid="text-ram-percent"
                    >
                      {(resourceStatus.current.ramPercent ?? 0).toFixed(1)}%
                    </span>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Cpu className="h-4 w-4" />
                    {t("admin.settings.autoRestart.currentCpu")}
                    {resourceStatus.current.cpuCores && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0" data-testid="badge-cpu-cores">
                        {resourceStatus.current.cpuCores} {t("admin.settings.autoRestart.cores")}
                      </Badge>
                    )}
                  </div>
                  <Progress 
                    value={Math.min(resourceStatus.current.cpuPercent ?? 0, 100)} 
                    className={`h-2 ${(resourceStatus.current.cpuPercent ?? 0) > (formData.auto_restart_cpu_percent || 85) ? 'bg-red-100' : ''}`}
                    data-testid="progress-cpu"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span data-testid="text-load-avg">
                      {t("admin.settings.autoRestart.loadAvg")}: {resourceStatus.current.cpuLoadAvg1m ?? '-'}
                    </span>
                    <span 
                      className={(resourceStatus.current.cpuPercent ?? 0) > (formData.auto_restart_cpu_percent || 85) ? 'text-red-500 font-medium' : ''}
                      data-testid="text-cpu-percent"
                    >
                      {(resourceStatus.current.cpuPercent ?? 0).toFixed(1)}%
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground" data-testid="text-process-memory">
                    {t("admin.settings.autoRestart.processMemory")}: {resourceStatus.current.processMemoryMB ?? 0} MB
                  </div>
                </div>
              </div>
            </div>
          )}
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center">
                <Label>{t("admin.settings.autoRestart.ramLimit")}</Label>
                <InfoTooltip content={t("admin.settings.autoRestart.ramLimitTooltip")} />
              </div>
              <Input
                type="number"
                min={50}
                max={95}
                value={formData.auto_restart_ram_percent || 75}
                onChange={(e) => handleChange("auto_restart_ram_percent", parseInt(e.target.value) || 75)}
                disabled={!formData.auto_restart_enabled}
                data-testid="input-auto-restart-ram"
              />
              <p className="text-xs text-muted-foreground">
                {t("admin.settings.autoRestart.ramLimitHint")}
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center">
                <Label>{t("admin.settings.autoRestart.cpuLimit")}</Label>
                <InfoTooltip content={t("admin.settings.autoRestart.cpuLimitTooltip")} />
              </div>
              <Input
                type="number"
                min={20}
                max={95}
                value={formData.auto_restart_cpu_percent || 85}
                onChange={(e) => handleChange("auto_restart_cpu_percent", parseInt(e.target.value) || 85)}
                disabled={!formData.auto_restart_enabled}
                data-testid="input-auto-restart-cpu"
              />
              <p className="text-xs text-muted-foreground">
                {t("admin.settings.autoRestart.cpuLimitHint")}
              </p>
            </div>
          </div>

          {formData.auto_restart_enabled && (
            <Alert>
              <Activity className="h-4 w-4" />
              <AlertDescription className="text-sm">
                {t("admin.settings.autoRestart.activeMessage")}
              </AlertDescription>
            </Alert>
          )}

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                setIsRefreshingResources(true);
                try {
                  await refetchResourceStatus();
                } finally {
                  setIsRefreshingResources(false);
                }
              }}
              disabled={isRefreshingResources || isLoadingResources}
              data-testid="button-refresh-resources"
            >
              {isRefreshingResources || isLoadingResources ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("admin.settings.autoRestart.refreshing")}
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {t("admin.settings.autoRestart.refreshStatus")}
                </>
              )}
            </Button>
            
            {resourceStatus?.environment && (
              <Badge 
                variant={resourceStatus.environment === 'production' ? 'default' : 'secondary'}
                data-testid="badge-environment"
              >
                {resourceStatus.environment === 'production' 
                  ? t("admin.settings.autoRestart.envProduction")
                  : t("admin.settings.autoRestart.envDevelopment")}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Environment Documentation */}
      <Card>
        <CardHeader className="pb-3">
          <button
            onClick={() => setShowEnvDocs(!showEnvDocs)}
            className="flex items-center justify-between w-full text-left"
            data-testid="button-toggle-env-docs"
          >
            <div className="flex items-center gap-2">
              <Info className="h-5 w-5 text-blue-500" />
              <CardTitle className="text-base">
                {t("admin.settings.autoRestart.envDocsTitle")}
              </CardTitle>
            </div>
            {showEnvDocs ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
        </CardHeader>
        
        {showEnvDocs && (
          <CardContent className="pt-0 space-y-4">
            <div className="space-y-3 text-sm">
              <div className="p-3 bg-muted/50 rounded-lg space-y-2">
                <h4 className="font-medium flex items-center gap-2">
                  <MemoryStick className="h-4 w-4 text-emerald-500" />
                  {t("admin.settings.autoRestart.ramMonitoringTitle")}
                </h4>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {t("admin.settings.autoRestart.ramMonitoringDesc")}
                </p>
              </div>
              
              <div className="p-3 bg-muted/50 rounded-lg space-y-2">
                <h4 className="font-medium flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-blue-500" />
                  {t("admin.settings.autoRestart.cpuMonitoringTitle")}
                </h4>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {t("admin.settings.autoRestart.cpuMonitoringDesc")}
                </p>
              </div>
              
              <div className="p-3 bg-muted/50 rounded-lg space-y-2">
                <h4 className="font-medium flex items-center gap-2">
                  <Activity className="h-4 w-4 text-orange-500" />
                  {t("admin.settings.autoRestart.restartBehaviorTitle")}
                </h4>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {t("admin.settings.autoRestart.restartBehaviorDesc")}
                </p>
              </div>

              <Alert className="border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30">
                <Info className="h-4 w-4 text-blue-500" />
                <AlertDescription className="text-xs text-blue-700 dark:text-blue-300">
                  {t("admin.settings.autoRestart.productionNote")}
                </AlertDescription>
              </Alert>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
