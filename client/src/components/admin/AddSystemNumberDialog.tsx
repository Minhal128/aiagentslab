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
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Phone, Loader2, Download, CheckCircle2, Search, Trash2, MapPin } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTranslation } from "react-i18next";
import { AuthStorage } from "@/lib/auth-storage";

interface TwilioNumber {
  phoneNumber: string;
  friendlyName: string;
  sid: string;
  capabilities?: {
    voice: boolean;
    sms: boolean;
    mms: boolean;
  };
  pricing?: {
    purchasePrice: string;
    monthlyPrice: string;
    priceUnit: string;
  };
}

interface AvailableNumber {
  phoneNumber: string;
  friendlyName: string;
  locality?: string;
  region?: string;
  capabilities: {
    voice: boolean;
    sms: boolean;
    mms: boolean;
  };
}

interface AddSystemNumberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddSystemNumberDialog({ open, onOpenChange }: AddSystemNumberDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("import");
  
  const [selectedImportNumber, setSelectedImportNumber] = useState<TwilioNumber | null>(null);
  const [importFriendlyName, setImportFriendlyName] = useState("");

  const [searchAreaCode, setSearchAreaCode] = useState("");
  const [selectedPurchaseNumber, setSelectedPurchaseNumber] = useState<AvailableNumber | null>(null);
  const [purchaseFriendlyName, setPurchaseFriendlyName] = useState("");

  const { data: twilioNumbers = [], isLoading: loadingNumbers, refetch: refetchTwilio } = useQuery<TwilioNumber[]>({
    queryKey: ["/api/admin/phone-numbers/twilio-active"],
    queryFn: async () => {
      const headers: Record<string, string> = {};
      const authHeader = AuthStorage.getAuthHeader();
      if (authHeader) {
        headers["Authorization"] = authHeader;
      }
      const res = await fetch("/api/admin/phone-numbers/twilio-active", { headers });
      if (!res.ok) throw new Error("Failed to fetch Twilio numbers");
      const data = await res.json();
      return data.numbers || [];
    },
    enabled: false,
  });

  const { data: availableNumbers = [], isLoading: searchLoading, refetch: refetchSearch } = useQuery<AvailableNumber[]>({
    queryKey: ["/api/admin/phone-numbers/search", searchAreaCode],
    queryFn: async () => {
      if (!searchAreaCode || searchAreaCode.length !== 3) return [];
      const headers: Record<string, string> = {};
      const authHeader = AuthStorage.getAuthHeader();
      if (authHeader) {
        headers["Authorization"] = authHeader;
      }
      const res = await fetch(`/api/admin/phone-numbers/search/${searchAreaCode}`, {
        headers,
      });
      if (!res.ok) throw new Error("Failed to search numbers");
      return res.json();
    },
    enabled: false,
  });

  const importMutation = useMutation({
    mutationFn: async ({ phoneNumber, friendlyName, sid }: { phoneNumber: string; friendlyName?: string; sid: string }) => {
      const res = await apiRequest("POST", "/api/admin/phone-numbers/import", { phoneNumber, friendlyName, sid });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/phone-numbers"] });
      resetAndClose();
      toast({ 
        title: t("admin.systemNumbers.importSuccess"), 
        description: t("admin.systemNumbers.importSuccessDesc") 
      });
    },
    onError: (error: any) => {
      toast({
        title: t("admin.systemNumbers.importFailed"),
        description: error.message || t("common.tryAgain"),
        variant: "destructive",
      });
    },
  });

  const purchaseMutation = useMutation({
    mutationFn: async ({ phoneNumber, friendlyName }: { phoneNumber: string; friendlyName?: string }) => {
      const res = await apiRequest("POST", "/api/admin/phone-numbers/buy-system", { phoneNumber, friendlyName });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/phone-numbers"] });
      resetAndClose();
      toast({ 
        title: t("admin.systemNumbers.purchaseSuccess"), 
        description: t("admin.systemNumbers.purchaseSuccessDesc") 
      });
    },
    onError: (error: any) => {
      toast({
        title: t("admin.systemNumbers.purchaseFailed"),
        description: error.message || t("common.tryAgain"),
        variant: "destructive",
      });
    },
  });

  const releaseMutation = useMutation({
    mutationFn: async (sid: string) => {
      const res = await apiRequest("DELETE", `/api/admin/phone-numbers/release/${sid}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/phone-numbers"] });
      refetchTwilio();
      toast({ 
        title: t("admin.systemNumbers.releaseSuccess"), 
        description: t("admin.systemNumbers.releaseSuccessDesc") 
      });
    },
    onError: (error: any) => {
      toast({
        title: t("admin.systemNumbers.releaseFailed"),
        description: error.message || t("common.tryAgain"),
        variant: "destructive",
      });
    },
  });

  const handleImport = () => {
    if (!selectedImportNumber) return;
    importMutation.mutate({
      phoneNumber: selectedImportNumber.phoneNumber,
      friendlyName: importFriendlyName || selectedImportNumber.friendlyName,
      sid: selectedImportNumber.sid,
    });
  };

  const handlePurchase = () => {
    if (!selectedPurchaseNumber) return;
    purchaseMutation.mutate({
      phoneNumber: selectedPurchaseNumber.phoneNumber,
      friendlyName: purchaseFriendlyName || undefined,
    });
  };

  const handleRelease = (number: TwilioNumber) => {
    if (confirm(t("admin.systemNumbers.releaseConfirm", { number: formatPhoneNumber(number.phoneNumber) }))) {
      releaseMutation.mutate(number.sid);
    }
  };

  const resetAndClose = () => {
    onOpenChange(false);
    setSelectedImportNumber(null);
    setImportFriendlyName("");
    setSelectedPurchaseNumber(null);
    setPurchaseFriendlyName("");
    setSearchAreaCode("");
    setActiveTab("import");
  };

  const formatPhoneNumber = (phone: string) => {
    const cleaned = phone.replace(/\D/g, "");
    if (cleaned.length === 11 && cleaned.startsWith("1")) {
      return `+1 (${cleaned.substring(1, 4)}) ${cleaned.substring(4, 7)}-${cleaned.substring(7)}`;
    }
    return phone;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("admin.systemNumbers.title")}</DialogTitle>
          <DialogDescription>
            {t("admin.systemNumbers.description")}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="import" data-testid="tab-import-existing">{t("admin.systemNumbers.importExisting")}</TabsTrigger>
            <TabsTrigger value="purchase" data-testid="tab-purchase-new">{t("admin.systemNumbers.purchaseNew")}</TabsTrigger>
          </TabsList>

          <TabsContent value="import" className="space-y-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label>{t("admin.systemNumbers.activeTwilioNumbers")}</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("admin.systemNumbers.activeTwilioDesc")}
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => refetchTwilio()}
                  disabled={loadingNumbers}
                  data-testid="button-load-twilio-numbers"
                >
                  {loadingNumbers ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Download className="h-4 w-4 mr-2" />
                      {t("admin.systemNumbers.loadFromTwilio")}
                    </>
                  )}
                </Button>
              </div>
            </div>

            {Array.isArray(twilioNumbers) && twilioNumbers.length > 0 && (
              <div className="space-y-3">
                <Label>{t("admin.systemNumbers.availableCount", { count: twilioNumbers.length })}</Label>
                <ScrollArea className="h-[300px] border rounded-lg">
                  <div className="p-4 space-y-2">
                    {(Array.isArray(twilioNumbers) ? twilioNumbers : []).map((number) => (
                      <div
                        key={number.sid}
                        className={`p-4 rounded-lg border transition-all hover-elevate ${
                          selectedImportNumber?.sid === number.sid
                            ? "border-primary bg-primary/5"
                            : "border-border"
                        }`}
                        data-testid={`number-import-${number.phoneNumber}`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div 
                            className="flex-1 space-y-2 cursor-pointer"
                            onClick={() => setSelectedImportNumber(number)}
                          >
                            <div className="flex items-center gap-2">
                              <Phone className="h-4 w-4 text-muted-foreground" />
                              <span className="font-mono font-semibold text-lg">
                                {formatPhoneNumber(number.phoneNumber)}
                              </span>
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {number.friendlyName}
                            </div>
                            {number.pricing && (
                              <div className="text-sm space-y-1">
                                <div>
                                  <span className="font-semibold text-foreground">${number.pricing.purchasePrice}</span>
                                  <span className="text-muted-foreground"> {t("admin.systemNumbers.purchase")}</span>
                                </div>
                                <div>
                                  <span className="font-semibold text-foreground">${number.pricing.monthlyPrice}</span>
                                  <span className="text-muted-foreground">{t("admin.systemNumbers.perMonth")}</span>
                                </div>
                              </div>
                            )}
                            {number.capabilities && (
                              <div className="flex gap-2">
                                {number.capabilities.voice && (
                                  <Badge variant="secondary" className="text-xs">{t("admin.systemNumbers.voice")}</Badge>
                                )}
                                {number.capabilities.sms && (
                                  <Badge variant="secondary" className="text-xs">{t("admin.systemNumbers.sms")}</Badge>
                                )}
                                {number.capabilities.mms && (
                                  <Badge variant="secondary" className="text-xs">{t("admin.systemNumbers.mms")}</Badge>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col gap-2 items-end">
                            {selectedImportNumber?.sid === number.sid && (
                              <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" />
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleRelease(number)}
                              disabled={releaseMutation.isPending}
                              data-testid={`button-release-${number.phoneNumber}`}
                            >
                              <Trash2 className="h-3 w-3 mr-1" />
                              {t("admin.systemNumbers.release")}
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {twilioNumbers.length === 0 && !loadingNumbers && (
              <div className="text-center py-8 text-muted-foreground">
                <Phone className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p>{t("admin.systemNumbers.clickToFetch")}</p>
              </div>
            )}

            {selectedImportNumber && (
              <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
                <h4 className="font-semibold">{t("admin.systemNumbers.configureSystemNumber")}</h4>
                <div className="space-y-2">
                  <Label htmlFor="import-friendly-name">{t("admin.systemNumbers.friendlyNameOptional")}</Label>
                  <Input
                    id="import-friendly-name"
                    placeholder={selectedImportNumber.friendlyName}
                    value={importFriendlyName}
                    onChange={(e) => setImportFriendlyName(e.target.value)}
                    data-testid="input-import-friendly-name"
                  />
                </div>
                <div className="text-sm text-muted-foreground">
                  <p>{t("admin.systemNumbers.selected")} <span className="font-mono font-semibold text-foreground">{formatPhoneNumber(selectedImportNumber.phoneNumber)}</span></p>
                  <p className="mt-1">{t("admin.systemNumbers.importNote")}</p>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button
                variant="outline"
                onClick={resetAndClose}
                disabled={importMutation.isPending}
                data-testid="button-cancel-import"
              >
                {t("common.cancel")}
              </Button>
              <Button
                onClick={handleImport}
                disabled={!selectedImportNumber || importMutation.isPending}
                data-testid="button-import-to-system-pool"
              >
                {importMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {t("admin.systemNumbers.importing")}
                  </>
                ) : (
                  t("admin.systemNumbers.importToSystemPool")
                )}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="purchase" className="space-y-6">
            <div className="space-y-3">
              <Label htmlFor="area-code">{t("admin.systemNumbers.searchByAreaCode")}</Label>
              <div className="flex gap-2">
                <Input
                  id="area-code"
                  placeholder={t("admin.systemNumbers.areaCodePlaceholder")}
                  value={searchAreaCode}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, "").substring(0, 3);
                    setSearchAreaCode(value);
                  }}
                  maxLength={3}
                  data-testid="input-area-code"
                />
                <Button
                  variant="outline"
                  onClick={() => refetchSearch()}
                  disabled={searchAreaCode.length !== 3 || searchLoading}
                  data-testid="button-search"
                >
                  {searchLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Search className="h-4 w-4 mr-2" />
                      {t("common.search")}
                    </>
                  )}
                </Button>
              </div>
              {searchAreaCode.length > 0 && searchAreaCode.length < 3 && (
                <p className="text-xs text-muted-foreground">
                  {t("admin.systemNumbers.enter3Digits")}
                </p>
              )}
            </div>

            {Array.isArray(availableNumbers) && availableNumbers.length > 0 && (
              <div className="space-y-3">
                <Label>{t("admin.systemNumbers.availableNumbers")}</Label>
                <ScrollArea className="h-[300px] border rounded-lg">
                  <div className="p-4 space-y-2">
                    {(Array.isArray(availableNumbers) ? availableNumbers : []).map((number) => (
                      <div
                        key={number.phoneNumber}
                        className={`p-4 rounded-lg border cursor-pointer transition-all hover-elevate ${
                          selectedPurchaseNumber?.phoneNumber === number.phoneNumber
                            ? "border-primary bg-primary/5"
                            : "border-border"
                        }`}
                        onClick={() => setSelectedPurchaseNumber(number)}
                        data-testid={`number-purchase-${number.phoneNumber}`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 space-y-2">
                            <div className="flex items-center gap-2">
                              <Phone className="h-4 w-4 text-muted-foreground" />
                              <span className="font-mono font-semibold text-lg">
                                {formatPhoneNumber(number.phoneNumber)}
                              </span>
                            </div>
                            {(number.locality || number.region) && (
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <MapPin className="h-3 w-3" />
                                <span>
                                  {[number.locality, number.region].filter(Boolean).join(", ")}
                                </span>
                              </div>
                            )}
                            <div className="flex gap-2">
                              {number.capabilities.voice && (
                                <Badge variant="secondary" className="text-xs">{t("admin.systemNumbers.voice")}</Badge>
                              )}
                              {number.capabilities.sms && (
                                <Badge variant="secondary" className="text-xs">{t("admin.systemNumbers.sms")}</Badge>
                              )}
                              {number.capabilities.mms && (
                                <Badge variant="secondary" className="text-xs">{t("admin.systemNumbers.mms")}</Badge>
                              )}
                            </div>
                          </div>
                          {selectedPurchaseNumber?.phoneNumber === number.phoneNumber && (
                            <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {selectedPurchaseNumber && (
              <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
                <h4 className="font-semibold">{t("admin.systemNumbers.configureSystemNumber")}</h4>
                <div className="space-y-2">
                  <Label htmlFor="purchase-friendly-name">{t("admin.systemNumbers.friendlyNameOptional")}</Label>
                  <Input
                    id="purchase-friendly-name"
                    placeholder="e.g., System Pool - West Coast"
                    value={purchaseFriendlyName}
                    onChange={(e) => setPurchaseFriendlyName(e.target.value)}
                    data-testid="input-purchase-friendly-name"
                  />
                </div>
                <div className="text-sm text-muted-foreground">
                  <p>{t("admin.systemNumbers.selected")} <span className="font-mono font-semibold text-foreground">{formatPhoneNumber(selectedPurchaseNumber.phoneNumber)}</span></p>
                  <p className="mt-1">{t("admin.systemNumbers.purchaseNote")}</p>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button
                variant="outline"
                onClick={resetAndClose}
                disabled={purchaseMutation.isPending}
                data-testid="button-cancel-purchase"
              >
                {t("common.cancel")}
              </Button>
              <Button
                onClick={handlePurchase}
                disabled={!selectedPurchaseNumber || purchaseMutation.isPending}
                data-testid="button-purchase-to-system-pool"
              >
                {purchaseMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {t("admin.systemNumbers.purchasing")}
                  </>
                ) : (
                  t("admin.systemNumbers.purchaseAndAdd")
                )}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
