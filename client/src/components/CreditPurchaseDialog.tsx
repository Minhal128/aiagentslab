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
import { useState, useEffect, useMemo } from "react";
import { loadStripe, Stripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, CreditCard, CheckCircle2, Check, ArrowRight, Globe, MapPin, ArrowLeft } from "lucide-react";
import { SiStripe, SiRazorpay, SiPaypal } from "react-icons/si";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useBranding } from "@/components/BrandingProvider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PaystackIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M2 4h20v3H2V4zm0 6h20v3H2v-3zm0 6h14v3H2v-3z"/>
  </svg>
);

const MercadoPagoIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h-2v-6h2v6zm4 0h-2v-6h2v6z"/>
  </svg>
);

interface CurrencyOption {
  code: string;
  symbol: string;
  name: string;
  gateways: GatewayType[];
}

interface PaymentGatewayConfig {
  stripeEnabled: boolean;
  razorpayEnabled: boolean;
  paypalEnabled: boolean;
  paystackEnabled: boolean;
  mercadopagoEnabled: boolean;
  stripePublicKey?: string;
  stripeCurrency?: string;
  stripeCurrencySymbol?: string;
  stripeCurrencyLocked?: boolean;
  razorpayKeyId?: string;
  razorpayCurrency?: string;
  razorpayCurrencySymbol?: string;
  paypalClientId?: string;
  paypalCurrency?: string;
  paypalCurrencySymbol?: string;
  paypalMode?: string;
  paystackPublicKey?: string;
  paystackCurrency?: string;
  paystackCurrencySymbol?: string;
  paystackCurrencies?: string[];
  paystackDefaultCurrency?: string;
  mercadopagoPublicKey?: string;
  mercadopagoCurrency?: string;
  mercadopagoCurrencySymbol?: string;
  mercadopagoCurrencies?: string[];
}

type GatewayType = 'stripe' | 'razorpay' | 'paypal' | 'paystack' | 'mercadopago';

interface StripeConfig {
  enabled: boolean;
  configured: boolean;
  publicKey: string | null;
  currency: {
    currency: string;
    currencyLocked: boolean;
    symbol: string;
  };
}

interface PaymentFormProps {
  packageId: string;
  packageName: string;
  credits: number;
  amount: string;
  clientSecret: string;
  onSuccess: () => void;
  onCancel: () => void;
  currencySymbol?: string;
}

function PaymentForm({ packageId, packageName, credits, amount, clientSecret, onSuccess, onCancel, currencySymbol = '$' }: PaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsProcessing(true);

    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
      });

      if (error) {
        toast({
          title: "Payment Failed",
          description: error.message,
          variant: "destructive",
        });
        setIsProcessing(false);
        return;
      }

      if (paymentIntent && paymentIntent.status === "succeeded") {
        const response = await apiRequest("POST", "/api/stripe/confirm-payment", {
          paymentIntentId: paymentIntent.id,
        });
        const data = await response.json();

        setPaymentSuccess(true);
        toast({
          title: "Payment Successful",
          description: `${credits} credits have been added to your account.`,
        });

        setTimeout(() => {
          onSuccess();
        }, 1500);
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Payment processing failed",
        variant: "destructive",
      });
      setIsProcessing(false);
    }
  };

  if (paymentSuccess) {
    return (
      <div className="flex flex-col items-center justify-center py-8 space-y-4">
        <CheckCircle2 className="h-16 w-16 text-green-500" />
        <h3 className="text-xl font-semibold">Payment Successful!</h3>
        <p className="text-muted-foreground text-center">
          {credits} credits have been added to your account
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-muted/50 p-4 rounded-md space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">Package:</span>
          <span className="font-semibold">{packageName}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">Credits:</span>
          <span className="font-semibold">{credits.toLocaleString()}</span>
        </div>
        <div className="flex justify-between items-center border-t pt-2">
          <span className="text-sm text-muted-foreground">Total:</span>
          <span className="text-lg font-bold">{currencySymbol}{parseFloat(amount).toFixed(2)}</span>
        </div>
      </div>

      <PaymentElement />

      <div className="flex gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isProcessing}
          className="flex-1"
          data-testid="button-cancel-payment"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={!stripe || isProcessing}
          className="flex-1"
          data-testid="button-complete-payment"
        >
          {isProcessing ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <CreditCard className="h-4 w-4 mr-2" />
              Pay {currencySymbol}{parseFloat(amount).toFixed(2)}
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

interface CreditPurchaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  packageId: string;
  onSuccess: () => void;
}

export function CreditPurchaseDialog({
  open,
  onOpenChange,
  packageId,
  onSuccess,
}: CreditPurchaseDialogProps) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [razorpayOrderId, setRazorpayOrderId] = useState<string | null>(null);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const [packageData, setPackageData] = useState<{
    packageName: string;
    credits: number;
    amount: string;
    currencySymbol?: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [selectedCurrency, setSelectedCurrency] = useState<string>('');
  const [selectedGateway, setSelectedGateway] = useState<GatewayType | null>(null);
  const [step, setStep] = useState<'selection' | 'billing' | 'payment'>('selection');
  
  // Billing form state
  const [billingName, setBillingName] = useState('');
  const [billingAddressLine1, setBillingAddressLine1] = useState('');
  const [billingAddressLine2, setBillingAddressLine2] = useState('');
  const [billingCity, setBillingCity] = useState('');
  const [billingState, setBillingState] = useState('');
  const [billingPostalCode, setBillingPostalCode] = useState('');
  const [billingCountry, setBillingCountry] = useState('');
  const [billingErrors, setBillingErrors] = useState<Record<string, string>>({});
  const [savingBilling, setSavingBilling] = useState(false);
  const { toast } = useToast();
  const { branding } = useBranding();

  const { data: paymentGateway, isError: paymentGatewayError } = useQuery<PaymentGatewayConfig>({
    queryKey: ["/api/settings/payment-gateway"],
  });

  const { data: stripeConfig, isError: stripeConfigError } = useQuery<StripeConfig>({
    queryKey: ["/api/stripe/config"],
  });

  // Fetch billing profile when dialog opens
  interface BillingProfile {
    billingName?: string | null;
    billingAddressLine1?: string | null;
    billingAddressLine2?: string | null;
    billingCity?: string | null;
    billingState?: string | null;
    billingPostalCode?: string | null;
    billingCountry?: string | null;
  }

  const { data: billingProfile, isLoading: billingProfileLoading } = useQuery<BillingProfile>({
    queryKey: ["/api/billing-profile"],
    enabled: open,
  });

  // Prefill billing form fields from fetched profile
  useEffect(() => {
    if (billingProfile && open) {
      setBillingName(billingProfile.billingName || '');
      setBillingAddressLine1(billingProfile.billingAddressLine1 || '');
      setBillingAddressLine2(billingProfile.billingAddressLine2 || '');
      setBillingCity(billingProfile.billingCity || '');
      setBillingState(billingProfile.billingState || '');
      setBillingPostalCode(billingProfile.billingPostalCode || '');
      setBillingCountry(billingProfile.billingCountry || '');
    }
  }, [billingProfile, open]);

  const currencySymbols: Record<string, string> = {
    'USD': '$', 'EUR': '€', 'GBP': '£', 'CAD': 'C$', 'AUD': 'A$',
    'JPY': '¥', 'INR': '₹', 'BRL': 'R$', 'MXN': '$', 'CHF': 'CHF',
    'NGN': '₦', 'GHS': '₵', 'ZAR': 'R', 'KES': 'KSh',
    'ARS': '$', 'CLP': '$', 'COP': '$', 'PEN': 'S/', 'UYU': '$'
  };

  const currencyNames: Record<string, string> = {
    'USD': 'US Dollar', 'EUR': 'Euro', 'GBP': 'British Pound', 'CAD': 'Canadian Dollar',
    'AUD': 'Australian Dollar', 'JPY': 'Japanese Yen', 'INR': 'Indian Rupee',
    'BRL': 'Brazilian Real', 'MXN': 'Mexican Peso', 'CHF': 'Swiss Franc',
    'NGN': 'Nigerian Naira', 'GHS': 'Ghanaian Cedi', 'ZAR': 'South African Rand',
    'KES': 'Kenyan Shilling', 'ARS': 'Argentine Peso', 'CLP': 'Chilean Peso',
    'COP': 'Colombian Peso', 'PEN': 'Peruvian Sol', 'UYU': 'Uruguayan Peso'
  };

  const buildAvailableCurrencies = (): CurrencyOption[] => {
    if (!paymentGateway) return [];
    
    const currencyMap = new Map<string, GatewayType[]>();
    
    if (paymentGateway.stripeEnabled && paymentGateway.stripeCurrency) {
      const curr = paymentGateway.stripeCurrency.toUpperCase();
      currencyMap.set(curr, [...(currencyMap.get(curr) || []), 'stripe']);
    }
    
    if (paymentGateway.razorpayEnabled) {
      currencyMap.set('INR', [...(currencyMap.get('INR') || []), 'razorpay']);
    }
    
    if (paymentGateway.paypalEnabled && paymentGateway.paypalCurrency) {
      const curr = paymentGateway.paypalCurrency.toUpperCase();
      currencyMap.set(curr, [...(currencyMap.get(curr) || []), 'paypal']);
    }
    
    if (paymentGateway.paystackEnabled && paymentGateway.paystackCurrency) {
      const curr = paymentGateway.paystackCurrency.toUpperCase();
      currencyMap.set(curr, [...(currencyMap.get(curr) || []), 'paystack']);
    }
    
    if (paymentGateway.mercadopagoEnabled && paymentGateway.mercadopagoCurrency) {
      const curr = paymentGateway.mercadopagoCurrency.toUpperCase();
      currencyMap.set(curr, [...(currencyMap.get(curr) || []), 'mercadopago']);
    }
    
    return Array.from(currencyMap.entries()).map(([code, gateways]) => ({
      code,
      symbol: currencySymbols[code] || code,
      name: currencyNames[code] || code,
      gateways
    }));
  };

  const getGatewaysForCurrency = (currencyCode: string): GatewayType[] => {
    const currencies = buildAvailableCurrencies();
    const currency = currencies.find(c => c.code === currencyCode);
    return currency?.gateways || [];
  };

  const getGatewayInfo = (gateway: GatewayType): { icon: React.ComponentType<{ className?: string }>; name: string } => {
    const info: Record<GatewayType, { icon: React.ComponentType<{ className?: string }>; name: string }> = {
      stripe: { icon: SiStripe, name: 'Stripe' },
      razorpay: { icon: SiRazorpay, name: 'Razorpay' },
      paypal: { icon: SiPaypal, name: 'PayPal' },
      paystack: { icon: PaystackIcon, name: 'Paystack' },
      mercadopago: { icon: MercadoPagoIcon, name: 'MercadoPago' },
    };
    return info[gateway];
  };

  useEffect(() => {
    if (open && paymentGateway) {
      const currencies = buildAvailableCurrencies();
      if (currencies.length > 0) {
        const defaultCurrency = currencies[0];
        setSelectedCurrency(defaultCurrency.code);
        const gateways = defaultCurrency.gateways;
        setSelectedGateway(gateways[0] || null);
      } else {
        setSelectedCurrency('');
        setSelectedGateway(null);
      }
      setStep('selection');
    }
  }, [open, paymentGateway]);

  useEffect(() => {
    if (selectedCurrency && paymentGateway) {
      const gateways = getGatewaysForCurrency(selectedCurrency);
      if (gateways.length > 0 && (!selectedGateway || !gateways.includes(selectedGateway))) {
        setSelectedGateway(gateways[0]);
      }
    }
  }, [selectedCurrency, paymentGateway]);

  useEffect(() => {
    if (stripeConfig?.publicKey && !stripePromise) {
      console.log('Loading Stripe with API public key');
      setStripePromise(loadStripe(stripeConfig.publicKey));
    }
  }, [stripeConfig?.publicKey, stripePromise]);

  const useRazorpay = selectedGateway === 'razorpay' && paymentGateway?.razorpayEnabled;
  const useStripePayment = selectedGateway === 'stripe' && paymentGateway?.stripeEnabled;
  const usePaypal = selectedGateway === 'paypal' && paymentGateway?.paypalEnabled;
  const usePaystack = selectedGateway === 'paystack' && paymentGateway?.paystackEnabled;
  const useMercadopago = selectedGateway === 'mercadopago' && paymentGateway?.mercadopagoEnabled;

  useEffect(() => {
    if (paymentGateway?.razorpayEnabled) {
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      document.body.appendChild(script);
      return () => {
        if (document.body.contains(script)) {
          document.body.removeChild(script);
        }
      };
    }
  }, [paymentGateway?.razorpayEnabled]);

  useEffect(() => {
    if (open && step === 'payment' && !clientSecret && !razorpayOrderId && !redirectUrl && paymentGateway && selectedGateway) {
      console.log('Loading payment for package:', packageId, 'currency:', selectedCurrency, 'gateway:', selectedGateway);
      setLoading(true);
      
      if (useRazorpay) {
        apiRequest("POST", "/api/razorpay/create-order", { packageId })
          .then(async (response) => {
            const data = await response.json();
            console.log('Razorpay order created:', data);
            setRazorpayOrderId(data.orderId);
            setPackageData({
              packageName: data.packageName,
              credits: data.credits,
              amount: data.amount,
              currencySymbol: '₹',
            });
            setLoading(false);
            
            if (data.orderId && paymentGateway.razorpayKeyId) {
              openRazorpayCheckout(data.orderId, paymentGateway.razorpayKeyId, data);
            }
          })
          .catch((error: any) => {
            console.error('Razorpay order error:', error);
            toast({
              title: "Error",
              description: error.message || "Failed to initialize payment",
              variant: "destructive",
            });
            onOpenChange(false);
            setLoading(false);
          });
      } else if (usePaypal) {
        apiRequest("POST", "/api/paypal/create-order", { packageId })
          .then(async (response) => {
            const data = await response.json();
            console.log('PayPal order created:', data);
            setPackageData({
              packageName: data.packageName,
              credits: data.credits,
              amount: data.amount.toString(),
              currencySymbol: data.currencySymbol || '$',
            });
            if (data.approvalUrl) {
              setRedirectUrl(data.approvalUrl);
            }
            setLoading(false);
          })
          .catch((error: any) => {
            console.error('PayPal order error:', error);
            toast({
              title: "Error",
              description: error.message || "Failed to initialize PayPal payment",
              variant: "destructive",
            });
            onOpenChange(false);
            setLoading(false);
          });
      } else if (usePaystack) {
        apiRequest("POST", "/api/paystack/initialize-credits", { packageId })
          .then(async (response) => {
            const data = await response.json();
            console.log('Paystack transaction initialized:', data);
            setPackageData({
              packageName: data.packageName,
              credits: data.credits,
              amount: data.amount.toString(),
              currencySymbol: data.currencySymbol || '₦',
            });
            if (data.authorizationUrl) {
              setRedirectUrl(data.authorizationUrl);
            }
            setLoading(false);
          })
          .catch((error: any) => {
            console.error('Paystack transaction error:', error);
            toast({
              title: "Error",
              description: error.message || "Failed to initialize Paystack payment",
              variant: "destructive",
            });
            onOpenChange(false);
            setLoading(false);
          });
      } else if (useMercadopago) {
        apiRequest("POST", "/api/mercadopago/create-preference", { packageId })
          .then(async (response) => {
            const data = await response.json();
            console.log('MercadoPago preference created:', data);
            setPackageData({
              packageName: data.packageName,
              credits: data.credits,
              amount: data.amount.toString(),
              currencySymbol: data.currencySymbol || 'R$',
            });
            if (data.initPoint || data.sandboxInitPoint) {
              setRedirectUrl(data.initPoint || data.sandboxInitPoint);
            }
            setLoading(false);
          })
          .catch((error: any) => {
            console.error('MercadoPago preference error:', error);
            toast({
              title: "Error",
              description: error.message || "Failed to initialize MercadoPago payment",
              variant: "destructive",
            });
            onOpenChange(false);
            setLoading(false);
          });
      } else if (useStripePayment) {
        apiRequest("POST", "/api/stripe/create-payment-intent", { packageId })
          .then(async (response) => {
            const data = await response.json();
            console.log('Payment intent created:', data);
            setClientSecret(data.clientSecret);
            setPackageData({
              packageName: data.packageName,
              credits: data.credits,
              amount: data.amount,
              currencySymbol: paymentGateway?.stripeCurrencySymbol || '$',
            });
            setLoading(false);
          })
          .catch((error: any) => {
            console.error('Payment intent error:', error);
            toast({
              title: "Error",
              description: error.message || "Failed to initialize payment",
              variant: "destructive",
            });
            onOpenChange(false);
            setLoading(false);
          });
      } else {
        toast({
          title: "Error",
          description: "No valid payment gateway selected",
          variant: "destructive",
        });
        onOpenChange(false);
        setLoading(false);
      }
    }

    if (!open) {
      setClientSecret(null);
      setRazorpayOrderId(null);
      setRedirectUrl(null);
      setPackageData(null);
      setLoading(false);
      setPaymentSuccess(false);
      setStep('selection');
      setBillingErrors({});
      setSavingBilling(false);
    }
  }, [open, step, packageId, paymentGateway, selectedGateway]);

  const openRazorpayCheckout = (orderId: string, keyId: string, data: any) => {
    const options = {
      key: keyId,
      amount: Math.round(parseFloat(data.amount) * 100),
      currency: data.currency || 'INR',
      name: branding.app_name || '',
      description: `Purchase ${data.credits} Credits`,
      order_id: orderId,
      handler: async function (paymentResponse: any) {
        try {
          await apiRequest("POST", "/api/razorpay/verify-order", {
            razorpay_order_id: paymentResponse.razorpay_order_id,
            razorpay_payment_id: paymentResponse.razorpay_payment_id,
            razorpay_signature: paymentResponse.razorpay_signature,
            packageId,
          });
          
          setPaymentSuccess(true);
          queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
          queryClient.invalidateQueries({ queryKey: ["/api/credit-transactions"] });
          
          toast({
            title: "Payment Successful",
            description: `${data.credits} credits have been added to your account.`,
          });
          
          setTimeout(() => {
            onSuccess();
            onOpenChange(false);
          }, 1500);
        } catch (error: any) {
          toast({
            title: "Error",
            description: error.message || "Payment verification failed",
            variant: "destructive",
          });
        }
      },
      prefill: {},
      theme: {
        color: '#6366f1',
      },
      modal: {
        ondismiss: function() {
          onOpenChange(false);
        }
      }
    };
    
    const razorpay = new (window as any).Razorpay(options);
    razorpay.open();
  };

  const handleOpenChange = (isOpen: boolean) => {
    onOpenChange(isOpen);
  };

  const handleSuccess = () => {
    setClientSecret(null);
    setRazorpayOrderId(null);
    setRedirectUrl(null);
    setPackageData(null);
    onSuccess();
    onOpenChange(false);
  };

  const handleRedirectPayment = () => {
    if (redirectUrl) {
      window.location.href = redirectUrl;
    }
  };

  const getGatewayName = () => {
    switch (selectedGateway) {
      case 'paypal': return 'PayPal';
      case 'paystack': return 'Paystack';
      case 'mercadopago': return 'MercadoPago';
      default: return 'Payment Provider';
    }
  };

  console.log('Dialog state:', { open, loading, step, hasClientSecret: !!clientSecret, hasRazorpayOrderId: !!razorpayOrderId, hasRedirectUrl: !!redirectUrl, hasPackageData: !!packageData, currency: selectedCurrency, gateway: selectedGateway });

  const options = clientSecret ? {
    clientSecret,
    appearance: {
      theme: "stripe" as const,
    },
  } : undefined;

  const availableCurrencies = buildAvailableCurrencies();
  const availableGateways = selectedCurrency ? getGatewaysForCurrency(selectedCurrency) : [];

  const handleProceedToPayment = () => {
    if (selectedCurrency && selectedGateway) {
      setStep('billing');
    }
  };

  const validateBillingForm = (): boolean => {
    const errors: Record<string, string> = {};
    
    if (!billingName.trim()) {
      errors.billingName = 'Full name is required';
    }
    if (!billingAddressLine1.trim()) {
      errors.billingAddressLine1 = 'Address line 1 is required';
    }
    if (!billingCity.trim()) {
      errors.billingCity = 'City is required';
    }
    if (!billingState.trim()) {
      errors.billingState = 'State/Province is required';
    }
    if (!billingPostalCode.trim()) {
      errors.billingPostalCode = 'Postal code is required';
    }
    if (!billingCountry) {
      errors.billingCountry = 'Country is required';
    }
    
    setBillingErrors(errors);
    
    if (Object.keys(errors).length > 0) {
      return false;
    }
    return true;
  };

  const handleProceedFromBilling = async () => {
    if (!validateBillingForm()) {
      return;
    }
    
    setSavingBilling(true);
    try {
      await apiRequest("PUT", "/api/billing-profile", {
        billingName,
        billingAddressLine1,
        billingAddressLine2,
        billingCity,
        billingState,
        billingPostalCode,
        billingCountry,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/billing-profile"] });
      setStep('payment');
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save billing details",
        variant: "destructive",
      });
    } finally {
      setSavingBilling(false);
    }
  };

  const handleBackToSelection = () => {
    setStep('selection');
    setBillingErrors({});
  };

  const handleBackToBilling = () => {
    setStep('billing');
    setClientSecret(null);
    setRazorpayOrderId(null);
    setRedirectUrl(null);
    setPackageData(null);
    setLoading(false);
  };

  const countries = [
    { code: 'AL', name: 'Albania' },
    { code: 'DZ', name: 'Algeria' },
    { code: 'AD', name: 'Andorra' },
    { code: 'AO', name: 'Angola' },
    { code: 'AG', name: 'Antigua and Barbuda' },
    { code: 'AR', name: 'Argentina' },
    { code: 'AM', name: 'Armenia' },
    { code: 'AU', name: 'Australia' },
    { code: 'AT', name: 'Austria' },
    { code: 'AZ', name: 'Azerbaijan' },
    { code: 'BS', name: 'Bahamas' },
    { code: 'BH', name: 'Bahrain' },
    { code: 'BD', name: 'Bangladesh' },
    { code: 'BE', name: 'Belgium' },
    { code: 'BJ', name: 'Benin' },
    { code: 'BT', name: 'Bhutan' },
    { code: 'BO', name: 'Bolivia' },
    { code: 'BA', name: 'Bosnia and Herzegovina' },
    { code: 'BW', name: 'Botswana' },
    { code: 'BR', name: 'Brazil' },
    { code: 'BN', name: 'Brunei' },
    { code: 'BG', name: 'Bulgaria' },
    { code: 'KH', name: 'Cambodia' },
    { code: 'CA', name: 'Canada' },
    { code: 'CL', name: 'Chile' },
    { code: 'CN', name: 'China' },
    { code: 'CO', name: 'Colombia' },
    { code: 'CR', name: 'Costa Rica' },
    { code: 'CI', name: "Côte d'Ivoire" },
    { code: 'HR', name: 'Croatia' },
    { code: 'CY', name: 'Cyprus' },
    { code: 'CZ', name: 'Czech Republic' },
    { code: 'DK', name: 'Denmark' },
    { code: 'DO', name: 'Dominican Republic' },
    { code: 'EC', name: 'Ecuador' },
    { code: 'EG', name: 'Egypt' },
    { code: 'SV', name: 'El Salvador' },
    { code: 'EE', name: 'Estonia' },
    { code: 'ET', name: 'Ethiopia' },
    { code: 'FI', name: 'Finland' },
    { code: 'FR', name: 'France' },
    { code: 'GA', name: 'Gabon' },
    { code: 'GM', name: 'Gambia' },
    { code: 'GE', name: 'Georgia' },
    { code: 'DE', name: 'Germany' },
    { code: 'GH', name: 'Ghana' },
    { code: 'GI', name: 'Gibraltar' },
    { code: 'GR', name: 'Greece' },
    { code: 'GT', name: 'Guatemala' },
    { code: 'GN', name: 'Guinea' },
    { code: 'GY', name: 'Guyana' },
    { code: 'HK', name: 'Hong Kong' },
    { code: 'HU', name: 'Hungary' },
    { code: 'IS', name: 'Iceland' },
    { code: 'IN', name: 'India' },
    { code: 'ID', name: 'Indonesia' },
    { code: 'IE', name: 'Ireland' },
    { code: 'IL', name: 'Israel' },
    { code: 'IT', name: 'Italy' },
    { code: 'JM', name: 'Jamaica' },
    { code: 'JP', name: 'Japan' },
    { code: 'JO', name: 'Jordan' },
    { code: 'KZ', name: 'Kazakhstan' },
    { code: 'KE', name: 'Kenya' },
    { code: 'KW', name: 'Kuwait' },
    { code: 'LV', name: 'Latvia' },
    { code: 'LI', name: 'Liechtenstein' },
    { code: 'LT', name: 'Lithuania' },
    { code: 'LU', name: 'Luxembourg' },
    { code: 'MO', name: 'Macau' },
    { code: 'MK', name: 'North Macedonia' },
    { code: 'MG', name: 'Madagascar' },
    { code: 'MY', name: 'Malaysia' },
    { code: 'MT', name: 'Malta' },
    { code: 'MU', name: 'Mauritius' },
    { code: 'MX', name: 'Mexico' },
    { code: 'MD', name: 'Moldova' },
    { code: 'MC', name: 'Monaco' },
    { code: 'MN', name: 'Mongolia' },
    { code: 'ME', name: 'Montenegro' },
    { code: 'MA', name: 'Morocco' },
    { code: 'MZ', name: 'Mozambique' },
    { code: 'NA', name: 'Namibia' },
    { code: 'NL', name: 'Netherlands' },
    { code: 'NZ', name: 'New Zealand' },
    { code: 'NE', name: 'Niger' },
    { code: 'NG', name: 'Nigeria' },
    { code: 'NO', name: 'Norway' },
    { code: 'OM', name: 'Oman' },
    { code: 'PK', name: 'Pakistan' },
    { code: 'PA', name: 'Panama' },
    { code: 'PY', name: 'Paraguay' },
    { code: 'PE', name: 'Peru' },
    { code: 'PH', name: 'Philippines' },
    { code: 'PL', name: 'Poland' },
    { code: 'PT', name: 'Portugal' },
    { code: 'QA', name: 'Qatar' },
    { code: 'RO', name: 'Romania' },
    { code: 'RU', name: 'Russia' },
    { code: 'RW', name: 'Rwanda' },
    { code: 'SM', name: 'San Marino' },
    { code: 'SA', name: 'Saudi Arabia' },
    { code: 'SN', name: 'Senegal' },
    { code: 'RS', name: 'Serbia' },
    { code: 'SG', name: 'Singapore' },
    { code: 'SK', name: 'Slovakia' },
    { code: 'SI', name: 'Slovenia' },
    { code: 'ZA', name: 'South Africa' },
    { code: 'KR', name: 'South Korea' },
    { code: 'ES', name: 'Spain' },
    { code: 'LK', name: 'Sri Lanka' },
    { code: 'LC', name: 'St. Lucia' },
    { code: 'SE', name: 'Sweden' },
    { code: 'CH', name: 'Switzerland' },
    { code: 'TW', name: 'Taiwan' },
    { code: 'TZ', name: 'Tanzania' },
    { code: 'TH', name: 'Thailand' },
    { code: 'TT', name: 'Trinidad and Tobago' },
    { code: 'TN', name: 'Tunisia' },
    { code: 'TR', name: 'Turkey' },
    { code: 'UG', name: 'Uganda' },
    { code: 'UA', name: 'Ukraine' },
    { code: 'AE', name: 'United Arab Emirates' },
    { code: 'GB', name: 'United Kingdom' },
    { code: 'US', name: 'United States' },
    { code: 'UY', name: 'Uruguay' },
    { code: 'UZ', name: 'Uzbekistan' },
    { code: 'VE', name: 'Venezuela' },
    { code: 'VN', name: 'Vietnam' },
    { code: 'ZM', name: 'Zambia' },
  ];

  if (step === 'selection') {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[500px]" data-testid="dialog-credit-purchase">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Select Payment Method
            </DialogTitle>
            <DialogDescription>
              Choose your preferred currency and payment gateway
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {availableCurrencies.length > 0 ? (
              <>
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-3">
                    Pay in:
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {availableCurrencies.map((currency) => (
                      <Button
                        key={currency.code}
                        variant={selectedCurrency === currency.code ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setSelectedCurrency(currency.code)}
                        className={`gap-1.5 ${
                          selectedCurrency === currency.code 
                            ? 'bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-600 dark:hover:bg-indigo-700' 
                            : ''
                        }`}
                        data-testid={`button-currency-${currency.code.toLowerCase()}`}
                      >
                        <span className="font-semibold">{currency.symbol}</span>
                        <span>{currency.code}</span>
                      </Button>
                    ))}
                  </div>
                </div>

                {selectedCurrency && availableGateways.length > 0 && (
                  <div>
                    <div className="text-sm font-medium text-muted-foreground mb-3">
                      Pay with:
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      {availableGateways.map((gateway) => {
                        const info = getGatewayInfo(gateway);
                        const Icon = info.icon;
                        const isSelected = selectedGateway === gateway;
                        
                        return (
                          <button
                            key={gateway}
                            type="button"
                            onClick={() => setSelectedGateway(gateway)}
                            className={`relative flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 transition-all duration-200 ${
                              isSelected
                                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/50 shadow-md'
                                : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 bg-white dark:bg-slate-800'
                            }`}
                            data-testid={`button-gateway-${gateway}`}
                          >
                            <Icon className={`h-5 w-5 ${isSelected ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-600 dark:text-slate-400'}`} />
                            <span className={`font-medium ${isSelected ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-700 dark:text-slate-300'}`}>
                              {info.name}
                            </span>
                            {isSelected && (
                              <div className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-indigo-600 flex items-center justify-center">
                                <Check className="h-3 w-3 text-white" />
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p>Loading payment options...</p>
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-4 border-t">
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              className="flex-1"
              data-testid="button-cancel-selection"
            >
              Cancel
            </Button>
            <Button
              onClick={handleProceedToPayment}
              disabled={!selectedCurrency || !selectedGateway}
              className="flex-1"
              data-testid="button-proceed-payment"
            >
              Continue to Payment
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (step === 'billing') {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[500px]" data-testid="dialog-billing-details">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Billing Details
            </DialogTitle>
            <DialogDescription>
              Enter your billing information for this purchase
            </DialogDescription>
          </DialogHeader>

          {billingProfileLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">Loading billing details...</span>
            </div>
          ) : (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="billingName">Full Name <span className="text-destructive">*</span></Label>
                <Input
                  id="billingName"
                  placeholder="John Doe"
                  value={billingName}
                  onChange={(e) => {
                    setBillingName(e.target.value);
                    if (billingErrors.billingName) {
                      setBillingErrors(prev => ({ ...prev, billingName: '' }));
                    }
                  }}
                  className={billingErrors.billingName ? 'border-destructive' : ''}
                  data-testid="input-billing-name"
                />
                {billingErrors.billingName && (
                  <p className="text-sm text-destructive" data-testid="error-billing-name">{billingErrors.billingName}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="billingAddressLine1">Address Line 1 <span className="text-destructive">*</span></Label>
                <Input
                  id="billingAddressLine1"
                  placeholder="123 Main Street"
                  value={billingAddressLine1}
                  onChange={(e) => {
                    setBillingAddressLine1(e.target.value);
                    if (billingErrors.billingAddressLine1) {
                      setBillingErrors(prev => ({ ...prev, billingAddressLine1: '' }));
                    }
                  }}
                  className={billingErrors.billingAddressLine1 ? 'border-destructive' : ''}
                  data-testid="input-billing-address-line1"
                />
                {billingErrors.billingAddressLine1 && (
                  <p className="text-sm text-destructive" data-testid="error-billing-address-line1">{billingErrors.billingAddressLine1}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="billingAddressLine2">Address Line 2</Label>
                <Input
                  id="billingAddressLine2"
                  placeholder="Apartment, suite, etc. (optional)"
                  value={billingAddressLine2}
                  onChange={(e) => setBillingAddressLine2(e.target.value)}
                  data-testid="input-billing-address-line2"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="billingCity">City <span className="text-destructive">*</span></Label>
                  <Input
                    id="billingCity"
                    placeholder="New York"
                    value={billingCity}
                    onChange={(e) => {
                      setBillingCity(e.target.value);
                      if (billingErrors.billingCity) {
                        setBillingErrors(prev => ({ ...prev, billingCity: '' }));
                      }
                    }}
                    className={billingErrors.billingCity ? 'border-destructive' : ''}
                    data-testid="input-billing-city"
                  />
                  {billingErrors.billingCity && (
                    <p className="text-sm text-destructive" data-testid="error-billing-city">{billingErrors.billingCity}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="billingState">State/Province <span className="text-destructive">*</span></Label>
                  <Input
                    id="billingState"
                    placeholder="NY"
                    value={billingState}
                    onChange={(e) => {
                      setBillingState(e.target.value);
                      if (billingErrors.billingState) {
                        setBillingErrors(prev => ({ ...prev, billingState: '' }));
                      }
                    }}
                    className={billingErrors.billingState ? 'border-destructive' : ''}
                    data-testid="input-billing-state"
                  />
                  {billingErrors.billingState && (
                    <p className="text-sm text-destructive" data-testid="error-billing-state">{billingErrors.billingState}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="billingPostalCode">Postal Code <span className="text-destructive">*</span></Label>
                  <Input
                    id="billingPostalCode"
                    placeholder="10001"
                    value={billingPostalCode}
                    onChange={(e) => {
                      setBillingPostalCode(e.target.value);
                      if (billingErrors.billingPostalCode) {
                        setBillingErrors(prev => ({ ...prev, billingPostalCode: '' }));
                      }
                    }}
                    className={billingErrors.billingPostalCode ? 'border-destructive' : ''}
                    data-testid="input-billing-postal-code"
                  />
                  {billingErrors.billingPostalCode && (
                    <p className="text-sm text-destructive" data-testid="error-billing-postal-code">{billingErrors.billingPostalCode}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="billingCountry">Country <span className="text-destructive">*</span></Label>
                  <Select 
                    value={billingCountry} 
                    onValueChange={(value) => {
                      setBillingCountry(value);
                      if (billingErrors.billingCountry) {
                        setBillingErrors(prev => ({ ...prev, billingCountry: '' }));
                      }
                    }}
                  >
                    <SelectTrigger 
                      id="billingCountry"
                      className={billingErrors.billingCountry ? 'border-destructive' : ''}
                      data-testid="select-billing-country"
                    >
                      <SelectValue placeholder="Select country" />
                    </SelectTrigger>
                    <SelectContent>
                      {countries.map((country) => (
                        <SelectItem key={country.code} value={country.code} data-testid={`option-country-${country.code.toLowerCase()}`}>
                          {country.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {billingErrors.billingCountry && (
                    <p className="text-sm text-destructive" data-testid="error-billing-country">{billingErrors.billingCountry}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-4 border-t">
            <Button
              variant="outline"
              onClick={handleBackToSelection}
              disabled={savingBilling}
              className="flex-1"
              data-testid="button-back-to-selection"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <Button
              onClick={handleProceedFromBilling}
              disabled={savingBilling || billingProfileLoading}
              className="flex-1"
              data-testid="button-proceed-to-payment"
            >
              {savingBilling ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  Continue
                  <ArrowRight className="h-4 w-4 ml-2" />
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (usePaypal || usePaystack || useMercadopago) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[500px]" data-testid="dialog-credit-purchase">
          <DialogHeader>
            <DialogTitle>Purchase Credits</DialogTitle>
            <DialogDescription>
              Complete your purchase via {getGatewayName()}
            </DialogDescription>
          </DialogHeader>

          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">Initializing payment...</span>
            </div>
          )}

          {!loading && packageData && (
            <div className="space-y-6">
              <div className="bg-muted/50 p-4 rounded-md space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Package:</span>
                  <span className="font-semibold">{packageData.packageName}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Credits:</span>
                  <span className="font-semibold">{packageData.credits.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center border-t pt-2">
                  <span className="text-sm text-muted-foreground">Total:</span>
                  <span className="text-lg font-bold">{packageData.currencySymbol}{parseFloat(packageData.amount).toFixed(2)}</span>
                </div>
              </div>

              <div className="flex flex-col items-center justify-center py-4 space-y-4">
                <p className="text-muted-foreground text-center text-sm">
                  You will be redirected to {getGatewayName()} to complete your payment securely.
                </p>
                <div className="flex gap-3 w-full">
                  <Button
                    variant="outline"
                    onClick={() => handleOpenChange(false)}
                    className="flex-1"
                    data-testid="button-cancel-redirect"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleRedirectPayment}
                    disabled={!redirectUrl}
                    className="flex-1"
                    data-testid="button-proceed-payment"
                  >
                    <CreditCard className="h-4 w-4 mr-2" />
                    Continue to {getGatewayName()}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {!loading && !packageData && (
            <div className="text-center py-8 text-muted-foreground">
              <p>Failed to initialize payment. Please try again.</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    );
  }

  if (useRazorpay) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[500px]" data-testid="dialog-credit-purchase">
          <DialogHeader>
            <DialogTitle>Purchase Credits</DialogTitle>
            <DialogDescription>
              Complete your purchase to add credits to your account
            </DialogDescription>
          </DialogHeader>

          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">Initializing payment...</span>
            </div>
          )}

          {!loading && paymentSuccess && (
            <div className="flex flex-col items-center justify-center py-8 space-y-4">
              <CheckCircle2 className="h-16 w-16 text-green-500" />
              <h3 className="text-xl font-semibold">Payment Successful!</h3>
              <p className="text-muted-foreground text-center">
                {packageData?.credits} credits have been added to your account
              </p>
            </div>
          )}

          {!loading && !paymentSuccess && razorpayOrderId && (
            <div className="flex flex-col items-center justify-center py-8 space-y-4">
              <p className="text-muted-foreground text-center">
                Razorpay checkout should open automatically.
              </p>
              <Button
                onClick={() => {
                  if (razorpayOrderId && paymentGateway?.razorpayKeyId && packageData) {
                    openRazorpayCheckout(razorpayOrderId, paymentGateway.razorpayKeyId, packageData);
                  }
                }}
                data-testid="button-retry-razorpay"
              >
                <CreditCard className="h-4 w-4 mr-2" />
                Open Payment
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]" data-testid="dialog-credit-purchase">
        <DialogHeader>
          <DialogTitle>Purchase Credits</DialogTitle>
          <DialogDescription>
            Complete your purchase to add credits to your account
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && !clientSecret && (
          <div className="text-center py-8 text-muted-foreground">
            <p>Failed to load payment form. Please try again.</p>
          </div>
        )}

        {!loading && !stripePromise && !stripeConfig?.publicKey && (
          <div className="text-center py-8 text-destructive">
            <p>Stripe is not configured. Please contact support.</p>
          </div>
        )}

        {!loading && stripePromise && clientSecret && packageData && options && (
          <Elements stripe={stripePromise} options={options}>
            <PaymentForm
              packageId={packageId}
              packageName={packageData.packageName}
              credits={packageData.credits}
              amount={packageData.amount}
              clientSecret={clientSecret}
              onSuccess={handleSuccess}
              onCancel={() => handleOpenChange(false)}
              currencySymbol={stripeConfig?.currency?.symbol || paymentGateway?.stripeCurrencySymbol || '$'}
            />
          </Elements>
        )}
      </DialogContent>
    </Dialog>
  );
}
