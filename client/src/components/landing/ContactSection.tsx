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
import { Mail, Clock, Users, Send, Shield, CheckCircle, Loader2, MessageSquare, Headphones } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useBranding } from "@/components/BrandingProvider";
import { useTranslation } from "react-i18next";

const contactFormSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
  company: z.string().optional(),
  message: z.string().min(10, "Message must be at least 10 characters"),
});

type ContactFormData = z.infer<typeof contactFormSchema>;

interface TrustElementProps {
  icon: typeof Clock;
  text: string;
  testId: string;
}

const TrustElement = ({ icon: Icon, text, testId }: TrustElementProps) => (
  <div 
    className="flex items-center gap-3 text-muted-foreground"
    data-testid={testId}
  >
    <div className="h-10 w-10 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
      <Icon className="h-5 w-5 text-amber-600 dark:text-amber-400" />
    </div>
    <span className="text-sm">{text}</span>
  </div>
);

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

export function ContactSection() {
  const shouldReduceMotion = useReducedMotion();
  const { toast } = useToast();
  const { branding } = useBranding();
  const { t } = useTranslation();

  const form = useForm<ContactFormData>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: {
      name: "",
      email: "",
      company: "",
      message: "",
    },
  });

  const contactMutation = useMutation({
    mutationFn: async (data: ContactFormData) => {
      const response = await apiRequest("POST", "/api/contact", data);
      return response.json();
    },
    onSuccess: (data) => {
      form.reset();
      toast({
        title: t('landing.contact.toast.successTitle'),
        description: data.message || t('landing.contact.toast.successDescription'),
      });
    },
    onError: (error: any) => {
      toast({
        title: t('landing.contact.toast.errorTitle'),
        description: error.message || t('landing.contact.toast.errorDescription'),
        variant: "destructive",
      });
    },
  });

  const onSubmit = async (data: ContactFormData) => {
    contactMutation.mutate(data);
  };

  return (
    <section
      id="contact"
      className="py-12 sm:py-16 md:py-24 lg:py-32 relative overflow-hidden"
      style={{
        background: "linear-gradient(135deg, #f5f0e8 0%, #f8f4ed 25%, #faf6f0 50%, #fdf5eb 75%, #fef8f0 100%)",
      }}
      data-testid="section-contact"
    >
      <div className="absolute top-0 left-1/4 w-72 h-72 bg-amber-200/30 rounded-full mix-blend-multiply filter blur-3xl" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-orange-100/40 rounded-full mix-blend-multiply filter blur-3xl" />
      <div className="absolute top-1/2 right-0 w-64 h-64 bg-amber-100/50 rounded-full mix-blend-multiply filter blur-3xl" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <motion.div
          variants={shouldReduceMotion ? {} : containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-start"
        >
          <motion.div
            variants={shouldReduceMotion ? {} : itemVariants}
            className="space-y-8"
          >
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-sm font-medium">
                <MessageSquare className="h-4 w-4" />
                {t('landing.contact.badge')}
              </div>
              <h2
                className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold"
                data-testid="heading-contact"
              >
                {t('landing.contact.title')}
              </h2>
              <p
                className="text-sm sm:text-base md:text-lg text-muted-foreground leading-relaxed max-w-lg"
                data-testid="text-contact-description"
              >
                {t('landing.contact.description', { appName: branding.app_name })}
              </p>
            </div>

            <div className="space-y-6">
              <motion.a
                href={`mailto:support@${branding.app_name.toLowerCase().replace(/\s+/g, '')}.com`}
                className="flex items-center gap-4 group"
                whileHover={shouldReduceMotion ? {} : { x: 5 }}
                data-testid="link-contact-email"
              >
                <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform shadow-lg shadow-amber-500/30">
                  <Mail className="h-7 w-7 text-white" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('landing.contact.emailLabel')}</p>
                  <p className="text-lg font-semibold group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                    support@{branding.app_name.toLowerCase().replace(/\s+/g, '')}.com
                  </p>
                </div>
              </motion.a>

              <div className="border-t pt-6 space-y-4">
                <TrustElement
                  icon={Clock}
                  text={t('landing.contact.trustResponseTime')}
                  testId="trust-response-time"
                />
                <TrustElement
                  icon={Users}
                  text={t('landing.contact.trustCustomerCount')}
                  testId="trust-customer-count"
                />
                <TrustElement
                  icon={Headphones}
                  text={t('landing.contact.trustConsultation')}
                  testId="trust-free-consultation"
                />
                <TrustElement
                  icon={CheckCircle}
                  text={t('landing.contact.trustNoCommitment')}
                  testId="trust-no-commitment"
                />
              </div>
            </div>
          </motion.div>

          <motion.div variants={shouldReduceMotion ? {} : itemVariants}>
            <Card className="p-4 sm:p-6 md:p-8 rounded-2xl sm:rounded-3xl shadow-xl border-0 bg-background/80 backdrop-blur-sm" data-testid="card-contact-form">
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(onSubmit)}
                  className="space-y-6"
                  data-testid="form-contact"
                >
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('landing.contact.form.nameLabel')}</FormLabel>
                        <FormControl>
                          <Input
                            placeholder={t('landing.contact.form.namePlaceholder')}
                            className="h-12 bg-muted/50"
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
                        <FormLabel>{t('landing.contact.form.emailLabel')}</FormLabel>
                        <FormControl>
                          <Input
                            type="email"
                            placeholder={t('landing.contact.form.emailPlaceholder')}
                            className="h-12 bg-muted/50"
                            data-testid="input-email"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="company"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('landing.contact.form.companyLabel')}</FormLabel>
                        <FormControl>
                          <Input
                            placeholder={t('landing.contact.form.companyPlaceholder')}
                            className="h-12 bg-muted/50"
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
                    name="message"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('landing.contact.form.messageLabel')}</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder={t('landing.contact.form.messagePlaceholder')}
                            className="min-h-[140px] resize-none bg-muted/50"
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
                    className="w-full h-12 text-base font-semibold bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white border-0 shadow-lg shadow-amber-500/30"
                    disabled={contactMutation.isPending}
                    data-testid="button-submit-contact"
                  >
                    {contactMutation.isPending ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        {t('landing.contact.form.sending')}
                      </>
                    ) : (
                      <>
                        <Send className="h-5 w-5" />
                        {t('landing.contact.form.submit')}
                      </>
                    )}
                  </Button>

                  <p
                    className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1.5"
                    data-testid="text-privacy-notice"
                  >
                    <Shield className="h-3.5 w-3.5" />
                    {t('landing.contact.form.privacyNotice')}
                  </p>
                </form>
              </Form>
            </Card>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

export default ContactSection;
