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
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { useBranding } from "@/components/BrandingProvider";

export function SignupPopup() {
  const [isVisible, setIsVisible] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [, setLocation] = useLocation();
  const { branding } = useBranding();

  useEffect(() => {
    const checkDismissed = localStorage.getItem("signup_popup_dismissed");
    if (checkDismissed) {
      setIsDismissed(true);
      return;
    }

    let scrollTimeout: ReturnType<typeof setTimeout> | null = null;
    let hasScrolled = false;

    const handleScroll = () => {
      if (!hasScrolled && window.scrollY > 100) {
        hasScrolled = true;
        scrollTimeout = setTimeout(() => {
          if (!isDismissed) {
            setIsVisible(true);
          }
        }, 5000);
      }
    };

    window.addEventListener("scroll", handleScroll);

    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }
    };
  }, [isDismissed]);

  const handleClose = () => {
    setIsVisible(false);
    setIsDismissed(true);
    localStorage.setItem("signup_popup_dismissed", "true");
  };

  const handleSignup = () => {
    handleClose();
    setLocation("/login");
  };

  if (isDismissed) return null;

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 100, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 100, scale: 0.9 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="hidden sm:block fixed bottom-6 right-6 z-50 max-w-sm"
          data-testid="popup-signup"
        >
          <div className="relative bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl shadow-2xl border border-slate-700/50">
            <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 via-transparent to-orange-500/10 rounded-2xl" />
            
            <button
              onClick={handleClose}
              className="absolute -top-2 -right-2 h-7 w-7 rounded-full bg-slate-700 hover:bg-slate-600 text-white flex items-center justify-center shadow-lg z-20 transition-colors"
              data-testid="button-close-popup"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="relative p-6 space-y-4">
              <div className="flex items-center gap-2 text-amber-400">
                <Sparkles className="h-5 w-5" />
                <span className="text-sm font-semibold uppercase tracking-wide">Limited Offer</span>
              </div>

              <div className="space-y-2">
                <h3 className="text-xl font-bold text-white" data-testid="heading-popup">
                  Start Your Free Trial
                </h3>
                <p className="text-sm text-slate-300 leading-relaxed" data-testid="text-popup-description">
                  Join {branding.app_name} today and get 10 free credits to try our AI-powered calling platform.
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <Button
                  onClick={handleSignup}
                  className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-semibold h-11 rounded-xl group"
                  data-testid="button-popup-signup"
                >
                  Get Started Free
                  <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
                </Button>
                
                <button
                  onClick={handleClose}
                  className="text-xs text-slate-500 hover:text-slate-400 transition-colors"
                  data-testid="button-popup-no-thanks"
                >
                  No thanks, maybe later
                </button>
              </div>

              <div className="flex items-center justify-center gap-4 pt-2 border-t border-slate-700/50">
                <div className="text-center">
                  <div className="text-lg font-bold text-white">10</div>
                  <div className="text-xs text-slate-400">Free Credits</div>
                </div>
                <div className="h-8 w-px bg-slate-700" />
                <div className="text-center">
                  <div className="text-lg font-bold text-white">24/7</div>
                  <div className="text-xs text-slate-400">Support</div>
                </div>
                <div className="h-8 w-px bg-slate-700" />
                <div className="text-center">
                  <div className="text-lg font-bold text-white">0</div>
                  <div className="text-xs text-slate-400">Setup Fee</div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default SignupPopup;
