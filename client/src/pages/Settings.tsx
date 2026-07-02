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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, Loader2, Trash2, AlertTriangle, LogOut, Globe, Download, Clock, ShieldCheck, Upload, FileCheck, FilePlus, X, CheckCircle2, XCircle, AlertCircle, Key, ExternalLink, Users, MapPin, RefreshCw, Plus, Mail } from "lucide-react";
import { ApiKeysTab } from "@/components/api-keys/ApiKeysTab";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useMemo, useState, useEffect, Suspense } from "react";
import { usePluginRegistry } from "@/contexts/plugin-registry";
import { useTranslation } from "react-i18next";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { usePluginStatus } from "@/hooks/use-plugin-status";
import { AuthStorage } from "@/lib/auth-storage";
import { useBranding } from "@/components/BrandingProvider";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  credits: number;
  planType: string;
  company?: string | null;
  timezone?: string | null;
  kycStatus?: 'pending' | 'submitted' | 'approved' | 'rejected' | null;
  kycSubmittedAt?: string | null;
  kycApprovedAt?: string | null;
  kycRejectionReason?: string | null;
}

interface KycDocument {
  id: string;
  userId: string;
  documentType: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  fileSize: number;
  uploadedAt: string;
}

const KYC_DOCUMENT_TYPES = [
  { type: 'photo_id', label: 'Photo ID (Passport/Driver License)', description: 'A valid government-issued photo identification' },
  { type: 'company_registration', label: 'Company Registration', description: 'Business registration or incorporation certificate' },
  { type: 'gst_certificate', label: 'GST Certificate', description: 'GST or tax registration certificate' },
  { type: 'authorization_letter', label: 'Authorization Letter', description: 'Letter authorizing phone number usage on company letterhead' },
];

// Common timezones grouped by region
const TIMEZONE_OPTIONS = [
  { value: "UTC", label: "UTC (Coordinated Universal Time)", region: "Universal" },
  // Americas
  { value: "America/New_York", label: "Eastern Time (US & Canada)", region: "Americas" },
  { value: "America/Chicago", label: "Central Time (US & Canada)", region: "Americas" },
  { value: "America/Denver", label: "Mountain Time (US & Canada)", region: "Americas" },
  { value: "America/Los_Angeles", label: "Pacific Time (US & Canada)", region: "Americas" },
  { value: "America/Anchorage", label: "Alaska", region: "Americas" },
  { value: "America/Toronto", label: "Toronto", region: "Americas" },
  { value: "America/Vancouver", label: "Vancouver", region: "Americas" },
  { value: "America/Mexico_City", label: "Mexico City", region: "Americas" },
  { value: "America/Sao_Paulo", label: "São Paulo", region: "Americas" },
  { value: "America/Buenos_Aires", label: "Buenos Aires", region: "Americas" },
  { value: "America/Lima", label: "Lima", region: "Americas" },
  { value: "America/Bogota", label: "Bogota", region: "Americas" },
  // Europe
  { value: "Europe/London", label: "London", region: "Europe" },
  { value: "Europe/Paris", label: "Paris", region: "Europe" },
  { value: "Europe/Berlin", label: "Berlin", region: "Europe" },
  { value: "Europe/Madrid", label: "Madrid", region: "Europe" },
  { value: "Europe/Rome", label: "Rome", region: "Europe" },
  { value: "Europe/Amsterdam", label: "Amsterdam", region: "Europe" },
  { value: "Europe/Stockholm", label: "Stockholm", region: "Europe" },
  { value: "Europe/Warsaw", label: "Warsaw", region: "Europe" },
  { value: "Europe/Moscow", label: "Moscow", region: "Europe" },
  { value: "Europe/Istanbul", label: "Istanbul", region: "Europe" },
  // Asia
  { value: "Asia/Dubai", label: "Dubai", region: "Asia" },
  { value: "Asia/Kolkata", label: "India (Mumbai, Delhi, Kolkata)", region: "Asia" },
  { value: "Asia/Bangkok", label: "Bangkok", region: "Asia" },
  { value: "Asia/Singapore", label: "Singapore", region: "Asia" },
  { value: "Asia/Hong_Kong", label: "Hong Kong", region: "Asia" },
  { value: "Asia/Shanghai", label: "Shanghai", region: "Asia" },
  { value: "Asia/Tokyo", label: "Tokyo", region: "Asia" },
  { value: "Asia/Seoul", label: "Seoul", region: "Asia" },
  { value: "Asia/Jakarta", label: "Jakarta", region: "Asia" },
  { value: "Asia/Manila", label: "Manila", region: "Asia" },
  // Africa
  { value: "Africa/Cairo", label: "Cairo", region: "Africa" },
  { value: "Africa/Lagos", label: "Lagos", region: "Africa" },
  { value: "Africa/Johannesburg", label: "Johannesburg", region: "Africa" },
  { value: "Africa/Nairobi", label: "Nairobi", region: "Africa" },
  // Oceania
  { value: "Australia/Sydney", label: "Sydney", region: "Oceania" },
  { value: "Australia/Melbourne", label: "Melbourne", region: "Oceania" },
  { value: "Australia/Perth", label: "Perth", region: "Oceania" },
  { value: "Pacific/Auckland", label: "Auckland", region: "Oceania" },
  { value: "Pacific/Honolulu", label: "Hawaii", region: "Oceania" },
];

// Group timezones by region
const groupedTimezones = TIMEZONE_OPTIONS.reduce((acc, tz) => {
  if (!acc[tz.region]) acc[tz.region] = [];
  acc[tz.region].push(tz);
  return acc;
}, {} as Record<string, typeof TIMEZONE_OPTIONS>);

// Get current time in a timezone
function getCurrentTimeInTimezone(timezone: string): string {
  try {
    return new Date().toLocaleTimeString('en-US', { 
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  } catch {
    return '';
  }
}

export default function Settings() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { branding } = useBranding();
  const { isRestApiPluginEnabled, isTeamManagementPluginEnabled } = usePluginStatus();
  const pluginRegistry = usePluginRegistry();
  const settingsTabs = pluginRegistry.getSettingsTabs();
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");
  const [selectedTimezone, setSelectedTimezone] = useState<string>("");
  const [currentTime, setCurrentTime] = useState<string>("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Get tab from URL params
  const urlParams = new URLSearchParams(window.location.search);
  const initialTab = urlParams.get('tab') || 'profile';
  const [activeTab, setActiveTab] = useState(initialTab);

  const { data: user, isLoading } = useQuery<User>({
    queryKey: ["/api/auth/me"],
  });

  // Initialize form values when user data loads
  useEffect(() => {
    if (user?.name) {
      const parts = user.name.split(" ");
      setFirstName(parts[0] || "");
      setLastName(parts.slice(1).join(" ") || "");
    }
    if (user?.company) {
      setCompany(user.company);
    }
    if (user?.timezone) {
      setSelectedTimezone(user.timezone);
    }
  }, [user]);

  // Update current time display when timezone changes
  useEffect(() => {
    if (selectedTimezone) {
      setCurrentTime(getCurrentTimeInTimezone(selectedTimezone));
      const interval = setInterval(() => {
        setCurrentTime(getCurrentTimeInTimezone(selectedTimezone));
      }, 60000); // Update every minute
      return () => clearInterval(interval);
    }
  }, [selectedTimezone]);

  const updateProfileMutation = useMutation({
    mutationFn: async (data: { name?: string; company?: string | null; timezone?: string }) => {
      const res = await apiRequest("PATCH", "/api/auth/me", data);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to update profile");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: t('settings.profileUpdated'),
        description: t('settings.profileUpdatedDescription'),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
    onError: (error: any) => {
      toast({
        title: t('settings.updateFailed'),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: async (data: { currentPassword: string; newPassword: string }) => {
      const res = await apiRequest("POST", "/api/auth/change-password", data);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to change password");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: t('settings.passwordChanged'),
        description: t('settings.passwordChangedDescription'),
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (error: any) => {
      toast({
        title: t('settings.passwordChangeFailed'),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteAccountMutation = useMutation({
    mutationFn: async (password: string) => {
      const res = await apiRequest("POST", "/api/auth/delete-account", { password });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to delete account");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: t('settings.accountDeleted'),
        description: t('settings.accountDeletedDescription'),
      });
      AuthStorage.clearAuth();
      window.location.href = "/";
    },
    onError: (error: any) => {
      toast({
        title: t('settings.deleteAccountFailed'),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const exportDataMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/auth/export-data");
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to export data");
      }
      return res.blob();
    },
    onSuccess: (blob) => {
      // Create download link
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const appSlug = ((branding.app_name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')) || 'platform';
      a.download = `${appSlug}-data-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast({
        title: "Data Export Complete",
        description: "Your data has been downloaded successfully as JSON.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Export Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleDeleteAccount = () => {
    if (!deletePassword) {
      toast({
        title: t('settings.passwordRequired'),
        description: t('settings.enterPasswordToDelete'),
        variant: "destructive",
      });
      return;
    }
    deleteAccountMutation.mutate(deletePassword);
  };

  const handleLogout = () => {
    // Logout request clears the HttpOnly refresh token cookie on the server
    fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    }).catch(() => {});
    AuthStorage.clearAuth();
    window.location.href = "/";
  };

  const handleSaveProfile = () => {
    const fullName = `${firstName} ${lastName}`.trim();
    updateProfileMutation.mutate({
      name: fullName,
      company: company.trim() || null,
      timezone: selectedTimezone || undefined,
    });
  };

  const handleChangePassword = () => {
    if (!currentPassword) {
      toast({
        title: t('settings.currentPasswordRequired'),
        variant: "destructive",
      });
      return;
    }
    if (!newPassword) {
      toast({
        title: t('settings.newPasswordRequired'),
        variant: "destructive",
      });
      return;
    }
    if (newPassword.length < 8) {
      toast({
        title: t('settings.passwordTooShort'),
        variant: "destructive",
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({
        title: t('settings.passwordsDoNotMatch'),
        variant: "destructive",
      });
      return;
    }
    changePasswordMutation.mutate({ currentPassword, newPassword });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-semibold text-foreground">{t('settings.title')}</h1>
        <p className="text-muted-foreground mt-1">{t('settings.description')}</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList data-testid="tabs-settings">
          <TabsTrigger value="profile" data-testid="tab-profile">{t('settings.profile')}</TabsTrigger>
          <TabsTrigger value="kyc" data-testid="tab-kyc">
            <ShieldCheck className="h-4 w-4 mr-2" />
            KYC Documents
          </TabsTrigger>
          <TabsTrigger value="addresses" data-testid="tab-addresses">
            <MapPin className="h-4 w-4 mr-2" />
            Addresses
          </TabsTrigger>
          {isRestApiPluginEnabled && (
            <TabsTrigger value="developer" data-testid="tab-developer">
              <Key className="h-4 w-4 mr-2" />
              Developer
            </TabsTrigger>
          )}
          {settingsTabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} data-testid={`tab-${tab.id}`}>
              {tab.icon === 'Users' && <Users className="h-4 w-4 mr-2" />}
              {tab.icon === 'Mail' && <Mail className="h-4 w-4 mr-2" />}
              {tab.label}
            </TabsTrigger>
          ))}
          {/* Notifications tab hidden */}
          <TabsTrigger value="account" data-testid="tab-account">{t('settings.account')}</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-6">
          <Card className="p-6">
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-4">{t('settings.profileInformation')}</h3>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="first-name">{t('settings.firstName')}</Label>
                      <Input 
                        id="first-name" 
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        data-testid="input-first-name" 
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="last-name">{t('settings.lastName')}</Label>
                      <Input 
                        id="last-name" 
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        data-testid="input-last-name" 
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">{t('common.email')}</Label>
                    <Input id="email" type="email" defaultValue={user?.email} disabled data-testid="input-email" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="company">{t('settings.company')}</Label>
                    <Input 
                      id="company" 
                      value={company}
                      onChange={(e) => setCompany(e.target.value)}
                      placeholder={t('settings.companyPlaceholder')} 
                      data-testid="input-company" 
                    />
                  </div>
                </div>
              </div>

              <Separator />

              <div>
                <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                  <Globe className="h-5 w-5" />
                  Timezone Settings
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Set your timezone for accurate campaign scheduling. All call times will be calculated based on this timezone.
                </p>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="timezone">Your Timezone</Label>
                    <Select value={selectedTimezone} onValueChange={setSelectedTimezone}>
                      <SelectTrigger id="timezone" className="w-full" data-testid="select-timezone">
                        <SelectValue placeholder="Select your timezone..." />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(groupedTimezones).map(([region, timezones]) => (
                          <div key={region}>
                            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/50">
                              {region}
                            </div>
                            {timezones.map((tz) => (
                              <SelectItem key={tz.value} value={tz.value} data-testid={`timezone-${tz.value}`}>
                                {tz.label}
                              </SelectItem>
                            ))}
                          </div>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {selectedTimezone && currentTime && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/30 p-3 rounded-md">
                      <Clock className="h-4 w-4" />
                      <span>Current time in {selectedTimezone}: <strong className="text-foreground">{currentTime}</strong></span>
                    </div>
                  )}
                </div>
              </div>

              <Separator />

              <div className="flex justify-end">
                <Button 
                  onClick={handleSaveProfile}
                  disabled={updateProfileMutation.isPending}
                  data-testid="button-save-profile"
                >
                  {updateProfileMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  {t('settings.saveChanges')}
                </Button>
              </div>

              <Separator />

              <div>
                <h3 className="text-lg font-semibold mb-4">{t('settings.changePassword')}</h3>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="current-password">{t('settings.currentPassword')}</Label>
                    <Input 
                      id="current-password" 
                      type="password" 
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      data-testid="input-current-password" 
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-password">{t('settings.newPassword')}</Label>
                    <Input 
                      id="new-password" 
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      data-testid="input-new-password" 
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirm-password">{t('settings.confirmPassword')}</Label>
                    <Input 
                      id="confirm-password" 
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      data-testid="input-confirm-password" 
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button 
                      onClick={handleChangePassword}
                      disabled={changePasswordMutation.isPending || !currentPassword || !newPassword}
                      data-testid="button-change-password"
                    >
                      {changePasswordMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4 mr-2" />
                      )}
                      {t('settings.changePassword')}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="kyc" className="space-y-6">
          <KycDocumentsSection user={user} />
        </TabsContent>

        <TabsContent value="addresses" className="space-y-6">
          <AddressesSection />
        </TabsContent>

        <TabsContent value="developer" className="space-y-6">
          <Card className="p-6">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h3 className="text-lg font-semibold">API Documentation</h3>
                <p className="text-sm text-muted-foreground">
                  Interactive API documentation with all endpoints, schemas, and testing capability
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => window.open('/api/docs', '_blank')}
                data-testid="button-open-api-docs"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Open API Docs
              </Button>
            </div>
          </Card>
          <ApiKeysTab />
        </TabsContent>

        {settingsTabs.map((tab) => (
          <TabsContent key={tab.id} value={tab.id} className="space-y-6">
            <Suspense fallback={<div className="flex items-center justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
              <tab.component />
            </Suspense>
          </TabsContent>
        ))}

        {/* Notifications tab content hidden */}

        <TabsContent value="account" className="space-y-6">
          <Card className="p-6">
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-4">{t('settings.accountManagement')}</h3>
                <p className="text-muted-foreground text-sm mb-6">
                  {t('settings.accountManagementDescription')}
                </p>
              </div>

              <div className="space-y-4">
                {/* Data Export */}
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <Download className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Export Your Data</p>
                      <p className="text-sm text-muted-foreground">Download all your data including campaigns, contacts, and call history</p>
                    </div>
                  </div>
                  <Button 
                    variant="outline" 
                    onClick={() => exportDataMutation.mutate()}
                    disabled={exportDataMutation.isPending}
                    data-testid="button-export-data"
                  >
                    {exportDataMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 mr-2" />
                    )}
                    Export Data
                  </Button>
                </div>

                {/* Sign Out */}
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <LogOut className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">{t('settings.signOut')}</p>
                      <p className="text-sm text-muted-foreground">{t('settings.signOutDescription')}</p>
                    </div>
                  </div>
                  <Button variant="outline" onClick={handleLogout} data-testid="button-logout-settings">
                    <LogOut className="h-4 w-4 mr-2" />
                    {t('auth.logout')}
                  </Button>
                </div>

                {/* Delete Account */}
                <div className="flex items-center justify-between p-4 border border-destructive/50 rounded-lg bg-destructive/5">
                    <div className="flex items-center gap-3">
                      <Trash2 className="h-5 w-5 text-destructive" />
                      <div>
                        <p className="font-medium text-destructive">{t('settings.deleteAccount')}</p>
                        <p className="text-sm text-muted-foreground">{t('settings.deleteAccountWarning')}</p>
                      </div>
                    </div>
                    <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" data-testid="button-delete-account">
                          <Trash2 className="h-4 w-4 mr-2" />
                          {t('settings.deleteAccount')}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <div className="flex items-center gap-2 text-destructive">
                            <AlertTriangle className="h-5 w-5" />
                            <AlertDialogTitle>{t('settings.confirmDeleteAccount')}</AlertDialogTitle>
                          </div>
                          <AlertDialogDescription asChild>
                            <div className="space-y-3">
                              <span className="block">{t('settings.deleteAccountConfirmMessage')}</span>
                              <div className="p-3 bg-destructive/10 rounded-md border border-destructive/20">
                                <span className="block text-sm font-medium text-destructive">{t('settings.deleteAccountConsequences')}</span>
                                <ul className="text-sm text-muted-foreground mt-2 space-y-1 list-disc list-inside">
                                  <li>{t('settings.deleteConsequence1')}</li>
                                  <li>{t('settings.deleteConsequence2')}</li>
                                  <li>{t('settings.deleteConsequence3')}</li>
                                </ul>
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="delete-password">{t('settings.enterPasswordToConfirm')}</Label>
                                <Input
                                  id="delete-password"
                                  type="password"
                                  placeholder={t('settings.yourPassword')}
                                  value={deletePassword}
                                  onChange={(e) => setDeletePassword(e.target.value)}
                                  data-testid="input-delete-password"
                                />
                              </div>
                            </div>
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel onClick={() => setDeletePassword("")} data-testid="button-cancel-delete">
                            {t('common.cancel')}
                          </AlertDialogCancel>
                          <Button
                            variant="destructive"
                            onClick={handleDeleteAccount}
                            disabled={deleteAccountMutation.isPending || !deletePassword}
                            data-testid="button-confirm-delete"
                          >
                            {deleteAccountMutation.isPending ? (
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4 mr-2" />
                            )}
                            {t('settings.permanentlyDelete')}
                          </Button>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
              </div>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function KycDocumentsSection({ user }: { user: User | undefined }) {
  const { toast } = useToast();
  const [uploadingType, setUploadingType] = useState<string | null>(null);

  const { data: kycDocuments, isLoading: documentsLoading, refetch: refetchDocuments } = useQuery<KycDocument[]>({
    queryKey: ["/api/kyc/documents"],
    enabled: !!user,
  });

  const uploadDocumentMutation = useMutation({
    mutationFn: async ({ file, documentType }: { file: File, documentType: string }) => {
      const formData = new FormData();
      formData.append('document', file);
      formData.append('documentType', documentType);
      
      const token = AuthStorage.getToken();
      const response = await fetch('/api/kyc/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || 'Upload failed');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kyc/documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Document uploaded successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    },
    onSettled: () => {
      setUploadingType(null);
    }
  });

  const deleteDocumentMutation = useMutation({
    mutationFn: async (documentId: string) => {
      const response = await apiRequest("DELETE", `/api/kyc/documents/${documentId}`);
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || 'Delete failed');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kyc/documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Document deleted successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    }
  });

  const submitKycMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/kyc/submit");
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || 'Submit failed');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kyc/documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "KYC submitted for review", description: "An admin will review your documents soon." });
    },
    onError: (error: any) => {
      toast({ title: "Submit failed", description: error.message, variant: "destructive" });
    }
  });

  const handleFileUpload = (documentType: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.jpg,.jpeg,.png';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        if (file.size > 5 * 1024 * 1024) {
          toast({ title: "File too large", description: "Maximum file size is 5MB", variant: "destructive" });
          return;
        }
        setUploadingType(documentType);
        uploadDocumentMutation.mutate({ file, documentType });
      }
    };
    input.click();
  };

  const getDocumentForType = (type: string) => {
    return kycDocuments?.find(doc => doc.documentType === type);
  };

  const allDocumentsUploaded = KYC_DOCUMENT_TYPES.every(doc => getDocumentForType(doc.type));
  const kycStatus = user?.kycStatus || 'pending';

  const getStatusBadge = () => {
    switch (kycStatus) {
      case 'approved':
        return <Badge className="bg-green-100 text-green-800 border-green-200"><CheckCircle2 className="h-3 w-3 mr-1" />Approved</Badge>;
      case 'rejected':
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Rejected</Badge>;
      case 'submitted':
        return <Badge variant="secondary"><AlertCircle className="h-3 w-3 mr-1" />Under Review</Badge>;
      default:
        return <Badge variant="outline"><AlertCircle className="h-3 w-3 mr-1" />Pending</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5" />
                KYC Verification
              </CardTitle>
              <CardDescription>
                Upload your identity documents to purchase phone numbers
              </CardDescription>
            </div>
            {getStatusBadge()}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {kycStatus === 'rejected' && user?.kycRejectionReason && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
              <p className="text-sm font-medium text-destructive">Rejection Reason:</p>
              <p className="text-sm text-destructive/80">{user.kycRejectionReason}</p>
            </div>
          )}

          {kycStatus === 'approved' && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-sm text-green-800">
                Your KYC verification is complete. You can now purchase phone numbers.
              </p>
            </div>
          )}

          <div className="space-y-4">
            {KYC_DOCUMENT_TYPES.map((docType) => {
              const existingDoc = getDocumentForType(docType.type);
              const isUploading = uploadingType === docType.type;

              return (
                <div key={docType.type} className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center gap-3">
                    {existingDoc ? (
                      <FileCheck className="h-5 w-5 text-green-600" />
                    ) : (
                      <FilePlus className="h-5 w-5 text-muted-foreground" />
                    )}
                    <div>
                      <p className="font-medium">{docType.label}</p>
                      <p className="text-sm text-muted-foreground">{docType.description}</p>
                      {existingDoc && (
                        <p className="text-xs text-green-600 mt-1">
                          Uploaded: {existingDoc.fileName}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {existingDoc && kycStatus !== 'approved' && kycStatus !== 'submitted' && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => deleteDocumentMutation.mutate(existingDoc.id)}
                        disabled={deleteDocumentMutation.isPending}
                        data-testid={`button-delete-${docType.type}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                    {!existingDoc && kycStatus !== 'approved' && (
                      <Button
                        variant="outline"
                        onClick={() => handleFileUpload(docType.type)}
                        disabled={isUploading}
                        data-testid={`button-upload-${docType.type}`}
                      >
                        {isUploading ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Upload className="h-4 w-4 mr-2" />
                        )}
                        Upload
                      </Button>
                    )}
                    {existingDoc && (
                      <Badge variant="secondary" className="text-green-600">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Uploaded
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {kycStatus !== 'approved' && kycStatus !== 'submitted' && (
            <div className="flex justify-end">
              <Button
                onClick={() => submitKycMutation.mutate()}
                disabled={!allDocumentsUploaded || submitKycMutation.isPending}
                data-testid="button-submit-kyc"
              >
                {submitKycMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4 mr-2" />
                )}
                Submit for Review
              </Button>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Accepted formats: JPEG, PNG, PDF (max 5MB per file). All 4 documents are required for verification.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

interface UserAddress {
  id: string;
  userId: string;
  customerName: string;
  street: string;
  city: string;
  region: string;
  postalCode: string;
  isoCountry: string;
  twilioAddressSid?: string;
  status: string;
  verificationStatus?: string;
  validationStatus?: string;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
}

interface AddressCountry {
  code: string;
  name: string;
  requirement: string;
}

function AddressesSection() {
  const { toast } = useToast();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState<string>("");
  const [customerName, setCustomerName] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [refreshingAddressId, setRefreshingAddressId] = useState<string | null>(null);

  const { data: addresses, isLoading } = useQuery<UserAddress[]>({
    queryKey: ["/api/user/addresses"],
  });

  const { data: countries } = useQuery<AddressCountry[]>({
    queryKey: ["/api/user/addresses/countries"],
  });

  const createAddressMutation = useMutation({
    mutationFn: async (data: {
      customerName: string;
      street: string;
      city: string;
      region: string;
      postalCode: string;
      isoCountry: string;
    }) => {
      const response = await apiRequest("POST", "/api/user/addresses", data);
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to create address");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/addresses"] });
      toast({ title: "Address submitted", description: "Your address has been submitted to Twilio for verification." });
      setShowAddDialog(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({ title: "Failed to create address", description: error.message, variant: "destructive" });
    },
  });

  const refreshAddressMutation = useMutation({
    mutationFn: async (addressId: string) => {
      setRefreshingAddressId(addressId);
      const response = await apiRequest("GET", `/api/user/addresses/${addressId}/refresh`);
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to refresh status");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/addresses"] });
      toast({ title: "Status refreshed" });
      setRefreshingAddressId(null);
    },
    onError: (error: any) => {
      toast({ title: "Failed to refresh status", description: error.message, variant: "destructive" });
      setRefreshingAddressId(null);
    },
  });

  const deleteAddressMutation = useMutation({
    mutationFn: async (addressId: string) => {
      const response = await apiRequest("DELETE", `/api/user/addresses/${addressId}`);
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to delete address");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/addresses"] });
      toast({ title: "Address deleted" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete address", description: error.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setSelectedCountry("");
    setCustomerName("");
    setStreet("");
    setCity("");
    setRegion("");
    setPostalCode("");
  };

  const handleSubmit = () => {
    if (!selectedCountry || !customerName || !street || !city || !region || !postalCode) {
      toast({ title: "All fields are required", variant: "destructive" });
      return;
    }
    createAddressMutation.mutate({
      customerName,
      street,
      city,
      region,
      postalCode,
      isoCountry: selectedCountry,
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'verified':
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100"><CheckCircle2 className="h-3 w-3 mr-1" />Verified</Badge>;
      case 'submitted':
      case 'pending':
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Pending Verification</Badge>;
      case 'rejected':
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Failed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getCountryName = (code: string) => {
    const country = countries?.find(c => c.code === code);
    return country?.name || code;
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
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Addresses for Phone Numbers
              </CardTitle>
              <CardDescription>
                Add addresses for countries that require address verification to purchase phone numbers (e.g., Australia, Germany, UK).
              </CardDescription>
            </div>
            <AlertDialog open={showAddDialog} onOpenChange={setShowAddDialog}>
              <AlertDialogTrigger asChild>
                <Button data-testid="button-add-address">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Address
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="max-w-md">
                <AlertDialogHeader>
                  <AlertDialogTitle>Add New Address</AlertDialogTitle>
                  <AlertDialogDescription>
                    Enter your address details. This will be submitted to Twilio for verification.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Country</Label>
                    <Select value={selectedCountry} onValueChange={setSelectedCountry}>
                      <SelectTrigger data-testid="select-address-country">
                        <SelectValue placeholder="Select country" />
                      </SelectTrigger>
                      <SelectContent>
                        {countries?.map((country) => (
                          <SelectItem key={country.code} value={country.code}>
                            {country.name} ({country.requirement === 'local' ? 'Local address required' : 'Any address'})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Full Name / Company Name</Label>
                    <Input
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="John Doe or Company Ltd"
                      data-testid="input-address-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Street Address</Label>
                    <Input
                      value={street}
                      onChange={(e) => setStreet(e.target.value)}
                      placeholder="123 Main Street"
                      data-testid="input-address-street"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>City</Label>
                      <Input
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        placeholder="Sydney"
                        data-testid="input-address-city"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>State/Province</Label>
                      <Input
                        value={region}
                        onChange={(e) => setRegion(e.target.value)}
                        placeholder="NSW"
                        data-testid="input-address-region"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Postal Code</Label>
                    <Input
                      value={postalCode}
                      onChange={(e) => setPostalCode(e.target.value)}
                      placeholder="2000"
                      data-testid="input-address-postal"
                    />
                  </div>
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel onClick={resetForm}>Cancel</AlertDialogCancel>
                  <Button
                    onClick={handleSubmit}
                    disabled={createAddressMutation.isPending}
                    data-testid="button-submit-address"
                  >
                    {createAddressMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Submit Address
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardHeader>
        <CardContent>
          {addresses?.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <MapPin className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No addresses added yet.</p>
              <p className="text-sm">Add an address to purchase phone numbers in countries requiring verification.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {addresses?.map((address) => (
                <div key={address.id} className="flex items-start justify-between p-4 border rounded-lg">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{address.customerName}</span>
                      {getStatusBadge(address.status)}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {address.street}, {address.city}, {address.region} {address.postalCode}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {getCountryName(address.isoCountry)}
                    </p>
                    {address.rejectionReason && (
                      <p className="text-sm text-destructive">
                        Reason: {address.rejectionReason}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => refreshAddressMutation.mutate(address.id)}
                      disabled={refreshingAddressId === address.id}
                      title="Refresh status"
                      data-testid={`button-refresh-address-${address.id}`}
                    >
                      <RefreshCw className={`h-4 w-4 ${refreshingAddressId === address.id ? 'animate-spin' : ''}`} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteAddressMutation.mutate(address.id)}
                      disabled={deleteAddressMutation.isPending}
                      title="Delete address"
                      data-testid={`button-delete-address-${address.id}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
