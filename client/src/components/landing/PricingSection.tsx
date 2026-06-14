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
import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Check, Loader2, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";

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
  maxAgents: number;
  maxCampaigns: number;
  maxContactsPerCampaign: number;
  maxWebhooks: number;
  maxKnowledgeBases: number;
  maxFlows: number;
  maxPhoneNumbers: number;
  includedCredits: number;
  canChooseLlm: boolean;
  canPurchaseNumbers: boolean;
  features: any;
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
  mercadopagoCurrencies?: string[];
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      ease: [0.25, 0.4, 0.25, 1],
    },
  },
};

// Currency symbol lookup
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

export function PricingSection() {
  const [, setLocation] = useLocation();
  const [isYearly, setIsYearly] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState<string>('USD');
  const shouldReduceMotion = useReducedMotion();
  const { t } = useTranslation();

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

  const handleNavigate = () => {
    setLocation("/login");
  };

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
  if (gatewayConfig?.paypalEnabled && gatewayConfig.paypalCurrency) {
    allGatewayEntries.push({
      code: gatewayConfig.paypalCurrency.toUpperCase(),
      symbol: gatewayConfig.paypalCurrencySymbol || currencySymbols[gatewayConfig.paypalCurrency.toUpperCase()] || '$',
      gateway: 'paypal'
    });
  }
  if (gatewayConfig?.paystackEnabled) {
    const paystackCurrency = gatewayConfig.paystackCurrency?.toUpperCase() || gatewayConfig.paystackDefaultCurrency || 'NGN';
    allGatewayEntries.push({
      code: paystackCurrency,
      symbol: gatewayConfig.paystackCurrencySymbol || currencySymbols[paystackCurrency] || '₦',
      gateway: 'paystack'
    });
  }
  if (gatewayConfig?.mercadopagoEnabled && gatewayConfig.mercadopagoCurrency) {
    const mercadopagoCurrency = gatewayConfig.mercadopagoCurrency.toUpperCase();
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

  return (
    <section
      id="pricing"
      className="py-12 sm:py-16 md:py-24 lg:py-32"
      data-testid="pricing-section"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center space-y-3 sm:space-y-4 mb-8 sm:mb-10 md:mb-12"
        >
          <h2 
            className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold text-white"
            data-testid="pricing-headline"
          >
            {t('landing.pricing.title')} <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-500 to-orange-400">{t('landing.pricing.titleHighlight')}</span> {t('landing.pricing.titleEnd')}
          </h2>
          <p 
            className="text-sm sm:text-base md:text-lg text-zinc-400"
            data-testid="pricing-subheadline"
          >
            {t('landing.pricing.description')}
          </p>
        </motion.div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-6 mb-12">
          <div className="flex items-center gap-3 bg-muted/50 rounded-full px-4 py-2">
            <span className={`text-sm font-medium transition-colors ${!isYearly ? 'text-white' : 'text-zinc-400'}`}>
              {t('landing.pricing.monthly')}
            </span>
            <Switch
              checked={isYearly}
              onCheckedChange={setIsYearly}
              data-testid="switch-billing-period"
            />
            <span className={`text-sm font-medium transition-colors ${isYearly ? 'text-white' : 'text-zinc-400'}`}>
              {t('landing.pricing.yearly')}
            </span>
            {isYearly && (
              <Badge variant="secondary" className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                {t('landing.pricing.save20')}
              </Badge>
            )}
          </div>

          {showCurrencySelector && (
            <div className="flex items-center gap-2 bg-muted/50 rounded-full px-4 py-2 flex-wrap justify-center">
              {currencyOptions.map((option) => (
                <button
                  key={option.code}
                  onClick={() => setSelectedCurrency(option.code)}
                  className={`px-3 py-1 rounded-full text-sm font-medium transition-all ${
                    effectiveCurrency === option.code 
                      ? 'bg-amber-500 text-white shadow-sm' 
                      : 'text-zinc-400 hover:text-white'
                  }`}
                  data-testid={`button-currency-${option.code.toLowerCase()}`}
                >
                  {option.symbol} {option.code}
                </button>
              ))}
            </div>
          )}
        </div>

        {plansLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <motion.div
            variants={shouldReduceMotion ? {} : containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className={`grid grid-cols-1 ${sortedPlans.length === 2 ? 'md:grid-cols-2' : sortedPlans.length >= 3 ? 'md:grid-cols-2 lg:grid-cols-3' : 'md:grid-cols-1'} gap-4 sm:gap-6 md:gap-8 max-w-6xl mx-auto`}
            data-testid="pricing-grid"
          >
            {sortedPlans.map((plan, index) => {
              const isFree = plan.name === 'free';
              // First paid plan (index 1 if free exists, or index 0 if no free plan) is highlighted
              const isHighlighted = !isFree && (sortedPlans[0]?.name === 'free' ? index === 1 : index === 0);
              const price = getPrice(plan);
              const maxWidgets = (plan as any).maxWidgets ?? 1;
              
              return (
                <motion.div
                  key={plan.id}
                  variants={shouldReduceMotion ? {} : itemVariants}
                  data-testid={`pricing-card-${index}`}
                >
                  <Card
                    className={`p-4 sm:p-6 md:p-8 rounded-2xl sm:rounded-3xl hover-elevate transition-all h-full ${
                      isHighlighted
                        ? "relative border-2 border-amber-500/50 dark:border-amber-400/50 bg-gradient-to-br from-amber-50/50 to-orange-50/30 dark:from-amber-900/20 dark:to-orange-900/10 shadow-xl shadow-amber-500/20"
                        : ""
                    }`}
                  >
                    {isHighlighted && (
                      <Badge 
                        className="absolute -top-3 right-6 bg-gradient-to-r from-amber-500 to-orange-500 text-white border-0 shadow-lg"
                        data-testid="popular-badge"
                      >
                        {t('landing.pricing.popular')}
                      </Badge>
                    )}
                    <div className="space-y-6">
                      <div>
                        <h3 
                          className="text-2xl sm:text-3xl font-bold"
                          data-testid={`plan-name-${index}`}
                        >
                          {plan.displayName}
                        </h3>
                        <p 
                          className="text-sm sm:text-base text-muted-foreground mt-2"
                          data-testid={`plan-description-${index}`}
                        >
                          {plan.description}
                        </p>
                      </div>
                      <div 
                        className="text-3xl sm:text-4xl md:text-5xl font-bold"
                        data-testid={`plan-price-${index}`}
                      >
                        {parseFloat(price) === 0 ? (
                          <span>{t('landing.pricing.free')}</span>
                        ) : (
                          <>
                            {currencySymbol}{price}
                            <span className="text-xl font-normal text-muted-foreground">
                              {isYearly ? t('landing.pricing.perYear') : t('landing.pricing.perMonth')}
                            </span>
                          </>
                        )}
                      </div>
                      <div 
                        className="space-y-3"
                        data-testid={`plan-features-${index}`}
                      >
                        {plan.maxAgents >= 999 || plan.maxAgents === -1 ? (
                          <div className="flex items-center gap-2">
                            <Check className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                            <span className="text-sm font-medium">Unlimited AI Agents</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Check className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                            <span className="text-sm">{plan.maxAgents} AI Agent{plan.maxAgents > 1 ? "s" : ""}</span>
                          </div>
                        )}

                        {plan.maxCampaigns >= 999 || plan.maxCampaigns === -1 ? (
                          <div className="flex items-center gap-2">
                            <Check className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                            <span className="text-sm font-medium">Unlimited Campaigns</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Check className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                            <span className="text-sm">{plan.maxCampaigns} Campaign{plan.maxCampaigns > 1 ? "s" : ""}</span>
                          </div>
                        )}

                        {plan.maxContactsPerCampaign >= 9999 || plan.maxContactsPerCampaign === -1 ? (
                          <div className="flex items-center gap-2">
                            <Check className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                            <span className="text-sm font-medium">Unlimited Contacts</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Check className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                            <span className="text-sm">Max {plan.maxContactsPerCampaign} contacts</span>
                          </div>
                        )}

                        {plan.canPurchaseNumbers ? (
                          <div className="flex items-center gap-2">
                            <Check className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                            <span className="text-sm">Own phone numbers</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Check className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                            <span className="text-sm">System-assigned phone number</span>
                          </div>
                        )}

                        {plan.canChooseLlm && (
                          <div className="flex items-center gap-2">
                            <Check className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                            <span className="text-sm">Choose your LLM</span>
                          </div>
                        )}

                        {plan.maxFlows !== undefined && plan.maxFlows > 0 && (
                          <div className="flex items-center gap-2">
                            <Check className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                            <span className={`text-sm ${plan.maxFlows >= 999 ? "font-medium" : ""}`}>
                              {plan.maxFlows >= 999 ? "Unlimited Flow Automations" : `${plan.maxFlows} Flow Automation${plan.maxFlows !== 1 ? "s" : ""}`}
                            </span>
                          </div>
                        )}

                        {plan.maxKnowledgeBases !== undefined && plan.maxKnowledgeBases > 0 && (
                          <div className="flex items-center gap-2">
                            <Check className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                            <span className={`text-sm ${plan.maxKnowledgeBases >= 999 ? "font-medium" : ""}`}>
                              {plan.maxKnowledgeBases >= 999 ? "Unlimited Knowledge Bases" : `${plan.maxKnowledgeBases} Knowledge Base${plan.maxKnowledgeBases !== 1 ? "s" : ""}`}
                            </span>
                          </div>
                        )}

                        {plan.maxWebhooks !== undefined && plan.maxWebhooks > 0 && (
                          <div className="flex items-center gap-2">
                            <Check className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                            <span className={`text-sm ${plan.maxWebhooks >= 999 ? "font-medium" : ""}`}>
                              {plan.maxWebhooks >= 999 ? "Unlimited Webhooks" : `${plan.maxWebhooks} Webhook${plan.maxWebhooks !== 1 ? "s" : ""}`}
                            </span>
                          </div>
                        )}

                        {plan.maxPhoneNumbers !== undefined && plan.maxPhoneNumbers > 0 && (
                          <div className="flex items-center gap-2">
                            <Check className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                            <span className={`text-sm ${plan.maxPhoneNumbers >= 999 ? "font-medium" : ""}`}>
                              {plan.maxPhoneNumbers >= 999 ? "Unlimited Phone Numbers" : `${plan.maxPhoneNumbers} Phone Number${plan.maxPhoneNumbers !== 1 ? "s" : ""}`}
                            </span>
                          </div>
                        )}

                        {maxWidgets > 0 && (
                          <div className="flex items-center gap-2">
                            <Check className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                            <span className={`text-sm ${maxWidgets >= 999 ? "font-medium" : ""}`}>
                              {maxWidgets >= 999 ? "Unlimited Website Widgets" : `${maxWidgets} Website Widget${maxWidgets !== 1 ? "s" : ""}`}
                            </span>
                          </div>
                        )}

                        {plan.includedCredits > 0 && (
                          <div className="flex items-center gap-2">
                            <Star className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                            <span className="text-sm font-medium">{plan.includedCredits} Included Credits</span>
                          </div>
                        )}

                        {!isFree && (
                          <div className="flex items-center gap-2">
                            <Check className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                            <span className="text-sm">Priority support</span>
                          </div>
                        )}

                        {sipPluginEnabled && plan.sipEnabled && !isFree && (
                          <div className="flex items-center gap-2">
                            <Check className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                            <span className="text-sm">SIP Trunk Access</span>
                          </div>
                        )}

                        {restApiPluginEnabled && plan.restApiEnabled && !isFree && (
                          <div className="flex items-center gap-2">
                            <Check className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                            <span className="text-sm">REST API Access</span>
                          </div>
                        )}
                      </div>
                      <Button
                        variant={isHighlighted ? "default" : "outline"}
                        size="lg"
                        className={`w-full h-14 text-lg ${
                          isHighlighted
                            ? "bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white border-0 shadow-lg shadow-amber-500/30"
                            : "border-amber-300 dark:border-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                        }`}
                        onClick={handleNavigate}
                        data-testid={`button-plan-${index}`}
                      >
                        {isHighlighted ? t('landing.pricing.startFreeTrial') : t('landing.pricing.getStarted')}
                      </Button>
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </motion.div>
        )}
        
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.5 }}
          className="text-center text-zinc-400 mt-8"
        >
          {t('landing.pricing.guarantee')}
        </motion.p>
      </div>
    </section>
  );
}

export default PricingSection;
