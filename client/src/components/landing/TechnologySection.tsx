/**
 * ============================================================
 * TechnologySection - awaz.ai Exact Design Match
 * Dark theme technology features grid
 * ============================================================
 */
import { motion, useInView } from "framer-motion";
import { 
  Zap, Mic, Brain, Users, Globe, Calendar, 
  Check, Sparkles, Volume2, MessageSquare
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

interface TechFeatureProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  delay: number;
}

const TechFeature = ({ icon, title, description, delay }: TechFeatureProps) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true }}
    transition={{ duration: 0.5, delay }}
    className="flex gap-4 p-4"
  >
    <div className="w-12 h-12 rounded-xl bg-brand/20 border border-brand/20 flex items-center justify-center shrink-0">
      <div className="text-brand">
        {icon}
      </div>
    </div>
    <div>
      <h3 className="font-semibold text-white mb-1">{title}</h3>
      <p className="text-sm text-gray-400">{description}</p>
    </div>
  </motion.div>
);

export function TechnologySection() {
  const { t } = useTranslation();
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });

  const techFeatures = [
    {
      icon: <Zap className="w-5 h-5" />,
      title: t('landing.technology.features.autopilot.title'),
      description: t('landing.technology.features.autopilot.description')
    },
    {
      icon: <Volume2 className="w-5 h-5" />,
      title: t('landing.technology.features.voiceCustomization.title'),
      description: t('landing.technology.features.voiceCustomization.description')
    },
    {
      icon: <Brain className="w-5 h-5" />,
      title: t('landing.technology.features.sentimentAnalysis.title'),
      description: t('landing.technology.features.sentimentAnalysis.description')
    },
    {
      icon: <MessageSquare className="w-5 h-5" />,
      title: t('landing.technology.features.diarization.title'),
      description: t('landing.technology.features.diarization.description')
    },
    {
      icon: <Globe className="w-5 h-5" />,
      title: t('landing.technology.features.globalConversations.title'),
      description: t('landing.technology.features.globalConversations.description')
    },
    {
      icon: <Calendar className="w-5 h-5" />,
      title: t('landing.technology.features.realTimeBookings.title'),
      description: t('landing.technology.features.realTimeBookings.description')
    }
  ];

  return (
    <section 
      ref={ref}
      className="py-20 md:py-32 bg-gradient-to-b from-navy-900 via-navy-800 to-navy-900" 
      data-testid="technology-section"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.6 }}
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand/10 border border-brand/20 mb-6">
              <Sparkles className="w-4 h-4 text-brand" />
              <span className="text-sm font-medium text-brand">
                {t('landing.technology.badge')}
              </span>
            </div>
            
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-6">
              {t('landing.technology.title')}
            </h2>
            
            <ul className="space-y-4 mb-8">
              <li className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-brand/20 flex items-center justify-center mt-0.5 shrink-0">
                  <Check className="h-3 w-3 text-brand" />
                </div>
                <span className="text-gray-400">{t('landing.technology.benefits.cutCosts')}</span>
              </li>
              <li className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-brand/20 flex items-center justify-center mt-0.5 shrink-0">
                  <Check className="h-3 w-3 text-brand" />
                </div>
                <span className="text-gray-400">{t('landing.technology.benefits.millionCalls')}</span>
              </li>
              <li className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-brand/20 flex items-center justify-center mt-0.5 shrink-0">
                  <Check className="h-3 w-3 text-brand" />
                </div>
                <span className="text-gray-400">{t('landing.technology.benefits.reduceAttrition')}</span>
              </li>
            </ul>

            <Link href="/login">
              <Button 
                className="bg-brand text-brand-foreground font-semibold border-0 h-12 px-8 rounded-full shadow-lg shadow-brand/25"
                data-testid="button-tech-get-started"
              >
                {t('landing.technology.getStarted')}
              </Button>
            </Link>
            <div className="flex items-center gap-6 mt-4 text-sm text-gray-500">
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-brand" />
                <span>{t('landing.technology.freeTrial')}</span>
              </div>
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-brand" />
                <span>{t('landing.technology.freeCredit')}</span>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="grid sm:grid-cols-2 gap-2"
          >
            {techFeatures.map((feature, index) => (
              <TechFeature
                key={index}
                icon={feature.icon}
                title={feature.title}
                description={feature.description}
                delay={index * 0.1}
              />
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
}

export default TechnologySection;
