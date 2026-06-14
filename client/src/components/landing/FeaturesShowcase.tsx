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
import { useTranslation } from "react-i18next";

interface FeatureCardProps {
  title: string;
  description: string;
  visual: React.ReactNode;
}

function FeatureCard({ title, description, visual }: FeatureCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
      className="relative group"
      data-testid={`feature-card-${title.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <div className="relative bg-zinc-900/50 backdrop-blur-sm rounded-lg border border-zinc-800/50 p-4 sm:p-5 md:p-6 h-full hover-elevate transition-all duration-300">
        <div className="mb-4 sm:mb-6 h-36 sm:h-40 md:h-48 flex items-center justify-center">
          {visual}
        </div>
        <h3 className="text-base sm:text-lg font-semibold text-white mb-2" data-testid={`text-feature-title-${title.toLowerCase().replace(/\s+/g, '-')}`}>
          {title}
        </h3>
        <p className="text-xs sm:text-sm text-zinc-400" data-testid={`text-feature-description-${title.toLowerCase().replace(/\s+/g, '-')}`}>
          {description}
        </p>
      </div>
    </motion.div>
  );
}

function GlobalReachVisual() {
  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <svg viewBox="0 0 300 200" className="w-full h-full">
        <defs>
          <linearGradient id="globeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#14b8a6" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#0d9488" stopOpacity="0.4" />
          </linearGradient>
          <radialGradient id="glowGradient">
            <stop offset="0%" stopColor="#14b8a6" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#14b8a6" stopOpacity="0" />
          </radialGradient>
        </defs>
        
        <motion.circle
          cx="150"
          cy="100"
          r="60"
          fill="url(#glowGradient)"
          initial={{ opacity: 0.6 }}
          animate={{ opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
        <circle cx="150" cy="100" r="45" fill="none" stroke="url(#globeGradient)" strokeWidth="2" />
        <path d="M 150 55 Q 180 100 150 145" fill="none" stroke="#14b8a6" strokeWidth="1" opacity="0.5" />
        <path d="M 150 55 Q 120 100 150 145" fill="none" stroke="#14b8a6" strokeWidth="1" opacity="0.5" />
        <ellipse cx="150" cy="100" rx="45" ry="20" fill="none" stroke="#14b8a6" strokeWidth="1" opacity="0.5" />
        
        <motion.circle
          cx="120"
          cy="70"
          r="3"
          fill="#14b8a6"
          initial={{ scale: 0 }}
          animate={{ scale: [0, 1, 0] }}
          transition={{ duration: 2, repeat: Infinity, delay: 0 }}
        />
        <motion.circle
          cx="180"
          cy="80"
          r="3"
          fill="#0d9488"
          initial={{ scale: 0 }}
          animate={{ scale: [0, 1, 0] }}
          transition={{ duration: 2, repeat: Infinity, delay: 0.5 }}
        />
        <motion.circle
          cx="160"
          cy="130"
          r="3"
          fill="#14b8a6"
          initial={{ scale: 0 }}
          animate={{ scale: [0, 1, 0] }}
          transition={{ duration: 2, repeat: Infinity, delay: 1 }}
        />
        
        <text x="150" y="110" textAnchor="middle" fill="white" fontSize="32" fontWeight="bold">100+</text>
        <text x="150" y="130" textAnchor="middle" fill="#9ca3af" fontSize="12">Countries</text>
      </svg>
    </div>
  );
}

function CallQualityVisual() {
  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <svg viewBox="0 0 300 200" className="w-full h-full">
        <defs>
          <linearGradient id="waveGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#14b8a6" stopOpacity="0.2" />
            <stop offset="50%" stopColor="#14b8a6" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#14b8a6" stopOpacity="0.2" />
          </linearGradient>
        </defs>
        
        <motion.path
          d="M 20 100 Q 50 60, 80 100 T 140 100 T 200 100 T 260 100"
          fill="none"
          stroke="url(#waveGradient)"
          strokeWidth="3"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 2, repeat: Infinity }}
        />
        
        <circle cx="150" cy="100" r="35" fill="#1f2937" stroke="#14b8a6" strokeWidth="2" />
        
        <path
          d="M 145 90 C 142 90 140 92 140 95 L 140 98 C 138 98 136 100 136 102 L 136 108 C 136 110 138 112 140 112 L 160 112 C 162 112 164 110 164 108 L 164 102 C 164 100 162 98 160 98 L 160 95 C 160 92 158 90 155 90 L 145 90 Z M 145 92 L 155 92 C 156.7 92 158 93.3 158 95 L 158 98 L 142 98 L 142 95 C 142 93.3 143.3 92 145 92 Z"
          fill="#14b8a6"
        />
        
        <text x="150" y="165" textAnchor="middle" fill="#9ca3af" fontSize="11">Sub-500ms Latency</text>
      </svg>
    </div>
  );
}

function DirectConnectivityVisual() {
  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <svg viewBox="0 0 300 200" className="w-full h-full">
        <defs>
          <linearGradient id="pathGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#14b8a6" />
            <stop offset="100%" stopColor="#0d9488" />
          </linearGradient>
        </defs>
        
        <motion.path
          d="M 80 100 L 220 100"
          stroke="url(#pathGradient)"
          strokeWidth="2"
          strokeDasharray="5,5"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 2, repeat: Infinity }}
        />
        
        <circle cx="80" cy="100" r="25" fill="#1f2937" stroke="#14b8a6" strokeWidth="2" />
        <circle cx="220" cy="100" r="25" fill="#1f2937" stroke="#0d9488" strokeWidth="2" />
        
        <text x="80" y="105" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold">100+</text>
        <text x="220" y="105" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold">✓</text>
        
        <text x="150" y="70" textAnchor="middle" fill="#9ca3af" fontSize="11">Direct Connect</text>
      </svg>
    </div>
  );
}

function IntelligentRoutingVisual() {
  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <svg viewBox="0 0 300 200" className="w-full h-full">
        <defs>
          <linearGradient id="routeGradient">
            <stop offset="0%" stopColor="#14b8a6" />
            <stop offset="100%" stopColor="#0d9488" />
          </linearGradient>
        </defs>
        
        <circle cx="80" cy="100" r="20" fill="#1f2937" stroke="#14b8a6" strokeWidth="2" />
        
        <motion.line
          x1="100"
          y1="100"
          x2="140"
          y2="60"
          stroke="url(#routeGradient)"
          strokeWidth="2"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.5, repeat: Infinity, repeatDelay: 0.5 }}
        />
        <motion.line
          x1="100"
          y1="100"
          x2="140"
          y2="100"
          stroke="url(#routeGradient)"
          strokeWidth="2"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.5, repeat: Infinity, repeatDelay: 0.5, delay: 0.2 }}
        />
        <motion.line
          x1="100"
          y1="100"
          x2="140"
          y2="140"
          stroke="url(#routeGradient)"
          strokeWidth="2"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.5, repeat: Infinity, repeatDelay: 0.5, delay: 0.4 }}
        />
        
        <circle cx="160" cy="60" r="15" fill="#1f2937" stroke="#0d9488" strokeWidth="2" />
        <circle cx="160" cy="100" r="15" fill="#1f2937" stroke="#0d9488" strokeWidth="2" />
        <circle cx="160" cy="140" r="15" fill="#1f2937" stroke="#0d9488" strokeWidth="2" />
        
        <text x="150" y="175" textAnchor="middle" fill="#9ca3af" fontSize="11">Smart Routing</text>
      </svg>
    </div>
  );
}

function CarrierConnectivityVisual() {
  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <svg viewBox="0 0 300 200" className="w-full h-full">
        <motion.circle
          cx="150"
          cy="100"
          r="40"
          fill="none"
          stroke="#14b8a6"
          strokeWidth="2"
          initial={{ scale: 0.8, opacity: 0.3 }}
          animate={{ scale: 1.2, opacity: 0 }}
          transition={{ duration: 2, repeat: Infinity }}
        />
        <motion.circle
          cx="150"
          cy="100"
          r="40"
          fill="none"
          stroke="#0d9488"
          strokeWidth="2"
          initial={{ scale: 0.8, opacity: 0.3 }}
          animate={{ scale: 1.2, opacity: 0 }}
          transition={{ duration: 2, repeat: Infinity, delay: 0.5 }}
        />
        
        <circle cx="150" cy="100" r="30" fill="#1f2937" stroke="#14b8a6" strokeWidth="2" />
        
        <path
          d="M 150 85 L 155 95 L 145 95 L 150 105 L 145 105 L 155 115 L 150 105 L 155 105 Z"
          fill="#14b8a6"
        />
        
        <text x="150" y="165" textAnchor="middle" fill="#9ca3af" fontSize="11">One-Hop Delivery</text>
      </svg>
    </div>
  );
}

function VerifiedNumbersVisual() {
  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <svg viewBox="0 0 300 200" className="w-full h-full">
        <rect x="60" y="60" width="180" height="100" rx="8" fill="#1f2937" stroke="#14b8a6" strokeWidth="2" />
        
        <text x="150" y="90" textAnchor="middle" fill="white" fontSize="13" fontWeight="bold">+1 (555) 123-4567</text>
        <text x="150" y="110" textAnchor="middle" fill="white" fontSize="13" fontWeight="bold">+44 20 7946 0958</text>
        
        <rect x="80" y="122" width="140" height="22" rx="4" fill="#14b8a6" fillOpacity="0.15" stroke="#14b8a6" strokeWidth="1" />
        <text x="92" y="137" textAnchor="start" fill="white" fontSize="11">🇮🇳</text>
        <text x="108" y="137" textAnchor="start" fill="#14b8a6" fontSize="13" fontWeight="bold">+91 98765 43210</text>
        
        <motion.circle
          cx="220"
          cy="75"
          r="12"
          fill="#10b981"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.5, delay: 0.5 }}
        />
        
        <path
          d="M 216 75 L 219 78 L 224 71"
          fill="none"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        
        <text x="150" y="175" textAnchor="middle" fill="#9ca3af" fontSize="11">100+ Countries</text>
      </svg>
    </div>
  );
}

function KnowledgeBaseVisual() {
  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <svg viewBox="0 0 300 200" className="w-full h-full">
        <defs>
          <linearGradient id="brainGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#14b8a6" />
            <stop offset="100%" stopColor="#0d9488" />
          </linearGradient>
          <radialGradient id="nodeGlow">
            <stop offset="0%" stopColor="#14b8a6" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#14b8a6" stopOpacity="0" />
          </radialGradient>
        </defs>
        
        <rect x="70" y="60" width="60" height="80" rx="4" fill="#1f2937" stroke="#14b8a6" strokeWidth="2" />
        <line x1="80" y1="75" x2="120" y2="75" stroke="#4b5563" strokeWidth="2" />
        <line x1="80" y1="85" x2="110" y2="85" stroke="#4b5563" strokeWidth="2" />
        <line x1="80" y1="95" x2="115" y2="95" stroke="#4b5563" strokeWidth="2" />
        <line x1="80" y1="105" x2="105" y2="105" stroke="#4b5563" strokeWidth="2" />
        <line x1="80" y1="115" x2="120" y2="115" stroke="#4b5563" strokeWidth="2" />
        <line x1="80" y1="125" x2="100" y2="125" stroke="#4b5563" strokeWidth="2" />
        
        <motion.path
          d="M 130 100 L 160 100"
          stroke="url(#brainGradient)"
          strokeWidth="2"
          strokeDasharray="5,3"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
        
        <motion.circle
          cx="200"
          cy="100"
          r="35"
          fill="url(#nodeGlow)"
          initial={{ opacity: 0.4 }}
          animate={{ opacity: [0.4, 0.8, 0.4] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
        <circle cx="200" cy="100" r="30" fill="#1f2937" stroke="url(#brainGradient)" strokeWidth="2" />
        
        <motion.circle cx="185" cy="90" r="4" fill="#14b8a6" initial={{ scale: 0.8 }} animate={{ scale: [0.8, 1.2, 0.8] }} transition={{ duration: 2, repeat: Infinity, delay: 0 }} />
        <motion.circle cx="200" cy="80" r="4" fill="#0d9488" initial={{ scale: 0.8 }} animate={{ scale: [0.8, 1.2, 0.8] }} transition={{ duration: 2, repeat: Infinity, delay: 0.3 }} />
        <motion.circle cx="215" cy="90" r="4" fill="#14b8a6" initial={{ scale: 0.8 }} animate={{ scale: [0.8, 1.2, 0.8] }} transition={{ duration: 2, repeat: Infinity, delay: 0.6 }} />
        <motion.circle cx="190" cy="105" r="4" fill="#0d9488" initial={{ scale: 0.8 }} animate={{ scale: [0.8, 1.2, 0.8] }} transition={{ duration: 2, repeat: Infinity, delay: 0.9 }} />
        <motion.circle cx="210" cy="105" r="4" fill="#14b8a6" initial={{ scale: 0.8 }} animate={{ scale: [0.8, 1.2, 0.8] }} transition={{ duration: 2, repeat: Infinity, delay: 1.2 }} />
        <motion.circle cx="200" cy="115" r="4" fill="#0d9488" initial={{ scale: 0.8 }} animate={{ scale: [0.8, 1.2, 0.8] }} transition={{ duration: 2, repeat: Infinity, delay: 1.5 }} />
        
        <line x1="185" y1="90" x2="200" y2="80" stroke="#14b8a6" strokeWidth="1" opacity="0.5" />
        <line x1="200" y1="80" x2="215" y2="90" stroke="#14b8a6" strokeWidth="1" opacity="0.5" />
        <line x1="190" y1="105" x2="200" y2="115" stroke="#14b8a6" strokeWidth="1" opacity="0.5" />
        <line x1="210" y1="105" x2="200" y2="115" stroke="#14b8a6" strokeWidth="1" opacity="0.5" />
        <line x1="185" y1="90" x2="190" y2="105" stroke="#14b8a6" strokeWidth="1" opacity="0.5" />
        <line x1="215" y1="90" x2="210" y2="105" stroke="#14b8a6" strokeWidth="1" opacity="0.5" />
        
        <text x="150" y="165" textAnchor="middle" fill="#9ca3af" fontSize="11">RAG Knowledge</text>
      </svg>
    </div>
  );
}

function FlowBuilderVisual() {
  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <svg viewBox="0 0 300 200" className="w-full h-full">
        <defs>
          <linearGradient id="flowGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#14b8a6" />
            <stop offset="100%" stopColor="#0d9488" />
          </linearGradient>
        </defs>
        
        <rect x="60" y="50" width="50" height="30" rx="6" fill="#1f2937" stroke="#14b8a6" strokeWidth="2" />
        <text x="85" y="70" textAnchor="middle" fill="white" fontSize="10">Start</text>
        
        <motion.path
          d="M 110 65 L 130 65"
          stroke="url(#flowGradient)"
          strokeWidth="2"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.8, repeat: Infinity, repeatDelay: 1.5 }}
        />
        
        <polygon points="155,45 180,65 155,85 130,65" fill="#1f2937" stroke="#0d9488" strokeWidth="2" />
        <text x="155" y="70" textAnchor="middle" fill="white" fontSize="9">Yes?</text>
        
        <motion.path
          d="M 180 65 L 200 65"
          stroke="url(#flowGradient)"
          strokeWidth="2"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.8, repeat: Infinity, repeatDelay: 1.5, delay: 0.3 }}
        />
        
        <rect x="200" y="50" width="50" height="30" rx="6" fill="#1f2937" stroke="#10b981" strokeWidth="2" />
        <text x="225" y="70" textAnchor="middle" fill="#10b981" fontSize="10">Action</text>
        
        <motion.path
          d="M 155 85 L 155 110 L 120 110"
          stroke="url(#flowGradient)"
          strokeWidth="2"
          fill="none"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.8, repeat: Infinity, repeatDelay: 1.5, delay: 0.6 }}
        />
        
        <rect x="70" y="95" width="50" height="30" rx="6" fill="#1f2937" stroke="#f59e0b" strokeWidth="2" />
        <text x="95" y="115" textAnchor="middle" fill="#f59e0b" fontSize="10">Wait</text>
        
        <motion.path
          d="M 225 80 L 225 140"
          stroke="url(#flowGradient)"
          strokeWidth="2"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.8, repeat: Infinity, repeatDelay: 1.5, delay: 0.9 }}
        />
        
        <rect x="200" y="140" width="50" height="30" rx="15" fill="#1f2937" stroke="#ef4444" strokeWidth="2" />
        <text x="225" y="160" textAnchor="middle" fill="#ef4444" fontSize="10">End</text>
        
        <text x="150" y="185" textAnchor="middle" fill="#9ca3af" fontSize="11">Visual Builder</text>
      </svg>
    </div>
  );
}

function MultiLanguageVisual() {
  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <svg viewBox="0 0 300 200" className="w-full h-full">
        <defs>
          <linearGradient id="langGlobeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#14b8a6" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#0d9488" stopOpacity="0.4" />
          </linearGradient>
          <radialGradient id="langGlowGradient">
            <stop offset="0%" stopColor="#14b8a6" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#14b8a6" stopOpacity="0" />
          </radialGradient>
        </defs>
        
        <motion.circle
          cx="150"
          cy="100"
          r="50"
          fill="url(#langGlowGradient)"
          initial={{ opacity: 0.5 }}
          animate={{ opacity: [0.5, 0.8, 0.5] }}
          transition={{ duration: 3, repeat: Infinity }}
        />
        <circle cx="150" cy="100" r="40" fill="none" stroke="url(#langGlobeGradient)" strokeWidth="2" />
        <path d="M 150 60 Q 175 100 150 140" fill="none" stroke="#14b8a6" strokeWidth="1" opacity="0.5" />
        <path d="M 150 60 Q 125 100 150 140" fill="none" stroke="#14b8a6" strokeWidth="1" opacity="0.5" />
        <ellipse cx="150" cy="100" rx="40" ry="18" fill="none" stroke="#14b8a6" strokeWidth="1" opacity="0.5" />
        
        <motion.g initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 1, 0] }} transition={{ duration: 4, repeat: Infinity, delay: 0 }}>
          <circle cx="85" cy="70" r="16" fill="#1f2937" stroke="#14b8a6" strokeWidth="1.5" />
          <text x="85" y="75" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold">EN</text>
        </motion.g>
        
        <motion.g initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 1, 0] }} transition={{ duration: 4, repeat: Infinity, delay: 0.5 }}>
          <circle cx="215" cy="70" r="16" fill="#1f2937" stroke="#0d9488" strokeWidth="1.5" />
          <text x="215" y="75" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold">ES</text>
        </motion.g>
        
        <motion.g initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 1, 0] }} transition={{ duration: 4, repeat: Infinity, delay: 1 }}>
          <circle cx="75" cy="115" r="16" fill="#1f2937" stroke="#14b8a6" strokeWidth="1.5" />
          <text x="75" y="120" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold">FR</text>
        </motion.g>
        
        <motion.g initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 1, 0] }} transition={{ duration: 4, repeat: Infinity, delay: 1.5 }}>
          <circle cx="225" cy="115" r="16" fill="#1f2937" stroke="#0d9488" strokeWidth="1.5" />
          <text x="225" y="120" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold">DE</text>
        </motion.g>
        
        <motion.g initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 1, 0] }} transition={{ duration: 4, repeat: Infinity, delay: 2 }}>
          <circle cx="100" cy="150" r="16" fill="#1f2937" stroke="#14b8a6" strokeWidth="1.5" />
          <text x="100" y="155" textAnchor="middle" fill="white" fontSize="11" fontWeight="bold">AR</text>
        </motion.g>
        
        <motion.g initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 1, 0] }} transition={{ duration: 4, repeat: Infinity, delay: 2.5 }}>
          <circle cx="200" cy="150" r="16" fill="#1f2937" stroke="#0d9488" strokeWidth="1.5" />
          <text x="200" y="155" textAnchor="middle" fill="white" fontSize="11" fontWeight="bold">HI</text>
        </motion.g>
        
        <text x="150" y="100" textAnchor="middle" fill="white" fontSize="24" fontWeight="bold">11</text>
        <text x="150" y="115" textAnchor="middle" fill="#9ca3af" fontSize="10">Languages</text>
      </svg>
    </div>
  );
}

export function FeaturesShowcase() {
  const { t } = useTranslation();
  
  return (
    <section className="relative py-12 sm:py-16 md:py-24 bg-navy-900 overflow-hidden" data-testid="features-showcase-section">
      <div className="absolute inset-0 bg-gradient-to-b from-navy-900 via-navy-800 to-navy-900" />
      
      <div className="absolute inset-0">
        <div className="absolute top-1/4 left-1/4 w-48 sm:w-72 md:w-96 h-48 sm:h-72 md:h-96 bg-brand/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-48 sm:w-72 md:w-96 h-48 sm:h-72 md:h-96 bg-brand/10 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-8 sm:mb-12 md:mb-16"
        >
          <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-3 sm:mb-4 px-2" data-testid="text-showcase-title">
            {t('landing.featuresShowcase.title')}{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand to-brand/80">
              {t('landing.featuresShowcase.titleHighlight')}
            </span>
          </h2>
          <p className="text-sm sm:text-base md:text-lg text-zinc-400 max-w-3xl mx-auto px-4" data-testid="text-showcase-description">
            {t('landing.featuresShowcase.description')}
          </p>
        </motion.div>

        <div className="space-y-10 sm:space-y-14 md:space-y-20">
          <div>
            <motion.h3
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="text-xl sm:text-2xl font-semibold text-white mb-4 sm:mb-6 md:mb-8"
              data-testid="text-section-global-reach"
            >
              {t('landing.featuresShowcase.globalReach')}
            </motion.h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 md:gap-6">
              <FeatureCard
                title={t('landing.featuresShowcase.features.seamlessInbound.title')}
                description={t('landing.featuresShowcase.features.seamlessInbound.description')}
                visual={<GlobalReachVisual />}
              />
              <FeatureCard
                title={t('landing.featuresShowcase.features.directConnectivity.title')}
                description={t('landing.featuresShowcase.features.directConnectivity.description')}
                visual={<DirectConnectivityVisual />}
              />
              <FeatureCard
                title={t('landing.featuresShowcase.features.verifiedNumbers.title')}
                description={t('landing.featuresShowcase.features.verifiedNumbers.description')}
                visual={<VerifiedNumbersVisual />}
              />
            </div>
          </div>

          <div>
            <motion.h3
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="text-xl sm:text-2xl font-semibold text-white mb-4 sm:mb-6 md:mb-8"
              data-testid="text-section-reliable-calls"
            >
              {t('landing.featuresShowcase.reliableCalls')}
            </motion.h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 md:gap-6">
              <FeatureCard
                title={t('landing.featuresShowcase.features.highQuality.title')}
                description={t('landing.featuresShowcase.features.highQuality.description')}
                visual={<CallQualityVisual />}
              />
              <FeatureCard
                title={t('landing.featuresShowcase.features.intelligentRouting.title')}
                description={t('landing.featuresShowcase.features.intelligentRouting.description')}
                visual={<IntelligentRoutingVisual />}
              />
              <FeatureCard
                title={t('landing.featuresShowcase.features.directCarrier.title')}
                description={t('landing.featuresShowcase.features.directCarrier.description')}
                visual={<CarrierConnectivityVisual />}
              />
            </div>
          </div>

          <div>
            <motion.h3
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="text-xl sm:text-2xl font-semibold text-white mb-4 sm:mb-6 md:mb-8"
              data-testid="text-section-ai-automation"
            >
              {t('landing.featuresShowcase.aiAutomation')}
            </motion.h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 md:gap-6">
              <FeatureCard
                title={t('landing.featuresShowcase.features.knowledgeBase.title')}
                description={t('landing.featuresShowcase.features.knowledgeBase.description')}
                visual={<KnowledgeBaseVisual />}
              />
              <FeatureCard
                title={t('landing.featuresShowcase.features.flowBuilder.title')}
                description={t('landing.featuresShowcase.features.flowBuilder.description')}
                visual={<FlowBuilderVisual />}
              />
              <FeatureCard
                title={t('landing.featuresShowcase.features.multiLanguage.title')}
                description={t('landing.featuresShowcase.features.multiLanguage.description')}
                visual={<MultiLanguageVisual />}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
