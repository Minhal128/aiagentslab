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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useState, useRef } from "react";
import { Settings, RefreshCw, Edit, Loader2, CheckCircle, Image, Globe, Type, Tag, X, Upload, Sun, Moon, Mail, Twitter, Linkedin, Github, Link, MapPin, Palette } from "lucide-react";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { AuthStorage } from "@/lib/auth-storage";

function hslCssVarToHex(cssVarName: string): string | null {
  try {
    const rawValue = getComputedStyle(document.documentElement).getPropertyValue(cssVarName).trim();
    if (!rawValue) return null;
    const m = rawValue.match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/);
    if (!m) return null;
    const h = parseFloat(m[1]) / 360;
    const s = parseFloat(m[2]) / 100;
    const l = parseFloat(m[3]) / 100;
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const r = Math.round(hue2rgb(p, q, h + 1/3) * 255);
    const g = Math.round(hue2rgb(p, q, h) * 255);
    const b = Math.round(hue2rgb(p, q, h - 1/3) * 255);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  } catch {
    return null;
  }
}

const COLOR_FIELD_CSS_VARS: Record<string, string> = {
  theme_website_accent: '--brand',
  theme_website_foreground: '--brand-foreground',
  theme_primary: '--primary',
  theme_primary_foreground: '--primary-foreground',
  theme_accent: '--accent',
  theme_background: '--background',
  theme_sidebar: '--sidebar',
};

interface BrandingData {
  app_name: string;
  app_tagline: string;
  admin_email: string | null;
  app_location: string | null;
  logo_url: string | null;
  logo_url_light: string | null;
  logo_url_dark: string | null;
  favicon_url: string | null;
  branding_updated_at: string | null;
  social_twitter_url: string | null;
  social_linkedin_url: string | null;
  social_github_url: string | null;
  theme_primary: string | null;
  theme_primary_foreground: string | null;
  theme_accent: string | null;
  theme_background: string | null;
  theme_sidebar: string | null;
  theme_website_accent: string | null;
  theme_website_foreground: string | null;
}

export default function BrandingSettings() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [formData, setFormData] = useState({
    app_name: "",
    app_tagline: "",
    admin_email: "",
    app_location: "",
    social_twitter_url: "",
    social_linkedin_url: "",
    social_github_url: "",
    theme_primary: "",
    theme_primary_foreground: "",
    theme_accent: "",
    theme_background: "",
    theme_sidebar: "",
    theme_website_accent: "",
    theme_website_foreground: ""
  });
  const [logoLightPreview, setLogoLightPreview] = useState<string | null>(null);
  const [logoDarkPreview, setLogoDarkPreview] = useState<string | null>(null);
  const [faviconPreview, setFaviconPreview] = useState<string | null>(null);
  const [isUploadingLogoLight, setIsUploadingLogoLight] = useState(false);
  const [isUploadingLogoDark, setIsUploadingLogoDark] = useState(false);
  const [isUploadingFavicon, setIsUploadingFavicon] = useState(false);
  
  const logoLightInputRef = useRef<HTMLInputElement>(null);
  const logoDarkInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);

  const { data: branding, isLoading, refetch } = useQuery<BrandingData>({
    queryKey: ["/api/admin/branding"],
  });

  const updateBrandingMutation = useMutation({
    mutationFn: async (data: { app_name: string; app_tagline: string; admin_email: string; app_location: string; social_twitter_url: string; social_linkedin_url: string; social_github_url: string; theme_primary: string; theme_primary_foreground: string; theme_accent: string; theme_background: string; theme_sidebar: string; theme_website_accent: string; theme_website_foreground: string }) => {
      return apiRequest("PATCH", "/api/admin/branding", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/branding"] });
      queryClient.invalidateQueries({ queryKey: ["/api/branding"] });
      toast({ title: t("admin.branding.updateSuccess") });
      setIsEditOpen(false);
    },
    onError: (error: any) => {
      toast({
        title: t("admin.branding.updateFailed"),
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const deleteLogoLightMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("DELETE", "/api/admin/branding/logo-light");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/branding"] });
      queryClient.invalidateQueries({ queryKey: ["/api/branding"] });
      setLogoLightPreview(null);
      toast({ title: t("admin.branding.logoDeleted") });
    }
  });

  const deleteLogoDarkMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("DELETE", "/api/admin/branding/logo-dark");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/branding"] });
      queryClient.invalidateQueries({ queryKey: ["/api/branding"] });
      setLogoDarkPreview(null);
      toast({ title: t("admin.branding.logoDeleted") });
    }
  });

  const deleteFaviconMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("DELETE", "/api/admin/branding/favicon");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/branding"] });
      queryClient.invalidateQueries({ queryKey: ["/api/branding"] });
      setFaviconPreview(null);
      toast({ title: t("admin.branding.faviconDeleted") });
    }
  });

  const handleOpenEdit = () => {
    if (branding) {
      setFormData({
        app_name: branding.app_name,
        app_tagline: branding.app_tagline || "",
        admin_email: branding.admin_email || "",
        app_location: branding.app_location || "",
        social_twitter_url: branding.social_twitter_url || "",
        social_linkedin_url: branding.social_linkedin_url || "",
        social_github_url: branding.social_github_url || "",
        theme_primary: branding.theme_primary || "",
        theme_primary_foreground: branding.theme_primary_foreground || "",
        theme_accent: branding.theme_accent || "",
        theme_background: branding.theme_background || "",
        theme_sidebar: branding.theme_sidebar || "",
        theme_website_accent: branding.theme_website_accent || "",
        theme_website_foreground: branding.theme_website_foreground || ""
      });
      setLogoLightPreview(branding.logo_url_light || branding.logo_url);
      setLogoDarkPreview(branding.logo_url_dark);
      setFaviconPreview(branding.favicon_url);
    }
    setIsEditOpen(true);
  };

  const handleLogoLightUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({
        title: t("admin.branding.invalidFileType"),
        variant: "destructive"
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: t("admin.branding.fileTooLarge"),
        variant: "destructive"
      });
      return;
    }

    setIsUploadingLogoLight(true);
    const formData = new FormData();
    formData.append('logo', file);

    try {
      const uploadHeaders: Record<string, string> = {};
      const authHeader = AuthStorage.getAuthHeader();
      if (authHeader) {
        uploadHeaders['Authorization'] = authHeader;
      }
      
      const response = await fetch('/api/admin/branding/upload-logo-light', {
        method: 'POST',
        headers: uploadHeaders,
        body: formData
      });

      if (!response.ok) throw new Error('Upload failed');

      const result = await response.json();
      setLogoLightPreview(result.logo_url_light || result.url);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/branding"] });
      queryClient.invalidateQueries({ queryKey: ["/api/branding"] });
      toast({ title: t("admin.branding.logoUploaded") });
    } catch (error: any) {
      toast({
        title: t("admin.branding.uploadFailed"),
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setIsUploadingLogoLight(false);
      if (logoLightInputRef.current) logoLightInputRef.current.value = '';
    }
  };

  const handleLogoDarkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({
        title: t("admin.branding.invalidFileType"),
        variant: "destructive"
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: t("admin.branding.fileTooLarge"),
        variant: "destructive"
      });
      return;
    }

    setIsUploadingLogoDark(true);
    const formData = new FormData();
    formData.append('logo', file);

    try {
      const uploadHeaders: Record<string, string> = {};
      const authHeader = AuthStorage.getAuthHeader();
      if (authHeader) {
        uploadHeaders['Authorization'] = authHeader;
      }
      
      const response = await fetch('/api/admin/branding/upload-logo-dark', {
        method: 'POST',
        headers: uploadHeaders,
        body: formData
      });

      if (!response.ok) throw new Error('Upload failed');

      const result = await response.json();
      setLogoDarkPreview(result.logo_url_dark || result.url);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/branding"] });
      queryClient.invalidateQueries({ queryKey: ["/api/branding"] });
      toast({ title: t("admin.branding.logoUploaded") });
    } catch (error: any) {
      toast({
        title: t("admin.branding.uploadFailed"),
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setIsUploadingLogoDark(false);
      if (logoDarkInputRef.current) logoDarkInputRef.current.value = '';
    }
  };

  const handleFaviconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({
        title: t("admin.branding.invalidFileType"),
        variant: "destructive"
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: t("admin.branding.fileTooLarge"),
        variant: "destructive"
      });
      return;
    }

    setIsUploadingFavicon(true);
    const formData = new FormData();
    formData.append('favicon', file);

    try {
      const uploadHeaders: Record<string, string> = {};
      const authHeader = AuthStorage.getAuthHeader();
      if (authHeader) {
        uploadHeaders['Authorization'] = authHeader;
      }
      
      const response = await fetch('/api/admin/branding/upload-favicon', {
        method: 'POST',
        headers: uploadHeaders,
        body: formData
      });

      if (!response.ok) throw new Error('Upload failed');

      const result = await response.json();
      setFaviconPreview(result.favicon_url || result.url);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/branding"] });
      queryClient.invalidateQueries({ queryKey: ["/api/branding"] });
      toast({ title: t("admin.branding.faviconUploaded") });
    } catch (error: any) {
      toast({
        title: t("admin.branding.uploadFailed"),
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setIsUploadingFavicon(false);
      if (faviconInputRef.current) faviconInputRef.current.value = '';
    }
  };

  const handleSave = () => {
    updateBrandingMutation.mutate(formData);
  };

  const isConfigured = branding?.app_name && (branding?.logo_url || branding?.logo_url_light || branding?.logo_url_dark || branding?.favicon_url);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-8">
          <Loader2 className="h-8 w-8 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <Settings className="h-5 w-5 text-muted-foreground" />
              <div>
                <CardTitle>{t("admin.branding.title")}</CardTitle>
                <CardDescription>{t("admin.branding.description")}</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={isConfigured ? "default" : "secondary"} className="gap-1">
                {isConfigured ? (
                  <>
                    <CheckCircle className="h-3 w-3" />
                    {t("admin.branding.configured")}
                  </>
                ) : (
                  t("admin.branding.notConfigured")
                )}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                data-testid="button-refresh-branding"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                {t("admin.branding.refresh")}
              </Button>
              <Button
                size="sm"
                onClick={handleOpenEdit}
                data-testid="button-edit-branding"
              >
                <Edit className="h-4 w-4 mr-2" />
                {t("admin.branding.editSettings")}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="gap-1 text-emerald-600 dark:text-emerald-400 border-emerald-600 dark:border-emerald-400">
                <CheckCircle className="h-3 w-3" />
                {t("admin.branding.liveData")}
              </Badge>
              {branding?.branding_updated_at && (
                <span className="text-sm text-muted-foreground">
                  {format(new Date(branding.branding_updated_at), "dd/MM/yyyy")}
                </span>
              )}
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Type className="h-4 w-4 text-muted-foreground" />
                  {t("admin.branding.applicationTitle")}
                </div>
                <div className="px-4 py-3 bg-muted/50 rounded-md">
                  <span className="text-foreground">{branding?.app_name || <span className="text-muted-foreground italic">Not configured</span>}</span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Tag className="h-4 w-4 text-muted-foreground" />
                  {t("admin.branding.tagline")}
                </div>
                <div className="px-4 py-3 bg-muted/50 rounded-md min-h-[44px]">
                  <span className="text-foreground">
                    {branding?.app_tagline || <span className="text-muted-foreground italic">Not configured</span>}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  Admin Email
                </div>
                <div className="px-4 py-3 bg-muted/50 rounded-md min-h-[44px]">
                  <span className="text-foreground">
                    {branding?.admin_email || <span className="text-muted-foreground italic">Not configured</span>}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  Location
                </div>
                <div className="px-4 py-3 bg-muted/50 rounded-md min-h-[44px]">
                  <span className="text-foreground">
                    {branding?.app_location || <span className="text-muted-foreground italic">Not configured</span>}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Sun className="h-4 w-4 text-amber-500" />
                  {t("admin.branding.logoLight")}
                </div>
                <div className="px-4 py-3 bg-white dark:bg-slate-100 rounded-md border flex items-center gap-3">
                  {branding?.logo_url_light || branding?.logo_url ? (
                    <>
                      <div className="h-10 w-16 bg-white rounded border flex items-center justify-center overflow-hidden">
                        <img 
                          src={branding.logo_url_light || branding.logo_url || ""} 
                          alt="Logo Light" 
                          className="max-h-full max-w-full object-contain"
                        />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-700">{t("admin.branding.logoUploaded")}</p>
                        <p className="text-xs text-slate-500">{t("admin.branding.forLightMode")}</p>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-16 bg-slate-100 rounded border flex items-center justify-center">
                        <Image className="h-5 w-5 text-slate-400" />
                      </div>
                      <span className="text-sm text-slate-500">{t("admin.branding.noLogo")}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Moon className="h-4 w-4 text-indigo-500" />
                  {t("admin.branding.logoDark")}
                </div>
                <div className="px-4 py-3 bg-slate-800 dark:bg-slate-900 rounded-md border border-slate-700 flex items-center gap-3">
                  {branding?.logo_url_dark ? (
                    <>
                      <div className="h-10 w-16 bg-slate-700 rounded border border-slate-600 flex items-center justify-center overflow-hidden">
                        <img 
                          src={branding.logo_url_dark} 
                          alt="Logo Dark" 
                          className="max-h-full max-w-full object-contain"
                        />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-200">{t("admin.branding.logoUploaded")}</p>
                        <p className="text-xs text-slate-400">{t("admin.branding.forDarkMode")}</p>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-16 bg-slate-700 rounded border border-slate-600 flex items-center justify-center">
                        <Image className="h-5 w-5 text-slate-400" />
                      </div>
                      <span className="text-sm text-slate-400">{t("admin.branding.noLogo")}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  {t("admin.branding.favicon")}
                </div>
                <div className="px-4 py-3 bg-muted/50 rounded-md flex items-center gap-3">
                  {branding?.favicon_url ? (
                    <>
                      <div className="h-10 w-10 bg-background rounded border flex items-center justify-center overflow-hidden">
                        <img 
                          src={branding.favicon_url} 
                          alt="Favicon" 
                          className="max-h-full max-w-full object-contain"
                        />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{t("admin.branding.faviconUploaded")}</p>
                        <p className="text-xs text-muted-foreground">{t("admin.branding.faviconReady")}</p>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 bg-background rounded border flex items-center justify-center">
                        <Globe className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <span className="text-sm text-muted-foreground">{t("admin.branding.noFavicon")}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {isConfigured && (
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle className="h-4 w-4 text-emerald-500" />
                <span className="text-emerald-600 dark:text-emerald-400">{t("admin.branding.configurationComplete")}</span>
                {branding?.branding_updated_at && (
                  <span className="text-muted-foreground ml-auto">
                    {t("admin.branding.lastUpdated")}: {format(new Date(branding.branding_updated_at), "dd/MM/yyyy")}
                  </span>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              {t("admin.branding.editTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("admin.branding.editDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Type className="h-4 w-4 text-primary" />
                <Label>{t("admin.branding.applicationName")} *</Label>
              </div>
              <Input
                value={formData.app_name}
                onChange={(e) => setFormData({ ...formData, app_name: e.target.value })}
                placeholder="AgentLabs"
                data-testid="input-app-name"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Tag className="h-4 w-4 text-primary" />
                <Label>{t("admin.branding.tagline")}</Label>
              </div>
              <Textarea
                value={formData.app_tagline}
                onChange={(e) => setFormData({ ...formData, app_tagline: e.target.value })}
                placeholder="AI Voice Calling Agents & Lead Intelligence SaaS Platform"
                rows={3}
                data-testid="input-tagline"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-primary" />
                  <Label>Admin Email (Contact Form)</Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Contact form submissions from the website will be sent to this email address.
                </p>
                <Input
                  type="email"
                  value={formData.admin_email}
                  onChange={(e) => setFormData({ ...formData, admin_email: e.target.value })}
                  placeholder="admin@example.com"
                  data-testid="input-admin-email"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-primary" />
                  <Label>Location</Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Your company location shown in the footer and contact page.
                </p>
                <Input
                  value={formData.app_location}
                  onChange={(e) => setFormData({ ...formData, app_location: e.target.value })}
                  placeholder="San Francisco, CA"
                  data-testid="input-app-location"
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Link className="h-4 w-4 text-primary" />
                <Label>Social Media Links</Label>
              </div>
              <p className="text-xs text-muted-foreground">
                Configure social media links that will appear in the website footer.
              </p>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Twitter className="h-4 w-4 text-muted-foreground" />
                    <Label className="text-sm">Twitter / X</Label>
                  </div>
                  <Input
                    type="url"
                    value={formData.social_twitter_url}
                    onChange={(e) => setFormData({ ...formData, social_twitter_url: e.target.value })}
                    placeholder="https://twitter.com/yourhandle"
                    data-testid="input-social-twitter"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Linkedin className="h-4 w-4 text-muted-foreground" />
                    <Label className="text-sm">LinkedIn</Label>
                  </div>
                  <Input
                    type="url"
                    value={formData.social_linkedin_url}
                    onChange={(e) => setFormData({ ...formData, social_linkedin_url: e.target.value })}
                    placeholder="https://linkedin.com/company/yourcompany"
                    data-testid="input-social-linkedin"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Github className="h-4 w-4 text-muted-foreground" />
                    <Label className="text-sm">GitHub</Label>
                  </div>
                  <Input
                    type="url"
                    value={formData.social_github_url}
                    onChange={(e) => setFormData({ ...formData, social_github_url: e.target.value })}
                    placeholder="https://github.com/yourorg"
                    data-testid="input-social-github"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Palette className="h-4 w-4 text-primary" />
                <Label>Website Brand Color</Label>
              </div>
              <p className="text-xs text-muted-foreground">
                Set the primary accent color used throughout the public website (hero buttons, badges, highlights, and CTA sections). Leave empty to use the platform default.
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                {([
                  { key: 'theme_website_accent', label: 'Website Accent Color', hint: 'Main brand color for website buttons and highlights' },
                  { key: 'theme_website_foreground', label: 'Website Accent Text', hint: 'Text color on brand-colored surfaces (usually white)' },
                ] as const).map(({ key, label, hint }) => {
                  const computedDefault = hslCssVarToHex(COLOR_FIELD_CSS_VARS[key]) ?? '#0fa58a';
                  const swatchValue = formData[key] || computedDefault;
                  return (
                    <div key={key} className="space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Label className="text-sm">{label}</Label>
                        {!formData[key] && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border font-mono" data-testid={`badge-default-${key}`}>
                            Theme default · {computedDefault}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{hint}</p>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={swatchValue}
                          onChange={(e) => setFormData({ ...formData, [key]: e.target.value })}
                          className="h-9 w-9 rounded-md border shrink-0 cursor-pointer p-0.5 bg-background"
                          data-testid={`input-${key}`}
                        />
                        <Input
                          value={formData[key]}
                          onChange={(e) => setFormData({ ...formData, [key]: e.target.value })}
                          placeholder={computedDefault}
                          className="font-mono text-sm"
                          data-testid={`input-${key}-hex`}
                        />
                        {formData[key] && (
                          <button
                            type="button"
                            onClick={() => setFormData({ ...formData, [key]: '' })}
                            className="text-xs text-muted-foreground hover:text-foreground underline shrink-0"
                            data-testid={`reset-${key}`}
                          >
                            Reset
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Palette className="h-4 w-4 text-primary" />
                <Label>Dashboard Colors</Label>
              </div>
              <p className="text-xs text-muted-foreground">
                Customize the admin dashboard and app UI colors. Leave a field empty to use the default theme color. Changes apply instantly after saving.
              </p>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {([
                  { key: 'theme_primary', label: 'Primary Color', hint: 'Used for buttons, links, and highlights' },
                  { key: 'theme_primary_foreground', label: 'Primary Text', hint: 'Text color on primary-colored surfaces' },
                  { key: 'theme_accent', label: 'Accent Color', hint: 'Used for accent highlights and hover states' },
                  { key: 'theme_background', label: 'Background', hint: 'Main page background color' },
                  { key: 'theme_sidebar', label: 'Sidebar', hint: 'Sidebar and navigation background' },
                ] as const).map(({ key, label, hint }) => {
                  const computedDefault = hslCssVarToHex(COLOR_FIELD_CSS_VARS[key]) ?? '#000000';
                  const swatchValue = formData[key] || computedDefault;
                  return (
                    <div key={key} className="space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Label className="text-sm">{label}</Label>
                        {!formData[key] && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border font-mono" data-testid={`badge-default-${key}`}>
                            Theme default · {computedDefault}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{hint}</p>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={swatchValue}
                          onChange={(e) => setFormData({ ...formData, [key]: e.target.value })}
                          className="h-9 w-9 rounded-md border shrink-0 cursor-pointer p-0.5 bg-background"
                          data-testid={`input-${key}`}
                        />
                        <Input
                          value={formData[key]}
                          onChange={(e) => setFormData({ ...formData, [key]: e.target.value })}
                          placeholder={computedDefault}
                          className="font-mono text-sm"
                          data-testid={`input-${key}-hex`}
                        />
                        {formData[key] && (
                          <button
                            type="button"
                            onClick={() => setFormData({ ...formData, [key]: '' })}
                            className="text-xs text-muted-foreground hover:text-foreground underline shrink-0"
                            data-testid={`reset-${key}`}
                          >
                            Reset
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Sun className="h-4 w-4 text-amber-500" />
                  <Label>{t("admin.branding.logoLight")}</Label>
                </div>
                <p className="text-xs text-muted-foreground">{t("admin.branding.logoLightDescription")}</p>
                <div className="space-y-3">
                  {logoLightPreview && (
                    <div className="flex items-center gap-3 p-3 bg-white dark:bg-slate-100 rounded-md border">
                      <div className="h-12 w-20 bg-white rounded border flex items-center justify-center overflow-hidden">
                        <img 
                          src={logoLightPreview} 
                          alt="Logo light preview" 
                          className="max-h-full max-w-full object-contain"
                        />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-700">{t("admin.branding.logoCurrent")}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteLogoLightMutation.mutate()}
                        disabled={deleteLogoLightMutation.isPending}
                        data-testid="button-delete-logo-light"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <input
                      ref={logoLightInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleLogoLightUpload}
                      className="hidden"
                      id="logo-light-upload"
                    />
                    <Button
                      variant="outline"
                      onClick={() => logoLightInputRef.current?.click()}
                      disabled={isUploadingLogoLight}
                      className="w-full"
                      data-testid="button-upload-logo-light"
                    >
                      {isUploadingLogoLight ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4 mr-2" />
                      )}
                      {t("admin.branding.chooseFile")}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Moon className="h-4 w-4 text-indigo-500" />
                  <Label>{t("admin.branding.logoDark")}</Label>
                </div>
                <p className="text-xs text-muted-foreground">{t("admin.branding.logoDarkDescription")}</p>
                <div className="space-y-3">
                  {logoDarkPreview && (
                    <div className="flex items-center gap-3 p-3 bg-slate-800 rounded-md border border-slate-700">
                      <div className="h-12 w-20 bg-slate-700 rounded border border-slate-600 flex items-center justify-center overflow-hidden">
                        <img 
                          src={logoDarkPreview} 
                          alt="Logo dark preview" 
                          className="max-h-full max-w-full object-contain"
                        />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-200">{t("admin.branding.logoCurrent")}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteLogoDarkMutation.mutate()}
                        disabled={deleteLogoDarkMutation.isPending}
                        className="text-slate-400 hover:text-slate-200"
                        data-testid="button-delete-logo-dark"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <input
                      ref={logoDarkInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleLogoDarkUpload}
                      className="hidden"
                      id="logo-dark-upload"
                    />
                    <Button
                      variant="outline"
                      onClick={() => logoDarkInputRef.current?.click()}
                      disabled={isUploadingLogoDark}
                      className="w-full"
                      data-testid="button-upload-logo-dark"
                    >
                      {isUploadingLogoDark ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4 mr-2" />
                      )}
                      {t("admin.branding.chooseFile")}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-primary" />
                <Label>{t("admin.branding.favicon")}</Label>
              </div>
              <div className="space-y-3">
                {faviconPreview && (
                  <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-md">
                    <div className="h-12 w-12 bg-background rounded border flex items-center justify-center overflow-hidden">
                      <img 
                        src={faviconPreview} 
                        alt="Favicon preview" 
                        className="max-h-full max-w-full object-contain"
                      />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{t("admin.branding.faviconCurrent")}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteFaviconMutation.mutate()}
                      disabled={deleteFaviconMutation.isPending}
                      data-testid="button-delete-favicon"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <input
                    ref={faviconInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFaviconUpload}
                    className="hidden"
                    id="favicon-upload"
                  />
                  <Button
                    variant="outline"
                    onClick={() => faviconInputRef.current?.click()}
                    disabled={isUploadingFavicon}
                    className="w-full"
                    data-testid="button-upload-favicon"
                  >
                    {isUploadingFavicon ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4 mr-2" />
                    )}
                    {t("admin.branding.chooseFile")}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsEditOpen(false)}
              data-testid="button-cancel-branding"
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleSave}
              disabled={updateBrandingMutation.isPending || !formData.app_name}
              data-testid="button-save-branding"
            >
              {updateBrandingMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              {t("admin.branding.updateSettings")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
