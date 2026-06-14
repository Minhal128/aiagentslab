/**
 * ============================================================
 * FeaturesPage - Comprehensive Platform Features
 * ============================================================
 */
import { motion } from "framer-motion";
import { 
  Bot, Phone, Zap, Users, Globe, Calendar, 
  BarChart3, Webhook, MessageSquare, PhoneForwarded,
  Brain, Mic, Check, ArrowRight, Workflow, PhoneIncoming,
  BookOpen, Settings, Shield, Clock, Target, Sparkles,
  Database, Languages, Headphones, TrendingUp
} from "lucide-react";
import { 
  SiHubspot, SiZapier, SiSlack, SiShopify, 
  SiCalendly, SiZendesk, SiSalesforce, SiZoho
} from "react-icons/si";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/landing/Navbar";
import { Footer } from "@/components/landing/Footer";
import { SEOHead } from "@/components/landing/SEOHead";
import { Link } from "wouter";
import { useBranding } from "@/components/BrandingProvider";
import { useSeoSettings } from "@/hooks/useSeoSettings";
import { useTranslation } from "react-i18next";

const integrations = [
  { name: "HubSpot", icon: <SiHubspot className="w-8 h-8" /> },
  { name: "Salesforce", icon: <SiSalesforce className="w-8 h-8" /> },
  { name: "Zapier", icon: <SiZapier className="w-8 h-8" /> },
  { name: "Slack", icon: <SiSlack className="w-8 h-8" /> },
  { name: "Shopify", icon: <SiShopify className="w-8 h-8" /> },
  { name: "Calendly", icon: <SiCalendly className="w-8 h-8" /> },
  { name: "Zendesk", icon: <SiZendesk className="w-8 h-8" /> },
  { name: "Zoho CRM", icon: <SiZoho className="w-8 h-8" /> }
];

export default function FeaturesPage() {
  const { branding } = useBranding();
  const { data: seoSettings } = useSeoSettings();
  const { t } = useTranslation();

  const agentTypes = [
    {
      id: "natural",
      icon: <Bot className="w-8 h-8" />,
      title: t('landing.featuresPage.agentTypes.natural.title'),
      description: t('landing.featuresPage.agentTypes.natural.description'),
      features: [
        t('landing.featuresPage.agentTypes.natural.features.openEnded'),
        t('landing.featuresPage.agentTypes.natural.features.personality'),
        t('landing.featuresPage.agentTypes.natural.features.rag'),
        t('landing.featuresPage.agentTypes.natural.features.multiLang')
      ]
    },
    {
      id: "flow",
      icon: <Workflow className="w-8 h-8" />,
      title: t('landing.featuresPage.agentTypes.flow.title'),
      description: t('landing.featuresPage.agentTypes.flow.description'),
      features: [
        t('landing.featuresPage.agentTypes.flow.features.dragDrop'),
        t('landing.featuresPage.agentTypes.flow.features.conditional'),
        t('landing.featuresPage.agentTypes.flow.features.api'),
        t('landing.featuresPage.agentTypes.flow.features.templates')
      ]
    },
    {
      id: "incoming",
      icon: <PhoneIncoming className="w-8 h-8" />,
      title: t('landing.featuresPage.agentTypes.incoming.title'),
      description: t('landing.featuresPage.agentTypes.incoming.description'),
      features: [
        t('landing.featuresPage.agentTypes.incoming.features.availability'),
        t('landing.featuresPage.agentTypes.incoming.features.routing'),
        t('landing.featuresPage.agentTypes.incoming.features.queue'),
        t('landing.featuresPage.agentTypes.incoming.features.transfer')
      ]
    }
  ];

  const howItWorks = [
    {
      step: t('landing.featuresPage.howItWorks.step1.number'),
      title: t('landing.featuresPage.howItWorks.step1.title'),
      description: t('landing.featuresPage.howItWorks.step1.description'),
      icon: <Settings className="w-6 h-6" />
    },
    {
      step: t('landing.featuresPage.howItWorks.step2.number'),
      title: t('landing.featuresPage.howItWorks.step2.title'),
      description: t('landing.featuresPage.howItWorks.step2.description'),
      icon: <Database className="w-6 h-6" />
    },
    {
      step: t('landing.featuresPage.howItWorks.step3.number'),
      title: t('landing.featuresPage.howItWorks.step3.title'),
      description: t('landing.featuresPage.howItWorks.step3.description'),
      icon: <TrendingUp className="w-6 h-6" />
    }
  ];

  const capabilities = [
    {
      category: t('landing.featuresPage.capabilities.categories.aiVoice'),
      items: [
        { icon: <Mic className="w-5 h-5" />, title: t('landing.featuresPage.capabilities.items.elevenLabs.title'), desc: t('landing.featuresPage.capabilities.items.elevenLabs.desc') },
        { icon: <Brain className="w-5 h-5" />, title: t('landing.featuresPage.capabilities.items.openai.title'), desc: t('landing.featuresPage.capabilities.items.openai.desc') },
        { icon: <Languages className="w-5 h-5" />, title: t('landing.featuresPage.capabilities.items.languages.title'), desc: t('landing.featuresPage.capabilities.items.languages.desc') },
        { icon: <Sparkles className="w-5 h-5" />, title: t('landing.featuresPage.capabilities.items.personalities.title'), desc: t('landing.featuresPage.capabilities.items.personalities.desc') }
      ]
    },
    {
      category: t('landing.featuresPage.capabilities.categories.telephony'),
      items: [
        { icon: <Phone className="w-5 h-5" />, title: t('landing.featuresPage.capabilities.items.twilio.title'), desc: t('landing.featuresPage.capabilities.items.twilio.desc') },
        { icon: <Globe className="w-5 h-5" />, title: t('landing.featuresPage.capabilities.items.countries.title'), desc: t('landing.featuresPage.capabilities.items.countries.desc') },
        { icon: <PhoneForwarded className="w-5 h-5" />, title: t('landing.featuresPage.capabilities.items.callTransfer.title'), desc: t('landing.featuresPage.capabilities.items.callTransfer.desc') },
        { icon: <MessageSquare className="w-5 h-5" />, title: t('landing.featuresPage.capabilities.items.recording.title'), desc: t('landing.featuresPage.capabilities.items.recording.desc') }
      ]
    },
    {
      category: t('landing.featuresPage.capabilities.categories.campaignManagement'),
      items: [
        { icon: <Users className="w-5 h-5" />, title: t('landing.featuresPage.capabilities.items.bulkCampaigns.title'), desc: t('landing.featuresPage.capabilities.items.bulkCampaigns.desc') },
        { icon: <Calendar className="w-5 h-5" />, title: t('landing.featuresPage.capabilities.items.scheduling.title'), desc: t('landing.featuresPage.capabilities.items.scheduling.desc') },
        { icon: <Target className="w-5 h-5" />, title: t('landing.featuresPage.capabilities.items.retryLogic.title'), desc: t('landing.featuresPage.capabilities.items.retryLogic.desc') },
        { icon: <BarChart3 className="w-5 h-5" />, title: t('landing.featuresPage.capabilities.items.analytics.title'), desc: t('landing.featuresPage.capabilities.items.analytics.desc') }
      ]
    },
    {
      category: t('landing.featuresPage.capabilities.categories.integrationSecurity'),
      items: [
        { icon: <Webhook className="w-5 h-5" />, title: t('landing.featuresPage.capabilities.items.webhooks.title'), desc: t('landing.featuresPage.capabilities.items.webhooks.desc') },
        { icon: <Shield className="w-5 h-5" />, title: t('landing.featuresPage.capabilities.items.security.title'), desc: t('landing.featuresPage.capabilities.items.security.desc') },
        { icon: <BookOpen className="w-5 h-5" />, title: t('landing.featuresPage.capabilities.items.knowledgeBase.title'), desc: t('landing.featuresPage.capabilities.items.knowledgeBase.desc') },
        { icon: <Headphones className="w-5 h-5" />, title: t('landing.featuresPage.capabilities.items.humanHandoff.title'), desc: t('landing.featuresPage.capabilities.items.humanHandoff.desc') }
      ]
    }
  ];

  const useCases = [
    {
      id: "lead-qualification",
      title: t('landing.featuresPage.useCases.leadQualification.title'),
      description: t('landing.featuresPage.useCases.leadQualification.description'),
      icon: <Target className="w-6 h-6" />
    },
    {
      id: "appointment-booking",
      title: t('landing.featuresPage.useCases.appointmentBooking.title'),
      description: t('landing.featuresPage.useCases.appointmentBooking.description'),
      icon: <Calendar className="w-6 h-6" />
    },
    {
      id: "customer-support",
      title: t('landing.featuresPage.useCases.customerSupport.title'),
      description: t('landing.featuresPage.useCases.customerSupport.description'),
      icon: <Headphones className="w-6 h-6" />
    },
    {
      id: "survey-feedback",
      title: t('landing.featuresPage.useCases.surveyFeedback.title'),
      description: t('landing.featuresPage.useCases.surveyFeedback.description'),
      icon: <MessageSquare className="w-6 h-6" />
    },
    {
      id: "payment-reminder",
      title: t('landing.featuresPage.useCases.paymentReminder.title'),
      description: t('landing.featuresPage.useCases.paymentReminder.description'),
      icon: <Clock className="w-6 h-6" />
    },
    {
      id: "tech-support",
      title: t('landing.featuresPage.useCases.techSupport.title'),
      description: t('landing.featuresPage.useCases.techSupport.description'),
      icon: <Settings className="w-6 h-6" />
    }
  ];
  
  return (
    <div className="min-h-screen bg-background" data-testid="features-page">
      <SEOHead
        title={t('landing.featuresPage.seo.title')}
        description={t('landing.featuresPage.seo.description')}
        canonicalUrl={seoSettings?.canonicalBaseUrl ? `${seoSettings.canonicalBaseUrl}/features` : undefined}
        ogImage={seoSettings?.defaultOgImage || undefined}
        ogSiteName={branding.app_name}
        twitterSite={seoSettings?.twitterHandle || undefined}
        twitterCreator={seoSettings?.twitterHandle || undefined}
        googleVerification={seoSettings?.googleVerification || undefined}
        bingVerification={seoSettings?.bingVerification || undefined}
        facebookAppId={seoSettings?.facebookAppId || undefined}
        structuredDataOrg={seoSettings?.structuredDataOrg}
      />

      <Navbar />

      <main className="pt-16">
        {/* Hero Section - Light background */}
        <section className="py-16 md:py-24 bg-gradient-to-b from-gray-50 to-white dark:from-[#050B1A] dark:to-[#0a1628]" data-testid="section-hero">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-brand/10 border border-brand/20 mb-6">
                <Zap className="w-4 h-4 text-brand" />
                <span className="text-sm font-medium text-brand">
                  {t('landing.featuresPage.hero.badge')}
                </span>
              </div>
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6 text-gray-900 dark:text-white" data-testid="text-hero-title">
                {t('landing.featuresPage.hero.title')}
              </h1>
              <p className="text-lg md:text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto mb-8" data-testid="text-hero-subtitle">
                {t('landing.featuresPage.hero.subtitle')}
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link href="/login">
                  <Button 
                    className="bg-brand text-brand-foreground font-medium border-0 h-12 px-8 text-base shadow-lg"
                    data-testid="button-hero-trial"
                  >
                    {t('landing.featuresPage.hero.startFreeTrial')}
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </Link>
                <Link href="/contact">
                  <Button 
                    variant="outline" 
                    className="h-12 px-8 text-base border-gray-300 dark:border-gray-600"
                    data-testid="button-hero-contact"
                  >
                    {t('landing.featuresPage.hero.contactSales')}
                  </Button>
                </Link>
              </div>
            </motion.div>
          </div>
        </section>

        {/* AI Agent Types Section */}
        <section className="py-16 md:py-24 bg-white dark:bg-[#0a1628]" data-testid="section-agent-types">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-12"
            >
              <h2 className="text-3xl md:text-4xl font-bold mb-4 text-gray-900 dark:text-white" data-testid="text-agents-title">
                {t('landing.featuresPage.agentTypes.title')}
              </h2>
              <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
                {t('landing.featuresPage.agentTypes.subtitle')}
              </p>
            </motion.div>

            <div className="grid md:grid-cols-3 gap-8">
              {agentTypes.map((agent, index) => (
                <motion.div
                  key={agent.id}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                  className="relative bg-white dark:bg-[#0f1d32] rounded-2xl p-8 border border-gray-200 dark:border-brand/20 hover:border-brand/50 dark:hover:border-brand/50 transition-all duration-300 hover:shadow-xl"
                  data-testid={`card-agent-${agent.id}`}
                >
                  <div className="w-16 h-16 rounded-2xl bg-brand flex items-center justify-center mb-6 shadow-lg">
                    <div className="text-brand-foreground">{agent.icon}</div>
                  </div>
                  <h3 className="text-xl font-bold mb-3 text-gray-900 dark:text-white">{agent.title}</h3>
                  <p className="text-gray-600 dark:text-gray-400 mb-6">{agent.description}</p>
                  <ul className="space-y-3">
                    {agent.features.map((feature, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                        <Check className="w-4 h-4 text-brand shrink-0" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Use Cases Section */}
        <section className="py-16 md:py-24 bg-gray-50 dark:bg-[#050B1A]" data-testid="section-use-cases">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-12"
            >
              <h2 className="text-3xl md:text-4xl font-bold mb-4 text-gray-900 dark:text-white" data-testid="text-usecases-title">
                {t('landing.featuresPage.useCases.title')}
              </h2>
              <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
                {t('landing.featuresPage.useCases.subtitle')}
              </p>
            </motion.div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {useCases.map((useCase, index) => (
                <motion.div
                  key={useCase.id}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: index * 0.05 }}
                  className="bg-white dark:bg-[#0f1d32] rounded-xl p-6 border border-gray-200 dark:border-brand/20 hover:border-brand/50 dark:hover:border-brand/50 transition-all duration-300"
                  data-testid={`card-usecase-${useCase.id}`}
                >
                  <div className="w-12 h-12 rounded-xl bg-brand/10 flex items-center justify-center mb-4">
                    <div className="text-brand">{useCase.icon}</div>
                  </div>
                  <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-white">{useCase.title}</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{useCase.description}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* How It Works Section */}
        <section className="py-16 md:py-24 bg-white dark:bg-[#0a1628]" data-testid="section-how-it-works">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-16"
            >
              <h2 className="text-3xl md:text-4xl font-bold mb-4 text-gray-900 dark:text-white" data-testid="text-howitworks-title">
                {t('landing.featuresPage.howItWorks.title')}
              </h2>
              <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
                {t('landing.featuresPage.howItWorks.subtitle')}
              </p>
            </motion.div>

            <div className="grid md:grid-cols-3 gap-8">
              {howItWorks.map((step, index) => (
                <motion.div
                  key={step.step}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: index * 0.15 }}
                  className="relative"
                  data-testid={`step-${step.step}`}
                >
                  <div className="text-center">
                    <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-brand mb-6 shadow-lg">
                      <span className="text-2xl font-bold text-brand-foreground">{step.step}</span>
                    </div>
                    <h3 className="text-xl font-bold mb-3 text-gray-900 dark:text-white">{step.title}</h3>
                    <p className="text-gray-600 dark:text-gray-400">{step.description}</p>
                  </div>
                  {index < howItWorks.length - 1 && (
                    <div className="hidden md:block absolute top-10 left-[60%] w-[80%] h-0.5 bg-gradient-to-r from-brand/40 to-transparent" />
                  )}
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Platform Capabilities Section */}
        <section className="py-16 md:py-24 bg-gray-50 dark:bg-[#050B1A]" data-testid="section-capabilities">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-16"
            >
              <h2 className="text-3xl md:text-4xl font-bold mb-4 text-gray-900 dark:text-white" data-testid="text-capabilities-title">
                {t('landing.featuresPage.capabilities.title')}
              </h2>
              <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
                {t('landing.featuresPage.capabilities.subtitle')}
              </p>
            </motion.div>

            <div className="grid md:grid-cols-2 gap-8">
              {capabilities.map((category, catIndex) => (
                <motion.div
                  key={category.category}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: catIndex * 0.1 }}
                  className="bg-white dark:bg-[#0f1d32] rounded-2xl p-6 border border-gray-200 dark:border-brand/20"
                  data-testid={`card-capability-${catIndex}`}
                >
                  <h3 className="text-lg font-semibold mb-6 text-brand flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-brand" />
                    {category.category}
                  </h3>
                  <div className="grid sm:grid-cols-2 gap-4">
                    {category.items.map((item, itemIndex) => (
                      <div key={itemIndex} className="flex gap-3">
                        <div className="w-10 h-10 rounded-lg bg-brand/10 flex items-center justify-center shrink-0">
                          <div className="text-brand">{item.icon}</div>
                        </div>
                        <div>
                          <h4 className="font-medium text-sm text-gray-900 dark:text-white">{item.title}</h4>
                          <p className="text-xs text-gray-500 dark:text-gray-500">{item.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Integrations Section */}
        <section className="py-16 md:py-24 bg-white dark:bg-[#0a1628]" data-testid="section-integrations">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-12"
            >
              <h2 className="text-3xl md:text-4xl font-bold mb-4 text-gray-900 dark:text-white" data-testid="text-integrations-title">
                {t('landing.featuresPage.integrations.title')}
              </h2>
              <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
                {t('landing.featuresPage.integrations.subtitle')}
              </p>
            </motion.div>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-4">
              {integrations.map((integration, index) => (
                <motion.div
                  key={integration.name}
                  initial={{ opacity: 0, scale: 0.9 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.3, delay: index * 0.05 }}
                  className="flex flex-col items-center gap-2 p-4 bg-gray-50 dark:bg-[#0f1d32] rounded-xl border border-gray-200 dark:border-brand/20 hover:border-brand/50 dark:hover:border-brand/50 transition-all duration-300"
                  data-testid={`integration-${integration.name.toLowerCase().replace(' ', '-')}`}
                >
                  <div className="text-gray-700 dark:text-gray-300">{integration.icon}</div>
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-400">{integration.name}</span>
                </motion.div>
              ))}
            </div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="mt-8 text-center"
            >
              <p className="text-sm text-gray-500 dark:text-gray-500">
                {t('landing.featuresPage.integrations.footerText')}
              </p>
            </motion.div>
          </div>
        </section>

        {/* Knowledge Base & Human Handoff Section */}
        <section className="py-16 md:py-24 bg-gradient-to-br from-[#050B1A] via-[#0a1628] to-[#050B1A]" data-testid="section-knowledge-handoff">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid md:grid-cols-2 gap-12 items-center">
              <motion.div
                initial={{ opacity: 0, x: -30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6 }}
                data-testid="card-knowledge-base"
              >
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand/20 border border-brand/30 mb-6">
                  <BookOpen className="w-4 h-4 text-brand" />
                  <span className="text-sm font-medium text-brand">{t('landing.featuresPage.knowledgeBase.badge')}</span>
                </div>
                <h2 className="text-3xl md:text-4xl font-bold mb-6 text-white">
                  {t('landing.featuresPage.knowledgeBase.title')}
                </h2>
                <p className="text-gray-300 mb-6">
                  {t('landing.featuresPage.knowledgeBase.description')}
                </p>
                <ul className="space-y-4">
                  <li className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-brand mt-0.5" />
                    <span className="text-gray-300">{t('landing.featuresPage.knowledgeBase.features.processing')}</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-brand mt-0.5" />
                    <span className="text-gray-300">{t('landing.featuresPage.knowledgeBase.features.rag')}</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-brand mt-0.5" />
                    <span className="text-gray-300">{t('landing.featuresPage.knowledgeBase.features.realTime')}</span>
                  </li>
                </ul>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, x: 30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.2 }}
                data-testid="card-human-handoff"
              >
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/30 mb-6">
                  <Headphones className="w-4 h-4 text-amber-400" />
                  <span className="text-sm font-medium text-amber-300">{t('landing.featuresPage.humanHandoff.badge')}</span>
                </div>
                <h2 className="text-3xl md:text-4xl font-bold mb-6 text-white">
                  {t('landing.featuresPage.humanHandoff.title')}
                </h2>
                <p className="text-gray-300 mb-6">
                  {t('landing.featuresPage.humanHandoff.description')}
                </p>
                <ul className="space-y-4">
                  <li className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-amber-400 mt-0.5" />
                    <span className="text-gray-300">{t('landing.featuresPage.humanHandoff.features.escalation')}</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-amber-400 mt-0.5" />
                    <span className="text-gray-300">{t('landing.featuresPage.humanHandoff.features.context')}</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-amber-400 mt-0.5" />
                    <span className="text-gray-300">{t('landing.featuresPage.humanHandoff.features.routing')}</span>
                  </li>
                </ul>
              </motion.div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-16 md:py-24 bg-brand" data-testid="section-cta">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              <h2 className="text-3xl md:text-4xl font-bold mb-4 text-brand-foreground" data-testid="text-cta-title">
                {t('landing.featuresPage.cta.title')}
              </h2>
              <p className="text-lg mb-8 text-brand-foreground/80">
                {t('landing.featuresPage.cta.subtitle')}
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link href="/login">
                  <Button 
                    className="bg-white text-foreground hover:bg-gray-100 font-semibold h-14 px-8 text-lg shadow-lg border-0"
                    data-testid="button-cta-trial"
                  >
                    {t('landing.featuresPage.cta.startFreeTrial')}
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </Link>
                <Link href="/contact">
                  <Button 
                    variant="outline" 
                    className="border-2 border-brand-foreground/50 text-brand-foreground hover:bg-brand-foreground/10 h-14 px-8 text-lg"
                    data-testid="button-cta-contact"
                  >
                    {t('landing.featuresPage.cta.contactSales')}
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
