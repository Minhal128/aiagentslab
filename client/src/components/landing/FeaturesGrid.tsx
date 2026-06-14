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
import { Card } from "@/components/ui/card";
import { Database, PhoneForwarded, Calendar, LineChart, AudioLines, Target } from "lucide-react";
import { motion } from "framer-motion";

const features = [
  {
    title: "Auto-Sync Knowledge Base",
    description: "Your AI agents stay up-to-date effortlessly by syncing directly with your company's knowledge base. No manual updates required.",
    icon: Database,
    iconColor: "from-blue-500 to-cyan-500",
    shadowColor: "shadow-blue-500/20"
  },
  {
    title: "Powerful Call Transfer Feature",
    description: "Easily set up warm transfers with handoff messages so the next agent is always prepared.",
    icon: PhoneForwarded,
    iconColor: "from-green-500 to-emerald-500",
    shadowColor: "shadow-green-500/20"
  },
  {
    title: "Easy Appointment Booking",
    description: "Let your AI phone agents schedule meetings in seconds with simple, natural language.",
    icon: Calendar,
    iconColor: "from-purple-500 to-pink-500",
    shadowColor: "shadow-purple-500/20"
  },
  {
    title: "Real-time Analytics",
    description: "Track call metrics, success rates, and customer sentiment through comprehensive dashboards.",
    icon: LineChart,
    iconColor: "from-amber-500 to-orange-500",
    shadowColor: "shadow-amber-500/20"
  },
  {
    title: "Natural Voice Conversations",
    description: "Human-like AI voices powered by ElevenLabs deliver seamless, natural conversations that customers love.",
    icon: AudioLines,
    iconColor: "from-red-500 to-rose-500",
    shadowColor: "shadow-red-500/20"
  },
  {
    title: "Intelligent Lead Scoring",
    description: "Automatically classify leads as hot, warm, cold, or lost based on conversation analysis and sentiment.",
    icon: Target,
    iconColor: "from-indigo-500 to-violet-500",
    shadowColor: "shadow-indigo-500/20"
  }
];

export function FeaturesGrid() {
  return (
    <section 
      id="features" 
      className="py-12 sm:py-16 md:py-24 lg:py-32 relative overflow-hidden"
      data-testid="section-features"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-orange-50/30 via-transparent to-amber-50/20 dark:from-orange-900/10 dark:via-transparent dark:to-amber-900/10" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center space-y-4 mb-8 md:mb-16"
        >
          <h2 
            className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold px-2"
            data-testid="heading-features"
          >
            Powerful <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-600 to-orange-500">AI Voice Agent</span> Features
          </h2>
          <p className="text-base sm:text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto px-4">
            Everything you need to create, deploy, and manage AI voice agents
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 md:gap-8">
          {features.map((feature, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              data-testid={`card-feature-${index}`}
            >
              <Card className="p-4 sm:p-6 md:p-8 rounded-2xl md:rounded-3xl hover-elevate transition-all h-full group border-amber-200/20 dark:border-amber-800/20">
                <motion.div 
                  className={`h-12 w-12 sm:h-14 sm:w-14 rounded-xl bg-gradient-to-br ${feature.iconColor} flex items-center justify-center mb-4 sm:mb-6 shadow-lg ${feature.shadowColor}`}
                  initial={{ scale: 1, rotate: 0 }}
                  whileInView={{ 
                    scale: [1, 1.1, 1],
                    rotate: [0, 5, -5, 0]
                  }}
                  viewport={{ once: true }}
                  transition={{ 
                    delay: index * 0.15,
                    duration: 0.6,
                    ease: "easeOut"
                  }}
                  whileHover={{ 
                    scale: 1.1,
                    rotate: 5
                  }}
                  data-testid={`icon-feature-${index}`}
                >
                  <feature.icon className="h-6 w-6 sm:h-7 sm:w-7 text-white" />
                </motion.div>
                <h3 
                  className="text-lg sm:text-xl font-bold mb-2 sm:mb-4"
                  data-testid={`title-feature-${index}`}
                >
                  {feature.title}
                </h3>
                <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
                  {feature.description}
                </p>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default FeaturesGrid;
