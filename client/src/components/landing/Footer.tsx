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
import { Link } from "wouter";
import { Twitter, Linkedin, Github, Mail, Phone, MapPin, ArrowRight } from "lucide-react";
import { useBranding } from "@/components/BrandingProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";

const productLinks = [
  { href: "/features", label: "Features", isRoute: true },
  { href: "/use-cases", label: "Use Cases", isRoute: true },
  { href: "/pricing", label: "Pricing", isRoute: true },
  { href: "/integrations", label: "Integrations", isRoute: true },
];

const resourceLinks = [
  { href: "/blog", label: "Blog", isRoute: true },
  { href: "/contact", label: "Contact", isRoute: true },
  { href: "/privacy", label: "Privacy Policy", isRoute: true },
  { href: "/terms", label: "Terms of Service", isRoute: true },
];


export function Footer() {
  const { branding } = useBranding();
  const [email, setEmail] = useState("");
  const { toast } = useToast();

  const socialLinks = [
    branding.social_twitter_url ? { href: branding.social_twitter_url, label: "Twitter", icon: Twitter } : null,
    branding.social_linkedin_url ? { href: branding.social_linkedin_url, label: "LinkedIn", icon: Linkedin } : null,
    branding.social_github_url ? { href: branding.social_github_url, label: "GitHub", icon: Github } : null,
  ].filter((link): link is { href: string; label: string; icon: typeof Twitter } => link !== null);

  const handleAnchorClick = (href: string) => {
    if (href.startsWith("#")) {
      const element = document.querySelector(href);
      if (element) {
        element.scrollIntoView({ behavior: "smooth" });
      }
    }
  };

  const handleNewsletterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email) {
      toast({
        title: "Thanks for subscribing!",
        description: "You'll receive our latest updates and tips.",
      });
      setEmail("");
    }
  };

  return (
    <footer className="relative bg-black text-slate-300 overflow-hidden" data-testid="footer">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-to-r from-transparent via-white/5 to-transparent rotate-12"
          animate={{
            x: ["-100%", "200%"],
          }}
          transition={{
            duration: 8,
            repeat: Infinity,
            ease: "linear",
          }}
        />
        <motion.div
          className="absolute -top-1/2 -right-1/2 w-full h-full bg-gradient-to-l from-transparent via-amber-500/5 to-transparent -rotate-12"
          animate={{
            x: ["200%", "-100%"],
          }}
          transition={{
            duration: 10,
            repeat: Infinity,
            ease: "linear",
            delay: 2,
          }}
        />
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-500/50 to-transparent" />
        <motion.div
          className="absolute top-0 left-0 w-32 h-px bg-gradient-to-r from-transparent via-white/80 to-transparent"
          animate={{
            x: ["-100%", "calc(100vw + 100%)"],
          }}
          transition={{
            duration: 4,
            repeat: Infinity,
            ease: "linear",
            repeatDelay: 3,
          }}
        />
      </div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="py-12 sm:py-16 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 sm:gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="flex items-center gap-2.5">
              {branding.logo_url_dark && (
                <img
                  src={branding.logo_url_dark}
                  alt={branding.app_name || "Logo"}
                  className="h-10 w-auto max-w-[180px] object-contain"
                  data-testid="img-footer-logo"
                />
              )}
            </div>
            <p className="text-slate-400 leading-relaxed max-w-sm">
              {branding.app_tagline || "Build, deploy, and monitor production-ready AI voice agents at scale."}
            </p>
            
            <form onSubmit={handleNewsletterSubmit} className="space-y-3">
              <p className="text-sm font-medium text-white">Subscribe to our newsletter</p>
              <div className="flex gap-2">
                <Input
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus:border-amber-500"
                  data-testid="input-newsletter-email"
                />
                <Button 
                  type="submit"
                  className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white border-0 shrink-0"
                  data-testid="button-newsletter-submit"
                >
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </form>

            {socialLinks.length > 0 && (
              <div className="flex gap-3 pt-2">
                {socialLinks.map((link) => (
                  <a
                    key={link.label}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-10 w-10 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors group"
                    data-testid={`link-footer-${link.label.toLowerCase()}`}
                    aria-label={link.label}
                  >
                    <link.icon className="h-5 w-5 text-slate-400 group-hover:text-amber-400 transition-colors" />
                  </a>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-white">Product</h3>
            <ul className="space-y-3">
              {productLinks.map((link) => (
                <li key={link.href}>
                  {link.isRoute ? (
                    <Link
                      href={link.href}
                      className="text-slate-400 hover:text-amber-400 transition-colors text-sm"
                      data-testid={`link-footer-${link.label.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      {link.label}
                    </Link>
                  ) : (
                    <a
                      href={link.href}
                      onClick={(e) => {
                        e.preventDefault();
                        handleAnchorClick(link.href);
                      }}
                      className="text-slate-400 hover:text-amber-400 transition-colors text-sm"
                      data-testid={`link-footer-${link.label.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      {link.label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-white">Resources</h3>
            <ul className="space-y-3">
              {resourceLinks.map((link) => (
                <li key={link.href}>
                  {link.isRoute ? (
                    <Link
                      href={link.href}
                      className="text-slate-400 hover:text-amber-400 transition-colors text-sm"
                      data-testid={`link-footer-${link.label.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      {link.label}
                    </Link>
                  ) : (
                    <a
                      href={link.href}
                      onClick={(e) => {
                        e.preventDefault();
                        handleAnchorClick(link.href);
                      }}
                      className="text-slate-400 hover:text-amber-400 transition-colors text-sm"
                      data-testid={`link-footer-${link.label.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      {link.label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {(branding.admin_email || branding.app_location) && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-white">Contact</h3>
              <ul className="space-y-3">
                {branding.admin_email && (
                  <li>
                    <a
                      href={`mailto:${branding.admin_email}`}
                      className="flex items-center gap-2 text-slate-400 hover:text-amber-400 transition-colors text-sm"
                      data-testid="link-footer-email"
                    >
                      <Mail className="h-4 w-4" />
                      {branding.admin_email}
                    </a>
                  </li>
                )}
                {branding.app_location && (
                  <li className="flex items-start gap-2 text-slate-400 text-sm">
                    <MapPin className="h-4 w-4 mt-0.5 shrink-0" />
                    <span data-testid="text-footer-location">{branding.app_location}</span>
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>

        <div className="py-6 border-t border-white/10 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-slate-500" data-testid="text-copyright">
            © {new Date().getFullYear()} {branding.app_name}. All rights reserved.
          </p>
          <div className="flex items-center gap-6 text-sm text-slate-500">
            <Link href="/privacy" className="hover:text-amber-400 transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-amber-400 transition-colors">
              Terms
            </Link>
            <Link href="/cookies" className="hover:text-amber-400 transition-colors">
              Cookies
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
