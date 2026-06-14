/**
 * ============================================================
 * UseCasesPage - Vibrant Industry-Specific Use Cases
 * Features all platform capabilities including Audio Node
 * ============================================================
 */
import { motion } from "framer-motion";
import { 
  TrendingUp, Headphones, Calendar, ClipboardList, 
  CreditCard, Building2, GraduationCap, Heart,
  ShoppingCart, Car, ArrowRight, Check, Phone,
  Users, Megaphone, Radio, Bell, AlertTriangle,
  Sparkles, Zap, Globe, MessageSquare, Play,
  Target, BarChart3, Clock, Shield
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Navbar } from "@/components/landing/Navbar";
import { Footer } from "@/components/landing/Footer";
import { SEOHead } from "@/components/landing/SEOHead";
import { Link } from "wouter";
import { useBranding } from "@/components/BrandingProvider";
import { useSeoSettings } from "@/hooks/useSeoSettings";
import { useTranslation } from "react-i18next";

interface UseCaseProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  description: string;
  features: string[];
  stats: { value: string; label: string }[];
  gradient: string;
  iconBg: string;
  badge?: string;
  reverse?: boolean;
  getStartedText: string;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } }
};

const FloatingParticle = ({ delay, duration, x, y, size }: { delay: number; duration: number; x: string; y: string; size: number }) => (
  <motion.div
    className="absolute rounded-full bg-gradient-to-r from-brand/20 to-amber-400/20 blur-xl"
    style={{ left: x, top: y, width: size, height: size }}
    animate={{
      y: [0, -30, 0],
      opacity: [0.3, 0.6, 0.3],
      scale: [1, 1.2, 1],
    }}
    transition={{
      duration,
      delay,
      repeat: Infinity,
      ease: "easeInOut",
    }}
  />
);

const UseCase = ({ icon, title, subtitle, description, features, stats, gradient, iconBg, badge, reverse, getStartedText }: UseCaseProps) => (
  <motion.div
    initial={{ opacity: 0, y: 40 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, margin: "-50px" }}
    transition={{ duration: 0.6 }}
    className="relative"
  >
    <div className="grid lg:grid-cols-2 gap-8 lg:gap-16 items-center py-12 lg:py-20">
      <div className={`space-y-6 ${reverse ? 'lg:order-2' : 'lg:order-1'}`}>
        {badge && (
          <Badge className="bg-gradient-to-r from-brand/20 to-amber-500/20 text-brand border-brand/30 px-3 py-1">
            <Sparkles className="w-3 h-3 mr-1" />
            {badge}
          </Badge>
        )}
        
        <div className={`w-16 h-16 rounded-2xl ${iconBg} flex items-center justify-center shadow-xl`}>
          <div className="text-white">{icon}</div>
        </div>
        
        <div>
          <p className="text-brand font-medium mb-2">{subtitle}</p>
          <h3 className="text-2xl md:text-3xl lg:text-4xl font-bold mb-4">{title}</h3>
          <p className="text-muted-foreground text-lg leading-relaxed">{description}</p>
        </div>
        
        <ul className="space-y-3">
          {features.map((feature, i) => (
            <motion.li 
              key={i} 
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="flex items-start gap-3"
            >
              <div className="w-6 h-6 rounded-full bg-gradient-to-r from-green-500 to-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                <Check className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="text-foreground/80">{feature}</span>
            </motion.li>
          ))}
        </ul>

        <Link href="/login">
          <Button className="cta-button text-white font-medium border-0 mt-4">
            {getStartedText}
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </Link>
      </div>

      <div className={reverse ? 'lg:order-1' : 'lg:order-2'}>
        <div className={`relative p-1 rounded-3xl ${gradient}`}>
          <div className="bg-card rounded-[22px] p-6 lg:p-8">
            <div className="grid grid-cols-2 gap-4">
              {stats.map((stat, i) => (
                <motion.div 
                  key={i}
                  initial={{ opacity: 0, scale: 0.9 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.15 }}
                  className="bg-gradient-to-br from-muted/50 to-muted/30 rounded-2xl p-5 text-center border border-border/50 hover-elevate"
                >
                  <div className="text-3xl lg:text-4xl font-bold bg-gradient-to-r from-brand to-amber-400 bg-clip-text text-transparent">
                    {stat.value}
                  </div>
                  <div className="text-sm text-muted-foreground mt-2">{stat.label}</div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  </motion.div>
);

export default function UseCasesPage() {
  const { branding } = useBranding();
  const { data: seoSettings } = useSeoSettings();
  const { t } = useTranslation();

  const useCases: UseCaseProps[] = [
    {
      icon: <TrendingUp className="w-7 h-7" />,
      title: t('landing.useCasesPage.useCases.outboundSales.title'),
      subtitle: t('landing.useCasesPage.useCases.outboundSales.subtitle'),
      description: t('landing.useCasesPage.useCases.outboundSales.description'),
      features: [
        t('landing.useCasesPage.useCases.outboundSales.features.bulk'),
        t('landing.useCasesPage.useCases.outboundSales.features.natural'),
        t('landing.useCasesPage.useCases.outboundSales.features.leadQual'),
        t('landing.useCasesPage.useCases.outboundSales.features.meeting'),
        t('landing.useCasesPage.useCases.outboundSales.features.crm')
      ],
      stats: [
        { value: "10X", label: t('landing.useCasesPage.useCases.outboundSales.stats.callsDaily') },
        { value: "45%", label: t('landing.useCasesPage.useCases.outboundSales.stats.conversion') },
        { value: "80%", label: t('landing.useCasesPage.useCases.outboundSales.stats.costReduction') },
        { value: "24/7", label: t('landing.useCasesPage.useCases.outboundSales.stats.campaign') }
      ],
      gradient: "bg-gradient-to-r from-brand to-brand/90",
      iconBg: "bg-gradient-to-br from-brand to-brand/90",
      badge: t('landing.useCasesPage.useCases.outboundSales.badge'),
      getStartedText: t('landing.useCasesPage.getStartedFree')
    },
    {
      icon: <Calendar className="w-7 h-7" />,
      title: t('landing.useCasesPage.useCases.appointment.title'),
      subtitle: t('landing.useCasesPage.useCases.appointment.subtitle'),
      description: t('landing.useCasesPage.useCases.appointment.description'),
      features: [
        t('landing.useCasesPage.useCases.appointment.features.visual'),
        t('landing.useCasesPage.useCases.appointment.features.automated'),
        t('landing.useCasesPage.useCases.appointment.features.rescheduling'),
        t('landing.useCasesPage.useCases.appointment.features.timezone'),
        t('landing.useCasesPage.useCases.appointment.features.calendar')
      ],
      stats: [
        { value: "65%", label: t('landing.useCasesPage.useCases.appointment.stats.noShows') },
        { value: "90%", label: t('landing.useCasesPage.useCases.appointment.stats.bookingRate') },
        { value: "100%", label: t('landing.useCasesPage.useCases.appointment.stats.automated') },
        { value: "5min", label: t('landing.useCasesPage.useCases.appointment.stats.setupTime') }
      ],
      gradient: "bg-gradient-to-r from-purple-500 to-pink-500",
      iconBg: "bg-gradient-to-br from-purple-500 to-pink-600",
      reverse: true,
      getStartedText: t('landing.useCasesPage.getStartedFree')
    },
    {
      icon: <Headphones className="w-7 h-7" />,
      title: t('landing.useCasesPage.useCases.support.title'),
      subtitle: t('landing.useCasesPage.useCases.support.subtitle'),
      description: t('landing.useCasesPage.useCases.support.description'),
      features: [
        t('landing.useCasesPage.useCases.support.features.incoming'),
        t('landing.useCasesPage.useCases.support.features.knowledge'),
        t('landing.useCasesPage.useCases.support.features.escalation'),
        t('landing.useCasesPage.useCases.support.features.multiLang'),
        t('landing.useCasesPage.useCases.support.features.transcript')
      ],
      stats: [
        { value: "92%", label: t('landing.useCasesPage.useCases.support.stats.resolution') },
        { value: "0 sec", label: t('landing.useCasesPage.useCases.support.stats.waitTime') },
        { value: "30+", label: t('landing.useCasesPage.useCases.support.stats.languages') },
        { value: "99%", label: t('landing.useCasesPage.useCases.support.stats.uptime') }
      ],
      gradient: "bg-gradient-to-r from-blue-500 to-indigo-500",
      iconBg: "bg-gradient-to-br from-blue-500 to-indigo-600",
      getStartedText: t('landing.useCasesPage.getStartedFree')
    },
    {
      icon: <ClipboardList className="w-7 h-7" />,
      title: t('landing.useCasesPage.useCases.survey.title'),
      subtitle: t('landing.useCasesPage.useCases.survey.subtitle'),
      description: t('landing.useCasesPage.useCases.survey.description'),
      features: [
        t('landing.useCasesPage.useCases.survey.features.question'),
        t('landing.useCasesPage.useCases.survey.features.analytics'),
        t('landing.useCasesPage.useCases.survey.features.sentiment'),
        t('landing.useCasesPage.useCases.survey.features.export'),
        t('landing.useCasesPage.useCases.survey.features.types')
      ],
      stats: [
        { value: "4X", label: t('landing.useCasesPage.useCases.survey.stats.responseRate') },
        { value: "88%", label: t('landing.useCasesPage.useCases.survey.stats.completion') },
        { value: "Real-time", label: t('landing.useCasesPage.useCases.survey.stats.analytics') },
        { value: "Auto", label: t('landing.useCasesPage.useCases.survey.stats.reporting') }
      ],
      gradient: "bg-gradient-to-r from-amber-500 to-orange-500",
      iconBg: "bg-gradient-to-br from-amber-500 to-orange-600",
      reverse: true,
      getStartedText: t('landing.useCasesPage.getStartedFree')
    },
    {
      icon: <CreditCard className="w-7 h-7" />,
      title: t('landing.useCasesPage.useCases.payment.title'),
      subtitle: t('landing.useCasesPage.useCases.payment.subtitle'),
      description: t('landing.useCasesPage.useCases.payment.description'),
      features: [
        t('landing.useCasesPage.useCases.payment.features.gentle'),
        t('landing.useCasesPage.useCases.payment.features.multiLang'),
        t('landing.useCasesPage.useCases.payment.features.negotiation'),
        t('landing.useCasesPage.useCases.payment.features.tracking'),
        t('landing.useCasesPage.useCases.payment.features.compliance')
      ],
      stats: [
        { value: "50%", label: t('landing.useCasesPage.useCases.payment.stats.collections') },
        { value: "100%", label: t('landing.useCasesPage.useCases.payment.stats.compliant') },
        { value: "60%", label: t('landing.useCasesPage.useCases.payment.stats.costSavings') },
        { value: "15+", label: t('landing.useCasesPage.useCases.payment.stats.languages') }
      ],
      gradient: "bg-gradient-to-r from-green-500 to-emerald-500",
      iconBg: "bg-gradient-to-br from-green-500 to-emerald-600",
      getStartedText: t('landing.useCasesPage.getStartedFree')
    },
    {
      icon: <Target className="w-7 h-7" />,
      title: t('landing.useCasesPage.useCases.leadQualification.title'),
      subtitle: t('landing.useCasesPage.useCases.leadQualification.subtitle'),
      description: t('landing.useCasesPage.useCases.leadQualification.description'),
      features: [
        t('landing.useCasesPage.useCases.leadQualification.features.scoring'),
        t('landing.useCasesPage.useCases.leadQualification.features.followUp'),
        t('landing.useCasesPage.useCases.leadQualification.features.webhook'),
        t('landing.useCasesPage.useCases.leadQualification.features.criteria'),
        t('landing.useCasesPage.useCases.leadQualification.features.alerts')
      ],
      stats: [
        { value: "3X", label: t('landing.useCasesPage.useCases.leadQualification.stats.qualifiedLeads') },
        { value: "70%", label: t('landing.useCasesPage.useCases.leadQualification.stats.timeSaved') },
        { value: "Real-time", label: t('landing.useCasesPage.useCases.leadQualification.stats.crmSync') },
        { value: "Auto", label: t('landing.useCasesPage.useCases.leadQualification.stats.followUps') }
      ],
      gradient: "bg-gradient-to-r from-rose-500 to-red-500",
      iconBg: "bg-gradient-to-br from-rose-500 to-red-600",
      reverse: true,
      getStartedText: t('landing.useCasesPage.getStartedFree')
    },
    {
      icon: <Radio className="w-7 h-7" />,
      title: t('landing.useCasesPage.useCases.broadcast.title'),
      subtitle: t('landing.useCasesPage.useCases.broadcast.subtitle'),
      description: t('landing.useCasesPage.useCases.broadcast.description'),
      features: [
        t('landing.useCasesPage.useCases.broadcast.features.audio'),
        t('landing.useCasesPage.useCases.broadcast.features.aiPowered'),
        t('landing.useCasesPage.useCases.broadcast.features.mass'),
        t('landing.useCasesPage.useCases.broadcast.features.personalized'),
        t('landing.useCasesPage.useCases.broadcast.features.tracking')
      ],
      stats: [
        { value: "10K+", label: t('landing.useCasesPage.useCases.broadcast.stats.callsHour') },
        { value: "95%", label: t('landing.useCasesPage.useCases.broadcast.stats.deliveryRate') },
        { value: "Custom", label: t('landing.useCasesPage.useCases.broadcast.stats.audioFiles') },
        { value: "Smart", label: t('landing.useCasesPage.useCases.broadcast.stats.followUps') }
      ],
      gradient: "bg-gradient-to-r from-violet-500 to-purple-500",
      iconBg: "bg-gradient-to-br from-violet-500 to-purple-600",
      badge: t('landing.useCasesPage.useCases.broadcast.badge'),
      getStartedText: t('landing.useCasesPage.getStartedFree')
    },
    {
      icon: <GraduationCap className="w-7 h-7" />,
      title: t('landing.useCasesPage.useCases.training.title'),
      subtitle: t('landing.useCasesPage.useCases.training.subtitle'),
      description: t('landing.useCasesPage.useCases.training.description'),
      features: [
        t('landing.useCasesPage.useCases.training.features.playback'),
        t('landing.useCasesPage.useCases.training.features.qa'),
        t('landing.useCasesPage.useCases.training.features.verification'),
        t('landing.useCasesPage.useCases.training.features.progress'),
        t('landing.useCasesPage.useCases.training.features.scalable')
      ],
      stats: [
        { value: "95%", label: t('landing.useCasesPage.useCases.training.stats.completion') },
        { value: "100%", label: t('landing.useCasesPage.useCases.training.stats.consistent') },
        { value: "50%", label: t('landing.useCasesPage.useCases.training.stats.timeSaved') },
        { value: "Auto", label: t('landing.useCasesPage.useCases.training.stats.assessment') }
      ],
      gradient: "bg-gradient-to-r from-brand to-brand/90",
      iconBg: "bg-gradient-to-br from-brand to-brand/90",
      reverse: true,
      getStartedText: t('landing.useCasesPage.getStartedFree')
    },
    {
      icon: <Megaphone className="w-7 h-7" />,
      title: t('landing.useCasesPage.useCases.announcements.title'),
      subtitle: t('landing.useCasesPage.useCases.announcements.subtitle'),
      description: t('landing.useCasesPage.useCases.announcements.description'),
      features: [
        t('landing.useCasesPage.useCases.announcements.features.professional'),
        t('landing.useCasesPage.useCases.announcements.features.questions'),
        t('landing.useCasesPage.useCases.announcements.features.feedback'),
        t('landing.useCasesPage.useCases.announcements.features.targeting'),
        t('landing.useCasesPage.useCases.announcements.features.analytics')
      ],
      stats: [
        { value: "85%", label: t('landing.useCasesPage.useCases.announcements.stats.listenRate') },
        { value: "40%", label: t('landing.useCasesPage.useCases.announcements.stats.engagement') },
        { value: "Real-time", label: t('landing.useCasesPage.useCases.announcements.stats.feedback') },
        { value: "Targeted", label: t('landing.useCasesPage.useCases.announcements.stats.delivery') }
      ],
      gradient: "bg-gradient-to-r from-pink-500 to-rose-500",
      iconBg: "bg-gradient-to-br from-pink-500 to-rose-600",
      getStartedText: t('landing.useCasesPage.getStartedFree')
    },
    {
      icon: <Bell className="w-7 h-7" />,
      title: t('landing.useCasesPage.useCases.events.title'),
      subtitle: t('landing.useCasesPage.useCases.events.subtitle'),
      description: t('landing.useCasesPage.useCases.events.description'),
      features: [
        t('landing.useCasesPage.useCases.events.features.invitations'),
        t('landing.useCasesPage.useCases.events.features.rsvp'),
        t('landing.useCasesPage.useCases.events.features.reminders'),
        t('landing.useCasesPage.useCases.events.features.attendee'),
        t('landing.useCasesPage.useCases.events.features.calendar')
      ],
      stats: [
        { value: "75%", label: t('landing.useCasesPage.useCases.events.stats.rsvpRate') },
        { value: "60%", label: t('landing.useCasesPage.useCases.events.stats.attendance') },
        { value: "Auto", label: t('landing.useCasesPage.useCases.events.stats.reminders') },
        { value: "Synced", label: t('landing.useCasesPage.useCases.events.stats.calendars') }
      ],
      gradient: "bg-gradient-to-r from-indigo-500 to-blue-500",
      iconBg: "bg-gradient-to-br from-indigo-500 to-blue-600",
      reverse: true,
      getStartedText: t('landing.useCasesPage.getStartedFree')
    },
    {
      icon: <AlertTriangle className="w-7 h-7" />,
      title: t('landing.useCasesPage.useCases.emergency.title'),
      subtitle: t('landing.useCasesPage.useCases.emergency.subtitle'),
      description: t('landing.useCasesPage.useCases.emergency.description'),
      features: [
        t('landing.useCasesPage.useCases.emergency.features.priority'),
        t('landing.useCasesPage.useCases.emergency.features.acknowledgment'),
        t('landing.useCasesPage.useCases.emergency.features.escalation'),
        t('landing.useCasesPage.useCases.emergency.features.multichannel'),
        t('landing.useCasesPage.useCases.emergency.features.compliance')
      ],
      stats: [
        { value: "99%", label: t('landing.useCasesPage.useCases.emergency.stats.deliveryRate') },
        { value: "<30s", label: t('landing.useCasesPage.useCases.emergency.stats.alertTime') },
        { value: "100%", label: t('landing.useCasesPage.useCases.emergency.stats.tracked') },
        { value: "Auto", label: t('landing.useCasesPage.useCases.emergency.stats.escalation') }
      ],
      gradient: "bg-gradient-to-r from-red-500 to-orange-500",
      iconBg: "bg-gradient-to-br from-red-500 to-orange-600",
      getStartedText: t('landing.useCasesPage.getStartedFree')
    }
  ];

  const industries = [
    { icon: <Building2 className="w-5 h-5" />, name: t('landing.useCasesPage.industries.saas'), color: "from-blue-500 to-cyan-500" },
    { icon: <Heart className="w-5 h-5" />, name: t('landing.useCasesPage.industries.healthcare'), color: "from-red-500 to-pink-500" },
    { icon: <GraduationCap className="w-5 h-5" />, name: t('landing.useCasesPage.industries.education'), color: "from-purple-500 to-indigo-500" },
    { icon: <ShoppingCart className="w-5 h-5" />, name: t('landing.useCasesPage.industries.ecommerce'), color: "from-amber-500 to-orange-500" },
    { icon: <Car className="w-5 h-5" />, name: t('landing.useCasesPage.industries.automotive'), color: "from-slate-500 to-zinc-500" },
    { icon: <CreditCard className="w-5 h-5" />, name: t('landing.useCasesPage.industries.financial'), color: "from-green-500 to-emerald-500" },
    { icon: <Building2 className="w-5 h-5" />, name: t('landing.useCasesPage.industries.realEstate'), color: "from-brand to-brand/90" },
    { icon: <Users className="w-5 h-5" />, name: t('landing.useCasesPage.industries.hr'), color: "from-violet-500 to-purple-500" },
  ];

  const platformFeatures = [
    { icon: <Phone className="w-5 h-5" />, label: t('landing.useCasesPage.platformFeatures.countries'), description: t('landing.useCasesPage.platformFeatures.countriesDesc') },
    { icon: <Globe className="w-5 h-5" />, label: t('landing.useCasesPage.platformFeatures.languages'), description: t('landing.useCasesPage.platformFeatures.languagesDesc') },
    { icon: <Zap className="w-5 h-5" />, label: t('landing.useCasesPage.platformFeatures.realTime'), description: t('landing.useCasesPage.platformFeatures.realTimeDesc') },
    { icon: <Shield className="w-5 h-5" />, label: t('landing.useCasesPage.platformFeatures.enterprise'), description: t('landing.useCasesPage.platformFeatures.enterpriseDesc') },
  ];
  
  return (
    <div className="min-h-screen bg-background" data-testid="use-cases-page">
      <SEOHead
        title={t('landing.useCasesPage.seoTitle')}
        description={t('landing.useCasesPage.seoDescription')}
        canonicalUrl={seoSettings?.canonicalBaseUrl ? `${seoSettings.canonicalBaseUrl}/use-cases` : undefined}
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
        {/* Hero Section - Vibrant Gradient */}
        <section className="relative py-20 md:py-32 overflow-hidden">
          {/* Background Gradient - Professional Navy */}
          <div className="absolute inset-0 bg-gradient-to-br from-[#0a1628] via-[#0f2847] to-[#0a1628]" />
          
          {/* Animated Gradient Orbs */}
          <div className="absolute inset-0 overflow-hidden">
            <FloatingParticle delay={0} duration={8} x="10%" y="20%" size={300} />
            <FloatingParticle delay={2} duration={10} x="70%" y="10%" size={400} />
            <FloatingParticle delay={4} duration={9} x="80%" y="60%" size={250} />
            <FloatingParticle delay={1} duration={11} x="20%" y="70%" size={350} />
            <FloatingParticle delay={3} duration={7} x="50%" y="40%" size={200} />
          </div>
          
          {/* Grid Pattern Overlay */}
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxwYXRoIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iLjAyIiBkPSJNMCAwaDYwdjYwSDB6Ii8+PHBhdGggZD0iTTYwIDBIMHY2MCIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utb3BhY2l0eT0iLjAzIi8+PC9nPjwvc3ZnPg==')] opacity-50" />

          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="text-center"
            >
              <motion.div variants={itemVariants} className="mb-6">
                <Badge className="bg-gradient-to-r from-brand/20 to-amber-500/20 text-brand border-brand/30 px-4 py-1.5 text-sm">
                  <Sparkles className="w-4 h-4 mr-2" />
                  {t('landing.useCasesPage.hero.badge')}
                </Badge>
              </motion.div>

              <motion.h1 
                variants={itemVariants}
                className="text-4xl md:text-5xl lg:text-7xl font-bold mb-6 text-white"
              >
                {t('landing.useCasesPage.hero.title')}{" "}
                <span className="bg-gradient-to-r from-brand via-brand/70 to-amber-400 bg-clip-text text-transparent">
                  {t('landing.useCasesPage.hero.titleHighlight')}
                </span>
              </motion.h1>
              
              <motion.p 
                variants={itemVariants}
                className="text-lg md:text-xl text-zinc-400 max-w-3xl mx-auto mb-10"
              >
                {t('landing.useCasesPage.hero.subtitle')}
              </motion.p>

              {/* Platform Features */}
              <motion.div 
                variants={itemVariants}
                className="flex flex-wrap justify-center gap-4 mb-12"
              >
                {platformFeatures.map((feature, i) => (
                  <div 
                    key={i}
                    className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 backdrop-blur-sm"
                  >
                    <div className="text-brand">{feature.icon}</div>
                    <div className="text-left">
                      <div className="text-white text-sm font-medium">{feature.label}</div>
                      <div className="text-zinc-500 text-xs">{feature.description}</div>
                    </div>
                  </div>
                ))}
              </motion.div>

              {/* Industry badges */}
              <motion.div variants={itemVariants} className="flex flex-wrap justify-center gap-3">
                {industries.map((industry, i) => (
                  <motion.div
                    key={i}
                    whileHover={{ scale: 1.05, y: -2 }}
                    className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-gradient-to-r ${industry.color} bg-opacity-10 border border-white/10 backdrop-blur-sm cursor-default`}
                  >
                    <span className="text-white">{industry.icon}</span>
                    <span className="text-sm font-medium text-white">{industry.name}</span>
                  </motion.div>
                ))}
              </motion.div>
            </motion.div>
          </div>

        </section>

        {/* Use Cases Section */}
        <section className="py-8 lg:py-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            {useCases.map((useCase, index) => (
              <div 
                key={index} 
                className={index < useCases.length - 1 ? "border-b border-border/50" : ""}
              >
                <UseCase {...useCase} />
              </div>
            ))}
          </div>
        </section>

        {/* Stats Section */}
        <section className="py-20 md:py-32 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-brand/10 via-transparent to-amber-500/10" />
          
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-16"
            >
              <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4">
                {t('landing.useCasesPage.statsSection.title')}
              </h2>
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                {t('landing.useCasesPage.statsSection.subtitle')}
              </p>
            </motion.div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 lg:gap-8">
              {[
                { value: "10M+", label: t('landing.useCasesPage.statsSection.callsMade'), icon: <Phone className="w-6 h-6" /> },
                { value: "5,000+", label: t('landing.useCasesPage.statsSection.businesses'), icon: <Building2 className="w-6 h-6" /> },
                { value: "99.9%", label: t('landing.useCasesPage.statsSection.uptime'), icon: <Zap className="w-6 h-6" /> },
                { value: "30+", label: t('landing.useCasesPage.statsSection.languages'), icon: <Globe className="w-6 h-6" /> },
              ].map((stat, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="text-center p-6 lg:p-8 rounded-3xl bg-card border border-border/50 hover-elevate"
                >
                  <div className="w-12 h-12 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-brand/20 to-amber-500/20 flex items-center justify-center text-brand">
                    {stat.icon}
                  </div>
                  <div className="text-3xl lg:text-4xl font-bold bg-gradient-to-r from-brand to-amber-400 bg-clip-text text-transparent">
                    {stat.value}
                  </div>
                  <div className="text-muted-foreground mt-2">{stat.label}</div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-20 md:py-32 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900" />
          
          {/* Animated Background */}
          <div className="absolute inset-0 overflow-hidden">
            <FloatingParticle delay={0} duration={10} x="5%" y="30%" size={400} />
            <FloatingParticle delay={3} duration={8} x="85%" y="20%" size={300} />
            <FloatingParticle delay={5} duration={12} x="50%" y="60%" size={350} />
          </div>

          <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="space-y-8"
            >
              <Badge className="bg-gradient-to-r from-brand/20 to-amber-500/20 text-brand border-brand/30 px-4 py-1.5">
                <Sparkles className="w-4 h-4 mr-2" />
                {t('landing.useCasesPage.ctaSection.badge')}
              </Badge>

              <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white">
                {t('landing.useCasesPage.ctaSection.title')}{" "}
                <span className="bg-gradient-to-r from-brand to-amber-400 bg-clip-text text-transparent">
                  {t('landing.useCasesPage.ctaSection.titleHighlight')}
                </span>
              </h2>
              
              <p className="text-lg text-zinc-400 max-w-2xl mx-auto">
                {t('landing.useCasesPage.ctaSection.subtitle')}
              </p>

              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link href="/login">
                  <Button size="lg" className="cta-button text-white font-medium border-0 h-14 px-8 text-lg">
                    {t('landing.useCasesPage.ctaSection.startFreeTrial')}
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </Link>
                <Link href="/pricing">
                  <Button size="lg" variant="outline" className="h-14 px-8 text-lg border-white/20 text-white hover:bg-white/10">
                    {t('landing.useCasesPage.ctaSection.viewPricing')}
                  </Button>
                </Link>
              </div>

              <p className="text-sm text-zinc-500">
                {t('landing.useCasesPage.ctaSection.trustMessage')}
              </p>
            </motion.div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
