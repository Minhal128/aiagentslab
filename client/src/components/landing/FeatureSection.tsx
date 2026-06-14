/**
 * ============================================================
 * FeatureSection - awaz.ai Exact Design Match
 * Dark theme, connecting lines, alternating layouts, UI mockups
 * ============================================================
 */
import { motion, useInView, useScroll, useTransform } from "framer-motion";
import { Check, User, Calendar, MessageSquare, Phone, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

const rollingPopupVariant = {
  hidden: { 
    opacity: 0, 
    y: 30, 
    rotate: -3, 
    scale: 0.95 
  },
  visible: { 
    opacity: 1, 
    y: 0, 
    rotate: 0, 
    scale: 1,
    transition: {
      type: "spring",
      stiffness: 100,
      damping: 15
    }
  }
};

const CapabilityBadge = ({ text, delay }: { text: string; delay: number }) => (
  <motion.div 
    className="flex items-center gap-1.5"
    variants={rollingPopupVariant}
    initial="hidden"
    whileInView="visible"
    viewport={{ once: true }}
    transition={{ delay }}
  >
    <div className="w-4 h-4 rounded-full bg-brand/20 flex items-center justify-center">
      <Check className="h-2.5 w-2.5 text-brand" />
    </div>
    <span className="text-brand font-medium text-sm">{text}</span>
  </motion.div>
);

const ConnectingLine = () => {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"]
  });
  
  const pathLength = useTransform(scrollYProgress, [0, 0.5], [0, 1]);
  
  return (
    <div ref={ref} className="flex justify-center py-8">
      <svg 
        width="4" 
        height="120" 
        viewBox="0 0 4 120" 
        fill="none" 
        className="overflow-visible"
      >
        <motion.path
          d="M2 0 Q2 30 2 60 Q2 90 2 120"
          stroke="url(#connectingGradient)"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
          style={{ pathLength }}
        />
        <defs>
          <linearGradient id="connectingGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="transparent" />
            <stop offset="50%" stopColor="#14b8a6" />
            <stop offset="100%" stopColor="transparent" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
};

const VoiceAgentMockup = () => {
  const { t } = useTranslation();
  
  return (
    <div className="relative">
      <div className="absolute -inset-4 bg-gradient-to-r from-brand/20 to-brand/10 rounded-3xl blur-2xl" />
      <div className="relative bg-gradient-to-br from-gray-900 to-gray-950 rounded-2xl border border-gray-800 p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 rounded-lg border border-gray-700">
            <span className="text-sm text-gray-300">{t('landing.featureSection.mockup.language')}</span>
            <Check className="w-3 h-3 text-gray-500" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-brand/20 rounded-lg border border-brand/20">
            <span className="text-sm text-brand">{t('landing.featureSection.mockup.voice')}</span>
            <Check className="w-3 h-3 text-brand" />
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-amber-600 to-amber-800 flex items-center justify-center overflow-hidden">
            <div className="w-16 h-16 rounded-full bg-amber-700 flex items-center justify-center">
              <User className="w-10 h-10 text-amber-200" />
            </div>
          </div>
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">{t('landing.featureSection.mockup.stability')}</span>
              <div className="flex-1 h-1.5 bg-gray-700 rounded-full">
                <div className="w-3/4 h-full bg-brand rounded-full" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">{t('landing.featureSection.mockup.speed')}</span>
              <div className="flex-1 h-1.5 bg-gray-700 rounded-full">
                <div className="w-1/2 h-full bg-brand rounded-full" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">{t('landing.featureSection.mockup.diarization')}</span>
              <div className="flex-1 h-1.5 bg-gray-700 rounded-full">
                <div className="w-2/3 h-full bg-brand rounded-full" />
              </div>
            </div>
          </div>
        </div>
        <Button size="sm" className="bg-brand text-brand-foreground text-xs">
          {t('landing.featureSection.mockup.createAgent')}
        </Button>
        <div className="flex items-center gap-4 pt-2 border-t border-gray-800">
          <div className="w-8 h-8 rounded-lg bg-red-900/50 flex items-center justify-center">
            <MessageSquare className="w-4 h-4 text-red-400" />
          </div>
          <div className="w-8 h-8 rounded-lg bg-brand/20 flex items-center justify-center">
            <Phone className="w-4 h-4 text-brand" />
          </div>
          <div className="w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center">
            <Settings className="w-4 h-4 text-gray-400" />
          </div>
        </div>
      </div>
    </div>
  );
};

const CallSchedulerMockup = () => {
  const { t } = useTranslation();
  
  return (
    <div className="relative">
      <div className="absolute -inset-4 bg-gradient-to-r from-brand/20 to-brand/10 rounded-3xl blur-2xl" />
      <div className="relative bg-gradient-to-br from-[#0a1e2e] to-[#051520] rounded-2xl border border-brand/20 p-6 overflow-hidden">
        <div className="absolute inset-0 opacity-20">
          <div className="grid grid-cols-20 gap-1 p-4">
            {[...Array(200)].map((_, i) => (
              <div 
                key={i} 
                className={`w-1 h-1 rounded-full ${Math.random() > 0.7 ? 'bg-brand' : 'bg-transparent'}`}
              />
            ))}
          </div>
        </div>
        
        <div className="relative space-y-4">
          <div className="flex items-center gap-2 px-3 py-2 bg-white/10 rounded-lg border border-white/20 w-fit">
            <User className="w-4 h-4 text-white" />
            <span className="text-sm text-white">{t('landing.featureSection.mockup.selectAgent')}</span>
          </div>
          
          <div className="ml-8 space-y-3">
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-900/50 rounded-lg border border-gray-700 w-fit">
              <span className="text-sm text-gray-300">{t('landing.featureSection.mockup.outboundCall')}</span>
              <Check className="w-3 h-3 text-gray-500" />
            </div>
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-900/50 rounded-lg border border-gray-700 w-fit">
              <span className="text-sm text-brand">{t('landing.featureSection.mockup.startDate')}</span>
              <Check className="w-3 h-3 text-brand" />
            </div>
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-900/50 rounded-lg border border-brand/40 w-fit">
              <span className="text-sm text-brand">{t('landing.featureSection.mockup.endDate')}</span>
              <Check className="w-3 h-3 text-brand" />
            </div>
          </div>
          
          <div className="flex items-center gap-2 px-3 py-2 bg-white/10 rounded-lg border border-white/20 w-fit">
            <Calendar className="w-4 h-4 text-white" />
            <span className="text-sm text-white">{t('landing.featureSection.mockup.selectList')}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const ConversionMockup = () => {
  const { t } = useTranslation();
  
  return (
    <div className="relative">
      <div className="absolute -inset-4 bg-gradient-to-r from-brand/20 to-brand/10 rounded-3xl blur-2xl" />
      <div className="relative space-y-4">
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-gray-800 to-gray-900 border border-gray-700 flex items-center justify-center shadow-xl">
            <div className="w-8 h-8 text-white">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" fill="none"/>
              </svg>
            </div>
          </div>
        </div>
        
        <div className="space-y-3 px-8">
          <div className="flex items-center gap-3 px-4 py-3 bg-brand/20 rounded-xl border border-brand/20">
            <User className="w-5 h-5 text-brand" />
            <span className="text-sm font-medium text-white">{t('landing.featureSection.mockup.collectContactDetails')}</span>
          </div>
          <div className="flex items-center gap-3 px-4 py-3 bg-brand/20 rounded-xl border border-brand/20">
            <Calendar className="w-5 h-5 text-brand" />
            <span className="text-sm font-medium text-white">{t('landing.featureSection.mockup.bookAppointments')}</span>
          </div>
          <div className="flex items-center gap-3 px-4 py-3 bg-brand/20 rounded-xl border border-brand/20">
            <Check className="w-5 h-5 text-brand" />
            <span className="text-sm font-medium text-white">{t('landing.featureSection.mockup.qualifyLeads')}</span>
          </div>
        </div>
        
        <div className="flex justify-center">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 border-2 border-brand/30 flex items-center justify-center shadow-xl overflow-hidden">
            <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
              <User className="w-10 h-10 text-white" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

interface FeatureCardProps {
  title: string;
  description: string;
  bullets: string[];
  mockup: React.ReactNode;
  imagePosition: "left" | "right";
}

const FeatureCard = ({ title, description, bullets, mockup, imagePosition }: FeatureCardProps) => {
  const { t } = useTranslation();
  const isLeft = imagePosition === "left";
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 40, rotate: -2, scale: 0.97 }}
      whileInView={{ opacity: 1, y: 0, rotate: 0, scale: 1 }}
      viewport={{ once: true, margin: "-100px" }}
      transition={{ 
        duration: 0.7, 
        type: "spring",
        stiffness: 80,
        damping: 20
      }}
      className="py-8 md:py-12"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className={`grid md:grid-cols-2 gap-12 lg:gap-20 items-center`}>
          <div className={isLeft ? "order-2 md:order-2" : "order-2 md:order-1"}>
            <div className="bg-gray-900/50 rounded-2xl border border-gray-800 p-8">
              <h3 className="text-2xl md:text-3xl font-bold text-white mb-4">{title}</h3>
              <p className="text-gray-400 mb-6 leading-relaxed">{description}</p>
              
              <ul className="space-y-3 mb-8">
                {bullets.map((bullet, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-brand/20 flex items-center justify-center mt-0.5 shrink-0">
                      <Check className="h-3 w-3 text-brand" />
                    </div>
                    <span className="text-gray-300">{bullet}</span>
                  </li>
                ))}
              </ul>

              <div className="space-y-4">
                <Link href="/login">
                  <Button 
                    className="bg-transparent hover:bg-brand/10 text-brand font-semibold border-2 border-brand/30 hover:border-brand rounded-lg px-6"
                    data-testid={`button-feature-cta-${title.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    {t('landing.featureSection.getStarted')}
                  </Button>
                </Link>
                <div className="flex items-center gap-4 text-sm text-gray-500">
                  <div className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-brand" />
                    <span>{t('landing.featureSection.freeTrial')}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-brand" />
                    <span>{t('landing.featureSection.freeCredit')}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className={isLeft ? "order-1 md:order-1" : "order-1 md:order-2"}>
            {mockup}
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export function FeatureSection() {
  const { t } = useTranslation();
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });
  
  return (
    <section 
      ref={ref}
      className="relative bg-navy-900" 
      data-testid="feature-section"
    >
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-4 text-center">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-4"
        >
          {t('landing.featureSection.title')}
        </motion.h2>
        
        <div className="flex flex-wrap justify-center gap-3 md:gap-5">
          <CapabilityBadge text={t('landing.featureSection.capabilities.bookMeetings')} delay={0} />
          <CapabilityBadge text={t('landing.featureSection.capabilities.conductInterviews')} delay={0.1} />
          <CapabilityBadge text={t('landing.featureSection.capabilities.coldCallProspects')} delay={0.2} />
          <CapabilityBadge text={t('landing.featureSection.capabilities.offerSupport')} delay={0.3} />
        </div>
      </div>

      <FeatureCard
        title={t('landing.featureSection.feature1.title')}
        description={t('landing.featureSection.feature1.description')}
        bullets={[
          t('landing.featureSection.feature1.bullet1'),
          t('landing.featureSection.feature1.bullet2'),
          t('landing.featureSection.feature1.bullet3')
        ]}
        mockup={<VoiceAgentMockup />}
        imagePosition="right"
      />

      <ConnectingLine />

      <FeatureCard
        title={t('landing.featureSection.feature2.title')}
        description={t('landing.featureSection.feature2.description')}
        bullets={[
          t('landing.featureSection.feature2.bullet1'),
          t('landing.featureSection.feature2.bullet2')
        ]}
        mockup={<CallSchedulerMockup />}
        imagePosition="left"
      />

      <ConnectingLine />

      <FeatureCard
        title={t('landing.featureSection.feature3.title')}
        description={t('landing.featureSection.feature3.description')}
        bullets={[
          t('landing.featureSection.feature3.bullet1'),
          t('landing.featureSection.feature3.bullet2'),
          t('landing.featureSection.feature3.bullet3'),
          t('landing.featureSection.feature3.bullet4')
        ]}
        mockup={<ConversionMockup />}
        imagePosition="right"
      />
    </section>
  );
}

export default FeatureSection;
