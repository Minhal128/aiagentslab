import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { X, Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBranding } from "@/components/BrandingProvider";

export function PromoPopup() {
  const [isOpen, setIsOpen] = useState(false);
  const [, setLocation] = useLocation();
  const { branding } = useBranding();

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsOpen(true);
    }, 5000);

    return () => clearTimeout(timer);
  }, []);

  const handleGetStarted = () => {
    setIsOpen(false);
    setLocation("/login");
  };

  const handleDismiss = () => {
    setIsOpen(false);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleDismiss}
            data-testid="promo-overlay"
          />
          
          <motion.div
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[101] w-[90%] max-w-md"
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: "spring", duration: 0.5 }}
            data-testid="promo-popup"
          >
            <div className="relative bg-[#0d1a2d] rounded-2xl p-6 md:p-8 border border-gray-700/50 shadow-2xl">
              <button
                onClick={handleDismiss}
                className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
                data-testid="button-promo-close"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>

              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="h-5 w-5 text-amber-500" />
                <span className="text-amber-500 font-semibold text-sm tracking-wide">
                  LIMITED OFFER
                </span>
              </div>

              <h2 className="text-2xl md:text-3xl font-bold text-white mb-3">
                Start Your Free Trial
              </h2>
              
              <p className="text-gray-400 mb-6">
                Join {branding.app_name || "us"} today and get 10 free credits to try our AI-powered calling platform.
              </p>

              <Button
                onClick={handleGetStarted}
                className="w-full h-12 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-semibold rounded-full text-base mb-4"
                data-testid="button-promo-cta"
              >
                Get Started Free
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>

              <button
                onClick={handleDismiss}
                className="w-full text-center text-gray-500 hover:text-gray-300 text-sm transition-colors"
                data-testid="button-promo-dismiss"
              >
                No thanks, maybe later
              </button>

              <div className="flex items-center justify-center gap-6 mt-6 pt-6 border-t border-gray-700/50">
                <div className="text-center">
                  <div className="text-xl font-bold text-white">10</div>
                  <div className="text-xs text-gray-500">Free Credits</div>
                </div>
                <div className="h-8 w-px bg-gray-700/50" />
                <div className="text-center">
                  <div className="text-xl font-bold text-white">24/7</div>
                  <div className="text-xs text-gray-500">Support</div>
                </div>
                <div className="h-8 w-px bg-gray-700/50" />
                <div className="text-center">
                  <div className="text-xl font-bold text-white">0</div>
                  <div className="text-xs text-gray-500">Setup Fee</div>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
