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
import { useState, useEffect, useRef, Suspense } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Plus, Search, Phone, ShoppingCart, Check, Trash2, CreditCard, Link as LinkIcon, Smartphone, Globe, MapPin, Upload, FileText, AlertCircle, Shield, Server, Loader2, RefreshCw } from "lucide-react";
import { usePluginRegistry } from "@/contexts/plugin-registry";
import { AuthStorage } from "@/lib/auth-storage";
import { usePluginStatus } from "@/hooks/use-plugin-status";
import { DataPagination, usePagination } from "@/components/ui/data-pagination";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Default monthly credits - will be overridden by API value
const DEFAULT_MONTHLY_CREDITS = 50;

interface PublicSettings {
  phone_number_monthly_credits: number;
  low_credits_threshold: number;
  credits_per_minute: number;
}

interface PhoneNumber {
  id: string;
  phoneNumber: string;
  twilioSid: string;
  friendlyName?: string;
  country: string;
  capabilities?: any;
  status: string;
  purchasedAt: string;
  isSystemPool?: boolean;
}

interface AvailableNumber {
  phoneNumber: string;
  friendlyName: string;
  locality?: string;
  region?: string;
  addressRequirements?: string;
  capabilities: {
    voice: boolean;
    sms: boolean;
    mms: boolean;
  };
  type?: string;
}

interface IncomingConnection {
  id: string;
  phoneNumberId: string;
  agentId: string;
  agent: {
    name: string;
  };
}

interface TwilioCountry {
  id: string;
  code: string;
  name: string;
  dialCode: string;
  isActive: boolean;
  sortOrder: number;
}

interface VoiceEngineSettings {
  plivo_openai_engine_enabled: boolean;
  twilio_kyc_required: boolean;
  plivo_kyc_required: boolean;
}

interface UserWithKyc {
  id: string;
  kycStatus?: 'pending' | 'submitted' | 'approved' | 'rejected' | null;
}

interface PlivoPhoneNumber {
  id: string;
  phoneNumber: string;
  country: string;
  region?: string;
  status: 'pending' | 'active' | 'suspended' | 'released';
  kycStatus?: 'pending' | 'submitted' | 'approved' | 'rejected' | 'requires_resubmission';
  kycRejectionReason?: string;
  purchaseCredits: number;
  monthlyCredits: number;
  purchasedAt: string;
}

interface PlivoPricing {
  id: string;
  countryCode: string;
  countryName: string;
  purchaseCredits: number;
  monthlyCredits: number;
  kycRequired: boolean;
  isActive: boolean;
}

interface PlivoAvailableNumber {
  phoneNumber: string;
  country: string;
  region?: string;
  type: string;
  monthlyRentalRate: string;
}

interface PlivoIncomingConnection {
  phoneNumberId: string;
  phoneNumber: string;
  friendlyName?: string;
  country: string;
  agent?: { id: string; name: string; type?: string; telephonyProvider?: string; } | null;
}

export default function PhoneNumbers() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [buyDialogOpen, setBuyDialogOpen] = useState(false);
  const [searchCountry, setSearchCountry] = useState("");
  const [searchContains, setSearchContains] = useState("");
  const [twilioSearchType, setTwilioSearchType] = useState<"local" | "toll-free" | "mobile" | "national">("local");
  const [selectedNumber, setSelectedNumber] = useState<AvailableNumber | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [friendlyName, setFriendlyName] = useState("");
  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false);
  const [numberToRelease, setNumberToRelease] = useState<PhoneNumber | null>(null);

  // Provider selection state (unified buy button)
  const [providerSelectDialogOpen, setProviderSelectDialogOpen] = useState(false);

  // Plivo state
  const [plivoBuyDialogOpen, setPlivoBuyDialogOpen] = useState(false);
  const [plivoSearchCountry, setPlivoSearchCountry] = useState("");
  const [plivoSearchRegion, setPlivoSearchRegion] = useState("");
  const [plivoSearchType, setPlivoSearchType] = useState<"local" | "tollfree">("local");
  const [selectedPlivoNumber, setSelectedPlivoNumber] = useState<PlivoAvailableNumber | null>(null);
  const [plivoReleaseDialogOpen, setPlivoReleaseDialogOpen] = useState(false);
  const [plivoNumberToRelease, setPlivoNumberToRelease] = useState<PlivoPhoneNumber | null>(null);
  const [kycRequiredDialogOpen, setKycRequiredDialogOpen] = useState(false);
  const [addressRequiredDialogOpen, setAddressRequiredDialogOpen] = useState(false);
  const [addressRequiredCountry, setAddressRequiredCountry] = useState<string>("");
  const [bundleRequiredDialogOpen, setBundleRequiredDialogOpen] = useState(false);
  const [bundleRequiredCountry, setBundleRequiredCountry] = useState<string>("");


  // Fetch user addresses for address requirement check
  interface UserAddress {
    id: string;
    isoCountry: string;
    status: string;
  }
  const { data: userAddresses = [] } = useQuery<UserAddress[]>({
    queryKey: ["/api/user/addresses"],
  });

  // Fetch public settings for dynamic monthly credits value
  const { data: publicSettings } = useQuery<PublicSettings>({
    queryKey: ["/api/settings/public"],
  });
  
  // Use dynamic monthly credits from settings, fallback to default
  const MONTHLY_CREDITS = publicSettings?.phone_number_monthly_credits || DEFAULT_MONTHLY_CREDITS;

  const { data: ownedNumbers = [], isLoading: ownedLoading } = useQuery<PhoneNumber[]>({
    queryKey: ["/api/phone-numbers"],
  });

  const { data: countries = [], isLoading: countriesLoading } = useQuery<TwilioCountry[]>({
    queryKey: ["/api/twilio-countries"],
  });

  // Voice engine settings to check if Plivo is enabled and KYC requirements
  const { data: voiceEngineSettings } = useQuery<VoiceEngineSettings>({
    queryKey: ["/api/settings/voice-engine"],
  });
  const plivoEnabled = voiceEngineSettings?.plivo_openai_engine_enabled || false;
  const twilioKycRequired = voiceEngineSettings?.twilio_kyc_required ?? true;
  const plivoKycRequired = voiceEngineSettings?.plivo_kyc_required ?? true;
  
  // SIP access - requires plugin enabled AND user's plan has SIP access
  const { isSipPluginEnabled } = usePluginStatus();
  const pluginRegistry = usePluginRegistry();
  const phoneNumbersTabs = pluginRegistry.getPhoneNumbersTabs();

  // User KYC status
  const { data: currentUser } = useQuery<UserWithKyc>({
    queryKey: ["/api/auth/me"],
  });
  const isKycApproved = currentUser?.kycStatus === 'approved';

  const canPurchaseTwilio = !twilioKycRequired || isKycApproved;
  const canPurchasePlivo = !plivoKycRequired || isKycApproved;

  // Plivo phone numbers query
  const { data: plivoNumbers = [], isLoading: plivoNumbersLoading } = useQuery<PlivoPhoneNumber[]>({
    queryKey: ["/api/plivo/phone-numbers"],
    enabled: plivoEnabled,
  });

  // Plivo countries/pricing query (user-facing endpoint)
  const { data: plivoCountries = [], isLoading: plivoCountriesLoading } = useQuery<PlivoPricing[]>({
    queryKey: ["/api/plivo/phone-numbers/countries"],
    enabled: plivoEnabled,
  });

  const activePlivoCountries = plivoCountries.filter(c => c.isActive);

  // Plivo incoming connections query
  const { data: plivoConnectionsData } = useQuery<{ connections: PlivoIncomingConnection[] }>({
    queryKey: ["/api/plivo/incoming-connections"],
    enabled: plivoEnabled,
  });
  const plivoConnections = plivoConnectionsData?.connections || [];

  // Plivo number search
  const buildPlivoSearchQuery = () => {
    const params = new URLSearchParams();
    if (plivoSearchCountry) params.append("country", plivoSearchCountry);
    if (plivoSearchRegion) params.append("region", plivoSearchRegion);
    params.append("type", plivoSearchType);
    return params.toString();
  };

  const canPlivoSearch = () => {
    return plivoSearchCountry.length === 2;
  };

  const { data: plivoAvailableNumbers = [], isLoading: plivoSearchLoading, refetch: searchPlivoNumbers } = useQuery<PlivoAvailableNumber[]>({
    queryKey: ["/api/plivo/phone-numbers/search", plivoSearchCountry, plivoSearchRegion, plivoSearchType],
    queryFn: async () => {
      if (!canPlivoSearch()) return [];
      const headers: Record<string, string> = {};
      const authHeader = AuthStorage.getAuthHeader();
      if (authHeader) headers["Authorization"] = authHeader;
      const res = await fetch(`/api/plivo/phone-numbers/search?${buildPlivoSearchQuery()}`, { headers });
      if (!res.ok) throw new Error("Failed to search Plivo numbers");
      const data = await res.json();
      // API returns { numbers: [...], pricing: {...} }, extract numbers array
      return Array.isArray(data) ? data : (data.numbers || []);
    },
    enabled: canPlivoSearch() && plivoEnabled,
  });

  useEffect(() => {
    if (countries.length > 0 && !searchCountry) {
      const usCountry = countries.find(c => c.code === "US");
      setSearchCountry(usCountry ? "US" : countries[0].code);
    }
  }, [countries, searchCountry]);

  const { data: incomingData } = useQuery<{ connections: IncomingConnection[]; allConnections: IncomingConnection[]; availablePhoneNumbers: PhoneNumber[] }>({
    queryKey: ["/api/incoming-connections"],
  });

  const allConnections = incomingData?.allConnections || [];

  const getConnection = (phoneNumberId: string) => {
    return allConnections.find(c => c.phoneNumberId === phoneNumberId);
  };

  const getPlivoConnection = (phoneNumberId: string) => {
    return plivoConnections.find(c => c.phoneNumberId === phoneNumberId);
  };

  const isCountryValid = countries.some(c => c.code === searchCountry);

  const buildSearchQuery = () => {
    const params = new URLSearchParams();
    if (searchCountry && isCountryValid) {
      params.append("country", searchCountry);
    }
    if (searchContains) {
      params.append("contains", searchContains);
    }
    params.append("numberType", twilioSearchType);
    return params.toString();
  };

  const canSearch = () => {
    return !!searchCountry && isCountryValid;
  };

  const { data: availableNumbers = [], isLoading: searchLoading, refetch: searchNumbers } = useQuery<AvailableNumber[]>({
    queryKey: ["/api/phone-numbers/search", searchCountry, searchContains, twilioSearchType],
    queryFn: async () => {
      if (!canSearch()) return [];
      const headers: Record<string, string> = {};
      const authHeader = AuthStorage.getAuthHeader();
      if (authHeader) {
        headers["Authorization"] = authHeader;
      }
      const res = await fetch(`/api/phone-numbers/search?${buildSearchQuery()}`, {
        headers,
      });
      if (!res.ok) throw new Error(t('phoneNumbers.errors.searchFailed'));
      return res.json();
    },
    enabled: canSearch() && !countriesLoading,
  });

  const buyMutation = useMutation({
    mutationFn: async ({ phoneNumber, friendlyName, addressSid, country, numberType }: { phoneNumber: string; friendlyName?: string; addressSid?: string; country?: string; numberType?: string }) => {
      const res = await apiRequest("POST", "/api/phone-numbers/buy", { phoneNumber, friendlyName, addressSid, country, numberType });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/phone-numbers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/incoming-connections"] });
      setBuyDialogOpen(false);
      setSelectedNumber(null);
      setFriendlyName("");
      setSearchContains("");
      setHasSearched(false);
      setTwilioSearchType("local");
      toast({ title: t('phoneNumbers.toast.purchaseSuccess'), description: t('phoneNumbers.toast.creditsDeducted', { credits: MONTHLY_CREDITS }) });
    },
    onError: (error: any) => {
      // ApiError includes 'data' field with full JSON response from server
      const errorData = error.data || error;
      
      // Check if the error response indicates address is required
      if (errorData.addressRequired) {
        const countryObj = countries.find(c => c.code === errorData.country);
        setAddressRequiredCountry(countryObj?.name || errorData.country || searchCountry || "this country");
        setAddressRequiredDialogOpen(true);
        setBuyDialogOpen(false);
        return;
      }
      
      // Check if regulatory bundle is required
      if (errorData.bundleRequired) {
        const countryObj = countries.find(c => c.code === errorData.country);
        setBundleRequiredCountry(countryObj?.name || errorData.country || searchCountry || "this country");
        setBundleRequiredDialogOpen(true);
        setBuyDialogOpen(false);
        return;
      }

      // Check if KYC is required
      if (errorData.kycRequired) {
        setKycRequiredDialogOpen(true);
        setBuyDialogOpen(false);
        return;
      }
      
      toast({
        title: t('phoneNumbers.toast.purchaseFailed'),
        description: error.message || t('common.tryAgain'),
        variant: "destructive",
      });
    },
  });

  const releaseMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/phone-numbers/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/phone-numbers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/incoming-connections"] });
      setReleaseDialogOpen(false);
      setNumberToRelease(null);
      toast({ title: t('phoneNumbers.toast.releaseSuccess') });
    },
    onError: (error: any) => {
      toast({
        title: t('phoneNumbers.toast.releaseFailed'),
        description: error.message || t('common.tryAgain'),
        variant: "destructive",
      });
    },
  });

  // Plivo purchase mutation
  const plivoBuyMutation = useMutation({
    mutationFn: async ({ phoneNumber, country }: { phoneNumber: string; country: string }) => {
      const res = await apiRequest("POST", "/api/plivo/phone-numbers/purchase", { phoneNumber, country });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/plivo/phone-numbers"] });
      setPlivoBuyDialogOpen(false);
      setSelectedPlivoNumber(null);
      setPlivoSearchCountry("");
      setPlivoSearchRegion("");
      toast({ title: "Plivo Number Purchased", description: "Your new phone number has been added to your account." });
    },
    onError: (error: any) => {
      toast({
        title: "Purchase Failed",
        description: error.message || t('common.tryAgain'),
        variant: "destructive",
      });
    },
  });

  // Plivo release mutation
  const plivoReleaseMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/plivo/phone-numbers/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/plivo/phone-numbers"] });
      setPlivoReleaseDialogOpen(false);
      setPlivoNumberToRelease(null);
      toast({ title: "Number Released", description: "The phone number has been released." });
    },
    onError: (error: any) => {
      toast({
        title: "Release Failed",
        description: error.message || t('common.tryAgain'),
        variant: "destructive",
      });
    },
  });


  const handlePlivoBuy = () => {
    if (!selectedPlivoNumber) return;
    plivoBuyMutation.mutate({
      phoneNumber: selectedPlivoNumber.phoneNumber,
      country: plivoSearchCountry,
    });
  };

  const handlePlivoRelease = () => {
    if (!plivoNumberToRelease) return;
    plivoReleaseMutation.mutate(plivoNumberToRelease.id);
  };

  const handleBuyClick = (provider: 'twilio' | 'plivo' | 'select') => {
    if (provider === 'twilio') {
      if (!canPurchaseTwilio) {
        setKycRequiredDialogOpen(true);
        return;
      }
      setBuyDialogOpen(true);
    } else if (provider === 'plivo') {
      if (!canPurchasePlivo) {
        setKycRequiredDialogOpen(true);
        return;
      }
      setPlivoBuyDialogOpen(true);
    } else {
      setProviderSelectDialogOpen(true);
    }
  };

  const getKycStatusBadgeVariant = (status?: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (status) {
      case 'approved': return 'default';
      case 'submitted': return 'secondary';
      case 'rejected':
      case 'requires_resubmission': return 'destructive';
      default: return 'outline';
    }
  };

  const getKycStatusLabel = (status?: string) => {
    switch (status) {
      case 'approved': return 'KYC Approved';
      case 'submitted': return 'KYC Under Review';
      case 'rejected': return 'KYC Rejected';
      case 'requires_resubmission': return 'Resubmit Required';
      case 'pending': return 'KYC Pending';
      default: return 'KYC Required';
    }
  };

  // Plivo pagination
  const {
    currentPage: plivoCurrentPage,
    totalPages: plivoTotalPages,
    totalItems: plivoTotalItems,
    itemsPerPage: plivoItemsPerPage,
    paginatedItems: paginatedPlivoNumbers,
    handlePageChange: handlePlivoPageChange,
    handleItemsPerPageChange: handlePlivoItemsPerPageChange,
  } = usePagination(plivoNumbers, 9);

  const getPlivoPricing = (countryCode: string) => {
    return plivoCountries.find(c => c.countryCode === countryCode);
  };

  const handleBuyNumber = () => {
    if (!selectedNumber) return;
    
    // Server handles address requirement check and auto-selection
    // If address is required but not found, server returns addressRequired error
    // which is handled in buyMutation.onError
    buyMutation.mutate({
      phoneNumber: selectedNumber.phoneNumber,
      friendlyName: friendlyName || undefined,
      country: searchCountry || undefined,
      numberType: selectedNumber.type || twilioSearchType,
    });
  };

  const handleReleaseNumber = () => {
    if (!numberToRelease) return;
    releaseMutation.mutate(numberToRelease.id);
  };

  const formatPhoneNumber = (phone: string) => {
    const cleaned = phone.replace(/\D/g, "");
    if (cleaned.length === 11 && cleaned.startsWith("1")) {
      return `+1 (${cleaned.substring(1, 4)}) ${cleaned.substring(4, 7)}-${cleaned.substring(7)}`;
    }
    return phone;
  };

  const totalNumbers = ownedNumbers.length + plivoNumbers.length;
  const activeNumbers = ownedNumbers.filter(n => n.status === 'active').length + plivoNumbers.filter(n => n.status === 'active').length;
  const connectedNumbers = allConnections.length + plivoConnections.length;
  const availableForConnection = totalNumbers - connectedNumbers;

  const {
    currentPage,
    totalPages,
    totalItems,
    itemsPerPage,
    paginatedItems: paginatedNumbers,
    handlePageChange,
    handleItemsPerPageChange,
  } = usePagination(ownedNumbers, 9);

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-50 via-green-100/50 to-brand/5 dark:from-emerald-950/40 dark:via-green-900/30 dark:to-brand/10 border border-emerald-100 dark:border-emerald-900/50 p-6 md:p-8">
        <div className="absolute inset-0 bg-grid-slate-200/50 dark:bg-grid-slate-700/20 [mask-image:linear-gradient(0deg,transparent,rgba(255,255,255,0.5))]" />
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center shadow-lg shadow-emerald-500/25">
              <Smartphone className="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-foreground">{t('phoneNumbers.title')}</h1>
              <p className="text-muted-foreground mt-0.5">{t('phoneNumbers.subtitle')}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              onClick={() => setLocation("/app/incoming-connections")}
              className="bg-white/80 dark:bg-white/10 border-emerald-200 dark:border-emerald-800"
              data-testid="button-manage-connections"
            >
              <LinkIcon className="h-4 w-4 mr-2" />
              {t('phoneNumbers.manageConnections')}
            </Button>
            <Button 
              onClick={() => plivoEnabled ? handleBuyClick('select') : handleBuyClick('twilio')} 
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              data-testid="button-buy-number"
            >
              <Plus className="h-4 w-4 mr-2" />
              {t('phoneNumbers.buyNumber')}
            </Button>
          </div>
        </div>

        <div className="relative mt-6 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="bg-white/80 dark:bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-emerald-100/50 dark:border-emerald-800/30">
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-300" data-testid="text-total-numbers">{totalNumbers}</div>
            </div>
            <div className="text-emerald-600/70 dark:text-emerald-400/70 text-sm">{t('phoneNumbers.stats.totalNumbers')}</div>
          </div>
          <div className="bg-white/80 dark:bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-green-100/50 dark:border-green-800/30">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
              <div className="text-2xl font-bold text-green-700 dark:text-green-300">{activeNumbers}</div>
            </div>
            <div className="text-green-600/70 dark:text-green-400/70 text-sm">{t('common.active')}</div>
          </div>
          <div className="bg-white/80 dark:bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-brand/10">
            <div className="flex items-center gap-2">
              <LinkIcon className="h-4 w-4 text-brand" />
              <div className="text-2xl font-bold text-brand">{connectedNumbers}</div>
            </div>
            <div className="text-brand/70 text-sm">{t('phoneNumbers.stats.connected')}</div>
          </div>
          <div className="bg-white/80 dark:bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-cyan-100/50 dark:border-cyan-800/30">
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
              <div className="text-2xl font-bold text-cyan-700 dark:text-cyan-300">{MONTHLY_CREDITS}</div>
            </div>
            <div className="text-cyan-600/70 dark:text-cyan-400/70 text-sm">{t('phoneNumbers.stats.creditsPerMonth')}</div>
          </div>
        </div>
      </div>

      <Tabs defaultValue="owned" className="space-y-6">
        <TabsList>
          <TabsTrigger value="owned" data-testid="tab-owned-numbers">
            Twilio Numbers ({ownedNumbers.length})
          </TabsTrigger>
          {plivoEnabled && (
            <TabsTrigger value="plivo" data-testid="tab-plivo-numbers">
              Plivo Numbers ({plivoNumbers.length})
            </TabsTrigger>
          )}
          {phoneNumbersTabs.filter(tab => tab.id !== 'sip-trunks' || isSipPluginEnabled).map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} data-testid={`tab-${tab.id}`}>
              {tab.icon === 'Server' && <Server className="h-4 w-4 mr-1" />}
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="owned" className="space-y-4">
          {ownedLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="p-6 animate-pulse">
                  <div className="h-6 bg-muted rounded w-3/4 mb-4" />
                  <div className="h-4 bg-muted rounded w-full mb-2" />
                  <div className="h-4 bg-muted rounded w-2/3" />
                </Card>
              ))}
            </div>
          ) : ownedNumbers.length === 0 ? (
            <Card className="p-8 sm:p-16 text-center">
              <Phone className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-semibold mb-2">{t('phoneNumbers.empty.title')}</h3>
              <p className="text-muted-foreground mb-4">
                {t('phoneNumbers.empty.description')}
              </p>
              <Button onClick={() => handleBuyClick('twilio')}>
                <Plus className="h-4 w-4 mr-2" />
                {t('phoneNumbers.empty.buyFirst')}
              </Button>
            </Card>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                {paginatedNumbers.map((number) => (
                  <Card
                    key={number.id}
                    className="p-4 sm:p-6"
                    data-testid={`card-phone-${number.id}`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-4">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-base sm:text-lg font-semibold font-mono mb-1 break-all" data-testid="text-phone-number">
                          {formatPhoneNumber(number.phoneNumber)}
                        </h3>
                        {number.friendlyName && (
                          <p className="text-sm text-muted-foreground truncate">{number.friendlyName}</p>
                        )}
                      </div>
                      <div className="flex flex-col gap-1 items-end">
                        <Badge variant={number.status === "active" ? "default" : "secondary"}>
                          {number.status === "active" ? t('common.active') : number.status}
                        </Badge>
                        {twilioKycRequired && !number.isSystemPool && (
                          <Badge 
                            variant="outline"
                            className={`cursor-pointer transition-colors ${
                              currentUser?.kycStatus === 'approved'
                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                                : 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30 hover:bg-red-500/20'
                            }`}
                            onClick={() => setLocation('/app/settings')}
                            data-testid={`badge-kyc-status-twilio-${number.id}`}
                          >
                            <Shield className="h-3 w-3 mr-1" />
                            {getKycStatusLabel(currentUser?.kycStatus ?? undefined)}
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between text-muted-foreground">
                        <span>{t('phoneNumbers.labels.country')}:</span>
                        <span className="font-medium text-foreground">{number.country}</span>
                      </div>
                      {!number.isSystemPool && (
                        <div className="flex justify-between text-muted-foreground">
                          <span>{t('phoneNumbers.labels.monthlyCost')}:</span>
                          <span className="font-medium text-foreground">{MONTHLY_CREDITS} {t('phoneNumbers.labels.credits')}</span>
                        </div>
                      )}
                      {(() => {
                        const connection = getConnection(number.id);
                        return connection ? (
                          <div 
                            className="flex flex-wrap items-center gap-1 sm:gap-2 pt-3 text-sm" 
                            data-testid={`connection-status-connected-${number.id}`}
                          >
                            <LinkIcon className="h-3.5 w-3.5 text-green-600 dark:text-green-400 flex-shrink-0" />
                            <span className="text-muted-foreground">{t('phoneNumbers.status.connectedTo')}</span>
                            <span className="font-medium text-foreground truncate" data-testid={`connection-agent-name-${number.id}`}>
                              {connection.agent.name}
                            </span>
                          </div>
                        ) : (
                          <div 
                            className="flex items-center gap-2 pt-3 text-sm text-muted-foreground"
                            data-testid={`connection-status-not-connected-${number.id}`}
                          >
                            <span>{t('phoneNumbers.status.notConnected')}</span>
                          </div>
                        );
                      })()}
                    </div>

                    {!number.isSystemPool && (
                      <div className="pt-4 mt-4 border-t space-y-2">
                        {twilioKycRequired && !isKycApproved && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full"
                            onClick={() => {
                              setKycRequiredDialogOpen(true);
                            }}
                            data-testid={`button-kyc-twilio-${number.id}`}
                          >
                            <Upload className="h-4 w-4 mr-2" />
                            Complete KYC Verification
                          </Button>
                        )}
                        <Button
                          variant="destructive"
                          size="sm"
                          className="w-full"
                          onClick={() => {
                            setNumberToRelease(number);
                            setReleaseDialogOpen(true);
                          }}
                          data-testid={`button-release-${number.id}`}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          {t('phoneNumbers.actions.release')}
                        </Button>
                      </div>
                    )}
                  </Card>
                ))}
              </div>

              {totalPages > 1 && (
                <DataPagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  totalItems={totalItems}
                  itemsPerPage={itemsPerPage}
                  onPageChange={handlePageChange}
                  onItemsPerPageChange={handleItemsPerPageChange}
                  itemsPerPageOptions={[9, 18, 27, 54]}
                  data-testid="pagination-phone-numbers"
                />
              )}
            </div>
          )}
        </TabsContent>

        {plivoEnabled && (
          <TabsContent value="plivo" className="space-y-4">
            {plivoNumbersLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3].map((i) => (
                  <Card key={i} className="p-6 animate-pulse">
                    <div className="h-6 bg-muted rounded w-3/4 mb-4" />
                    <div className="h-4 bg-muted rounded w-full mb-2" />
                    <div className="h-4 bg-muted rounded w-2/3" />
                  </Card>
                ))}
              </div>
            ) : plivoNumbers.length === 0 ? (
              <Card className="p-8 sm:p-16 text-center">
                <Phone className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">No Plivo Numbers</h3>
                <p className="text-muted-foreground mb-4">
                  You haven't purchased any Plivo phone numbers yet.
                </p>
                <Button onClick={() => handleBuyClick('plivo')}>
                  <Plus className="h-4 w-4 mr-2" />
                  Buy Your First Phone Number
                </Button>
              </Card>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                  {paginatedPlivoNumbers.map((number) => {
                    const pricing = getPlivoPricing(number.country);
                    // Show KYC button if admin has enabled KYC for Plivo AND user's KYC is not approved
                    const needsKyc = plivoKycRequired && !isKycApproved;
                    
                    return (
                      <Card
                        key={number.id}
                        className="p-4 sm:p-6"
                        data-testid={`card-plivo-phone-${number.id}`}
                      >
                        <div className="flex items-start justify-between gap-2 mb-4">
                          <div className="flex-1 min-w-0">
                            <h3 className="text-base sm:text-lg font-semibold font-mono mb-1 break-all">
                              {formatPhoneNumber(number.phoneNumber)}
                            </h3>
                            <p className="text-sm text-muted-foreground">
                              {number.country}{number.region ? ` - ${number.region}` : ''}
                            </p>
                          </div>
                          <div className="flex flex-col gap-1 items-end">
                            <Badge variant={number.status === "active" ? "default" : "secondary"}>
                              {number.status === "active" ? t('common.active') : number.status}
                            </Badge>
                            {plivoKycRequired && (
                              <Badge 
                                variant="outline"
                                className={`cursor-pointer transition-colors ${
                                  currentUser?.kycStatus === 'approved'
                                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                                    : 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30 hover:bg-red-500/20'
                                }`}
                                onClick={() => setLocation('/app/settings')}
                                data-testid={`badge-kyc-status-plivo-${number.id}`}
                              >
                                <Shield className="h-3 w-3 mr-1" />
                                {getKycStatusLabel(currentUser?.kycStatus ?? undefined)}
                              </Badge>
                            )}
                          </div>
                        </div>

                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between text-muted-foreground">
                            <span>Monthly Cost:</span>
                            <span className="font-medium text-foreground">{number.monthlyCredits} credits</span>
                          </div>
                          <div className="flex justify-between text-muted-foreground">
                            <span>Purchase Cost:</span>
                            <span className="font-medium text-foreground">{number.purchaseCredits} credits</span>
                          </div>
                          <div className="flex justify-between text-muted-foreground">
                            <span>Purchased:</span>
                            <span className="font-medium text-foreground">
                              {new Date(number.purchasedAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>

                        {(() => {
                          const plivoConn = getPlivoConnection(number.id);
                          return plivoConn?.agent ? (
                            <div className="flex flex-wrap items-center gap-1 sm:gap-2 pt-3 text-sm" data-testid={`plivo-connection-status-connected-${number.id}`}>
                              <LinkIcon className="h-3.5 w-3.5 text-green-600 dark:text-green-400 flex-shrink-0" />
                              <span className="text-muted-foreground">{t('phoneNumbers.status.connectedTo')}</span>
                              <span className="font-medium text-foreground truncate">{plivoConn.agent.name}</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 pt-3 text-sm text-muted-foreground" data-testid={`plivo-connection-status-not-connected-${number.id}`}>
                              <span>{t('phoneNumbers.status.notConnected')}</span>
                            </div>
                          );
                        })()}

                        {number.kycRejectionReason && (
                          <div className="mt-3 p-3 bg-destructive/10 rounded-md border border-destructive/20">
                            <div className="flex items-start gap-2">
                              <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                              <div>
                                <p className="text-sm font-medium text-destructive">KYC Rejection Reason:</p>
                                <p className="text-sm text-muted-foreground">{number.kycRejectionReason}</p>
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="pt-4 mt-4 border-t space-y-2">
                          {needsKyc && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full"
                              onClick={() => {
                                setKycRequiredDialogOpen(true);
                              }}
                              data-testid={`button-upload-kyc-${number.id}`}
                            >
                              <Upload className="h-4 w-4 mr-2" />
                              Complete KYC Verification
                            </Button>
                          )}
                          <Button
                            variant="destructive"
                            size="sm"
                            className="w-full"
                            onClick={() => {
                              setPlivoNumberToRelease(number);
                              setPlivoReleaseDialogOpen(true);
                            }}
                            data-testid={`button-release-plivo-${number.id}`}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Release Number
                          </Button>
                        </div>
                      </Card>
                    );
                  })}
                </div>

                {plivoTotalPages > 1 && (
                  <DataPagination
                    currentPage={plivoCurrentPage}
                    totalPages={plivoTotalPages}
                    totalItems={plivoTotalItems}
                    itemsPerPage={plivoItemsPerPage}
                    onPageChange={handlePlivoPageChange}
                    onItemsPerPageChange={handlePlivoItemsPerPageChange}
                    itemsPerPageOptions={[9, 18, 27, 54]}
                    data-testid="pagination-plivo-numbers"
                  />
                )}
              </div>
            )}
          </TabsContent>
        )}

        {phoneNumbersTabs.filter(tab => tab.id !== 'sip-trunks' || isSipPluginEnabled).map((tab) => (
          <TabsContent key={tab.id} value={tab.id} className="space-y-4">
            <Suspense fallback={<div className="flex items-center justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>}>
              <tab.component />
            </Suspense>
          </TabsContent>
        ))}
      </Tabs>

      <Dialog open={buyDialogOpen} onOpenChange={setBuyDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('phoneNumbers.dialog.buyTitle')}</DialogTitle>
            <DialogDescription>
              {t('phoneNumbers.dialog.buyDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="bg-accent/50 border border-accent rounded-lg p-4 flex items-start gap-3">
            <CreditCard className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-sm mb-1">{t('phoneNumbers.dialog.monthlyBilling')}</h4>
              <p className="text-sm text-muted-foreground">
                {t('phoneNumbers.dialog.monthlyBillingDesc', { credits: MONTHLY_CREDITS })}
              </p>
            </div>
          </div>

          <div className="space-y-6 py-4">
            <div className="space-y-3">
              <Label>{t('phoneNumbers.labels.country')}</Label>
              <Select value={searchCountry} onValueChange={setSearchCountry} disabled={countriesLoading}>
                <SelectTrigger data-testid="select-country">
                  <Globe className="h-4 w-4 mr-2 text-muted-foreground" />
                  <SelectValue placeholder={countriesLoading ? t('phoneNumbers.placeholders.loadingCountries') : t('phoneNumbers.placeholders.selectCountry')} />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {countries.map((country) => (
                    <SelectItem key={country.code} value={country.code}>
                      {country.name} ({country.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Number type selector */}
            <div className="space-y-2">
              <Label>Number Type</Label>
              <Select
                value={twilioSearchType}
                onValueChange={(v: "local" | "toll-free" | "mobile" | "national") => {
                  setTwilioSearchType(v);
                  setSelectedNumber(null);
                  setHasSearched(false);
                }}
                data-testid="select-number-type"
              >
                <SelectTrigger data-testid="select-number-type-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">Local</SelectItem>
                  <SelectItem value="toll-free">Toll-Free</SelectItem>
                  <SelectItem value="mobile">Mobile</SelectItem>
                  <SelectItem value="national">National</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Optional search filter — digits filter only; areaCode/locality/region not supported for toll-free */}
            <div className="space-y-2">
              <Label htmlFor="search-contains">Search by digits (optional)</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="search-contains"
                  placeholder="e.g. 2200, 555"
                  value={searchContains}
                  onChange={(e) => setSearchContains(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  className="pl-10"
                  data-testid="input-search-contains"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Filter numbers containing specific digits (leave empty to see all available)
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={() => {
                  setHasSearched(true);
                  searchNumbers();
                }}
                disabled={!canSearch() || searchLoading}
                className="flex-1"
                data-testid="button-search-numbers"
              >
                {searchLoading ? (
                  <>
                    <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full mr-2" />
                    {t('phoneNumbers.actions.searching')}
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4 mr-2" />
                    {t('phoneNumbers.actions.searchNumbers')}
                  </>
                )}
              </Button>
              {hasSearched && (
                <Button
                  variant="outline"
                  onClick={() => searchNumbers()}
                  disabled={!canSearch() || searchLoading}
                  data-testid="button-refresh-numbers"
                  title="Load different numbers"
                >
                  <RefreshCw className={`h-4 w-4 ${searchLoading ? 'animate-spin' : ''}`} />
                </Button>
              )}
            </div>

            {!searchLoading && hasSearched && availableNumbers.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                {t('phoneNumbers.search.noResults')}
              </div>
            )}

            {availableNumbers.length > 0 && (
              <div className="space-y-2">
                <Label>{t('phoneNumbers.labels.availableNumbers')}</Label>
                <div className="border rounded-md divide-y max-h-96 overflow-y-auto">
                  {availableNumbers.map((number) => (
                    <div
                      key={number.phoneNumber}
                      className={`p-4 hover-elevate cursor-pointer ${
                        selectedNumber?.phoneNumber === number.phoneNumber ? "bg-accent" : ""
                      }`}
                      onClick={() => setSelectedNumber(number)}
                      data-testid={`available-number-${number.phoneNumber}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="font-mono font-semibold">
                            {formatPhoneNumber(number.phoneNumber)}
                          </div>
                          {number.locality && number.region && (
                            <div className="text-sm text-muted-foreground">
                              {number.locality}, {number.region}
                            </div>
                          )}
                        </div>
                        {selectedNumber?.phoneNumber === number.phoneNumber && (
                          <Check className="h-5 w-5 text-primary" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedNumber && (
              <div className="space-y-2">
                <Label htmlFor="friendly-name">{t('phoneNumbers.labels.friendlyName')}</Label>
                <Input
                  id="friendly-name"
                  placeholder={t('phoneNumbers.placeholders.friendlyName')}
                  value={friendlyName}
                  onChange={(e) => setFriendlyName(e.target.value)}
                  data-testid="input-friendly-name"
                />
              </div>
            )}

          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => {
              setBuyDialogOpen(false);
              setSelectedNumber(null);
              setFriendlyName("");
              setSearchContains("");
              setHasSearched(false);
              setTwilioSearchType("local");
            }}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleBuyNumber}
              disabled={!selectedNumber || buyMutation.isPending}
              data-testid="button-confirm-purchase"
            >
              {buyMutation.isPending ? (
                t('phoneNumbers.actions.purchasing')
              ) : (
                <>
                  <ShoppingCart className="h-4 w-4 mr-2" />
                  {t('phoneNumbers.actions.purchaseFor', { credits: MONTHLY_CREDITS })}
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={releaseDialogOpen} onOpenChange={setReleaseDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('phoneNumbers.dialog.releaseTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('phoneNumbers.dialog.releaseDescription', { number: numberToRelease ? formatPhoneNumber(numberToRelease.phoneNumber) : '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={releaseMutation.isPending}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReleaseNumber}
              disabled={releaseMutation.isPending}
              className="bg-destructive hover:bg-destructive/90"
              data-testid="button-confirm-release"
            >
              {releaseMutation.isPending ? t('phoneNumbers.actions.releasing') : t('phoneNumbers.actions.releaseNumber')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Plivo Buy Dialog - Redesigned with pagination-first approach */}
      <Dialog open={plivoBuyDialogOpen} onOpenChange={(open) => {
        setPlivoBuyDialogOpen(open);
        if (!open) {
          setSelectedPlivoNumber(null);
          setPlivoSearchRegion("");
        }
      }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Rent Phone Number</DialogTitle>
            <DialogDescription>
              Select a country to see available phone numbers. Numbers are billed monthly.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Pricing Info Banner */}
            {plivoSearchCountry && (() => {
              const pricing = getPlivoPricing(plivoSearchCountry);
              return pricing ? (
                <div className="bg-accent/50 border border-accent rounded-lg p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <CreditCard className="h-5 w-5 text-primary" />
                    <span className="font-semibold">Pricing</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">One-time Purchase:</span>
                      <span className="font-semibold ml-2">{pricing.purchaseCredits} credits</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Monthly Rental:</span>
                      <span className="font-semibold ml-2">{pricing.monthlyCredits} credits/mo</span>
                    </div>
                  </div>
                  {pricing.kycRequired && (
                    <div className="mt-3 flex items-center gap-2 text-amber-600 dark:text-amber-400">
                      <Shield className="h-4 w-4" />
                      <span className="text-sm">KYC verification is required for numbers in this country</span>
                    </div>
                  )}
                </div>
              ) : null;
            })()}

            {/* Filters Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Country</Label>
                <Select 
                  value={plivoSearchCountry} 
                  onValueChange={(value) => {
                    setPlivoSearchCountry(value);
                    setSelectedPlivoNumber(null);
                  }} 
                  disabled={plivoCountriesLoading}
                >
                  <SelectTrigger data-testid="select-plivo-country">
                    <Globe className="h-4 w-4 mr-2 text-muted-foreground" />
                    <SelectValue placeholder={plivoCountriesLoading ? "Loading..." : "Select country"} />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {activePlivoCountries.map((country) => (
                      <SelectItem 
                        key={country.countryCode} 
                        value={country.countryCode}
                        data-testid={`option-country-${country.countryCode}`}
                      >
                        {country.countryName} ({country.countryCode})
                        {country.kycRequired && " 🔒"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Number Type</Label>
                <Select value={plivoSearchType} onValueChange={(value: "local" | "tollfree") => {
                  setPlivoSearchType(value);
                  setSelectedPlivoNumber(null);
                }}>
                  <SelectTrigger data-testid="select-plivo-type">
                    <Phone className="h-4 w-4 mr-2 text-muted-foreground" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="local">Local Numbers</SelectItem>
                    <SelectItem value="tollfree">Toll-Free Numbers</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Region (Optional)</Label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="e.g., CA, NY, TX"
                    value={plivoSearchRegion}
                    onChange={(e) => {
                      setPlivoSearchRegion(e.target.value.toUpperCase());
                      setSelectedPlivoNumber(null);
                    }}
                    className="pl-9"
                    maxLength={10}
                    data-testid="input-plivo-region"
                  />
                </div>
              </div>
            </div>

            {/* Numbers Display Area */}
            {!plivoSearchCountry ? (
              <div className="text-center py-12 border rounded-lg bg-muted/20">
                <Globe className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground">Select a country to view available numbers</p>
              </div>
            ) : plivoSearchLoading ? (
              <div className="text-center py-12 border rounded-lg">
                <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4" />
                <p className="text-muted-foreground">Loading available numbers...</p>
              </div>
            ) : plivoAvailableNumbers.length === 0 ? (
              <div className="text-center py-12 border rounded-lg bg-muted/20">
                <Phone className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground mb-2">No numbers available</p>
                <p className="text-sm text-muted-foreground">Try a different region or number type</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Available Numbers ({plivoAvailableNumbers.length})</Label>
                  {selectedPlivoNumber && (
                    <Badge variant="secondary" className="gap-1">
                      <Check className="h-3 w-3" />
                      Selected: {formatPhoneNumber(selectedPlivoNumber.phoneNumber)}
                    </Badge>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[300px] overflow-y-auto p-1">
                  {plivoAvailableNumbers.map((number) => (
                    <div
                      key={number.phoneNumber}
                      className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                        selectedPlivoNumber?.phoneNumber === number.phoneNumber 
                          ? "border-primary bg-primary/5" 
                          : "border-border hover:border-primary/50 hover:bg-muted/50"
                      }`}
                      onClick={() => setSelectedPlivoNumber(number)}
                      data-testid={`plivo-number-${number.phoneNumber.replace(/\+/g, '')}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-mono font-semibold text-sm truncate">
                            {formatPhoneNumber(number.phoneNumber)}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {number.region || number.country} · {number.type}
                          </div>
                        </div>
                        {selectedPlivoNumber?.phoneNumber === number.phoneNumber && (
                          <Check className="h-4 w-4 text-primary flex-shrink-0" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => {
              setPlivoBuyDialogOpen(false);
              setSelectedPlivoNumber(null);
              setPlivoSearchRegion("");
            }}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handlePlivoBuy}
              disabled={!selectedPlivoNumber || plivoBuyMutation.isPending}
              data-testid="button-purchase-plivo"
            >
              {plivoBuyMutation.isPending ? (
                <>
                  <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full mr-2" />
                  Purchasing...
                </>
              ) : (
                <>
                  <ShoppingCart className="h-4 w-4 mr-2" />
                  {selectedPlivoNumber ? `Purchase for ${getPlivoPricing(plivoSearchCountry)?.purchaseCredits || 0} Credits` : 'Select a Number'}
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Plivo Release Dialog */}
      <AlertDialog open={plivoReleaseDialogOpen} onOpenChange={setPlivoReleaseDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Release Plivo Number</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to release {plivoNumberToRelease ? formatPhoneNumber(plivoNumberToRelease.phoneNumber) : ''}? 
              This action cannot be undone and the number will be returned to Plivo's pool.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={plivoReleaseMutation.isPending}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handlePlivoRelease}
              disabled={plivoReleaseMutation.isPending}
              className="bg-destructive hover:bg-destructive/90"
            >
              {plivoReleaseMutation.isPending ? "Releasing..." : "Release Number"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* KYC Required Dialog */}
      <Dialog open={kycRequiredDialogOpen} onOpenChange={setKycRequiredDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-amber-500" />
              KYC Verification Required
            </DialogTitle>
            <DialogDescription>
              To purchase phone numbers, you need to complete KYC verification first.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
              <div className="space-y-3">
                <p className="text-sm">
                  KYC verification is a one-time process. Once approved, you can purchase phone numbers from any provider.
                </p>
                <div className="text-sm">
                  <p className="font-medium mb-2">Required documents:</p>
                  <ul className="list-disc list-inside text-muted-foreground space-y-1">
                    <li>Photo ID</li>
                    <li>Company Registration Certificate</li>
                    <li>GST Certificate</li>
                    <li>Authorization Letter</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setKycRequiredDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => {
              setKycRequiredDialogOpen(false);
              setLocation('/app/settings?tab=kyc');
            }}>
              <Shield className="h-4 w-4 mr-2" />
              Complete KYC Verification
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Address Required Dialog */}
      <Dialog open={addressRequiredDialogOpen} onOpenChange={setAddressRequiredDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-amber-500" />
              Address Verification Required
            </DialogTitle>
            <DialogDescription>
              To purchase phone numbers in {addressRequiredCountry}, you need to add and verify an address first.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
              <div className="space-y-3">
                <p className="text-sm">
                  {addressRequiredCountry} requires address verification for phone number purchases. This is a regulatory requirement.
                </p>
                <div className="text-sm">
                  <p className="font-medium mb-2">What you need to do:</p>
                  <ul className="list-disc list-inside text-muted-foreground space-y-1">
                    <li>Go to Settings → Addresses</li>
                    <li>Add your address for {addressRequiredCountry}</li>
                    <li>Wait for Twilio to verify your address</li>
                    <li>Return here to purchase your phone number</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setAddressRequiredDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => {
              setAddressRequiredDialogOpen(false);
              setBuyDialogOpen(false);
              setLocation('/app/settings?tab=addresses');
            }} data-testid="button-go-to-addresses">
              <MapPin className="h-4 w-4 mr-2" />
              Add Address
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Regulatory Bundle Required Dialog */}
      <Dialog open={bundleRequiredDialogOpen} onOpenChange={setBundleRequiredDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-amber-500" />
              Regulatory Compliance Required
            </DialogTitle>
            <DialogDescription>
              Phone numbers in {bundleRequiredCountry} require regulatory compliance approval before purchase.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
              <div className="space-y-3">
                <p className="text-sm">
                  {bundleRequiredCountry} requires identity verification documents to be submitted and approved before phone numbers can be purchased. This is a regulatory requirement.
                </p>
                <p className="text-sm">
                  Please contact your administrator to set up the required regulatory compliance for {bundleRequiredCountry}. The approval process typically takes 1-3 business days.
                </p>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setBundleRequiredDialogOpen(false)} data-testid="button-bundle-close">
              {t('common.close')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Provider Selection Dialog */}
      <Dialog open={providerSelectDialogOpen} onOpenChange={setProviderSelectDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Choose Telephony Provider</DialogTitle>
            <DialogDescription>
              Select which provider you'd like to purchase a phone number from.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 py-4">
            <div 
              className="border rounded-lg p-4 cursor-pointer hover-elevate transition-all"
              onClick={() => {
                setProviderSelectDialogOpen(false);
                handleBuyClick('twilio');
              }}
              data-testid="provider-option-twilio"
            >
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-lg bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                  <Phone className="h-6 w-6 text-red-600 dark:text-red-400" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold">Twilio + ElevenLabs</h3>
                  <p className="text-sm text-muted-foreground">Premium voice quality with ElevenLabs AI</p>
                  {twilioKycRequired && !isKycApproved && (
                    <p className="text-xs text-amber-600 mt-1">KYC verification required</p>
                  )}
                </div>
              </div>
            </div>
            {plivoEnabled ? (
              <div 
                className="border rounded-lg p-4 cursor-pointer hover-elevate transition-all"
                onClick={() => {
                  setProviderSelectDialogOpen(false);
                  handleBuyClick('plivo');
                }}
                data-testid="provider-option-plivo"
              >
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                    <Phone className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold">Plivo + OpenAI</h3>
                    <p className="text-sm text-muted-foreground">OpenAI Realtime voices with Plivo telephony</p>
                    {plivoKycRequired && !isKycApproved && (
                      <p className="text-xs text-amber-600 mt-1">KYC verification required</p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div 
                className="border rounded-lg p-4 opacity-50 cursor-not-allowed"
                data-testid="provider-option-plivo-disabled"
              >
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                    <Phone className="h-6 w-6 text-gray-400" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-muted-foreground">Plivo + OpenAI</h3>
                    <p className="text-sm text-muted-foreground">Not available - Plivo integration is not enabled</p>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setProviderSelectDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
