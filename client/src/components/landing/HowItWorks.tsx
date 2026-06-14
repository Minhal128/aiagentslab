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
import { Brain, Zap, BarChart3 } from "lucide-react";
import { motion } from "framer-motion";

const steps = [
  {
    number: "01",
    title: "Build",
    description: "Utilize our intuitive agent builder to create custom voice AI callers effortlessly with professional templates.",
    icon: Brain,
    color: "from-slate-900 to-slate-800 dark:from-slate-100 dark:to-slate-200"
  },
  {
    number: "02",
    title: "Deploy",
    description: "Easily deploy your agents for AI phone calls, campaigns, and automated outreach in just one click.",
    icon: Zap,
    color: "from-slate-900 to-slate-800 dark:from-slate-100 dark:to-slate-200"
  },
  {
    number: "03",
    title: "Monitor",
    description: "Track success rates, call metrics, and user sentiment through comprehensive real-time analytics dashboards.",
    icon: BarChart3,
    color: "from-slate-900 to-slate-800 dark:from-slate-100 dark:to-slate-200"
  }
];

export function HowItWorks() {
  return (
    <section 
      className="py-12 sm:py-16 md:py-24 lg:py-32 bg-muted/30"
      data-testid="section-how-it-works"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center space-y-3 sm:space-y-4 mb-8 sm:mb-12 md:mb-16"
        >
          <h2 
            className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold"
            data-testid="heading-how-it-works"
          >
            How It Works
          </h2>
          <p className="text-sm sm:text-base md:text-lg text-muted-foreground">
            Get started in three simple steps
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6 md:gap-8 max-w-5xl mx-auto">
          {steps.map((step, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.15 }}
              data-testid={`card-step-${index}`}
            >
              <Card className="p-4 sm:p-6 md:p-8 rounded-2xl sm:rounded-3xl h-full hover-elevate transition-all group relative overflow-hidden">
                <div className={`absolute inset-0 bg-gradient-to-br ${step.color} opacity-0 group-hover:opacity-5 transition-opacity`} />
                <div className="flex items-start gap-4 sm:gap-6 mb-4 sm:mb-6">
                  <div 
                    className={`h-12 w-12 sm:h-14 sm:w-14 md:h-16 md:w-16 rounded-xl sm:rounded-2xl bg-gradient-to-br ${step.color} flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform`}
                    data-testid={`icon-step-${index}`}
                  >
                    <step.icon className="h-6 w-6 sm:h-7 sm:w-7 md:h-8 md:w-8 text-white dark:text-slate-900" />
                  </div>
                  <div 
                    className="text-5xl sm:text-6xl md:text-7xl font-bold text-primary/10 group-hover:text-primary/20 transition-colors"
                    data-testid={`number-step-${index}`}
                  >
                    {step.number}
                  </div>
                </div>
                <h3 
                  className="text-lg sm:text-xl md:text-2xl font-bold mb-2 sm:mb-3"
                  data-testid={`title-step-${index}`}
                >
                  {step.title}
                </h3>
                <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
                  {step.description}
                </p>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default HowItWorks;
