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
import { useState, useEffect, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Zap, Crown, Loader2, Star, CreditCard, Sparkles, ArrowRight, Globe } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useBranding } from "@/components/BrandingProvider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SiStripe, SiRazorpay, SiPaypal } from "react-icons/si";

const PaystackIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M2 4h20v3H2V4zm0 6h20v3H2v-3zm0 6h14v3H2v-3z"/>
  </svg>
);

type GatewayType = 'stripe' | 'razorpay' | 'paypal' | 'paystack' | 'mercadopago';

// Plan tier hierarchy for upgrade/downgrade comparison
const PLAN_TIER_ORDER: Record<string, number> = {
  'free': 0,
  'pro': 1,
  'enterprise': 2,
};

// Helper to determine if switching to a plan is an upgrade or downgrade
const getPlanChangeType = (currentPlanName: string, targetPlanName: string): 'upgrade' | 'downgrade' | 'same' => {
  const currentTier = PLAN_TIER_ORDER[currentPlanName.toLowerCase()] ?? 0;
  const targetTier = PLAN_TIER_ORDER[targetPlanName.toLowerCase()] ?? 1;
  
  if (targetTier > currentTier) return 'upgrade';
  if (targetTier < currentTier) return 'downgrade';
  return 'same';
};

interface CurrencyOption {
  code: string;
  symbol: string;
  name: string;
  gateways: GatewayType[];
}

interface Plan {
  id: string;
  name: string;
  displayName: string;
  description: string;
  monthlyPrice: string;
  yearlyPrice: string | null;
  razorpayMonthlyPrice: string | null;
  razorpayYearlyPrice: string | null;
  paypalMonthlyPrice: string | null;
  paypalYearlyPrice: string | null;
  paystackMonthlyPrice: string | null;
  paystackYearlyPrice: string | null;
  mercadopagoMonthlyPrice: string | null;
  mercadopagoYearlyPrice: string | null;
  stripeMonthlyPriceId: string | null;
  stripeYearlyPriceId: string | null;
  razorpayPlanId: string | null;
  razorpayYearlyPlanId: string | null;
  paypalProductId: string | null;
  paypalMonthlyPlanId: string | null;
  paypalYearlyPlanId: string | null;
  paystackMonthlyPlanCode: string | null;
  paystackYearlyPlanCode: string | null;
  mercadopagoMonthlyPlanId: string | null;
  mercadopagoYearlyPlanId: string | null;
  maxAgents: number;
  maxCampaigns: number;
  maxContactsPerCampaign: number;
  maxWebhooks: number;
  maxKnowledgeBases: number;
  maxFlows: number;
  maxPhoneNumbers: number;
  canChooseLlm: boolean;
  canPurchaseNumbers: boolean;
  includedCredits: number;
  features: any;
  sipEnabled?: boolean;
  restApiEnabled?: boolean;
}

interface PluginCapabilities {
  data?: {
    capabilities?: {
      [key: string]: boolean;
    };
  };
}

interface UserSubscription {
  id: string;
  planId: string;
  stripeSubscriptionId: string | null;
  razorpaySubscriptionId: string | null;
  paypalSubscriptionId: string | null;
  paystackSubscriptionCode: string | null;
  paystackEmailToken: string | null;
  mercadopagoSubscriptionId: string | null;
  status: string;
  billingPeriod: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  plan: Plan;
}

interface User {
  id: string;
  email: string;
  name: string;
  planType: string;
  credits: number;
}

interface PaymentGatewayConfig {
  stripeEnabled: boolean;
  razorpayEnabled: boolean;
  paypalEnabled: boolean;
  paystackEnabled: boolean;
  mercadopagoEnabled: boolean;
  razorpayKeyId?: string;
  stripeCurrency?: string;
  stripeCurrencySymbol?: string;
  paypalCurrency?: string;
  paypalCurrencySymbol?: string;
  paypalMode?: string;
  paystackCurrency?: string;
  paystackCurrencySymbol?: string;
  paystackCurrencies?: string[];
  paystackDefaultCurrency?: string;
  mercadopagoCurrency?: string;
  mercadopagoCurrencySymbol?: string;
  mercadopagoCurrencies?: string[];
}

interface RazorpayConfig {
  enabled: boolean;
  keyId: string | null;
}

declare global {
  interface Window {
    Razorpay: any;
  }
}

export function UpgradePlansContent() {
  const { toast } = useToast();
  const { branding } = useBranding();
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "yearly">("monthly");
  const [selectedCurrency, setSelectedCurrency] = useState<string>("");
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [processingGateway, setProcessingGateway] = useState<string | null>(null);
  const [razorpayLoaded, setRazorpayLoaded] = useState(false);

  const { data: user, isLoading: userLoading } = useQuery<User>({
    queryKey: ["/api/auth/me"],
  });

  const { data: plans, isLoading: plansLoading } = useQuery<Plan[]>({
    queryKey: ["/api/plans"],
  });

  const { data: subscription, isLoading: subscriptionLoading } = useQuery<UserSubscription | null>({
    queryKey: ["/api/user-subscription"],
  });

  const { data: paymentGateway } = useQuery<PaymentGatewayConfig>({
    queryKey: ["/api/settings/payment-gateway"],
  });

  const { data: razorpayConfig } = useQuery<RazorpayConfig>({
    queryKey: ["/api/razorpay/config"],
  });

  const { data: pluginCapabilities } = useQuery<PluginCapabilities>({
    queryKey: ["/api/plugins/capabilities"],
  });

  const sipPluginEnabled = pluginCapabilities?.data?.capabilities?.['sip-engine'] ?? false;
  const restApiPluginEnabled = pluginCapabilities?.data?.capabilities?.['rest-api'] ?? false;

  const [selectedGateway, setSelectedGateway] = useState<GatewayType | null>(null);

  const stripeEnabled = paymentGateway?.stripeEnabled ?? false;
  const razorpayEnabled = paymentGateway?.razorpayEnabled && razorpayConfig?.keyId;
  const paypalEnabled = paymentGateway?.paypalEnabled ?? false;
  const paystackEnabled = paymentGateway?.paystackEnabled ?? false;

  const currencySymbols: Record<string, string> = {
    'USD': '$', 'EUR': '€', 'GBP': '£', 'CAD': 'C$', 'AUD': 'A$',
    'JPY': '¥', 'INR': '₹', 'BRL': 'R$', 'MXN': '$', 'CHF': 'CHF',
    'NGN': '₦', 'GHS': '₵', 'ZAR': 'R', 'KES': 'KSh',
    'ARS': '$', 'CLP': '$', 'COP': '$', 'PEN': 'S/', 'UYU': '$'
  };

  const currencyNames: Record<string, string> = {
    'USD': 'US Dollar', 'EUR': 'Euro', 'GBP': 'British Pound', 'CAD': 'Canadian Dollar',
    'AUD': 'Australian Dollar', 'JPY': 'Japanese Yen', 'INR': 'Indian Rupee',
    'BRL': 'Brazilian Real', 'MXN': 'Mexican Peso', 'CHF': 'Swiss Franc',
    'NGN': 'Nigerian Naira', 'GHS': 'Ghanaian Cedi', 'ZAR': 'South African Rand',
    'KES': 'Kenyan Shilling', 'ARS': 'Argentine Peso', 'CLP': 'Chilean Peso',
    'COP': 'Colombian Peso', 'PEN': 'Peruvian Sol', 'UYU': 'Uruguayan Peso'
  };

  const availableCurrencies = useMemo((): CurrencyOption[] => {
    if (!paymentGateway) return [];
    
    const currencyMap = new Map<string, GatewayType[]>();
    
    if (paymentGateway.stripeEnabled && paymentGateway.stripeCurrency) {
      const curr = paymentGateway.stripeCurrency.toUpperCase();
      currencyMap.set(curr, [...(currencyMap.get(curr) || []), 'stripe']);
    }
    
    if (paymentGateway.razorpayEnabled) {
      currencyMap.set('INR', [...(currencyMap.get('INR') || []), 'razorpay']);
    }
    
    if (paymentGateway.paypalEnabled) {
      const curr = (paymentGateway.paypalCurrency || 'USD').toUpperCase();
      currencyMap.set(curr, [...(currencyMap.get(curr) || []), 'paypal']);
    }
    
    if (paymentGateway.paystackEnabled) {
      const curr = (paymentGateway.paystackCurrency || 'NGN').toUpperCase();
      currencyMap.set(curr, [...(currencyMap.get(curr) || []), 'paystack']);
    }
    
    if (paymentGateway.mercadopagoEnabled) {
      const curr = (paymentGateway.mercadopagoCurrency || 'BRL').toUpperCase();
      currencyMap.set(curr, [...(currencyMap.get(curr) || []), 'mercadopago']);
    }
    
    return Array.from(currencyMap.entries()).map(([code, gateways]) => ({
      code,
      symbol: currencySymbols[code] || code,
      name: currencyNames[code] || code,
      gateways
    }));
  }, [paymentGateway]);

  const getGatewaysForCurrency = (currencyCode: string): GatewayType[] => {
    const currency = availableCurrencies.find(c => c.code === currencyCode);
    return currency?.gateways || [];
  };

  // Returns only gateways that have valid plan IDs synced for the given plan and billing period.
  // Free plans (all gateway prices are zero, or plan.name === 'free') skip plan-ID checks
  // because they don't need subscription plan IDs at any gateway.
  const getPlanSyncedGatewaysForCurrency = (plan: Plan, currencyCode: string, period: "monthly" | "yearly"): GatewayType[] => {
    const gateways = getGatewaysForCurrency(currencyCode);
    // Treat the plan as free only when every gateway price field is zero/null.
    // Checking all fields (not just stripe) avoids misidentifying "Stripe=0, PayPal>0" plans as free.
    const allPricesZero = [
      plan.monthlyPrice, plan.yearlyPrice,
      plan.paypalMonthlyPrice, plan.paypalYearlyPrice,
      plan.razorpayMonthlyPrice, plan.razorpayYearlyPrice,
      plan.paystackMonthlyPrice, plan.paystackYearlyPrice,
      plan.mercadopagoMonthlyPrice, plan.mercadopagoYearlyPrice,
    ].every(p => !p || parseFloat(p) === 0);
    const isFreePlan = allPricesZero || plan.name === 'free';
    if (isFreePlan) return gateways;

    return gateways.filter((gateway) => {
      switch (gateway) {
        case 'stripe':
          return period === 'monthly' ? !!plan.stripeMonthlyPriceId : !!plan.stripeYearlyPriceId;
        case 'razorpay':
          return period === 'monthly' ? !!plan.razorpayPlanId : !!plan.razorpayYearlyPlanId;
        case 'paypal':
          return !!plan.paypalProductId && (period === 'monthly' ? !!plan.paypalMonthlyPlanId : !!plan.paypalYearlyPlanId);
        case 'paystack':
          return period === 'monthly' ? !!plan.paystackMonthlyPlanCode : !!plan.paystackYearlyPlanCode;
        case 'mercadopago':
          return period === 'monthly' ? !!plan.mercadopagoMonthlyPlanId : !!plan.mercadopagoYearlyPlanId;
        default:
          return false;
      }
    });
  };

  const MercadoPagoIcon = ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h-2v-6h2v6zm4 0h-2v-6h2v6z"/>
    </svg>
  );

  const getGatewayInfo = (gateway: GatewayType): { icon: React.ComponentType<{ className?: string }>; name: string } => {
    const info: Record<GatewayType, { icon: React.ComponentType<{ className?: string }>; name: string }> = {
      stripe: { icon: SiStripe, name: 'Stripe' },
      razorpay: { icon: SiRazorpay, name: 'Razorpay' },
      paypal: { icon: SiPaypal, name: 'PayPal' },
      paystack: { icon: PaystackIcon, name: 'Paystack' },
      mercadopago: { icon: MercadoPagoIcon, name: 'MercadoPago' },
    };
    return info[gateway];
  };

  useEffect(() => {
    if (!paymentGateway?.razorpayEnabled) {
      return;
    }
    
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => setRazorpayLoaded(true);
    document.body.appendChild(script);
    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, [paymentGateway?.razorpayEnabled]);

  useEffect(() => {
    if (paymentGateway) {
      if (availableCurrencies.length > 0) {
        const defaultCurrencyOption = availableCurrencies[0];
        const currencyCode = defaultCurrencyOption?.code || 'USD';
        setSelectedCurrency(currencyCode);
        
        const gateways = defaultCurrencyOption?.gateways || [];
        if (gateways.length > 0) {
          setSelectedGateway(gateways[0]);
        }
      } else {
        setSelectedCurrency('');
      }
    }
  }, [paymentGateway]);

  const stripeCheckout = useMutation({
    mutationFn: async ({ planId, billingPeriod }: { planId: string; billingPeriod: string }) => {
      const response = await apiRequest("POST", "/api/stripe/create-checkout-session", {
        type: "subscription",
        planId,
        billingPeriod,
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create checkout session");
      }
      return response.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (error: any) => {
      toast({
        title: "Checkout Failed",
        description: error.message,
        variant: "destructive",
      });
      setProcessingGateway(null);
    },
  });

  const razorpaySubscription = useMutation({
    mutationFn: async ({ planId, billingPeriod }: { planId: string; billingPeriod: string }) => {
      const response = await apiRequest("POST", "/api/razorpay/create-subscription", {
        planId,
        billingPeriod,
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create subscription");
      }
      return response.json();
    },
    onSuccess: (data) => {
      if (!window.Razorpay || !razorpayLoaded) {
        toast({
          title: "Razorpay Not Loaded",
          description: "Please wait a moment and try again",
          variant: "destructive",
        });
        setProcessingGateway(null);
        return;
      }

      const options = {
        key: razorpayConfig?.keyId || paymentGateway?.razorpayKeyId,
        subscription_id: data.subscriptionId,
        name: branding.app_name || '',
        description: `${selectedPlan?.displayName} - ${billingPeriod === "yearly" ? "Yearly" : "Monthly"}`,
        handler: async function (response: any) {
          try {
            const verifyResponse = await apiRequest("POST", "/api/razorpay/verify-subscription", {
              razorpay_subscription_id: response.razorpay_subscription_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            });

            if (verifyResponse.ok) {
              toast({
                title: "Subscription Active",
                description: "Your subscription has been activated successfully!",
              });
              window.location.href = "/app/billing?success=true";
            } else {
              const error = await verifyResponse.json();
              throw new Error(error.error || "Verification failed");
            }
          } catch (error: any) {
            toast({
              title: "Verification Failed",
              description: error.message,
              variant: "destructive",
            });
          }
          setProcessingGateway(null);
          setShowPaymentDialog(false);
        },
        modal: {
          ondismiss: function () {
            setProcessingGateway(null);
          },
        },
        prefill: {
          email: user?.email,
          name: user?.name,
        },
        theme: {
          color: "#6366f1",
        },
      };

      const rzp = new window.Razorpay(options);
      rzp.open();
    },
    onError: (error: any) => {
      toast({
        title: "Subscription Failed",
        description: error.message,
        variant: "destructive",
      });
      setProcessingGateway(null);
    },
  });

  const paypalSubscription = useMutation({
    mutationFn: async ({ planId, billingPeriod }: { planId: string; billingPeriod: string }) => {
      const response = await apiRequest("POST", "/api/paypal/create-subscription", { planId, billingPeriod });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create PayPal subscription");
      }
      return response.json();
    },
    onSuccess: (data) => {
      if (data.approvalUrl) {
        window.location.href = data.approvalUrl;
      }
    },
    onError: (error: any) => {
      toast({ title: "Subscription Failed", description: error.message, variant: "destructive" });
      setProcessingGateway(null);
    },
  });

  const paystackSubscription = useMutation({
    mutationFn: async ({ planId, billingPeriod }: { planId: string; billingPeriod: string }) => {
      const response = await apiRequest("POST", "/api/paystack/initialize-subscription", { planId, billingPeriod });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create Paystack subscription");
      }
      return response.json();
    },
    onSuccess: (data) => {
      if (data.authorizationUrl) {
        window.location.href = data.authorizationUrl;
      }
    },
    onError: (error: any) => {
      toast({ title: "Subscription Failed", description: error.message, variant: "destructive" });
      setProcessingGateway(null);
    },
  });

  const mercadopagoSubscription = useMutation({
    mutationFn: async ({ planId, billingPeriod }: { planId: string; billingPeriod: string }) => {
      const response = await apiRequest("POST", "/api/mercadopago/create-subscription", { planId, billingPeriod });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create MercadoPago subscription");
      }
      return response.json();
    },
    onSuccess: (data) => {
      if (data.initPoint) {
        window.location.href = data.initPoint;
      }
    },
    onError: (error: any) => {
      toast({ title: "Subscription Failed", description: error.message, variant: "destructive" });
      setProcessingGateway(null);
    },
  });

  const handleUpgradeClick = (plan: Plan) => {
    setSelectedPlan(plan);
    setBillingPeriod("monthly");
    if (availableCurrencies.length > 0) {
      const defaultCurrency = availableCurrencies[0];
      setSelectedCurrency(defaultCurrency.code);
      // Use per-plan synced gateways for initial selection
      const syncedGateways = getPlanSyncedGatewaysForCurrency(plan, defaultCurrency.code, "monthly");
      setSelectedGateway(syncedGateways[0] || null);
    }
    setShowPaymentDialog(true);
  };

  const handleProceedToPayment = () => {
    if (!selectedPlan || !selectedGateway) return;
    
    setProcessingGateway(selectedGateway);
    
    switch (selectedGateway) {
      case 'stripe':
        stripeCheckout.mutate({ planId: selectedPlan.id, billingPeriod });
        break;
      case 'razorpay':
        if (!razorpayLoaded) {
          toast({ title: "Payment Gateway Loading", description: "Razorpay is still loading. Please try again.", variant: "destructive" });
          setProcessingGateway(null);
          return;
        }
        razorpaySubscription.mutate({ planId: selectedPlan.id, billingPeriod });
        break;
      case 'paypal':
        paypalSubscription.mutate({ planId: selectedPlan.id, billingPeriod });
        break;
      case 'paystack':
        paystackSubscription.mutate({ planId: selectedPlan.id, billingPeriod });
        break;
      case 'mercadopago':
        mercadopagoSubscription.mutate({ planId: selectedPlan.id, billingPeriod });
        break;
    }
  };

  const getDisplayPrice = (plan: Plan, period: "monthly" | "yearly") => {
    const price = period === "yearly" ? plan.yearlyPrice : plan.monthlyPrice;
    const symbol = paymentGateway?.stripeCurrencySymbol || "$";
    return price ? `${symbol}${parseFloat(price).toFixed(2)}` : "N/A";
  };

  if (userLoading || plansLoading || subscriptionLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const currentPlanName = subscription?.plan?.name || user?.planType || "free";
  const currentPlan = subscription?.plan || plans?.find((p) => p.name === currentPlanName);

  const sortedPlans = [...(plans || [])].sort((a, b) => {
    if (a.name === "free") return -1;
    if (b.name === "free") return 1;
    return parseFloat(a.monthlyPrice) - parseFloat(b.monthlyPrice);
  });

  const isPremium = currentPlanName !== "free";
  
  const getGatewayForCurrency = (currencyCode: string): GatewayType | null => {
    const currency = availableCurrencies.find(c => c.code === currencyCode);
    if (!currency || currency.gateways.length === 0) return null;
    return currency.gateways[0];
  };

  // Return the raw gateway-specific price for a plan (mirrors PricingPage.getGatewayPrice)
  const getGatewayPrice = (plan: Plan, gw: GatewayType | null, period: "monthly" | "yearly"): string | null => {
    const yearly = period === "yearly";
    switch (gw) {
      case 'razorpay': return yearly ? plan.razorpayYearlyPrice : plan.razorpayMonthlyPrice;
      case 'paypal': return yearly ? plan.paypalYearlyPrice : plan.paypalMonthlyPrice;
      case 'paystack': return yearly ? plan.paystackYearlyPrice : plan.paystackMonthlyPrice;
      case 'mercadopago': return yearly ? plan.mercadopagoYearlyPrice : plan.mercadopagoMonthlyPrice;
      case 'stripe':
      default: return yearly ? plan.yearlyPrice : plan.monthlyPrice;
    }
  };

  // Resolve display price: primary gateway → alternates sharing same currency → Stripe same-currency fallback
  // Accepts an optional gatewayOverride so the dialog always prices for the selected gateway.
  const getPlanPrice = (plan: Plan, currencyCode: string, period: "monthly" | "yearly", gatewayOverride?: GatewayType | null): { price: string; symbol: string } => {
    const symbol = currencySymbols[currencyCode] || '$';
    const primaryGateway = gatewayOverride ?? getGatewayForCurrency(currencyCode);

    // 1. Primary gateway price
    let price = getGatewayPrice(plan, primaryGateway, period);

    // 2. Alternate gateways sharing the same currency
    if (!price || parseFloat(price) === 0) {
      const currencyGateways = availableCurrencies.find(c => c.code === currencyCode)?.gateways || [];
      for (const alt of currencyGateways) {
        if (alt === primaryGateway) continue;
        const altPrice = getGatewayPrice(plan, alt, period);
        if (altPrice && parseFloat(altPrice) > 0) {
          price = altPrice;
          break;
        }
      }
    }

    // 3. Stripe default price as final fallback — only if Stripe's currency matches selected currency
    if ((!price || parseFloat(price) === 0) && primaryGateway !== 'stripe') {
      const stripeCurrency = paymentGateway?.stripeCurrency?.toUpperCase();
      if (stripeCurrency === currencyCode) {
        const defaultPrice = period === "yearly" ? plan.yearlyPrice : plan.monthlyPrice;
        if (defaultPrice && parseFloat(defaultPrice) > 0) price = defaultPrice;
      }
    }

    return { price: price || "0", symbol };
  };

  const effectiveCurrency = selectedCurrency ||
    availableCurrencies[0]?.code ||
    'USD';
  const displaySymbol = currencySymbols[effectiveCurrency] || paymentGateway?.stripeCurrencySymbol || "$";

  return (
    <div className="space-y-8">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-50 via-slate-100/50 to-indigo-50 dark:from-slate-900/80 dark:via-slate-800/50 dark:to-indigo-950/40 border border-slate-200 dark:border-slate-700/50 p-6 md:p-8">
        <div className="absolute inset-0 bg-grid-slate-200/50 dark:bg-grid-slate-700/20 [mask-image:linear-gradient(0deg,transparent,rgba(255,255,255,0.5))]" />
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-slate-700 to-indigo-800 dark:from-slate-600 dark:to-indigo-700 flex items-center justify-center shadow-lg shadow-slate-500/25 dark:shadow-indigo-500/20">
              <Sparkles className="h-7 w-7 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl md:text-3xl font-bold text-foreground">
                  {isPremium ? "Your Plan" : "Upgrade Your Plan"}
                </h1>
                {isPremium && (
                  <Badge className="bg-indigo-600 hover:bg-indigo-700 text-white" data-testid="badge-premium-member">
                    <Crown className="h-3 w-3 mr-1" />
                    Premium
                  </Badge>
                )}
              </div>
              <p className="text-muted-foreground mt-0.5">
                {isPremium ? "Manage your subscription and billing" : "Choose the plan that fits your needs"}
              </p>
            </div>
          </div>
          
          {/* Currency Selector */}
          {availableCurrencies.length > 1 && (
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted-foreground" />
              <Select value={effectiveCurrency} onValueChange={setSelectedCurrency}>
                <SelectTrigger className="w-[140px] bg-white/80 dark:bg-slate-800/60" data-testid="select-currency">
                  <SelectValue placeholder="Currency" />
                </SelectTrigger>
                <SelectContent>
                  {availableCurrencies.map((currency) => (
                    <SelectItem key={currency.code} value={currency.code}>
                      {currency.symbol} {currency.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {availableCurrencies.length === 1 && (
            <div className="flex items-center gap-2" data-testid="badge-active-currency">
              <Globe className="h-4 w-4 text-muted-foreground" />
              <Badge variant="secondary">
                {availableCurrencies[0].symbol} {availableCurrencies[0].code}
              </Badge>
            </div>
          )}
        </div>

        {currentPlan && (
          <div className="relative mt-6 bg-white/80 dark:bg-slate-800/60 backdrop-blur-sm rounded-xl p-4 border border-slate-200/50 dark:border-slate-700/50">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-3">
                <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${currentPlan.name === "free" ? "bg-slate-100 dark:bg-slate-700" : "bg-indigo-100 dark:bg-indigo-900/50"}`}>
                  {currentPlan.name === "free" ? (
                    <Zap className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                  ) : (
                    <Crown className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                  )}
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Current: {currentPlan.displayName}</h3>
                  <p className="text-sm text-muted-foreground">{currentPlan.description}</p>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xl font-bold text-foreground">
                  {(() => {
                    if (currentPlan.name === "free") return "Free";
                    const priceInfo = getPlanPrice(currentPlan, effectiveCurrency, "monthly");
                    return `${priceInfo.symbol}${parseFloat(priceInfo.price || "0").toFixed(2)}`;
                  })()}
                </div>
                {currentPlan.name !== "free" && (
                  <p className="text-xs text-muted-foreground">per month</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className={`grid grid-cols-1 ${sortedPlans.length === 2 ? "md:grid-cols-2" : sortedPlans.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2 lg:grid-cols-3"} gap-6`}>
        {sortedPlans.map((plan, index) => {
          const isCurrentPlan = currentPlanName === plan.name;
          const isFree = plan.name === "free";
          const isRecommended = !isFree && index === 1;
          const planChangeType = getPlanChangeType(currentPlanName, plan.name);

          const monthlyPriceInfo = getPlanPrice(plan, effectiveCurrency, "monthly");
          const yearlyPriceInfo = getPlanPrice(plan, effectiveCurrency, "yearly");
          
          const monthlyPrice = `${monthlyPriceInfo.symbol}${monthlyPriceInfo.price}`;
          const yearlyPrice = yearlyPriceInfo.price !== "0" ? `${yearlyPriceInfo.symbol}${yearlyPriceInfo.price}` : null;

          const yearlySavings = monthlyPriceInfo.price && yearlyPriceInfo.price !== "0"
            ? (parseFloat(monthlyPriceInfo.price) * 12 - parseFloat(yearlyPriceInfo.price)).toFixed(0)
            : null;

          return (
            <Card
              key={plan.id}
              className={`relative overflow-hidden transition-all duration-200 ${
                isCurrentPlan 
                  ? "ring-2 ring-indigo-500 dark:ring-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/20" 
                  : isRecommended && !isCurrentPlan
                    ? "ring-2 ring-slate-300 dark:ring-slate-600"
                    : "hover:border-slate-300 dark:hover:border-slate-600"
              }`}
              data-testid={`card-plan-${plan.name}`}
            >
              {isRecommended && !isCurrentPlan && (
                <div className="absolute top-0 left-0 right-0 bg-gradient-to-r from-slate-700 to-indigo-700 text-white text-xs font-medium py-1.5 text-center">
                  <Crown className="h-3 w-3 inline mr-1" />
                  Most Popular
                </div>
              )}

              <div className={`p-6 space-y-6 ${isRecommended && !isCurrentPlan ? "pt-10" : ""}`}>
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${isFree ? "bg-slate-100 dark:bg-slate-800" : "bg-indigo-100 dark:bg-indigo-900/50"}`}>
                      {isFree ? (
                        <Zap className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                      ) : (
                        <Crown className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                      )}
                    </div>
                    <h2 className="text-xl font-bold text-foreground">{plan.displayName}</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">{plan.description}</p>
                </div>

                <div className="pb-4 border-b border-slate-100 dark:border-slate-800">
                  {isFree ? (
                    <>
                      <div className="text-3xl font-bold text-foreground">Free</div>
                      <p className="text-sm text-muted-foreground">Forever</p>
                    </>
                  ) : (
                    <>
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl font-bold text-foreground">{monthlyPrice}</span>
                        <span className="text-muted-foreground text-sm">/month</span>
                      </div>
                      {yearlyPrice && yearlySavings && (
                        <p className="text-sm text-emerald-600 dark:text-emerald-400 mt-1">
                          Save {monthlyPriceInfo.symbol}{yearlySavings}/year
                        </p>
                      )}
                    </>
                  )}
                </div>

                <div className="space-y-3">
                  {plan.maxAgents === -1 ? (
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                      <span className="text-sm font-medium">Unlimited AI Agents</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                      <span className="text-sm">{plan.maxAgents} AI Agent{plan.maxAgents > 1 ? "s" : ""}</span>
                    </div>
                  )}

                  {plan.maxCampaigns === -1 ? (
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                      <span className="text-sm font-medium">Unlimited Campaigns</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                      <span className="text-sm">{plan.maxCampaigns} Campaign{plan.maxCampaigns > 1 ? "s" : ""}</span>
                    </div>
                  )}

                  {plan.maxContactsPerCampaign === -1 ? (
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                      <span className="text-sm font-medium">Unlimited Contacts</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                      <span className="text-sm">Max {plan.maxContactsPerCampaign} contacts</span>
                    </div>
                  )}

                  {plan.canPurchaseNumbers && (
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                      <span className="text-sm">Own phone numbers</span>
                    </div>
                  )}

                  {plan.canChooseLlm && (
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                      <span className="text-sm">Choose your LLM</span>
                    </div>
                  )}

                  {plan.maxFlows !== undefined && plan.maxFlows > 0 && (
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                      <span className="text-sm">
                        {plan.maxFlows >= 999 ? "Unlimited" : plan.maxFlows} Flow Automation{plan.maxFlows !== 1 && plan.maxFlows < 999 ? "s" : ""}
                      </span>
                    </div>
                  )}

                  {plan.maxKnowledgeBases !== undefined && plan.maxKnowledgeBases > 0 && (
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                      <span className="text-sm">
                        {plan.maxKnowledgeBases >= 999 ? "Unlimited" : plan.maxKnowledgeBases} Knowledge Base{plan.maxKnowledgeBases !== 1 && plan.maxKnowledgeBases < 999 ? "s" : ""}
                      </span>
                    </div>
                  )}

                  {plan.maxWebhooks !== undefined && plan.maxWebhooks > 0 && (
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                      <span className="text-sm">
                        {plan.maxWebhooks >= 999 ? "Unlimited" : plan.maxWebhooks} Webhook{plan.maxWebhooks !== 1 && plan.maxWebhooks < 999 ? "s" : ""}
                      </span>
                    </div>
                  )}

                  {plan.maxPhoneNumbers !== undefined && plan.maxPhoneNumbers > 0 && (
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                      <span className="text-sm">
                        {plan.maxPhoneNumbers >= 999 ? "Unlimited" : plan.maxPhoneNumbers} Phone Number{plan.maxPhoneNumbers !== 1 && plan.maxPhoneNumbers < 999 ? "s" : ""}
                      </span>
                    </div>
                  )}

                  {plan.includedCredits > 0 && (
                    <div className="flex items-center gap-2">
                      <Star className="h-4 w-4 text-indigo-600 dark:text-indigo-400 flex-shrink-0" />
                      <span className="text-sm font-medium">{plan.includedCredits} included credits</span>
                    </div>
                  )}

                  {!isFree && (
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                      <span className="text-sm">Priority support</span>
                    </div>
                  )}

                  {/* SIP Trunk feature - only show if SIP Engine plugin is enabled AND plan has SIP access */}
                  {sipPluginEnabled && plan.sipEnabled && !isFree && (
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                      <span className="text-sm">SIP Trunk Access</span>
                    </div>
                  )}

                  {/* REST API feature - only show if REST API plugin is enabled AND plan has REST API access */}
                  {restApiPluginEnabled && plan.restApiEnabled && !isFree && (
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                      <span className="text-sm">REST API Access</span>
                    </div>
                  )}
                </div>

                <Button
                  variant={isCurrentPlan ? "outline" : isFree ? "outline" : "default"}
                  className={`w-full ${!isFree && !isCurrentPlan ? "bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600" : ""}`}
                  disabled={isCurrentPlan || isFree}
                  onClick={() => !isCurrentPlan && !isFree && handleUpgradeClick(plan)}
                  data-testid={`button-select-${plan.name}`}
                >
                  {isCurrentPlan ? (
                    "Current Plan"
                  ) : isFree ? (
                    "Free Tier"
                  ) : planChangeType === 'downgrade' ? (
                    <>
                      Downgrade
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </>
                  ) : (
                    <>
                      Upgrade
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </>
                  )}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="p-6 bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800">
        <div className="flex items-start gap-4">
          <div className="h-10 w-10 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center flex-shrink-0">
            <CreditCard className="h-5 w-5 text-slate-600 dark:text-slate-400" />
          </div>
          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-foreground">Credit-Based Calling</h3>
            <p className="text-sm text-muted-foreground">
              Premium plan users can purchase credits for making calls. 1 credit = 60 seconds of call time (rounded up).
              For example, a 62-second call uses 2 credits.
            </p>
          </div>
        </div>
      </Card>

      <Dialog open={showPaymentDialog && selectedPlan !== null} onOpenChange={setShowPaymentDialog}>
        <DialogContent className="sm:max-w-lg">
          {selectedPlan && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5" />
                  Subscribe to {selectedPlan.displayName}
                </DialogTitle>
                <DialogDescription>
                  Choose your currency, payment method, and billing period
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-6 py-4">
                {availableCurrencies.length > 1 && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium flex items-center gap-2">
                      <Globe className="h-4 w-4" />
                      Currency
                    </label>
                    <Select
                      value={selectedCurrency}
                      onValueChange={(v) => {
                        setSelectedCurrency(v);
                        const gateways = selectedPlan
                          ? getPlanSyncedGatewaysForCurrency(selectedPlan, v, billingPeriod)
                          : getGatewaysForCurrency(v);
                        if (gateways.length > 0 && (!selectedGateway || !gateways.includes(selectedGateway))) {
                          setSelectedGateway(gateways[0]);
                        }
                      }}
                    >
                      <SelectTrigger data-testid="select-currency">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {availableCurrencies.map((currency) => (
                          <SelectItem key={currency.code} value={currency.code}>
                            {currency.symbol} {currency.code} - {currency.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {selectedCurrency && selectedPlan && getPlanSyncedGatewaysForCurrency(selectedPlan, selectedCurrency, billingPeriod).length > 0 && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Payment Method</label>
                    <div className="grid grid-cols-2 gap-2">
                      {getPlanSyncedGatewaysForCurrency(selectedPlan, selectedCurrency, billingPeriod).map((gateway) => {
                        const info = getGatewayInfo(gateway);
                        const Icon = info.icon;
                        return (
                          <Button
                            key={gateway}
                            type="button"
                            variant={selectedGateway === gateway ? 'default' : 'outline'}
                            className={`h-14 flex flex-col items-center justify-center gap-1 relative ${
                              selectedGateway === gateway ? '' : 'hover-elevate'
                            }`}
                            onClick={() => setSelectedGateway(gateway)}
                            data-testid={`button-gateway-${gateway}`}
                          >
                            <Icon className="h-5 w-5" />
                            <span className="text-xs">{info.name}</span>
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-sm font-medium">Billing Period</label>
                  <Select value={billingPeriod} onValueChange={(v) => {
                    const newPeriod = v as "monthly" | "yearly";
                    setBillingPeriod(newPeriod);
                    // Deselect gateway if it's no longer available for the new billing period
                    if (selectedPlan && selectedCurrency && selectedGateway) {
                      const synced = getPlanSyncedGatewaysForCurrency(selectedPlan, selectedCurrency, newPeriod);
                      if (!synced.includes(selectedGateway)) {
                        setSelectedGateway(synced.length > 0 ? synced[0] : null);
                      }
                    }
                  }}>
                    <SelectTrigger data-testid="select-billing-period">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">
                        Monthly - {(() => {
                          const { price, symbol } = getPlanPrice(selectedPlan, selectedCurrency, "monthly", selectedGateway);
                          return `${symbol}${parseFloat(price).toFixed(2)}`;
                        })()}/month
                      </SelectItem>
                      {selectedPlan.yearlyPrice && (
                        <SelectItem value="yearly">
                          Yearly - {(() => {
                            const { price, symbol } = getPlanPrice(selectedPlan, selectedCurrency, "yearly", selectedGateway);
                            return `${symbol}${parseFloat(price).toFixed(2)}`;
                          })()}/year
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Total</span>
                    <span className="text-2xl font-bold">
                      {(() => {
                        const { price, symbol } = getPlanPrice(selectedPlan, selectedCurrency, billingPeriod, selectedGateway);
                        return `${symbol}${parseFloat(price).toFixed(2)}`;
                      })()}
                      <span className="text-sm font-normal text-muted-foreground">
                        /{billingPeriod === "yearly" ? "year" : "month"}
                      </span>
                    </span>
                  </div>
                  {selectedGateway && (
                    <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
                      {(() => {
                        const info = getGatewayInfo(selectedGateway);
                        const Icon = info.icon;
                        return (
                          <>
                            <div className={`rounded p-1 ${
                              selectedGateway === 'stripe' ? 'bg-[#635bff]' :
                              selectedGateway === 'razorpay' ? 'bg-[#072654]' :
                              selectedGateway === 'paypal' ? 'bg-[#003087]' :
                              selectedGateway === 'paystack' ? 'bg-[#00C3F7]' :
                              'bg-slate-600'
                            }`}>
                              <Icon className="h-3 w-3 text-white" />
                            </div>
                            <span>Secure payment via {info.name}</span>
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>

                <Button
                  className="w-full"
                  size="lg"
                  disabled={!selectedGateway || processingGateway !== null}
                  onClick={handleProceedToPayment}
                  data-testid="button-proceed-payment"
                >
                  {processingGateway ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      {selectedGateway && (() => {
                        const Icon = getGatewayInfo(selectedGateway).icon;
                        return <Icon className="h-4 w-4 mr-2" />;
                      })()}
                      Proceed to Payment
                    </>
                  )}
                </Button>

                {!selectedGateway && (
                  <p className="text-xs text-muted-foreground text-center">
                    Please select a payment method to continue.
                  </p>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function Upgrade() {
  return <UpgradePlansContent />;
}
