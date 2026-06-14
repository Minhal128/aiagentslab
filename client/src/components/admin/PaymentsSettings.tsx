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
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect, useRef } from "react";
import { CreditCard, Save, Loader2, CheckCircle, XCircle, AlertCircle, TestTube, Eye, EyeOff, DollarSign, ToggleLeft, ToggleRight, Lock, LockOpen, AlertTriangle, Webhook, Copy } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface ConnectionStatus {
  connected: boolean;
  mode?: string;
  currency?: string;
  availableBalance?: string;
  source?: string;
  error?: string;
  success?: boolean;
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

const CURRENCIES = [
  { code: "USD", symbol: "$", name: "US Dollar" },
  { code: "EUR", symbol: "€", name: "Euro" },
  { code: "GBP", symbol: "£", name: "British Pound" },
  { code: "CAD", symbol: "$", name: "Canadian Dollar" },
  { code: "AUD", symbol: "$", name: "Australian Dollar" },
  { code: "JPY", symbol: "¥", name: "Japanese Yen" },
  { code: "INR", symbol: "₹", name: "Indian Rupee" },
  { code: "BRL", symbol: "R$", name: "Brazilian Real" },
  { code: "MXN", symbol: "$", name: "Mexican Peso" },
  { code: "CHF", symbol: "CHF", name: "Swiss Franc" },
];

const PAYPAL_CURRENCIES = [
  { code: "USD", symbol: "$", name: "US Dollar" },
  { code: "EUR", symbol: "€", name: "Euro" },
  { code: "GBP", symbol: "£", name: "British Pound" },
  { code: "AUD", symbol: "A$", name: "Australian Dollar" },
  { code: "CAD", symbol: "C$", name: "Canadian Dollar" },
];

const PAYSTACK_CURRENCIES = [
  { code: "NGN", symbol: "₦", name: "Nigerian Naira" },
  { code: "GHS", symbol: "GH₵", name: "Ghanaian Cedi" },
  { code: "ZAR", symbol: "R", name: "South African Rand" },
  { code: "KES", symbol: "KSh", name: "Kenyan Shilling" },
  { code: "USD", symbol: "$", name: "US Dollar" },
];

const MERCADOPAGO_CURRENCIES = [
  { code: "BRL", symbol: "R$", name: "Brazilian Real" },
  { code: "ARS", symbol: "$", name: "Argentine Peso" },
  { code: "MXN", symbol: "MX$", name: "Mexican Peso" },
  { code: "CLP", symbol: "$", name: "Chilean Peso" },
  { code: "COP", symbol: "$", name: "Colombian Peso" },
];

export default function PaymentsSettings() {
  const { t } = useTranslation();
  const { toast } = useToast();
  
  const [stripeFormData, setStripeFormData] = useState({
    stripe_secret_key: "",
    stripe_publishable_key: "",
    stripe_webhook_secret: "",
    stripe_currency: "USD",
    stripe_mode: "test"
  });
  
  const [stripeCurrencyLocked, setStripeCurrencyLocked] = useState(false);
  const [showLockConfirmDialog, setShowLockConfirmDialog] = useState(false);
  const [showCurrencyChangeDialog, setShowCurrencyChangeDialog] = useState(false);
  const [pendingCurrencyChange, setPendingCurrencyChange] = useState<string | null>(null);
  
  const [razorpayFormData, setRazorpayFormData] = useState({
    razorpay_key_id: "",
    razorpay_key_secret: "",
    razorpay_webhook_secret: "",
    razorpay_mode: "test",
  });
  
  const [stripeEnabled, setStripeEnabled] = useState(true);
  const [razorpayEnabled, setRazorpayEnabled] = useState(false);
  const [hasStripeChanges, setHasStripeChanges] = useState(false);
  const [hasRazorpayChanges, setHasRazorpayChanges] = useState(false);
  
  // Track if we just toggled to prevent useEffect from overriding local state
  const justToggledRef = useRef(false);
  const [showStripeSecretKey, setShowStripeSecretKey] = useState(false);
  const [showStripeWebhookSecret, setShowStripeWebhookSecret] = useState(false);
  const [showRazorpayKeySecret, setShowRazorpayKeySecret] = useState(false);
  const [showRazorpayWebhookSecret, setShowRazorpayWebhookSecret] = useState(false);
  const [stripeConnectionStatus, setStripeConnectionStatus] = useState<ConnectionStatus | null>(null);
  const [razorpayConnectionStatus, setRazorpayConnectionStatus] = useState<ConnectionStatus | null>(null);

  // PayPal state
  const [paypalFormData, setPaypalFormData] = useState({
    paypal_client_id: "",
    paypal_client_secret: "",
    paypal_webhook_id: "",
    paypal_mode: "sandbox",
    paypal_currency: "USD",
  });
  const [paypalEnabled, setPaypalEnabled] = useState(false);
  const [hasPaypalChanges, setHasPaypalChanges] = useState(false);
  const [showPaypalClientSecret, setShowPaypalClientSecret] = useState(false);
  const [paypalConnectionStatus, setPaypalConnectionStatus] = useState<ConnectionStatus | null>(null);

  // Paystack state
  const [paystackFormData, setPaystackFormData] = useState({
    paystack_public_key: "",
    paystack_secret_key: "",
    paystack_webhook_secret: "",
    paystack_currency: "NGN",
  });
  const [paystackEnabled, setPaystackEnabled] = useState(false);
  const [hasPaystackChanges, setHasPaystackChanges] = useState(false);
  const [showPaystackSecretKey, setShowPaystackSecretKey] = useState(false);
  const [showPaystackWebhookSecret, setShowPaystackWebhookSecret] = useState(false);
  const [paystackConnectionStatus, setPaystackConnectionStatus] = useState<ConnectionStatus | null>(null);

  // MercadoPago state
  const [mercadopagoFormData, setMercadopagoFormData] = useState({
    mercadopago_public_key: "",
    mercadopago_access_token: "",
    mercadopago_webhook_secret: "",
    mercadopago_currency: "BRL",
  });
  const [mercadopagoEnabled, setMercadopagoEnabled] = useState(false);
  const [hasMercadopagoChanges, setHasMercadopagoChanges] = useState(false);
  const [showMercadopagoAccessToken, setShowMercadopagoAccessToken] = useState(false);
  const [showMercadopagoWebhookSecret, setShowMercadopagoWebhookSecret] = useState(false);
  const [mercadopagoConnectionStatus, setMercadopagoConnectionStatus] = useState<ConnectionStatus | null>(null);

  const { data: settings, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/settings"],
  });

  useEffect(() => {
    if (settings) {
      setStripeFormData({
        stripe_secret_key: "",
        stripe_publishable_key: settings.stripe_publishable_key || "",
        stripe_webhook_secret: "",
        stripe_currency: settings.stripe_currency || "USD",
        stripe_mode: settings.stripe_mode || "test"
      });
      setRazorpayFormData({
        razorpay_key_id: settings.razorpay_key_id || "",
        razorpay_key_secret: "",
        razorpay_webhook_secret: "",
        razorpay_mode: settings.razorpay_mode || "test",
      });
      
      // Load stripe currency locked state
      const toBool = (val: any): boolean => val === true || val === 'true';
      setStripeCurrencyLocked(toBool(settings.stripe_currency_locked));
      
      // Skip gateway toggle state update if we just toggled (prevents race condition)
      if (justToggledRef.current) {
        justToggledRef.current = false;
        return;
      }
      
      // Load gateway enabled states with proper string/boolean normalization
      // Settings values are stored as strings in database ("true"/"false")
      // Stripe enabled if configured and not explicitly disabled (default: enabled when configured)
      const stripeEnabledValue = settings.stripe_enabled;
      setStripeEnabled(settings.stripe_configured && (stripeEnabledValue === undefined || stripeEnabledValue === null || toBool(stripeEnabledValue)));
      // Razorpay enabled if configured and explicitly enabled (default: disabled)
      setRazorpayEnabled(settings.razorpay_configured && toBool(settings.razorpay_enabled));
      
      // PayPal settings
      setPaypalFormData({
        paypal_client_id: settings.paypal_client_id || "",
        paypal_client_secret: "",
        paypal_webhook_id: settings.paypal_webhook_id || "",
        paypal_mode: settings.paypal_mode || "sandbox",
        paypal_currency: settings.paypal_currency || "USD",
      });
      setPaypalEnabled(settings.paypal_configured && toBool(settings.paypal_enabled));
      
      // Paystack settings
      setPaystackFormData({
        paystack_public_key: settings.paystack_public_key || "",
        paystack_secret_key: "",
        paystack_webhook_secret: "",
        paystack_currency: settings.paystack_currency || "NGN",
      });
      setPaystackEnabled(settings.paystack_configured && toBool(settings.paystack_enabled));
      
      // MercadoPago settings
      setMercadopagoFormData({
        mercadopago_public_key: settings.mercadopago_public_key || "",
        mercadopago_access_token: "",
        mercadopago_webhook_secret: "",
        mercadopago_currency: settings.mercadopago_currency || "BRL",
      });
      setMercadopagoEnabled(settings.mercadopago_configured && toBool(settings.mercadopago_enabled));
    }
  }, [settings]);

  const updateSettingMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: any }) => {
      const response = await apiRequest("PATCH", `/api/admin/settings/${key}`, { value });
      const data = await response.json();
      return { key, data };
    },
    onSuccess: ({ key, data }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings"] });
      // Show warning toast if currency was changed
      if (data?.warning) {
        toast({
          title: "Currency Changed",
          description: data.warning,
          variant: "default",
          duration: 8000,
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: t("admin.payments.updateFailed") || "Update Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const saveStripeSettings = async () => {
    try {
      const updates = [];
      
      if (stripeFormData.stripe_secret_key && stripeFormData.stripe_secret_key.trim().length > 0) {
        updates.push(updateSettingMutation.mutateAsync({ key: "stripe_secret_key", value: stripeFormData.stripe_secret_key }));
      }
      if (stripeFormData.stripe_publishable_key) {
        updates.push(updateSettingMutation.mutateAsync({ key: "stripe_publishable_key", value: stripeFormData.stripe_publishable_key }));
      }
      if (stripeFormData.stripe_webhook_secret && stripeFormData.stripe_webhook_secret.trim().length > 0) {
        updates.push(updateSettingMutation.mutateAsync({ key: "stripe_webhook_secret", value: stripeFormData.stripe_webhook_secret }));
      }
      // Only update currency if not locked
      if (!stripeCurrencyLocked) {
        updates.push(updateSettingMutation.mutateAsync({ key: "stripe_currency", value: stripeFormData.stripe_currency }));
      }
      updates.push(updateSettingMutation.mutateAsync({ key: "stripe_mode", value: stripeFormData.stripe_mode }));

      await Promise.all(updates);
      toast({ title: t("admin.payments.updateSuccess") || "Settings saved successfully" });
      setHasStripeChanges(false);
      setStripeFormData(prev => ({ ...prev, stripe_secret_key: "", stripe_webhook_secret: "" }));
    } catch (error: any) {
      toast({
        title: t("admin.payments.updateFailed") || "Update Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const saveRazorpaySettings = async () => {
    try {
      if (razorpayFormData.razorpay_key_id || razorpayFormData.razorpay_key_secret) {
        const validateResponse = await apiRequest("POST", "/api/admin/validate-credentials/razorpay", {
          key_id: razorpayFormData.razorpay_key_id || undefined,
          key_secret: razorpayFormData.razorpay_key_secret || undefined,
        });
        const validateResult = await validateResponse.json();
        if (!validateResult.valid) {
          toast({
            title: "Invalid Razorpay credentials",
            description: validateResult.error || "Could not verify Razorpay credentials. Please check your Key ID and Secret.",
            variant: "destructive"
          });
          return;
        }
      }

      const updates = [];
      
      if (razorpayFormData.razorpay_key_id) {
        updates.push(updateSettingMutation.mutateAsync({ key: "razorpay_key_id", value: razorpayFormData.razorpay_key_id }));
      }
      if (razorpayFormData.razorpay_key_secret && razorpayFormData.razorpay_key_secret.trim().length > 0) {
        updates.push(updateSettingMutation.mutateAsync({ key: "razorpay_key_secret", value: razorpayFormData.razorpay_key_secret }));
      }
      if (razorpayFormData.razorpay_webhook_secret && razorpayFormData.razorpay_webhook_secret.trim().length > 0) {
        updates.push(updateSettingMutation.mutateAsync({ key: "razorpay_webhook_secret", value: razorpayFormData.razorpay_webhook_secret }));
      }
      updates.push(updateSettingMutation.mutateAsync({ key: "razorpay_mode", value: razorpayFormData.razorpay_mode }));

      await Promise.all(updates);
      toast({ title: t("admin.payments.updateSuccess") || "Settings saved successfully" });
      setHasRazorpayChanges(false);
      setRazorpayFormData(prev => ({ ...prev, razorpay_key_secret: "", razorpay_webhook_secret: "" }));
    } catch (error: any) {
      toast({
        title: t("admin.payments.updateFailed") || "Update Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const savePaypalSettings = async () => {
    try {
      const updates = [];
      
      if (paypalFormData.paypal_client_id) {
        updates.push(updateSettingMutation.mutateAsync({ key: "paypal_client_id", value: paypalFormData.paypal_client_id }));
      }
      if (paypalFormData.paypal_client_secret && paypalFormData.paypal_client_secret.trim().length > 0) {
        updates.push(updateSettingMutation.mutateAsync({ key: "paypal_client_secret", value: paypalFormData.paypal_client_secret }));
      }
      if (paypalFormData.paypal_webhook_id) {
        updates.push(updateSettingMutation.mutateAsync({ key: "paypal_webhook_id", value: paypalFormData.paypal_webhook_id }));
      }
      updates.push(updateSettingMutation.mutateAsync({ key: "paypal_mode", value: paypalFormData.paypal_mode }));
      updates.push(updateSettingMutation.mutateAsync({ key: "paypal_currency", value: paypalFormData.paypal_currency }));

      await Promise.all(updates);
      toast({ title: t("admin.payments.updateSuccess") || "Settings saved successfully" });
      setHasPaypalChanges(false);
      setPaypalFormData(prev => ({ ...prev, paypal_client_secret: "" }));
    } catch (error: any) {
      toast({
        title: t("admin.payments.updateFailed") || "Update Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const savePaystackSettings = async () => {
    try {
      const updates = [];
      
      if (paystackFormData.paystack_public_key) {
        updates.push(updateSettingMutation.mutateAsync({ key: "paystack_public_key", value: paystackFormData.paystack_public_key }));
      }
      if (paystackFormData.paystack_secret_key && paystackFormData.paystack_secret_key.trim().length > 0) {
        updates.push(updateSettingMutation.mutateAsync({ key: "paystack_secret_key", value: paystackFormData.paystack_secret_key }));
      }
      if (paystackFormData.paystack_webhook_secret && paystackFormData.paystack_webhook_secret.trim().length > 0) {
        updates.push(updateSettingMutation.mutateAsync({ key: "paystack_webhook_secret", value: paystackFormData.paystack_webhook_secret }));
      }
      updates.push(updateSettingMutation.mutateAsync({ key: "paystack_currency", value: paystackFormData.paystack_currency }));

      await Promise.all(updates);
      toast({ title: t("admin.payments.updateSuccess") || "Settings saved successfully" });
      setHasPaystackChanges(false);
      setPaystackFormData(prev => ({ ...prev, paystack_secret_key: "", paystack_webhook_secret: "" }));
    } catch (error: any) {
      toast({
        title: t("admin.payments.updateFailed") || "Update Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const saveMercadopagoSettings = async () => {
    try {
      const updates = [];
      
      if (mercadopagoFormData.mercadopago_public_key) {
        updates.push(updateSettingMutation.mutateAsync({ key: "mercadopago_public_key", value: mercadopagoFormData.mercadopago_public_key }));
      }
      if (mercadopagoFormData.mercadopago_access_token && mercadopagoFormData.mercadopago_access_token.trim().length > 0) {
        updates.push(updateSettingMutation.mutateAsync({ key: "mercadopago_access_token", value: mercadopagoFormData.mercadopago_access_token }));
      }
      if (mercadopagoFormData.mercadopago_webhook_secret && mercadopagoFormData.mercadopago_webhook_secret.trim().length > 0) {
        updates.push(updateSettingMutation.mutateAsync({ key: "mercadopago_webhook_secret", value: mercadopagoFormData.mercadopago_webhook_secret }));
      }
      updates.push(updateSettingMutation.mutateAsync({ key: "mercadopago_currency", value: mercadopagoFormData.mercadopago_currency }));

      await Promise.all(updates);
      toast({ title: t("admin.payments.updateSuccess") || "Settings saved successfully" });
      setHasMercadopagoChanges(false);
      setMercadopagoFormData(prev => ({ ...prev, mercadopago_access_token: "", mercadopago_webhook_secret: "" }));
    } catch (error: any) {
      toast({
        title: t("admin.payments.updateFailed") || "Update Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const toggleStripeEnabled = async (enabled: boolean) => {
    try {
      // Set flag to prevent useEffect from overriding our change
      justToggledRef.current = true;
      setStripeEnabled(enabled);
      await updateSettingMutation.mutateAsync({ key: "stripe_enabled", value: enabled });
      toast({ 
        title: enabled ? "Stripe Enabled" : "Stripe Disabled",
        description: enabled 
          ? "Users can now pay with USD via Stripe"
          : "Stripe payments are now disabled"
      });
    } catch (error: any) {
      // Revert on error
      setStripeEnabled(!enabled);
      justToggledRef.current = false;
      toast({
        title: "Failed to update Stripe status",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const toggleRazorpayEnabled = async (enabled: boolean) => {
    try {
      if (enabled) {
        const testResponse = await apiRequest("POST", "/api/admin/test-connection/razorpay");
        const testResult = await testResponse.json();
        if (!testResult.connected) {
          toast({
            title: "Cannot enable Razorpay",
            description: testResult.error || "Razorpay credentials could not be verified. Please test the connection first.",
            variant: "destructive"
          });
          return;
        }
      }
      justToggledRef.current = true;
      setRazorpayEnabled(enabled);
      await updateSettingMutation.mutateAsync({ key: "razorpay_enabled", value: enabled });
      toast({ 
        title: enabled ? "Razorpay Enabled" : "Razorpay Disabled",
        description: enabled 
          ? "Users can now pay with INR via Razorpay"
          : "Razorpay payments are now disabled"
      });
    } catch (error: any) {
      setRazorpayEnabled(!enabled);
      justToggledRef.current = false;
      toast({
        title: "Failed to update Razorpay status",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const togglePaypalEnabled = async (enabled: boolean) => {
    try {
      justToggledRef.current = true;
      setPaypalEnabled(enabled);
      await updateSettingMutation.mutateAsync({ key: "paypal_enabled", value: enabled });
      toast({ 
        title: enabled ? "PayPal Enabled" : "PayPal Disabled",
        description: enabled 
          ? `Users can now pay with ${paypalFormData.paypal_currency} via PayPal`
          : "PayPal payments are now disabled"
      });
    } catch (error: any) {
      setPaypalEnabled(!enabled);
      justToggledRef.current = false;
      toast({
        title: "Failed to update PayPal status",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const togglePaystackEnabled = async (enabled: boolean) => {
    try {
      justToggledRef.current = true;
      setPaystackEnabled(enabled);
      await updateSettingMutation.mutateAsync({ key: "paystack_enabled", value: enabled });
      toast({ 
        title: enabled ? "Paystack Enabled" : "Paystack Disabled",
        description: enabled 
          ? `Users can now pay with ${paystackFormData.paystack_currency} via Paystack`
          : "Paystack payments are now disabled"
      });
    } catch (error: any) {
      setPaystackEnabled(!enabled);
      justToggledRef.current = false;
      toast({
        title: "Failed to update Paystack status",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const toggleMercadopagoEnabled = async (enabled: boolean) => {
    try {
      justToggledRef.current = true;
      setMercadopagoEnabled(enabled);
      await updateSettingMutation.mutateAsync({ key: "mercadopago_enabled", value: enabled });
      toast({ 
        title: enabled ? "MercadoPago Enabled" : "MercadoPago Disabled",
        description: enabled 
          ? `Users can now pay with ${mercadopagoFormData.mercadopago_currency} via MercadoPago`
          : "MercadoPago payments are now disabled"
      });
    } catch (error: any) {
      setMercadopagoEnabled(!enabled);
      justToggledRef.current = false;
      toast({
        title: "Failed to update MercadoPago status",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const lockCurrencyMutation = useMutation({
    mutationFn: async () => {
      // First save the current currency if there are changes
      await updateSettingMutation.mutateAsync({ 
        key: "stripe_currency", 
        value: stripeFormData.stripe_currency 
      });
      // Then lock it
      await updateSettingMutation.mutateAsync({ 
        key: "stripe_currency_locked", 
        value: true 
      });
    },
    onSuccess: () => {
      setStripeCurrencyLocked(true);
      setShowLockConfirmDialog(false);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings"] });
      toast({
        title: "Currency Locked",
        description: `Stripe currency has been permanently set to ${stripeFormData.stripe_currency}. This cannot be changed.`
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Lock Currency",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const testStripeConnectionMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/admin/test-connection/stripe");
      return response.json();
    },
    onSuccess: (data: ConnectionStatus) => {
      const sanitizedError = sanitizeErrorMessage(data.error, 'Stripe credentials not configured');
      setStripeConnectionStatus({ ...data, error: sanitizedError });
    },
    onError: (error: any) => {
      const sanitizedError = sanitizeErrorMessage(error.message, 'Connection test failed');
      setStripeConnectionStatus({
        connected: false,
        error: sanitizedError || t("admin.payments.testFailed") || "Connection test failed"
      });
    }
  });

  const testRazorpayConnectionMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/admin/test-connection/razorpay");
      return response.json();
    },
    onSuccess: (data: ConnectionStatus) => {
      const sanitizedError = sanitizeErrorMessage(data.error, 'Razorpay credentials not configured');
      setRazorpayConnectionStatus({
        connected: data.connected || false,
        error: sanitizedError
      });
    },
    onError: (error: any) => {
      const sanitizedError = sanitizeErrorMessage(error.message, 'Connection test failed');
      setRazorpayConnectionStatus({
        connected: false,
        error: sanitizedError || "Connection test failed"
      });
    }
  });

  const testRazorpayWebhookMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/admin/test-webhook/razorpay");
      return response.json();
    },
    onSuccess: (data: any) => {
      if (data.success) {
        toast({
          title: "Webhook Secret Verified",
          description: data.message || "Your Razorpay webhook secret is configured correctly.",
        });
      } else {
        toast({
          title: "Webhook Test Failed",
          description: data.error || "Could not verify webhook secret.",
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Webhook Test Failed",
        description: error.message || "Failed to test webhook secret.",
        variant: "destructive",
      });
    }
  });

  const testPaypalConnectionMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/admin/test-connection/paypal");
      return response.json();
    },
    onSuccess: (data: ConnectionStatus) => {
      const sanitizedError = sanitizeErrorMessage(data.error, 'PayPal credentials not configured');
      setPaypalConnectionStatus({
        connected: data.connected || false,
        mode: data.mode,
        error: sanitizedError
      });
    },
    onError: (error: any) => {
      const sanitizedError = sanitizeErrorMessage(error.message, 'Connection test failed');
      setPaypalConnectionStatus({
        connected: false,
        error: sanitizedError || "Connection test failed"
      });
    }
  });

  const testPaystackConnectionMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/admin/test-connection/paystack");
      return response.json();
    },
    onSuccess: (data: ConnectionStatus) => {
      const sanitizedError = sanitizeErrorMessage(data.error, 'Paystack credentials not configured');
      setPaystackConnectionStatus({
        connected: data.connected || false,
        error: sanitizedError
      });
    },
    onError: (error: any) => {
      const sanitizedError = sanitizeErrorMessage(error.message, 'Connection test failed');
      setPaystackConnectionStatus({
        connected: false,
        error: sanitizedError || "Connection test failed"
      });
    }
  });

  const testMercadopagoConnectionMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/admin/test-connection/mercadopago");
      return response.json();
    },
    onSuccess: (data: ConnectionStatus) => {
      const sanitizedError = sanitizeErrorMessage(data.error, 'MercadoPago credentials not configured');
      setMercadopagoConnectionStatus({
        connected: data.connected || false,
        error: sanitizedError
      });
    },
    onError: (error: any) => {
      const sanitizedError = sanitizeErrorMessage(error.message, 'Connection test failed');
      setMercadopagoConnectionStatus({
        connected: false,
        error: sanitizedError || "Connection test failed"
      });
    }
  });

  // Webhook setup mutations
  const setupPaypalWebhookMutation = useMutation({
    mutationFn: async () => {
      const webhookUrl = `${window.location.origin}/api/paypal/webhook`;
      const response = await apiRequest("POST", "/api/admin/setup-webhook/paypal", { webhookUrl });
      return response.json();
    },
    onSuccess: (data: any) => {
      if (data.success) {
        toast({
          title: "Webhook Configured",
          description: `PayPal webhook created successfully. ID: ${data.webhookId}`,
        });
        setPaypalFormData(prev => ({ ...prev, paypal_webhook_id: data.webhookId }));
        queryClient.invalidateQueries({ queryKey: ["/api/admin/settings"] });
      } else {
        toast({
          title: "Webhook Setup Failed",
          description: data.error || "Failed to create webhook",
          variant: "destructive"
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Webhook Setup Failed",
        description: error.message || "Failed to create webhook",
        variant: "destructive"
      });
    }
  });

  const setupMercadopagoWebhookMutation = useMutation({
    mutationFn: async () => {
      const webhookUrl = `${window.location.origin}/api/mercadopago/webhook`;
      const response = await apiRequest("POST", "/api/admin/setup-webhook/mercadopago", { webhookUrl });
      return response.json();
    },
    onSuccess: (data: any) => {
      if (data.success) {
        toast({
          title: "Webhook Configured",
          description: `MercadoPago webhook created successfully. ID: ${data.webhookId}`,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/settings"] });
      } else {
        toast({
          title: "Webhook Setup Failed",
          description: data.error || "Failed to create webhook",
          variant: "destructive"
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Webhook Setup Failed",
        description: error.message || "Failed to create webhook",
        variant: "destructive"
      });
    }
  });

  const handleStripeChange = (key: keyof typeof stripeFormData, value: string) => {
    // Show warning dialog when currency is being changed
    if (key === 'stripe_currency' && value !== stripeFormData.stripe_currency) {
      setPendingCurrencyChange(value);
      setShowCurrencyChangeDialog(true);
      return;
    }
    
    setStripeFormData({ ...stripeFormData, [key]: value });
    setHasStripeChanges(true);
    setStripeConnectionStatus(null);
  };
  
  const confirmCurrencyChange = () => {
    if (pendingCurrencyChange) {
      setStripeFormData({ ...stripeFormData, stripe_currency: pendingCurrencyChange });
      setHasStripeChanges(true);
      setStripeConnectionStatus(null);
      setPendingCurrencyChange(null);
      setShowCurrencyChangeDialog(false);
      
      toast({
        title: "Currency Changed",
        description: "Remember to update your plans and credit packages to sync pricing with Stripe.",
      });
    }
  };
  
  const cancelCurrencyChange = () => {
    setPendingCurrencyChange(null);
    setShowCurrencyChangeDialog(false);
  };

  const handleRazorpayChange = (key: keyof typeof razorpayFormData, value: string) => {
    setRazorpayFormData({ ...razorpayFormData, [key]: value });
    setHasRazorpayChanges(true);
    setRazorpayConnectionStatus(null);
  };

  const handlePaypalChange = (key: keyof typeof paypalFormData, value: string) => {
    setPaypalFormData({ ...paypalFormData, [key]: value });
    setHasPaypalChanges(true);
    setPaypalConnectionStatus(null);
  };

  const handlePaystackChange = (key: keyof typeof paystackFormData, value: string) => {
    setPaystackFormData({ ...paystackFormData, [key]: value });
    setHasPaystackChanges(true);
    setPaystackConnectionStatus(null);
  };

  const handleMercadopagoChange = (key: keyof typeof mercadopagoFormData, value: string) => {
    setMercadopagoFormData({ ...mercadopagoFormData, [key]: value });
    setHasMercadopagoChanges(true);
    setMercadopagoConnectionStatus(null);
  };

  const isStripeConfigured = settings?.stripe_configured;
  const isRazorpayConfigured = settings?.razorpay_configured;
  const isPaypalConfigured = settings?.paypal_configured;
  const isPaystackConfigured = settings?.paystack_configured;
  const isMercadopagoConfigured = settings?.mercadopago_configured;

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
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <ToggleLeft className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle>Payment Gateway Availability</CardTitle>
              <CardDescription>Enable multiple gateways to let users choose their preferred payment method</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Stripe Toggle */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 md:p-4 rounded-lg border gap-3">
            <div className="flex items-start sm:items-center gap-3">
              <svg className="h-6 w-6 shrink-0 mt-0.5 sm:mt-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z"/>
              </svg>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                  <span className="font-medium">Stripe</span>
                  <Badge variant="outline" className="text-xs">
                    {stripeCurrencyLocked && <Lock className="h-3 w-3 mr-1" />}
                    {stripeFormData.stripe_currency}
                  </Badge>
                  {isStripeConfigured ? (
                    <Badge className="text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Configured
                    </Badge>
                  ) : (
                    <Badge className="text-xs bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20">
                      <XCircle className="h-3 w-3 mr-1" />
                      Not Configured
                    </Badge>
                  )}
                </div>
                <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">Accept payments in {stripeFormData.stripe_currency} via Stripe</p>
              </div>
            </div>
            <div className="w-full sm:w-auto flex justify-end shrink-0">
              <Switch
                checked={stripeEnabled}
                onCheckedChange={toggleStripeEnabled}
                disabled={!isStripeConfigured || updateSettingMutation.isPending}
                data-testid="switch-stripe-enabled"
              />
            </div>
          </div>

          {/* Razorpay Toggle */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 md:p-4 rounded-lg border gap-3">
            <div className="flex items-start sm:items-center gap-3">
              <svg className="h-6 w-6 shrink-0 mt-0.5 sm:mt-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M22.436 0l-11.91 7.773-1.174 4.276 6.625-4.297L11.65 24h4.391l6.395-24zM14.26 10.098L3.389 17.166 1.564 24h9.508l3.188-13.902z"/>
              </svg>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                  <span className="font-medium">Razorpay</span>
                  <Badge variant="outline" className="text-xs">INR</Badge>
                  {isRazorpayConfigured ? (
                    <Badge className="text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Configured
                    </Badge>
                  ) : (
                    <Badge className="text-xs bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20">
                      <XCircle className="h-3 w-3 mr-1" />
                      Not Configured
                    </Badge>
                  )}
                </div>
                <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">Accept payments in INR via Razorpay</p>
              </div>
            </div>
            <div className="w-full sm:w-auto flex justify-end shrink-0">
              <Switch
                checked={razorpayEnabled}
                onCheckedChange={toggleRazorpayEnabled}
                disabled={!isRazorpayConfigured || updateSettingMutation.isPending}
                data-testid="switch-razorpay-enabled"
              />
            </div>
          </div>

          {/* PayPal Toggle */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 md:p-4 rounded-lg border gap-3">
            <div className="flex items-start sm:items-center gap-3">
              <svg className="h-6 w-6 shrink-0 mt-0.5 sm:mt-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M7.076 21.337H2.47a.641.641 0 0 1-.633-.74L4.944.901C5.026.382 5.474 0 5.998 0h7.46c2.57 0 4.578.543 5.69 1.81 1.01 1.15 1.304 2.42 1.012 4.287-.023.143-.047.288-.077.437-.983 5.05-4.349 6.797-8.647 6.797h-2.19c-.524 0-.968.382-1.05.9l-1.12 7.106zm14.146-14.42a3.35 3.35 0 0 0-.607-.541c-.013.076-.026.175-.041.254-.59 3.025-2.566 6.082-8.558 6.082h-2.19c-1.049 0-1.968.757-2.099 1.798l-1.12 7.106a.64.64 0 0 0 .633.739h3.553c.525 0 .969-.382 1.05-.901l.776-4.909c.082-.519.526-.901 1.05-.901h.658c4.299 0 7.665-1.747 8.648-6.797.324-1.664.18-3.022-.753-3.93z"/>
              </svg>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                  <span className="font-medium">PayPal</span>
                  <Badge variant="outline" className="text-xs">{paypalFormData.paypal_currency}</Badge>
                  {isPaypalConfigured ? (
                    <Badge className="text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Configured
                    </Badge>
                  ) : (
                    <Badge className="text-xs bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20">
                      <XCircle className="h-3 w-3 mr-1" />
                      Not Configured
                    </Badge>
                  )}
                </div>
                <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">Accept payments in {paypalFormData.paypal_currency} via PayPal</p>
              </div>
            </div>
            <div className="w-full sm:w-auto flex justify-end shrink-0">
              <Switch
                checked={paypalEnabled}
                onCheckedChange={togglePaypalEnabled}
                disabled={!isPaypalConfigured || updateSettingMutation.isPending}
                data-testid="switch-paypal-enabled"
              />
            </div>
          </div>

          {/* Paystack Toggle */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 md:p-4 rounded-lg border gap-3">
            <div className="flex items-start sm:items-center gap-3">
              <svg className="h-6 w-6 shrink-0 mt-0.5 sm:mt-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2.604 10.89h18.792a.396.396 0 0 0 .396-.396V7.286a.396.396 0 0 0-.396-.396H2.604a.396.396 0 0 0-.396.396v3.208c0 .218.178.396.396.396zm0 6.22h18.792a.396.396 0 0 0 .396-.396v-3.208a.396.396 0 0 0-.396-.396H2.604a.396.396 0 0 0-.396.396v3.208c0 .218.178.396.396.396zm0-12.22h18.792a.396.396 0 0 0 .396-.396V1.286a.396.396 0 0 0-.396-.396H2.604a.396.396 0 0 0-.396.396v3.208c0 .218.178.396.396.396zm0 18h11.188a.396.396 0 0 0 .396-.396v-3.208a.396.396 0 0 0-.396-.396H2.604a.396.396 0 0 0-.396.396v3.208c0 .218.178.396.396.396z"/>
              </svg>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                  <span className="font-medium">Paystack</span>
                  <Badge variant="outline" className="text-xs">{paystackFormData.paystack_currency}</Badge>
                  {isPaystackConfigured ? (
                    <Badge className="text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Configured
                    </Badge>
                  ) : (
                    <Badge className="text-xs bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20">
                      <XCircle className="h-3 w-3 mr-1" />
                      Not Configured
                    </Badge>
                  )}
                </div>
                <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">Accept payments in {paystackFormData.paystack_currency} via Paystack (Africa)</p>
              </div>
            </div>
            <div className="w-full sm:w-auto flex justify-end shrink-0">
              <Switch
                checked={paystackEnabled}
                onCheckedChange={togglePaystackEnabled}
                disabled={!isPaystackConfigured || updateSettingMutation.isPending}
                data-testid="switch-paystack-enabled"
              />
            </div>
          </div>

          {/* MercadoPago Toggle */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 md:p-4 rounded-lg border gap-3">
            <div className="flex items-start sm:items-center gap-3">
              <svg className="h-6 w-6 shrink-0 mt-0.5 sm:mt-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 4.8c3.974 0 7.2 3.226 7.2 7.2s-3.226 7.2-7.2 7.2-7.2-3.226-7.2-7.2S8.026 4.8 12 4.8zm0 1.8a5.4 5.4 0 1 0 0 10.8 5.4 5.4 0 0 0 0-10.8zm0 2.4a3 3 0 1 1 0 6 3 3 0 0 1 0-6z"/>
              </svg>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                  <span className="font-medium">MercadoPago</span>
                  <Badge variant="outline" className="text-xs">{mercadopagoFormData.mercadopago_currency}</Badge>
                  {isMercadopagoConfigured ? (
                    <Badge className="text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Configured
                    </Badge>
                  ) : (
                    <Badge className="text-xs bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20">
                      <XCircle className="h-3 w-3 mr-1" />
                      Not Configured
                    </Badge>
                  )}
                </div>
                <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">Accept payments in {mercadopagoFormData.mercadopago_currency} via MercadoPago (Latin America)</p>
              </div>
            </div>
            <div className="w-full sm:w-auto flex justify-end shrink-0">
              <Switch
                checked={mercadopagoEnabled}
                onCheckedChange={toggleMercadopagoEnabled}
                disabled={!isMercadopagoConfigured || updateSettingMutation.isPending}
                data-testid="switch-mercadopago-enabled"
              />
            </div>
          </div>

          {/* Status Summary */}
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {(() => {
                const enabledGateways = [
                  stripeEnabled && `Stripe (${stripeFormData.stripe_currency})`,
                  razorpayEnabled && "Razorpay (INR)",
                  paypalEnabled && `PayPal (${paypalFormData.paypal_currency})`,
                  paystackEnabled && `Paystack (${paystackFormData.paystack_currency})`,
                  mercadopagoEnabled && `MercadoPago (${mercadopagoFormData.mercadopago_currency})`
                ].filter(Boolean);
                
                if (enabledGateways.length === 0) {
                  return "No payment gateway is enabled. Users will not be able to make payments.";
                } else if (enabledGateways.length === 1) {
                  return `Only ${enabledGateways[0]} is enabled.`;
                } else {
                  return `${enabledGateways.length} gateways enabled: ${enabledGateways.join(", ")}. Users can choose their preferred payment method.`;
                }
              })()}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Payment Redirect URLs Info Card */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center gap-3">
            <Webhook className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle className="text-base">Payment Redirect URLs</CardTitle>
              <CardDescription>These URLs are automatically handled by the system after payment processing</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 p-3 bg-muted/50 rounded-lg border">
              <Label className="text-xs font-medium text-muted-foreground">Success Redirect URL</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm font-mono text-foreground truncate bg-background px-2 py-1 rounded border">
                  {window.location.origin}/app/billing?success=true
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/app/billing?success=true`);
                    toast({ title: "Copied", description: "Success URL copied to clipboard" });
                  }}
                  data-testid="button-copy-success-url"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Customers are redirected here after successful payment</p>
            </div>
            <div className="space-y-2 p-3 bg-muted/50 rounded-lg border">
              <Label className="text-xs font-medium text-muted-foreground">Cancel/Failure Redirect URL</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm font-mono text-foreground truncate bg-background px-2 py-1 rounded border">
                  {window.location.origin}/app/billing?cancelled=true
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/app/billing?cancelled=true`);
                    toast({ title: "Copied", description: "Cancel URL copied to clipboard" });
                  }}
                  data-testid="button-copy-cancel-url"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Customers are redirected here when payment is cancelled</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Note: These redirect URLs are automatically configured for all payment gateways. The system verifies payment status with the gateway before updating user subscriptions.
          </p>
        </CardContent>
      </Card>

      <Tabs defaultValue="stripe" className="space-y-4">
        <div className="overflow-x-auto -mx-1 px-1">
          <TabsList className="inline-flex w-auto min-w-full md:grid md:w-full md:grid-cols-5">
            <TabsTrigger value="stripe" className="flex items-center gap-1 md:gap-2 whitespace-nowrap px-3" data-testid="tab-stripe">
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z"/>
              </svg>
              <span className="hidden sm:inline">Stripe</span>
              {isStripeConfigured && <Badge variant="outline" className="ml-1 text-xs hidden lg:inline-flex">Configured</Badge>}
            </TabsTrigger>
            <TabsTrigger value="razorpay" className="flex items-center gap-1 md:gap-2 whitespace-nowrap px-3" data-testid="tab-razorpay">
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M22.436 0l-11.91 7.773-1.174 4.276 6.625-4.297L11.65 24h4.391l6.395-24zM14.26 10.098L3.389 17.166 1.564 24h9.508l3.188-13.902z"/>
              </svg>
              <span className="hidden sm:inline">Razorpay</span>
              {isRazorpayConfigured && <Badge variant="outline" className="ml-1 text-xs hidden lg:inline-flex">Configured</Badge>}
            </TabsTrigger>
            <TabsTrigger value="paypal" className="flex items-center gap-1 md:gap-2 whitespace-nowrap px-3" data-testid="tab-paypal">
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M7.076 21.337H2.47a.641.641 0 0 1-.633-.74L4.944.901C5.026.382 5.474 0 5.998 0h7.46c2.57 0 4.578.543 5.69 1.81 1.01 1.15 1.304 2.42 1.012 4.287-.023.143-.047.288-.077.437-.983 5.05-4.349 6.797-8.647 6.797h-2.19c-.524 0-.968.382-1.05.9l-1.12 7.106zm14.146-14.42a3.35 3.35 0 0 0-.607-.541c-.013.076-.026.175-.041.254-.59 3.025-2.566 6.082-8.558 6.082h-2.19c-1.049 0-1.968.757-2.099 1.798l-1.12 7.106a.64.64 0 0 0 .633.739h3.553c.525 0 .969-.382 1.05-.901l.776-4.909c.082-.519.526-.901 1.05-.901h.658c4.299 0 7.665-1.747 8.648-6.797.324-1.664.18-3.022-.753-3.93z"/>
              </svg>
              <span className="hidden sm:inline">PayPal</span>
              {isPaypalConfigured && <Badge variant="outline" className="ml-1 text-xs hidden lg:inline-flex">Configured</Badge>}
            </TabsTrigger>
            <TabsTrigger value="paystack" className="flex items-center gap-1 md:gap-2 whitespace-nowrap px-3" data-testid="tab-paystack">
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2.604 10.89h18.792a.396.396 0 0 0 .396-.396V7.286a.396.396 0 0 0-.396-.396H2.604a.396.396 0 0 0-.396.396v3.208c0 .218.178.396.396.396zm0 6.22h18.792a.396.396 0 0 0 .396-.396v-3.208a.396.396 0 0 0-.396-.396H2.604a.396.396 0 0 0-.396.396v3.208c0 .218.178.396.396.396zm0-12.22h18.792a.396.396 0 0 0 .396-.396V1.286a.396.396 0 0 0-.396-.396H2.604a.396.396 0 0 0-.396.396v3.208c0 .218.178.396.396.396zm0 18h11.188a.396.396 0 0 0 .396-.396v-3.208a.396.396 0 0 0-.396-.396H2.604a.396.396 0 0 0-.396.396v3.208c0 .218.178.396.396.396z"/>
              </svg>
              <span className="hidden sm:inline">Paystack</span>
              {isPaystackConfigured && <Badge variant="outline" className="ml-1 text-xs hidden lg:inline-flex">Configured</Badge>}
            </TabsTrigger>
            <TabsTrigger value="mercadopago" className="flex items-center gap-1 md:gap-2 whitespace-nowrap px-3" data-testid="tab-mercadopago">
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 4.8c3.974 0 7.2 3.226 7.2 7.2s-3.226 7.2-7.2 7.2-7.2-3.226-7.2-7.2S8.026 4.8 12 4.8zm0 1.8a5.4 5.4 0 1 0 0 10.8 5.4 5.4 0 0 0 0-10.8zm0 2.4a3 3 0 1 1 0 6 3 3 0 0 1 0-6z"/>
              </svg>
              <span className="hidden sm:inline">MP</span>
              {isMercadopagoConfigured && <Badge variant="outline" className="ml-1 text-xs hidden lg:inline-flex">Configured</Badge>}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="stripe">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <CreditCard className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <CardTitle>{t("admin.payments.title") || "Stripe Configuration"}</CardTitle>
                    <CardDescription>{t("admin.payments.description") || "Configure Stripe for payment processing"}</CardDescription>
                  </div>
                </div>
                {isStripeConfigured && (
                  <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    {t("admin.payments.configured") || "Configured"}
                  </Badge>
                )}
              </div>
            </CardHeader>

            <CardContent className="space-y-6">
              {stripeConnectionStatus && (
                <Alert variant={stripeConnectionStatus.connected ? "default" : "destructive"}>
                  {stripeConnectionStatus.connected ? (
                    <CheckCircle className="h-4 w-4" />
                  ) : (
                    <AlertCircle className="h-4 w-4" />
                  )}
                  <AlertDescription>
                    {stripeConnectionStatus.connected ? (
                      <div className="space-y-1">
                        <p>{t("admin.payments.connectionSuccess") || "Connection successful!"}</p>
                        <p className="text-sm text-muted-foreground">
                          {t("admin.payments.mode") || "Mode"}: <strong>{stripeConnectionStatus.mode?.toUpperCase()}</strong> | 
                          {" "}{t("admin.payments.source") || "Source"}: <strong>{stripeConnectionStatus.source}</strong>
                        </p>
                      </div>
                    ) : (
                      stripeConnectionStatus.error
                    )}
                  </AlertDescription>
                </Alert>
              )}

              <div className="grid gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="stripe_secret_key">{t("admin.payments.secretKey") || "Secret Key"}</Label>
                    {settings?.stripe_secret_key && (
                      <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Configured
                      </Badge>
                    )}
                  </div>
                  <div className="relative">
                    <Input
                      id="stripe_secret_key"
                      type={showStripeSecretKey ? "text" : "password"}
                      value={stripeFormData.stripe_secret_key}
                      onChange={(e) => handleStripeChange("stripe_secret_key", e.target.value)}
                      placeholder={settings?.stripe_secret_key ? "Enter new key to replace existing..." : "sk_test_..."}
                      className="pr-10"
                      data-testid="input-stripe-secret-key"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full px-3"
                      onClick={() => setShowStripeSecretKey(!showStripeSecretKey)}
                    >
                      {showStripeSecretKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">{t("admin.payments.secretKeyHint") || "Your Stripe secret key (starts with sk_)"}</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="stripe_publishable_key">{t("admin.payments.publishableKey") || "Publishable Key"}</Label>
                  <Input
                    id="stripe_publishable_key"
                    type="text"
                    value={stripeFormData.stripe_publishable_key}
                    onChange={(e) => handleStripeChange("stripe_publishable_key", e.target.value)}
                    placeholder="pk_test_..."
                    data-testid="input-stripe-publishable-key"
                  />
                  <p className="text-xs text-muted-foreground">{t("admin.payments.publishableKeyHint") || "Your Stripe publishable key (starts with pk_)"}</p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="stripe_webhook_secret">Webhook Secret</Label>
                    {settings?.stripe_webhook_secret && (
                      <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Configured
                      </Badge>
                    )}
                  </div>
                  <div className="relative">
                    <Input
                      id="stripe_webhook_secret"
                      type={showStripeWebhookSecret ? "text" : "password"}
                      value={stripeFormData.stripe_webhook_secret}
                      onChange={(e) => handleStripeChange("stripe_webhook_secret", e.target.value)}
                      placeholder={settings?.stripe_webhook_secret ? "Enter new secret to replace existing..." : "whsec_..."}
                      className="pr-10"
                      data-testid="input-stripe-webhook-secret"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full px-3"
                      onClick={() => setShowStripeWebhookSecret(!showStripeWebhookSecret)}
                      data-testid="button-toggle-stripe-webhook-secret"
                    >
                      {showStripeWebhookSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Webhook signing secret for signature verification (starts with whsec_)</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="stripe_currency">
                        {stripeCurrencyLocked ? (
                          <span className="flex items-center gap-1">
                            <Lock className="h-3 w-3" />
                            Stripe Currency (Locked)
                          </span>
                        ) : (
                          "Stripe Currency"
                        )}
                      </Label>
                      {!stripeCurrencyLocked && isStripeConfigured && (
                        <AlertDialog open={showLockConfirmDialog} onOpenChange={setShowLockConfirmDialog}>
                          <AlertDialogTrigger asChild>
                            <Button 
                              variant="outline" 
                              size="sm"
                              className="h-7 text-xs"
                              data-testid="button-lock-currency"
                            >
                              <LockOpen className="h-3 w-3 mr-1" />
                              Lock Currency
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle className="flex items-center gap-2">
                                <AlertTriangle className="h-5 w-5 text-amber-500" />
                                Lock Stripe Currency?
                              </AlertDialogTitle>
                              <AlertDialogDescription asChild>
                                <div className="space-y-3 text-sm text-muted-foreground">
                                  <p>
                                    You are about to permanently lock Stripe currency to <strong className="text-foreground">{stripeFormData.stripe_currency}</strong>.
                                  </p>
                                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
                                    <p className="font-medium text-amber-600 dark:text-amber-400">
                                      This action cannot be undone!
                                    </p>
                                    <p className="mt-1">
                                      Once locked, the Stripe currency cannot be changed. This ensures consistency for existing subscriptions and pricing.
                                    </p>
                                  </div>
                                  <p>
                                    Make sure you have configured all your pricing plans and credit packages with the correct {stripeFormData.stripe_currency} amounts before locking.
                                  </p>
                                </div>
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => lockCurrencyMutation.mutate()}
                                disabled={lockCurrencyMutation.isPending}
                                className="bg-amber-600 hover:bg-amber-700"
                              >
                                {lockCurrencyMutation.isPending ? (
                                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                ) : (
                                  <Lock className="h-4 w-4 mr-2" />
                                )}
                                Lock Currency
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                    <Select
                      value={stripeFormData.stripe_currency}
                      onValueChange={(value) => handleStripeChange("stripe_currency", value)}
                      disabled={stripeCurrencyLocked}
                    >
                      <SelectTrigger data-testid="select-stripe-currency" disabled={stripeCurrencyLocked}>
                        <SelectValue placeholder="Select currency" />
                      </SelectTrigger>
                      <SelectContent>
                        {CURRENCIES.map((currency) => (
                          <SelectItem key={currency.code} value={currency.code}>
                            <div className="flex items-center gap-2">
                              <span className="font-mono">{currency.code}</span>
                              <span className="text-muted-foreground">({currency.symbol})</span>
                              <span className="text-xs text-muted-foreground">{currency.name}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {stripeCurrencyLocked ? (
                      <div className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                        <Lock className="h-3 w-3" />
                        Currency is permanently locked to {stripeFormData.stripe_currency}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Select your Stripe currency. Once locked, this cannot be changed.
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="stripe_mode">{t("admin.payments.stripeMode") || "Stripe Mode"}</Label>
                    <Select
                      value={stripeFormData.stripe_mode}
                      onValueChange={(value) => handleStripeChange("stripe_mode", value)}
                    >
                      <SelectTrigger data-testid="select-stripe-mode">
                        <SelectValue placeholder={t("admin.payments.selectMode") || "Select mode"} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="test">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
                              Test
                            </Badge>
                            <span className="text-muted-foreground">{t("admin.payments.testMode") || "Test Mode"}</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="live">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                              Live
                            </Badge>
                            <span className="text-muted-foreground">{t("admin.payments.liveMode") || "Live Mode"}</span>
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Webhook URL Section */}
              <div className="space-y-2 p-4 bg-muted/50 rounded-lg border">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Webhook className="h-4 w-4 text-muted-foreground" />
                    <Label className="font-medium">Webhook URL</Label>
                  </div>
                </div>
                <div className="flex items-center gap-2 bg-background p-2 rounded-md border">
                  <code className="flex-1 text-sm font-mono text-muted-foreground truncate">
                    {window.location.origin}/api/stripe/webhook
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/api/stripe/webhook`);
                      toast({
                        title: "Copied",
                        description: "Webhook URL copied to clipboard",
                      });
                    }}
                    data-testid="button-copy-stripe-webhook"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <div className="space-y-2 mt-3">
                  <p className="text-xs text-muted-foreground">Copy this URL to your Stripe Dashboard webhook settings.</p>
                  <p className="text-xs text-muted-foreground font-medium">Subscribe to these events:</p>
                  <ul className="text-xs text-muted-foreground list-disc list-inside space-y-1">
                    <li>checkout.session.completed</li>
                    <li>invoice.payment_succeeded</li>
                    <li>invoice.payment_failed</li>
                    <li>customer.subscription.deleted</li>
                    <li>customer.subscription.updated</li>
                    <li>charge.dispute.created</li>
                    <li>charge.refunded</li>
                  </ul>
                </div>
              </div>
            </CardContent>

            <CardFooter className="flex justify-between gap-2 flex-wrap">
              <Button
                variant="outline"
                onClick={() => testStripeConnectionMutation.mutate()}
                disabled={testStripeConnectionMutation.isPending}
                data-testid="button-test-stripe"
              >
                {testStripeConnectionMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <TestTube className="h-4 w-4 mr-2" />
                )}
                {t("admin.payments.testConnection") || "Test Connection"}
              </Button>
              <Button
                onClick={saveStripeSettings}
                disabled={!hasStripeChanges || updateSettingMutation.isPending}
                data-testid="button-save-stripe"
              >
                {updateSettingMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                {t("common.saveChanges") || "Save Changes"}
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        <TabsContent value="razorpay">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <CreditCard className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <CardTitle>Razorpay Configuration</CardTitle>
                    <CardDescription>Configure Razorpay for payment processing (popular in India)</CardDescription>
                  </div>
                </div>
                {isRazorpayConfigured && (
                  <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Configured
                  </Badge>
                )}
              </div>
            </CardHeader>

            <CardContent className="space-y-6">
              {razorpayConnectionStatus && (
                <Alert variant={razorpayConnectionStatus.connected ? "default" : "destructive"}>
                  {razorpayConnectionStatus.connected ? (
                    <CheckCircle className="h-4 w-4" />
                  ) : (
                    <AlertCircle className="h-4 w-4" />
                  )}
                  <AlertDescription>
                    {razorpayConnectionStatus.connected 
                      ? "Razorpay connection successful!"
                      : razorpayConnectionStatus.error || "Connection failed"
                    }
                  </AlertDescription>
                </Alert>
              )}

              <div className="grid gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="razorpay_key_id">Key ID</Label>
                    {settings?.razorpay_key_id && (
                      <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Configured
                      </Badge>
                    )}
                  </div>
                  <Input
                    id="razorpay_key_id"
                    type="text"
                    value={razorpayFormData.razorpay_key_id}
                    onChange={(e) => handleRazorpayChange("razorpay_key_id", e.target.value)}
                    placeholder="rzp_test_..."
                    data-testid="input-razorpay-key-id"
                  />
                  <p className="text-xs text-muted-foreground">Your Razorpay Key ID (starts with rzp_test_ or rzp_live_)</p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="razorpay_key_secret">Key Secret</Label>
                    {settings?.razorpay_key_secret && (
                      <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Configured
                      </Badge>
                    )}
                  </div>
                  <div className="relative">
                    <Input
                      id="razorpay_key_secret"
                      type={showRazorpayKeySecret ? "text" : "password"}
                      value={razorpayFormData.razorpay_key_secret}
                      onChange={(e) => handleRazorpayChange("razorpay_key_secret", e.target.value)}
                      placeholder={settings?.razorpay_key_secret ? "Enter new secret to replace existing..." : "Enter your key secret"}
                      className="pr-10"
                      data-testid="input-razorpay-key-secret"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full px-3"
                      onClick={() => setShowRazorpayKeySecret(!showRazorpayKeySecret)}
                    >
                      {showRazorpayKeySecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Your Razorpay Key Secret (keep this secure)</p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="razorpay_webhook_secret">Webhook Secret (Optional)</Label>
                    {settings?.razorpay_webhook_secret && (
                      <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Configured
                      </Badge>
                    )}
                  </div>
                  <div className="relative">
                    <Input
                      id="razorpay_webhook_secret"
                      type={showRazorpayWebhookSecret ? "text" : "password"}
                      value={razorpayFormData.razorpay_webhook_secret}
                      onChange={(e) => handleRazorpayChange("razorpay_webhook_secret", e.target.value)}
                      placeholder={settings?.razorpay_webhook_secret ? "Enter new secret to replace existing..." : "Enter webhook secret"}
                      className="pr-10"
                      data-testid="input-razorpay-webhook-secret"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full px-3"
                      onClick={() => setShowRazorpayWebhookSecret(!showRazorpayWebhookSecret)}
                    >
                      {showRazorpayWebhookSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">For webhook signature verification (recommended for production)</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="razorpay_mode">Razorpay Mode</Label>
                  <Select
                    value={razorpayFormData.razorpay_mode}
                    onValueChange={(value) => handleRazorpayChange("razorpay_mode", value)}
                  >
                    <SelectTrigger data-testid="select-razorpay-mode">
                      <SelectValue placeholder="Select mode" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="test">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
                            Test
                          </Badge>
                          <span className="text-muted-foreground">Sandbox Mode (rzp_test_...)</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="live">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                            Live
                          </Badge>
                          <span className="text-muted-foreground">Production Mode (rzp_live_...)</span>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Test mode uses rzp_test_ keys, Live mode uses rzp_live_ keys</p>
                </div>

                <div className="space-y-2 p-4 bg-muted/50 rounded-lg border">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Webhook className="h-4 w-4 text-muted-foreground" />
                      <Label className="font-medium">Webhook URL</Label>
                    </div>
                    {settings?.razorpay_webhook_secret && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => testRazorpayWebhookMutation.mutate()}
                        disabled={testRazorpayWebhookMutation.isPending}
                        data-testid="button-test-razorpay-webhook"
                      >
                        {testRazorpayWebhookMutation.isPending ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <TestTube className="h-4 w-4 mr-2" />
                        )}
                        Test Webhook Secret
                      </Button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 bg-background rounded border text-sm font-mono break-all">
                      {window.location.origin}/api/razorpay/webhook
                    </code>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}/api/razorpay/webhook`);
                        toast({
                          title: "Copied",
                          description: "Webhook URL copied to clipboard",
                        });
                      }}
                      data-testid="button-copy-razorpay-webhook"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="space-y-2 mt-3">
                    <p className="text-xs text-muted-foreground">Copy this URL to your Razorpay Dashboard webhook settings.</p>
                    <p className="text-xs text-muted-foreground font-medium">Subscribe to these events:</p>
                    <ul className="text-xs text-muted-foreground list-disc list-inside space-y-1">
                      <li>payment.authorized</li>
                      <li>payment.captured</li>
                      <li>payment.failed</li>
                      <li>subscription.activated</li>
                      <li>subscription.charged</li>
                      <li>subscription.cancelled</li>
                    </ul>
                  </div>
                </div>
              </div>

              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Razorpay primarily supports INR (Indian Rupee). Make sure your pricing is configured accordingly when using Razorpay.
                </AlertDescription>
              </Alert>
            </CardContent>

            <CardFooter className="flex justify-between gap-2 flex-wrap">
              <Button
                variant="outline"
                onClick={() => testRazorpayConnectionMutation.mutate()}
                disabled={testRazorpayConnectionMutation.isPending}
                data-testid="button-test-razorpay"
              >
                {testRazorpayConnectionMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <TestTube className="h-4 w-4 mr-2" />
                )}
                Test Connection
              </Button>
              <Button
                onClick={saveRazorpaySettings}
                disabled={!hasRazorpayChanges || updateSettingMutation.isPending}
                data-testid="button-save-razorpay"
              >
                {updateSettingMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save Changes
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        <TabsContent value="paypal">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <CreditCard className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <CardTitle>PayPal Configuration</CardTitle>
                    <CardDescription>Configure PayPal for global payment processing</CardDescription>
                  </div>
                </div>
                {isPaypalConfigured && (
                  <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Configured
                  </Badge>
                )}
              </div>
            </CardHeader>

            <CardContent className="space-y-6">
              {paypalConnectionStatus && (
                <Alert variant={paypalConnectionStatus.connected ? "default" : "destructive"}>
                  {paypalConnectionStatus.connected ? (
                    <CheckCircle className="h-4 w-4" />
                  ) : (
                    <AlertCircle className="h-4 w-4" />
                  )}
                  <AlertDescription>
                    {paypalConnectionStatus.connected ? (
                      <div className="space-y-1">
                        <p>PayPal connection successful!</p>
                        {paypalConnectionStatus.mode && (
                          <p className="text-sm text-muted-foreground">
                            Mode: <strong>{paypalConnectionStatus.mode.toUpperCase()}</strong>
                          </p>
                        )}
                      </div>
                    ) : (
                      paypalConnectionStatus.error || "Connection failed"
                    )}
                  </AlertDescription>
                </Alert>
              )}

              <div className="grid gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="paypal_client_id">Client ID</Label>
                    {settings?.paypal_client_id && (
                      <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Configured
                      </Badge>
                    )}
                  </div>
                  <Input
                    id="paypal_client_id"
                    type="text"
                    value={paypalFormData.paypal_client_id}
                    onChange={(e) => handlePaypalChange("paypal_client_id", e.target.value)}
                    placeholder="Enter your PayPal Client ID"
                    data-testid="input-paypal-client-id"
                  />
                  <p className="text-xs text-muted-foreground">Your PayPal REST API Client ID</p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="paypal_client_secret">Client Secret</Label>
                    {settings?.paypal_client_secret && (
                      <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Configured
                      </Badge>
                    )}
                  </div>
                  <div className="relative">
                    <Input
                      id="paypal_client_secret"
                      type={showPaypalClientSecret ? "text" : "password"}
                      value={paypalFormData.paypal_client_secret}
                      onChange={(e) => handlePaypalChange("paypal_client_secret", e.target.value)}
                      placeholder={settings?.paypal_client_secret ? "Enter new secret to replace existing..." : "Enter your client secret"}
                      className="pr-10"
                      data-testid="input-paypal-client-secret"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full px-3"
                      onClick={() => setShowPaypalClientSecret(!showPaypalClientSecret)}
                      data-testid="button-toggle-paypal-secret"
                    >
                      {showPaypalClientSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Your PayPal REST API Client Secret (keep this secure)</p>
                </div>

                <div className="space-y-2 p-4 bg-muted/50 rounded-lg border">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Webhook className="h-4 w-4 text-muted-foreground" />
                      <Label className="font-medium">Webhook Configuration</Label>
                    </div>
                    {settings?.paypal_webhook_id && (
                      <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Configured
                      </Badge>
                    )}
                  </div>
                  
                  {settings?.paypal_webhook_id ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <code className="flex-1 px-3 py-2 bg-background rounded border text-sm font-mono break-all">
                          {window.location.origin}/api/paypal/webhook
                        </code>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => {
                            navigator.clipboard.writeText(`${window.location.origin}/api/paypal/webhook`);
                            toast({
                              title: "Copied",
                              description: "Webhook URL copied to clipboard",
                            });
                          }}
                          data-testid="button-copy-paypal-webhook"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Webhook ID: <code className="bg-muted px-1 rounded">{settings.paypal_webhook_id}</code>
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setupPaypalWebhookMutation.mutate()}
                        disabled={setupPaypalWebhookMutation.isPending || !isPaypalConfigured}
                        data-testid="button-reconfigure-paypal-webhook"
                      >
                        {setupPaypalWebhookMutation.isPending ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Webhook className="h-4 w-4 mr-2" />
                        )}
                        Reconfigure Webhook
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Click the button below to automatically configure the webhook in your PayPal account. 
                        Make sure you have saved your Client ID and Secret first.
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 px-3 py-2 bg-background rounded border text-sm font-mono break-all">
                          {window.location.origin}/api/paypal/webhook
                        </code>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => {
                            navigator.clipboard.writeText(`${window.location.origin}/api/paypal/webhook`);
                            toast({
                              title: "Copied",
                              description: "Webhook URL copied to clipboard",
                            });
                          }}
                          data-testid="button-copy-paypal-webhook"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                      <Button
                        type="button"
                        onClick={() => setupPaypalWebhookMutation.mutate()}
                        disabled={setupPaypalWebhookMutation.isPending || !isPaypalConfigured}
                        data-testid="button-setup-paypal-webhook"
                      >
                        {setupPaypalWebhookMutation.isPending ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Webhook className="h-4 w-4 mr-2" />
                        )}
                        Setup Webhook Automatically
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        This will register the webhook with PayPal and subscribe to payment events automatically.
                      </p>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="paypal_currency">PayPal Currency</Label>
                    <Select
                      value={paypalFormData.paypal_currency}
                      onValueChange={(value) => handlePaypalChange("paypal_currency", value)}
                    >
                      <SelectTrigger data-testid="select-paypal-currency">
                        <SelectValue placeholder="Select currency" />
                      </SelectTrigger>
                      <SelectContent>
                        {PAYPAL_CURRENCIES.map((currency) => (
                          <SelectItem key={currency.code} value={currency.code}>
                            <div className="flex items-center gap-2">
                              <span className="font-mono">{currency.code}</span>
                              <span className="text-muted-foreground">({currency.symbol})</span>
                              <span className="text-xs text-muted-foreground">{currency.name}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Select your PayPal currency</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="paypal_mode">PayPal Mode</Label>
                    <Select
                      value={paypalFormData.paypal_mode}
                      onValueChange={(value) => handlePaypalChange("paypal_mode", value)}
                    >
                      <SelectTrigger data-testid="select-paypal-mode">
                        <SelectValue placeholder="Select mode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sandbox">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
                              Sandbox
                            </Badge>
                            <span className="text-muted-foreground">Test Mode</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="live">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                              Live
                            </Badge>
                            <span className="text-muted-foreground">Production Mode</span>
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </CardContent>

            <CardFooter className="flex justify-between gap-2 flex-wrap">
              <Button
                variant="outline"
                onClick={() => testPaypalConnectionMutation.mutate()}
                disabled={testPaypalConnectionMutation.isPending}
                data-testid="button-test-paypal"
              >
                {testPaypalConnectionMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <TestTube className="h-4 w-4 mr-2" />
                )}
                Test Connection
              </Button>
              <Button
                onClick={savePaypalSettings}
                disabled={!hasPaypalChanges || updateSettingMutation.isPending}
                data-testid="button-save-paypal"
              >
                {updateSettingMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save Changes
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        <TabsContent value="paystack">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <CreditCard className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <CardTitle>Paystack Configuration</CardTitle>
                    <CardDescription>Configure Paystack for payment processing (popular in Africa)</CardDescription>
                  </div>
                </div>
                {isPaystackConfigured && (
                  <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Configured
                  </Badge>
                )}
              </div>
            </CardHeader>

            <CardContent className="space-y-6">
              {paystackConnectionStatus && (
                <Alert variant={paystackConnectionStatus.connected ? "default" : "destructive"}>
                  {paystackConnectionStatus.connected ? (
                    <CheckCircle className="h-4 w-4" />
                  ) : (
                    <AlertCircle className="h-4 w-4" />
                  )}
                  <AlertDescription>
                    {paystackConnectionStatus.connected 
                      ? "Paystack connection successful!"
                      : paystackConnectionStatus.error || "Connection failed"
                    }
                  </AlertDescription>
                </Alert>
              )}

              <div className="grid gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="paystack_public_key">Public Key</Label>
                    {settings?.paystack_public_key && (
                      <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Configured
                      </Badge>
                    )}
                  </div>
                  <Input
                    id="paystack_public_key"
                    type="text"
                    value={paystackFormData.paystack_public_key}
                    onChange={(e) => handlePaystackChange("paystack_public_key", e.target.value)}
                    placeholder="pk_test_..."
                    data-testid="input-paystack-public-key"
                  />
                  <p className="text-xs text-muted-foreground">Your Paystack Public Key (starts with pk_test_ or pk_live_)</p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="paystack_secret_key">Secret Key</Label>
                    {settings?.paystack_secret_key && (
                      <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Configured
                      </Badge>
                    )}
                  </div>
                  <div className="relative">
                    <Input
                      id="paystack_secret_key"
                      type={showPaystackSecretKey ? "text" : "password"}
                      value={paystackFormData.paystack_secret_key}
                      onChange={(e) => handlePaystackChange("paystack_secret_key", e.target.value)}
                      placeholder={settings?.paystack_secret_key ? "Enter new secret to replace existing..." : "Enter your secret key"}
                      className="pr-10"
                      data-testid="input-paystack-secret-key"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full px-3"
                      onClick={() => setShowPaystackSecretKey(!showPaystackSecretKey)}
                      data-testid="button-toggle-paystack-secret"
                    >
                      {showPaystackSecretKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Your Paystack Secret Key (keep this secure)</p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="paystack_webhook_secret">Webhook Secret (Optional)</Label>
                    {settings?.paystack_webhook_secret && (
                      <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Configured
                      </Badge>
                    )}
                  </div>
                  <div className="relative">
                    <Input
                      id="paystack_webhook_secret"
                      type={showPaystackWebhookSecret ? "text" : "password"}
                      value={paystackFormData.paystack_webhook_secret}
                      onChange={(e) => handlePaystackChange("paystack_webhook_secret", e.target.value)}
                      placeholder={settings?.paystack_webhook_secret ? "Enter new secret to replace existing..." : "Enter webhook secret"}
                      className="pr-10"
                      data-testid="input-paystack-webhook-secret"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full px-3"
                      onClick={() => setShowPaystackWebhookSecret(!showPaystackWebhookSecret)}
                      data-testid="button-toggle-paystack-webhook-secret"
                    >
                      {showPaystackWebhookSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">For webhook signature verification (recommended for production)</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="paystack_currency">Paystack Currency</Label>
                  <Select
                    value={paystackFormData.paystack_currency}
                    onValueChange={(value) => handlePaystackChange("paystack_currency", value)}
                  >
                    <SelectTrigger data-testid="select-paystack-currency">
                      <SelectValue placeholder="Select currency" />
                    </SelectTrigger>
                    <SelectContent>
                      {PAYSTACK_CURRENCIES.map((currency) => (
                        <SelectItem key={currency.code} value={currency.code}>
                          <div className="flex items-center gap-2">
                            <span className="font-mono">{currency.code}</span>
                            <span className="text-muted-foreground">({currency.symbol})</span>
                            <span className="text-xs text-muted-foreground">{currency.name}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Select your Paystack currency (African markets + USD)</p>
                </div>

                <div className="space-y-2 p-4 bg-muted/50 rounded-lg border">
                  <div className="flex items-center gap-2">
                    <Webhook className="h-4 w-4 text-muted-foreground" />
                    <Label className="font-medium">Webhook URL</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 bg-background rounded border text-sm font-mono break-all">
                      {window.location.origin}/api/paystack/webhook
                    </code>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}/api/paystack/webhook`);
                        toast({
                          title: "Copied",
                          description: "Webhook URL copied to clipboard",
                        });
                      }}
                      data-testid="button-copy-paystack-webhook"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="space-y-2 mt-3">
                    <p className="text-xs text-muted-foreground">Copy this URL to your Paystack Dashboard webhook settings.</p>
                    <p className="text-xs text-muted-foreground font-medium">Enable these event notifications:</p>
                    <ul className="text-xs text-muted-foreground list-disc list-inside space-y-1">
                      <li>charge.success</li>
                      <li>subscription.create</li>
                      <li>subscription.disable</li>
                      <li>subscription.not_renew</li>
                    </ul>
                  </div>
                </div>
              </div>

              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Paystack is optimized for African markets. Ensure your pricing is configured for the selected currency.
                </AlertDescription>
              </Alert>
            </CardContent>

            <CardFooter className="flex justify-between gap-2 flex-wrap">
              <Button
                variant="outline"
                onClick={() => testPaystackConnectionMutation.mutate()}
                disabled={testPaystackConnectionMutation.isPending}
                data-testid="button-test-paystack"
              >
                {testPaystackConnectionMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <TestTube className="h-4 w-4 mr-2" />
                )}
                Test Connection
              </Button>
              <Button
                onClick={savePaystackSettings}
                disabled={!hasPaystackChanges || updateSettingMutation.isPending}
                data-testid="button-save-paystack"
              >
                {updateSettingMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save Changes
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        <TabsContent value="mercadopago">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <CreditCard className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <CardTitle>MercadoPago Configuration</CardTitle>
                    <CardDescription>Configure MercadoPago for payment processing (popular in Latin America)</CardDescription>
                  </div>
                </div>
                {isMercadopagoConfigured && (
                  <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Configured
                  </Badge>
                )}
              </div>
            </CardHeader>

            <CardContent className="space-y-6">
              {mercadopagoConnectionStatus && (
                <Alert variant={mercadopagoConnectionStatus.connected ? "default" : "destructive"}>
                  {mercadopagoConnectionStatus.connected ? (
                    <CheckCircle className="h-4 w-4" />
                  ) : (
                    <AlertCircle className="h-4 w-4" />
                  )}
                  <AlertDescription>
                    {mercadopagoConnectionStatus.connected 
                      ? "MercadoPago connection successful!"
                      : mercadopagoConnectionStatus.error || "Connection failed"
                    }
                  </AlertDescription>
                </Alert>
              )}

              <div className="grid gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="mercadopago_public_key">Public Key</Label>
                    {settings?.mercadopago_public_key && (
                      <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Configured
                      </Badge>
                    )}
                  </div>
                  <Input
                    id="mercadopago_public_key"
                    type="text"
                    value={mercadopagoFormData.mercadopago_public_key}
                    onChange={(e) => handleMercadopagoChange("mercadopago_public_key", e.target.value)}
                    placeholder="TEST-... or APP_USR-..."
                    data-testid="input-mercadopago-public-key"
                  />
                  <p className="text-xs text-muted-foreground">Your MercadoPago Public Key</p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="mercadopago_access_token">Access Token</Label>
                    {settings?.mercadopago_access_token && (
                      <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Configured
                      </Badge>
                    )}
                  </div>
                  <div className="relative">
                    <Input
                      id="mercadopago_access_token"
                      type={showMercadopagoAccessToken ? "text" : "password"}
                      value={mercadopagoFormData.mercadopago_access_token}
                      onChange={(e) => handleMercadopagoChange("mercadopago_access_token", e.target.value)}
                      placeholder={settings?.mercadopago_access_token ? "Enter new token to replace existing..." : "Enter your access token"}
                      className="pr-10"
                      data-testid="input-mercadopago-access-token"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full px-3"
                      onClick={() => setShowMercadopagoAccessToken(!showMercadopagoAccessToken)}
                      data-testid="button-toggle-mercadopago-token"
                    >
                      {showMercadopagoAccessToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Your MercadoPago Access Token (keep this secure)</p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="mercadopago_webhook_secret">Webhook Secret (Optional)</Label>
                    {settings?.mercadopago_webhook_secret && (
                      <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Configured
                      </Badge>
                    )}
                  </div>
                  <div className="relative">
                    <Input
                      id="mercadopago_webhook_secret"
                      type={showMercadopagoWebhookSecret ? "text" : "password"}
                      value={mercadopagoFormData.mercadopago_webhook_secret}
                      onChange={(e) => handleMercadopagoChange("mercadopago_webhook_secret", e.target.value)}
                      placeholder={settings?.mercadopago_webhook_secret ? "Enter new secret to replace existing..." : "Enter webhook secret"}
                      className="pr-10"
                      data-testid="input-mercadopago-webhook-secret"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full px-3"
                      onClick={() => setShowMercadopagoWebhookSecret(!showMercadopagoWebhookSecret)}
                      data-testid="button-toggle-mercadopago-webhook-secret"
                    >
                      {showMercadopagoWebhookSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">For webhook signature verification (recommended for production)</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="mercadopago_currency">MercadoPago Currency</Label>
                  <Select
                    value={mercadopagoFormData.mercadopago_currency}
                    onValueChange={(value) => handleMercadopagoChange("mercadopago_currency", value)}
                  >
                    <SelectTrigger data-testid="select-mercadopago-currency">
                      <SelectValue placeholder="Select currency" />
                    </SelectTrigger>
                    <SelectContent>
                      {MERCADOPAGO_CURRENCIES.map((currency) => (
                        <SelectItem key={currency.code} value={currency.code}>
                          <div className="flex items-center gap-2">
                            <span className="font-mono">{currency.code}</span>
                            <span className="text-muted-foreground">({currency.symbol})</span>
                            <span className="text-xs text-muted-foreground">{currency.name}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Select your MercadoPago currency (Latin American markets)</p>
                </div>

                <div className="space-y-2 p-4 bg-muted/50 rounded-lg border">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Webhook className="h-4 w-4 text-muted-foreground" />
                      <Label className="font-medium">Webhook Configuration</Label>
                    </div>
                    {settings?.mercadopago_webhook_id && (
                      <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Configured
                      </Badge>
                    )}
                  </div>
                  
                  {settings?.mercadopago_webhook_id ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <code className="flex-1 px-3 py-2 bg-background rounded border text-sm font-mono break-all">
                          {window.location.origin}/api/mercadopago/webhook
                        </code>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => {
                            navigator.clipboard.writeText(`${window.location.origin}/api/mercadopago/webhook`);
                            toast({
                              title: "Copied",
                              description: "Webhook URL copied to clipboard",
                            });
                          }}
                          data-testid="button-copy-mercadopago-webhook"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Webhook ID: <code className="bg-muted px-1 rounded">{settings.mercadopago_webhook_id}</code>
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setupMercadopagoWebhookMutation.mutate()}
                        disabled={setupMercadopagoWebhookMutation.isPending || !isMercadopagoConfigured}
                        data-testid="button-reconfigure-mercadopago-webhook"
                      >
                        {setupMercadopagoWebhookMutation.isPending ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Webhook className="h-4 w-4 mr-2" />
                        )}
                        Reconfigure Webhook
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Click the button below to automatically configure the webhook in your MercadoPago account. 
                        Make sure you have saved your Access Token first.
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 px-3 py-2 bg-background rounded border text-sm font-mono break-all">
                          {window.location.origin}/api/mercadopago/webhook
                        </code>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => {
                            navigator.clipboard.writeText(`${window.location.origin}/api/mercadopago/webhook`);
                            toast({
                              title: "Copied",
                              description: "Webhook URL copied to clipboard",
                            });
                          }}
                          data-testid="button-copy-mercadopago-webhook"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                      <Button
                        type="button"
                        onClick={() => setupMercadopagoWebhookMutation.mutate()}
                        disabled={setupMercadopagoWebhookMutation.isPending || !isMercadopagoConfigured}
                        data-testid="button-setup-mercadopago-webhook"
                      >
                        {setupMercadopagoWebhookMutation.isPending ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Webhook className="h-4 w-4 mr-2" />
                        )}
                        Setup Webhook Automatically
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        This will register the webhook with MercadoPago and subscribe to payment events automatically.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  MercadoPago is optimized for Latin American markets. Ensure your pricing is configured for the selected currency.
                </AlertDescription>
              </Alert>
            </CardContent>

            <CardFooter className="flex justify-between gap-2 flex-wrap">
              <Button
                variant="outline"
                onClick={() => testMercadopagoConnectionMutation.mutate()}
                disabled={testMercadopagoConnectionMutation.isPending}
                data-testid="button-test-mercadopago"
              >
                {testMercadopagoConnectionMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <TestTube className="h-4 w-4 mr-2" />
                )}
                Test Connection
              </Button>
              <Button
                onClick={saveMercadopagoSettings}
                disabled={!hasMercadopagoChanges || updateSettingMutation.isPending}
                data-testid="button-save-mercadopago"
              >
                {updateSettingMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save Changes
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <DollarSign className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle>{t("admin.payments.currencyInfo") || "Currency Information"}</CardTitle>
              <CardDescription>{t("admin.payments.currencyInfoDesc") || "Important information about currency settings"}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Different payment gateways support different currencies. Stripe supports multiple global currencies, Razorpay primarily supports INR (India), PayPal supports major global currencies, Paystack supports African currencies (NGN, GHS, ZAR, KES), and MercadoPago supports Latin American currencies (BRL, ARS, MXN, CLP, COP). Ensure your pricing is configured appropriately for each enabled gateway.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Currency Change Warning Dialog */}
      <AlertDialog open={showCurrencyChangeDialog} onOpenChange={setShowCurrencyChangeDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Change Stripe Currency?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>
                  You are about to change the Stripe currency from <strong className="text-foreground">{stripeFormData.stripe_currency}</strong> to <strong className="text-foreground">{pendingCurrencyChange}</strong>.
                </p>
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
                  <p className="font-medium text-amber-600 dark:text-amber-400">
                    Important: Plans and Credit Packages Need Resync
                  </p>
                  <p className="mt-1">
                    After changing the currency, you must edit and save each of your plans and credit packages. This will create new Stripe prices in the new currency.
                  </p>
                </div>
                <p>
                  Existing Stripe price IDs will become invalid for the new currency. Make sure to update all your pricing before enabling payments.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelCurrencyChange}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmCurrencyChange}
              className="bg-amber-600 hover:bg-amber-700"
            >
              <DollarSign className="h-4 w-4 mr-2" />
              Change Currency
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
