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
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle, XCircle, AlertTriangle, Rocket, Shield, Database, Server } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface SystemCheck {
  name: string;
  status: "success" | "warning" | "error";
  message: string;
}

interface CheckResponse {
  checks: SystemCheck[];
  canInstall: boolean;
}

interface InstallResponse {
  success: boolean;
  message: string;
  admin?: {
    email: string;
    password: string;
    id: string;
  };
}

export default function InstallWizard() {
  const { t } = useTranslation();
  const [step, setStep] = useState<"checking" | "form" | "installing" | "success">("checking");
  const [formData, setFormData] = useState({
    adminEmail: "",
    adminPassword: "",
    confirmPassword: "",
    companyName: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [adminCredentials, setAdminCredentials] = useState<{ email: string; password: string } | null>(null);

  const { data: checkData, isLoading: isChecking, error: checkError } = useQuery<CheckResponse>({
    queryKey: ["/api/installer/check"],
    retry: false,
  });

  useEffect(() => {
    if (checkData && !isChecking) {
      setStep("form");
    }
  }, [checkData, isChecking]);

  const installMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/installer/install", formData);
      return await response.json() as InstallResponse;
    },
    onSuccess: (data) => {
      if (data.admin) {
        setAdminCredentials({
          email: data.admin.email,
          password: data.admin.password,
        });
      }
      setStep("success");
      queryClient.invalidateQueries({ queryKey: ["/api/installer/status"] });
    },
    onError: (error: any) => {
      setErrors({ submit: error.message || t("install.validation.installFailed") });
    },
  });

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.adminEmail) {
      newErrors.adminEmail = t("install.validation.emailRequired");
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.adminEmail)) {
      newErrors.adminEmail = t("install.validation.emailInvalid");
    }

    if (!formData.adminPassword) {
      newErrors.adminPassword = t("install.validation.passwordRequired");
    } else if (formData.adminPassword.length < 8) {
      newErrors.adminPassword = t("install.validation.passwordMinLength");
    }

    if (formData.adminPassword !== formData.confirmPassword) {
      newErrors.confirmPassword = t("install.validation.passwordsNoMatch");
    }

    if (!formData.companyName) {
      newErrors.companyName = t("install.validation.companyRequired");
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInstall = () => {
    if (validateForm()) {
      setStep("installing");
      installMutation.mutate();
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "success":
        return <CheckCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />;
      case "warning":
        return <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />;
      case "error":
        return <XCircle className="h-5 w-5 text-rose-600 dark:text-rose-400" />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-slate-900 to-slate-800 dark:from-slate-100 dark:to-slate-200 mb-4">
            <Rocket className="h-8 w-8 text-slate-100 dark:text-slate-900" />
          </div>
          <h1 className="text-3xl font-bold mb-2">{t("install.title")}</h1>
          <p className="text-muted-foreground">
            {t("install.subtitle")}
          </p>
        </div>

        {step === "checking" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-5 w-5" />
                {t("install.checking.title")}
              </CardTitle>
              <CardDescription>
                {t("install.checking.description")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isChecking && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              )}

              {checkError && (
                <Alert variant="destructive">
                  <XCircle className="h-4 w-4" />
                  <AlertDescription>
                    {t("install.checking.failed")}
                  </AlertDescription>
                </Alert>
              )}

              {checkData && (
                <div className="space-y-4">
                  {checkData.checks.map((check, index) => (
                    <div
                      key={index}
                      className="flex items-start gap-3 p-3 rounded-lg border bg-card"
                      data-testid={`check-${check.name.toLowerCase().replace(/\s+/g, '-')}`}
                    >
                      <div className="mt-0.5">{getStatusIcon(check.status)}</div>
                      <div className="flex-1">
                        <div className="font-medium">{check.name}</div>
                        <div className="text-sm text-muted-foreground">
                          {check.message}
                        </div>
                      </div>
                    </div>
                  ))}

                  {!checkData.canInstall && (
                    <Alert variant="destructive">
                      <XCircle className="h-4 w-4" />
                      <AlertDescription>
                        {t("install.checking.fixErrors")}
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {step === "form" && checkData?.canInstall && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                {t("install.form.title")}
              </CardTitle>
              <CardDescription>
                {t("install.form.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="p-4 rounded-lg border bg-muted/50">
                <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                  <CheckCircle className="h-4 w-4" />
                  <span className="font-medium">{t("install.form.checksPassed")}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("install.form.serverMeetsRequirements")}
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="companyName">{t("install.form.companyName")}</Label>
                  <Input
                    id="companyName"
                    type="text"
                    placeholder={t("install.form.companyNamePlaceholder")}
                    value={formData.companyName}
                    onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                    data-testid="input-company-name"
                  />
                  {errors.companyName && (
                    <p className="text-sm text-rose-600 dark:text-rose-400">{errors.companyName}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="adminEmail">{t("install.form.adminEmail")}</Label>
                  <Input
                    id="adminEmail"
                    type="email"
                    placeholder={t("install.form.adminEmailPlaceholder")}
                    value={formData.adminEmail}
                    onChange={(e) => setFormData({ ...formData, adminEmail: e.target.value })}
                    data-testid="input-admin-email"
                  />
                  {errors.adminEmail && (
                    <p className="text-sm text-rose-600 dark:text-rose-400">{errors.adminEmail}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="adminPassword">{t("install.form.adminPassword")}</Label>
                  <Input
                    id="adminPassword"
                    type="password"
                    placeholder={t("install.form.adminPasswordPlaceholder")}
                    value={formData.adminPassword}
                    onChange={(e) => setFormData({ ...formData, adminPassword: e.target.value })}
                    data-testid="input-admin-password"
                  />
                  {errors.adminPassword && (
                    <p className="text-sm text-rose-600 dark:text-rose-400">{errors.adminPassword}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">{t("install.form.confirmPassword")}</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder={t("install.form.confirmPasswordPlaceholder")}
                    value={formData.confirmPassword}
                    onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                    data-testid="input-confirm-password"
                  />
                  {errors.confirmPassword && (
                    <p className="text-sm text-rose-600 dark:text-rose-400">{errors.confirmPassword}</p>
                  )}
                </div>

              </div>

              {errors.submit && (
                <Alert variant="destructive">
                  <XCircle className="h-4 w-4" />
                  <AlertDescription>{errors.submit}</AlertDescription>
                </Alert>
              )}

              <Button
                onClick={handleInstall}
                className="w-full"
                size="lg"
                disabled={installMutation.isPending}
                data-testid="button-install"
              >
                {installMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t("install.form.installButton")}
              </Button>
            </CardContent>
          </Card>
        )}

        {step === "installing" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                {t("install.installing.title")}
              </CardTitle>
              <CardDescription>
                {t("install.installing.description")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center justify-center py-8 space-y-4">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
                <div className="text-center space-y-2">
                  <p className="font-medium">{t("install.installing.settingUp")}</p>
                  <p className="text-sm text-muted-foreground">
                    {t("install.installing.creatingDatabase")}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {step === "success" && adminCredentials && (
          <Card className="border-emerald-600/20 dark:border-emerald-400/20">
            <CardHeader>
              <div className="flex items-center justify-center mb-4">
                <div className="w-12 h-12 rounded-full bg-emerald-600/10 dark:bg-emerald-400/10 flex items-center justify-center">
                  <CheckCircle className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                </div>
              </div>
              <CardTitle className="text-center">{t("install.success.title")}</CardTitle>
              <CardDescription className="text-center">
                {t("install.success.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <Alert>
                <Shield className="h-4 w-4" />
                <AlertDescription>
                  <span className="font-medium">{t("install.success.important")}</span> {t("install.success.saveCredentials")}
                </AlertDescription>
              </Alert>

              <div className="space-y-3 p-4 rounded-lg border bg-muted/50">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">{t("install.success.adminEmail")}</p>
                  <p className="font-mono font-medium" data-testid="text-admin-email">{adminCredentials.email}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">{t("install.success.adminPassword")}</p>
                  <p className="font-mono font-medium" data-testid="text-admin-password">{adminCredentials.password}</p>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="font-medium">{t("install.success.nextSteps")}</h4>
                <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                  <li>{t("install.success.step1")}</li>
                  <li>{t("install.success.step2")}</li>
                  <li>{t("install.success.step3")}</li>
                  <li>{t("install.success.step4")}</li>
                  <li>{t("install.success.step5")}</li>
                </ol>
              </div>

              <Button
                onClick={() => window.location.href = "/login"}
                className="w-full"
                size="lg"
                data-testid="button-go-to-login"
              >
                {t("install.success.goToLogin")}
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="text-center mt-8 text-sm text-muted-foreground">
          <p>{t("install.footer.needHelp")} <a href="/INSTALLATION.md" className="underline hover:text-foreground">{t("install.footer.installationGuide")}</a></p>
        </div>
      </div>
    </div>
  );
}
