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
import { useEffect, useState, useRef } from "react";
import { motion, useInView } from "framer-motion";
import { UsersRound, PhoneCall, Crosshair, Timer, BadgeDollarSign } from "lucide-react";

interface StatItemProps {
  icon: typeof UsersRound;
  value: number;
  label: string;
  prefix?: string;
  suffix?: string;
  delay: number;
  testId: string;
  iconColor: string;
  shadowColor: string;
}

function AnimatedCounter({ 
  value, 
  prefix = "", 
  suffix = "",
  isInView 
}: { 
  value: number; 
  prefix?: string; 
  suffix?: string;
  isInView: boolean;
}) {
  const [count, setCount] = useState(0);
  
  useEffect(() => {
    if (!isInView) return;
    
    const duration = 2000;
    const steps = 60;
    const stepDuration = duration / steps;
    const increment = value / steps;
    
    let current = 0;
    const timer = setInterval(() => {
      current += increment;
      if (current >= value) {
        setCount(value);
        clearInterval(timer);
      } else {
        setCount(Math.floor(current));
      }
    }, stepDuration);
    
    return () => clearInterval(timer);
  }, [value, isInView]);
  
  const formatNumber = (num: number) => {
    if (num >= 1000000) {
      return Math.round(num / 1000000) + 'M';
    }
    if (num >= 1000) {
      return Math.round(num / 1000) + 'K';
    }
    return num.toLocaleString();
  };
  
  return (
    <span className="tabular-nums">
      {prefix}{formatNumber(count)}{suffix}
    </span>
  );
}

function StatItem({ icon: Icon, value, label, prefix, suffix, delay, testId, iconColor, shadowColor }: StatItemProps) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });
  
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 30 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, delay }}
      className="text-center group"
      data-testid={testId}
    >
      <motion.div 
        className={`relative inline-flex items-center justify-center w-14 h-14 mb-4 rounded-xl bg-gradient-to-br ${iconColor} shadow-lg ${shadowColor}`}
        initial={{ scale: 1, rotate: 0 }}
        whileInView={{ 
          scale: [1, 1.1, 1],
          rotate: [0, 5, -5, 0]
        }}
        viewport={{ once: true }}
        transition={{ 
          delay: delay + 0.1,
          duration: 0.6,
          ease: "easeOut"
        }}
        whileHover={{ 
          scale: 1.1,
          rotate: 5
        }}
      >
        <Icon className="h-7 w-7 text-white" />
      </motion.div>
      <div className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold text-foreground mb-2">
        <AnimatedCounter 
          value={value} 
          prefix={prefix} 
          suffix={suffix} 
          isInView={isInView} 
        />
      </div>
      <div className="text-muted-foreground font-medium">{label}</div>
    </motion.div>
  );
}

export function PlatformStatsSection() {
  const displayStats = {
    totalUsers: 5000,
    totalCalls: 135000,
    completedCampaigns: 15000,
    qualifiedLeads: 40000,
    timeSavedHours: 25000,
    estimatedProfit: 2500000
  };
  
  const statItems = [
    { icon: UsersRound, value: displayStats.totalUsers, label: "Active Users", suffix: "+", delay: 0, iconColor: "from-blue-500 to-cyan-500", shadowColor: "shadow-blue-500/20" },
    { icon: PhoneCall, value: displayStats.totalCalls, label: "Calls Made", suffix: "+", delay: 0.1, iconColor: "from-green-500 to-emerald-500", shadowColor: "shadow-green-500/20" },
    { icon: Crosshair, value: displayStats.qualifiedLeads, label: "Qualified Leads", suffix: "+", delay: 0.2, iconColor: "from-purple-500 to-pink-500", shadowColor: "shadow-purple-500/20" },
    { icon: Timer, value: displayStats.timeSavedHours, label: "Hours Saved", suffix: "+", delay: 0.3, iconColor: "from-amber-500 to-orange-500", shadowColor: "shadow-amber-500/20" },
    { icon: BadgeDollarSign, value: displayStats.estimatedProfit, label: "Revenue Generated", prefix: "$", suffix: "+", delay: 0.4, iconColor: "from-indigo-500 to-violet-500", shadowColor: "shadow-indigo-500/20" },
  ];
  
  return (
    <section 
      className="py-12 sm:py-16 md:py-24 lg:py-32 relative overflow-hidden"
      data-testid="section-platform-stats"
    >
      <div className="absolute inset-0 bg-gradient-to-b from-amber-50/50 via-transparent to-orange-50/30 dark:from-amber-950/20 dark:via-transparent dark:to-orange-950/10" />
      
      <div className="absolute top-1/2 left-1/4 w-96 h-96 bg-amber-200/20 dark:bg-amber-800/10 rounded-full mix-blend-multiply dark:mix-blend-screen filter blur-3xl -translate-y-1/2" />
      <div className="absolute top-1/2 right-1/4 w-80 h-80 bg-orange-200/20 dark:bg-orange-800/10 rounded-full mix-blend-multiply dark:mix-blend-screen filter blur-3xl -translate-y-1/2" />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-8 sm:mb-12 md:mb-16"
        >
          <h2 
            className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold mb-3 sm:mb-4"
            data-testid="heading-platform-stats"
          >
            Trusted by Growing Businesses
          </h2>
          <p className="text-sm sm:text-base md:text-lg text-muted-foreground max-w-2xl mx-auto">
            Join thousands of companies automating their outreach with AI-powered voice agents
          </p>
        </motion.div>
        
        <div 
          className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 sm:gap-6 md:gap-8"
          data-testid="stats-grid"
        >
          {statItems.map((item, index) => (
            <StatItem
              key={item.label}
              icon={item.icon}
              value={item.value}
              label={item.label}
              prefix={item.prefix}
              suffix={item.suffix}
              delay={item.delay}
              iconColor={item.iconColor}
              shadowColor={item.shadowColor}
              testId={`stat-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

export default PlatformStatsSection;
