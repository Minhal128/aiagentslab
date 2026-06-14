/**
 * ============================================================
 * LandingPage - awaz.ai Inspired Design
 * Main landing page with all sections
 * ============================================================
 */
import { SEOHead } from "@/components/landing/SEOHead";
import { Navbar } from "@/components/landing/Navbar";
import { HeroSection } from "@/components/landing/HeroSection";
import { FeatureSection } from "@/components/landing/FeatureSection";
import { ActionCardsSection } from "@/components/landing/ActionCardsSection";
import { TechnologySection } from "@/components/landing/TechnologySection";
import { UseCasesSection } from "@/components/landing/UseCasesSection";
import { FeaturesShowcase } from "@/components/landing/FeaturesShowcase";
import { TestimonialsSection } from "@/components/landing/TestimonialsSection";
import { IntegrationsGrid } from "@/components/landing/IntegrationsGrid";
import { PricingSection } from "@/components/landing/PricingSection";
import { ContactSection } from "@/components/landing/ContactSection";
import { CTASection } from "@/components/landing/CTASection";
import { Footer } from "@/components/landing/Footer";
import { useBranding } from "@/components/BrandingProvider";
import { useSeoSettings } from "@/hooks/useSeoSettings";

export default function LandingPage() {
  const { branding } = useBranding();
  const { data: seoSettings } = useSeoSettings();

  const defaultKeywords = [
    "AI voice agents",
    "automated calling",
    "lead qualification",
    "AI phone agents",
    "call automation",
    "voice AI",
    "outbound calling",
    "customer service AI",
    "ElevenLabs",
    "Twilio integration"
  ];

  const seoTitle = seoSettings?.defaultTitle || "AI Voice Agents for Automated Calling";
  const seoDescription = seoSettings?.defaultDescription || branding.app_tagline || "Transform your call operations with AI-powered voice agents. Automate outbound calls, qualify leads, schedule appointments, and provide 24/7 customer support.";
  const seoKeywords = (seoSettings?.defaultKeywords && seoSettings.defaultKeywords.length > 0) 
    ? seoSettings.defaultKeywords 
    : defaultKeywords;
  const seoOgImage = seoSettings?.defaultOgImage || undefined;
  const seoCanonicalUrl = seoSettings?.canonicalBaseUrl || undefined;

  return (
    <div className="min-h-screen bg-background" data-testid="landing-page">
      <SEOHead
        title={seoTitle}
        description={seoDescription}
        canonicalUrl={seoCanonicalUrl}
        ogImage={seoOgImage}
        ogSiteName={branding.app_name}
        keywords={seoKeywords}
        twitterSite={seoSettings?.twitterHandle || undefined}
        twitterCreator={seoSettings?.twitterHandle || undefined}
        googleVerification={seoSettings?.googleVerification || undefined}
        bingVerification={seoSettings?.bingVerification || undefined}
        facebookAppId={seoSettings?.facebookAppId || undefined}
        structuredDataOrg={seoSettings?.structuredDataOrg}
        structuredDataFaq={seoSettings?.structuredDataFaq}
        structuredDataProduct={seoSettings?.structuredDataProduct}
      />

      <Navbar />

      <main>
        <HeroSection />

        <section id="features">
          <FeatureSection />
        </section>

        <section id="automation">
          <ActionCardsSection />
        </section>

        <section id="technology">
          <TechnologySection />
        </section>

        <section id="highlights">
          <FeaturesShowcase />
        </section>

        <section id="use-cases">
          <UseCasesSection />
        </section>

        <section id="testimonials">
          <TestimonialsSection />
        </section>

        <section id="integrations">
          <IntegrationsGrid />
        </section>

        <section id="pricing">
          <PricingSection />
        </section>

        <section id="contact">
          <ContactSection />
        </section>

        <CTASection />
      </main>

      <Footer />
    </div>
  );
}
