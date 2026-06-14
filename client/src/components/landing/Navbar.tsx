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
import { useLocation } from "wouter";
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBranding } from "@/components/BrandingProvider";
import { AuthStorage } from "@/lib/auth-storage";
import { LandingLanguageSelector } from "@/components/LandingLanguageSelector";

// Route theme map: determines if page hero is dark or light background
const routeThemeMap: Record<string, "dark" | "light"> = {
  "/": "light",
  "/features": "light",
  "/use-cases": "light", 
  "/pricing": "light",
  "/integrations": "light",
  "/blog": "light",
  "/contact": "light",
};

export function Navbar() {
  const [location, setLocation] = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const previousOverflow = useRef<string>("");
  const { branding } = useBranding();
  const { t } = useTranslation();

  const navLinks = [
    { href: "/features", label: t('landing.navbar.features') },
    { href: "/use-cases", label: t('landing.navbar.useCases') },
    { href: "/pricing", label: t('landing.navbar.pricing') },
    { href: "/integrations", label: t('landing.navbar.integrations') },
    { href: "/blog", label: t('landing.navbar.blog') },
    { href: "/contact", label: t('landing.navbar.contact') },
  ];
  
  // Determine page theme based on route
  const pageTheme = routeThemeMap[location] || "light";
  
  // Resolve logo based on background:
  // logo_url_dark = logo FOR dark backgrounds (white/light colored logo)
  // logo_url_light = logo FOR light backgrounds (dark/black colored logo)
  const resolveLogo = () => {
    const logoForDarkBg = branding.logo_url_dark || branding.logo_url;  // Use on dark backgrounds
    const logoForLightBg = branding.logo_url_light || branding.logo_url; // Use on light backgrounds
    
    if (isScrolled) {
      // Scrolled = dark navy background
      return logoForDarkBg || logoForLightBg;
    }
    
    // Not scrolled - check page hero theme
    if (pageTheme === "dark") {
      // Dark hero background
      return logoForDarkBg || logoForLightBg;
    } else {
      // Light hero background
      return logoForLightBg || logoForDarkBg;
    }
  };
  
  const currentLogo = resolveLogo();
  const needsLightText = isScrolled || pageTheme === "dark";
  const isAuthenticated = AuthStorage.isAuthenticated();
  const isAdmin = AuthStorage.isAdmin();

  const restoreBodyOverflow = useCallback(() => {
    document.body.style.overflow = previousOverflow.current || "unset";
  }, []);

  const lockBodyOverflow = useCallback(() => {
    previousOverflow.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Preload logo images to avoid flicker
  useEffect(() => {
    if (currentLogo) {
      const img = new Image();
      img.src = currentLogo;
    }
    // Also preload alternate logos
    if (branding.logo_url_dark) {
      const img = new Image();
      img.src = branding.logo_url_dark;
    }
    if (branding.logo_url_light) {
      const img = new Image();
      img.src = branding.logo_url_light;
    }
  }, [currentLogo, branding.logo_url_dark, branding.logo_url_light]);

  useEffect(() => {
    if (isMobileMenuOpen) {
      setIsMobileMenuOpen(false);
    }
  }, [location]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        mobileMenuRef.current &&
        !mobileMenuRef.current.contains(event.target as Node)
      ) {
        setIsMobileMenuOpen(false);
      }
    };

    if (isMobileMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      lockBodyOverflow();
    } else {
      restoreBodyOverflow();
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      restoreBodyOverflow();
    };
  }, [isMobileMenuOpen, lockBodyOverflow, restoreBodyOverflow]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMobileMenuOpen(false);
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, []);

  const handleNavClick = (href: string) => {
    setIsMobileMenuOpen(false);
    setLocation(href);
  };

  const handleSignIn = () => {
    setIsMobileMenuOpen(false);
    if (isAuthenticated) {
      window.location.href = isAdmin ? "/admin" : "/app";
    } else {
      setLocation("/login");
    }
  };

  const handleGetStarted = () => {
    setIsMobileMenuOpen(false);
    if (isAuthenticated) {
      window.location.href = isAdmin ? "/admin" : "/app";
    } else {
      setLocation("/login");
    }
  };

  return (
    <nav
      className={`fixed top-0 w-full z-50 transition-all duration-300 ${
        isScrolled 
          ? "bg-navy-900/90 backdrop-blur-xl shadow-lg border-b border-brand/10" 
          : "bg-transparent"
      }`}
      data-testid="navbar"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <motion.a
            href="/"
            className="flex items-center gap-2.5"
            whileHover={{ scale: 1.02 }}
            transition={{ type: "spring", stiffness: 400 }}
            data-testid="link-logo"
            onClick={(e) => {
              e.preventDefault();
              setLocation("/");
            }}
          >
            {currentLogo && (
              <motion.img
                src={currentLogo}
                alt={branding.app_name || "Logo"}
                className="h-9 w-auto max-w-[180px] object-contain"
                whileHover={{ scale: 1.05 }}
                transition={{ type: "spring", stiffness: 400 }}
                data-testid="img-logo"
              />
            )}
          </motion.a>

          <div className="hidden lg:flex items-center gap-1">
            {navLinks.map((link) => (
              <motion.a
                key={link.href}
                href={link.href}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                  needsLightText 
                    ? "text-gray-400 hover:text-white hover:bg-white/5" 
                    : "text-gray-600 hover:text-gray-900 hover:bg-black/5"
                }`}
                whileHover={{ y: -1 }}
                transition={{ type: "spring", stiffness: 400 }}
                data-testid={`link-nav-${link.label.toLowerCase().replace(/\s+/g, "-")}`}
                onClick={(e) => {
                  e.preventDefault();
                  handleNavClick(link.href);
                }}
              >
                {link.label}
              </motion.a>
            ))}
          </div>

          <div className="hidden lg:flex items-center gap-2">
            <LandingLanguageSelector needsLightText={needsLightText} />
            <Button
              onClick={handleSignIn}
              data-testid="button-nav-signin"
              className="bg-brand text-brand-foreground font-medium rounded-full px-6"
            >
              {t('landing.navbar.login')}
            </Button>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className={`lg:hidden ${needsLightText ? 'text-white' : 'text-gray-900'}`}
            onClick={() => setIsMobileMenuOpen(true)}
            data-testid="button-mobile-menu-open"
            aria-label="Open menu"
          >
            <Menu className="h-6 w-6" />
          </Button>
        </div>
      </div>

      <AnimatePresence>
        {isMobileMenuOpen && (
          <>
            <motion.div
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              data-testid="mobile-menu-overlay"
            />

            <motion.div
              ref={mobileMenuRef}
              className="fixed top-0 right-0 bottom-0 w-full max-w-sm h-screen min-h-screen bg-navy-900 z-50 lg:hidden shadow-2xl border-l border-gray-800"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              data-testid="mobile-menu"
            >
              <div className="flex flex-col h-screen min-h-screen bg-navy-900">
                <div className="shrink-0 flex items-center justify-between h-16 px-4 border-b border-gray-800 bg-navy-900">
                  <div className="flex items-center gap-2.5">
                    {currentLogo && (
                      <img
                        src={currentLogo}
                        alt={branding.app_name || "Logo"}
                        className="h-9 w-auto max-w-[160px] object-contain"
                        data-testid="img-mobile-logo"
                      />
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-white"
                    onClick={() => setIsMobileMenuOpen(false)}
                    data-testid="button-mobile-menu-close"
                    aria-label="Close menu"
                  >
                    <X className="h-6 w-6" />
                  </Button>
                </div>

                <nav className="flex-1 overflow-y-auto px-4 py-4 bg-navy-900">
                  <div className="flex flex-col gap-1">
                    {navLinks.map((link) => (
                      <a
                        key={link.href}
                        href={link.href}
                        className="block text-base font-medium py-3 px-4 rounded-xl text-gray-300 hover:text-white hover:bg-gray-800 transition-all"
                        data-testid={`link-mobile-${link.label.toLowerCase().replace(/\s+/g, "-")}`}
                        onClick={(e) => {
                          e.preventDefault();
                          handleNavClick(link.href);
                        }}
                      >
                        {link.label}
                      </a>
                    ))}
                  </div>
                </nav>

                <div className="shrink-0 p-3 border-t border-gray-800 space-y-3 bg-navy-900">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-sm text-gray-400">{t('common.language')}</span>
                    <LandingLanguageSelector needsLightText={true} />
                  </div>
                  <Button
                    className="w-full justify-center h-10 bg-brand text-brand-foreground font-medium rounded-full"
                    onClick={handleSignIn}
                    data-testid="button-mobile-signin"
                  >
                    {t('landing.navbar.login')}
                  </Button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </nav>
  );
}

export default Navbar;
