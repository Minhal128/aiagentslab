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
import { Badge } from "@/components/ui/badge";
import { Brain, Mic2, Radio, Cpu } from "lucide-react";
import { motion } from "framer-motion";

const technologies = [
  {
    icon: Brain,
    title: "Advanced AI Intelligence",
    description: "Natural language understanding powered by state-of-the-art language models",
    color: "from-amber-600 to-orange-600 dark:from-amber-500 dark:to-orange-500"
  },
  {
    icon: Mic2,
    title: "Human-Like Voices",
    description: "Ultra-realistic voice synthesis that sounds natural and engaging",
    color: "from-orange-500 to-amber-500 dark:from-orange-400 dark:to-amber-400"
  },
  {
    icon: Radio,
    title: "Real-Time Processing",
    description: "Instant response times with sub-second latency for smooth conversations",
    color: "from-yellow-500 to-amber-500 dark:from-yellow-400 dark:to-amber-400"
  }
];

export function AITechnologyShowcase() {
  return (
    <section 
      className="py-12 sm:py-16 md:py-24 lg:py-32 relative overflow-hidden"
      data-testid="section-ai-technology"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-amber-100/20 via-transparent to-orange-50/10 dark:from-amber-900/10 dark:via-transparent dark:to-orange-900/5" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center space-y-4 mb-8 md:mb-16"
        >
          <Badge 
            className="bg-gradient-to-r from-amber-600 to-orange-500 text-white border-0 mb-4"
            data-testid="badge-ai-technology"
          >
            <Cpu className="h-3 w-3 mr-1" />
            AI-Powered Technology
          </Badge>
          <h2 
            className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold px-2"
            data-testid="heading-ai-technology"
          >
            Built for the <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-600 to-orange-500">Future</span> of Communication
          </h2>
          <p className="text-base sm:text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto px-4">
            Experience cutting-edge AI technology that transforms how businesses communicate
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6 md:gap-8">
          {technologies.map((item, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.15 }}
              data-testid={`card-technology-${index}`}
            >
              <Card className="p-4 sm:p-6 md:p-8 rounded-2xl md:rounded-3xl hover-elevate transition-all h-full group relative overflow-hidden">
                <div className={`absolute inset-0 bg-gradient-to-br ${item.color} opacity-0 group-hover:opacity-5 transition-opacity`} />
                <motion.div 
                  className={`h-12 w-12 sm:h-14 sm:w-14 md:h-16 md:w-16 rounded-xl md:rounded-2xl bg-gradient-to-br ${item.color} flex items-center justify-center mb-4 sm:mb-6 shadow-lg shadow-amber-500/20`}
                  initial={{ scale: 1, y: 0 }}
                  whileInView={{ 
                    scale: [1, 1.15, 1],
                    y: [0, -10, 0]
                  }}
                  viewport={{ once: true }}
                  transition={{ 
                    delay: index * 0.2,
                    duration: 0.8,
                    ease: "easeInOut"
                  }}
                  whileHover={{ 
                    scale: 1.15,
                    rotate: 360,
                    transition: { duration: 0.5 }
                  }}
                  data-testid={`icon-technology-${index}`}
                >
                  <item.icon className="h-6 w-6 sm:h-7 sm:w-7 md:h-8 md:w-8 text-white" />
                </motion.div>
                <h3 
                  className="text-lg sm:text-xl md:text-2xl font-bold mb-2 sm:mb-4"
                  data-testid={`title-technology-${index}`}
                >
                  {item.title}
                </h3>
                <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
                  {item.description}
                </p>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default AITechnologyShowcase;
