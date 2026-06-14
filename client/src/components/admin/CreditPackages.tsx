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
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { Plus, Edit2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { useTranslation } from "react-i18next";

interface CreditPackage {
  id: string;
  name: string;
  description?: string;
  credits: number;
  price: number; // Stripe price
  razorpayPrice?: number | null; // INR price
  paypalPrice?: number | null; // PayPal price
  paystackPrice?: number | null; // Paystack price
  mercadopagoPrice?: number | null; // MercadoPago price
  stripeProductId?: string | null;
  stripePriceId?: string | null;
  razorpayItemId?: string | null;
  isActive: boolean;
}

interface PaymentGatewayConfig {
  stripeEnabled: boolean;
  razorpayEnabled: boolean;
  paypalEnabled: boolean;
  paystackEnabled: boolean;
  mercadopagoEnabled: boolean;
  stripeCurrency?: string;
  stripeCurrencySymbol?: string;
  paypalCurrency?: string;
  paypalCurrencySymbol?: string;
  paystackCurrency?: string;
  paystackCurrencySymbol?: string;
  paystackCurrencies?: string[];
  paystackDefaultCurrency?: string;
  mercadopagoCurrency?: string;
  mercadopagoCurrencySymbol?: string;
}

export default function CreditPackages() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingPackage, setEditingPackage] = useState<CreditPackage | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    credits: 100,
    price: 10,
    razorpayPrice: 0,
    paypalPrice: 0,
    paystackPrice: 0,
    mercadopagoPrice: 0
  });

  const { data: packages, isLoading } = useQuery<CreditPackage[]>({
    queryKey: ["/api/admin/credit-packages"],
  });

  // Fetch admin settings to get the current Stripe currency
  const { data: adminSettings } = useQuery<Record<string, string>>({
    queryKey: ["/api/admin/settings"],
  });
  
  // Fetch payment gateway configuration
  const { data: paymentGateway } = useQuery<PaymentGatewayConfig>({
    queryKey: ["/api/settings/payment-gateway"],
  });
  
  // Get the Stripe currency (defaults to USD if not set)
  const stripeCurrency = adminSettings?.stripe_currency || "USD";
  
  // Get currencies for other gateways
  const paypalCurrency = paymentGateway?.paypalCurrency?.toUpperCase() || "USD";
  const paystackCurrency = paymentGateway?.paystackCurrency?.toUpperCase() || paymentGateway?.paystackDefaultCurrency?.toUpperCase() || "NGN";
  const mercadopagoCurrency = paymentGateway?.mercadopagoCurrency?.toUpperCase() || "BRL";
  
  // Currency symbol mapping
  const getCurrencySymbol = (currency: string) => {
    const symbols: Record<string, string> = {
      USD: "$",
      EUR: "€",
      GBP: "£",
      INR: "₹",
      AUD: "A$",
      CAD: "C$",
      JPY: "¥",
      CNY: "¥",
      NGN: "₦",
      GHS: "₵",
      ZAR: "R",
      KES: "KSh",
      BRL: "R$",
      MXN: "MX$",
      ARS: "AR$",
      CLP: "CLP$",
      COP: "COP$",
    };
    return symbols[currency] || currency + " ";
  };
  
  const stripeCurrencySymbol = getCurrencySymbol(stripeCurrency);
  const paypalCurrencySymbol = getCurrencySymbol(paypalCurrency);
  const paystackCurrencySymbol = getCurrencySymbol(paystackCurrency);
  const mercadopagoCurrencySymbol = getCurrencySymbol(mercadopagoCurrency);

  const createPackage = useMutation({
    mutationFn: async (data: typeof formData) => {
      return apiRequest("POST", "/api/admin/credit-packages", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/credit-packages"] });
      toast({ title: t("admin.creditPackages.packageCreated") });
      setShowCreateDialog(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        title: t("admin.creditPackages.createFailed"),
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const updatePackage = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<CreditPackage> }) => {
      return apiRequest("PATCH", `/api/admin/credit-packages/${id}`, { ...data, forceStripeSync: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/credit-packages"] });
      toast({ title: t("admin.creditPackages.packageUpdated") });
      setEditingPackage(null);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        title: t("admin.creditPackages.updateFailed"),
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      credits: 100,
      price: 10,
      razorpayPrice: 0,
      paypalPrice: 0,
      paystackPrice: 0,
      mercadopagoPrice: 0
    });
  };

  const handleEdit = (pkg: CreditPackage) => {
    setEditingPackage(pkg);
    setFormData({
      name: pkg.name,
      description: pkg.description || "",
      credits: pkg.credits,
      price: pkg.price,
      razorpayPrice: pkg.razorpayPrice || 0,
      paypalPrice: pkg.paypalPrice || 0,
      paystackPrice: pkg.paystackPrice || 0,
      mercadopagoPrice: pkg.mercadopagoPrice || 0
    });
  };

  const handleSave = () => {
    if (editingPackage) {
      updatePackage.mutate({
        id: editingPackage.id,
        data: formData
      });
    } else {
      createPackage.mutate(formData);
    }
  };

  const handleToggleActive = (pkg: CreditPackage) => {
    updatePackage.mutate({
      id: pkg.id,
      data: { isActive: !pkg.isActive }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">{t("admin.creditPackages.title")}</h2>
          <p className="text-muted-foreground">
            {t("admin.creditPackages.description")}
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-package">
          <Plus className="mr-2 h-4 w-4" />
          {t("admin.creditPackages.createPackage")}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center p-8">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {packages?.map((pkg) => (
            <Card key={pkg.id} className={!pkg.isActive ? "opacity-60" : ""}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{pkg.name}</CardTitle>
                    {pkg.description && (
                      <CardDescription className="mt-1">
                        {pkg.description}
                      </CardDescription>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEdit(pkg)}
                      data-testid={`button-edit-package-${pkg.id}`}
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-2xl font-bold">{pkg.credits} {t("admin.creditPackages.credits")}</span>
                  </div>
                  {paymentGateway?.stripeEnabled && (
                    <div className="flex justify-between items-center text-lg">
                      <span className="text-muted-foreground">{stripeCurrency} (Stripe):</span>
                      <span className="font-semibold">{stripeCurrencySymbol}{pkg.price}</span>
                    </div>
                  )}
                  {paymentGateway?.razorpayEnabled && (
                    pkg.razorpayPrice ? (
                      <div className="flex justify-between items-center text-lg">
                        <span className="text-muted-foreground">INR (Razorpay):</span>
                        <span className="font-semibold">₹{pkg.razorpayPrice}</span>
                      </div>
                    ) : (
                      <div className="flex justify-between items-center text-lg">
                        <span className="text-muted-foreground">INR (Razorpay):</span>
                        <span className="text-sm text-orange-500">Not configured</span>
                      </div>
                    )
                  )}
                  {paymentGateway?.paypalEnabled && (
                    pkg.paypalPrice ? (
                      <div className="flex justify-between items-center text-lg">
                        <span className="text-muted-foreground">{paypalCurrency} (PayPal):</span>
                        <span className="font-semibold">{paypalCurrencySymbol}{pkg.paypalPrice}</span>
                      </div>
                    ) : (
                      <div className="flex justify-between items-center text-lg">
                        <span className="text-muted-foreground">{paypalCurrency} (PayPal):</span>
                        <span className="text-sm text-orange-500">Not configured</span>
                      </div>
                    )
                  )}
                  {paymentGateway?.paystackEnabled && (
                    pkg.paystackPrice ? (
                      <div className="flex justify-between items-center text-lg">
                        <span className="text-muted-foreground">{paystackCurrency} (Paystack):</span>
                        <span className="font-semibold">{paystackCurrencySymbol}{pkg.paystackPrice}</span>
                      </div>
                    ) : (
                      <div className="flex justify-between items-center text-lg">
                        <span className="text-muted-foreground">{paystackCurrency} (Paystack):</span>
                        <span className="text-sm text-orange-500">Not configured</span>
                      </div>
                    )
                  )}
                  {paymentGateway?.mercadopagoEnabled && (
                    pkg.mercadopagoPrice ? (
                      <div className="flex justify-between items-center text-lg">
                        <span className="text-muted-foreground">{mercadopagoCurrency} (MercadoPago):</span>
                        <span className="font-semibold">{mercadopagoCurrencySymbol}{pkg.mercadopagoPrice}</span>
                      </div>
                    ) : (
                      <div className="flex justify-between items-center text-lg">
                        <span className="text-muted-foreground">{mercadopagoCurrency} (MercadoPago):</span>
                        <span className="text-sm text-orange-500">Not configured</span>
                      </div>
                    )
                  )}
                  {paymentGateway?.stripeEnabled && (
                    <div className="text-sm text-muted-foreground border-t pt-2 mt-2">
                      {stripeCurrencySymbol}{(pkg.price / pkg.credits).toFixed(3)} {t("admin.creditPackages.perCredit")}
                    </div>
                  )}
                  <Button
                    variant={pkg.isActive ? "outline" : "default"}
                    size="sm"
                    className="w-full"
                    onClick={() => handleToggleActive(pkg)}
                    data-testid={`button-toggle-package-${pkg.id}`}
                  >
                    {pkg.isActive ? t("admin.creditPackages.deactivate") : t("admin.creditPackages.activate")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showCreateDialog || !!editingPackage} 
             onOpenChange={(open) => {
               if (!open) {
                 setShowCreateDialog(false);
                 setEditingPackage(null);
                 resetForm();
               }
             }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingPackage ? t("admin.creditPackages.editPackage") : t("admin.creditPackages.createTitle")}
            </DialogTitle>
            <DialogDescription>
              {editingPackage 
                ? t("admin.creditPackages.editDescription")
                : t("admin.creditPackages.createDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <div className="flex items-center">
                <Label>{t("admin.creditPackages.packageName")}</Label>
                <InfoTooltip content={t("admin.creditPackages.packageNameTooltip")} />
              </div>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder={t("admin.creditPackages.packageNamePlaceholder")}
                data-testid="input-package-name"
              />
            </div>
            <div>
              <div className="flex items-center">
                <Label>{t("admin.creditPackages.packageDescLabel")}</Label>
                <InfoTooltip content={t("admin.creditPackages.packageDescTooltip")} />
              </div>
              <Input
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder={t("admin.creditPackages.packageDescPlaceholder")}
                data-testid="input-package-description"
              />
            </div>
            <div>
              <div className="flex items-center">
                <Label>{t("admin.creditPackages.creditsLabel")}</Label>
                <InfoTooltip content={t("admin.creditPackages.creditsTooltip")} />
              </div>
              <Input
                type="number"
                value={formData.credits}
                onChange={(e) => setFormData({ ...formData, credits: parseInt(e.target.value) || 0 })}
                data-testid="input-package-credits"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              {paymentGateway?.stripeEnabled && (
                <div>
                  <div className="flex items-center">
                    <Label>Price ({stripeCurrency} - Stripe)</Label>
                    <InfoTooltip content={`Price for Stripe payments in ${stripeCurrency}`} />
                  </div>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })}
                    data-testid="input-package-price-stripe"
                  />
                </div>
              )}
              {paymentGateway?.razorpayEnabled && (
                <div>
                  <div className="flex items-center">
                    <Label>Price (INR - Razorpay)</Label>
                    <InfoTooltip content="Price for Razorpay payments in INR" />
                  </div>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.razorpayPrice}
                    onChange={(e) => setFormData({ ...formData, razorpayPrice: parseFloat(e.target.value) || 0 })}
                    data-testid="input-package-price-inr"
                  />
                </div>
              )}
            </div>
            {paymentGateway?.paypalEnabled && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center">
                    <Label>Price ({paypalCurrency} - PayPal)</Label>
                    <InfoTooltip content={`Price for PayPal payments in ${paypalCurrency}`} />
                  </div>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.paypalPrice}
                    onChange={(e) => setFormData({ ...formData, paypalPrice: parseFloat(e.target.value) || 0 })}
                    data-testid="input-package-price-paypal"
                  />
                </div>
              </div>
            )}
            {paymentGateway?.paystackEnabled && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center">
                    <Label>Price ({paystackCurrency} - Paystack)</Label>
                    <InfoTooltip content={`Price for Paystack payments in ${paystackCurrency}`} />
                  </div>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.paystackPrice}
                    onChange={(e) => setFormData({ ...formData, paystackPrice: parseFloat(e.target.value) || 0 })}
                    data-testid="input-package-price-paystack"
                  />
                </div>
              </div>
            )}
            {paymentGateway?.mercadopagoEnabled && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center">
                    <Label>Price ({mercadopagoCurrency} - MercadoPago)</Label>
                    <InfoTooltip content={`Price for MercadoPago payments in ${mercadopagoCurrency}`} />
                  </div>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.mercadopagoPrice}
                    onChange={(e) => setFormData({ ...formData, mercadopagoPrice: parseFloat(e.target.value) || 0 })}
                    data-testid="input-package-price-mercadopago"
                  />
                </div>
              </div>
            )}
            {formData.credits > 0 && (
              <div className="text-sm text-muted-foreground">
                {t("admin.creditPackages.pricePerCredit", { price: (formData.price / formData.credits).toFixed(3) })}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setShowCreateDialog(false);
                setEditingPackage(null);
                resetForm();
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button 
              onClick={handleSave}
              disabled={createPackage.isPending || updatePackage.isPending}
              data-testid="button-save-package"
            >
              {(createPackage.isPending || updatePackage.isPending) ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("common.saving")}
                </>
              ) : (
                editingPackage ? t("admin.creditPackages.updatePackage") : t("admin.creditPackages.createPackage")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
