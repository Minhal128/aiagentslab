/**
 * ============================================================
 * PricingPage - Multi-Currency Pricing with Free/Pro Tiers
 * Fetches prices from admin-configured plans
 * ============================================================
 */
import { useState } from "react";
import { motion } from "framer-motion";
import { Check, ArrowRight, Loader2, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/landing/Navbar";
import { Footer } from "@/components/landing/Footer";
import { SEOHead } from "@/components/landing/SEOHead";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useBranding } from "@/components/BrandingProvider";
import { useSeoSettings } from "@/hooks/useSeoSettings";
import { useTranslation } from "react-i18next";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface Plan {
  id: string;
  name: string;
  displayName: string;
  monthlyPrice: string | null;
  yearlyPrice: string | null;
  razorpayMonthlyPrice: string | null;
  razorpayYearlyPrice: string | null;
  paypalMonthlyPrice: string | null;
  paypalYearlyPrice: string | null;
  paystackMonthlyPrice: string | null;
  paystackYearlyPrice: string | null;
  mercadopagoMonthlyPrice: string | null;
  mercadopagoYearlyPrice: string | null;
  maxAgents: number;
  maxCampaigns: number;
  maxContactsPerCampaign: number;
  maxContacts: number;
  maxMinutesPerMonth: number;
  maxKnowledgeBases: number;
  maxWebhooks: number;
  maxPhoneNumbers: number;
  maxFlows: number;
  maxWidgets?: number;
  includedCredits: number;
  canPurchaseNumbers: boolean;
  canChooseLlm: boolean;
  sipEnabled?: boolean;
  restApiEnabled?: boolean;
}

interface PluginCapabilities {
  success: boolean;
  data: {
    capabilities: Record<string, boolean>;
    sipEngine: boolean;
    restApi: boolean;
  };
}

interface PaymentGatewayConfig {
  stripeEnabled: boolean;
  stripeCurrency: string;
  stripeCurrencySymbol: string;
  razorpayEnabled: boolean;
  paypalEnabled: boolean;
  paypalCurrency: string;
  paypalCurrencySymbol: string;
  paystackEnabled: boolean;
  paystackCurrency: string;
  paystackCurrencySymbol: string;
  paystackDefaultCurrency: string;
  mercadopagoEnabled: boolean;
  mercadopagoCurrency: string;
  mercadopagoCurrencySymbol: string;
}

const currencySymbols: Record<string, string> = {
  'USD': '$', 'EUR': '€', 'GBP': '£', 'CAD': 'C$', 'AUD': 'A$',
  'JPY': '¥', 'INR': '₹', 'BRL': 'R$', 'MXN': '$', 'CHF': 'CHF',
  'NGN': '₦', 'GHS': '₵', 'ZAR': 'R', 'KES': 'KSh',
  'ARS': '$', 'CLP': '$', 'COP': '$', 'PEN': 'S/', 'UYU': '$'
};

interface CurrencyOption {
  code: string;
  symbol: string;
  gateway: string;
}

interface PlanFeature {
  text: string;
  isUnlimited?: boolean;
  isCredits?: boolean;
}

type TFunc = (key: string, options?: Record<string, unknown>) => string;

function getPlanFeatures(
  plan: Plan, 
  pluginStatus: { sipPluginEnabled: boolean; restApiPluginEnabled: boolean },
  t: TFunc
): PlanFeature[] {
  const features: PlanFeature[] = [];
  const isFree = plan.name === 'free';
  const maxWidgets = plan.maxWidgets ?? 1;

  // Minutes per month
  if (plan.maxMinutesPerMonth >= 999999 || plan.maxMinutesPerMonth === -1) {
    features.push({ text: t('landing.pricingPage.features.unlimitedMinutes'), isUnlimited: true });
  } else if (plan.maxMinutesPerMonth > 0) {
    features.push({ text: t('landing.pricingPage.features.minutesPerMonth', { count: plan.maxMinutesPerMonth }) });
  }

  // AI Agents
  if (plan.maxAgents >= 999 || plan.maxAgents === -1) {
    features.push({ text: t('landing.pricingPage.features.unlimitedAgents'), isUnlimited: true });
  } else {
    features.push({ text: plan.maxAgents > 1 
      ? t('landing.pricingPage.features.aiAgents', { count: plan.maxAgents })
      : t('landing.pricingPage.features.aiAgent', { count: plan.maxAgents })
    });
  }

  // Campaigns
  if (plan.maxCampaigns >= 999 || plan.maxCampaigns === -1) {
    features.push({ text: t('landing.pricingPage.comparison.unlimited') + ' ' + t('landing.pricingPage.comparison.campaigns', { defaultValue: 'Campaigns' }), isUnlimited: true });
  } else if (plan.maxCampaigns > 0) {
    features.push({ text: `${plan.maxCampaigns} ${plan.maxCampaigns > 1 ? t('landing.pricingPage.comparison.campaigns', { defaultValue: 'Campaigns' }) : t('landing.pricingPage.comparison.campaign', { defaultValue: 'Campaign' })}` });
  }

  // Contacts per campaign
  if (plan.maxContactsPerCampaign >= 9999 || plan.maxContactsPerCampaign === -1) {
    features.push({ text: t('landing.pricingPage.comparison.unlimited') + ' ' + t('landing.pricingPage.comparison.contacts', { defaultValue: 'Contacts' }), isUnlimited: true });
  } else if (plan.maxContactsPerCampaign > 0) {
    features.push({ text: t('landing.pricingPage.features.maxContacts', { count: plan.maxContactsPerCampaign, defaultValue: `Max ${plan.maxContactsPerCampaign} contacts` }) });
  }

  // Phone number access
  if (plan.canPurchaseNumbers) {
    features.push({ text: t('landing.pricingPage.features.ownPhoneNumbers', { defaultValue: 'Own phone numbers' }) });
  } else {
    features.push({ text: t('landing.pricingPage.features.systemAssignedPhone', { defaultValue: 'System-assigned phone number' }) });
  }

  // LLM choice
  if (plan.canChooseLlm) {
    features.push({ text: t('landing.pricingPage.features.chooseLlm', { defaultValue: 'Choose your LLM' }) });
  }

  // Flow automations
  if (plan.maxFlows !== undefined && plan.maxFlows > 0) {
    if (plan.maxFlows >= 999) {
      features.push({ text: t('landing.pricingPage.comparison.unlimited') + ' ' + t('landing.pricingPage.features.flowBuilder'), isUnlimited: true });
    } else {
      features.push({ text: `${plan.maxFlows} ${t('landing.pricingPage.features.flowBuilder')}` });
    }
  }

  // Knowledge bases
  if (plan.maxKnowledgeBases !== undefined && plan.maxKnowledgeBases > 0) {
    if (plan.maxKnowledgeBases >= 999) {
      features.push({ text: t('landing.pricingPage.comparison.unlimited') + ' ' + t('landing.pricingPage.comparison.knowledgeBase'), isUnlimited: true });
    } else {
      features.push({ text: t('landing.pricingPage.comparison.documents', { count: plan.maxKnowledgeBases }) });
    }
  }

  // Webhooks
  if (plan.maxWebhooks !== undefined && plan.maxWebhooks > 0) {
    if (plan.maxWebhooks >= 999) {
      features.push({ text: t('landing.pricingPage.comparison.unlimited') + ' ' + t('landing.pricingPage.comparison.webhookIntegrations'), isUnlimited: true });
    } else {
      features.push({ text: `${plan.maxWebhooks} ${t('landing.pricingPage.comparison.webhookIntegrations')}` });
    }
  }

  // Phone numbers
  if (plan.maxPhoneNumbers !== undefined && plan.maxPhoneNumbers > 0) {
    if (plan.maxPhoneNumbers >= 999) {
      features.push({ text: t('landing.pricingPage.comparison.unlimited') + ' ' + t('landing.pricingPage.comparison.phoneNumbers'), isUnlimited: true });
    } else {
      features.push({ text: `${plan.maxPhoneNumbers} ${t('landing.pricingPage.comparison.phoneNumbers')}` });
    }
  }

  // Website widgets
  if (maxWidgets > 0) {
    if (maxWidgets >= 999) {
      features.push({ text: t('landing.pricingPage.features.unlimitedWidgets', { defaultValue: 'Unlimited Website Widgets' }), isUnlimited: true });
    } else {
      features.push({ text: `${maxWidgets} ${t('landing.pricingPage.features.websiteWidget', { defaultValue: maxWidgets !== 1 ? 'Website Widgets' : 'Website Widget' })}` });
    }
  }

  // Included credits
  if (plan.includedCredits > 0) {
    features.push({ text: t('landing.pricingPage.features.includedCredits', { count: plan.includedCredits, defaultValue: `${plan.includedCredits} Included Credits` }), isCredits: true });
  }

  // Priority support (paid plans only)
  if (!isFree) {
    features.push({ text: t('landing.pricingPage.features.prioritySupport') });
  }

  // SIP Trunk Access (plugin-enabled and plan-enabled)
  if (pluginStatus.sipPluginEnabled && plan.sipEnabled && !isFree) {
    features.push({ text: t('landing.pricingPage.features.sipTrunkAccess', { defaultValue: 'SIP Trunk Access' }) });
  }

  // REST API Access (plugin-enabled and plan-enabled)
  if (pluginStatus.restApiPluginEnabled && plan.restApiEnabled && !isFree) {
    features.push({ text: t('landing.pricingPage.features.apiAccess') });
  }

  return features;
}

function getComparisonData(
  plans: Plan[], 
  pluginStatus: { sipPluginEnabled: boolean; restApiPluginEnabled: boolean },
  t: TFunc
): { name: string; values: Record<string, string> }[] {
  const unlimited = t('landing.pricingPage.comparison.unlimited');
  const included = t('landing.pricingPage.comparison.included');
  const notAvailable = '-';
  
  const comparison: { name: string; values: Record<string, string> }[] = [];

  const formatMinutes = (minutes: number | undefined): string => {
    if (minutes === undefined) return notAvailable;
    if (minutes >= 999999 || minutes === -1) return unlimited;
    return `${minutes}/${t('landing.pricingPage.comparison.month', { defaultValue: 'month' })}`;
  };

  const formatLimit = (value: number | undefined, unlimitedThreshold = 999): string => {
    if (value === undefined || value === 0) return notAvailable;
    if (value >= unlimitedThreshold || value === -1) return unlimited;
    return `${value}`;
  };

  const formatBoolean = (value: boolean | undefined): string => {
    return value ? t('landing.pricingPage.comparison.yes', { defaultValue: 'Yes' }) : notAvailable;
  };

  const buildRow = (name: string, getter: (plan: Plan) => string): { name: string; values: Record<string, string> } => {
    const values: Record<string, string> = {};
    plans.forEach(plan => {
      values[plan.name] = getter(plan);
    });
    return { name, values };
  };

  // Call minutes
  comparison.push(buildRow(
    t('landing.pricingPage.comparison.callMinutes'),
    (plan) => formatMinutes(plan.maxMinutesPerMonth)
  ));

  // AI Agents
  comparison.push(buildRow(
    t('landing.pricingPage.comparison.aiAgents'),
    (plan) => formatLimit(plan.maxAgents)
  ));

  // Campaigns
  comparison.push(buildRow(
    t('landing.pricingPage.comparison.campaigns', { defaultValue: 'Campaigns' }),
    (plan) => formatLimit(plan.maxCampaigns)
  ));

  // Contacts per campaign
  comparison.push(buildRow(
    t('landing.pricingPage.comparison.contactsPerCampaign', { defaultValue: 'Contacts per Campaign' }),
    (plan) => formatLimit(plan.maxContactsPerCampaign, 9999)
  ));

  // Phone numbers
  comparison.push(buildRow(
    t('landing.pricingPage.comparison.phoneNumbers'),
    (plan) => plan.canPurchaseNumbers ? formatLimit(plan.maxPhoneNumbers) : t('landing.pricingPage.features.systemAssignedPhone', { defaultValue: 'System-assigned' })
  ));

  // Flow automations - only show if any plan has flows
  if (plans.some(p => (p.maxFlows ?? 0) > 0)) {
    comparison.push(buildRow(
      t('landing.pricingPage.features.flowBuilder'),
      (plan) => formatLimit(plan.maxFlows ?? 0)
    ));
  }

  // Knowledge bases - only show if any plan has them
  if (plans.some(p => (p.maxKnowledgeBases ?? 0) > 0)) {
    comparison.push(buildRow(
      t('landing.pricingPage.comparison.knowledgeBase'),
      (plan) => formatLimit(plan.maxKnowledgeBases ?? 0)
    ));
  }

  // Webhooks - only show if any plan has them
  if (plans.some(p => (p.maxWebhooks ?? 0) > 0)) {
    comparison.push(buildRow(
      t('landing.pricingPage.comparison.webhookIntegrations'),
      (plan) => formatLimit(plan.maxWebhooks ?? 0)
    ));
  }

  // Website widgets - only show if any plan has them
  if (plans.some(p => (p.maxWidgets ?? 1) > 0)) {
    comparison.push(buildRow(
      t('landing.pricingPage.features.websiteWidget', { defaultValue: 'Website Widgets' }),
      (plan) => formatLimit(plan.maxWidgets ?? 1)
    ));
  }

  // Included credits - only show if any plan has them
  if (plans.some(p => (p.includedCredits ?? 0) > 0)) {
    comparison.push(buildRow(
      t('landing.pricingPage.features.includedCredits', { defaultValue: 'Included Credits' }),
      (plan) => plan.includedCredits > 0 ? `${plan.includedCredits}` : notAvailable
    ));
  }

  // Choose LLM
  comparison.push(buildRow(
    t('landing.pricingPage.features.chooseLlm', { defaultValue: 'Choose LLM Model' }),
    (plan) => formatBoolean(plan.canChooseLlm)
  ));

  // Priority support (paid plans only)
  comparison.push(buildRow(
    t('landing.pricingPage.comparison.prioritySupport'),
    (plan) => plan.name === 'free' ? notAvailable : included
  ));

  // SIP Trunk Access (plugin-gated)
  if (pluginStatus.sipPluginEnabled && plans.some(p => p.sipEnabled)) {
    comparison.push(buildRow(
      t('landing.pricingPage.features.sipTrunkAccess', { defaultValue: 'SIP Trunk Access' }),
      (plan) => plan.sipEnabled ? included : notAvailable
    ));
  }

  // REST API Access (plugin-gated)
  if (pluginStatus.restApiPluginEnabled && plans.some(p => p.restApiEnabled)) {
    comparison.push(buildRow(
      t('landing.pricingPage.comparison.apiAccess'),
      (plan) => plan.restApiEnabled ? included : notAvailable
    ));
  }

  return comparison;
}

export default function PricingPage() {
  const { branding } = useBranding();
  const { data: seoSettings } = useSeoSettings();
  const { t } = useTranslation();
  const [selectedCurrency, setSelectedCurrency] = useState<string>('USD');
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "yearly">("monthly");
  const isYearly = billingPeriod === "yearly";

  const { data: plans, isLoading: plansLoading } = useQuery<Plan[]>({
    queryKey: ["/api/plans"],
  });

  const { data: gatewayConfig } = useQuery<PaymentGatewayConfig>({
    queryKey: ["/api/settings/payment-gateway"],
  });

  const { data: pluginCapabilities } = useQuery<PluginCapabilities>({
    queryKey: ["/api/plugins/capabilities"],
  });

  const sipPluginEnabled = pluginCapabilities?.data?.capabilities?.['sip-engine'] ?? false;
  const restApiPluginEnabled = pluginCapabilities?.data?.capabilities?.['rest-api'] ?? false;
  const pluginStatus = { sipPluginEnabled, restApiPluginEnabled };

  // Sort all plans: free first, then by monthly price ascending
  const sortedPlans = [...(plans || [])].sort((a, b) => {
    if (a.name === 'free') return -1;
    if (b.name === 'free') return 1;
    const priceA = parseFloat(a.monthlyPrice || '0');
    const priceB = parseFloat(b.monthlyPrice || '0');
    return priceA - priceB;
  });

  const hasPaidPricing = (getter: (p: Plan) => string | null | undefined) =>
    sortedPlans.some(p => {
      const v = getter(p);
      return v != null && parseFloat(v) > 0;
    });
  const hasStripePricing = hasPaidPricing(p => p.monthlyPrice) || hasPaidPricing(p => p.yearlyPrice);
  const hasRazorpayPricing = hasPaidPricing(p => p.razorpayMonthlyPrice) || hasPaidPricing(p => p.razorpayYearlyPrice);
  const hasPaypalPricing = hasPaidPricing(p => p.paypalMonthlyPrice) || hasPaidPricing(p => p.paypalYearlyPrice);
  const hasPaystackPricing = hasPaidPricing(p => p.paystackMonthlyPrice) || hasPaidPricing(p => p.paystackYearlyPrice);
  const hasMercadopagoPricing = hasPaidPricing(p => p.mercadopagoMonthlyPrice) || hasPaidPricing(p => p.mercadopagoYearlyPrice);

  const allGatewayEntries: CurrencyOption[] = [];
  if (gatewayConfig?.stripeEnabled && gatewayConfig.stripeCurrency) {
    allGatewayEntries.push({
      code: gatewayConfig.stripeCurrency.toUpperCase(),
      symbol: gatewayConfig.stripeCurrencySymbol || currencySymbols[gatewayConfig.stripeCurrency.toUpperCase()] || '$',
      gateway: 'stripe'
    });
  }
  if (gatewayConfig?.razorpayEnabled) {
    allGatewayEntries.push({ code: 'INR', symbol: '₹', gateway: 'razorpay' });
  }
  if (gatewayConfig?.paypalEnabled) {
    const paypalCurrency = (gatewayConfig.paypalCurrency || 'USD').toUpperCase();
    allGatewayEntries.push({
      code: paypalCurrency,
      symbol: gatewayConfig.paypalCurrencySymbol || currencySymbols[paypalCurrency] || '$',
      gateway: 'paypal'
    });
  }
  if (gatewayConfig?.paystackEnabled) {
    const paystackCurrency = (gatewayConfig.paystackCurrency || gatewayConfig.paystackDefaultCurrency || 'NGN').toUpperCase();
    allGatewayEntries.push({
      code: paystackCurrency,
      symbol: gatewayConfig.paystackCurrencySymbol || currencySymbols[paystackCurrency] || '₦',
      gateway: 'paystack'
    });
  }
  if (gatewayConfig?.mercadopagoEnabled) {
    const mercadopagoCurrency = (gatewayConfig.mercadopagoCurrency || 'BRL').toUpperCase();
    allGatewayEntries.push({
      code: mercadopagoCurrency,
      symbol: gatewayConfig.mercadopagoCurrencySymbol || currencySymbols[mercadopagoCurrency] || 'R$',
      gateway: 'mercadopago'
    });
  }

  const gwHasPricing: Record<string, boolean> = {
    stripe: hasStripePricing,
    razorpay: hasRazorpayPricing,
    paypal: hasPaypalPricing,
    paystack: hasPaystackPricing,
    mercadopago: hasMercadopagoPricing,
  };

  const currencyOptions: CurrencyOption[] = [];
  for (const entry of allGatewayEntries) {
    const existingIdx = currencyOptions.findIndex(c => c.code === entry.code);
    if (existingIdx === -1) {
      const otherGwSharesCurrency = allGatewayEntries.some(
        e => e.code === entry.code && e.gateway !== entry.gateway
      );
      if (gwHasPricing[entry.gateway] || otherGwSharesCurrency) {
        currencyOptions.push(entry);
      }
    } else if (gwHasPricing[entry.gateway] && !gwHasPricing[currencyOptions[existingIdx].gateway]) {
      currencyOptions[existingIdx] = entry;
    }
  }

  if (currencyOptions.length === 0) {
    currencyOptions.push({ code: 'USD', symbol: '$', gateway: 'stripe' });
  }

  const validCurrency = currencyOptions.find(c => c.code === selectedCurrency);
  const effectiveCurrency = validCurrency ? selectedCurrency : (currencyOptions[0]?.code || 'USD');
  const currencySymbol = validCurrency?.symbol || currencyOptions.find(c => c.code === effectiveCurrency)?.symbol || '$';

  const showCurrencySelector = currencyOptions.length > 1;

  const getGatewayPrice = (plan: Plan, gw: string, yearly: boolean): string | null => {
    switch (gw) {
      case 'razorpay': return yearly ? plan.razorpayYearlyPrice : plan.razorpayMonthlyPrice;
      case 'paypal': return yearly ? plan.paypalYearlyPrice : plan.paypalMonthlyPrice;
      case 'paystack': return yearly ? plan.paystackYearlyPrice : plan.paystackMonthlyPrice;
      case 'mercadopago': return yearly ? plan.mercadopagoYearlyPrice : plan.mercadopagoMonthlyPrice;
      case 'stripe': default: return yearly ? plan.yearlyPrice : plan.monthlyPrice;
    }
  };

  const getPrice = (plan: Plan): string => {
    const currencyOption = currencyOptions.find(c => c.code === effectiveCurrency);
    const primaryGateway = currencyOption?.gateway || 'stripe';

    let price = getGatewayPrice(plan, primaryGateway, isYearly);

    if (!price || parseFloat(price) === 0) {
      const alternates = allGatewayEntries.filter(
        e => e.code === effectiveCurrency && e.gateway !== primaryGateway
      );
      for (const alt of alternates) {
        const altPrice = getGatewayPrice(plan, alt.gateway, isYearly);
        if (altPrice && parseFloat(altPrice) > 0) {
          price = altPrice;
          break;
        }
      }
    }

    if ((!price || parseFloat(price) === 0) && primaryGateway !== 'stripe') {
      const stripeCurrency = gatewayConfig?.stripeCurrency?.toUpperCase();
      if (stripeCurrency === effectiveCurrency) {
        const defaultPrice = isYearly ? plan.yearlyPrice : plan.monthlyPrice;
        if (defaultPrice && parseFloat(defaultPrice) > 0) {
          price = defaultPrice;
        }
      }
    }

    return price ? parseFloat(price).toLocaleString() : '0';
  };

  const formatDisplayPrice = (plan: Plan): string => {
    const price = getPrice(plan);
    if (price === '0') return t('landing.pricingPage.plans.free');
    return `${currencySymbol}${price}`;
  };

  const comparisonFeatures = sortedPlans.length > 0 ? getComparisonData(sortedPlans, pluginStatus, t) : [];

  const faqKeys = ['trial', 'cancel', 'payment', 'discount', 'limits', 'switch'] as const;

  return (
    <div className="min-h-screen bg-background" data-testid="pricing-page">
      <SEOHead
        title={t('landing.pricingPage.seo.title')}
        description={t('landing.pricingPage.seo.description')}
        canonicalUrl={seoSettings?.canonicalBaseUrl ? `${seoSettings.canonicalBaseUrl}/pricing` : undefined}
        ogImage={seoSettings?.defaultOgImage || undefined}
        ogSiteName={branding.app_name}
        twitterSite={seoSettings?.twitterHandle || undefined}
        twitterCreator={seoSettings?.twitterHandle || undefined}
        googleVerification={seoSettings?.googleVerification || undefined}
        bingVerification={seoSettings?.bingVerification || undefined}
        facebookAppId={seoSettings?.facebookAppId || undefined}
        structuredDataOrg={seoSettings?.structuredDataOrg}
        structuredDataProduct={seoSettings?.structuredDataProduct}
      />

      <Navbar />

      <main className="pt-16">
        {/* Hero - Light/White background */}
        <section className="py-16 md:py-24 bg-background">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6 text-foreground">
                {t('landing.pricingPage.hero.title')} <span className="text-brand">{t('landing.pricingPage.hero.titleHighlight')}</span> {t('landing.pricingPage.hero.titleEnd')}
              </h1>
              <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
                {t('landing.pricingPage.hero.subtitle')}
              </p>
              
              {/* Monthly/Yearly Toggle + Currency Selector */}
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
                {/* Billing Period Toggle */}
                <div className="flex items-center bg-muted rounded-full p-1">
                  <button
                    onClick={() => setBillingPeriod("monthly")}
                    className={`px-5 py-2 rounded-full text-sm font-medium transition-all ${
                      billingPeriod === "monthly"
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    data-testid="toggle-monthly"
                  >
                    {t('landing.pricingPage.billing.monthly')}
                  </button>
                  <button
                    onClick={() => setBillingPeriod("yearly")}
                    className={`px-5 py-2 rounded-full text-sm font-medium transition-all ${
                      billingPeriod === "yearly"
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    data-testid="toggle-yearly"
                  >
                    {t('landing.pricingPage.billing.yearly')}
                  </button>
                </div>

                {/* Currency Selector Pills */}
                {showCurrencySelector && (
                  <div className="flex items-center bg-muted rounded-full p-1 flex-wrap justify-center">
                    {currencyOptions.map((c) => (
                      <button
                        key={c.code}
                        onClick={() => setSelectedCurrency(c.code)}
                        className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                          effectiveCurrency === c.code
                            ? "bg-brand text-brand-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                        data-testid={`currency-${c.code}`}
                      >
                        {c.symbol} {c.code}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {billingPeriod === "yearly" && (
                <motion.p
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-sm text-brand mb-4"
                >
                  {t('landing.pricingPage.billing.save20')}
                </motion.p>
              )}
            </motion.div>
          </div>
        </section>

        {/* Pricing Cards */}
        <section className="py-16 -mt-16">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            {plansLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className={`grid grid-cols-1 ${sortedPlans.length === 2 ? 'md:grid-cols-2' : sortedPlans.length >= 3 ? 'md:grid-cols-2 lg:grid-cols-3' : 'md:grid-cols-1'} gap-8`}>
                {sortedPlans.map((plan, index) => {
                  const isFree = plan.name === 'free';
                  // First paid plan is highlighted as "Most Popular"
                  const isHighlighted = !isFree && (sortedPlans[0]?.name === 'free' ? index === 1 : index === 0);
                  const features = getPlanFeatures(plan, pluginStatus, t);
                  const displayPrice = formatDisplayPrice(plan);
                  const numericPrice = parseFloat(getPrice(plan));
                  
                  return (
                    <motion.div
                      key={plan.id}
                      initial={{ opacity: 0, y: 30 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: index * 0.1 }}
                      className={`relative feature-card-border p-8 ${
                        isHighlighted ? 'ring-2 ring-indigo-500' : ''
                      }`}
                    >
                      {isHighlighted && (
                        <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                          <span className="px-4 py-1 bg-indigo-500 text-white text-sm font-medium rounded-full">
                            {t('landing.pricingPage.plans.mostPopular')}
                          </span>
                        </div>
                      )}
                      
                      <div className="text-center mb-8">
                        <h3 className="text-2xl font-bold mb-2">{plan.displayName || plan.name}</h3>
                        <p className="text-muted-foreground mb-4">
                          {isFree ? t('landing.pricingPage.plans.perfectForTrying') : t('landing.pricingPage.plans.forGrowingBusinesses')}
                        </p>
                        <div className="flex items-baseline justify-center gap-1">
                          <span className="text-5xl font-bold">{displayPrice}</span>
                          {numericPrice > 0 && (
                            <span className="text-muted-foreground">{isYearly ? t('landing.pricingPage.billing.perYear') : t('landing.pricingPage.billing.perMonth')}</span>
                          )}
                        </div>
                        {numericPrice > 0 && isYearly && (
                          <p className="text-xs text-brand mt-2">{t('landing.pricingPage.billing.billedAnnually')}</p>
                        )}
                      </div>

                      <ul className="space-y-3 mb-8">
                        {features.map((feature, i) => (
                          <li key={i} className="flex items-center gap-3">
                            {feature.isCredits ? (
                              <Star className="w-5 h-5 text-amber-500 shrink-0" />
                            ) : (
                              <Check className="w-5 h-5 text-green-500 shrink-0" />
                            )}
                            <span className={feature.isUnlimited || feature.isCredits ? "font-medium" : ""}>
                              {feature.text}
                            </span>
                          </li>
                        ))}
                      </ul>

                      <Link href="/login">
                        <Button 
                          className={`w-full h-12 font-medium ${
                            isHighlighted 
                              ? 'cta-button text-white border-0' 
                              : 'bg-secondary hover:bg-secondary/80'
                          }`}
                          data-testid={`button-${plan.name.toLowerCase()}-cta`}
                        >
                          {isFree ? t('landing.pricingPage.plans.startFree') : t('landing.pricingPage.plans.startProTrial')}
                        </Button>
                      </Link>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Feature Comparison Table */}
        <section className="py-16 md:py-24 section-gradient-1">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-12"
            >
              <h2 className="text-3xl md:text-4xl font-bold mb-4">{t('landing.pricingPage.comparison.title')}</h2>
              <p className="text-muted-foreground">{t('landing.pricingPage.comparison.subtitle')}</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="overflow-x-auto"
            >
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-4 px-4 font-semibold">{t('landing.pricingPage.comparison.feature')}</th>
                    {sortedPlans.map((plan, idx) => {
                      const isFree = plan.name === 'free';
                      const isHighlighted = !isFree && (sortedPlans[0]?.name === 'free' ? idx === 1 : idx === 0);
                      return (
                        <th 
                          key={plan.id} 
                          className={`text-center py-4 px-4 font-semibold ${isHighlighted ? 'text-indigo-600' : ''}`}
                        >
                          {plan.displayName || plan.name}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {comparisonFeatures.map((feature, index) => (
                    <tr key={index} className="border-b">
                      <td className="py-4 px-4">{feature.name}</td>
                      {sortedPlans.map((plan, idx) => {
                        const isFree = plan.name === 'free';
                        return (
                          <td 
                            key={plan.id} 
                            className={`text-center py-4 px-4 ${isFree ? 'text-muted-foreground' : 'font-medium'}`}
                          >
                            {feature.values[plan.name] || '-'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </motion.div>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="py-16 md:py-24">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-12"
            >
              <h2 className="text-3xl md:text-4xl font-bold mb-4">{t('landing.pricingPage.faq.title')}</h2>
              <p className="text-muted-foreground">{t('landing.pricingPage.faq.subtitle')}</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              <Accordion type="single" collapsible className="space-y-4">
                {faqKeys.map((key, index) => (
                  <AccordionItem 
                    key={index} 
                    value={`faq-${index}`}
                    className="feature-card-border px-6"
                  >
                    <AccordionTrigger className="text-left font-medium py-4" data-testid={`faq-${index}`}>
                      {t(`landing.pricingPage.faq.questions.${key}.question`)}
                    </AccordionTrigger>
                    <AccordionContent className="text-muted-foreground pb-4">
                      {t(`landing.pricingPage.faq.questions.${key}.answer`)}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </motion.div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-16 md:py-24 section-gradient-2">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              <h2 className="text-3xl md:text-4xl font-bold mb-4">
                {t('landing.pricingPage.cta.title')}
              </h2>
              <p className="text-lg text-muted-foreground mb-8">
                {t('landing.pricingPage.cta.subtitle')}
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link href="/login">
                  <Button className="cta-button text-white font-medium border-0 h-14 px-8 text-lg">
                    {t('landing.pricingPage.cta.startFreeTrial')}
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </Link>
                <Link href="/contact">
                  <Button variant="outline" className="h-14 px-8 text-lg">
                    {t('landing.pricingPage.cta.contactSales')}
                  </Button>
                </Link>
              </div>
            </motion.div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
