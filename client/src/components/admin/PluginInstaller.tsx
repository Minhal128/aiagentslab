import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, ensureValidToken } from "@/lib/queryClient";
import { AuthStorage } from "@/lib/auth-storage";

async function safeJson(res: Response, fallbackMsg: string): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(text || fallbackMsg);
  }
}
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Upload,
  Package,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Trash2,
  Database,
  Power,
  PowerOff,
  RefreshCw,
  FileArchive,
  ArrowUpCircle,
} from "lucide-react";
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

interface PluginInfo {
  name: string;
  displayName: string;
  version: string;
  description: string;
  author: string;
  features: string[];
  enabled: boolean;
  registered: boolean;
  tablesStatus: "ok" | "missing" | "unchecked";
  missingTables: string[];
  hasMigrations: boolean;
  hasUI: boolean;
  error?: string;
}

interface ValidationResult {
  manifest: {
    name: string;
    displayName: string;
    version: string;
    description: string;
    author: string;
    features: string[];
  };
  isUpgrade: boolean;
  existingVersion: string | null;
  database: {
    requiredTables: string[];
    tablesExist: string[];
    tablesMissing: string[];
    hasMigrations: boolean;
    migrationFiles: string[];
  };
  hasUI: boolean;
}

interface InstallStep {
  step: string;
  status: "success" | "failed" | "skipped";
  message: string;
}

export default function PluginInstaller() {
  const { toast } = useToast();
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [installSteps, setInstallSteps] = useState<InstallStep[] | null>(null);
  const [showUninstallDialog, setShowUninstallDialog] = useState<string | null>(null);

  const { data: installedPlugins, isLoading: loadingPlugins } = useQuery<{ data: { plugins: PluginInfo[] } }>({
    queryKey: ["/api/admin/plugins/installer/installed"],
  });

  async function getAuthHeaders(): Promise<Record<string, string>> {
    await ensureValidToken();
    const authHeader = AuthStorage.getAuthHeader();
    return authHeader ? { Authorization: authHeader } : {};
  }

  const validateMutation = useMutation({
    mutationFn: async (file: File) => {
      const headers = await getAuthHeaders();
      const formData = new FormData();
      formData.append("plugin", file);
      const res = await fetch("/api/admin/plugins/installer/validate", {
        method: "POST",
        body: formData,
        credentials: "include",
        headers,
      });
      if (!res.ok) {
        const err = await safeJson(res, "Validation failed");
        throw new Error(err.message || err.error || "Validation failed");
      }
      return safeJson(res, "Validation failed");
    },
    onSuccess: (data) => {
      setValidationResult(data.data);
    },
    onError: (error: Error) => {
      toast({ title: "Validation Failed", description: error.message, variant: "destructive" });
      setSelectedFile(null);
    },
  });

  const installMutation = useMutation({
    mutationFn: async (file: File) => {
      const headers = await getAuthHeaders();
      const formData = new FormData();
      formData.append("plugin", file);
      const res = await fetch("/api/admin/plugins/installer/install", {
        method: "POST",
        body: formData,
        credentials: "include",
        headers,
      });
      if (!res.ok) {
        const err = await safeJson(res, "Installation failed");
        throw new Error(err.message || err.error || "Installation failed");
      }
      return safeJson(res, "Installation failed");
    },
    onSuccess: (data) => {
      setInstallSteps(data.data?.steps || []);
      setValidationResult(null);
      setSelectedFile(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/plugins/installer/installed"] });
      toast({
        title: data.success ? "Plugin Installed" : "Installed with Issues",
        description: data.message,
        variant: data.success ? "default" : "destructive",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Installation Failed", description: error.message, variant: "destructive" });
    },
  });

  const enableMutation = useMutation({
    mutationFn: async ({ name, enable }: { name: string; enable: boolean }) => {
      await apiRequest("PUT", `/api/admin/plugins/${name}/${enable ? "enable" : "disable"}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/plugins/installer/installed"] });
      toast({ title: "Plugin Updated", description: "Changes applied. Server will restart automatically." });
    },
    onError: (error: Error) => {
      toast({ title: "Update Failed", description: error.message, variant: "destructive" });
    },
  });

  const uninstallMutation = useMutation({
    mutationFn: async (name: string) => {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/admin/plugins/installer/uninstall/${name}`, {
        method: "DELETE",
        credentials: "include",
        headers,
      });
      if (!res.ok) {
        const err = await safeJson(res, "Uninstall failed");
        throw new Error(err.message || err.error || "Uninstall failed");
      }
      return safeJson(res, "Uninstall failed");
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/plugins/installer/installed"] });
      toast({ title: "Plugin Uninstalled", description: data.message });
      setShowUninstallDialog(null);
    },
    onError: (error: Error) => {
      toast({ title: "Uninstall Failed", description: error.message, variant: "destructive" });
      setShowUninstallDialog(null);
    },
  });

  const runMigrationMutation = useMutation({
    mutationFn: async (name: string) => {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/admin/plugins/installer/run-migration/${name}`, {
        method: "POST",
        credentials: "include",
        headers,
      });
      if (!res.ok) {
        const err = await safeJson(res, "Migration failed");
        throw new Error(err.message || err.error || "Migration failed");
      }
      return safeJson(res, "Migration failed");
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/plugins/installer/installed"] });
      toast({
        title: data.success ? "Migrations Applied" : "Migration Issues",
        description: data.message,
        variant: data.success ? "default" : "destructive",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Migration Failed", description: error.message, variant: "destructive" });
    },
  });

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    else if (e.type === "dragleave") setDragActive(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith(".zip")) {
      setSelectedFile(file);
      setValidationResult(null);
      setInstallSteps(null);
      validateMutation.mutate(file);
    } else {
      toast({ title: "Invalid File", description: "Please upload a .zip file", variant: "destructive" });
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setValidationResult(null);
      setInstallSteps(null);
      validateMutation.mutate(file);
    }
    e.target.value = "";
  }, []);

  const plugins = installedPlugins?.data?.plugins || [];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold" data-testid="text-plugin-installer-title">Plugin Installer</h3>
        <p className="text-sm text-muted-foreground">
          Upload plugin zip files to install or upgrade plugins. Migrations run automatically.
        </p>
      </div>

      <div className="flex items-start gap-3 rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3" data-testid="alert-plugin-trust-warning">
        <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-muted-foreground">
          <span className="font-medium text-yellow-700 dark:text-yellow-300">Security notice:</span>{" "}
          Plugins run with full access to your database and server. Only install plugins from sources you fully trust.
          Plugin migrations execute SQL directly and plugin bundles run JavaScript in the browser.
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Install Plugin
          </CardTitle>
          <CardDescription>Upload a plugin .zip file to install or upgrade</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className={`border-2 border-dashed rounded-md p-8 text-center transition-colors ${
              dragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25"
            }`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            data-testid="dropzone-plugin-upload"
          >
            <FileArchive className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm text-muted-foreground mb-3">
              Drag and drop a plugin .zip file here, or click to browse
            </p>
            <label>
              <input
                type="file"
                accept=".zip"
                className="hidden"
                onChange={handleFileSelect}
                data-testid="input-plugin-file"
              />
              <Button variant="outline" asChild>
                <span data-testid="button-browse-plugin">Browse Files</span>
              </Button>
            </label>
            {selectedFile && (
              <p className="mt-3 text-sm font-medium" data-testid="text-selected-file">
                Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
              </p>
            )}
          </div>

          {validateMutation.isPending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Validating plugin package...
            </div>
          )}

          {validationResult && (
            <Card>
              <CardContent className="pt-4 space-y-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-semibold" data-testid="text-validation-plugin-name">
                        {validationResult.manifest.displayName}
                      </h4>
                      <Badge variant="secondary" data-testid="text-validation-version">
                        v{validationResult.manifest.version}
                      </Badge>
                      {validationResult.isUpgrade && (
                        <Badge variant="outline" data-testid="badge-upgrade">
                          <ArrowUpCircle className="h-3 w-3 mr-1" />
                          Upgrade from v{validationResult.existingVersion}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{validationResult.manifest.description}</p>
                    <p className="text-xs text-muted-foreground mt-1">By {validationResult.manifest.author}</p>
                  </div>
                </div>

                {validationResult.manifest.features.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Features:</p>
                    <div className="flex flex-wrap gap-1">
                      {validationResult.manifest.features.slice(0, 6).map((f, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">
                          {f}
                        </Badge>
                      ))}
                      {validationResult.manifest.features.length > 6 && (
                        <Badge variant="secondary" className="text-xs">
                          +{validationResult.manifest.features.length - 6} more
                        </Badge>
                      )}
                    </div>
                  </div>
                )}

                {validationResult.database.requiredTables.length > 0 && (
                  <div className="text-sm space-y-1">
                    <p className="font-medium flex items-center gap-1">
                      <Database className="h-4 w-4" /> Database
                    </p>
                    <div className="pl-5 space-y-1">
                      {validationResult.database.tablesMissing.length > 0 ? (
                        <p className="text-amber-600 dark:text-amber-400 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          {validationResult.database.tablesMissing.length} table(s) will be created:{" "}
                          {validationResult.database.tablesMissing.join(", ")}
                        </p>
                      ) : (
                        <p className="text-green-600 dark:text-green-400 flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          All required tables already exist
                        </p>
                      )}
                      {validationResult.database.hasMigrations && (
                        <p className="text-xs text-muted-foreground">
                          Migration files: {validationResult.database.migrationFiles.join(", ")}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex gap-2 flex-wrap">
                  <Button
                    onClick={() => selectedFile && installMutation.mutate(selectedFile)}
                    disabled={installMutation.isPending}
                    data-testid="button-install-plugin"
                  >
                    {installMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Installing...
                      </>
                    ) : validationResult.isUpgrade ? (
                      <>
                        <ArrowUpCircle className="h-4 w-4 mr-2" />
                        Upgrade Plugin
                      </>
                    ) : (
                      <>
                        <Package className="h-4 w-4 mr-2" />
                        Install Plugin
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelectedFile(null);
                      setValidationResult(null);
                    }}
                    data-testid="button-cancel-install"
                  >
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {installSteps && installSteps.length > 0 && (
            <Card>
              <CardContent className="pt-4">
                <h4 className="font-semibold mb-3">Installation Results</h4>
                <div className="space-y-2">
                  {installSteps.map((step, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      {step.status === "success" && <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />}
                      {step.status === "failed" && <XCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />}
                      {step.status === "skipped" && <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />}
                      <span className={step.status === "failed" ? "text-red-600 dark:text-red-400" : ""}>{step.message}</span>
                    </div>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => setInstallSteps(null)}
                  data-testid="button-dismiss-results"
                >
                  Dismiss
                </Button>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Installed Plugins
          </CardTitle>
          <CardDescription>Manage installed plugins, run migrations, or uninstall</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingPlugins ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : plugins.length === 0 ? (
            <p className="text-center text-muted-foreground py-8" data-testid="text-no-plugins">
              No plugins installed. Upload a plugin zip file above to get started.
            </p>
          ) : (
            <div className="space-y-3">
              {plugins.map((plugin) => (
                <div
                  key={plugin.name}
                  className="border rounded-md p-4 space-y-3"
                  data-testid={`card-plugin-${plugin.name}`}
                >
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-semibold">{plugin.displayName}</h4>
                        <Badge variant="secondary">v{plugin.version}</Badge>
                        {plugin.enabled && plugin.registered ? (
                          <Badge variant="default" className="bg-green-600" data-testid={`badge-status-${plugin.name}`}>
                            Active
                          </Badge>
                        ) : plugin.enabled && !plugin.registered ? (
                          <Badge variant="outline" className="text-amber-600 border-amber-600" data-testid={`badge-status-${plugin.name}`}>
                            Pending Restart
                          </Badge>
                        ) : (
                          <Badge variant="outline" data-testid={`badge-status-${plugin.name}`}>
                            Disabled
                          </Badge>
                        )}
                        {plugin.tablesStatus === "missing" && (
                          <Badge variant="destructive" data-testid={`badge-tables-${plugin.name}`}>
                            Missing Tables
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{plugin.description}</p>
                      {plugin.error && (
                        <p className="text-xs text-red-500 mt-1">{plugin.error}</p>
                      )}
                      {plugin.tablesStatus === "missing" && plugin.missingTables.length > 0 && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                          Missing: {plugin.missingTables.join(", ")}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {plugin.tablesStatus === "missing" && plugin.hasMigrations && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => runMigrationMutation.mutate(plugin.name)}
                          disabled={runMigrationMutation.isPending}
                          data-testid={`button-migrate-${plugin.name}`}
                        >
                          {runMigrationMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <Database className="h-4 w-4 mr-1" />
                              Run Migration
                            </>
                          )}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => enableMutation.mutate({ name: plugin.name, enable: !plugin.enabled })}
                        disabled={enableMutation.isPending}
                        data-testid={`button-toggle-${plugin.name}`}
                      >
                        {plugin.enabled ? (
                          <>
                            <PowerOff className="h-4 w-4 mr-1" />
                            Disable
                          </>
                        ) : (
                          <>
                            <Power className="h-4 w-4 mr-1" />
                            Enable
                          </>
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowUninstallDialog(plugin.name)}
                        data-testid={`button-uninstall-${plugin.name}`}
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Uninstall
                      </Button>
                    </div>
                  </div>
                  {plugin.features.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {plugin.features.slice(0, 5).map((f, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">
                          {f}
                        </Badge>
                      ))}
                      {plugin.features.length > 5 && (
                        <Badge variant="secondary" className="text-xs">+{plugin.features.length - 5} more</Badge>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/admin/plugins/installer/installed"] })}
              data-testid="button-refresh-plugins"
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={!!showUninstallDialog} onOpenChange={() => setShowUninstallDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Uninstall Plugin</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to uninstall this plugin? The plugin files will be removed, but database tables will be preserved. The server will restart automatically after uninstalling.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-uninstall">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => showUninstallDialog && uninstallMutation.mutate(showUninstallDialog)}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-uninstall"
            >
              {uninstallMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Uninstall"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
