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
import { motion } from "framer-motion";
import { Mic2, Calendar, Webhook, Bot } from "lucide-react";
import {
  SiTwilio,
  SiStripe,
  SiZapier,
  SiOpenai,
  SiSlack,
  SiNotion,
  SiHubspot,
  SiSalesforce,
} from "react-icons/si";
import { useBranding } from "@/components/BrandingProvider";
import { ComponentType } from "react";
import { useTranslation } from "react-i18next";

interface Integration {
  name: string;
  icon: ComponentType<{ className?: string }>;
  color: string;
  bgColor: string;
  position: { x: number; y: number };
  size: "sm" | "md" | "lg";
  delay: number;
}

const integrations: Integration[] = [
  {
    name: "Salesforce",
    icon: SiSalesforce,
    color: "#00A1E0",
    bgColor: "bg-white",
    position: { x: 5, y: 75 },
    size: "md",
    delay: 0,
  },
  {
    name: "Slack",
    icon: SiSlack,
    color: "#4A154B",
    bgColor: "bg-white",
    position: { x: 12, y: 55 },
    size: "sm",
    delay: 0.1,
  },
  {
    name: "Twilio",
    icon: SiTwilio,
    color: "#F22F46",
    bgColor: "bg-white",
    position: { x: 20, y: 70 },
    size: "md",
    delay: 0.2,
  },
  {
    name: "Zapier",
    icon: SiZapier,
    color: "#FF4A00",
    bgColor: "bg-white",
    position: { x: 28, y: 50 },
    size: "sm",
    delay: 0.3,
  },
  {
    name: "ElevenLabs",
    icon: Mic2,
    color: "#000000",
    bgColor: "bg-white",
    position: { x: 38, y: 65 },
    size: "md",
    delay: 0.4,
  },
  {
    name: "Notion",
    icon: SiNotion,
    color: "#000000",
    bgColor: "bg-white",
    position: { x: 48, y: 45 },
    size: "md",
    delay: 0.5,
  },
  {
    name: "OpenAI",
    icon: SiOpenai,
    color: "#10A37F",
    bgColor: "bg-white",
    position: { x: 58, y: 60 },
    size: "md",
    delay: 0.6,
  },
  {
    name: "Cal.com",
    icon: Calendar,
    color: "#292929",
    bgColor: "bg-white",
    position: { x: 75, y: 35 },
    size: "sm",
    delay: 0.8,
  },
  {
    name: "Stripe",
    icon: SiStripe,
    color: "#635BFF",
    bgColor: "bg-white",
    position: { x: 82, y: 55 },
    size: "md",
    delay: 0.9,
  },
  {
    name: "HubSpot",
    icon: SiHubspot,
    color: "#FF7A59",
    bgColor: "bg-white",
    position: { x: 92, y: 40 },
    size: "sm",
    delay: 1.0,
  },
];

const sizeClasses = {
  sm: "w-12 h-12 md:w-14 md:h-14",
  md: "w-14 h-14 md:w-16 md:h-16",
  lg: "w-20 h-20 md:w-24 md:h-24",
};

const iconSizeClasses = {
  sm: "w-5 h-5 md:w-6 md:h-6",
  md: "w-6 h-6 md:w-7 md:h-7",
  lg: "w-10 h-10 md:w-12 md:h-12",
};

interface IntegrationBubbleProps {
  integration: Integration;
}

function IntegrationBubble({ integration }: IntegrationBubbleProps) {
  const IconComponent = integration.icon;

  return (
    <motion.div
      className="absolute"
      style={{
        left: `${integration.position.x}%`,
        top: `${integration.position.y}%`,
        transform: "translate(-50%, -50%)",
      }}
      initial={{ opacity: 0, scale: 0 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true }}
      transition={{
        duration: 0.5,
        delay: integration.delay,
        type: "spring",
        stiffness: 200,
      }}
      data-testid={`integration-bubble-${integration.name.toLowerCase().replace(".", "-")}`}
    >
      <motion.div
        className={`${sizeClasses[integration.size]} ${integration.bgColor} rounded-full shadow-lg flex items-center justify-center cursor-pointer`}
        style={{
          boxShadow: `0 4px 20px ${integration.color}20`,
        }}
        animate={{
          y: [0, -8, 0],
        }}
        transition={{
          duration: 3 + integration.delay,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        whileHover={{
          scale: 1.15,
          boxShadow: `0 8px 30px ${integration.color}40`,
        }}
      >
        <span style={{ color: integration.color }}>
          <IconComponent className={iconSizeClasses[integration.size]} />
        </span>
      </motion.div>
      <motion.div
        className="absolute -bottom-6 left-1/2 transform -translate-x-1/2 whitespace-nowrap text-xs font-medium text-white/80 opacity-0 group-hover:opacity-100"
        initial={{ opacity: 0 }}
        whileHover={{ opacity: 1 }}
      >
        {integration.name}
      </motion.div>
    </motion.div>
  );
}

function CentralHub() {
  const { branding } = useBranding();

  return (
    <motion.div
      className="absolute"
      style={{
        left: "68%",
        top: "55%",
        transform: "translate(-50%, -50%)",
      }}
      initial={{ opacity: 0, scale: 0 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true }}
      transition={{
        duration: 0.6,
        delay: 0.7,
        type: "spring",
        stiffness: 150,
      }}
      data-testid="integration-central-hub"
    >
      <motion.div
        className="w-24 h-24 md:w-32 md:h-32 rounded-full flex items-center justify-center relative"
        style={{
          background:
            "linear-gradient(135deg, rgba(255,200,180,0.9) 0%, rgba(255,170,140,0.95) 100%)",
          boxShadow:
            "0 0 60px rgba(255,150,100,0.4), 0 0 100px rgba(255,180,150,0.2)",
        }}
        animate={{
          scale: [1, 1.05, 1],
          boxShadow: [
            "0 0 60px rgba(255,150,100,0.4), 0 0 100px rgba(255,180,150,0.2)",
            "0 0 80px rgba(255,150,100,0.5), 0 0 120px rgba(255,180,150,0.3)",
            "0 0 60px rgba(255,150,100,0.4), 0 0 100px rgba(255,180,150,0.2)",
          ],
        }}
        transition={{
          duration: 3,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      >
        <div className="w-16 h-16 md:w-20 md:h-20 bg-white/90 rounded-full flex items-center justify-center shadow-inner overflow-hidden">
          {branding.favicon_url ? (
            <img 
              src={branding.favicon_url} 
              alt={branding.app_name}
              className="w-10 h-10 md:w-12 md:h-12 object-contain"
            />
          ) : (
            <Webhook className="w-8 h-8 md:w-10 md:h-10 text-orange-500" />
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function ConnectionPath() {
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox="0 0 1000 400"
      preserveAspectRatio="none"
      data-testid="integration-connection-path"
    >
      <defs>
        <linearGradient id="pathGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.1)" />
          <stop offset="50%" stopColor="rgba(255,255,255,0.3)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0.1)" />
        </linearGradient>
      </defs>

      <motion.path
        d="M 0,300 Q 150,280 250,220 T 450,180 T 650,200 T 850,140 T 1000,180"
        fill="none"
        stroke="url(#pathGradient)"
        strokeWidth="2"
        initial={{ pathLength: 0, opacity: 0 }}
        whileInView={{ pathLength: 1, opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 2, ease: "easeInOut" }}
      />

      <motion.path
        d="M 0,320 Q 200,300 350,250 T 550,220 T 700,240 T 900,180 T 1000,200"
        fill="none"
        stroke="url(#pathGradient)"
        strokeWidth="1.5"
        initial={{ pathLength: 0, opacity: 0 }}
        whileInView={{ pathLength: 1, opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 2.2, delay: 0.2, ease: "easeInOut" }}
      />

      <motion.circle r="4" fill="rgba(255,255,255,0.8)">
        <animateMotion
          dur="6s"
          repeatCount="indefinite"
          path="M 0,300 Q 150,280 250,220 T 450,180 T 650,200 T 850,140 T 1000,180"
        />
      </motion.circle>

      <motion.circle r="3" fill="rgba(255,255,255,0.6)">
        <animateMotion
          dur="8s"
          repeatCount="indefinite"
          path="M 0,320 Q 200,300 350,250 T 550,220 T 700,240 T 900,180 T 1000,200"
        />
      </motion.circle>
    </svg>
  );
}

function FloatingParticles() {
  return (
    <>
      {[...Array(6)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-2 h-2 rounded-full bg-white/20"
          style={{
            left: `${15 + i * 15}%`,
            top: `${30 + (i % 3) * 20}%`,
          }}
          animate={{
            y: [0, -20, 0],
            opacity: [0.2, 0.5, 0.2],
          }}
          transition={{
            duration: 4 + i * 0.5,
            repeat: Infinity,
            delay: i * 0.3,
            ease: "easeInOut",
          }}
        />
      ))}
    </>
  );
}

export function IntegrationsGrid() {
  const { branding } = useBranding();
  const { t } = useTranslation();

  return (
    <section
      className="relative py-12 sm:py-16 md:py-24 lg:py-32 overflow-hidden"
      style={{
        background:
          "linear-gradient(135deg, #a8d4f0 0%, #c4e0f5 25%, #e8d5c4 60%, #f5c9a8 100%)",
      }}
      data-testid="integrations-section"
    >
      <FloatingParticles />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center space-y-3 sm:space-y-4 mb-6 sm:mb-8"
        >
          <h2
            className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold text-slate-800"
            data-testid="integrations-headline"
          >
            {t('landing.integrations.title')}
          </h2>
          <p className="text-sm sm:text-base md:text-lg text-slate-600 max-w-2xl mx-auto">
            {t('landing.integrations.description', { appName: branding.app_name })}
          </p>
        </motion.div>

        <div
          className="relative h-[280px] sm:h-[320px] md:h-[350px] lg:h-[400px]"
          data-testid="integrations-grid"
        >
          <ConnectionPath />

          {integrations.map((integration) => (
            <IntegrationBubble key={integration.name} integration={integration} />
          ))}

          <CentralHub />
        </div>
      </div>

      <div
        className="absolute bottom-0 left-0 right-0 h-20 pointer-events-none"
        style={{
          background:
            "linear-gradient(to top, rgba(255,255,255,0.1), transparent)",
        }}
      />
    </section>
  );
}

export default IntegrationsGrid;
