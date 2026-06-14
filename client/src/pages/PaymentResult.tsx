import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, XCircle, Loader2, Crown, ArrowLeft, Sparkles, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";

type PaymentType = "subscription" | "credits";
type PaymentStatus = "success" | "failure" | "processing" | "cancelled";
type GatewayType = "stripe" | "razorpay" | "paypal" | "paystack" | "mercadopago";

interface PaymentDetails {
  type: PaymentType;
  gateway: GatewayType;
  amount?: string;
  currency?: string;
  credits?: number;
  planName?: string;
  transactionId?: string;
}

const gatewayNames: Record<GatewayType, string> = {
  stripe: "Stripe",
  razorpay: "Razorpay",
  paypal: "PayPal",
  paystack: "Paystack",
  mercadopago: "MercadoPago",
};

const CheckmarkAnimation = () => (
  <motion.div
    initial={{ scale: 0 }}
    animate={{ scale: 1 }}
    transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.2 }}
    className="relative"
  >
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="h-32 w-32 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-2xl shadow-emerald-500/30"
    >
      <motion.div
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.3 }}
      >
        <CheckCircle2 className="h-16 w-16 text-white" strokeWidth={2.5} />
      </motion.div>
    </motion.div>
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: [0, 1.5, 0], opacity: [0, 0.5, 0] }}
      transition={{ duration: 1, delay: 0.4, repeat: 0 }}
      className="absolute inset-0 rounded-full bg-emerald-400"
    />
  </motion.div>
);

const FailureAnimation = () => (
  <motion.div
    initial={{ scale: 0 }}
    animate={{ scale: 1 }}
    transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.2 }}
    className="relative"
  >
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="h-32 w-32 rounded-full bg-gradient-to-br from-red-400 to-red-600 flex items-center justify-center shadow-2xl shadow-red-500/30"
    >
      <motion.div
        initial={{ rotate: -90, opacity: 0 }}
        animate={{ rotate: 0, opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.3 }}
      >
        <XCircle className="h-16 w-16 text-white" strokeWidth={2.5} />
      </motion.div>
    </motion.div>
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: [0, 1.5, 0], opacity: [0, 0.3, 0] }}
      transition={{ duration: 1, delay: 0.4, repeat: 0 }}
      className="absolute inset-0 rounded-full bg-red-400"
    />
  </motion.div>
);

const ProcessingAnimation = () => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    className="h-32 w-32 rounded-full bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center shadow-2xl shadow-blue-500/30"
  >
    <Loader2 className="h-16 w-16 text-white animate-spin" />
  </motion.div>
);

const ConfettiParticle = ({ delay, x }: { delay: number; x: number }) => (
  <motion.div
    initial={{ y: -20, x: x, opacity: 1, scale: 1 }}
    animate={{ y: 400, opacity: 0, scale: 0, rotate: 360 }}
    transition={{ duration: 2, delay, ease: "easeOut" }}
    className="absolute top-0 w-3 h-3 rounded-full"
    style={{ 
      backgroundColor: ['#10b981', '#8b5cf6', '#f59e0b', '#3b82f6', '#ec4899'][Math.floor(Math.random() * 5)],
      left: `${x}%`
    }}
  />
);

export default function PaymentResult() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [status, setStatus] = useState<PaymentStatus>("processing");
  const [details, setDetails] = useState<PaymentDetails | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    
    const statusParam = params.get("status") as PaymentStatus | null;
    const typeParam = params.get("type") as PaymentType | null;
    const gatewayParam = params.get("gateway") as GatewayType | null;
    const sessionId = params.get("session_id");
    const paymentId = params.get("payment_id");
    const orderId = params.get("order_id");
    const token = params.get("token");
    const reference = params.get("reference");
    const preferenceId = params.get("preference_id");
    const paymentStatus = params.get("payment_status");
    const preapprovalId = params.get("preapproval_id");
    const externalReference = params.get("external_reference");
    const planIdParam = params.get("plan_id");
    const billingPeriodParam = params.get("billing_period");
    const cancelled = params.get("canceled") === "true" || params.get("cancelled") === "true";

    const paymentDetails: PaymentDetails = {
      type: typeParam || "credits",
      gateway: gatewayParam || "stripe",
      amount: params.get("amount") || undefined,
      currency: params.get("currency") || undefined,
      credits: params.get("credits") ? parseInt(params.get("credits")!) : undefined,
      planName: params.get("plan") || undefined,
      transactionId: sessionId || paymentId || orderId || token || reference || preferenceId || undefined,
    };
    
    setDetails(paymentDetails);

    if (cancelled || statusParam === "cancelled") {
      setStatus("cancelled");
      return;
    }

    if (statusParam === "failure") {
      setStatus("failure");
      return;
    }

    const handleSuccess = () => {
      setStatus("success");
      setShowConfetti(true);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
      queryClient.invalidateQueries({ queryKey: ["/api/credit-transactions"] });
    };

    const verifyPayment = async () => {
      setVerifying(true);
      try {
        if (gatewayParam === "stripe" && sessionId) {
          const result = await apiRequest("POST", "/api/stripe/verify-session", { sessionId });
          const data = await result.json();
          if (data.success) {
            if (data.credits) {
              setDetails(prev => prev ? { ...prev, credits: data.credits } : prev);
            }
            handleSuccess();
          } else {
            setStatus("failure");
          }
        } else if (gatewayParam === "paypal" && (paymentId || orderId || token)) {
          const result = await apiRequest("POST", "/api/paypal/capture-order", { orderId: paymentId || orderId || token });
          const data = await result.json();
          if (data.success) {
            if (data.credits) {
              setDetails(prev => prev ? { ...prev, credits: data.credits } : prev);
            }
            handleSuccess();
          } else {
            setStatus("failure");
          }
        } else if (gatewayParam === "paystack" && reference) {
          const result = await apiRequest("POST", "/api/paystack/verify-payment", { reference });
          const data = await result.json();
          if (data.success) {
            if (data.credits) {
              setDetails(prev => prev ? { ...prev, credits: data.credits } : prev);
            }
            handleSuccess();
          } else {
            setStatus("failure");
          }
        } else if (gatewayParam === "mercadopago") {
          if (paymentStatus === "rejected" || paymentStatus === "failure") {
            setStatus("failure");
          } else if (typeParam === "subscription" && preapprovalId && planIdParam) {
            const result = await apiRequest("POST", "/api/mercadopago/confirm-subscription", {
              subscriptionId: preapprovalId,
              planId: planIdParam,
              billingPeriod: billingPeriodParam || "monthly",
            });
            const data = await result.json();
            if (data.success) {
              if (data.planName) {
                setDetails(prev => prev ? { ...prev, planName: data.planName } : prev);
              }
              handleSuccess();
            } else {
              setStatus("failure");
            }
          } else if (typeParam === "credits" && paymentId) {
            const result = await apiRequest("POST", "/api/mercadopago/verify-payment", {
              paymentId,
              externalReference: externalReference || undefined,
            });
            const data = await result.json();
            if (data.success) {
              if (data.credits) {
                setDetails(prev => prev ? { ...prev, credits: data.credits } : prev);
              }
              handleSuccess();
            } else {
              setStatus("failure");
            }
          } else if (paymentStatus === "approved" || statusParam === "success") {
            handleSuccess();
          } else {
            setStatus("processing");
          }
        } else if (statusParam === "success") {
          handleSuccess();
        } else {
          setStatus("processing");
        }
      } catch (error) {
        console.error("Payment verification error:", error);
        if (statusParam === "success") {
          handleSuccess();
        } else {
          setStatus("failure");
        }
      } finally {
        setVerifying(false);
      }
    };

    const hasGatewayIdentifier = sessionId || paymentId || orderId || token || reference || preferenceId;
    if (hasGatewayIdentifier || gatewayParam) {
      verifyPayment();
    } else if (statusParam === "success") {
      handleSuccess();
    } else {
      setStatus("processing");
    }
  }, []);

  const getTitle = () => {
    switch (status) {
      case "success":
        return details?.type === "subscription" 
          ? t("payment.subscriptionSuccess") || "Subscription Activated!"
          : t("payment.creditsSuccess") || "Credits Purchased!";
      case "failure":
        return t("payment.failed") || "Payment Failed";
      case "cancelled":
        return t("payment.cancelled") || "Payment Cancelled";
      case "processing":
        return t("payment.processing") || "Processing Payment...";
    }
  };

  const getDescription = () => {
    switch (status) {
      case "success":
        if (details?.type === "subscription") {
          return details?.planName 
            ? `${t("payment.welcomeToPlan") || "Welcome to"} ${details.planName}! ${t("payment.subscriptionActive") || "Your subscription is now active."}`
            : t("payment.subscriptionActiveGeneric") || "Your subscription has been activated successfully.";
        }
        return details?.credits 
          ? `${details.credits.toLocaleString()} ${t("payment.creditsAdded") || "credits have been added to your account."}`
          : t("payment.creditsAddedGeneric") || "Your credits have been added to your account.";
      case "failure":
        return t("payment.failedDescription") || "We couldn't process your payment. Please try again or use a different payment method.";
      case "cancelled":
        return t("payment.cancelledDescription") || "You cancelled the payment. No charges have been made to your account.";
      case "processing":
        return verifying 
          ? (t("payment.verifyingDescription") || "Verifying your payment with the payment provider...")
          : (t("payment.processingDescription") || "Please wait while we confirm your payment...");
    }
  };

  const confettiParticles = showConfetti ? Array.from({ length: 30 }, (_, i) => ({
    delay: Math.random() * 0.5,
    x: Math.random() * 100,
    id: i,
  })) : [];

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {confettiParticles.map((particle) => (
          <ConfettiParticle key={particle.id} delay={particle.delay} x={particle.x} />
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <Card className="p-8 bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl border-slate-200/50 dark:border-slate-700/50 shadow-2xl">
          <div className="flex flex-col items-center text-center space-y-6">
            <AnimatePresence mode="wait">
              {status === "processing" && <ProcessingAnimation key="processing" />}
              {status === "success" && <CheckmarkAnimation key="success" />}
              {(status === "failure" || status === "cancelled") && <FailureAnimation key="failure" />}
            </AnimatePresence>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="space-y-3"
            >
              <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100" data-testid="text-payment-result-title">
                {getTitle()}
              </h1>
              <p className="text-slate-600 dark:text-slate-400" data-testid="text-payment-result-description">
                {getDescription()}
              </p>
            </motion.div>

            {details && status !== "processing" && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.7 }}
                className="w-full bg-slate-50 dark:bg-slate-900/50 rounded-xl p-4 space-y-2"
              >
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-500 dark:text-slate-400">{t("payment.paymentMethod") || "Payment Method"}</span>
                  <span className="font-medium text-slate-700 dark:text-slate-300" data-testid="text-payment-gateway">
                    {gatewayNames[details.gateway] || details.gateway}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-500 dark:text-slate-400">{t("payment.type") || "Type"}</span>
                  <span className="font-medium text-slate-700 dark:text-slate-300 capitalize flex items-center gap-1" data-testid="text-payment-type">
                    {details.type === "subscription" ? (
                      <>
                        <Crown className="h-4 w-4 text-indigo-500" />
                        {t("payment.subscription") || "Subscription"}
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4 text-amber-500" />
                        {t("payment.creditPurchase") || "Credit Purchase"}
                      </>
                    )}
                  </span>
                </div>
                {details.amount && details.currency && (
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-500 dark:text-slate-400">{t("payment.amount") || "Amount"}</span>
                    <span className="font-medium text-slate-700 dark:text-slate-300" data-testid="text-payment-amount">
                      {details.currency} {details.amount}
                    </span>
                  </div>
                )}
                {details.credits && (
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-500 dark:text-slate-400">{t("payment.credits") || "Credits"}</span>
                    <span className="font-medium text-emerald-600 dark:text-emerald-400" data-testid="text-payment-credits">
                      +{details.credits.toLocaleString()}
                    </span>
                  </div>
                )}
                {details.planName && (
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-500 dark:text-slate-400">{t("payment.plan") || "Plan"}</span>
                    <span className="font-medium text-indigo-600 dark:text-indigo-400" data-testid="text-payment-plan">
                      {details.planName}
                    </span>
                  </div>
                )}
                {details.transactionId && (
                  <div className="flex justify-between items-center text-sm pt-2 border-t border-slate-200 dark:border-slate-700">
                    <span className="text-slate-500 dark:text-slate-400">{t("payment.transactionId") || "Transaction ID"}</span>
                    <span className="font-mono text-xs text-slate-600 dark:text-slate-400 truncate max-w-[150px]" data-testid="text-transaction-id">
                      {details.transactionId}
                    </span>
                  </div>
                )}
              </motion.div>
            )}

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.9 }}
              className="w-full space-y-3 pt-2"
            >
              {status === "failure" && (
                <Button
                  variant="default"
                  className="w-full bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800"
                  onClick={() => navigate("/app/billing")}
                  data-testid="button-try-again"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  {t("payment.tryAgain") || "Try Again"}
                </Button>
              )}
              <Button
                variant={status === "failure" ? "outline" : "default"}
                className={status !== "failure" ? "w-full bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800" : "w-full"}
                onClick={() => navigate("/app/billing")}
                data-testid="button-return-billing"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                {t("payment.returnToBilling") || "Return to Billing"}
              </Button>
            </motion.div>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}
