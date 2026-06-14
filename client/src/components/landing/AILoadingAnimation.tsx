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
import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Mic2, 
  Brain, 
  Phone, 
  Sparkles, 
  Shield, 
  Zap,
  CheckCircle2
} from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface LoadingStep {
  id: string;
  icon: typeof Mic2;
  label: string;
  sublabel: string;
}

const loadingSteps: LoadingStep[] = [
  {
    id: "voice",
    icon: Mic2,
    label: "Initializing Voice Engine",
    sublabel: "Setting up AI voice synthesis..."
  },
  {
    id: "brain",
    icon: Brain,
    label: "Loading AI Models",
    sublabel: "Preparing conversational intelligence..."
  },
  {
    id: "phone",
    icon: Phone,
    label: "Connecting Phone Systems",
    sublabel: "Establishing secure call infrastructure..."
  },
  {
    id: "security",
    icon: Shield,
    label: "Securing Your Workspace",
    sublabel: "Encrypting your data and sessions..."
  },
  {
    id: "ready",
    icon: Sparkles,
    label: "Almost Ready",
    sublabel: "Preparing your personalized dashboard..."
  }
];

interface AILoadingAnimationProps {
  isVisible: boolean;
  onComplete: () => void;
  userName?: string;
}

export function AILoadingAnimation({ isVisible, onComplete, userName }: AILoadingAnimationProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const onCompleteRef = useRef(onComplete);
  const hasCompletedRef = useRef(false);

  // Keep ref updated with latest callback
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (!isVisible) {
      setCurrentStep(0);
      setProgress(0);
      setCompletedSteps([]);
      hasCompletedRef.current = false;
      return;
    }

    const stepDuration = 600; // ms per step
    const progressInterval = 30; // ms between progress updates
    const progressIncrement = 100 / ((stepDuration / progressInterval) * loadingSteps.length);

    const progressTimer = setInterval(() => {
      setProgress(prev => {
        const next = prev + progressIncrement;
        return next >= 100 ? 100 : next;
      });
    }, progressInterval);

    const stepTimer = setInterval(() => {
      setCurrentStep(prev => {
        if (prev < loadingSteps.length - 1) {
          setCompletedSteps(completed => [...completed, loadingSteps[prev].id]);
          return prev + 1;
        }
        return prev;
      });
    }, stepDuration);

    // Complete after all steps
    const completeTimer = setTimeout(() => {
      setCompletedSteps(completed => [...completed, loadingSteps[loadingSteps.length - 1].id]);
      setProgress(100);
      setTimeout(() => {
        if (!hasCompletedRef.current) {
          hasCompletedRef.current = true;
          onCompleteRef.current();
        }
      }, 400);
    }, stepDuration * loadingSteps.length);

    return () => {
      clearInterval(progressTimer);
      clearInterval(stepTimer);
      clearTimeout(completeTimer);
    };
  }, [isVisible]);

  if (!isVisible) return null;

  const CurrentIcon = loadingSteps[currentStep]?.icon || Sparkles;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-background"
        data-testid="ai-loading-animation"
      >
        <div className="w-full max-w-md px-8 py-12">
          {/* Central animated icon */}
          <motion.div
            className="flex justify-center mb-8"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5 }}
          >
            <div className="relative">
              {/* Outer glow ring */}
              <motion.div
                className="absolute inset-0 rounded-full bg-brand/20"
                animate={{
                  scale: [1, 1.4, 1],
                  opacity: [0.5, 0.2, 0.5],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
                style={{ width: 120, height: 120, left: -10, top: -10 }}
              />
              
              {/* Inner icon container */}
              <motion.div
                className="relative h-24 w-24 rounded-full bg-gradient-to-br from-brand to-brand/90 flex items-center justify-center shadow-lg shadow-brand/30"
                animate={{
                  rotate: [0, 5, -5, 0],
                }}
                transition={{
                  duration: 3,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              >
                <motion.div
                  key={currentStep}
                  initial={{ scale: 0.5, opacity: 0, rotate: -180 }}
                  animate={{ scale: 1, opacity: 1, rotate: 0 }}
                  exit={{ scale: 0.5, opacity: 0, rotate: 180 }}
                  transition={{ duration: 0.3 }}
                >
                  <CurrentIcon className="h-10 w-10 text-white" />
                </motion.div>
              </motion.div>
              
              {/* Sparkle effects */}
              {[...Array(6)].map((_, i) => (
                <motion.div
                  key={i}
                  className="absolute"
                  style={{
                    left: "50%",
                    top: "50%",
                  }}
                  animate={{
                    x: [0, Math.cos((i * 60 * Math.PI) / 180) * 60],
                    y: [0, Math.sin((i * 60 * Math.PI) / 180) * 60],
                    opacity: [0, 1, 0],
                    scale: [0.5, 1, 0.5],
                  }}
                  transition={{
                    duration: 1.5,
                    repeat: Infinity,
                    delay: i * 0.2,
                    ease: "easeOut",
                  }}
                >
                  <Zap className="h-3 w-3 text-brand/60" />
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* Greeting */}
          {userName && (
            <motion.div
              className="text-center mb-6"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <h2 className="text-xl font-semibold text-foreground">
                Welcome, {userName}!
              </h2>
            </motion.div>
          )}

          {/* Current step info */}
          <motion.div
            className="text-center mb-8"
            key={currentStep}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
          >
            <h3 className="text-lg font-medium text-foreground mb-1">
              {loadingSteps[currentStep]?.label}
            </h3>
            <p className="text-sm text-muted-foreground">
              {loadingSteps[currentStep]?.sublabel}
            </p>
          </motion.div>

          {/* Progress bar */}
          <div className="mb-6">
            <Progress value={progress} className="h-2" />
            <div className="flex justify-between mt-2 text-xs text-muted-foreground">
              <span>Setting up your AI workspace</span>
              <span>{Math.round(progress)}%</span>
            </div>
          </div>

          {/* Step indicators */}
          <div className="flex justify-center gap-3">
            {loadingSteps.map((step, index) => {
              const isCompleted = completedSteps.includes(step.id);
              const isCurrent = index === currentStep;
              const StepIcon = step.icon;

              return (
                <motion.div
                  key={step.id}
                  className={`
                    h-10 w-10 rounded-full flex items-center justify-center transition-all duration-300
                    ${isCompleted 
                      ? "bg-green-500/20 text-green-500" 
                      : isCurrent 
                        ? "bg-brand/20 text-brand" 
                        : "bg-muted text-muted-foreground"
                    }
                  `}
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ 
                    scale: isCurrent ? 1.1 : 1, 
                    opacity: 1 
                  }}
                  transition={{ delay: index * 0.1 }}
                >
                  {isCompleted ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : (
                    <StepIcon className="h-4 w-4" />
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
