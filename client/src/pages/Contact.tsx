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
import { motion, useReducedMotion } from "framer-motion";
import { 
  Mail, 
  Send, 
  Shield, 
  Loader2,
  ChevronDown,
  HelpCircle,
  MessageSquare,
  Twitter,
  Linkedin,
  Github
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { SEOHead } from "@/components/landing/SEOHead";
import { Navbar } from "@/components/landing/Navbar";
import { Footer } from "@/components/landing/Footer";
import { useBranding } from "@/components/BrandingProvider";
import { useSeoSettings } from "@/hooks/useSeoSettings";

const contactFormSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
  company: z.string().optional(),
  phone: z.string().optional(),
  message: z.string().min(10, "Message must be at least 10 characters"),
});

type ContactFormData = z.infer<typeof contactFormSchema>;

interface ContactInfoItemProps {
  icon: typeof Mail;
  label: string;
  value: string;
  href?: string;
  testId: string;
}

const ContactInfoItem = ({ icon: Icon, label, value, href, testId }: ContactInfoItemProps) => (
  <motion.div 
    className="flex items-start gap-4 group"
    whileHover={{ x: 5 }}
    data-testid={testId}
  >
    <div className="h-12 w-12 rounded-xl bg-slate-900 dark:bg-slate-100 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
      <Icon className="h-6 w-6 text-white dark:text-slate-900" />
    </div>
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      {href ? (
        <a 
          href={href}
          className="text-lg font-semibold hover:text-primary transition-colors"
          data-testid={`${testId}-link`}
        >
          {value}
        </a>
      ) : (
        <p className="text-lg font-semibold">{value}</p>
      )}
    </div>
  </motion.div>
);

const faqItemKeys = [
  { id: "faq-1", key: "responseTime" },
  { id: "faq-2", key: "scheduleDemo" },
  { id: "faq-3", key: "customIntegrations" },
  { id: "faq-4", key: "paymentMethods" }
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      ease: [0.25, 0.4, 0.25, 1],
    },
  },
};

export default function Contact() {
  const { branding } = useBranding();
  const { t } = useTranslation();
  const shouldReduceMotion = useReducedMotion();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<ContactFormData>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: {
      name: "",
      email: "",
      company: "",
      phone: "",
      message: "",
    },
  });

  const onSubmit = async (data: ContactFormData) => {
    setIsSubmitting(true);
    
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to send message');
      }
      
      form.reset();
      toast({
        title: t("landing.contactPage.form.successTitle"),
        description: t("landing.contactPage.form.successDescription"),
      });
    } catch (error: any) {
      toast({
        title: t("landing.contactPage.form.errorTitle", "Error"),
        description: error.message || t("landing.contactPage.form.errorDescription", "Failed to send message. Please try again."),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const { data: seoSettings } = useSeoSettings();

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title={`Contact Us | ${branding.app_name}`}
        description={`Get in touch with ${branding.app_name}. We're here to help you transform your call operations with AI voice agents. Reach out for demos, support, or partnership inquiries.`}
        canonicalUrl={seoSettings?.canonicalBaseUrl ? `${seoSettings.canonicalBaseUrl}/contact` : undefined}
        ogImage={seoSettings?.defaultOgImage || undefined}
        keywords={["contact", "support", "AI voice agents", "demo", branding.app_name]}
        ogSiteName={branding.app_name}
        twitterSite={seoSettings?.twitterHandle || undefined}
        twitterCreator={seoSettings?.twitterHandle || undefined}
        googleVerification={seoSettings?.googleVerification || undefined}
        bingVerification={seoSettings?.bingVerification || undefined}
        facebookAppId={seoSettings?.facebookAppId || undefined}
        structuredDataOrg={seoSettings?.structuredDataOrg}
      />
      
      <Navbar />

      <section 
        className="relative pt-24 pb-20 md:pt-28 md:pb-28 overflow-hidden"
        data-testid="section-hero"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-slate-100/80 via-transparent to-slate-200/50 dark:from-slate-900/80 dark:via-transparent dark:to-slate-800/50" />
        <div className="absolute top-1/4 left-1/4 w-72 h-72 bg-slate-300/20 dark:bg-slate-700/20 rounded-full mix-blend-multiply dark:mix-blend-screen filter blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-slate-200/30 dark:bg-slate-600/20 rounded-full mix-blend-multiply dark:mix-blend-screen filter blur-3xl" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <motion.div
            initial={shouldReduceMotion ? {} : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center space-y-6 max-w-3xl mx-auto"
          >
            <motion.div
              initial={shouldReduceMotion ? {} : { opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-slate-900/10 dark:bg-slate-100/10 text-sm font-medium"
              data-testid="badge-contact"
            >
              <MessageSquare className="h-4 w-4" />
              {t("landing.contactPage.badge")}
            </motion.div>

            <h1 
              className="text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight"
              data-testid="heading-contact"
            >
              {t("landing.contactPage.title")}
            </h1>

            <p 
              className="text-xl md:text-2xl text-muted-foreground leading-relaxed"
              data-testid="text-contact-subheading"
            >
              {t("landing.contactPage.subtitle")}
            </p>

            <motion.div
              initial={shouldReduceMotion ? {} : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.5 }}
              className="pt-4"
            >
              <ChevronDown className="h-6 w-6 mx-auto animate-bounce text-muted-foreground" />
            </motion.div>
          </motion.div>
        </div>
      </section>

      <section 
        className="py-16 md:py-24 relative"
        data-testid="section-contact-form"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            variants={shouldReduceMotion ? {} : containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-start"
          >
            <motion.div variants={shouldReduceMotion ? {} : itemVariants}>
              <Card className="p-8 rounded-3xl" data-testid="card-contact-form">
                <div className="space-y-2 mb-8">
                  <h2 className="text-2xl font-bold" data-testid="heading-form">
                    {t("landing.contactPage.form.title")}
                  </h2>
                  <p className="text-muted-foreground">
                    {t("landing.contactPage.form.subtitle")}
                  </p>
                </div>

                <Form {...form}>
                  <form
                    onSubmit={form.handleSubmit(onSubmit)}
                    className="space-y-6"
                    data-testid="form-contact"
                  >
                    <div className="grid sm:grid-cols-2 gap-6">
                      <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("landing.contactPage.form.labels.name")}</FormLabel>
                            <FormControl>
                              <Input
                                placeholder={t("landing.contactPage.form.placeholders.name")}
                                className="h-12"
                                data-testid="input-name"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("landing.contactPage.form.labels.email")}</FormLabel>
                            <FormControl>
                              <Input
                                type="email"
                                placeholder={t("landing.contactPage.form.placeholders.email")}
                                className="h-12"
                                data-testid="input-email"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid sm:grid-cols-2 gap-6">
                      <FormField
                        control={form.control}
                        name="company"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("landing.contactPage.form.labels.company")}</FormLabel>
                            <FormControl>
                              <Input
                                placeholder={t("landing.contactPage.form.placeholders.company")}
                                className="h-12"
                                data-testid="input-company"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="phone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("landing.contactPage.form.labels.phone")}</FormLabel>
                            <FormControl>
                              <Input
                                type="tel"
                                placeholder={t("landing.contactPage.form.placeholders.phone")}
                                className="h-12"
                                data-testid="input-phone"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="message"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("landing.contactPage.form.labels.message")}</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder={t("landing.contactPage.form.placeholders.message")}
                              className="min-h-[140px] resize-none"
                              data-testid="input-message"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <Button
                      type="submit"
                      size="lg"
                      className="w-full h-12 text-base font-semibold"
                      disabled={isSubmitting}
                      data-testid="button-submit-contact"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="h-5 w-5 animate-spin" />
                          {t("landing.contactPage.form.submitting")}
                        </>
                      ) : (
                        <>
                          <Send className="h-5 w-5" />
                          {t("landing.contactPage.form.submit")}
                        </>
                      )}
                    </Button>

                    <p
                      className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1.5"
                      data-testid="text-privacy-notice"
                    >
                      <Shield className="h-3.5 w-3.5" />
                      {t("landing.contactPage.form.privacyNotice")}
                    </p>
                  </form>
                </Form>
              </Card>
            </motion.div>

            <motion.div
              variants={shouldReduceMotion ? {} : itemVariants}
              className="space-y-8"
            >
              <div className="space-y-2">
                <h2 className="text-2xl font-bold" data-testid="heading-contact-info">
                  {t("landing.contactPage.contactInfo.title")}
                </h2>
                <p className="text-muted-foreground">
                  {t("landing.contactPage.contactInfo.subtitle")}
                </p>
              </div>

              <div className="space-y-6">
                {branding.admin_email && (
                  <ContactInfoItem
                    icon={Mail}
                    label={t("landing.contactPage.contactInfo.labels.email")}
                    value={branding.admin_email}
                    href={`mailto:${branding.admin_email}`}
                    testId="contact-email"
                  />
                )}
              </div>

              {(branding.social_twitter_url || branding.social_linkedin_url || branding.social_github_url) && (
                <div className="space-y-4">
                  <h3 className="text-base font-semibold text-muted-foreground uppercase tracking-wider">
                    Follow Us
                  </h3>
                  <div className="flex gap-3">
                    {branding.social_twitter_url && (
                      <a
                        href={branding.social_twitter_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="h-12 w-12 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center hover-elevate transition-colors group"
                        data-testid="link-contact-twitter"
                        aria-label="Twitter"
                      >
                        <Twitter className="h-5 w-5 text-muted-foreground group-hover:text-foreground" />
                      </a>
                    )}
                    {branding.social_linkedin_url && (
                      <a
                        href={branding.social_linkedin_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="h-12 w-12 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center hover-elevate transition-colors group"
                        data-testid="link-contact-linkedin"
                        aria-label="LinkedIn"
                      >
                        <Linkedin className="h-5 w-5 text-muted-foreground group-hover:text-foreground" />
                      </a>
                    )}
                    {branding.social_github_url && (
                      <a
                        href={branding.social_github_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="h-12 w-12 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center hover-elevate transition-colors group"
                        data-testid="link-contact-github"
                        aria-label="GitHub"
                      >
                        <Github className="h-5 w-5 text-muted-foreground group-hover:text-foreground" />
                      </a>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        </div>
      </section>

      <section 
        className="py-16 md:py-24 bg-muted/30"
        data-testid="section-faq"
      >
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={shouldReduceMotion ? {} : { opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center space-y-4 mb-12"
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-slate-900/10 dark:bg-slate-100/10 text-sm font-medium">
              <HelpCircle className="h-4 w-4" />
              {t("landing.contactPage.faq.badge")}
            </div>
            <h2 className="text-3xl md:text-4xl font-bold" data-testid="heading-faq">
              {t("landing.contactPage.faq.title")}
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              {t("landing.contactPage.faq.subtitle")}
            </p>
          </motion.div>

          <motion.div
            initial={shouldReduceMotion ? {} : { opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <Card className="rounded-2xl overflow-hidden">
              <Accordion type="single" collapsible className="w-full">
                {faqItemKeys.map((item, index) => (
                  <AccordionItem 
                    key={item.id} 
                    value={item.id}
                    className={index === faqItemKeys.length - 1 ? "border-b-0" : ""}
                  >
                    <AccordionTrigger 
                      className="px-6 py-4 text-left hover:no-underline hover:bg-muted/50 transition-colors"
                      data-testid={`faq-trigger-${index + 1}`}
                    >
                      <span className="font-semibold">{t(`landing.contactPage.faq.questions.${item.key}.question`)}</span>
                    </AccordionTrigger>
                    <AccordionContent 
                      className="px-6 pb-4 text-muted-foreground"
                      data-testid={`faq-content-${index + 1}`}
                    >
                      {t(`landing.contactPage.faq.questions.${item.key}.answer`)}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </Card>
          </motion.div>

          <motion.div
            initial={shouldReduceMotion ? {} : { opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="text-center mt-12"
          >
            <p className="text-muted-foreground mb-4" data-testid="text-more-questions">
              {t("landing.contactPage.faq.moreQuestions")}
            </p>
            <Button 
              size="lg"
              className="bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:hover:bg-slate-200 dark:text-slate-900"
              onClick={() => {
                const formSection = document.getElementById('contact-form');
                if (formSection) {
                  formSection.scrollIntoView({ behavior: 'smooth' });
                } else {
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }
              }}
              data-testid="button-contact-cta"
            >
              <Mail className="h-5 w-5" />
              {t("landing.contactPage.faq.contactSupport")}
            </Button>
          </motion.div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
