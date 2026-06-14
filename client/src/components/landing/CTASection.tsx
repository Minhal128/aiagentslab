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
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMemo, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";

interface FloatingParticleProps {
  index: number;
  reducedMotion: boolean;
}

const FloatingParticle = ({ index, reducedMotion }: FloatingParticleProps) => {
  const [dimensions, setDimensions] = useState({ width: 1200 });

  useEffect(() => {
    setDimensions({
      width: window.innerWidth,
    });
  }, []);

  const randomValues = useMemo(
    () => ({
      initialX: Math.random() * dimensions.width,
      initialY: 300 + Math.random() * 200,
      duration: 3 + Math.random() * 2,
      delay: Math.random() * 3,
      size: 1 + Math.random() * 1.5,
    }),
    [dimensions.width]
  );

  if (reducedMotion) {
    return (
      <div
        className="absolute w-2 h-2 bg-amber-400/30 rounded-full"
        style={{
          left: randomValues.initialX,
          top: randomValues.initialY,
          width: randomValues.size,
          height: randomValues.size,
        }}
        data-testid={`cta-particle-${index}`}
      />
    );
  }

  return (
    <motion.div
      className="absolute bg-amber-400/30 rounded-full"
      style={{
        width: randomValues.size * 2,
        height: randomValues.size * 2,
      }}
      initial={{
        x: randomValues.initialX,
        y: randomValues.initialY,
      }}
      animate={{
        y: [null, -400],
        opacity: [0, 1, 0],
      }}
      transition={{
        duration: randomValues.duration,
        repeat: Infinity,
        delay: randomValues.delay,
        ease: "linear",
      }}
      data-testid={`cta-particle-${index}`}
    />
  );
};

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.15,
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

export function CTASection() {
  const [, setLocation] = useLocation();
  const shouldReduceMotion = useReducedMotion();
  const particleCount = 20;
  const { t } = useTranslation();

  const handleNavigate = () => {
    setLocation("/login");
  };

  return (
    <section
      className="py-12 sm:py-16 md:py-24 lg:py-32 relative overflow-hidden"
      data-testid="cta-section"
    >
      <div 
        className="absolute inset-0 bg-gradient-to-br from-amber-900 via-stone-900 to-stone-950 opacity-95"
        data-testid="cta-background"
      />
      
      <div 
        className="absolute inset-0 overflow-hidden pointer-events-none"
        data-testid="cta-particle-field"
      >
        {[...Array(particleCount)].map((_, i) => (
          <FloatingParticle
            key={i}
            index={i}
            reducedMotion={shouldReduceMotion ?? false}
          />
        ))}
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
        <motion.div
          variants={shouldReduceMotion ? {} : containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="space-y-8"
        >
          <motion.h2
            variants={shouldReduceMotion ? {} : itemVariants}
            className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold text-white"
            data-testid="cta-headline"
          >
            {t('landing.cta.title')}
          </motion.h2>

          <motion.p
            variants={shouldReduceMotion ? {} : itemVariants}
            className="text-sm sm:text-base md:text-lg text-white/90 max-w-2xl mx-auto"
            data-testid="cta-subheadline"
          >
            {t('landing.cta.description')}
          </motion.p>

          <motion.div
            variants={shouldReduceMotion ? {} : itemVariants}
            className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-4"
          >
            <Button
              size="lg"
              className="h-14 px-8 text-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-600 hover:to-orange-600 shadow-2xl shadow-amber-900/40 group font-semibold border-0"
              onClick={handleNavigate}
              data-testid="button-cta-get-started"
            >
              {t('landing.cta.button')}
              <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform duration-200" />
            </Button>
          </motion.div>

          <motion.p
            variants={shouldReduceMotion ? {} : itemVariants}
            className="text-white/80 text-sm"
            data-testid="cta-trust-message"
          >
            {t('landing.cta.trustMessage')}
          </motion.p>
        </motion.div>
      </div>
    </section>
  );
}

export default CTASection;
