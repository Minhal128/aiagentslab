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
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useState, useMemo } from "react";
import { Loader2, Trash2, AlertTriangle, CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "react-i18next";

interface PluginCapabilities {
  capabilities: Record<string, boolean>;
  pluginBundles: Record<string, string>;
  sipEngine: boolean;
  restApi: boolean;
  teamManagement: boolean;
}

interface Plan {
  id: string;
  name: string;
  displayName: string;
  description: string;
  monthlyPrice: number;
  yearlyPrice: number;
  razorpayMonthlyPrice?: number | null;
  razorpayYearlyPrice?: number | null;
  paypalMonthlyPrice?: number | null;
  paypalYearlyPrice?: number | null;
  paystackMonthlyPrice?: number | null;
  paystackYearlyPrice?: number | null;
  mercadopagoMonthlyPrice?: number | null;
  mercadopagoYearlyPrice?: number | null;
  maxAgents: number;
  maxCampaigns: number;
  maxContactsPerCampaign: number;
  maxWebhooks: number;
  maxKnowledgeBases: number;
  maxFlows: number;
  maxPhoneNumbers: number;
  maxWidgets: number;
  includedCredits: number;
  defaultLlmModel?: string;
  canChooseLlm: boolean;
  canPurchaseNumbers: boolean;
  useSystemPool: boolean;
  sipEnabled: boolean;
  maxConcurrentSipCalls?: number;
  restApiEnabled: boolean;
  isActive: boolean;
  stripeProductId?: string | null;
  stripeMonthlyPriceId?: string | null;
  stripeYearlyPriceId?: string | null;
  razorpayPlanId?: string | null;
  razorpayYearlyPlanId?: string | null;
  paypalProductId?: string | null;
  paypalMonthlyPlanId?: string | null;
  paypalYearlyPlanId?: string | null;
  paystackMonthlyPlanCode?: string | null;
  paystackYearlyPlanCode?: string | null;
  mercadopagoMonthlyPlanId?: string | null;
  mercadopagoYearlyPlanId?: string | null;
}

interface PaymentGatewayConfig {
  stripeEnabled: boolean;
  razorpayEnabled: boolean;
  paypalEnabled: boolean;
  paystackEnabled: boolean;
  mercadopagoEnabled: boolean;
  stripeCurrency?: string;
  stripeCurrencySymbol?: string;
  paypalCurrency?: string;
  paypalCurrencySymbol?: string;
  paystackCurrency?: string;
  paystackCurrencySymbol?: string;
  paystackCurrencies?: string[];
  paystackDefaultCurrency?: string;
  mercadopagoCurrency?: string;
  mercadopagoCurrencySymbol?: string;
}

function RazorpaySyncStatus({ plan }: { plan: Plan }) {
  const { t } = useTranslation();
  
  // Check if this is a free plan (both USD prices are 0)
  const isFreePlan = plan.monthlyPrice === 0 && plan.yearlyPrice === 0;
  
  // Check if INR prices are configured (required for Razorpay sync)
  const hasMonthlyPrice = (plan.razorpayMonthlyPrice ?? 0) > 0;
  const hasYearlyPrice = (plan.razorpayYearlyPrice ?? 0) > 0;
  const hasAnyInrPricing = hasMonthlyPrice || hasYearlyPrice;
  
  // Check if plan IDs are set
  const hasMonthlyPlan = !!plan.razorpayPlanId;
  const hasYearlyPlan = !!plan.razorpayYearlyPlanId;
  
  // Fully synced: monthly plan exists (required), yearly plan exists if yearly price is set
  const isFullySynced = hasMonthlyPlan && (!hasYearlyPrice || hasYearlyPlan);
  
  // Partially synced: has some plan IDs but missing others that should exist
  const isPartiallySynced = hasAnyInrPricing && (hasMonthlyPlan || hasYearlyPlan) && !isFullySynced;
  
  // Not configured: no INR prices set at all (but only show if not a free plan)
  const isNotConfigured = !hasAnyInrPricing && !isFreePlan;
  
  if (isFullySynced) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Badge variant="outline" className="gap-1 cursor-help bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800">
              <CheckCircle2 className="h-3 w-3" />
              Razorpay Synced
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="space-y-1 text-xs">
            <p className="font-medium">Razorpay Integration</p>
            <p className="text-muted-foreground truncate">Monthly Plan: {plan.razorpayPlanId}</p>
            {plan.razorpayYearlyPlanId && (
              <p className="text-muted-foreground truncate">Yearly Plan: {plan.razorpayYearlyPlanId}</p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }
  
  if (isPartiallySynced) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Badge variant="outline" className="gap-1 cursor-help bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/30 dark:text-yellow-400 dark:border-yellow-800">
              <RefreshCw className="h-3 w-3" />
              Razorpay Partial
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="space-y-1 text-xs">
            <p className="font-medium">Missing Razorpay Plan IDs</p>
            {hasMonthlyPrice && !hasMonthlyPlan && <p className="text-destructive">No Monthly Plan ID</p>}
            {hasYearlyPrice && !hasYearlyPlan && <p className="text-destructive">No Yearly Plan ID</p>}
            <p className="text-muted-foreground mt-1">Save the plan to sync with Razorpay</p>
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }
  
  if (isFreePlan) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Badge variant="outline" className="gap-1 cursor-help bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800">
              <CheckCircle2 className="h-3 w-3" />
              Free Plan
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p className="text-xs">Free plans don't require payment gateway sync.</p>
        </TooltipContent>
      </Tooltip>
    );
  }
  
  if (isNotConfigured) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Badge variant="outline" className="gap-1 cursor-help text-muted-foreground">
              <XCircle className="h-3 w-3" />
              No INR Pricing
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p className="text-xs">Set INR prices to enable Razorpay subscriptions for this plan.</p>
        </TooltipContent>
      </Tooltip>
    );
  }
  
  // Has INR pricing but no plan IDs yet - needs to be saved to sync
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Badge variant="outline" className="gap-1 cursor-help bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-800">
            <RefreshCw className="h-3 w-3" />
            Needs Sync
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p className="text-xs">INR prices configured. Save the plan to create Razorpay subscription plans.</p>
      </TooltipContent>
    </Tooltip>
  );
}

function StripeSyncStatus({ plan }: { plan: Plan }) {
  const { t } = useTranslation();
  
  const hasProduct = !!plan.stripeProductId;
  const hasMonthlyPrice = !!plan.stripeMonthlyPriceId;
  const hasYearlyPrice = !!plan.stripeYearlyPriceId || plan.yearlyPrice === 0;
  
  const isFullySynced = hasProduct && hasMonthlyPrice && hasYearlyPrice;
  const isPartiallySynced = hasProduct || hasMonthlyPrice || (plan.stripeYearlyPriceId && plan.yearlyPrice > 0);
  
  if (isFullySynced) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Badge variant="outline" className="gap-1 cursor-help bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800">
              <CheckCircle2 className="h-3 w-3" />
              {t("admin.plans.stripeSynced", "Stripe Synced")}
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="space-y-1 text-xs">
            <p className="font-medium">{t("admin.plans.stripeIntegration", "Stripe Integration")}</p>
            <p className="text-muted-foreground truncate">Product: {plan.stripeProductId}</p>
            <p className="text-muted-foreground truncate">Monthly: {plan.stripeMonthlyPriceId}</p>
            {plan.stripeYearlyPriceId && (
              <p className="text-muted-foreground truncate">Yearly: {plan.stripeYearlyPriceId}</p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }
  
  if (isPartiallySynced) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Badge variant="outline" className="gap-1 cursor-help bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/30 dark:text-yellow-400 dark:border-yellow-800">
              <RefreshCw className="h-3 w-3" />
              {t("admin.plans.stripePartial", "Partial Sync")}
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="space-y-1 text-xs">
            <p className="font-medium">{t("admin.plans.stripeMissing", "Missing Stripe IDs")}</p>
            {!hasProduct && <p className="text-destructive">No Stripe Product ID</p>}
            {!hasMonthlyPrice && <p className="text-destructive">No Monthly Price ID</p>}
            {!hasYearlyPrice && plan.yearlyPrice > 0 && <p className="text-destructive">No Yearly Price ID</p>}
            <p className="text-muted-foreground mt-1">Update the plan to sync with Stripe</p>
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Badge variant="outline" className="gap-1 cursor-help bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800">
            <XCircle className="h-3 w-3" />
            {t("admin.plans.stripeNotSynced", "Not Synced")}
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p className="text-xs">{t("admin.plans.stripeNotConfigured", "This plan is not connected to Stripe. Update it to create Stripe products.")}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function PayPalSyncStatus({ plan, paypalCurrency }: { plan: Plan; paypalCurrency: string }) {
  const isFreePlan = plan.monthlyPrice === 0 && plan.yearlyPrice === 0;
  
  const hasMonthlyPrice = (plan.paypalMonthlyPrice ?? 0) > 0;
  const hasYearlyPrice = (plan.paypalYearlyPrice ?? 0) > 0;
  const hasAnyPricing = hasMonthlyPrice || hasYearlyPrice;
  
  const hasProduct = !!plan.paypalProductId;
  const hasMonthlyPlan = !!plan.paypalMonthlyPlanId;
  const hasYearlyPlan = !!plan.paypalYearlyPlanId;
  
  const isFullySynced = hasProduct && hasMonthlyPlan && (!hasYearlyPrice || hasYearlyPlan);
  const isPartiallySynced = hasAnyPricing && (hasProduct || hasMonthlyPlan || hasYearlyPlan) && !isFullySynced;
  const isNotConfigured = !hasAnyPricing && !isFreePlan;
  
  if (isFullySynced) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Badge variant="outline" className="gap-1 cursor-help bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800">
              <CheckCircle2 className="h-3 w-3" />
              PayPal Synced
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="space-y-1 text-xs">
            <p className="font-medium">PayPal Integration ({paypalCurrency})</p>
            <p className="text-muted-foreground truncate">Product: {plan.paypalProductId}</p>
            <p className="text-muted-foreground truncate">Monthly: {plan.paypalMonthlyPlanId}</p>
            {plan.paypalYearlyPlanId && (
              <p className="text-muted-foreground truncate">Yearly: {plan.paypalYearlyPlanId}</p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }
  
  if (isPartiallySynced) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Badge variant="outline" className="gap-1 cursor-help bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/30 dark:text-yellow-400 dark:border-yellow-800">
              <RefreshCw className="h-3 w-3" />
              PayPal Partial
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="space-y-1 text-xs">
            <p className="font-medium">Missing PayPal Plan IDs</p>
            {!hasProduct && <p className="text-destructive">No Product ID</p>}
            {hasMonthlyPrice && !hasMonthlyPlan && <p className="text-destructive">No Monthly Plan ID</p>}
            {hasYearlyPrice && !hasYearlyPlan && <p className="text-destructive">No Yearly Plan ID</p>}
            <p className="text-muted-foreground mt-1">Click Sync PayPal to create plans</p>
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }
  
  if (isFreePlan) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Badge variant="outline" className="gap-1 cursor-help bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800">
              <CheckCircle2 className="h-3 w-3" />
              Free Plan
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p className="text-xs">Free plans don't require PayPal sync.</p>
        </TooltipContent>
      </Tooltip>
    );
  }
  
  if (isNotConfigured) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Badge variant="outline" className="gap-1 cursor-help text-muted-foreground">
              <XCircle className="h-3 w-3" />
              No {paypalCurrency} Price
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p className="text-xs">Set {paypalCurrency} prices to enable PayPal subscriptions.</p>
        </TooltipContent>
      </Tooltip>
    );
  }
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Badge variant="outline" className="gap-1 cursor-help bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-800">
            <RefreshCw className="h-3 w-3" />
            Needs Sync
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p className="text-xs">{paypalCurrency} prices configured. Click Sync PayPal to create plans.</p>
      </TooltipContent>
    </Tooltip>
  );
}

function PaystackSyncStatus({ plan, paystackCurrency }: { plan: Plan; paystackCurrency: string }) {
  const isFreePlan = plan.monthlyPrice === 0 && plan.yearlyPrice === 0;
  
  const hasMonthlyPrice = (plan.paystackMonthlyPrice ?? 0) > 0;
  const hasYearlyPrice = (plan.paystackYearlyPrice ?? 0) > 0;
  const hasAnyPricing = hasMonthlyPrice || hasYearlyPrice;
  
  const hasMonthlyPlan = !!plan.paystackMonthlyPlanCode;
  const hasYearlyPlan = !!plan.paystackYearlyPlanCode;
  
  const isFullySynced = hasMonthlyPlan && (!hasYearlyPrice || hasYearlyPlan);
  const isPartiallySynced = hasAnyPricing && (hasMonthlyPlan || hasYearlyPlan) && !isFullySynced;
  const isNotConfigured = !hasAnyPricing && !isFreePlan;
  
  if (isFullySynced) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Badge variant="outline" className="gap-1 cursor-help bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800">
              <CheckCircle2 className="h-3 w-3" />
              Paystack Synced
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="space-y-1 text-xs">
            <p className="font-medium">Paystack Integration ({paystackCurrency})</p>
            <p className="text-muted-foreground truncate">Monthly: {plan.paystackMonthlyPlanCode}</p>
            {plan.paystackYearlyPlanCode && (
              <p className="text-muted-foreground truncate">Yearly: {plan.paystackYearlyPlanCode}</p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }
  
  if (isPartiallySynced) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Badge variant="outline" className="gap-1 cursor-help bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/30 dark:text-yellow-400 dark:border-yellow-800">
              <RefreshCw className="h-3 w-3" />
              Paystack Partial
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="space-y-1 text-xs">
            <p className="font-medium">Missing Paystack Plan Codes</p>
            {hasMonthlyPrice && !hasMonthlyPlan && <p className="text-destructive">No Monthly Plan Code</p>}
            {hasYearlyPrice && !hasYearlyPlan && <p className="text-destructive">No Yearly Plan Code</p>}
            <p className="text-muted-foreground mt-1">Click Sync Paystack to create plans</p>
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }
  
  if (isFreePlan) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Badge variant="outline" className="gap-1 cursor-help bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800">
              <CheckCircle2 className="h-3 w-3" />
              Free Plan
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p className="text-xs">Free plans don't require Paystack sync.</p>
        </TooltipContent>
      </Tooltip>
    );
  }
  
  if (isNotConfigured) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Badge variant="outline" className="gap-1 cursor-help text-muted-foreground">
              <XCircle className="h-3 w-3" />
              No {paystackCurrency} Price
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p className="text-xs">Set {paystackCurrency} prices to enable Paystack subscriptions.</p>
        </TooltipContent>
      </Tooltip>
    );
  }
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Badge variant="outline" className="gap-1 cursor-help bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-800">
            <RefreshCw className="h-3 w-3" />
            Needs Sync
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p className="text-xs">{paystackCurrency} prices configured. Click Sync Paystack to create plans.</p>
      </TooltipContent>
    </Tooltip>
  );
}

function MercadoPagoSyncStatus({ plan, mercadopagoCurrency }: { plan: Plan; mercadopagoCurrency: string }) {
  const isFreePlan = plan.monthlyPrice === 0 && plan.yearlyPrice === 0;
  
  const hasMonthlyPrice = (plan.mercadopagoMonthlyPrice ?? 0) > 0;
  const hasYearlyPrice = (plan.mercadopagoYearlyPrice ?? 0) > 0;
  const hasAnyPricing = hasMonthlyPrice || hasYearlyPrice;
  
  const hasMonthlyPlan = !!plan.mercadopagoMonthlyPlanId;
  const hasYearlyPlan = !!plan.mercadopagoYearlyPlanId;
  
  const isFullySynced = hasMonthlyPlan && (!hasYearlyPrice || hasYearlyPlan);
  const isPartiallySynced = hasAnyPricing && (hasMonthlyPlan || hasYearlyPlan) && !isFullySynced;
  const isNotConfigured = !hasAnyPricing && !isFreePlan;
  
  if (isFullySynced) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Badge variant="outline" className="gap-1 cursor-help bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800">
              <CheckCircle2 className="h-3 w-3" />
              MercadoPago Synced
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="space-y-1 text-xs">
            <p className="font-medium">MercadoPago Integration ({mercadopagoCurrency})</p>
            <p className="text-muted-foreground truncate">Monthly: {plan.mercadopagoMonthlyPlanId}</p>
            {plan.mercadopagoYearlyPlanId && (
              <p className="text-muted-foreground truncate">Yearly: {plan.mercadopagoYearlyPlanId}</p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }
  
  if (isPartiallySynced) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Badge variant="outline" className="gap-1 cursor-help bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/30 dark:text-yellow-400 dark:border-yellow-800">
              <RefreshCw className="h-3 w-3" />
              MercadoPago Partial
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="space-y-1 text-xs">
            <p className="font-medium">Missing MercadoPago Plan IDs</p>
            {hasMonthlyPrice && !hasMonthlyPlan && <p className="text-destructive">No Monthly Plan ID</p>}
            {hasYearlyPrice && !hasYearlyPlan && <p className="text-destructive">No Yearly Plan ID</p>}
            <p className="text-muted-foreground mt-1">Click Sync MercadoPago to create plans</p>
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }
  
  if (isFreePlan) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Badge variant="outline" className="gap-1 cursor-help bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800">
              <CheckCircle2 className="h-3 w-3" />
              Free Plan
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p className="text-xs">Free plans don't require MercadoPago sync.</p>
        </TooltipContent>
      </Tooltip>
    );
  }
  
  if (isNotConfigured) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Badge variant="outline" className="gap-1 cursor-help text-muted-foreground">
              <XCircle className="h-3 w-3" />
              No {mercadopagoCurrency} Price
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p className="text-xs">Set {mercadopagoCurrency} prices to enable MercadoPago subscriptions.</p>
        </TooltipContent>
      </Tooltip>
    );
  }
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Badge variant="outline" className="gap-1 cursor-help bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-800">
            <RefreshCw className="h-3 w-3" />
            Needs Sync
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p className="text-xs">{mercadopagoCurrency} prices configured. Click Sync MercadoPago to create plans.</p>
      </TooltipContent>
    </Tooltip>
  );
}

interface MigrationState {
  plan: Plan;
  userCount: number;
  targetPlanId: string;
}

export default function PlanManagement() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [editingPlan, setEditingPlan] = useState<string | null>(null);
  const [planForms, setPlanForms] = useState<Record<string, Partial<Plan>>>({});
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [deletingPlan, setDeletingPlan] = useState<Plan | null>(null);
  const [migrationState, setMigrationState] = useState<MigrationState | null>(null);
  const [newPlanForm, setNewPlanForm] = useState<Partial<Plan>>({
    name: "",
    displayName: "",
    description: "",
    monthlyPrice: 0,
    yearlyPrice: 0,
    razorpayMonthlyPrice: 0,
    razorpayYearlyPrice: 0,
    paypalMonthlyPrice: 0,
    paypalYearlyPrice: 0,
    paystackMonthlyPrice: 0,
    paystackYearlyPrice: 0,
    mercadopagoMonthlyPrice: 0,
    mercadopagoYearlyPrice: 0,
    maxAgents: 1,
    maxCampaigns: 1,
    maxContactsPerCampaign: 5,
    maxWebhooks: 3,
    maxKnowledgeBases: 5,
    maxFlows: 3,
    maxPhoneNumbers: 1,
    maxWidgets: 1,
    includedCredits: 100,
    canChooseLlm: false,
    canPurchaseNumbers: false,
    useSystemPool: false,
    sipEnabled: false,
    maxConcurrentSipCalls: 1,
    restApiEnabled: false,
    isActive: true
  });

  const { data: plans, isLoading, isError } = useQuery<Plan[]>({
    queryKey: ["/api/admin/plans"],
  });

  // Fetch admin settings to get the current Stripe currency
  const { data: adminSettings } = useQuery<Record<string, string>>({
    queryKey: ["/api/admin/settings"],
  });
  
  // Fetch payment gateway configuration
  const { data: paymentGateway } = useQuery<PaymentGatewayConfig>({
    queryKey: ["/api/settings/payment-gateway"],
  });

  // Fetch plugin capabilities to conditionally show plugin-related options
  const { data: pluginCapabilities } = useQuery<{ success: boolean; data: PluginCapabilities }>({
    queryKey: ["/api/plugins/capabilities"],
  });

  // Check if SIP Engine and REST API plugins are installed
  const sipPluginInstalled = useMemo(() => {
    return pluginCapabilities?.data?.capabilities?.['sip-engine'] ?? false;
  }, [pluginCapabilities]);

  const restApiPluginInstalled = useMemo(() => {
    return pluginCapabilities?.data?.capabilities?.['rest-api'] ?? false;
  }, [pluginCapabilities]);
  
  // Get the Stripe currency (defaults to USD if not set)
  const stripeCurrency = adminSettings?.stripe_currency || "USD";
  
  // Get currencies for other gateways
  const paypalCurrency = paymentGateway?.paypalCurrency?.toUpperCase() || "USD";
  const paystackCurrency = paymentGateway?.paystackDefaultCurrency?.toUpperCase() || "NGN";
  const mercadopagoCurrency = paymentGateway?.mercadopagoCurrency?.toUpperCase() || "BRL";
  
  // Currency symbol mapping
  const getCurrencySymbol = (currency: string) => {
    const symbols: Record<string, string> = {
      USD: "$",
      EUR: "€",
      GBP: "£",
      INR: "₹",
      AUD: "A$",
      CAD: "C$",
      JPY: "¥",
      CNY: "¥",
      NGN: "₦",
      GHS: "₵",
      ZAR: "R",
      KES: "KSh",
      BRL: "R$",
      MXN: "MX$",
      ARS: "AR$",
      CLP: "CLP$",
      COP: "COP$",
    };
    return symbols[currency] || currency + " ";
  };
  
  const stripeCurrencySymbol = getCurrencySymbol(stripeCurrency);
  const paypalCurrencySymbol = getCurrencySymbol(paypalCurrency);
  const paystackCurrencySymbol = getCurrencySymbol(paystackCurrency);
  const mercadopagoCurrencySymbol = getCurrencySymbol(mercadopagoCurrency);

  const createPlan = useMutation({
    mutationFn: async (planData: Partial<Plan>) => {
      return apiRequest("POST", "/api/admin/plans", planData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/plans"] });
      toast({ title: t("admin.plans.planCreated") });
      setShowCreateForm(false);
      setNewPlanForm({
        name: "",
        displayName: "",
        description: "",
        monthlyPrice: 0,
        yearlyPrice: 0,
        razorpayMonthlyPrice: 0,
        razorpayYearlyPrice: 0,
        paypalMonthlyPrice: 0,
        paypalYearlyPrice: 0,
        paystackMonthlyPrice: 0,
        paystackYearlyPrice: 0,
        mercadopagoMonthlyPrice: 0,
        mercadopagoYearlyPrice: 0,
        maxAgents: 1,
        maxCampaigns: 1,
        maxContactsPerCampaign: 5,
        maxWebhooks: 3,
        maxKnowledgeBases: 5,
        maxFlows: 3,
        maxPhoneNumbers: 1,
        maxWidgets: 1,
        includedCredits: 100,
        canChooseLlm: false,
        canPurchaseNumbers: false,
        useSystemPool: false,
        sipEnabled: false,
        maxConcurrentSipCalls: 1,
        restApiEnabled: false,
        isActive: true
      });
    },
    onError: (error: any) => {
      toast({
        title: t("admin.plans.createFailed"),
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const updatePlan = useMutation({
    mutationFn: async ({ planId, updates }: { planId: string; updates: Partial<Plan> }) => {
      return apiRequest("PATCH", `/api/admin/plans/${planId}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/plans"] });
      toast({ title: t("admin.plans.planUpdated") });
      setEditingPlan(null);
    },
    onError: (error: any) => {
      toast({
        title: t("admin.plans.updateFailed"),
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const deletePlan = useMutation({
    mutationFn: async (planId: string) => {
      const response = await apiRequest("DELETE", `/api/admin/plans/${planId}`);
      if (!response.ok) {
        const errorData = await response.json();
        throw { response: { json: () => Promise.resolve(errorData) }, ...errorData };
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/plans"] });
      toast({ title: t("admin.plans.planDeleted") });
      setDeletingPlan(null);
      setMigrationState(null);
    },
    onError: async (error: any) => {
      // Check if this is a migration required error
      if (error.error === 'USERS_NEED_MIGRATION' && deletingPlan) {
        // Show migration dialog
        setMigrationState({
          plan: deletingPlan,
          userCount: error.userCount || 0,
          targetPlanId: ''
        });
        setDeletingPlan(null);
        return;
      }
      
      toast({
        title: error?.error || t("admin.plans.deleteFailed"),
        description: error?.message || 'Failed to delete plan',
        variant: "destructive"
      });
      setDeletingPlan(null);
    }
  });

  const migrateUsers = useMutation({
    mutationFn: async ({ planId, targetPlanId }: { planId: string; targetPlanId: string }) => {
      const response = await apiRequest("POST", `/api/admin/plans/${planId}/migrate`, { targetPlanId });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Migration failed');
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({ 
        title: t("admin.plans.usersMigrated"),
        description: t("admin.plans.usersMigratedDesc", { 
          count: data.migratedCount, 
          plan: data.targetPlanName 
        })
      });
      // Now delete the plan
      if (migrationState) {
        deletePlan.mutate(migrationState.plan.id);
      }
    },
    onError: (error: any) => {
      toast({
        title: t("admin.plans.migrationFailed"),
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const syncToStripe = useMutation({
    mutationFn: async (planId: string) => {
      const response = await apiRequest("POST", `/api/admin/plans/${planId}/sync/stripe`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Stripe sync failed');
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/plans"] });
      toast({ 
        title: "Stripe Sync Complete",
        description: data.message
      });
    },
    onError: (error: any) => {
      toast({
        title: "Stripe Sync Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const syncToRazorpay = useMutation({
    mutationFn: async (planId: string) => {
      const response = await apiRequest("POST", `/api/admin/plans/${planId}/sync/razorpay`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Razorpay sync failed');
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/plans"] });
      toast({ 
        title: "Razorpay Sync Complete",
        description: data.message
      });
    },
    onError: (error: any) => {
      toast({
        title: "Razorpay Sync Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const syncToPayPal = useMutation({
    mutationFn: async (planId: string) => {
      const response = await apiRequest("POST", `/api/admin/plans/${planId}/sync/paypal`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'PayPal sync failed');
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/plans"] });
      toast({ 
        title: "PayPal Sync Complete",
        description: data.message
      });
    },
    onError: (error: any) => {
      toast({
        title: "PayPal Sync Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const syncToPaystack = useMutation({
    mutationFn: async (planId: string) => {
      const response = await apiRequest("POST", `/api/admin/plans/${planId}/sync/paystack`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Paystack sync failed');
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/plans"] });
      toast({ 
        title: "Paystack Sync Complete",
        description: data.message
      });
    },
    onError: (error: any) => {
      toast({
        title: "Paystack Sync Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const syncToMercadoPago = useMutation({
    mutationFn: async (planId: string) => {
      const response = await apiRequest("POST", `/api/admin/plans/${planId}/sync/mercadopago`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'MercadoPago sync failed');
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/plans"] });
      toast({ 
        title: "MercadoPago Sync Complete",
        description: data.message
      });
    },
    onError: (error: any) => {
      toast({
        title: "MercadoPago Sync Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const handleEdit = (plan: Plan) => {
    setEditingPlan(plan.id);
    setPlanForms({
      ...planForms,
      [plan.id]: { ...plan }
    });
  };

  const handleSave = (planId: string) => {
    const updates = planForms[planId];
    if (!updates) return;
    
    // Normalize price fields to handle NaN and empty values
    const normalizedUpdates: Partial<Plan> = { ...updates };
    
    // Handle USD price fields (must be numbers, default to 0)
    if (normalizedUpdates.monthlyPrice !== undefined) {
      const val = normalizedUpdates.monthlyPrice;
      if (typeof val === 'number' && isNaN(val)) {
        normalizedUpdates.monthlyPrice = 0;
      }
    }
    if (normalizedUpdates.yearlyPrice !== undefined) {
      const val = normalizedUpdates.yearlyPrice;
      if (typeof val === 'number' && isNaN(val)) {
        normalizedUpdates.yearlyPrice = 0;
      }
    }
    
    // Handle gateway price fields (can be null, treat NaN and 0 as null)
    // Razorpay
    if (normalizedUpdates.razorpayMonthlyPrice !== undefined) {
      const val = normalizedUpdates.razorpayMonthlyPrice;
      if (val === null || (typeof val === 'number' && (isNaN(val) || val === 0))) {
        normalizedUpdates.razorpayMonthlyPrice = null;
      }
    }
    if (normalizedUpdates.razorpayYearlyPrice !== undefined) {
      const val = normalizedUpdates.razorpayYearlyPrice;
      if (val === null || (typeof val === 'number' && (isNaN(val) || val === 0))) {
        normalizedUpdates.razorpayYearlyPrice = null;
      }
    }
    // PayPal
    if (normalizedUpdates.paypalMonthlyPrice !== undefined) {
      const val = normalizedUpdates.paypalMonthlyPrice;
      if (val === null || (typeof val === 'number' && (isNaN(val) || val === 0))) {
        normalizedUpdates.paypalMonthlyPrice = null;
      }
    }
    if (normalizedUpdates.paypalYearlyPrice !== undefined) {
      const val = normalizedUpdates.paypalYearlyPrice;
      if (val === null || (typeof val === 'number' && (isNaN(val) || val === 0))) {
        normalizedUpdates.paypalYearlyPrice = null;
      }
    }
    // Paystack
    if (normalizedUpdates.paystackMonthlyPrice !== undefined) {
      const val = normalizedUpdates.paystackMonthlyPrice;
      if (val === null || (typeof val === 'number' && (isNaN(val) || val === 0))) {
        normalizedUpdates.paystackMonthlyPrice = null;
      }
    }
    if (normalizedUpdates.paystackYearlyPrice !== undefined) {
      const val = normalizedUpdates.paystackYearlyPrice;
      if (val === null || (typeof val === 'number' && (isNaN(val) || val === 0))) {
        normalizedUpdates.paystackYearlyPrice = null;
      }
    }
    // MercadoPago
    if (normalizedUpdates.mercadopagoMonthlyPrice !== undefined) {
      const val = normalizedUpdates.mercadopagoMonthlyPrice;
      if (val === null || (typeof val === 'number' && (isNaN(val) || val === 0))) {
        normalizedUpdates.mercadopagoMonthlyPrice = null;
      }
    }
    if (normalizedUpdates.mercadopagoYearlyPrice !== undefined) {
      const val = normalizedUpdates.mercadopagoYearlyPrice;
      if (val === null || (typeof val === 'number' && (isNaN(val) || val === 0))) {
        normalizedUpdates.mercadopagoYearlyPrice = null;
      }
    }
    
    updatePlan.mutate({ planId, updates: normalizedUpdates });
  };

  const handleCancel = () => {
    setEditingPlan(null);
  };

  const updateField = (planId: string, field: keyof Plan, value: any) => {
    setPlanForms({
      ...planForms,
      [planId]: {
        ...planForms[planId],
        [field]: value
      }
    });
  };

  const updateNewPlanField = (field: keyof Plan, value: any) => {
    setNewPlanForm({
      ...newPlanForm,
      [field]: value
    });
  };

  const handleCreatePlan = () => {
    createPlan.mutate(newPlanForm);
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl md:text-2xl font-bold">{t("admin.plans.title")}</h2>
          <p className="text-muted-foreground text-sm md:text-base">
            {t("admin.plans.description")}
          </p>
        </div>
        <Button 
          onClick={() => setShowCreateForm(!showCreateForm)}
          data-testid="button-toggle-create-plan"
        >
          {showCreateForm ? t("common.cancel") : t("admin.plans.addNewPlan")}
        </Button>
      </div>

      {showCreateForm && (
        <Card>
          <CardHeader>
            <CardTitle>{t("admin.plans.createNewPlan")}</CardTitle>
            <CardDescription>{t("admin.plans.createDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>{t("admin.plans.planName")}</Label>
                <Input
                  type="text"
                  placeholder={t("admin.plans.planNamePlaceholder")}
                  value={newPlanForm.name}
                  onChange={(e) => updateNewPlanField("name", e.target.value)}
                  data-testid="input-new-plan-name"
                />
              </div>
              <div>
                <Label>{t("admin.plans.displayName")}</Label>
                <Input
                  type="text"
                  placeholder={t("admin.plans.displayNamePlaceholder")}
                  value={newPlanForm.displayName}
                  onChange={(e) => updateNewPlanField("displayName", e.target.value)}
                  data-testid="input-new-plan-display-name"
                />
              </div>
            </div>

            <div>
              <Label>{t("admin.plans.descriptionLabel")}</Label>
              <Input
                type="text"
                placeholder={t("admin.plans.descriptionPlaceholder")}
                value={newPlanForm.description}
                onChange={(e) => updateNewPlanField("description", e.target.value)}
                data-testid="input-new-plan-description"
              />
            </div>

            {paymentGateway?.stripeEnabled && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Monthly Price ({stripeCurrency} - Stripe)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={newPlanForm.monthlyPrice}
                    onChange={(e) => updateNewPlanField("monthlyPrice", parseFloat(e.target.value))}
                    data-testid="input-new-plan-monthly"
                  />
                </div>
                <div>
                  <Label>Yearly Price ({stripeCurrency} - Stripe)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={newPlanForm.yearlyPrice}
                    onChange={(e) => updateNewPlanField("yearlyPrice", parseFloat(e.target.value))}
                    data-testid="input-new-plan-yearly"
                  />
                </div>
              </div>
            )}

            {paymentGateway?.razorpayEnabled && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Monthly Price (INR - Razorpay)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={newPlanForm.razorpayMonthlyPrice ?? 0}
                    onChange={(e) => updateNewPlanField("razorpayMonthlyPrice", parseFloat(e.target.value))}
                    data-testid="input-new-plan-monthly-inr"
                  />
                </div>
                <div>
                  <Label>Yearly Price (INR - Razorpay)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={newPlanForm.razorpayYearlyPrice ?? 0}
                    onChange={(e) => updateNewPlanField("razorpayYearlyPrice", parseFloat(e.target.value))}
                    data-testid="input-new-plan-yearly-inr"
                  />
                </div>
              </div>
            )}

            {paymentGateway?.paypalEnabled && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Monthly Price ({paypalCurrency} - PayPal)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={newPlanForm.paypalMonthlyPrice ?? 0}
                    onChange={(e) => updateNewPlanField("paypalMonthlyPrice", parseFloat(e.target.value))}
                    data-testid="input-new-plan-monthly-paypal"
                  />
                </div>
                <div>
                  <Label>Yearly Price ({paypalCurrency} - PayPal)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={newPlanForm.paypalYearlyPrice ?? 0}
                    onChange={(e) => updateNewPlanField("paypalYearlyPrice", parseFloat(e.target.value))}
                    data-testid="input-new-plan-yearly-paypal"
                  />
                </div>
              </div>
            )}

            {paymentGateway?.paystackEnabled && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Monthly Price ({paystackCurrency} - Paystack)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={newPlanForm.paystackMonthlyPrice ?? 0}
                    onChange={(e) => updateNewPlanField("paystackMonthlyPrice", parseFloat(e.target.value))}
                    data-testid="input-new-plan-monthly-paystack"
                  />
                </div>
                <div>
                  <Label>Yearly Price ({paystackCurrency} - Paystack)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={newPlanForm.paystackYearlyPrice ?? 0}
                    onChange={(e) => updateNewPlanField("paystackYearlyPrice", parseFloat(e.target.value))}
                    data-testid="input-new-plan-yearly-paystack"
                  />
                </div>
              </div>
            )}

            {paymentGateway?.mercadopagoEnabled && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Monthly Price ({mercadopagoCurrency} - MercadoPago)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={newPlanForm.mercadopagoMonthlyPrice ?? 0}
                    onChange={(e) => updateNewPlanField("mercadopagoMonthlyPrice", parseFloat(e.target.value))}
                    data-testid="input-new-plan-monthly-mercadopago"
                  />
                </div>
                <div>
                  <Label>Yearly Price ({mercadopagoCurrency} - MercadoPago)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={newPlanForm.mercadopagoYearlyPrice ?? 0}
                    onChange={(e) => updateNewPlanField("mercadopagoYearlyPrice", parseFloat(e.target.value))}
                    data-testid="input-new-plan-yearly-mercadopago"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="flex items-center">
                  <Label>{t("admin.plans.maxAgents")}</Label>
                  <InfoTooltip content="Use -1 for unlimited" />
                </div>
                <Input
                  type="number"
                  value={newPlanForm.maxAgents}
                  onChange={(e) => updateNewPlanField("maxAgents", parseInt(e.target.value, 10))}
                  data-testid="input-new-plan-agents"
                />
              </div>
              <div>
                <div className="flex items-center">
                  <Label>{t("admin.plans.maxCampaigns")}</Label>
                  <InfoTooltip content="Use -1 for unlimited" />
                </div>
                <Input
                  type="number"
                  value={newPlanForm.maxCampaigns}
                  onChange={(e) => updateNewPlanField("maxCampaigns", parseInt(e.target.value, 10))}
                  data-testid="input-new-plan-campaigns"
                />
              </div>
              <div>
                <div className="flex items-center">
                  <Label>{t("admin.plans.maxContacts")}</Label>
                  <InfoTooltip content="Use -1 for unlimited" />
                </div>
                <Input
                  type="number"
                  value={newPlanForm.maxContactsPerCampaign}
                  onChange={(e) => updateNewPlanField("maxContactsPerCampaign", parseInt(e.target.value, 10))}
                  data-testid="input-new-plan-contacts"
                />
              </div>
            </div>

            <div className="grid grid-cols-4 gap-4">
              <div>
                <div className="flex items-center">
                  <Label>{t("admin.plans.maxWebhooks", "Max Webhooks")}</Label>
                  <InfoTooltip content="Use -1 for unlimited" />
                </div>
                <Input
                  type="number"
                  value={newPlanForm.maxWebhooks}
                  onChange={(e) => updateNewPlanField("maxWebhooks", parseInt(e.target.value, 10))}
                  data-testid="input-new-plan-webhooks"
                />
              </div>
              <div>
                <div className="flex items-center">
                  <Label>{t("admin.plans.maxKnowledgeBases", "Max KBs")}</Label>
                  <InfoTooltip content="Use -1 for unlimited" />
                </div>
                <Input
                  type="number"
                  value={newPlanForm.maxKnowledgeBases}
                  onChange={(e) => updateNewPlanField("maxKnowledgeBases", parseInt(e.target.value, 10))}
                  data-testid="input-new-plan-kbs"
                />
              </div>
              <div>
                <div className="flex items-center">
                  <Label>{t("admin.plans.maxFlows", "Max Flows")}</Label>
                  <InfoTooltip content="Use -1 for unlimited" />
                </div>
                <Input
                  type="number"
                  value={newPlanForm.maxFlows}
                  onChange={(e) => updateNewPlanField("maxFlows", parseInt(e.target.value, 10))}
                  data-testid="input-new-plan-flows"
                />
              </div>
              <div>
                <div className="flex items-center">
                  <Label>{t("admin.plans.maxPhoneNumbers", "Max Phone #s")}</Label>
                  <InfoTooltip content="Use -1 for unlimited" />
                </div>
                <Input
                  type="number"
                  value={newPlanForm.maxPhoneNumbers}
                  onChange={(e) => updateNewPlanField("maxPhoneNumbers", parseInt(e.target.value, 10))}
                  data-testid="input-new-plan-phones"
                />
              </div>
              <div>
                <div className="flex items-center">
                  <Label>{t("admin.plans.maxWidgets", "Max Widgets")}</Label>
                  <InfoTooltip content="Use -1 for unlimited" />
                </div>
                <Input
                  type="number"
                  value={newPlanForm.maxWidgets}
                  onChange={(e) => updateNewPlanField("maxWidgets", parseInt(e.target.value, 10))}
                  data-testid="input-new-plan-widgets"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center">
                <Label>{t("admin.plans.includedCredits")}</Label>
                <InfoTooltip content="Credits included with plan (0 for none)" />
              </div>
              <Input
                type="number"
                value={newPlanForm.includedCredits}
                onChange={(e) => updateNewPlanField("includedCredits", parseInt(e.target.value, 10))}
                data-testid="input-new-plan-credits"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t("admin.plans.canChooseLlm")}</Label>
                <Switch
                  checked={newPlanForm.canChooseLlm}
                  onCheckedChange={(checked) => updateNewPlanField("canChooseLlm", checked)}
                  data-testid="switch-new-plan-llm"
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>{t("admin.plans.canPurchaseNumbers")}</Label>
                <Switch
                  checked={newPlanForm.canPurchaseNumbers}
                  onCheckedChange={(checked) => updateNewPlanField("canPurchaseNumbers", checked)}
                  data-testid="switch-new-plan-numbers"
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>{t("admin.plans.useSystemPool")}</Label>
                <Switch
                  checked={newPlanForm.useSystemPool}
                  onCheckedChange={(checked) => updateNewPlanField("useSystemPool", checked)}
                  data-testid="switch-new-plan-pool"
                />
              </div>
              {sipPluginInstalled && (
                <div className="flex items-center justify-between">
                  <Label>SIP Trunk Access</Label>
                  <Switch
                    checked={newPlanForm.sipEnabled}
                    onCheckedChange={(checked) => updateNewPlanField("sipEnabled", checked)}
                    data-testid="switch-new-plan-sip"
                  />
                </div>
              )}
              {sipPluginInstalled && newPlanForm.sipEnabled && (
                <div className="flex items-center justify-between">
                  <Label>Max Concurrent SIP Calls</Label>
                  <Input
                    type="number"
                    min={1}
                    value={newPlanForm.maxConcurrentSipCalls ?? 1}
                    onChange={(e) => updateNewPlanField("maxConcurrentSipCalls", parseInt(e.target.value, 10) || 1)}
                    className="w-24 text-right"
                    data-testid="input-new-plan-max-concurrent-sip"
                  />
                </div>
              )}
              {restApiPluginInstalled && (
                <div className="flex items-center justify-between">
                  <Label>REST API Access</Label>
                  <Switch
                    checked={newPlanForm.restApiEnabled}
                    onCheckedChange={(checked) => updateNewPlanField("restApiEnabled", checked)}
                    data-testid="switch-new-plan-restapi"
                  />
                </div>
              )}
              <div className="flex items-center justify-between">
                <Label>{t("admin.plans.activeLabel")}</Label>
                <Switch
                  checked={newPlanForm.isActive}
                  onCheckedChange={(checked) => updateNewPlanField("isActive", checked)}
                  data-testid="switch-new-plan-active"
                />
              </div>
            </div>

            <Button 
              onClick={handleCreatePlan} 
              disabled={createPlan.isPending}
              data-testid="button-create-plan"
            >
              {createPlan.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("admin.plans.creating")}
                </>
              ) : (
                t("admin.plans.createPlan")
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {plans?.map((plan) => {
          const isEditing = editingPlan === plan.id;
          const formData = planForms[plan.id] || plan;

          return (
            <Card key={plan.id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-xl">
                    {plan.displayName}
                  </CardTitle>
                  <div className="flex items-center gap-2 flex-wrap">
                    {paymentGateway?.stripeEnabled && <StripeSyncStatus plan={plan} />}
                    {paymentGateway?.razorpayEnabled && <RazorpaySyncStatus plan={plan} />}
                    {paymentGateway?.paypalEnabled && <PayPalSyncStatus plan={plan} paypalCurrency={paypalCurrency} />}
                    {paymentGateway?.paystackEnabled && <PaystackSyncStatus plan={plan} paystackCurrency={paystackCurrency} />}
                    {paymentGateway?.mercadopagoEnabled && <MercadoPagoSyncStatus plan={plan} mercadopagoCurrency={mercadopagoCurrency} />}
                  </div>
                </div>
                <CardDescription>{plan.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {isEditing ? (
                  <>
                    {paymentGateway?.stripeEnabled && (
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label>Monthly Price ({stripeCurrency} - Stripe)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={formData.monthlyPrice}
                            onChange={(e) => updateField(plan.id, "monthlyPrice", parseFloat(e.target.value))}
                            data-testid={`input-plan-monthly-${plan.id}`}
                          />
                        </div>
                        <div>
                          <Label>Yearly Price ({stripeCurrency} - Stripe)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={formData.yearlyPrice}
                            onChange={(e) => updateField(plan.id, "yearlyPrice", parseFloat(e.target.value))}
                            data-testid={`input-plan-yearly-${plan.id}`}
                          />
                        </div>
                      </div>
                    )}

                    {paymentGateway?.razorpayEnabled && (
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label>Monthly Price (INR - Razorpay)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={formData.razorpayMonthlyPrice ?? 0}
                            onChange={(e) => updateField(plan.id, "razorpayMonthlyPrice", parseFloat(e.target.value))}
                            data-testid={`input-plan-monthly-inr-${plan.id}`}
                          />
                        </div>
                        <div>
                          <Label>Yearly Price (INR - Razorpay)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={formData.razorpayYearlyPrice ?? 0}
                            onChange={(e) => updateField(plan.id, "razorpayYearlyPrice", parseFloat(e.target.value))}
                            data-testid={`input-plan-yearly-inr-${plan.id}`}
                          />
                        </div>
                      </div>
                    )}

                    {paymentGateway?.paypalEnabled && (
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label>Monthly Price ({paypalCurrency} - PayPal)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={formData.paypalMonthlyPrice ?? 0}
                            onChange={(e) => updateField(plan.id, "paypalMonthlyPrice", parseFloat(e.target.value))}
                            data-testid={`input-plan-monthly-paypal-${plan.id}`}
                          />
                        </div>
                        <div>
                          <Label>Yearly Price ({paypalCurrency} - PayPal)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={formData.paypalYearlyPrice ?? 0}
                            onChange={(e) => updateField(plan.id, "paypalYearlyPrice", parseFloat(e.target.value))}
                            data-testid={`input-plan-yearly-paypal-${plan.id}`}
                          />
                        </div>
                      </div>
                    )}

                    {paymentGateway?.paystackEnabled && (
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label>Monthly Price ({paystackCurrency} - Paystack)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={formData.paystackMonthlyPrice ?? 0}
                            onChange={(e) => updateField(plan.id, "paystackMonthlyPrice", parseFloat(e.target.value))}
                            data-testid={`input-plan-monthly-paystack-${plan.id}`}
                          />
                        </div>
                        <div>
                          <Label>Yearly Price ({paystackCurrency} - Paystack)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={formData.paystackYearlyPrice ?? 0}
                            onChange={(e) => updateField(plan.id, "paystackYearlyPrice", parseFloat(e.target.value))}
                            data-testid={`input-plan-yearly-paystack-${plan.id}`}
                          />
                        </div>
                      </div>
                    )}

                    {paymentGateway?.mercadopagoEnabled && (
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label>Monthly Price ({mercadopagoCurrency} - MercadoPago)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={formData.mercadopagoMonthlyPrice ?? 0}
                            onChange={(e) => updateField(plan.id, "mercadopagoMonthlyPrice", parseFloat(e.target.value))}
                            data-testid={`input-plan-monthly-mercadopago-${plan.id}`}
                          />
                        </div>
                        <div>
                          <Label>Yearly Price ({mercadopagoCurrency} - MercadoPago)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={formData.mercadopagoYearlyPrice ?? 0}
                            onChange={(e) => updateField(plan.id, "mercadopagoYearlyPrice", parseFloat(e.target.value))}
                            data-testid={`input-plan-yearly-mercadopago-${plan.id}`}
                          />
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="flex items-center">
                          <Label>{t("admin.plans.maxAgents")}</Label>
                          <InfoTooltip content="Use -1 for unlimited" />
                        </div>
                        <Input
                          type="number"
                          value={formData.maxAgents}
                          onChange={(e) => updateField(plan.id, "maxAgents", parseInt(e.target.value, 10))}
                          data-testid={`input-plan-agents-${plan.id}`}
                        />
                      </div>
                      <div>
                        <div className="flex items-center">
                          <Label>{t("admin.plans.maxCampaigns")}</Label>
                          <InfoTooltip content="Use -1 for unlimited" />
                        </div>
                        <Input
                          type="number"
                          value={formData.maxCampaigns}
                          onChange={(e) => updateField(plan.id, "maxCampaigns", parseInt(e.target.value, 10))}
                          data-testid={`input-plan-campaigns-${plan.id}`}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="flex items-center">
                          <Label>{t("admin.plans.maxContactsPerCampaign")}</Label>
                          <InfoTooltip content="Use -1 for unlimited" />
                        </div>
                        <Input
                          type="number"
                          value={formData.maxContactsPerCampaign}
                          onChange={(e) => updateField(plan.id, "maxContactsPerCampaign", parseInt(e.target.value, 10))}
                          data-testid={`input-plan-contacts-${plan.id}`}
                        />
                      </div>
                      <div>
                        <div className="flex items-center">
                          <Label>{t("admin.plans.includedCredits")}</Label>
                          <InfoTooltip content="Credits included with plan (0 for none)" />
                        </div>
                        <Input
                          type="number"
                          value={formData.includedCredits}
                          onChange={(e) => updateField(plan.id, "includedCredits", parseInt(e.target.value, 10))}
                          data-testid={`input-plan-credits-${plan.id}`}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-4">
                      <div>
                        <div className="flex items-center">
                          <Label>{t("admin.plans.maxWebhooks", "Max Webhooks")}</Label>
                          <InfoTooltip content="Use -1 for unlimited" />
                        </div>
                        <Input
                          type="number"
                          value={formData.maxWebhooks ?? 3}
                          onChange={(e) => updateField(plan.id, "maxWebhooks", parseInt(e.target.value, 10))}
                          data-testid={`input-plan-webhooks-${plan.id}`}
                        />
                      </div>
                      <div>
                        <div className="flex items-center">
                          <Label>{t("admin.plans.maxKnowledgeBases", "Max KBs")}</Label>
                          <InfoTooltip content="Use -1 for unlimited" />
                        </div>
                        <Input
                          type="number"
                          value={formData.maxKnowledgeBases ?? 5}
                          onChange={(e) => updateField(plan.id, "maxKnowledgeBases", parseInt(e.target.value, 10))}
                          data-testid={`input-plan-kbs-${plan.id}`}
                        />
                      </div>
                      <div>
                        <div className="flex items-center">
                          <Label>{t("admin.plans.maxFlows", "Max Flows")}</Label>
                          <InfoTooltip content="Use -1 for unlimited" />
                        </div>
                        <Input
                          type="number"
                          value={formData.maxFlows ?? 3}
                          onChange={(e) => updateField(plan.id, "maxFlows", parseInt(e.target.value, 10))}
                          data-testid={`input-plan-flows-${plan.id}`}
                        />
                      </div>
                      <div>
                        <div className="flex items-center">
                          <Label>{t("admin.plans.maxPhoneNumbers", "Max Phone #s")}</Label>
                          <InfoTooltip content="Use -1 for unlimited" />
                        </div>
                        <Input
                          type="number"
                          value={formData.maxPhoneNumbers ?? 1}
                          onChange={(e) => updateField(plan.id, "maxPhoneNumbers", parseInt(e.target.value, 10))}
                          data-testid={`input-plan-phones-${plan.id}`}
                        />
                      </div>
                      <div>
                        <div className="flex items-center">
                          <Label>{t("admin.plans.maxWidgets", "Max Widgets")}</Label>
                          <InfoTooltip content="Use -1 for unlimited" />
                        </div>
                        <Input
                          type="number"
                          value={formData.maxWidgets ?? 1}
                          onChange={(e) => updateField(plan.id, "maxWidgets", parseInt(e.target.value, 10))}
                          data-testid={`input-plan-widgets-${plan.id}`}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>{t("admin.plans.canChooseLlm")}</Label>
                        <Switch
                          checked={formData.canChooseLlm}
                          onCheckedChange={(checked) => updateField(plan.id, "canChooseLlm", checked)}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label>{t("admin.plans.canPurchaseNumbers")}</Label>
                        <Switch
                          checked={formData.canPurchaseNumbers}
                          onCheckedChange={(checked) => updateField(plan.id, "canPurchaseNumbers", checked)}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label>{t("admin.plans.useSystemPool")}</Label>
                        <Switch
                          checked={formData.useSystemPool}
                          onCheckedChange={(checked) => updateField(plan.id, "useSystemPool", checked)}
                        />
                      </div>
                      {sipPluginInstalled && (
                        <div className="flex items-center justify-between">
                          <Label>SIP Trunk Access</Label>
                          <Switch
                            checked={formData.sipEnabled}
                            onCheckedChange={(checked) => updateField(plan.id, "sipEnabled", checked)}
                          />
                        </div>
                      )}
                      {sipPluginInstalled && formData.sipEnabled && (
                        <div className="flex items-center justify-between">
                          <Label>Max Concurrent SIP Calls</Label>
                          <Input
                            type="number"
                            min={1}
                            value={formData.maxConcurrentSipCalls ?? plan.maxConcurrentSipCalls ?? 1}
                            onChange={(e) => updateField(plan.id, "maxConcurrentSipCalls", parseInt(e.target.value, 10) || 1)}
                            className="w-24 text-right"
                            data-testid={`input-plan-max-concurrent-sip-${plan.id}`}
                          />
                        </div>
                      )}
                      {restApiPluginInstalled && (
                        <div className="flex items-center justify-between">
                          <Label>REST API Access</Label>
                          <Switch
                            checked={formData.restApiEnabled}
                            onCheckedChange={(checked) => updateField(plan.id, "restApiEnabled", checked)}
                          />
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <Button 
                        onClick={() => handleSave(plan.id)} 
                        disabled={updatePlan.isPending}
                        data-testid={`button-save-plan-${plan.id}`}
                      >
                        {updatePlan.isPending ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            {t("common.saving")}
                          </>
                        ) : (
                          t("common.saveChanges")
                        )}
                      </Button>
                      <Button 
                        variant="outline" 
                        onClick={handleCancel}
                        disabled={updatePlan.isPending}
                      >
                        {t("common.cancel")}
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-2 text-sm">
                      {paymentGateway?.stripeEnabled && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Pricing ({stripeCurrency} - Stripe)</span>
                          <span>{stripeCurrencySymbol}{plan.monthlyPrice}{t("admin.plans.perMonth")} {t("admin.plans.or")} {stripeCurrencySymbol}{plan.yearlyPrice}{t("admin.plans.perYear")}</span>
                        </div>
                      )}
                      {paymentGateway?.razorpayEnabled && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Pricing (INR - Razorpay)</span>
                          <span>₹{plan.razorpayMonthlyPrice ?? 0}{t("admin.plans.perMonth")} {t("admin.plans.or")} ₹{plan.razorpayYearlyPrice ?? 0}{t("admin.plans.perYear")}</span>
                        </div>
                      )}
                      {paymentGateway?.paypalEnabled && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Pricing ({paypalCurrency} - PayPal)</span>
                          <span>{paypalCurrencySymbol}{plan.paypalMonthlyPrice ?? 0}{t("admin.plans.perMonth")} {t("admin.plans.or")} {paypalCurrencySymbol}{plan.paypalYearlyPrice ?? 0}{t("admin.plans.perYear")}</span>
                        </div>
                      )}
                      {paymentGateway?.paystackEnabled && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Pricing ({paystackCurrency} - Paystack)</span>
                          <span>{paystackCurrencySymbol}{plan.paystackMonthlyPrice ?? 0}{t("admin.plans.perMonth")} {t("admin.plans.or")} {paystackCurrencySymbol}{plan.paystackYearlyPrice ?? 0}{t("admin.plans.perYear")}</span>
                        </div>
                      )}
                      {paymentGateway?.mercadopagoEnabled && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Pricing ({mercadopagoCurrency} - MercadoPago)</span>
                          <span>{mercadopagoCurrencySymbol}{plan.mercadopagoMonthlyPrice ?? 0}{t("admin.plans.perMonth")} {t("admin.plans.or")} {mercadopagoCurrencySymbol}{plan.mercadopagoYearlyPrice ?? 0}{t("admin.plans.perYear")}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t("admin.plans.maxAgents")}:</span>
                        <span>{plan.maxAgents === 999 ? t("admin.plans.unlimited") : plan.maxAgents}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t("admin.plans.maxCampaigns")}:</span>
                        <span>{plan.maxCampaigns === 999 ? t("admin.plans.unlimited") : plan.maxCampaigns}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t("admin.plans.maxContacts")}:</span>
                        <span>{plan.maxContactsPerCampaign === 999999 ? t("admin.plans.unlimited") : plan.maxContactsPerCampaign}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t("admin.plans.maxWebhooks", "Max Webhooks")}:</span>
                        <span>{plan.maxWebhooks === 999 ? t("admin.plans.unlimited") : (plan.maxWebhooks ?? 3)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t("admin.plans.maxKnowledgeBases", "Max KBs")}:</span>
                        <span>{plan.maxKnowledgeBases === 999 ? t("admin.plans.unlimited") : (plan.maxKnowledgeBases ?? 5)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t("admin.plans.maxFlows", "Max Flows")}:</span>
                        <span>{plan.maxFlows === 999 ? t("admin.plans.unlimited") : (plan.maxFlows ?? 3)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t("admin.plans.maxPhoneNumbers", "Max Phone #s")}:</span>
                        <span>{plan.maxPhoneNumbers === 999 ? t("admin.plans.unlimited") : (plan.maxPhoneNumbers ?? 1)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t("admin.plans.maxWidgets", "Max Widgets")}:</span>
                        <span>{plan.maxWidgets === 999 ? t("admin.plans.unlimited") : (plan.maxWidgets ?? 1)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t("admin.plans.includedCredits")}:</span>
                        <span>{plan.includedCredits}</span>
                      </div>
                    </div>

                    {/* Gateway Sync Buttons */}
                    <div className="flex flex-wrap gap-2 pt-2 border-t">
                      {paymentGateway?.stripeEnabled && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => syncToStripe.mutate(plan.id)}
                          disabled={syncToStripe.isPending || parseFloat(plan.monthlyPrice?.toString() || '0') === 0}
                          data-testid={`button-sync-stripe-${plan.id}`}
                        >
                          {syncToStripe.isPending ? (
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3 w-3 mr-1" />
                          )}
                          Stripe
                        </Button>
                      )}
                      {paymentGateway?.razorpayEnabled && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => syncToRazorpay.mutate(plan.id)}
                          disabled={syncToRazorpay.isPending || !plan.razorpayMonthlyPrice || parseFloat(plan.razorpayMonthlyPrice?.toString() || '0') === 0}
                          data-testid={`button-sync-razorpay-${plan.id}`}
                        >
                          {syncToRazorpay.isPending ? (
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3 w-3 mr-1" />
                          )}
                          Razorpay
                        </Button>
                      )}
                      {paymentGateway?.paypalEnabled && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => syncToPayPal.mutate(plan.id)}
                          disabled={syncToPayPal.isPending || !plan.paypalMonthlyPrice || parseFloat(plan.paypalMonthlyPrice?.toString() || '0') === 0}
                          data-testid={`button-sync-paypal-${plan.id}`}
                        >
                          {syncToPayPal.isPending ? (
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3 w-3 mr-1" />
                          )}
                          PayPal
                        </Button>
                      )}
                      {paymentGateway?.paystackEnabled && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => syncToPaystack.mutate(plan.id)}
                          disabled={syncToPaystack.isPending || !plan.paystackMonthlyPrice || parseFloat(plan.paystackMonthlyPrice?.toString() || '0') === 0}
                          data-testid={`button-sync-paystack-${plan.id}`}
                        >
                          {syncToPaystack.isPending ? (
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3 w-3 mr-1" />
                          )}
                          Paystack
                        </Button>
                      )}
                      {paymentGateway?.mercadopagoEnabled && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => syncToMercadoPago.mutate(plan.id)}
                          disabled={syncToMercadoPago.isPending || !plan.mercadopagoMonthlyPrice || parseFloat(plan.mercadopagoMonthlyPrice?.toString() || '0') === 0}
                          data-testid={`button-sync-mercadopago-${plan.id}`}
                        >
                          {syncToMercadoPago.isPending ? (
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3 w-3 mr-1" />
                          )}
                          MercadoPago
                        </Button>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <Button 
                        onClick={() => handleEdit(plan)}
                        data-testid={`button-edit-plan-${plan.id}`}
                        variant="outline"
                        className="flex-1"
                      >
                        {t("admin.plans.editPlan")}
                      </Button>
                      <Button 
                        onClick={() => setDeletingPlan(plan)}
                        data-testid={`button-delete-plan-${plan.id}`}
                        variant="destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <AlertDialog open={!!deletingPlan} onOpenChange={(open) => !open && setDeletingPlan(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.plans.deletePlan")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.plans.deletePlanConfirm", { name: deletingPlan?.displayName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletePlan.isPending}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingPlan && deletePlan.mutate(deletingPlan.id)}
              disabled={deletePlan.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletePlan.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t("common.deleting")}
                </>
              ) : (
                t("admin.plans.deletePlan")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Migration Dialog - shown when trying to delete a plan with active users */}
      <AlertDialog open={!!migrationState} onOpenChange={(open) => !open && setMigrationState(null)}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              {t("admin.plans.migrationRequired")}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4">
                <p>
                  {t("admin.plans.migrationRequiredDesc", { 
                    count: migrationState?.userCount || 0, 
                    plan: migrationState?.plan?.displayName 
                  })}
                </p>
                
                {/* Check if there are other plans available */}
                {plans && plans.filter(p => p.id !== migrationState?.plan?.id).length > 0 ? (
                  <div className="space-y-2">
                    <Label>{t("admin.plans.selectTargetPlan")}</Label>
                    <Select
                      value={migrationState?.targetPlanId || ''}
                      onValueChange={(value) => setMigrationState(prev => prev ? { ...prev, targetPlanId: value } : null)}
                    >
                      <SelectTrigger data-testid="select-migration-target">
                        <SelectValue placeholder={t("admin.plans.selectPlan")} />
                      </SelectTrigger>
                      <SelectContent>
                        {plans
                          .filter(p => p.id !== migrationState?.plan?.id)
                          .map(p => (
                            <SelectItem key={p.id} value={p.id} data-testid={`option-plan-${p.id}`}>
                              {p.displayName} (${Number(p.monthlyPrice).toFixed(2)}/mo)
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/20">
                    <p className="text-sm text-amber-600 dark:text-amber-400">
                      {t("admin.plans.noOtherPlansAvailable")}
                    </p>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={migrateUsers.isPending || deletePlan.isPending}>
              {t("common.cancel")}
            </AlertDialogCancel>
            {plans && plans.filter(p => p.id !== migrationState?.plan?.id).length > 0 && (
              <Button
                onClick={() => {
                  if (migrationState && migrationState.targetPlanId) {
                    migrateUsers.mutate({
                      planId: migrationState.plan.id,
                      targetPlanId: migrationState.targetPlanId
                    });
                  }
                }}
                disabled={!migrationState?.targetPlanId || migrateUsers.isPending || deletePlan.isPending}
                data-testid="button-migrate-and-delete"
              >
                {migrateUsers.isPending || deletePlan.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {t("admin.plans.migratingUsers")}
                  </>
                ) : (
                  t("admin.plans.migrateAndDelete")
                )}
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
