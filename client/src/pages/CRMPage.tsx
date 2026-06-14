import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { 
  Loader2, Search, LayoutGrid, List, Users, Phone, Star, Calendar, 
  FileText, ArrowRightLeft, PhoneForwarded, Play, Pause, ChevronDown,
  MoreHorizontal, RefreshCw, Download, Plus, MessageSquare, CheckCircle2,
  TrendingUp, TrendingDown, Minus, Clock, Flame, UserX, PhoneMissed,
  ClipboardCheck, UserCheck, ArrowDownUp, PhoneCall, Zap, Palette, Check,
  History, Tag, Trash2, BarChart3, Square, CheckSquare, X, Megaphone, PhoneIncoming,
  GripVertical, Settings, EyeOff, Eye
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { motion, AnimatePresence } from "framer-motion";

interface Lead {
  id: string;
  userId: string;
  sourceType: string;
  campaignId: string | null;
  incomingConnectionId: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string;
  email: string | null;
  stage: string;
  stageId: string | null;
  leadScore: number | null;
  aiSummary: string | null;
  aiCategory: string | null;
  sentiment: string | null;
  hasAppointment: boolean;
  hasFormSubmission: boolean;
  hasTransfer: boolean;
  hasCallback: boolean;
  transcript: string | null;
  recordingUrl: string | null;
  tags: string[] | null;
  notesCount?: number;
  createdAt: string;
  updatedAt: string;
}

interface LeadNote {
  id: string;
  leadId: string;
  userId: string;
  content: string;
  createdAt: string;
}

interface LeadActivity {
  id: string;
  leadId: string;
  userId: string;
  activityType: string;
  title: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface CRMAnalytics {
  totalLeads: number;
  leadsByStage: { stage: string; count: number }[];
  leadsByCategory: { category: string; count: number }[];
  leadsBySource: { sourceType: string; count: number }[];
  leadsByDate: { date: string; count: number }[];
  conversionRates: { fromStage: string; toStage: string; rate: number }[];
  avgLeadScore: number;
  sentimentBreakdown: { sentiment: string; count: number }[];
}

interface LeadStage {
  id: string;
  name: string;
  color: string;
  order: number;
  isDefault: boolean;
  isCustom: boolean;
}

interface Campaign {
  id: string;
  name: string;
}

interface IncomingConnection {
  id: string;
  agentId: string;
  phoneNumberId: string;
}

// AI Lead Categories - only show qualified prospects
const AI_CATEGORIES = [
  { id: 'appointment_booked', label: 'Appointment Booked', color: '#10B981', icon: Calendar },
  { id: 'form_submitted', label: 'Form Submitted', color: '#3B82F6', icon: ClipboardCheck },
  { id: 'call_transfer', label: 'Call Transfer', color: '#8B5CF6', icon: PhoneForwarded },
  { id: 'need_follow_up', label: 'Need Follow Up', color: '#F97316', icon: Clock },
  { id: 'hot', label: 'Hot Lead', color: '#EF4444', icon: Flame },
  { id: 'warm', label: 'Warm Lead', color: '#F59E0B', icon: TrendingUp },
] as const;

type AICategory = typeof AI_CATEGORIES[number]['id'];

interface CategoryCounts {
  counts: Record<AICategory, number>;
  total: number;
  categories: Array<{ id: AICategory; label: string; color: string; count: number }>;
}

interface PaginatedLeadsResponse {
  leads: Lead[];
  total: number;
  hasMore: boolean;
}

interface AIKanbanResponse {
  categories: Array<{ id: AICategory; label: string; color: string; total: number }>;
  columns: Record<AICategory, { leads: Lead[]; total: number; hasMore: boolean }>;
}

interface CrmCategoryPreferences {
  id: string;
  userId: string;
  columnOrder: string[];
  colorOverrides: Record<string, string>;
  columnSortPreferences: Record<string, 'newest' | 'oldest' | 'score-high' | 'score-low'>;
  hideLeadsWithoutPhone: boolean;
  categoryPipelineMappings: Record<string, string>;
  hotScoreThreshold: number;
  warmScoreThreshold: number;
  hiddenCategories: string[];
}

const COLOR_PRESETS = [
  { name: "Emerald", hex: "#10B981", gradient: "from-emerald-500 to-emerald-600" },
  { name: "Orange", hex: "#F97316", gradient: "from-orange-500 to-red-500" },
  { name: "Blue", hex: "#3B82F6", gradient: "from-blue-500 to-blue-600" },
  { name: "Purple", hex: "#8B5CF6", gradient: "from-purple-500 to-purple-600" },
  { name: "Amber", hex: "#F59E0B", gradient: "from-amber-500 to-amber-600" },
  { name: "Rose", hex: "#F43F5E", gradient: "from-rose-500 to-rose-600" },
  { name: "Slate", hex: "#64748B", gradient: "from-slate-500 to-slate-600" },
  { name: "Teal", hex: "#14B8A6", gradient: "from-brand to-brand/90" },
  { name: "Indigo", hex: "#6366F1", gradient: "from-indigo-500 to-indigo-600" },
  { name: "Pink", hex: "#EC4899", gradient: "from-pink-500 to-pink-600" },
  { name: "Cyan", hex: "#06B6D4", gradient: "from-cyan-500 to-cyan-600" },
  { name: "Lime", hex: "#84CC16", gradient: "from-lime-500 to-lime-600" },
];

const stageThemes: Record<string, { 
  accent: string;
  accentBorder: string;
  headerGradient: string;
  icon: typeof Flame;
  badgeBg: string;
}> = {
  "new": { 
    accent: "text-emerald-600 dark:text-emerald-400",
    accentBorder: "border-l-emerald-500",
    headerGradient: "bg-gradient-to-r from-emerald-500 to-emerald-600",
    icon: UserCheck,
    badgeBg: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
  },
  "hot": { 
    accent: "text-orange-600 dark:text-orange-400",
    accentBorder: "border-l-orange-500",
    headerGradient: "bg-gradient-to-r from-orange-500 to-red-500",
    icon: Flame,
    badgeBg: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300"
  },
  "appointment": { 
    accent: "text-blue-600 dark:text-blue-400",
    accentBorder: "border-l-blue-500",
    headerGradient: "bg-gradient-to-r from-blue-500 to-blue-600",
    icon: Calendar,
    badgeBg: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
  },
  "form_submitted": { 
    accent: "text-purple-600 dark:text-purple-400",
    accentBorder: "border-l-purple-500",
    headerGradient: "bg-gradient-to-r from-purple-500 to-purple-600",
    icon: ClipboardCheck,
    badgeBg: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300"
  },
  "follow_up": { 
    accent: "text-amber-600 dark:text-amber-400",
    accentBorder: "border-l-amber-500",
    headerGradient: "bg-gradient-to-r from-amber-500 to-amber-600",
    icon: Clock,
    badgeBg: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
  },
  "not_interested": { 
    accent: "text-rose-600 dark:text-rose-400",
    accentBorder: "border-l-rose-500",
    headerGradient: "bg-gradient-to-r from-rose-500 to-rose-600",
    icon: UserX,
    badgeBg: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
  },
  "no_answer": { 
    accent: "text-slate-600 dark:text-slate-400",
    accentBorder: "border-l-slate-400",
    headerGradient: "bg-gradient-to-r from-slate-500 to-slate-600",
    icon: PhoneMissed,
    badgeBg: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
  },
};

function hexToGradientStyle(hexColor: string): React.CSSProperties | null {
  const preset = COLOR_PRESETS.find(p => p.hex.toLowerCase() === hexColor.toLowerCase());
  if (preset) {
    return null;
  }
  const darkerHex = adjustColorBrightness(hexColor, -20);
  return {
    background: `linear-gradient(to right, ${hexColor}, ${darkerHex})`,
  };
}

function adjustColorBrightness(hex: string, percent: number): string {
  const num = parseInt(hex.replace("#", ""), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + percent));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + percent));
  const b = Math.min(255, Math.max(0, (num & 0x0000FF) + percent));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function getStageTheme(stageName: string, customColor?: string) {
  const key = stageName.toLowerCase().replace(/\s+/g, "_");
  const baseTheme = stageThemes[key] || {
    accent: "text-slate-600 dark:text-slate-400",
    accentBorder: "border-l-slate-400",
    headerGradient: "bg-gradient-to-r from-slate-500 to-slate-600",
    icon: Users,
    badgeBg: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
  };
  
  if (customColor && customColor !== "#6B7280") {
    const preset = COLOR_PRESETS.find(p => p.hex.toLowerCase() === customColor.toLowerCase());
    if (preset) {
      return {
        ...baseTheme,
        headerGradient: `bg-gradient-to-r ${preset.gradient}`,
        customColorStyle: null,
      };
    }
    return {
      ...baseTheme,
      headerGradient: "",
      customColorStyle: hexToGradientStyle(customColor),
    };
  }
  
  return { ...baseTheme, customColorStyle: null };
}

function ScoreIndicator({ score }: { score: number | null }) {
  if (score === null || score === undefined) {
    return (
      <div className="flex items-center justify-center w-10 h-10 rounded-full bg-muted">
        <span className="text-xs font-medium text-muted-foreground">--</span>
      </div>
    );
  }

  const getScoreColor = (s: number) => {
    if (s >= 80) return { ring: "stroke-emerald-500", bg: "bg-emerald-50 dark:bg-emerald-950/50", text: "text-emerald-700 dark:text-emerald-400" };
    if (s >= 60) return { ring: "stroke-amber-500", bg: "bg-amber-50 dark:bg-amber-950/50", text: "text-amber-700 dark:text-amber-400" };
    if (s >= 40) return { ring: "stroke-blue-500", bg: "bg-blue-50 dark:bg-blue-950/50", text: "text-blue-700 dark:text-blue-400" };
    return { ring: "stroke-slate-400", bg: "bg-slate-100 dark:bg-slate-800", text: "text-slate-600 dark:text-slate-400" };
  };

  const colors = getScoreColor(score);
  const circumference = 2 * Math.PI * 16;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  return (
    <div className={`relative flex items-center justify-center w-10 h-10 rounded-full ${colors.bg}`}>
      <svg className="w-10 h-10 -rotate-90" viewBox="0 0 40 40">
        <circle
          cx="20"
          cy="20"
          r="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          className="text-muted/30"
        />
        <circle
          cx="20"
          cy="20"
          r="16"
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          className={colors.ring}
        />
      </svg>
      <span className={`absolute text-xs font-bold ${colors.text}`}>{score}</span>
    </div>
  );
}

function SentimentIcon({ sentiment }: { sentiment: string | null }) {
  if (!sentiment) return null;
  if (sentiment === "positive") return <TrendingUp className="w-4 h-4 text-emerald-500" />;
  if (sentiment === "negative") return <TrendingDown className="w-4 h-4 text-rose-500" />;
  return <Minus className="w-4 h-4 text-muted-foreground" />;
}

function ActivityIndicators({ lead }: { lead: Lead }) {
  const activities = [];
  
  if (lead.hasAppointment) {
    activities.push({ icon: Calendar, color: "text-blue-500", bg: "bg-blue-100 dark:bg-blue-900/50", label: "Appointment" });
  }
  if (lead.hasFormSubmission) {
    activities.push({ icon: ClipboardCheck, color: "text-purple-500", bg: "bg-purple-100 dark:bg-purple-900/50", label: "Form" });
  }
  if (lead.hasTransfer) {
    activities.push({ icon: PhoneForwarded, color: "text-violet-500", bg: "bg-violet-100 dark:bg-violet-900/50", label: "Transfer" });
  }
  if (lead.hasCallback) {
    activities.push({ icon: PhoneCall, color: "text-amber-500", bg: "bg-amber-100 dark:bg-amber-900/50", label: "Callback" });
  }

  if (activities.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5">
      {activities.map((activity, index) => (
        <div 
          key={index} 
          className={`flex items-center justify-center w-6 h-6 rounded-md ${activity.bg}`}
          title={activity.label}
        >
          <activity.icon className={`w-3.5 h-3.5 ${activity.color}`} />
        </div>
      ))}
    </div>
  );
}

function LeadCard({ lead, onClick, stageColor, isSelected, onToggleSelect }: { 
  lead: Lead; 
  onClick: () => void; 
  stageColor?: string;
  isSelected?: boolean;
  onToggleSelect?: (leadId: string) => void;
}) {
  const hasValidPhone = lead.phone && lead.phone !== 'Unknown' && lead.phone.trim() !== '';
  const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(" ");
  // Primary display: Phone if valid, otherwise name, otherwise email, otherwise Unknown
  const primaryDisplay = hasValidPhone ? lead.phone : (fullName || lead.email || "Unknown Contact");
  const theme = getStageTheme(lead.stage, stageColor);
  
  const description = lead.aiSummary || 
    (lead.transcript ? (typeof lead.transcript === 'string' ? lead.transcript : JSON.stringify(lead.transcript)).slice(0, 80) + "..." : null);

  const timeAgo = lead.createdAt ? (() => {
    const diff = Date.now() - new Date(lead.createdAt).getTime();
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return "Just now";
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  })() : null;

  const borderStyle = stageColor && stageColor !== "#6B7280" 
    ? { borderLeftColor: stageColor } 
    : undefined;

  const hasNotes = (lead.notesCount ?? 0) > 0;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.15 }}
      className="group"
    >
      <Card 
        className={`cursor-pointer hover-elevate transition-all bg-card border-l-[3px] ${!borderStyle ? theme.accentBorder : ''} ${isSelected ? 'ring-2 ring-primary' : ''}`}
        onClick={onClick}
        data-testid={`lead-card-${lead.id}`}
        style={borderStyle}
      >
        <CardContent className="p-3">
          <div className="flex flex-col gap-2">
            {/* Header row: Checkbox, Score, Phone/Name, Notes icon */}
            <div className="flex items-center gap-2">
              {onToggleSelect && (
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => onToggleSelect(lead.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0"
                  data-testid={`select-lead-${lead.id}`}
                />
              )}
              
              {/* Lead Score */}
              <ScoreIndicator score={lead.leadScore} />
              
              {/* Phone Number / Name - Primary display */}
              <h4 className={`font-semibold text-sm text-foreground flex-1 truncate ${hasValidPhone ? 'font-mono' : ''}`} data-testid={`lead-primary-${lead.id}`}>
                {primaryDisplay}
              </h4>
              
              {/* Notes icon - show if notes exist */}
              {hasNotes && (
                <div 
                  className="flex items-center justify-center w-6 h-6 rounded-md bg-blue-100 dark:bg-blue-900/50"
                  title={`${lead.notesCount} note${(lead.notesCount ?? 0) > 1 ? 's' : ''}`}
                >
                  <MessageSquare className="w-3.5 h-3.5 text-blue-500" />
                </div>
              )}
            </div>

            {/* Description - AI Summary */}
            {description && (
              <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                {description}
              </p>
            )}

            {/* Tags display */}
            {lead.tags && lead.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {lead.tags.slice(0, 3).map((tag, idx) => (
                  <Badge 
                    key={idx} 
                    variant="secondary" 
                    className="text-[10px] px-1.5 py-0 h-4 bg-primary/10 text-primary hover:bg-primary/20"
                  >
                    <Tag className="w-2.5 h-2.5 mr-0.5" />
                    {tag}
                  </Badge>
                ))}
                {lead.tags.length > 3 && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                    +{lead.tags.length - 3}
                  </Badge>
                )}
              </div>
            )}

            {/* Footer: Activity indicators and time */}
            <div className="flex items-center justify-between pt-1 border-t border-border/50">
              <div className="flex items-center gap-2">
                <ActivityIndicators lead={lead} />
                {lead.sentiment && <SentimentIcon sentiment={lead.sentiment} />}
              </div>
              {timeAgo && (
                <span className="text-[10px] text-muted-foreground">{timeAgo}</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function KanbanColumn({ stage, leads, onLeadClick, onDrop, onSort, selectedLeadIds, onToggleSelect }: { 
  stage: LeadStage; 
  leads: Lead[]; 
  onLeadClick: (lead: Lead) => void;
  onDrop: (leadId: string, newStage: string, newStageId: string) => void;
  onSort: (stageId: string, sortBy: "score" | "date") => void;
  selectedLeadIds?: Set<string>;
  onToggleSelect?: (leadId: string) => void;
}) {
  const theme = getStageTheme(stage.name, stage.color);
  const StageIcon = theme.icon;
  
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.add("ring-2", "ring-white/30");
  };
  
  const handleDragLeave = (e: React.DragEvent) => {
    e.currentTarget.classList.remove("ring-2", "ring-white/30");
  };
  
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.remove("ring-2", "ring-white/30");
    const leadId = e.dataTransfer.getData("leadId");
    if (leadId) {
      onDrop(leadId, stage.name, stage.id);
    }
  };

  return (
    <div 
      className="flex flex-col min-w-[300px] max-w-[300px] rounded-xl overflow-hidden transition-all border border-border/50 bg-card"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-testid={`kanban-column-${stage.id}`}
    >
      <div 
        className={`${theme.headerGradient} px-4 py-3 text-white`}
        style={theme.customColorStyle || undefined}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-white/20">
              <StageIcon className="w-4 h-4" />
            </div>
            <h3 className="font-semibold text-sm uppercase tracking-wide">
              {stage.name.replace(/_/g, " ")}
            </h3>
            <Badge className="h-5 px-1.5 text-[10px] font-medium bg-white/20 text-white border-0">
              {leads.length}
            </Badge>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-white/80 hover:text-white hover:bg-white/20" data-testid={`column-menu-${stage.id}`}>
                <ArrowDownUp className="w-3.5 h-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onSort(stage.id, "score")} data-testid={`sort-score-${stage.id}`}>
                <Star className="w-4 h-4 mr-2" /> Sort by score
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onSort(stage.id, "date")} data-testid={`sort-date-${stage.id}`}>
                <Clock className="w-4 h-4 mr-2" /> Sort by date
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      
      <ScrollArea className="flex-1 p-2" style={{ maxHeight: "calc(100vh - 260px)" }}>
        <div className="space-y-2">
          <AnimatePresence mode="popLayout">
            {leads.map((lead) => (
              <div
                key={lead.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("leadId", lead.id);
                }}
              >
                <LeadCard 
                  lead={lead} 
                  onClick={() => onLeadClick(lead)} 
                  stageColor={stage.color}
                  isSelected={selectedLeadIds?.has(lead.id)}
                  onToggleSelect={onToggleSelect}
                />
              </div>
            ))}
          </AnimatePresence>
          {leads.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mb-2">
                <StageIcon className={`w-4 h-4 ${theme.accent}`} />
              </div>
              <p className="text-xs text-muted-foreground">No leads</p>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">Drop leads here</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function AIKanbanColumn({ 
  category, 
  leads, 
  total,
  onLeadClick, 
  selectedLeadIds, 
  onToggleSelect,
  highlighted = false,
  sortBy,
  onSortChange,
  onColorChange,
  onLeadDrop,
  isDragging = false,
  isDragOver = false,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd
}: { 
  category: { id: AICategory; label: string; color: string };
  leads: Lead[]; 
  total: number;
  onLeadClick: (lead: Lead) => void;
  selectedLeadIds?: Set<string>;
  onToggleSelect?: (leadId: string) => void;
  highlighted?: boolean;
  sortBy?: 'newest' | 'oldest' | 'score-high' | 'score-low';
  onSortChange?: (sortBy: 'newest' | 'oldest' | 'score-high' | 'score-low') => void;
  onColorChange?: (color: string) => void;
  onLeadDrop?: (leadId: string, targetCategory: AICategory) => void;
  isDragging?: boolean;
  isDragOver?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
}) {
  const categoryInfo = AI_CATEGORIES.find(c => c.id === category.id);
  const Icon = categoryInfo?.icon || Zap;

  return (
    <div 
      className={`flex flex-col min-w-[300px] max-w-[300px] rounded-xl overflow-hidden transition-all border bg-card ${
        highlighted ? 'border-primary ring-2 ring-primary/30 shadow-lg' : 'border-border/50 opacity-90'
      } ${isDragging ? 'opacity-50 scale-95' : ''} ${isDragOver ? 'ring-2 ring-blue-400 scale-[1.02]' : ''}`}
      data-testid={`ai-kanban-column-${category.id}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <div 
        className="px-4 py-3 text-white cursor-grab active:cursor-grabbing"
        style={{ backgroundColor: category.color }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GripVertical className="w-4 h-4 text-white/60" />
            <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-white/20">
              <Icon className="w-4 h-4" />
            </div>
            <h3 className="font-semibold text-sm uppercase tracking-wide">
              {category.label}
            </h3>
            <Badge className="h-5 px-1.5 text-[10px] font-medium bg-white/20 text-white border-0">
              {total}
            </Badge>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-white/80 hover:text-white hover:bg-white/20">
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem 
                onClick={() => onSortChange?.('newest')}
                className={sortBy === 'newest' ? 'bg-accent' : ''}
              >
                <ArrowDownUp className="w-4 h-4 mr-2" />
                Newest First
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => onSortChange?.('oldest')}
                className={sortBy === 'oldest' ? 'bg-accent' : ''}
              >
                <ArrowDownUp className="w-4 h-4 mr-2" />
                Oldest First
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => onSortChange?.('score-high')}
                className={sortBy === 'score-high' ? 'bg-accent' : ''}
              >
                <Star className="w-4 h-4 mr-2" />
                Highest Score
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => onSortChange?.('score-low')}
                className={sortBy === 'score-low' ? 'bg-accent' : ''}
              >
                <Star className="w-4 h-4 mr-2" />
                Lowest Score
              </DropdownMenuItem>
              <Separator className="my-1" />
              <div className="px-2 py-1.5">
                <p className="text-xs font-medium mb-2">Column Color</p>
                <div className="grid grid-cols-4 gap-1">
                  {COLOR_PRESETS.slice(0, 8).map((preset) => (
                    <button
                      key={preset.hex}
                      className={`w-6 h-6 rounded-md transition-transform hover:scale-110 ${
                        category.color.toLowerCase() === preset.hex.toLowerCase() ? 'ring-2 ring-primary ring-offset-1' : ''
                      }`}
                      style={{ backgroundColor: preset.hex }}
                      onClick={() => onColorChange?.(preset.hex)}
                      title={preset.name}
                    />
                  ))}
                </div>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      
      <ScrollArea 
        className="flex-1 p-2" 
        style={{ maxHeight: "calc(100vh - 260px)" }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const leadId = e.dataTransfer.getData("leadId");
          if (leadId && onLeadDrop) {
            onLeadDrop(leadId, category.id);
          }
        }}
      >
        <div className="space-y-2">
          <AnimatePresence mode="popLayout">
            {leads.map((lead) => (
              <div 
                key={lead.id}
                draggable
                onDragStart={(e) => {
                  e.stopPropagation();
                  e.dataTransfer.setData("leadId", lead.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
              >
                <LeadCard 
                  lead={lead} 
                  onClick={() => onLeadClick(lead)} 
                  stageColor={category.color}
                  isSelected={selectedLeadIds?.has(lead.id)}
                  onToggleSelect={onToggleSelect}
                />
              </div>
            ))}
          </AnimatePresence>
          {leads.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 text-center min-h-[100px]">
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mb-2">
                <Icon className="w-4 h-4" style={{ color: category.color }} />
              </div>
              <p className="text-xs text-muted-foreground">No leads</p>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">Drop leads here</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function LeadDetailModal({ lead, open, onClose, stageColor }: { lead: Lead | null; open: boolean; onClose: () => void; stageColor?: string }) {
  const { toast } = useToast();
  const queryClientRef = useQueryClient();
  const [noteText, setNoteText] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeTab, setActiveTab] = useState("notes");

  useEffect(() => {
    if (!open && lead?.id) {
      const audio = document.getElementById(`audio-${lead.id}`) as HTMLAudioElement;
      if (audio) {
        audio.pause();
      }
      setIsPlaying(false);
    }
  }, [open, lead?.id]);

  useEffect(() => {
    return () => {
      if (lead?.id) {
        const audio = document.getElementById(`audio-${lead.id}`) as HTMLAudioElement;
        if (audio) {
          audio.pause();
        }
      }
    };
  }, [lead?.id]);

  const displayName = lead ? [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown" : "";

  const notesQueryKey = `/api/crm/leads/${lead?.id}/notes`;
  const { data: notes = [], isLoading: notesLoading } = useQuery<LeadNote[]>({
    queryKey: [notesQueryKey],
    enabled: !!lead?.id && open,
  });

  const activitiesQueryKey = `/api/crm/leads/${lead?.id}/activities`;
  const { data: activities = [], isLoading: activitiesLoading } = useQuery<LeadActivity[]>({
    queryKey: [activitiesQueryKey],
    enabled: !!lead?.id && open,
  });

  const addNoteMutation = useMutation({
    mutationFn: async (content: string) => {
      return apiRequest("POST", `/api/crm/leads/${lead?.id}/notes`, { content });
    },
    onSuccess: () => {
      toast({ title: "Note added" });
      setNoteText("");
      queryClientRef.invalidateQueries({ queryKey: [notesQueryKey] });
      queryClientRef.invalidateQueries({ queryKey: [activitiesQueryKey] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'call': return <Phone className="w-3 h-3" />;
      case 'note': return <MessageSquare className="w-3 h-3" />;
      case 'stage_change': return <ArrowRightLeft className="w-3 h-3" />;
      case 'tag_added': case 'tag_removed': return <Tag className="w-3 h-3" />;
      case 'created': return <Plus className="w-3 h-3" />;
      case 'transfer': return <PhoneForwarded className="w-3 h-3" />;
      case 'appointment': return <Calendar className="w-3 h-3" />;
      default: return <History className="w-3 h-3" />;
    }
  };

  if (!lead) return null;

  const theme = getStageTheme(lead.stage, stageColor);

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="lead-detail-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <ScoreIndicator score={lead.leadScore} />
            <div>
              <span className="text-lg">{displayName}</span>
              <div className="flex items-center gap-2 mt-1">
                <Badge className={theme.badgeBg}>{lead.stage}</Badge>
                {lead.sentiment && (
                  <Badge variant="outline" className="flex items-center gap-1">
                    <SentimentIcon sentiment={lead.sentiment} />
                    <span className="capitalize">{lead.sentiment}</span>
                  </Badge>
                )}
              </div>
            </div>
          </DialogTitle>
          <DialogDescription>
            Lead details and conversation history
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Phone</p>
              <p className="font-mono" data-testid="lead-detail-phone">{lead.phone}</p>
            </div>
            {lead.email && (
              <div>
                <p className="text-sm text-muted-foreground">Email</p>
                <p data-testid="lead-detail-email">{lead.email}</p>
              </div>
            )}
            <div>
              <p className="text-sm text-muted-foreground">Source</p>
              <Badge variant="outline" className="flex items-center gap-1 w-fit">
                {lead.sourceType === "campaign" ? <Zap className="w-3 h-3" /> : <PhoneCall className="w-3 h-3" />}
                {lead.sourceType === "campaign" ? "Campaign" : "Incoming"}
              </Badge>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Created</p>
              <p className="text-sm">{new Date(lead.createdAt).toLocaleDateString()}</p>
            </div>
          </div>

          <Separator />

          <div className="flex flex-wrap gap-2">
            {lead.hasAppointment && (
              <Badge className="bg-blue-500 text-white flex items-center gap-1">
                <Calendar className="w-3 h-3" /> Appointment Booked
              </Badge>
            )}
            {lead.hasFormSubmission && (
              <Badge className="bg-purple-500 text-white flex items-center gap-1">
                <ClipboardCheck className="w-3 h-3" /> Form Submitted
              </Badge>
            )}
            {lead.hasTransfer && (
              <Badge className="bg-violet-500 text-white flex items-center gap-1">
                <PhoneForwarded className="w-3 h-3" /> Transferred
              </Badge>
            )}
            {lead.hasCallback && (
              <Badge className="bg-amber-500 text-white flex items-center gap-1">
                <PhoneCall className="w-3 h-3" /> Callback Scheduled
              </Badge>
            )}
          </div>

          {lead.recordingUrl && (
            <div>
              <p className="text-sm font-medium mb-2">Recording</p>
              <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    const audio = document.getElementById(`audio-${lead.id}`) as HTMLAudioElement;
                    if (audio) {
                      if (isPlaying) {
                        audio.pause();
                      } else {
                        audio.play();
                      }
                      setIsPlaying(!isPlaying);
                    }
                  }}
                  data-testid="play-recording-button"
                >
                  {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                </Button>
                <audio id={`audio-${lead.id}`} src={lead.recordingUrl} onEnded={() => setIsPlaying(false)} className="hidden" />
                <span className="text-sm text-muted-foreground">Call Recording</span>
              </div>
            </div>
          )}

          {lead.aiSummary && (
            <div>
              <p className="text-sm font-medium mb-2">AI Summary</p>
              <p className="text-sm text-muted-foreground bg-muted p-3 rounded-lg" data-testid="lead-ai-summary">{lead.aiSummary}</p>
            </div>
          )}

          {lead.transcript && (
            <div>
              <p className="text-sm font-medium mb-2">Transcript</p>
              <ScrollArea className="h-48 bg-muted p-3 rounded-lg">
                <pre className="text-xs whitespace-pre-wrap font-sans" data-testid="lead-transcript">{lead.transcript}</pre>
              </ScrollArea>
            </div>
          )}

          <Separator />

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="w-full">
              <TabsTrigger value="notes" className="flex-1" data-testid="tab-notes">
                <MessageSquare className="w-4 h-4 mr-2" />
                Notes ({notes.length})
              </TabsTrigger>
              <TabsTrigger value="activity" className="flex-1" data-testid="tab-activity">
                <History className="w-4 h-4 mr-2" />
                Activity ({activities.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="notes" className="mt-4" data-testid="notes-section">
              {notesLoading ? (
                <div className="flex items-center justify-center py-4" data-testid="notes-loading">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              ) : notes.length > 0 ? (
                <div className="space-y-3 mb-4" data-testid="notes-list">
                  {notes.map((note, index) => (
                    <div key={note.id} className="p-3 bg-muted rounded-lg" data-testid={`note-item-${index}`}>
                      <p className="text-sm" data-testid={`note-content-${index}`}>{note.content}</p>
                      <p className="text-xs text-muted-foreground mt-2" data-testid={`note-date-${index}`}>
                        {new Date(note.createdAt).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground mb-4" data-testid="notes-empty">No notes yet</p>
              )}

              <div className="space-y-2">
                <Textarea 
                  placeholder="Add a note about this lead..."
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  className="min-h-[80px]"
                  data-testid="lead-note-input"
                />
                <Button 
                  onClick={() => noteText.trim() && addNoteMutation.mutate(noteText.trim())}
                  disabled={!noteText.trim() || addNoteMutation.isPending}
                  data-testid="add-note-button"
                >
                  {addNoteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Add Note
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="activity" className="mt-4" data-testid="activity-section">
              {activitiesLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              ) : activities.length > 0 ? (
                <ScrollArea className="h-64">
                  <div className="space-y-3" data-testid="activity-list">
                    {activities.map((activity, index) => (
                      <div key={activity.id} className="flex gap-3 p-3 bg-muted rounded-lg" data-testid={`activity-item-${index}`}>
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-background shrink-0">
                          {getActivityIcon(activity.activityType)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{activity.title}</p>
                          {activity.description && (
                            <p className="text-xs text-muted-foreground mt-1">{activity.description}</p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            {new Date(activity.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <p className="text-sm text-muted-foreground">No activity recorded yet</p>
              )}
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="close-lead-modal">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ListViewCard({ lead, onClick, stageColor, isSelected, onToggleSelect }: { 
  lead: Lead; 
  onClick: () => void; 
  stageColor?: string;
  isSelected?: boolean;
  onToggleSelect?: (leadId: string) => void;
}) {
  // Show name if available, otherwise show phone number as the display name
  const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(" ");
  const hasValidPhone = lead.phone && lead.phone !== 'Unknown';
  const displayName = fullName || (hasValidPhone ? lead.phone : "Unknown Contact");
  const initials = fullName 
    ? fullName.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase() 
    : (hasValidPhone ? lead.phone!.slice(-2) : "??");
  const theme = getStageTheme(lead.stage, stageColor);
  
  const borderStyle = stageColor && stageColor !== "#6B7280" 
    ? { borderLeftColor: stageColor } 
    : undefined;

  return (
    <Card 
      className={`cursor-pointer hover-elevate transition-all border-l-[3px] ${!borderStyle ? theme.accentBorder : ''} ${isSelected ? 'ring-2 ring-primary' : ''}`}
      style={borderStyle}
      onClick={onClick}
      data-testid={`list-lead-${lead.id}`}
    >
      <CardContent className="p-3">
        <div className="flex items-center gap-3">
          {onToggleSelect && (
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onToggleSelect(lead.id)}
              onClick={(e) => e.stopPropagation()}
              className="shrink-0"
              data-testid={`select-list-lead-${lead.id}`}
            />
          )}
          <Avatar className="h-9 w-9 shrink-0">
            <AvatarFallback className="text-xs font-medium bg-muted">
              {initials}
            </AvatarFallback>
          </Avatar>
          
          <div className="flex-1 min-w-0">
            <h4 className="font-medium text-sm truncate">{displayName}</h4>
            {/* Only show phone separately if we have a name (otherwise phone is already the display name) */}
            {fullName && hasValidPhone && (
              <p className="text-xs text-muted-foreground font-mono">{lead.phone}</p>
            )}
          </div>

          <ScoreIndicator score={lead.leadScore} />

          <ActivityIndicators lead={lead} />

          <Badge className={theme.badgeBg} variant="secondary">
            {lead.stage.replace(/_/g, " ")}
          </Badge>
          
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {new Date(lead.createdAt).toLocaleDateString()}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// CRM Filter Settings Dialog Component with local state buffering
function CRMFilterSettingsDialog({
  open,
  onOpenChange,
  categoryPreferences,
  stages,
  onSave,
  isSaving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoryPreferences?: CrmCategoryPreferences;
  stages: LeadStage[];
  onSave: (settings: {
    hideLeadsWithoutPhone?: boolean;
    hotScoreThreshold?: number;
    warmScoreThreshold?: number;
    hiddenCategories?: string[];
  }) => void;
  isSaving: boolean;
}) {
  // Local state for buffering changes
  const [localSettings, setLocalSettings] = useState({
    hideLeadsWithoutPhone: false,
    hotScoreThreshold: 80,
    warmScoreThreshold: 50,
    hiddenCategories: [] as string[],
  });

  // Sync local state when dialog opens or preferences change
  useEffect(() => {
    if (open && categoryPreferences) {
      setLocalSettings({
        hideLeadsWithoutPhone: categoryPreferences.hideLeadsWithoutPhone ?? false,
        hotScoreThreshold: categoryPreferences.hotScoreThreshold ?? 80,
        warmScoreThreshold: categoryPreferences.warmScoreThreshold ?? 50,
        hiddenCategories: categoryPreferences.hiddenCategories ?? [],
      });
    }
  }, [open, categoryPreferences]);

  const handleSave = () => {
    onSave(localSettings);
    onOpenChange(false);
  };

  const toggleCategory = (catId: string) => {
    setLocalSettings(prev => ({
      ...prev,
      hiddenCategories: prev.hiddenCategories.includes(catId)
        ? prev.hiddenCategories.filter(id => id !== catId)
        : [...prev.hiddenCategories, catId],
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="filter-settings-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            CRM Filter Settings
          </DialogTitle>
          <DialogDescription>
            Configure how leads are displayed and filtered in your CRM.
          </DialogDescription>
        </DialogHeader>
        
        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-6 py-4 pr-4">
            {/* Hide leads without phone toggle */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Hide leads without phone</Label>
                <p className="text-xs text-muted-foreground">
                  Only show leads that have a valid phone number
                </p>
              </div>
              <Switch
                checked={localSettings.hideLeadsWithoutPhone}
                onCheckedChange={(checked) => {
                  setLocalSettings(prev => ({ ...prev, hideLeadsWithoutPhone: checked }));
                }}
                data-testid="toggle-hide-no-phone"
              />
            </div>

            <Separator />

            {/* Score Thresholds */}
            <div className="space-y-4">
              <Label className="text-sm font-medium">Lead Score Thresholds</Label>
              <p className="text-xs text-muted-foreground mb-4">
                Define score ranges for Hot and Warm lead classifications
              </p>
              
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Flame className="w-4 h-4 text-orange-500" />
                      <span className="text-sm">Hot Lead Threshold</span>
                    </div>
                    <span className="text-sm font-medium">{localSettings.hotScoreThreshold}+</span>
                  </div>
                  <Slider
                    value={[localSettings.hotScoreThreshold]}
                    onValueChange={([value]) => {
                      setLocalSettings(prev => ({ ...prev, hotScoreThreshold: value }));
                    }}
                    min={50}
                    max={100}
                    step={5}
                    className="w-full"
                    data-testid="slider-hot-threshold"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-yellow-500" />
                      <span className="text-sm">Warm Lead Threshold</span>
                    </div>
                    <span className="text-sm font-medium">{localSettings.warmScoreThreshold}+</span>
                  </div>
                  <Slider
                    value={[localSettings.warmScoreThreshold]}
                    onValueChange={([value]) => {
                      setLocalSettings(prev => ({ ...prev, warmScoreThreshold: value }));
                    }}
                    min={20}
                    max={79}
                    step={5}
                    className="w-full"
                    data-testid="slider-warm-threshold"
                  />
                </div>
              </div>
            </div>

            <Separator />

            {/* Hidden Categories */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Visible Categories</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Choose which AI categories to show in the kanban view
              </p>
              <div className="grid grid-cols-2 gap-2">
                {AI_CATEGORIES.map((cat) => {
                  const isHidden = localSettings.hiddenCategories.includes(cat.id);
                  return (
                    <div
                      key={cat.id}
                      className="flex items-center gap-2 p-2 rounded-md border hover-elevate cursor-pointer"
                      onClick={() => toggleCategory(cat.id)}
                      data-testid={`toggle-category-${cat.id}`}
                    >
                      {isHidden ? (
                        <EyeOff className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <Eye className="w-4 h-4 text-primary" />
                      )}
                      <span className={`text-sm ${isHidden ? 'text-muted-foreground' : ''}`}>
                        {cat.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>
        </ScrollArea>
        
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="cancel-filter-settings">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving} data-testid="save-filter-settings">
            {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Save Settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CRMPage() {
  const { toast } = useToast();
  const queryClientRef = useQueryClient();
  const [viewMode, setViewMode] = useState<"kanban" | "list" | "analytics">("kanban");
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [selectedSourceId, setSelectedSourceId] = useState<string>("all");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [sortBy, setSortBy] = useState<string>("newest");
  const [columnSorts, setColumnSorts] = useState<Record<string, "score" | "date">>({});
  const [listPage, setListPage] = useState(1);
  const [colorSettingsOpen, setColorSettingsOpen] = useState(false);
  const [filterSettingsOpen, setFilterSettingsOpen] = useState(false);
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [bulkActionOpen, setBulkActionOpen] = useState(false);
  const [bulkStageDialogOpen, setBulkStageDialogOpen] = useState(false);
  const [bulkTagDialogOpen, setBulkTagDialogOpen] = useState(false);
  const [newTagInput, setNewTagInput] = useState("");
  const LEADS_PER_PAGE = 50;
  
  // AI Category filtering - only show qualified prospects
  const [aiCategoryFilter, setAiCategoryFilter] = useState<AICategory | "all">("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [loadedLeads, setLoadedLeads] = useState<Lead[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [totalLeads, setTotalLeads] = useState(0);
  
  // Column drag-and-drop state
  const [draggingColumnId, setDraggingColumnId] = useState<string | null>(null);
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);

  const { data: analytics, isLoading: analyticsLoading } = useQuery<CRMAnalytics>({
    queryKey: ["/api/crm/analytics"],
    enabled: viewMode === "analytics",
  });

  const { data: allTags = [] } = useQuery<string[]>({
    queryKey: ["/api/crm/tags"],
  });

  const toggleLeadSelection = (leadId: string) => {
    setSelectedLeadIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(leadId)) {
        newSet.delete(leadId);
      } else {
        newSet.add(leadId);
      }
      return newSet;
    });
  };

  const selectAllLeads = () => {
    if (selectedLeadIds.size === filteredLeads.length) {
      setSelectedLeadIds(new Set());
    } else {
      setSelectedLeadIds(new Set(filteredLeads.map(l => l.id)));
    }
  };

  const clearSelection = () => setSelectedLeadIds(new Set());

  const { data: stages = [], isLoading: stagesLoading } = useQuery<LeadStage[]>({
    queryKey: ["/api/crm/stages"],
  });

  // CRM Category Preferences (colors, column order, sorting)
  const { data: categoryPreferences, isLoading: preferencesLoading } = useQuery<CrmCategoryPreferences>({
    queryKey: ["/api/crm/preferences"],
  });

  // Compute ordered categories based on preferences (excluding hidden ones)
  const orderedCategories = useMemo(() => {
    const defaultOrder = AI_CATEGORIES.map(c => c.id);
    const order = categoryPreferences?.columnOrder || defaultOrder;
    const hiddenCategories = categoryPreferences?.hiddenCategories ?? [];
    
    return order
      .filter(id => AI_CATEGORIES.some(c => c.id === id))
      .filter(id => !hiddenCategories.includes(id)) // Exclude hidden categories
      .map(id => {
        const cat = AI_CATEGORIES.find(c => c.id === id)!;
        const customColor = categoryPreferences?.colorOverrides?.[id];
        return {
          ...cat,
          color: customColor || cat.color,
        };
      });
  }, [categoryPreferences]);

  const updateCategoryColorMutation = useMutation({
    mutationFn: async ({ categoryId, color }: { categoryId: string; color: string }) => {
      return apiRequest("PATCH", `/api/crm/preferences/color/${categoryId}`, { color });
    },
    onMutate: async ({ categoryId, color }: { categoryId: string; color: string }) => {
      await queryClientRef.cancelQueries({ queryKey: ["/api/crm/preferences"] });
      const previousPrefs = queryClientRef.getQueryData<CrmCategoryPreferences>(["/api/crm/preferences"]);
      queryClientRef.setQueryData<CrmCategoryPreferences>(["/api/crm/preferences"], (old) => ({
        id: old?.id ?? '',
        userId: old?.userId ?? '',
        hideLeadsWithoutPhone: old?.hideLeadsWithoutPhone ?? false,
        categoryPipelineMappings: old?.categoryPipelineMappings ?? {},
        hotScoreThreshold: old?.hotScoreThreshold ?? 0,
        warmScoreThreshold: old?.warmScoreThreshold ?? 0,
        hiddenCategories: old?.hiddenCategories ?? [],
        colorOverrides: { ...(old?.colorOverrides || {}), [categoryId]: color },
        columnOrder: old?.columnOrder || [],
        columnSortPreferences: old?.columnSortPreferences || {},
      }));
      return { previousPrefs };
    },
    onError: (error: any, _variables, context) => {
      if (context?.previousPrefs) {
        queryClientRef.setQueryData(["/api/crm/preferences"], context.previousPrefs);
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
    onSettled: () => {
      queryClientRef.invalidateQueries({ queryKey: ["/api/crm/preferences"] });
    },
  });

  const updateColumnOrderMutation = useMutation({
    mutationFn: async (columnOrder: string[]) => {
      return apiRequest("PATCH", "/api/crm/preferences/order", { columnOrder });
    },
    onMutate: async (newOrder: string[]) => {
      await queryClientRef.cancelQueries({ queryKey: ["/api/crm/preferences"] });
      const previousPrefs = queryClientRef.getQueryData<CrmCategoryPreferences>(["/api/crm/preferences"]);
      queryClientRef.setQueryData<CrmCategoryPreferences>(["/api/crm/preferences"], (old) => ({
        id: old?.id ?? '',
        userId: old?.userId ?? '',
        hideLeadsWithoutPhone: old?.hideLeadsWithoutPhone ?? false,
        categoryPipelineMappings: old?.categoryPipelineMappings ?? {},
        hotScoreThreshold: old?.hotScoreThreshold ?? 0,
        warmScoreThreshold: old?.warmScoreThreshold ?? 0,
        hiddenCategories: old?.hiddenCategories ?? [],
        columnOrder: newOrder,
        colorOverrides: old?.colorOverrides || {},
        columnSortPreferences: old?.columnSortPreferences || {},
      }));
      return { previousPrefs };
    },
    onError: (error: any, _variables, context) => {
      if (context?.previousPrefs) {
        queryClientRef.setQueryData(["/api/crm/preferences"], context.previousPrefs);
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
    onSettled: () => {
      queryClientRef.invalidateQueries({ queryKey: ["/api/crm/preferences"] });
    },
  });

  const updateColumnSortMutation = useMutation({
    mutationFn: async ({ categoryId, sortBy }: { categoryId: string; sortBy: 'newest' | 'oldest' | 'score-high' | 'score-low' }) => {
      return apiRequest("PATCH", `/api/crm/preferences/sort/${categoryId}`, { sortBy });
    },
    onSuccess: () => {
      queryClientRef.invalidateQueries({ queryKey: ["/api/crm/preferences"] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Filter settings mutation
  const updateFilterSettingsMutation = useMutation({
    mutationFn: async (settings: {
      hideLeadsWithoutPhone?: boolean;
      categoryPipelineMappings?: Record<string, string>;
      hotScoreThreshold?: number;
      warmScoreThreshold?: number;
      hiddenCategories?: string[];
    }) => {
      return apiRequest("PATCH", "/api/crm/preferences", settings);
    },
    onSuccess: () => {
      queryClientRef.invalidateQueries({ queryKey: ["/api/crm/preferences"] });
      queryClientRef.invalidateQueries({ queryKey: [aiKanbanUrl] });
      queryClientRef.invalidateQueries({ queryKey: [categoryCountsUrl] });
      queryClientRef.invalidateQueries({ queryKey: [categorizedLeadsUrl] });
      toast({ title: "Settings saved", description: "Your filter settings have been updated." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Lead AI category update mutation (for drag-and-drop)
  const updateLeadCategoryMutation = useMutation({
    mutationFn: async ({ leadId, aiCategory }: { leadId: string; aiCategory: AICategory }) => {
      return apiRequest("PATCH", `/api/crm/leads/${leadId}/ai-category`, { aiCategory });
    },
    onMutate: async ({ leadId, aiCategory }) => {
      // Cancel any outgoing refetches
      await queryClientRef.cancelQueries({ queryKey: [aiKanbanUrl] });
      
      // Snapshot the previous value
      const previousData = queryClientRef.getQueryData<AIKanbanResponse>([aiKanbanUrl]);
      
      // Optimistically update the cache
      if (previousData) {
        const newData = { ...previousData, columns: { ...previousData.columns } };
        let movedLead: Lead | undefined;
        
        // Find and remove the lead from its current category
        for (const categoryKey of Object.keys(newData.columns) as AICategory[]) {
          const column = newData.columns[categoryKey];
          if (column) {
            const leadIndex = column.leads.findIndex(l => l.id === leadId);
            if (leadIndex !== -1) {
              movedLead = column.leads[leadIndex];
              newData.columns[categoryKey] = {
                ...column,
                leads: column.leads.filter(l => l.id !== leadId),
                total: column.total - 1,
              };
              break;
            }
          }
        }
        
        // Add the lead to the target category
        if (movedLead && newData.columns[aiCategory]) {
          const updatedLead = { ...movedLead, aiCategory };
          newData.columns[aiCategory] = {
            ...newData.columns[aiCategory],
            leads: [updatedLead, ...newData.columns[aiCategory].leads],
            total: newData.columns[aiCategory].total + 1,
          };
        }
        
        queryClientRef.setQueryData([aiKanbanUrl], newData);
      }
      
      return { previousData };
    },
    onSuccess: () => {
      queryClientRef.invalidateQueries({ predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === 'string' && (
          key.includes('/api/crm/leads') || 
          key.includes('/api/crm/analytics')
        );
      }});
      toast({ title: "Lead moved" });
    },
    onError: (error: any, _variables, context) => {
      // Rollback on error
      if (context?.previousData) {
        queryClientRef.setQueryData([aiKanbanUrl], context.previousData);
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Handle lead drop on a category column
  const handleLeadDrop = (leadId: string, targetCategory: AICategory) => {
    updateLeadCategoryMutation.mutate({ leadId, aiCategory: targetCategory });
  };

  // Column drag-and-drop handlers
  const handleColumnDragStart = (e: React.DragEvent, categoryId: string) => {
    setDraggingColumnId(categoryId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', categoryId);
  };

  const handleColumnDragOver = (e: React.DragEvent, categoryId: string) => {
    e.preventDefault();
    if (draggingColumnId && draggingColumnId !== categoryId) {
      setDragOverColumnId(categoryId);
    }
  };

  const handleColumnDragLeave = () => {
    setDragOverColumnId(null);
  };

  const handleColumnDrop = (e: React.DragEvent, targetCategoryId: string) => {
    e.preventDefault();
    if (!draggingColumnId || draggingColumnId === targetCategoryId) {
      setDraggingColumnId(null);
      setDragOverColumnId(null);
      return;
    }

    const currentOrder = orderedCategories.map(c => c.id) as string[];
    const fromIndex = currentOrder.indexOf(draggingColumnId);
    const toIndex = currentOrder.indexOf(targetCategoryId);
    
    if (fromIndex !== -1 && toIndex !== -1) {
      const newOrder = [...currentOrder];
      newOrder.splice(fromIndex, 1);
      newOrder.splice(toIndex, 0, draggingColumnId);
      updateColumnOrderMutation.mutate(newOrder);
    }
    
    setDraggingColumnId(null);
    setDragOverColumnId(null);
  };

  const handleColumnDragEnd = () => {
    setDraggingColumnId(null);
    setDragOverColumnId(null);
  };

  const updateStageColorMutation = useMutation({
    mutationFn: async ({ stageId, color }: { stageId: string; color: string }) => {
      return apiRequest("PATCH", `/api/crm/stages/${stageId}`, { color });
    },
    onSuccess: () => {
      queryClientRef.invalidateQueries({ queryKey: ["/api/crm/stages"] });
      toast({ title: "Color updated" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const leadsQueryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (sourceFilter !== "all") {
      params.set("sourceType", sourceFilter);
    }
    if (selectedSourceId !== "all") {
      params.set("sourceId", selectedSourceId);
    }
    return params.toString();
  }, [sourceFilter, selectedSourceId]);

  const leadsUrl = leadsQueryParams ? `/api/crm/leads?${leadsQueryParams}` : "/api/crm/leads";
  
  const { data: leads = [], isLoading: leadsLoading } = useQuery<Lead[]>({
    queryKey: [leadsUrl],
  });

  // AI Category counts for the new CRM view
  const categoryCountsUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (sourceFilter !== "all") {
      params.set("sourceType", sourceFilter);
    }
    if (selectedSourceId !== "all") {
      params.set("sourceId", selectedSourceId);
    }
    return `/api/crm/leads/category-counts${params.toString() ? '?' + params.toString() : ''}`;
  }, [sourceFilter, selectedSourceId]);

  const { data: categoryCounts, isLoading: categoryCountsLoading } = useQuery<CategoryCounts>({
    queryKey: [categoryCountsUrl],
  });

  // AI Kanban query - fetch all 6 categories with leads for Kanban view
  const aiKanbanUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (sourceFilter !== "all") {
      params.set("sourceType", sourceFilter);
    }
    if (selectedSourceId !== "all") {
      params.set("sourceId", selectedSourceId);
    }
    params.set("limit", "20");
    return `/api/crm/leads/ai-kanban?${params.toString()}`;
  }, [sourceFilter, selectedSourceId]);

  const { data: aiKanbanData, isLoading: aiKanbanLoading } = useQuery<AIKanbanResponse>({
    queryKey: [aiKanbanUrl],
    enabled: viewMode === "kanban",
  });

  // Paginated categorized leads
  const categorizedLeadsUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (aiCategoryFilter !== "all") {
      params.set("aiCategory", aiCategoryFilter);
    }
    if (sourceFilter !== "all") {
      params.set("sourceType", sourceFilter);
    }
    if (selectedSourceId !== "all") {
      params.set("sourceId", selectedSourceId);
    }
    if (searchQuery) {
      params.set("search", searchQuery);
    }
    params.set("sortBy", sortBy);
    params.set("limit", LEADS_PER_PAGE.toString());
    params.set("offset", "0");
    return `/api/crm/leads/categorized?${params.toString()}`;
  }, [aiCategoryFilter, sourceFilter, selectedSourceId, searchQuery, sortBy, LEADS_PER_PAGE]);

  const { data: categorizedLeadsData, isLoading: categorizedLeadsLoading } = useQuery<PaginatedLeadsResponse>({
    queryKey: [categorizedLeadsUrl],
  });

  // Update loaded leads when data changes
  useEffect(() => {
    if (categorizedLeadsData) {
      setLoadedLeads(categorizedLeadsData.leads);
      setHasMore(categorizedLeadsData.hasMore);
      setTotalLeads(categorizedLeadsData.total);
    }
  }, [categorizedLeadsData]);

  // Load more function for infinite scroll
  const loadMoreMutation = useMutation({
    mutationFn: async () => {
      const params = new URLSearchParams();
      if (aiCategoryFilter !== "all") {
        params.set("aiCategory", aiCategoryFilter);
      }
      if (sourceFilter !== "all") {
        params.set("sourceType", sourceFilter);
      }
      if (selectedSourceId !== "all") {
        params.set("sourceId", selectedSourceId);
      }
      if (searchQuery) {
        params.set("search", searchQuery);
      }
      params.set("sortBy", sortBy);
      params.set("limit", LEADS_PER_PAGE.toString());
      params.set("offset", loadedLeads.length.toString());
      
      const response = await apiRequest("GET", `/api/crm/leads/categorized?${params.toString()}`);
      return response.json() as Promise<PaginatedLeadsResponse>;
    },
    onSuccess: (data) => {
      setLoadedLeads(prev => [...prev, ...data.leads]);
      setHasMore(data.hasMore);
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const loadMore = () => {
    if (!hasMore || loadMoreMutation.isPending) return;
    loadMoreMutation.mutate();
  };

  const { data: campaigns = [] } = useQuery<Campaign[]>({
    queryKey: ["/api/campaigns"],
  });

  const { data: incomingConnectionsResponse } = useQuery<{ connections: IncomingConnection[] }>({
    queryKey: ["/api/incoming-connections"],
  });
  const incomingConnections = incomingConnectionsResponse?.connections || [];

  // Backfill AI categories mutation
  const backfillCategoriesMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/crm/leads/backfill-categories");
      return response.json();
    },
    onSuccess: (data: { updated: number; total: number }) => {
      queryClientRef.invalidateQueries({ queryKey: [categoryCountsUrl] });
      queryClientRef.invalidateQueries({ queryKey: [aiKanbanUrl] });
      queryClientRef.invalidateQueries({ queryKey: [categorizedLeadsUrl] });
      toast({ 
        title: "Categories Updated", 
        description: `Categorized ${data.updated} of ${data.total} leads` 
      });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateLeadStageMutation = useMutation({
    mutationFn: async ({ leadId, stage, stageId }: { leadId: string; stage: string; stageId: string }) => {
      return apiRequest("PATCH", `/api/crm/leads/${leadId}`, { stage, stageId });
    },
    onSuccess: () => {
      queryClientRef.invalidateQueries({ queryKey: [leadsUrl] });
      toast({ title: "Lead moved" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const bulkUpdateCategoryMutation = useMutation({
    mutationFn: async ({ leadIds, aiCategory }: { leadIds: string[]; aiCategory: AICategory }) => {
      return apiRequest("POST", "/api/crm/leads/bulk/ai-category", { ids: leadIds, aiCategory });
    },
    onSuccess: (_, variables) => {
      queryClientRef.invalidateQueries({ predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === 'string' && (
          key.includes('/api/crm/leads') || 
          key.includes('/api/crm/analytics')
        );
      }});
      toast({ title: `${variables.leadIds.length} leads moved` });
      clearSelection();
      setBulkStageDialogOpen(false);
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const bulkAddTagMutation = useMutation({
    mutationFn: async ({ leadIds, tag }: { leadIds: string[]; tag: string }) => {
      return apiRequest("POST", "/api/crm/leads/bulk/tags", { ids: leadIds, tags: [tag] });
    },
    onSuccess: (_, variables) => {
      queryClientRef.invalidateQueries({ queryKey: [leadsUrl] });
      queryClientRef.invalidateQueries({ queryKey: ["/api/crm/tags"] });
      toast({ title: `Tag added to ${variables.leadIds.length} leads` });
      clearSelection();
      setBulkTagDialogOpen(false);
      setNewTagInput("");
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (leadIds: string[]) => {
      return apiRequest("POST", "/api/crm/leads/bulk/delete", { ids: leadIds });
    },
    onSuccess: (_, leadIds) => {
      queryClientRef.invalidateQueries({ queryKey: [leadsUrl] });
      toast({ title: `${leadIds.length} leads deleted` });
      clearSelection();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleExportCSV = async () => {
    try {
      const { AuthStorage } = await import("@/lib/auth-storage");
      const headers: Record<string, string> = {};
      const authHeader = AuthStorage.getAuthHeader();
      if (authHeader) {
        headers["Authorization"] = authHeader;
      }
      
      const response = await fetch("/api/crm/export/csv", {
        method: "GET",
        credentials: "include",
        headers,
      });
      if (!response.ok) {
        throw new Error("Export failed");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `leads-export-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast({ title: "Export complete" });
    } catch (error) {
      toast({ title: "Export failed", variant: "destructive" });
    }
  };

  const filteredLeads = useMemo(() => {
    let result = [...leads];

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(lead => 
        lead.phone.toLowerCase().includes(query) ||
        (lead.firstName?.toLowerCase().includes(query)) ||
        (lead.lastName?.toLowerCase().includes(query)) ||
        (lead.email?.toLowerCase().includes(query)) ||
        (lead.tags?.some(tag => tag.toLowerCase().includes(query)))
      );
    }

    // Filter by tag
    if (tagFilter !== "all") {
      result = result.filter(lead => lead.tags?.includes(tagFilter));
    }

    if (sourceFilter === "campaign") {
      result = result.filter(lead => lead.sourceType === "campaign");
      if (selectedSourceId !== "all") {
        result = result.filter(lead => lead.campaignId === selectedSourceId);
      }
    } else if (sourceFilter === "incoming") {
      result = result.filter(lead => lead.sourceType === "incoming");
      if (selectedSourceId !== "all") {
        result = result.filter(lead => lead.incomingConnectionId === selectedSourceId);
      }
    }

    if (sortBy === "newest") {
      result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } else if (sortBy === "oldest") {
      result.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    } else if (sortBy === "score-high") {
      result.sort((a, b) => (b.leadScore || 0) - (a.leadScore || 0));
    } else if (sortBy === "score-low") {
      result.sort((a, b) => (a.leadScore || 0) - (b.leadScore || 0));
    }

    return result;
  }, [leads, searchQuery, sourceFilter, selectedSourceId, sortBy, tagFilter]);

  const leadsByStage = useMemo(() => {
    const result: Record<string, Lead[]> = {};
    stages.forEach(stage => {
      const stageSlug = stage.name.toLowerCase().replace(/\s+/g, "_").replace(/_lead$/, "").replace(/_booked$/, "").replace(/^needs_/, "");
      let stageLeads = filteredLeads.filter(lead => {
        const leadStageSlug = lead.stage.toLowerCase().replace(/\s+/g, "_");
        return lead.stageId === stage.id || leadStageSlug === stageSlug || lead.stage === stage.name;
      });
      
      const columnSort = columnSorts[stage.id];
      if (columnSort === "score") {
        stageLeads.sort((a, b) => (b.leadScore || 0) - (a.leadScore || 0));
      } else if (columnSort === "date") {
        stageLeads.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      }
      
      result[stage.id] = stageLeads;
    });
    return result;
  }, [stages, filteredLeads, columnSorts]);

  const sortedStages = useMemo(() => {
    return [...stages].sort((a, b) => a.order - b.order);
  }, [stages]);

  const handleDrop = (leadId: string, newStage: string, newStageId: string) => {
    updateLeadStageMutation.mutate({ leadId, stage: newStage, stageId: newStageId });
  };

  const handleColumnSort = (stageId: string, sortType: "score" | "date") => {
    setColumnSorts(prev => ({ ...prev, [stageId]: sortType }));
    toast({ title: `Sorted by ${sortType === "score" ? "score" : "date"}` });
  };

  const totalPages = Math.max(1, Math.ceil(filteredLeads.length / LEADS_PER_PAGE));
  
  useEffect(() => {
    if (listPage > totalPages) {
      setListPage(totalPages);
    }
  }, [totalPages, listPage]);

  useEffect(() => {
    setListPage(1);
  }, [searchQuery, sourceFilter, selectedSourceId]);

  const paginatedLeads = useMemo(() => {
    const startIndex = (listPage - 1) * LEADS_PER_PAGE;
    return filteredLeads.slice(startIndex, startIndex + LEADS_PER_PAGE);
  }, [filteredLeads, listPage, LEADS_PER_PAGE]);

  const isLoading = stagesLoading || leadsLoading;

  return (
    <div className="flex flex-col h-full bg-background" data-testid="crm-page">
      <div className="bg-gradient-to-r from-primary/5 via-primary/3 to-transparent border-b">
        <div className="px-6 py-4 space-y-4">
          {/* Header Row - Title and Actions */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-primary/10">
                <Zap className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-semibold">Qualified Leads</h1>
                <p className="text-sm text-muted-foreground">
                  View and manage AI-categorized leads
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleExportCSV} 
                data-testid="export-leads"
              >
                <Download className="w-4 h-4 mr-1.5" />
                Export
              </Button>

              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setFilterSettingsOpen(true)} 
                data-testid="open-filter-settings"
              >
                <Settings className="w-4 h-4 mr-1.5" />
                Settings
              </Button>
            </div>
          </div>

          {/* Stats Cards Row - Lead Counts by Category */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {/* All Leads Card */}
            <Card 
              className={`cursor-pointer transition-all hover-elevate ${aiCategoryFilter === "all" ? "ring-2 ring-primary bg-primary/5" : "bg-card/50"}`}
              onClick={() => setAiCategoryFilter("all")}
              data-testid="filter-all"
            >
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Zap className="w-4 h-4 text-primary" />
                  <span className="text-2xl font-bold">{categoryCounts?.total || 0}</span>
                </div>
                <p className="text-xs text-muted-foreground">All Leads</p>
              </CardContent>
            </Card>

            {/* Category Cards */}
            {orderedCategories.map((cat) => {
              const Icon = cat.icon;
              const count = categoryCounts?.counts?.[cat.id] || 0;
              const isSelected = aiCategoryFilter === cat.id;
              return (
                <Card 
                  key={cat.id}
                  className={`cursor-pointer transition-all hover-elevate ${isSelected ? "ring-2 ring-primary" : "bg-card/50"}`}
                  onClick={() => setAiCategoryFilter(cat.id)}
                  data-testid={`filter-${cat.id}`}
                  style={isSelected ? { backgroundColor: `${cat.color}15` } : undefined}
                >
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className="w-4 h-4" style={{ color: cat.color }} />
                      <span className="text-2xl font-bold">{count}</span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{cat.label}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 px-6 py-3 border-b bg-muted/30">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search leads by name, phone, email, or tag..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-background"
            data-testid="search-leads-input"
          />
        </div>
        
        <Select value={sourceFilter} onValueChange={(v) => { setSourceFilter(v); setSelectedSourceId("all"); }}>
          <SelectTrigger className="w-40 bg-background" data-testid="source-filter">
            <SelectValue placeholder="All Sources" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            <SelectItem value="campaign">Campaigns</SelectItem>
            <SelectItem value="incoming">Incoming</SelectItem>
          </SelectContent>
        </Select>

        {sourceFilter === "campaign" && campaigns.length > 0 && (
          <Select value={selectedSourceId} onValueChange={setSelectedSourceId}>
            <SelectTrigger className="w-52 bg-background" data-testid="campaign-filter">
              <SelectValue placeholder="All Campaigns" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Campaigns</SelectItem>
              {campaigns.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {sourceFilter === "incoming" && incomingConnections.length > 0 && (
          <Select value={selectedSourceId} onValueChange={setSelectedSourceId}>
            <SelectTrigger className="w-52 bg-background" data-testid="incoming-filter">
              <SelectValue placeholder="All Connections" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Connections</SelectItem>
              {incomingConnections.map(c => (
                <SelectItem key={c.id} value={c.id}>Connection {c.id.slice(0, 8)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {allTags.length > 0 && (
          <Select value={tagFilter} onValueChange={setTagFilter}>
            <SelectTrigger className="w-40 bg-background" data-testid="tag-filter">
              <Tag className="w-4 h-4 mr-2" />
              <SelectValue placeholder="All Tags" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Tags</SelectItem>
              {allTags.map(tag => (
                <SelectItem key={tag} value={tag}>{tag}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                disabled={backfillCategoriesMutation.isPending}
                data-testid="refresh-leads"
                title="Refresh Options"
              >
                <RefreshCw className={`w-4 h-4 ${backfillCategoriesMutation.isPending ? 'animate-spin' : ''}`} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem 
                onClick={() => {
                  queryClientRef.invalidateQueries({ predicate: (query) => {
                    const key = query.queryKey[0];
                    if (typeof key !== 'string') return false;
                    return key.startsWith('/api/crm/leads/');
                  }});
                }}
                data-testid="quick-refresh"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Quick Refresh
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => backfillCategoriesMutation.mutate()}
                data-testid="recategorize-leads"
              >
                <Zap className="w-4 h-4 mr-2" />
                Recategorize All
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          
          <div className="h-6 w-px bg-border mx-1" />
          
          <div className="flex items-center rounded-lg border bg-background p-1 gap-1">
            <Button
              variant={viewMode === "kanban" ? "secondary" : "ghost"}
              size="icon"
              onClick={() => setViewMode("kanban")}
              data-testid="view-kanban"
              title="Kanban View"
            >
              <LayoutGrid className="w-4 h-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="icon"
              onClick={() => setViewMode("list")}
              data-testid="view-list"
              title="List View"
            >
              <List className="w-4 h-4" />
            </Button>
            <Button
              variant={viewMode === "analytics" ? "secondary" : "ghost"}
              size="icon"
              onClick={() => setViewMode("analytics")}
              data-testid="view-analytics"
              title="Analytics View"
            >
              <BarChart3 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {selectedLeadIds.size > 0 && (
        <div className="flex items-center gap-3 px-6 py-2 border-b bg-primary/5">
          <div className="flex items-center gap-2">
            <Checkbox
              checked={selectedLeadIds.size === filteredLeads.length && filteredLeads.length > 0}
              onCheckedChange={selectAllLeads}
              data-testid="select-all-leads"
            />
            <span className="text-sm font-medium">{selectedLeadIds.size} selected</span>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBulkStageDialogOpen(true)}
              data-testid="bulk-change-stage"
            >
              <ArrowRightLeft className="w-4 h-4 mr-2" />
              Move to Category
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBulkTagDialogOpen(true)}
              data-testid="bulk-add-tag"
            >
              <Tag className="w-4 h-4 mr-2" />
              Add Tag
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (confirm(`Delete ${selectedLeadIds.size} leads?`)) {
                  bulkDeleteMutation.mutate(Array.from(selectedLeadIds));
                }
              }}
              className="text-destructive hover:text-destructive"
              data-testid="bulk-delete"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearSelection}
              data-testid="clear-selection"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      <Dialog open={bulkStageDialogOpen} onOpenChange={setBulkStageDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move {selectedLeadIds.size} Leads to Category</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2 py-4">
            {AI_CATEGORIES.map(cat => {
              const Icon = cat.icon;
              return (
                <Button
                  key={cat.id}
                  variant="outline"
                  className="justify-start"
                  onClick={() => bulkUpdateCategoryMutation.mutate({
                    leadIds: Array.from(selectedLeadIds),
                    aiCategory: cat.id,
                  })}
                  disabled={bulkUpdateCategoryMutation.isPending}
                  data-testid={`bulk-category-${cat.id}`}
                >
                  <Icon className="w-4 h-4 mr-2" style={{ color: cat.color }} />
                  {cat.label}
                </Button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkTagDialogOpen} onOpenChange={setBulkTagDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Tag to {selectedLeadIds.size} Leads</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex gap-2">
              <Input
                placeholder="Enter new tag..."
                value={newTagInput}
                onChange={(e) => setNewTagInput(e.target.value)}
                data-testid="new-tag-input"
              />
              <Button
                onClick={() => newTagInput.trim() && bulkAddTagMutation.mutate({
                  leadIds: Array.from(selectedLeadIds),
                  tag: newTagInput.trim()
                })}
                disabled={!newTagInput.trim() || bulkAddTagMutation.isPending}
                data-testid="add-new-tag"
              >
                Add
              </Button>
            </div>
            {allTags.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Or select existing tag:</p>
                <div className="flex flex-wrap gap-2">
                  {allTags.map(tag => (
                    <Badge
                      key={tag}
                      variant="outline"
                      className="cursor-pointer hover-elevate"
                      onClick={() => bulkAddTagMutation.mutate({
                        leadIds: Array.from(selectedLeadIds),
                        tag
                      })}
                      data-testid={`existing-tag-${tag}`}
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : viewMode === "analytics" ? (
          <ScrollArea className="h-full">
            <div className="p-6 space-y-6" data-testid="analytics-view">
              {analyticsLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
              ) : analytics ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Card>
                      <CardContent className="p-4">
                        <p className="text-sm text-muted-foreground">Total Leads</p>
                        <p className="text-2xl font-bold" data-testid="analytics-total-leads">{analytics.totalLeads}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-4">
                        <p className="text-sm text-muted-foreground">Avg. Lead Score</p>
                        <p className="text-2xl font-bold" data-testid="analytics-avg-score">{analytics.avgLeadScore?.toFixed(1) || '--'}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-4">
                        <p className="text-sm text-muted-foreground">From Campaigns</p>
                        <p className="text-2xl font-bold" data-testid="analytics-campaign-leads">
                          {analytics.leadsBySource?.find(s => s.sourceType === 'campaign')?.count || 0}
                        </p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-4">
                        <p className="text-sm text-muted-foreground">From Incoming</p>
                        <p className="text-2xl font-bold" data-testid="analytics-incoming-leads">
                          {analytics.leadsBySource?.find(s => s.sourceType === 'incoming')?.count || 0}
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Leads by Category</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          {analytics.leadsByCategory?.map((item, index) => {
                            const cat = AI_CATEGORIES.find(c => c.id === item.category);
                            const Icon = cat?.icon;
                            return (
                              <div key={index} className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  {Icon && <Icon className="w-4 h-4" style={{ color: cat?.color }} />}
                                  <span className="text-sm">{cat?.label || item.category}</span>
                                </div>
                                <Badge variant="secondary">{item.count}</Badge>
                              </div>
                            );
                          }) || <p className="text-sm text-muted-foreground">No data</p>}
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Sentiment Breakdown</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          {analytics.sentimentBreakdown?.map((item, index) => (
                            <div key={index} className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                {item.sentiment === 'positive' && <TrendingUp className="w-4 h-4 text-emerald-500" />}
                                {item.sentiment === 'negative' && <TrendingDown className="w-4 h-4 text-rose-500" />}
                                {item.sentiment === 'neutral' && <Minus className="w-4 h-4 text-muted-foreground" />}
                                <span className="text-sm capitalize">{item.sentiment || 'Unknown'}</span>
                              </div>
                              <Badge variant="secondary">{item.count}</Badge>
                            </div>
                          )) || <p className="text-sm text-muted-foreground">No data</p>}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-20">
                  <BarChart3 className="w-12 h-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Analytics data not available</p>
                </div>
              )}
            </div>
          </ScrollArea>
        ) : viewMode === "kanban" ? (
          <div className="flex gap-4 p-6 overflow-x-auto h-full">
            {aiKanbanLoading || preferencesLoading ? (
              <div className="flex items-center justify-center w-full py-20">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : aiKanbanData ? (
              <>
                {orderedCategories.map((cat) => {
                  const columnData = aiKanbanData.columns?.[cat.id];
                  const isHighlighted = aiCategoryFilter === "all" || aiCategoryFilter === cat.id;
                  const columnSort = categoryPreferences?.columnSortPreferences?.[cat.id];
                  
                  // Apply client-side filtering for search and tags
                  let columnLeads = [...(columnData?.leads || [])];
                  
                  // Filter by search query
                  if (searchQuery) {
                    const query = searchQuery.toLowerCase();
                    columnLeads = columnLeads.filter(lead => {
                      const phone = lead.phone?.toLowerCase() || '';
                      const firstName = lead.firstName?.toLowerCase() || '';
                      const lastName = lead.lastName?.toLowerCase() || '';
                      const email = lead.email?.toLowerCase() || '';
                      return phone.includes(query) ||
                        firstName.includes(query) ||
                        lastName.includes(query) ||
                        email.includes(query) ||
                        (lead.tags?.some(tag => tag.toLowerCase().includes(query)) ?? false);
                    });
                  }
                  
                  // Filter by tag
                  if (tagFilter !== "all") {
                    columnLeads = columnLeads.filter(lead => lead.tags?.includes(tagFilter));
                  }
                  
                  // Apply client-side sorting based on saved preference
                  switch (columnSort) {
                    case 'oldest':
                      columnLeads.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
                      break;
                    case 'score-high':
                      columnLeads.sort((a, b) => (b.leadScore || 0) - (a.leadScore || 0));
                      break;
                    case 'score-low':
                      columnLeads.sort((a, b) => (a.leadScore || 0) - (b.leadScore || 0));
                      break;
                    case 'newest':
                    default:
                      columnLeads.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
                      break;
                  }
                  
                  return (
                    <AIKanbanColumn
                      key={cat.id}
                      category={{ id: cat.id, label: cat.label, color: cat.color }}
                      leads={columnLeads}
                      total={columnData?.total || 0}
                      onLeadClick={setSelectedLead}
                      selectedLeadIds={selectedLeadIds}
                      onToggleSelect={toggleLeadSelection}
                      highlighted={isHighlighted}
                      sortBy={columnSort}
                      onSortChange={(sortBy) => updateColumnSortMutation.mutate({ categoryId: cat.id, sortBy })}
                      onColorChange={(color) => updateCategoryColorMutation.mutate({ categoryId: cat.id, color })}
                      onLeadDrop={handleLeadDrop}
                      isDragging={draggingColumnId === cat.id}
                      isDragOver={dragOverColumnId === cat.id}
                      onDragStart={(e) => handleColumnDragStart(e, cat.id)}
                      onDragOver={(e) => handleColumnDragOver(e, cat.id)}
                      onDragLeave={handleColumnDragLeave}
                      onDrop={(e) => handleColumnDrop(e, cat.id)}
                      onDragEnd={handleColumnDragEnd}
                    />
                  );
                })}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center w-full py-20">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                  <Zap className="w-8 h-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-medium mb-2">No Qualified Leads</h3>
                <p className="text-muted-foreground text-center max-w-md">
                  Leads will appear here when they're categorized by AI during calls.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col h-full">
            <ScrollArea className="flex-1">
              <div className="p-6 space-y-3">
                {paginatedLeads.map(lead => {
                  const leadStage = stages.find(s => s.id === lead.stageId);
                  return (
                    <ListViewCard 
                      key={lead.id} 
                      lead={lead} 
                      onClick={() => setSelectedLead(lead)} 
                      stageColor={leadStage?.color}
                      isSelected={selectedLeadIds.has(lead.id)}
                      onToggleSelect={toggleLeadSelection}
                    />
                  );
                })}
                {filteredLeads.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-20">
                    <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                      <Users className="w-8 h-8 text-muted-foreground" />
                    </div>
                    <h3 className="text-lg font-medium mb-2">No Leads Found</h3>
                    <p className="text-muted-foreground text-center max-w-md">
                      {searchQuery ? "Try adjusting your search criteria." : "Leads will appear here as campaigns run or calls come in."}
                    </p>
                  </div>
                )}
              </div>
            </ScrollArea>
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-3 border-t bg-card" data-testid="pagination-controls">
                <span className="text-sm text-muted-foreground">
                  Showing {(listPage - 1) * LEADS_PER_PAGE + 1}-{Math.min(listPage * LEADS_PER_PAGE, filteredLeads.length)} of {filteredLeads.length} leads
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setListPage(p => Math.max(1, p - 1))}
                    disabled={listPage === 1}
                    data-testid="pagination-prev"
                  >
                    Previous
                  </Button>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      let pageNum;
                      if (totalPages <= 5) {
                        pageNum = i + 1;
                      } else if (listPage <= 3) {
                        pageNum = i + 1;
                      } else if (listPage >= totalPages - 2) {
                        pageNum = totalPages - 4 + i;
                      } else {
                        pageNum = listPage - 2 + i;
                      }
                      return (
                        <Button
                          key={pageNum}
                          variant={listPage === pageNum ? "secondary" : "ghost"}
                          size="sm"
                          className="w-8 h-8 p-0"
                          onClick={() => setListPage(pageNum)}
                          data-testid={`pagination-page-${pageNum}`}
                        >
                          {pageNum}
                        </Button>
                      );
                    })}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setListPage(p => Math.min(totalPages, p + 1))}
                    disabled={listPage === totalPages}
                    data-testid="pagination-next"
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <LeadDetailModal 
        lead={selectedLead} 
        open={!!selectedLead} 
        onClose={() => setSelectedLead(null)}
        stageColor={selectedLead ? stages.find(s => s.id === selectedLead.stageId)?.color : undefined}
      />

      <Dialog open={colorSettingsOpen} onOpenChange={setColorSettingsOpen}>
        <DialogContent className="max-w-md" data-testid="color-settings-modal">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Palette className="w-5 h-5" />
              Pipeline Stage Colors
            </DialogTitle>
            <DialogDescription>
              Choose a color for each stage. The color will be used for the column header gradient.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {sortedStages.map((stage) => (
              <div key={stage.id} className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 flex-1">
                  <div 
                    className="w-4 h-4 rounded-full border"
                    style={{ backgroundColor: stage.color }}
                  />
                  <span className="text-sm font-medium">{stage.name.replace(/_/g, " ")}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1 max-w-[200px] justify-end">
                  {COLOR_PRESETS.map((preset) => (
                    <button
                      key={preset.hex}
                      className={`w-6 h-6 rounded-full border-2 transition-all flex items-center justify-center ${
                        stage.color.toLowerCase() === preset.hex.toLowerCase() 
                          ? "border-foreground scale-110" 
                          : "border-transparent hover:scale-105"
                      }`}
                      style={{ backgroundColor: preset.hex }}
                      onClick={() => updateStageColorMutation.mutate({ stageId: stage.id, color: preset.hex })}
                      title={preset.name}
                      data-testid={`color-${stage.id}-${preset.name.toLowerCase()}`}
                    >
                      {stage.color.toLowerCase() === preset.hex.toLowerCase() && (
                        <Check className="w-3 h-3 text-white" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setColorSettingsOpen(false)} data-testid="close-color-settings">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CRM Filter Settings Dialog */}
      <CRMFilterSettingsDialog
        open={filterSettingsOpen}
        onOpenChange={setFilterSettingsOpen}
        categoryPreferences={categoryPreferences}
        stages={stages}
        onSave={(settings) => updateFilterSettingsMutation.mutate(settings)}
        isSaving={updateFilterSettingsMutation.isPending}
      />
    </div>
  );
}
