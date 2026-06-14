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
import { useState, useEffect, useCallback } from "react";
import { Save, Loader2, AlertCircle, RefreshCw, CheckCircle2, XCircle, Phone, Mic, Pencil, Key, ShieldAlert, Sheet, Copy, ExternalLink } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { useTranslation } from "react-i18next";
import BrandingSettings from "./BrandingSettings";
import SMTPSettings from "./SMTPSettings";

interface Settings {
  default_llm_free: string;
  pro_plan_bonus_credits: number;
  credit_price_per_minute: number;
  min_credit_purchase: number;
  twilio_account_sid: string;
  twilio_auth_token: string;
  twilio_configured: boolean;
  elevenlabs_configured: boolean;
  openai_api_key: string;
  openai_configured: boolean;
  google_oauth_configured: boolean;
  google_client_id_display: string;
  google_client_id_from_env: boolean;
  invoice_prefix: string;
  invoice_start_number: number;
}

interface ConnectionStatus {
  connected: boolean;
  error?: string;
  details?: string;
  loading?: boolean;
}

interface GlobalSettingsProps {
  onSwitchTab?: (tab: string) => void;
}

/**
 * Sanitize error messages to prevent displaying raw HTML or overly technical errors
 * Returns a clean, user-friendly error message
 */
function sanitizeErrorMessage(error: string | undefined, fallbackMessage: string): string | undefined {
  if (!error) return undefined;
  
  // Detect HTML content (like 502 Bad Gateway pages)
  if (error.includes('<html') || error.includes('<!DOCTYPE') || error.includes('<head>') || error.includes('<body>')) {
    return 'Service temporarily unavailable. Please check your server configuration.';
  }
  
  // Detect JSON parsing errors (indicates server returned non-JSON)
  if (error.includes('Unexpected token') || error.includes('JSON')) {
    return 'Service temporarily unavailable. Please check your server configuration.';
  }
  
  // Detect network/connection errors
  if (error.includes('Failed to fetch') || error.includes('NetworkError') || error.includes('ECONNREFUSED')) {
    return 'Unable to connect to server. Please check if the service is running.';
  }
  
  // If error is too long (likely contains debug info), truncate it
  if (error.length > 200) {
    return fallbackMessage;
  }
  
  return error;
}

export default function GlobalSettings({ onSwitchTab }: GlobalSettingsProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [formData, setFormData] = useState<Partial<Settings>>({});
  const [hasChanges, setHasChanges] = useState(false);
  
  const [twilioStatus, setTwilioStatus] = useState<ConnectionStatus>({ connected: false, loading: true });
  const [elevenLabsStatus, setElevenLabsStatus] = useState<ConnectionStatus>({ connected: false, loading: true });
  const [openaiStatus, setOpenaiStatus] = useState<ConnectionStatus>({ connected: false, loading: true });

  const [googleClientId, setGoogleClientId] = useState("");
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [googleSaving, setGoogleSaving] = useState(false);

  const scrollToTwilio = () => {
    document.getElementById('twilio-credentials')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const scrollToOpenai = () => {
    document.getElementById('openai-credentials')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const { data: settings, isLoading, isError: settingsError } = useQuery<Settings>({
    queryKey: ["/api/admin/settings"]
  });

  // KYC Settings Query
  interface VoiceEngineSettings {
    plivo_openai_engine_enabled: boolean;
    twilio_openai_engine_enabled: boolean;
    twilio_kyc_required: boolean;
    plivo_kyc_required: boolean;
  }
  
  const { data: voiceEngineSettings, isLoading: kycSettingsLoading } = useQuery<VoiceEngineSettings>({
    queryKey: ["/api/settings/voice-engine"],
  });

  const isTwilioKycRequired = voiceEngineSettings?.twilio_kyc_required ?? true;
  const isPlivoKycRequired = voiceEngineSettings?.plivo_kyc_required ?? true;

  const updateKycSetting = useMutation({
    mutationFn: async ({ key, enabled }: { key: 'twilio_kyc_required' | 'plivo_kyc_required', enabled: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/settings/${key}`, { value: enabled });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to update setting");
      }
      return { key, enabled };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/voice-engine"] });
      const providerName = data.key === 'twilio_kyc_required' ? 'Twilio' : 'Plivo';
      toast({ 
        title: "KYC setting updated",
        description: data.enabled 
          ? `KYC verification is now required for ${providerName} number purchases` 
          : `KYC verification is no longer required for ${providerName} number purchases`
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

  const testTwilioConnection = useCallback(async () => {
    setTwilioStatus(prev => ({ ...prev, loading: true }));
    try {
      const response = await apiRequest("POST", "/api/admin/test-connection/twilio");
      const data = await response.json();
      const sanitizedError = sanitizeErrorMessage(data.error, 'Twilio credentials not configured');
      setTwilioStatus({ connected: data.connected, error: sanitizedError, loading: false });
    } catch (error: any) {
      const sanitizedError = sanitizeErrorMessage(error.message, 'Connection test failed');
      setTwilioStatus({ connected: false, error: sanitizedError || "Connection test failed", loading: false });
    }
  }, []);

  const testElevenLabsConnection = useCallback(async () => {
    setElevenLabsStatus(prev => ({ ...prev, loading: true }));
    try {
      const response = await apiRequest("POST", "/api/admin/test-connection/elevenlabs");
      const data = await response.json();
      const sanitizedError = sanitizeErrorMessage(data.error, 'ElevenLabs API key not configured');
      setElevenLabsStatus({ connected: data.connected, error: sanitizedError, loading: false });
    } catch (error: any) {
      const sanitizedError = sanitizeErrorMessage(error.message, 'Connection test failed');
      setElevenLabsStatus({ connected: false, error: sanitizedError || "Connection test failed", loading: false });
    }
  }, []);

  const testOpenAIConnection = useCallback(async () => {
    setOpenaiStatus(prev => ({ ...prev, loading: true }));
    try {
      const response = await apiRequest("POST", "/api/admin/test-connection/openai");
      const data = await response.json();
      const sanitizedError = sanitizeErrorMessage(data.error, 'OpenAI API key not configured');
      setOpenaiStatus({ connected: data.connected, error: sanitizedError, loading: false });
    } catch (error: any) {
      const sanitizedError = sanitizeErrorMessage(error.message, 'Connection test failed');
      setOpenaiStatus({ connected: false, error: sanitizedError || "Connection test failed", loading: false });
    }
  }, []);

  const testAllConnections = useCallback(() => {
    testTwilioConnection();
    testElevenLabsConnection();
    testOpenAIConnection();
  }, [testTwilioConnection, testElevenLabsConnection, testOpenAIConnection]);

  useEffect(() => {
    if (settings) {
      setFormData(settings);
      testAllConnections();
    }
  }, [settings, testAllConnections]);

  // Handle settings query failure - reset loading states to prevent infinite spinners
  useEffect(() => {
    if (settingsError) {
      setTwilioStatus({ connected: false, error: 'Unable to load settings', loading: false });
      setElevenLabsStatus({ connected: false, error: 'Unable to load settings', loading: false });
      setOpenaiStatus({ connected: false, error: 'Unable to load settings', loading: false });
    }
  }, [settingsError]);

  const updateSetting = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: any }) => {
      return apiRequest("PATCH", `/api/admin/settings/${key}`, { value });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings"] });
    },
    onError: (error: any) => {
      toast({
        title: t("admin.settings.updateFailed"),
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const handleChange = (key: keyof Settings, value: any) => {
    setFormData({
      ...formData,
      [key]: value
    });
    setHasChanges(true);
  };

  const handleSave = async () => {
    const promises = Object.keys(formData).map((key) => {
      if (key !== 'twilio_configured' && key !== 'elevenlabs_configured' && key !== 'openai_configured') {
        const typedKey = key as keyof Settings;
        if (formData[typedKey] !== settings?.[typedKey]) {
          return updateSetting.mutateAsync({
            key,
            value: formData[typedKey]
          });
        }
      }
      return Promise.resolve();
    });

    try {
      await Promise.all(promises);
      toast({ title: t("admin.settings.settingsUpdated") });
      setHasChanges(false);
    } catch (error) {
    }
  };

  const handleSaveGoogleOAuth = async () => {
    if (!googleClientId && !googleClientSecret) {
      toast({ title: "No changes to save", variant: "destructive" });
      return;
    }
    setGoogleSaving(true);
    try {
      const tasks: Promise<any>[] = [];
      if (googleClientId.trim()) {
        tasks.push(apiRequest("PATCH", "/api/admin/settings/google_client_id", { value: googleClientId.trim() }));
      }
      if (googleClientSecret.trim()) {
        tasks.push(apiRequest("PATCH", "/api/admin/settings/google_client_secret", { value: googleClientSecret.trim() }));
      }
      await Promise.all(tasks);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings"] });
      setGoogleClientId("");
      setGoogleClientSecret("");
      toast({ title: "Google OAuth credentials saved" });
    } catch (err: any) {
      toast({ title: "Failed to save Google OAuth credentials", description: err?.message, variant: "destructive" });
    } finally {
      setGoogleSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const isAnyLoading = twilioStatus.loading || elevenLabsStatus.loading || openaiStatus.loading;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold">{t("admin.settings.title")}</h2>
          <p className="text-muted-foreground">
            {t("admin.settings.description")}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={testAllConnections}
          disabled={isAnyLoading}
          data-testid="button-refresh-connections"
        >
          {isAnyLoading ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          {t("admin.settings.connectionStatus.refreshAll") || "Refresh Status"}
        </Button>
      </div>

      {/* Connection Status Tiles */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Twilio Connection Status */}
        <Card className={`relative overflow-hidden border-2 ${twilioStatus.loading 
          ? 'border-muted bg-gradient-to-br from-muted/5 to-transparent'
          : twilioStatus.connected 
            ? 'border-emerald-500/30 bg-gradient-to-br from-emerald-500/5 to-transparent' 
            : 'border-red-500/30 bg-gradient-to-br from-red-500/5 to-transparent'}`}>
          <div className={`absolute top-0 right-0 w-24 h-24 rounded-full blur-3xl ${
            twilioStatus.loading ? 'bg-muted/20' : twilioStatus.connected ? 'bg-emerald-500/20' : 'bg-red-500/20'
          }`} />
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <div className={`p-3 rounded-xl ${
                  twilioStatus.loading 
                    ? 'bg-muted/10 ring-1 ring-muted/20'
                    : twilioStatus.connected 
                      ? 'bg-emerald-500/10 ring-1 ring-emerald-500/20' 
                      : 'bg-red-500/10 ring-1 ring-red-500/20'
                }`}>
                  {twilioStatus.loading ? (
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  ) : (
                    <Phone className={`h-6 w-6 ${
                      twilioStatus.connected ? 'text-emerald-500' : 'text-red-500'
                    }`} />
                  )}
                </div>
                <div>
                  <CardTitle className="text-lg">{t("admin.settings.twilio.title") || "Twilio API Credentials"}</CardTitle>
                  <CardDescription className="text-sm">
                    {t("admin.settings.connectionStatus.telephony") || "Voice & SMS telephony"}
                  </CardDescription>
                </div>
              </div>
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full font-medium text-sm ${
                twilioStatus.loading
                  ? 'bg-muted/10 text-muted-foreground ring-1 ring-muted/30'
                  : twilioStatus.connected
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/30'
                    : 'bg-red-500/10 text-red-600 dark:text-red-400 ring-1 ring-red-500/30'
              }`}>
                {twilioStatus.loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{t("admin.settings.connectionStatus.checking") || "Checking..."}</span>
                  </>
                ) : twilioStatus.connected ? (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    <span>{t("admin.settings.connectionStatus.connected") || "Connected"}</span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4" />
                    <span>{t("admin.settings.connectionStatus.disconnected") || "Disconnected"}</span>
                  </>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                {twilioStatus.loading 
                  ? (t("admin.settings.connectionStatus.verifying") || "Verifying API connection...")
                  : twilioStatus.connected 
                    ? (t("admin.settings.connectionStatus.twilioReady") || "Twilio is configured and ready for calls")
                    : twilioStatus.error || (t("admin.settings.connectionStatus.twilioSetup") || "Configure Twilio credentials below to enable calling")}
              </p>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={scrollToTwilio}
                className="shrink-0"
                data-testid="button-edit-twilio"
              >
                <Pencil className="h-4 w-4 mr-2" />
                {t("admin.settings.connectionStatus.edit") || "Edit"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ElevenLabs Connection Status */}
        <Card className={`relative overflow-hidden border-2 ${elevenLabsStatus.loading 
          ? 'border-muted bg-gradient-to-br from-muted/5 to-transparent'
          : elevenLabsStatus.connected 
            ? 'border-emerald-500/30 bg-gradient-to-br from-emerald-500/5 to-transparent' 
            : 'border-red-500/30 bg-gradient-to-br from-red-500/5 to-transparent'}`}>
          <div className={`absolute top-0 right-0 w-24 h-24 rounded-full blur-3xl ${
            elevenLabsStatus.loading ? 'bg-muted/20' : elevenLabsStatus.connected ? 'bg-emerald-500/20' : 'bg-red-500/20'
          }`} />
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <div className={`p-3 rounded-xl ${
                  elevenLabsStatus.loading 
                    ? 'bg-muted/10 ring-1 ring-muted/20'
                    : elevenLabsStatus.connected 
                      ? 'bg-emerald-500/10 ring-1 ring-emerald-500/20' 
                      : 'bg-red-500/10 ring-1 ring-red-500/20'
                }`}>
                  {elevenLabsStatus.loading ? (
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  ) : (
                    <Mic className={`h-6 w-6 ${
                      elevenLabsStatus.connected ? 'text-emerald-500' : 'text-red-500'
                    }`} />
                  )}
                </div>
                <div>
                  <CardTitle className="text-lg">{t("admin.settings.elevenlabs.title") || "ElevenLabs"}</CardTitle>
                  <CardDescription className="text-sm">
                    {t("admin.settings.connectionStatus.aiVoice") || "AI voice synthesis"}
                  </CardDescription>
                </div>
              </div>
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full font-medium text-sm ${
                elevenLabsStatus.loading
                  ? 'bg-muted/10 text-muted-foreground ring-1 ring-muted/30'
                  : elevenLabsStatus.connected
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/30'
                    : 'bg-red-500/10 text-red-600 dark:text-red-400 ring-1 ring-red-500/30'
              }`}>
                {elevenLabsStatus.loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{t("admin.settings.connectionStatus.checking") || "Checking..."}</span>
                  </>
                ) : elevenLabsStatus.connected ? (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    <span>{t("admin.settings.connectionStatus.connected") || "Connected"}</span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4" />
                    <span>{t("admin.settings.connectionStatus.disconnected") || "Disconnected"}</span>
                  </>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                {elevenLabsStatus.loading 
                  ? (t("admin.settings.connectionStatus.verifying") || "Verifying API connection...")
                  : elevenLabsStatus.connected 
                    ? (t("admin.settings.connectionStatus.elevenLabsReady") || "ElevenLabs is configured for AI voice agents")
                    : elevenLabsStatus.error || (t("admin.settings.connectionStatus.elevenLabsSetup") || "Add API keys via the key pool to enable AI voices")}
              </p>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => onSwitchTab?.("elevenlabs")}
                className="shrink-0"
                data-testid="button-manage-elevenlabs-keys"
              >
                <Key className="h-4 w-4 mr-2" />
                {t("admin.settings.connectionStatus.manageKeys") || "Manage Keys"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* OpenAI Connection Status */}
        <Card className={`relative overflow-hidden border-2 ${openaiStatus.loading 
          ? 'border-muted bg-gradient-to-br from-muted/5 to-transparent'
          : openaiStatus.connected 
            ? 'border-emerald-500/30 bg-gradient-to-br from-emerald-500/5 to-transparent' 
            : 'border-red-500/30 bg-gradient-to-br from-red-500/5 to-transparent'}`}>
          <div className={`absolute top-0 right-0 w-24 h-24 rounded-full blur-3xl ${
            openaiStatus.loading ? 'bg-muted/20' : openaiStatus.connected ? 'bg-emerald-500/20' : 'bg-red-500/20'
          }`} />
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <div className={`p-3 rounded-xl ${
                  openaiStatus.loading 
                    ? 'bg-muted/10 ring-1 ring-muted/20'
                    : openaiStatus.connected 
                      ? 'bg-emerald-500/10 ring-1 ring-emerald-500/20' 
                      : 'bg-red-500/10 ring-1 ring-red-500/20'
                }`}>
                  {openaiStatus.loading ? (
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  ) : (
                    <svg className={`h-6 w-6 ${openaiStatus.connected ? 'text-emerald-500' : 'text-red-500'}`} viewBox="0 0 24 24" fill="currentColor">
                      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
                    </svg>
                  )}
                </div>
                <div>
                  <CardTitle className="text-lg">{t("admin.settings.openai.title") || "OpenAI API"}</CardTitle>
                  <CardDescription className="text-sm">
                    {t("admin.settings.connectionStatus.embeddings") || "Embeddings & RAG"}
                  </CardDescription>
                </div>
              </div>
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full font-medium text-sm ${
                openaiStatus.loading
                  ? 'bg-muted/10 text-muted-foreground ring-1 ring-muted/30'
                  : openaiStatus.connected
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/30'
                    : 'bg-red-500/10 text-red-600 dark:text-red-400 ring-1 ring-red-500/30'
              }`}>
                {openaiStatus.loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{t("admin.settings.connectionStatus.checking") || "Checking..."}</span>
                  </>
                ) : openaiStatus.connected ? (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    <span>{t("admin.settings.connectionStatus.connected") || "Connected"}</span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4" />
                    <span>{t("admin.settings.connectionStatus.disconnected") || "Disconnected"}</span>
                  </>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                {openaiStatus.loading 
                  ? (t("admin.settings.connectionStatus.verifying") || "Verifying API connection...")
                  : openaiStatus.connected 
                    ? (t("admin.settings.connectionStatus.openaiReady") || "OpenAI is configured for RAG embeddings")
                    : openaiStatus.error || (t("admin.settings.connectionStatus.openaiSetup") || "Configure OpenAI API key for embeddings")}
              </p>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={scrollToOpenai}
                className="shrink-0"
                data-testid="button-edit-openai"
              >
                <Pencil className="h-4 w-4 mr-2" />
                {t("admin.settings.connectionStatus.edit") || "Edit"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 1. Branding Settings */}
      <BrandingSettings />

      {/* 2. Twilio API Credentials */}
      <Card id="twilio-credentials">
        <CardHeader>
          <CardTitle>{t("admin.settings.twilio.title")}</CardTitle>
          <CardDescription>
            {t("admin.settings.twilio.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="flex items-center">
              <Label>{t("admin.settings.twilio.accountSid")}</Label>
              <InfoTooltip content={t("admin.settings.twilio.accountSidTooltip")} />
            </div>
            <Input
              type="password"
              value={formData.twilio_account_sid || ""}
              onChange={(e) => handleChange("twilio_account_sid", e.target.value)}
              placeholder={t("admin.settings.twilio.accountSidPlaceholder")}
              data-testid="input-twilio-sid"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {t("admin.settings.twilio.accountSidFormat")}
            </p>
          </div>
          <div>
            <div className="flex items-center">
              <Label>{t("admin.settings.twilio.authToken")}</Label>
              <InfoTooltip content={t("admin.settings.twilio.authTokenTooltip")} />
            </div>
            <Input
              type="password"
              value={formData.twilio_auth_token || ""}
              onChange={(e) => handleChange("twilio_auth_token", e.target.value)}
              placeholder={t("admin.settings.twilio.authTokenPlaceholder")}
              data-testid="input-twilio-token"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {t("admin.settings.twilio.authTokenFormat")}
            </p>
          </div>
          {settings?.twilio_configured && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-sm text-green-600">
                {t("admin.settings.twilio.configured")}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* 3. OpenAI API Credentials */}
      <Card id="openai-credentials">
        <CardHeader>
          <CardTitle>{t("admin.settings.openai.title")}</CardTitle>
          <CardDescription>
            {t("admin.settings.openai.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="flex items-center">
              <Label>{t("admin.settings.openai.apiKey")}</Label>
              <InfoTooltip content={t("admin.settings.openai.apiKeyTooltip")} />
            </div>
            <Input
              type="password"
              value={formData.openai_api_key || ""}
              onChange={(e) => handleChange("openai_api_key", e.target.value)}
              placeholder={t("admin.settings.openai.apiKeyPlaceholder")}
              data-testid="input-openai-key"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {t("admin.settings.openai.apiKeyFormat")}
            </p>
          </div>
          {settings?.openai_configured && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-sm text-green-600">
                {formData.openai_api_key ? t("admin.settings.openai.configuredViaDb") : t("admin.settings.openai.configuredViaEnv")}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* 4. Google OAuth Credentials */}
      <Card id="google-oauth-credentials">
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <Sheet className="h-5 w-5 text-muted-foreground" />
              <div>
                <CardTitle>Google OAuth Credentials</CardTitle>
                <CardDescription>
                  Required for Google Sheets integration. Create an OAuth 2.0 client in Google Cloud Console.
                </CardDescription>
              </div>
            </div>
            {settings?.google_oauth_configured && (
              <div className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/30">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Configured</span>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Setup guide — redirect URI that must be added in Google Cloud Console */}
          <div className="rounded-md border bg-muted/40 p-3 space-y-2">
            <p className="text-xs font-medium text-foreground">Setup guide</p>
            <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
              <li>
                Go to{" "}
                <a
                  href="https://console.cloud.google.com/apis/credentials"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Google Cloud Console <ExternalLink className="h-3 w-3" />
                </a>
                {" "}and create an OAuth 2.0 Client ID (Web application type).
              </li>
              <li>Enable the <strong>Google Sheets API</strong> and <strong>Google Drive API</strong> in your project.</li>
              <li>Add the following URL as an <strong>Authorized Redirect URI</strong>:</li>
            </ol>
            <div className="flex items-center gap-2 mt-1">
              <code className="flex-1 text-xs bg-background border rounded px-2 py-1 font-mono text-foreground truncate" data-testid="text-redirect-uri">
                {typeof window !== "undefined" ? `${window.location.origin}/app/google-callback` : "/app/google-callback"}
              </code>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  const uri = `${window.location.origin}/app/google-callback`;
                  navigator.clipboard.writeText(uri).then(() =>
                    toast({ title: "Redirect URI copied to clipboard" })
                  );
                }}
                data-testid="button-copy-redirect-uri"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div>
            <div className="flex items-center">
              <Label>Client ID</Label>
              <InfoTooltip content="The OAuth 2.0 Client ID from Google Cloud Console. Found under APIs & Services > Credentials > your OAuth 2.0 client. Ends with .apps.googleusercontent.com" />
            </div>
            <Input
              type="text"
              value={googleClientId}
              onChange={(e) => setGoogleClientId(e.target.value)}
              placeholder={
                settings?.google_oauth_configured
                  ? (settings?.google_client_id_from_env ? "Configured via environment variable" : "Saved — enter new value to update")
                  : "Paste your Google OAuth Client ID"
              }
              data-testid="input-google-client-id"
            />
            {settings?.google_client_id_display && !settings?.google_client_id_from_env && (
              <p className="text-xs text-muted-foreground mt-1">
                Current: <span className="font-mono">{settings.google_client_id_display}</span>
              </p>
            )}
            {settings?.google_client_id_from_env && (
              <p className="text-xs text-muted-foreground mt-1">
                Loaded from environment variable. Enter a value here to override.
              </p>
            )}
          </div>
          <div>
            <div className="flex items-center">
              <Label>Client Secret</Label>
              <InfoTooltip content="The OAuth 2.0 Client Secret from Google Cloud Console. Found next to your Client ID. Keep this confidential — it is stored encrypted and never exposed in the UI." />
            </div>
            <Input
              type="password"
              value={googleClientSecret}
              onChange={(e) => setGoogleClientSecret(e.target.value)}
              placeholder={
                settings?.google_oauth_configured
                  ? (settings?.google_client_id_from_env ? "Configured via environment variable" : "Saved — enter new value to update")
                  : "Paste your Google OAuth Client Secret"
              }
              data-testid="input-google-client-secret"
            />
          </div>
          {!settings?.google_oauth_configured && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                Google OAuth is not configured. Users will not be able to connect Google Sheets until credentials are saved.
              </AlertDescription>
            </Alert>
          )}
          <div className="flex justify-end">
            <Button
              onClick={handleSaveGoogleOAuth}
              disabled={(!googleClientId.trim() && !googleClientSecret.trim()) || googleSaving}
              data-testid="button-save-google-oauth"
            >
              {googleSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save Google OAuth
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 5. SMTP Email Settings */}
      <SMTPSettings />

      {/* 5-8. Plan Settings, Pricing, System Resources, System Tools */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 5. Plan Settings */}
        <Card>
          <CardHeader>
            <CardTitle>{t("admin.settings.planSettings.title")}</CardTitle>
            <CardDescription>
              {t("admin.settings.planSettings.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex items-center">
                <Label>{t("admin.settings.planSettings.defaultLlm")}</Label>
                <InfoTooltip content={t("admin.settings.planSettings.defaultLlmTooltip")} />
              </div>
              <Input
                value={formData.default_llm_free || ""}
                onChange={(e) => handleChange("default_llm_free", e.target.value)}
                placeholder={t("admin.settings.planSettings.defaultLlmPlaceholder")}
                data-testid="input-default-llm"
              />
            </div>
            <div>
              <div className="flex items-center">
                <Label>{t("admin.settings.planSettings.bonusCredits")}</Label>
                <InfoTooltip content={t("admin.settings.planSettings.bonusCreditsTooltip")} />
              </div>
              <Input
                type="number"
                value={formData.pro_plan_bonus_credits || 0}
                onChange={(e) => handleChange("pro_plan_bonus_credits", parseInt(e.target.value) || 0)}
                data-testid="input-bonus-credits"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t("admin.settings.planSettings.bonusCreditsHint")}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* 6. Pricing Settings - only Credit Price, Phone Monthly Cost, Min Purchase */}
        <Card>
          <CardHeader>
            <CardTitle>{t("admin.settings.pricing.title")}</CardTitle>
            <CardDescription>
              {t("admin.settings.pricing.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex items-center">
                <Label>{t("admin.settings.pricing.creditPrice")}</Label>
                <InfoTooltip content={t("admin.settings.pricing.creditPriceTooltip")} />
              </div>
              <Input
                type="number"
                step="0.01"
                value={formData.credit_price_per_minute || 0}
                onChange={(e) => handleChange("credit_price_per_minute", parseFloat(e.target.value) || 0)}
                data-testid="input-credit-price"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t("admin.settings.pricing.creditPriceHint")}
              </p>
            </div>
            <div>
              <div className="flex items-center">
                <Label>{t("admin.settings.pricing.minPurchase")}</Label>
                <InfoTooltip content={t("admin.settings.pricing.minPurchaseTooltip")} />
              </div>
              <Input
                type="number"
                value={formData.min_credit_purchase || 10}
                onChange={(e) => handleChange("min_credit_purchase", parseInt(e.target.value) || 10)}
                data-testid="input-min-purchase"
              />
            </div>
          </CardContent>
        </Card>

        {/* 7. Invoice Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Invoice Settings</CardTitle>
            <CardDescription>
              Configure invoice numbering format and series
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex items-center">
                <Label>Invoice Prefix</Label>
                <InfoTooltip content="Prefix for invoice numbers (e.g., 'INV' creates INV-2025-00001)" />
              </div>
              <Input
                value={formData.invoice_prefix || "INV"}
                onChange={(e) => handleChange("invoice_prefix", e.target.value.toUpperCase())}
                placeholder="INV"
                data-testid="input-invoice-prefix"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Format: PREFIX-YEAR-NUMBER (e.g., INV-2025-00001)
              </p>
            </div>
            <div>
              <div className="flex items-center">
                <Label>Starting Number</Label>
                <InfoTooltip content="Starting number for the invoice series. Leave at 1 to continue from existing invoices." />
              </div>
              <Input
                type="number"
                min="1"
                value={formData.invoice_start_number || 1}
                onChange={(e) => handleChange("invoice_start_number", parseInt(e.target.value) || 1)}
                data-testid="input-invoice-start"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Used only when no invoices exist for the current year
              </p>
            </div>
          </CardContent>
        </Card>

        {/* 8. KYC Verification Requirements */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3">
              <ShieldAlert className="h-5 w-5" />
              <div>
                <CardTitle className="text-lg">KYC Verification Requirements</CardTitle>
                <CardDescription>
                  Control whether users must complete KYC verification before purchasing phone numbers
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Twilio Phone Numbers</p>
                <p className="text-xs text-muted-foreground">
                  Require KYC verification for Twilio number purchases
                </p>
              </div>
              {kycSettingsLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <div className="flex items-center gap-3">
                  <Label htmlFor="twilio-kyc-toggle" className="text-sm text-muted-foreground">
                    {isTwilioKycRequired ? "Required" : "Not Required"}
                  </Label>
                  <Switch
                    id="twilio-kyc-toggle"
                    checked={isTwilioKycRequired}
                    onCheckedChange={(checked) => updateKycSetting.mutate({ key: 'twilio_kyc_required', enabled: checked })}
                    disabled={updateKycSetting.isPending}
                    data-testid="switch-twilio-kyc-required"
                  />
                </div>
              )}
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Plivo Phone Numbers</p>
                <p className="text-xs text-muted-foreground">
                  Require KYC verification for Plivo number purchases
                </p>
              </div>
              {kycSettingsLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <div className="flex items-center gap-3">
                  <Label htmlFor="plivo-kyc-toggle" className="text-sm text-muted-foreground">
                    {isPlivoKycRequired ? "Required" : "Not Required"}
                  </Label>
                  <Switch
                    id="plivo-kyc-toggle"
                    checked={isPlivoKycRequired}
                    onCheckedChange={(checked) => updateKycSetting.mutate({ key: 'plivo_kyc_required', enabled: checked })}
                    disabled={updateKycSetting.isPending}
                    data-testid="switch-plivo-kyc-required"
                  />
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              When enabled, users must upload and have their KYC documents approved in their Profile before purchasing numbers from the respective provider. 
              Required documents: Photo ID, Company Registration, GST Certificate, and Authorization Letter.
            </p>
          </CardContent>
        </Card>

      </div>

      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={!hasChanges || updateSetting.isPending}
          data-testid="button-save-settings"
        >
          {updateSetting.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("admin.settings.saving")}
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              {t("admin.settings.saveSettings")}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

