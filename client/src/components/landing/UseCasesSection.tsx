/**
 * ============================================================
 * UseCasesSection - awaz.ai Exact Design Match
 * Dark theme industry use case cards
 * ============================================================
 */
import { motion, useInView } from "framer-motion";
import { Building2, GraduationCap, Car, Headphones, ShoppingCart, Heart } from "lucide-react";
import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";

interface UseCaseCardProps {
  icon: React.ReactNode;
  flag: string;
  title: string;
  description: string;
  industry: string;
  language: string;
  functionLabel: string;
  isActive: boolean;
  onClick: () => void;
  index: number;
  useCaseLabel: string;
  industryLabel: string;
  languageLabel: string;
  functionLabelText: string;
}

const UseCaseCard = ({ 
  icon, 
  flag, 
  title, 
  description, 
  industry, 
  language, 
  functionLabel,
  isActive,
  onClick,
  index,
  useCaseLabel,
  industryLabel,
  languageLabel,
  functionLabelText
}: UseCaseCardProps) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true }}
    transition={{ duration: 0.5, delay: index * 0.1 }}
    whileHover={{ y: -5 }}
    onClick={onClick}
    className={`bg-gray-900/50 rounded-2xl border p-6 cursor-pointer transition-all duration-300 ${
      isActive 
        ? 'border-brand shadow-lg shadow-brand/20' 
        : 'border-gray-800 hover:border-gray-700'
    }`}
    data-testid={`use-case-card-${title.toLowerCase().replace(/\s+/g, "-").slice(0, 20)}`}
  >
    <div className="flex items-center gap-2 mb-4">
      <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">{useCaseLabel}</span>
    </div>
    
    <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
      {title} <span>{flag}</span>
    </h3>
    
    <p className="text-sm text-gray-400 mb-6">{description}</p>
    
    <div className="grid grid-cols-3 gap-4 text-xs">
      <div>
        <div className="text-gray-500 mb-1">{industryLabel}</div>
        <div className="font-medium text-white">{industry}</div>
      </div>
      <div>
        <div className="text-gray-500 mb-1">{languageLabel}</div>
        <div className="font-medium text-white">{language}</div>
      </div>
      <div>
        <div className="text-gray-500 mb-1">{functionLabelText}</div>
        <div className="font-medium text-white">{functionLabel}</div>
      </div>
    </div>
  </motion.div>
);

export function UseCasesSection() {
  const { t } = useTranslation();
  const [activeIndex, setActiveIndex] = useState(0);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });

  const useCases = [
    {
      icon: <Building2 />,
      flag: "US",
      key: "saas"
    },
    {
      icon: <GraduationCap />,
      flag: "SG",
      key: "university"
    },
    {
      icon: <Car />,
      flag: "BR",
      key: "automotive"
    },
    {
      icon: <Headphones />,
      flag: "IN",
      key: "support"
    },
    {
      icon: <ShoppingCart />,
      flag: "UK",
      key: "ecommerce"
    },
    {
      icon: <Heart />,
      flag: "DE",
      key: "healthcare"
    }
  ];

  return (
    <section 
      ref={ref}
      className="py-20 md:py-32 bg-navy-900" 
      data-testid="use-cases-section"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-4">
            {t('landing.useCasesSection.title')}
          </h2>
          <p className="text-lg text-gray-400 max-w-2xl mx-auto">
            {t('landing.useCasesSection.description')}
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {useCases.map((useCase, index) => (
            <UseCaseCard
              key={index}
              icon={useCase.icon}
              flag={useCase.flag}
              title={t(`landing.useCasesSection.cases.${useCase.key}.title`)}
              description={t(`landing.useCasesSection.cases.${useCase.key}.description`)}
              industry={t(`landing.useCasesSection.cases.${useCase.key}.industry`)}
              language={t(`landing.useCasesSection.cases.${useCase.key}.language`)}
              functionLabel={t(`landing.useCasesSection.cases.${useCase.key}.function`)}
              isActive={activeIndex === index}
              onClick={() => setActiveIndex(index)}
              index={index}
              useCaseLabel={t('landing.useCasesSection.useCaseLabel')}
              industryLabel={t('landing.useCasesSection.industryLabel')}
              languageLabel={t('landing.useCasesSection.languageLabel')}
              functionLabelText={t('landing.useCasesSection.functionLabel')}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

export default UseCasesSection;
