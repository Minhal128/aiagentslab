/**
 * ============================================================
 * ActionCardsSection - awaz.ai Exact Design Match
 * Dark theme action cards grid for automation features
 * ============================================================
 */
import { motion, useInView } from "framer-motion";
import { MessageSquare, PhoneForwarded, Webhook, Mail, MessageCircle, Calendar, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

interface ActionCardProps {
  icon: React.ReactNode;
  title: string;
  delay: number;
}

const ActionCard = ({ icon, title, delay }: ActionCardProps) => (
  <motion.div
    initial={{ opacity: 0, y: 30 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true }}
    transition={{ duration: 0.5, delay }}
    whileHover={{ y: -5, scale: 1.02 }}
    className="bg-navy-800/50 rounded-2xl border border-brand/10 p-6 hover:border-brand/30 hover:shadow-xl hover:shadow-brand/10 transition-all duration-300"
    data-testid={`action-card-${title.toLowerCase().replace(/\s+/g, "-").slice(0, 20)}`}
  >
    <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-brand to-brand/90 flex items-center justify-center mb-4 shadow-lg shadow-brand/25">
      <div className="text-white">
        {icon}
      </div>
    </div>
    <h3 className="font-semibold text-white leading-relaxed">{title}</h3>
  </motion.div>
);

export function ActionCardsSection() {
  const { t } = useTranslation();
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });

  const actions = [
    {
      icon: <MessageSquare className="w-6 h-6" />,
      title: t('landing.actionCards.cards.sms')
    },
    {
      icon: <PhoneForwarded className="w-6 h-6" />,
      title: t('landing.actionCards.cards.transfer')
    },
    {
      icon: <Webhook className="w-6 h-6" />,
      title: t('landing.actionCards.cards.webhooks')
    },
    {
      icon: <Mail className="w-6 h-6" />,
      title: t('landing.actionCards.cards.email')
    },
    {
      icon: <MessageCircle className="w-6 h-6" />,
      title: t('landing.actionCards.cards.whatsapp')
    },
    {
      icon: <Calendar className="w-6 h-6" />,
      title: t('landing.actionCards.cards.appointments')
    }
  ];

  return (
    <section 
      ref={ref}
      className="py-20 md:py-32 bg-navy-900" 
      data-testid="action-cards-section"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-4">
            {t('landing.actionCards.title')}
          </h2>
          <p className="text-lg text-gray-400 max-w-2xl mx-auto">
            {t('landing.actionCards.description')}
          </p>
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {actions.map((action, index) => (
            <ActionCard
              key={index}
              icon={action.icon}
              title={action.title}
              delay={index * 0.1}
            />
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="text-center mt-12"
        >
          <Link href="/login">
            <Button 
              className="bg-brand text-brand-foreground font-semibold border-0 h-12 px-8 rounded-full shadow-lg shadow-brand/25"
              data-testid="button-actions-get-started"
            >
              {t('landing.actionCards.getStarted')}
            </Button>
          </Link>
          <div className="flex items-center justify-center gap-6 mt-4 text-sm text-gray-500">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-brand" />
              <span>{t('landing.actionCards.freeTrial')}</span>
            </div>
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-brand" />
              <span>{t('landing.actionCards.freeCredit')}</span>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

export default ActionCardsSection;
