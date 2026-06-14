import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { AuthStorage } from "@/lib/auth-storage";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  Plus, 
  Globe, 
  Copy, 
  Trash2, 
  Edit, 
  Phone, 
  Clock, 
  Code,
  RefreshCw,
  MoreVertical,
  X,
  Loader2,
  BarChart3,
  PhoneCall,
  Timer,
  MessageCircle,
  AlertCircle,
  Upload,
  ChevronDown,
  Mic,
  MicOff,
  PhoneOff,
  Play,
  Check,
  Info
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { WebsiteWidget, Agent } from "@shared/schema";

const TIMEZONE_OPTIONS = [
  { value: "America/New_York", label: "Eastern Time (ET)" },
  { value: "America/Chicago", label: "Central Time (CT)" },
  { value: "America/Denver", label: "Mountain Time (MT)" },
  { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
  { value: "Europe/London", label: "London (GMT)" },
  { value: "Europe/Paris", label: "Paris (CET)" },
  { value: "Asia/Tokyo", label: "Tokyo (JST)" },
  { value: "Asia/Shanghai", label: "Shanghai (CST)" },
  { value: "Asia/Kolkata", label: "India (IST)" },
  { value: "Australia/Sydney", label: "Sydney (AEDT)" },
];

const DAY_OPTIONS = [
  { value: "monday", label: "Mon" },
  { value: "tuesday", label: "Tue" },
  { value: "wednesday", label: "Wed" },
  { value: "thursday", label: "Thu" },
  { value: "friday", label: "Fri" },
  { value: "saturday", label: "Sat" },
  { value: "sunday", label: "Sun" },
];

const COLOR_PRESETS = [
  { name: "Blue", primary: "#3B82F6" },
  { name: "Purple", primary: "#8B5CF6" },
  { name: "Green", primary: "#10B981" },
  { name: "Red", primary: "#EF4444" },
  { name: "Orange", primary: "#F97316" },
  { name: "Pink", primary: "#EC4899" },
  { name: "Teal", primary: "#14B8A6" },
  { name: "Indigo", primary: "#6366F1" },
];

interface WidgetFormData {
  name: string;
  status: string;
  agentId: string | null;
  agentType: string;
  brandName: string;
  buttonLabel: string;
  primaryColor: string;
  backgroundColor: string;
  textColor: string;
  iconFile: File | null;
  iconPreview: string | null;
  requireTermsAcceptance: boolean;
  appointmentBookingEnabled: boolean;
  allowedDomains: string[];
  businessHoursEnabled: boolean;
  businessHoursStart: string;
  businessHoursEnd: string;
  businessDays: string[];
  businessTimezone: string;
  maxConcurrentCalls: number;
  maxCallDuration: number;
  cooldownMinutes: number;
}

const defaultFormData: WidgetFormData = {
  name: "",
  status: "active",
  agentId: null,
  agentType: "natural",
  brandName: "",
  buttonLabel: "VOICE CHAT",
  primaryColor: "#3B82F6",
  backgroundColor: "#FFFFFF",
  textColor: "#1F2937",
  iconFile: null,
  iconPreview: null,
  requireTermsAcceptance: false,
  appointmentBookingEnabled: false,
  allowedDomains: [],
  businessHoursEnabled: false,
  businessHoursStart: "09:00",
  businessHoursEnd: "17:00",
  businessDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
  businessTimezone: "America/New_York",
  maxConcurrentCalls: 5,
  maxCallDuration: 300,
  cooldownMinutes: 0,
};

interface WidgetStats {
  totalWidgets: number;
  totalCalls: number;
  totalMinutes: number;
  widgetStats: Array<{ id: string; name: string; calls: number; minutes: number; status: string }>;
}

interface WidgetLimits {
  currentCount: number;
  maxWidgets: number;
  remaining: number;
}

type CallState = 'idle' | 'terms' | 'connecting' | 'active' | 'ended';

function InteractiveWidgetPreview({ formData, appName }: { formData: WidgetFormData; appName: string }) {
  const [callState, setCallState] = useState<CallState>('idle');
  const [timer, setTimer] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (callState === 'active') {
      timerRef.current = setInterval(() => {
        setTimer(t => t + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [callState]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleCallClick = () => {
    if (callState === 'idle') {
      if (formData.requireTermsAcceptance) {
        setCallState('terms');
        setTermsAccepted(false);
      } else {
        startConnecting();
      }
    }
  };

  const startConnecting = () => {
    setCallState('connecting');
    setTimeout(() => {
      setCallState('active');
      setTimer(0);
    }, 2000);
  };

  const handleAcceptTerms = () => {
    if (termsAccepted) {
      startConnecting();
    }
  };

  const handleEndCall = () => {
    setCallState('ended');
    setTimeout(() => {
      setCallState('idle');
      setTimer(0);
      setIsMuted(false);
    }, 1500);
  };

  const resetPreview = () => {
    setCallState('idle');
    setTimer(0);
    setIsMuted(false);
    setTermsAccepted(false);
  };

  return (
    <div className="relative h-full min-h-[480px] rounded-xl overflow-hidden border border-border/50 bg-muted/30">
      <div className="h-8 bg-muted flex items-center px-3 gap-2 border-b border-border/50">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-400" />
          <div className="w-3 h-3 rounded-full bg-yellow-400" />
          <div className="w-3 h-3 rounded-full bg-green-400" />
        </div>
        <div className="flex-1 flex justify-center">
          <div className="bg-background/80 rounded-md px-4 py-1 text-[10px] text-muted-foreground flex items-center gap-2 max-w-[200px]">
            <Globe className="h-3 w-3" />
            <span className="truncate">example.com</span>
          </div>
        </div>
        <div className="w-16" />
      </div>

      <div className="relative h-[calc(100%-32px)]">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-100 via-slate-50 to-blue-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
          <div className="absolute inset-0 opacity-[0.03]" style={{ 
            backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23000000\' fill-opacity=\'1\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")'
          }} />
          
          <div className="p-6 space-y-4">
            <div className="h-4 bg-foreground/10 rounded w-3/4" />
            <div className="h-3 bg-foreground/5 rounded w-full" />
            <div className="h-3 bg-foreground/5 rounded w-5/6" />
            <div className="h-3 bg-foreground/5 rounded w-2/3" />
            <div className="grid grid-cols-3 gap-3 mt-6">
              <div className="h-16 bg-foreground/5 rounded-lg" />
              <div className="h-16 bg-foreground/5 rounded-lg" />
              <div className="h-16 bg-foreground/5 rounded-lg" />
            </div>
          </div>
        </div>

        <div className="absolute bottom-4 right-4 left-4 flex justify-end">
          <div className="relative font-sans" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
            <div 
              className="rounded-2xl p-4 min-w-[300px] max-w-[340px] transition-all duration-300"
              style={{ 
                backgroundColor: formData.backgroundColor || '#FFFFFF',
                boxShadow: '0 10px 40px -10px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.05)'
              }}
            >
              {callState === 'terms' ? (
                <div className="space-y-4">
                  <div className="text-center">
                    <div className="w-10 h-10 rounded-full mx-auto mb-2 flex items-center justify-center" style={{ backgroundColor: formData.primaryColor + '15' }}>
                      <AlertCircle className="h-5 w-5" style={{ color: formData.primaryColor }} />
                    </div>
                    <h4 className="font-semibold text-sm" style={{ color: formData.textColor }}>Terms & Conditions</h4>
                    <p className="text-xs mt-1 opacity-60" style={{ color: formData.textColor }}>
                      Please accept before continuing
                    </p>
                  </div>
                  <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg transition-colors hover:bg-black/5">
                    <input
                      type="checkbox"
                      checked={termsAccepted}
                      onChange={(e) => setTermsAccepted(e.target.checked)}
                      data-testid="checkbox-preview-terms"
                      className="mt-0.5 h-4 w-4 rounded"
                      style={{ accentColor: formData.primaryColor }}
                    />
                    <span className="text-xs leading-relaxed" style={{ color: formData.textColor }}>
                      I agree to the <span className="underline" style={{ color: formData.primaryColor }}>Terms & Conditions</span> and <span className="underline" style={{ color: formData.primaryColor }}>Privacy Policy</span>
                    </span>
                  </label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setCallState('idle')}
                      data-testid="button-preview-terms-cancel"
                      className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium border transition-colors hover:bg-black/5"
                      style={{ borderColor: formData.textColor + '20', color: formData.textColor }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleAcceptTerms}
                      disabled={!termsAccepted}
                      data-testid="button-preview-terms-accept"
                      className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-all disabled:opacity-40"
                      style={{ backgroundColor: formData.primaryColor }}
                    >
                      Continue
                    </button>
                  </div>
                </div>
              ) : callState === 'active' || callState === 'connecting' || callState === 'ended' ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="relative flex-shrink-0">
                      <div 
                        className={`w-12 h-12 rounded-full flex items-center justify-center overflow-hidden ${callState === 'active' ? 'ring-2 ring-offset-2' : ''}`}
                        style={{ 
                          backgroundColor: formData.primaryColor + '15',
                          ['--tw-ring-color' as string]: formData.primaryColor,
                          ['--tw-ring-offset-color' as string]: formData.backgroundColor
                        }}
                      >
                        {formData.iconPreview ? (
                          <img src={formData.iconPreview} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <Phone className="h-5 w-5" style={{ color: formData.primaryColor }} />
                        )}
                      </div>
                      <div className="absolute -bottom-0.5 -right-0.5 text-white text-[8px] px-1.5 py-0.5 rounded-full font-bold shadow-sm" style={{ backgroundColor: formData.primaryColor }}>
                        AI
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate" style={{ color: formData.textColor }}>
                        {formData.brandName || formData.name || "AI Assistant"}
                      </div>
                      <div className="text-xl font-bold tabular-nums" style={{ color: formData.textColor }}>
                        {callState === 'connecting' ? (
                          <span className="flex items-center gap-2">
                            <span className="inline-flex gap-0.5">
                              <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: formData.primaryColor, animationDelay: '0ms' }} />
                              <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: formData.primaryColor, animationDelay: '150ms' }} />
                              <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: formData.primaryColor, animationDelay: '300ms' }} />
                            </span>
                            <span className="text-sm font-normal opacity-70">Connecting</span>
                          </span>
                        ) : callState === 'ended' ? (
                          <span className="flex items-center gap-2 text-green-600">
                            <Check className="h-5 w-5" />
                            <span className="text-sm font-normal">Call ended</span>
                          </span>
                        ) : formatTime(timer)}
                      </div>
                    </div>
                  </div>

                  {callState === 'active' && (
                    <div className="flex items-center justify-center gap-1 h-8 px-4">
                      {[1,2,3,4,5,6,7].map((i) => (
                        <div 
                          key={i} 
                          className="w-1 rounded-full transition-all"
                          style={{ 
                            backgroundColor: formData.primaryColor,
                            opacity: 0.6,
                            height: `${8 + Math.sin(Date.now() / 200 + i) * 12}px`,
                            animation: `pulse 0.8s ease-in-out infinite`,
                            animationDelay: `${i * 0.1}s`
                          }}
                        />
                      ))}
                    </div>
                  )}

                  {callState === 'connecting' && (
                    <div className="flex justify-center py-2">
                      <div className="w-12 h-12 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: formData.primaryColor, borderTopColor: 'transparent' }} />
                    </div>
                  )}

                  {callState === 'active' && (
                    <div className="flex justify-center gap-4 pt-2">
                      <button
                        onClick={() => setIsMuted(!isMuted)}
                        data-testid="button-preview-mute"
                        className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-sm ${
                          isMuted ? 'bg-red-500 text-white scale-105' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                      </button>
                      <button
                        onClick={handleEndCall}
                        data-testid="button-preview-end"
                        className="w-12 h-12 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-all shadow-sm hover:scale-105 active:scale-95"
                      >
                        <PhoneOff className="h-5 w-5" />
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="relative flex-shrink-0">
                    <div 
                      className="w-14 h-14 rounded-full flex items-center justify-center overflow-hidden transition-transform hover:scale-105"
                      style={{ 
                        backgroundColor: formData.primaryColor + '12',
                        border: `2px solid ${formData.primaryColor}25`
                      }}
                    >
                      {formData.iconPreview ? (
                        <img src={formData.iconPreview} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Phone className="h-6 w-6" style={{ color: formData.primaryColor }} />
                      )}
                    </div>
                    <div 
                      className="absolute -bottom-0.5 -right-0.5 text-white text-[8px] px-1.5 py-0.5 rounded-full font-bold shadow-sm"
                      style={{ backgroundColor: formData.primaryColor }}
                    >
                      AI
                    </div>
                    <div 
                      className="text-[10px] text-center mt-1.5 font-medium truncate max-w-[56px] leading-tight"
                      style={{ color: formData.textColor }}
                    >
                      {formData.brandName || formData.name || "Agent"}
                    </div>
                  </div>
                  
                  <button
                    onClick={handleCallClick}
                    data-testid="button-preview-call"
                    className="flex items-center gap-2.5 px-5 py-3 rounded-full text-white font-semibold transition-all hover:scale-[1.02] active:scale-[0.98] shadow-lg hover:shadow-xl"
                    style={{ 
                      background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
                    }}
                  >
                    <Phone className="h-4 w-4" />
                    <span className="text-sm tracking-wide">{formData.buttonLabel || 'VOICE CHAT'}</span>
                  </button>
                  
                  <div 
                    data-testid="button-preview-language"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-full border cursor-pointer transition-colors hover:bg-black/5"
                    style={{ borderColor: formData.textColor + '15' }}
                  >
                    <span className="text-base">&#127482;&#127480;</span>
                    <ChevronDown className="h-3.5 w-3.5 opacity-50" style={{ color: formData.textColor }} />
                  </div>
                </div>
              )}
            </div>
            
            <div className="text-center mt-2.5 text-[11px] text-foreground/40">
              Powered by <span className="font-medium" style={{ color: formData.primaryColor }}>{appName}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute top-11 left-3 z-10">
        <div className="flex items-center gap-2 bg-background/90 backdrop-blur-sm rounded-lg px-3 py-1.5 shadow-sm border border-border/50">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-[10px] font-medium text-foreground/70">Interactive Demo</span>
          </div>
          {callState !== 'idle' && (
            <>
              <div className="w-px h-3 bg-border" />
              <button 
                onClick={resetPreview} 
                data-testid="button-preview-reset"
                className="text-[10px] font-medium text-primary hover:underline"
              >
                Reset
              </button>
            </>
          )}
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-background/80 to-transparent p-3 pt-6">
        <p className="text-center text-[10px] text-muted-foreground">
          Click the widget button to preview the call experience
        </p>
      </div>
    </div>
  );
}

export default function WidgetsPage() {
  const { toast } = useToast();
  const [mainTab, setMainTab] = useState("widgets");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingWidget, setEditingWidget] = useState<WebsiteWidget | null>(null);
  const [formData, setFormData] = useState<WidgetFormData>(defaultFormData);
  const [domainInput, setDomainInput] = useState("");
  const [activeTab, setActiveTab] = useState("general");
  const [embedCodeWidget, setEmbedCodeWidget] = useState<WebsiteWidget | null>(null);
  const [embedCode, setEmbedCode] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: widgets = [], isLoading } = useQuery<WebsiteWidget[]>({
    queryKey: ["/api/widgets"],
  });

  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ["/api/agents"],
  });

  const { data: stats } = useQuery<WidgetStats>({
    queryKey: ["/api/widgets-stats"],
  });

  const { data: limits } = useQuery<WidgetLimits>({
    queryKey: ["/api/widgets-limits"],
  });

  const { data: branding } = useQuery<{ app_name: string }>({
    queryKey: ["/api/branding"],
  });
  const appName = branding?.app_name || "";

  const createMutation = useMutation({
    mutationFn: async (data: WidgetFormData) => {
      const formDataToSend = new FormData();
      formDataToSend.append('name', data.name);
      formDataToSend.append('status', data.status);
      formDataToSend.append('agentId', data.agentId || '');
      formDataToSend.append('agentType', data.agentType);
      formDataToSend.append('brandName', data.brandName);
      formDataToSend.append('buttonLabel', data.buttonLabel);
      formDataToSend.append('primaryColor', data.primaryColor);
      formDataToSend.append('backgroundColor', data.backgroundColor);
      formDataToSend.append('textColor', data.textColor);
      formDataToSend.append('requireTermsAcceptance', String(data.requireTermsAcceptance));
      formDataToSend.append('appointmentBookingEnabled', String(data.appointmentBookingEnabled));
      formDataToSend.append('allowedDomains', JSON.stringify(data.allowedDomains));
      formDataToSend.append('businessHoursEnabled', String(data.businessHoursEnabled));
      formDataToSend.append('businessHoursStart', data.businessHoursStart);
      formDataToSend.append('businessHoursEnd', data.businessHoursEnd);
      formDataToSend.append('businessDays', JSON.stringify(data.businessDays));
      formDataToSend.append('businessTimezone', data.businessTimezone);
      formDataToSend.append('maxConcurrentCalls', String(data.maxConcurrentCalls));
      formDataToSend.append('maxCallDuration', String(data.maxCallDuration));
      formDataToSend.append('cooldownMinutes', String(data.cooldownMinutes));
      
      if (data.iconFile) {
        formDataToSend.append('icon', data.iconFile);
      }

      const response = await fetch('/api/widgets', {
        method: 'POST',
        headers: {
          'Authorization': AuthStorage.getAuthHeader() || '',
        },
        body: formDataToSend,
        credentials: 'include',
      });
      if (!response.ok) {
        let errMessage = `Server error (${response.status}): Failed to create widget`;
        try {
          const err = await response.json();
          errMessage = err.message || err.error || errMessage;
        } catch {}
        throw new Error(errMessage);
      }
      try {
        return await response.json();
      } catch {
        throw new Error('Server returned an unexpected response. Please try again.');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/widgets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/widgets-stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/widgets-limits"] });
      setIsCreateOpen(false);
      resetForm();
      toast({ title: "Widget created", description: "Your website widget has been created successfully." });
    },
    onError: (error: any) => {
      const message = error?.message || "Failed to create widget";
      toast({ title: "Error", description: message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: WidgetFormData }) => {
      const formDataToSend = new FormData();
      formDataToSend.append('name', data.name);
      formDataToSend.append('status', data.status);
      formDataToSend.append('agentId', data.agentId || '');
      formDataToSend.append('agentType', data.agentType);
      formDataToSend.append('brandName', data.brandName);
      formDataToSend.append('buttonLabel', data.buttonLabel);
      formDataToSend.append('primaryColor', data.primaryColor);
      formDataToSend.append('backgroundColor', data.backgroundColor);
      formDataToSend.append('textColor', data.textColor);
      formDataToSend.append('requireTermsAcceptance', String(data.requireTermsAcceptance));
      formDataToSend.append('appointmentBookingEnabled', String(data.appointmentBookingEnabled));
      formDataToSend.append('allowedDomains', JSON.stringify(data.allowedDomains));
      formDataToSend.append('businessHoursEnabled', String(data.businessHoursEnabled));
      formDataToSend.append('businessHoursStart', data.businessHoursStart);
      formDataToSend.append('businessHoursEnd', data.businessHoursEnd);
      formDataToSend.append('businessDays', JSON.stringify(data.businessDays));
      formDataToSend.append('businessTimezone', data.businessTimezone);
      formDataToSend.append('maxConcurrentCalls', String(data.maxConcurrentCalls));
      formDataToSend.append('maxCallDuration', String(data.maxCallDuration));
      formDataToSend.append('cooldownMinutes', String(data.cooldownMinutes));
      
      if (data.iconFile) {
        formDataToSend.append('icon', data.iconFile);
      }

      const response = await fetch(`/api/widgets/${id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': AuthStorage.getAuthHeader() || '',
        },
        body: formDataToSend,
        credentials: 'include',
      });
      if (!response.ok) {
        let errMessage = `Server error (${response.status}): Failed to update widget`;
        try {
          const err = await response.json();
          errMessage = err.message || err.error || errMessage;
        } catch {}
        throw new Error(errMessage);
      }
      try {
        return await response.json();
      } catch {
        throw new Error('Server returned an unexpected response. Please try again.');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/widgets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/widgets-stats"] });
      setEditingWidget(null);
      resetForm();
      toast({ title: "Widget updated", description: "Your widget has been updated successfully." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update widget", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/widgets/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/widgets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/widgets-stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/widgets-limits"] });
      toast({ title: "Widget deleted", description: "Your widget has been deleted." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to delete widget", variant: "destructive" });
    },
  });

  const regenerateTokenMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/widgets/${id}/regenerate-token`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/widgets"] });
      toast({ title: "Token regenerated", description: "A new embed token has been generated." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to regenerate token", variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData(defaultFormData);
    setDomainInput("");
    setActiveTab("general");
    setAdvancedOpen(false);
  };

  const openEditModal = (widget: WebsiteWidget) => {
    setEditingWidget(widget);
    setFormData({
      name: widget.name,
      status: widget.status,
      agentId: widget.agentId,
      agentType: widget.agentType,
      brandName: widget.brandName || "",
      buttonLabel: (widget as any).buttonLabel || "VOICE CHAT",
      primaryColor: widget.primaryColor,
      backgroundColor: widget.backgroundColor,
      textColor: widget.textColor,
      iconFile: null,
      iconPreview: widget.iconUrl || (widget as any).iconPath || null,
      requireTermsAcceptance: (widget as any).requireTermsAcceptance || false,
      appointmentBookingEnabled: (widget as any).appointmentBookingEnabled || false,
      allowedDomains: widget.allowedDomains || [],
      businessHoursEnabled: widget.businessHoursEnabled,
      businessHoursStart: widget.businessHoursStart || "09:00",
      businessHoursEnd: widget.businessHoursEnd || "17:00",
      businessDays: widget.businessDays || ["monday", "tuesday", "wednesday", "thursday", "friday"],
      businessTimezone: widget.businessTimezone || "America/New_York",
      maxConcurrentCalls: widget.maxConcurrentCalls,
      maxCallDuration: widget.maxCallDuration,
      cooldownMinutes: (widget as any).cooldownMinutes || 0,
    });
    setActiveTab("general");
  };

  const handleSubmit = () => {
    if (!formData.name.trim()) {
      toast({ title: "Error", description: "Widget name is required", variant: "destructive" });
      return;
    }
    if (editingWidget) {
      updateMutation.mutate({ id: editingWidget.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const addDomain = () => {
    const domain = domainInput.trim().toLowerCase();
    if (domain && !formData.allowedDomains.includes(domain)) {
      setFormData({ ...formData, allowedDomains: [...formData.allowedDomains, domain] });
      setDomainInput("");
    }
  };

  const removeDomain = (domain: string) => {
    setFormData({ ...formData, allowedDomains: formData.allowedDomains.filter(d => d !== domain) });
  };

  const toggleDay = (day: string) => {
    if (formData.businessDays.includes(day)) {
      setFormData({ ...formData, businessDays: formData.businessDays.filter(d => d !== day) });
    } else {
      setFormData({ ...formData, businessDays: [...formData.businessDays, day] });
    }
  };

  const handleIconUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        toast({ title: "Error", description: "Please select an image file", variant: "destructive" });
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        toast({ title: "Error", description: "Image must be less than 2MB", variant: "destructive" });
        return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        setFormData({ 
          ...formData, 
          iconFile: file,
          iconPreview: event.target?.result as string 
        });
      };
      reader.readAsDataURL(file);
    }
  };

  const removeIcon = () => {
    setFormData({ ...formData, iconFile: null, iconPreview: null });
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const fetchEmbedCode = async (widget: WebsiteWidget) => {
    try {
      const response = await apiRequest("GET", `/api/widgets/${widget.id}/embed-code`);
      const data = await response.json();
      if (data.embedCode) {
        setEmbedCode(data.embedCode);
        setEmbedCodeWidget(widget);
      } else {
        toast({ title: "Error", description: "Failed to generate embed code", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to fetch embed code", variant: "destructive" });
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied", description: "Embed code copied to clipboard" });
  };

  const isModalOpen = isCreateOpen || editingWidget !== null;
  const isSubmitting = createMutation.isPending || updateMutation.isPending;
  const isUnlimitedWidgets = limits?.maxWidgets === -1 || (limits?.maxWidgets ?? 0) >= 999;
  const canCreateWidget = limits ? (isUnlimitedWidgets || limits.remaining > 0) : true;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 md:p-6 border-b">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold" data-testid="text-page-title">Website Widgets</h1>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-4 w-4 text-muted-foreground cursor-help" data-testid="icon-widget-info" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs">
                <p className="text-sm">
                  Widgets are designed for sharing information with website visitors and appointment booking. 
                  Features like campaigns and CRM are not available for widget calls.
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
          <p className="text-muted-foreground">Create embeddable voice widgets for your websites</p>
        </div>
        <div className="flex items-center gap-3">
          {limits && (
            <div className="text-sm text-muted-foreground">
              {limits.currentCount}/{limits.maxWidgets === -1 || limits.maxWidgets >= 999 ? "Unlimited" : limits.maxWidgets} widgets
            </div>
          )}
          <Button 
            onClick={() => { resetForm(); setIsCreateOpen(true); }} 
            disabled={!canCreateWidget}
            data-testid="button-create-widget"
          >
            <Plus className="h-4 w-4 mr-2" />
            Create Widget
          </Button>
        </div>
      </div>

      <Tabs value={mainTab} onValueChange={setMainTab} className="flex-1 flex flex-col">
        <div className="border-b px-4 md:px-6">
          <TabsList className="h-auto p-0 bg-transparent">
            <TabsTrigger 
              value="widgets" 
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
            >
              <Globe className="h-4 w-4 mr-2" />
              Widgets
            </TabsTrigger>
            <TabsTrigger 
              value="dashboard" 
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
            >
              <BarChart3 className="h-4 w-4 mr-2" />
              Analytics
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="widgets" className="flex-1 overflow-auto p-4 md:p-6 mt-0">
          {!canCreateWidget && (
            <div className="mb-4 p-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-amber-900 dark:text-amber-100">Widget limit reached</p>
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  Your plan allows {limits?.maxWidgets === -1 || (limits?.maxWidgets ?? 0) >= 999 ? "Unlimited" : limits?.maxWidgets} widget(s). Upgrade your plan to create more widgets.
                </p>
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : widgets.length === 0 ? (
            <Card className="flex flex-col items-center justify-center h-64">
              <Globe className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No widgets yet</h3>
              <p className="text-muted-foreground text-center mb-4 max-w-md">
                Create your first website widget to enable voice conversations on your website.
              </p>
              <Button onClick={() => { resetForm(); setIsCreateOpen(true); }} disabled={!canCreateWidget} data-testid="button-create-first-widget">
                <Plus className="h-4 w-4 mr-2" />
                Create Widget
              </Button>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {widgets.map((widget) => (
                <Card key={widget.id} className="relative" data-testid={`card-widget-${widget.id}`}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3 min-w-0">
                        <div 
                          className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0 overflow-hidden"
                          style={{ backgroundColor: widget.primaryColor }}
                        >
                          {widget.iconUrl || (widget as any).iconPath ? (
                            <img src={widget.iconUrl || (widget as any).iconPath} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <Phone className="h-5 w-5 text-white" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="text-base truncate">{widget.name}</CardTitle>
                          <CardDescription className="truncate">
                            {widget.brandName || "No brand name"}
                          </CardDescription>
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="shrink-0" data-testid={`button-widget-menu-${widget.id}`}>
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEditModal(widget)} data-testid={`button-edit-widget-${widget.id}`}>
                            <Edit className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => fetchEmbedCode(widget)} data-testid={`button-embed-code-${widget.id}`}>
                            <Code className="h-4 w-4 mr-2" />
                            Get Embed Code
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => regenerateTokenMutation.mutate(widget.id)}>
                            <RefreshCw className="h-4 w-4 mr-2" />
                            Regenerate Token
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem 
                            onClick={() => deleteMutation.mutate(widget.id)}
                            className="text-destructive"
                            data-testid={`button-delete-widget-${widget.id}`}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2 mb-3">
                      <Badge variant={widget.status === "active" ? "default" : "secondary"}>
                        {widget.status}
                      </Badge>
                      {widget.businessHoursEnabled && (
                        <Badge variant="outline">
                          <Clock className="h-3 w-3 mr-1" />
                          Hours
                        </Badge>
                      )}
                      {(widget as any).requireTermsAcceptance && (
                        <Badge variant="outline">Terms</Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
                      <div>
                        <span className="font-medium">{widget.totalCalls}</span> calls
                      </div>
                      <div>
                        <span className="font-medium">{widget.totalMinutes}</span> minutes
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="dashboard" className="flex-1 overflow-auto p-4 md:p-6 mt-0">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Total Widgets</CardTitle>
                <Globe className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats?.totalWidgets || 0}</div>
                {limits && (
                  <div className="mt-2">
                    <Progress value={(limits.currentCount / limits.maxWidgets) * 100} className="h-1" />
                    <p className="text-xs text-muted-foreground mt-1">
                      {limits.remaining} of {limits.maxWidgets} remaining
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Total Calls</CardTitle>
                <PhoneCall className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats?.totalCalls || 0}</div>
                <p className="text-xs text-muted-foreground">All-time widget calls</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Total Minutes</CardTitle>
                <Timer className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats?.totalMinutes || 0}</div>
                <p className="text-xs text-muted-foreground">Voice conversation time</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Active Widgets</CardTitle>
                <MessageCircle className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {stats?.widgetStats?.filter(w => w.status === 'active').length || 0}
                </div>
                <p className="text-xs text-muted-foreground">Ready to receive calls</p>
              </CardContent>
            </Card>
          </div>

          {stats?.widgetStats && stats.widgetStats.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Widget Performance</CardTitle>
                <CardDescription>Call statistics per widget</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {stats.widgetStats.map((widget) => (
                    <div key={widget.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                          <Globe className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium">{widget.name}</p>
                          <Badge variant={widget.status === 'active' ? 'default' : 'secondary'} className="text-xs">
                            {widget.status}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex items-center gap-6 text-sm">
                        <div className="text-center">
                          <p className="font-semibold">{widget.calls}</p>
                          <p className="text-muted-foreground text-xs">calls</p>
                        </div>
                        <div className="text-center">
                          <p className="font-semibold">{widget.minutes}</p>
                          <p className="text-muted-foreground text-xs">minutes</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="flex flex-col items-center justify-center py-12">
              <BarChart3 className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No data yet</h3>
              <p className="text-muted-foreground text-center max-w-md">
                Create widgets and start receiving calls to see your analytics here.
              </p>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={isModalOpen} onOpenChange={(open) => {
        if (!open) {
          setIsCreateOpen(false);
          setEditingWidget(null);
          resetForm();
        }
      }}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{editingWidget ? "Edit Widget" : "Create Widget"}</DialogTitle>
            <DialogDescription>
              {editingWidget ? "Update your website widget settings" : "Configure your new website voice widget"}
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-hidden flex gap-6">
            <div className="flex-1 overflow-hidden flex flex-col">
              <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 overflow-hidden flex flex-col">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="general">General</TabsTrigger>
                  <TabsTrigger value="branding">Branding</TabsTrigger>
                  <TabsTrigger value="settings">Settings</TabsTrigger>
                </TabsList>
                
                <ScrollArea className="flex-1 pr-4 mt-4">
                  <TabsContent value="general" className="mt-0 space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Widget Name *</Label>
                      <Input
                        id="name"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="My Website Widget"
                        data-testid="input-widget-name"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="agent">AI Agent</Label>
                      <Select
                        value={formData.agentId || "none"}
                        onValueChange={(value) => setFormData({ ...formData, agentId: value === "none" ? null : value })}
                      >
                        <SelectTrigger data-testid="select-agent">
                          <SelectValue placeholder="Select an agent" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No agent (use default)</SelectItem>
                          {agents
                            .filter((agent) => {
                              // Only show incoming agents (not flow agents) for widgets
                              // Flow agents don't work reliably with WebSocket-based widget audio
                              if (agent.type !== 'incoming') return false;
                              const sipProviders = ['elevenlabs-sip', 'openai-sip'];
                              return !sipProviders.includes(agent.telephonyProvider || '');
                            })
                            .map((agent) => (
                            <SelectItem key={agent.id} value={agent.id}>
                              {agent.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Select an incoming AI agent to power this widget (flow agents are not supported)
                      </p>
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-lg border">
                      <div>
                        <Label>Status</Label>
                        <p className="text-sm text-muted-foreground">Enable or disable this widget</p>
                      </div>
                      <Select
                        value={formData.status}
                        onValueChange={(value) => setFormData({ ...formData, status: value })}
                      >
                        <SelectTrigger className="w-28">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="paused">Paused</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </TabsContent>

                  <TabsContent value="branding" className="mt-0 space-y-4">
                    <div className="space-y-2">
                      <Label>Widget Icon</Label>
                      <div className="flex items-center gap-4">
                        <div 
                          className="h-16 w-16 rounded-lg border-2 border-dashed flex items-center justify-center overflow-hidden cursor-pointer hover:border-primary transition-colors"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          {formData.iconPreview ? (
                            <img src={formData.iconPreview} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <Upload className="h-6 w-6 text-muted-foreground" />
                          )}
                        </div>
                        <div className="flex-1">
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            onChange={handleIconUpload}
                            className="hidden"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => fileInputRef.current?.click()}
                          >
                            Upload Icon
                          </Button>
                          {formData.iconPreview && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={removeIcon}
                              className="ml-2 text-destructive"
                            >
                              Remove
                            </Button>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            PNG, JPG up to 2MB. Recommended: 128x128px
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="brandName">Brand Name</Label>
                      <Input
                        id="brandName"
                        value={formData.brandName}
                        onChange={(e) => setFormData({ ...formData, brandName: e.target.value })}
                        placeholder="Your Company"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="buttonLabel">Button Label</Label>
                      <Input
                        id="buttonLabel"
                        value={formData.buttonLabel}
                        onChange={(e) => setFormData({ ...formData, buttonLabel: e.target.value })}
                        placeholder="VOICE CHAT"
                        maxLength={20}
                      />
                      <p className="text-xs text-muted-foreground">
                        Text displayed on the call button (max 20 characters)
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>Primary Color</Label>
                      <div className="flex flex-wrap gap-2 mb-2">
                        {COLOR_PRESETS.map((preset) => (
                          <button
                            key={preset.name}
                            type="button"
                            onClick={() => setFormData({ ...formData, primaryColor: preset.primary })}
                            className={`w-8 h-8 rounded-full border-2 transition-transform hover:scale-110 ${
                              formData.primaryColor === preset.primary ? 'ring-2 ring-offset-2 ring-primary' : ''
                            }`}
                            style={{ backgroundColor: preset.primary }}
                            title={preset.name}
                          />
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <Input
                          type="color"
                          value={formData.primaryColor}
                          onChange={(e) => setFormData({ ...formData, primaryColor: e.target.value })}
                          className="w-12 h-9 p-1"
                        />
                        <Input
                          value={formData.primaryColor}
                          onChange={(e) => setFormData({ ...formData, primaryColor: e.target.value })}
                          placeholder="#3B82F6"
                          className="flex-1"
                        />
                      </div>
                    </div>

                    <Separator />

                    <div className="flex items-center justify-between p-3 rounded-lg border">
                      <div>
                        <Label>Require Terms Acceptance</Label>
                        <p className="text-sm text-muted-foreground">
                          Show terms checkbox before starting call
                        </p>
                      </div>
                      <Switch
                        checked={formData.requireTermsAcceptance}
                        onCheckedChange={(checked) => setFormData({ ...formData, requireTermsAcceptance: checked })}
                      />
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-lg border">
                      <div>
                        <Label>Appointment Booking</Label>
                        <p className="text-sm text-muted-foreground">
                          Allow visitors to book appointments during calls
                        </p>
                      </div>
                      <Switch
                        checked={formData.appointmentBookingEnabled}
                        onCheckedChange={(checked) => setFormData({ ...formData, appointmentBookingEnabled: checked })}
                        data-testid="switch-appointment-booking"
                      />
                    </div>
                  </TabsContent>

                  <TabsContent value="settings" className="mt-0 space-y-4">
                    <div className="space-y-2">
                      <Label>Allowed Domains</Label>
                      <p className="text-sm text-muted-foreground">
                        Restrict where the widget can be embedded (leave empty for any domain)
                      </p>
                      <div className="flex gap-2">
                        <Input
                          value={domainInput}
                          onChange={(e) => setDomainInput(e.target.value)}
                          placeholder="example.com"
                          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addDomain())}
                        />
                        <Button type="button" onClick={addDomain} variant="secondary">
                          Add
                        </Button>
                      </div>
                      {formData.allowedDomains.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {formData.allowedDomains.map((domain) => (
                            <Badge key={domain} variant="secondary" className="pr-1">
                              {domain}
                              <button
                                type="button"
                                onClick={() => removeDomain(domain)}
                                className="ml-2 hover:text-destructive"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>

                    <Separator />

                    <div className="flex items-center justify-between p-3 rounded-lg border">
                      <div>
                        <Label>Business Hours</Label>
                        <p className="text-sm text-muted-foreground">
                          Restrict availability to specific hours
                        </p>
                      </div>
                      <Switch
                        checked={formData.businessHoursEnabled}
                        onCheckedChange={(checked) => setFormData({ ...formData, businessHoursEnabled: checked })}
                      />
                    </div>

                    {formData.businessHoursEnabled && (
                      <div className="space-y-4 pl-4 border-l-2 border-muted">
                        <div className="space-y-2">
                          <Label>Timezone</Label>
                          <Select
                            value={formData.businessTimezone}
                            onValueChange={(value) => setFormData({ ...formData, businessTimezone: value })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TIMEZONE_OPTIONS.map((tz) => (
                                <SelectItem key={tz.value} value={tz.value}>
                                  {tz.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Start Time</Label>
                            <Input
                              type="time"
                              value={formData.businessHoursStart}
                              onChange={(e) => setFormData({ ...formData, businessHoursStart: e.target.value })}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>End Time</Label>
                            <Input
                              type="time"
                              value={formData.businessHoursEnd}
                              onChange={(e) => setFormData({ ...formData, businessHoursEnd: e.target.value })}
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label>Days</Label>
                          <div className="flex flex-wrap gap-2">
                            {DAY_OPTIONS.map((day) => (
                              <button
                                key={day.value}
                                type="button"
                                onClick={() => toggleDay(day.value)}
                                className={`px-3 py-1.5 rounded-md border text-sm transition-colors ${
                                  formData.businessDays.includes(day.value)
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "bg-background hover-elevate"
                                }`}
                              >
                                {day.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" className="w-full justify-between">
                          Advanced Settings
                          <ChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="space-y-4 pt-4">
                        <div className="grid grid-cols-3 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="maxDuration">Max Duration (sec)</Label>
                            <Input
                              id="maxDuration"
                              type="number"
                              min={10}
                              max={3600}
                              value={formData.maxCallDuration}
                              onChange={(e) => setFormData({ ...formData, maxCallDuration: parseInt(e.target.value) || 300 })}
                              data-testid="input-max-duration"
                            />
                            <p className="text-xs text-muted-foreground">10-3600 seconds</p>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="cooldown">Cooldown (min)</Label>
                            <Input
                              id="cooldown"
                              type="number"
                              min={0}
                              max={60}
                              value={formData.cooldownMinutes}
                              onChange={(e) => setFormData({ ...formData, cooldownMinutes: parseInt(e.target.value) || 0 })}
                              data-testid="input-cooldown"
                            />
                            <p className="text-xs text-muted-foreground">Wait time per IP</p>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="maxConcurrent">Max Sessions</Label>
                            <Input
                              id="maxConcurrent"
                              type="number"
                              min={1}
                              max={100}
                              value={formData.maxConcurrentCalls}
                              onChange={(e) => setFormData({ ...formData, maxConcurrentCalls: parseInt(e.target.value) || 5 })}
                              data-testid="input-max-concurrent"
                            />
                            <p className="text-xs text-muted-foreground">1-100 sessions</p>
                          </div>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </TabsContent>
                </ScrollArea>
              </Tabs>
            </div>

            <div className="w-[440px] shrink-0 border-l pl-6">
              <h3 className="font-semibold mb-3">Preview</h3>
              <InteractiveWidgetPreview formData={formData} appName={appName} />
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button
              variant="outline"
              onClick={() => {
                setIsCreateOpen(false);
                setEditingWidget(null);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting} data-testid="button-save-widget">
              {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingWidget ? "Save Changes" : "Create Widget"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={embedCodeWidget !== null} onOpenChange={(open) => !open && setEmbedCodeWidget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Embed Code</DialogTitle>
            <DialogDescription>
              Copy this code and paste it into your website's HTML, just before the closing &lt;/body&gt; tag.
            </DialogDescription>
          </DialogHeader>
          
          <div className="relative mt-4">
            <ScrollArea className="h-48">
              <pre className="bg-muted p-4 rounded-lg text-xs font-mono whitespace-pre-wrap break-all">
                {embedCode}
              </pre>
            </ScrollArea>
            <Button
              size="sm"
              className="absolute top-2 right-4"
              onClick={() => copyToClipboard(embedCode)}
            >
              <Copy className="h-4 w-4 mr-1" />
              Copy
            </Button>
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setEmbedCodeWidget(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
