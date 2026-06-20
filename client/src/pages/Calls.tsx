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
import { useState, useRef, useEffect } from "react";
import { useTranslation } from 'react-i18next';
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataPagination, usePagination } from "@/components/ui/data-pagination";
import { Search, Download, Loader2, Phone, Calendar, Clock, MessageSquare, Eye, Play, Pause, Volume2, PhoneIncoming, PhoneOutgoing, CheckCircle2, XCircle, Mic, FileText, Sparkles, Globe } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format, formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { AuthStorage } from "@/lib/auth-storage";
import { formatSipEndpoint } from "@/lib/formatters";

interface Call {
  id: string;
  contactId: string | null;
  campaignId: string | null;
  phoneNumber?: string | null;
  fromNumber?: string | null;
  toNumber?: string | null;
  status: string;
  duration: number | null;
  classification: string | null;
  sentiment: string | null;
  recordingUrl: string | null;
  transcript: string | null;
  aiSummary: string | null;
  metadata: Record<string, any> | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  callDirection: string | null;
  elevenLabsConversationId?: string | null;
  campaign?: { id: string; name: string } | null;
  contact?: { id: string; firstName: string; lastName?: string; phone: string } | null;
  incomingConnection?: { id: string; agentId: string } | null;
  engine?: 'elevenlabs' | 'twilio-openai' | 'plivo-openai' | 'openai';
  agent?: { id: string; name: string } | null;
  widgetId?: string | null;
  widget?: { id: string; name: string } | null;
  twilioSid?: string | null;
  plivoCallUuid?: string | null;
}

export default function Calls() {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sentimentFilter, setSentimentFilter] = useState("all");
  const [directionFilter, setDirectionFilter] = useState("all");
  const [leadFilter, setLeadFilter] = useState("all");
  const [playingCallId, setPlayingCallId] = useState<string | null>(null);
  const [loadingRecording, setLoadingRecording] = useState<string | null>(null);
  const [unavailableRecordingIds, setUnavailableRecordingIds] = useState<Set<string>>(new Set());
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentPlayingIdRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const { data: calls, isLoading } = useQuery<Call[]>({
    queryKey: ["/api/calls"],
  });

  const handleExportCsv = () => {
    if (!calls || calls.length === 0) {
      toast({
        title: t('common.noData'),
        description: t('calls.noCallsToExport'),
        variant: "destructive",
      });
      return;
    }

    // Build CSV content
    const headers = [
      'ID',
      'Phone Number',
      'Contact Name',
      'Status',
      'Direction',
      'Duration (seconds)',
      'Classification',
      'Sentiment',
      'Campaign',
      'Agent',
      'Engine',
      'Created At'
    ];

    const rows = calls.map(call => {
      const contactName = call.contact 
        ? `${call.contact.firstName} ${call.contact.lastName || ''}`.trim()
        : '';
      const phoneNumber = call.phoneNumber || call.fromNumber || call.toNumber || '';
      
      return [
        call.id,
        phoneNumber,
        contactName,
        call.status,
        call.callDirection || 'outgoing',
        call.duration?.toString() || '0',
        call.classification || '',
        call.sentiment || '',
        call.campaign?.name || '',
        call.agent?.name || '',
        call.engine || 'elevenlabs',
        call.createdAt
      ];
    });

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    // Create and download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `calls_export_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast({
      title: t('common.exportSuccess'),
      description: t('calls.exportedCalls', { count: calls.length }),
    });
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20">{t('calls.status.completed')}</Badge>;
      case "failed":
        return <Badge className="bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20">{t('calls.status.failed')}</Badge>;
      case "credit_failed":
        return (
          <Badge
            className="bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20 gap-1"
            data-testid="badge-credit-failed"
          >
            <XCircle className="h-3 w-3" />
            Not Billed - Low Credits
          </Badge>
        );
      case "in_progress":
      case "in-progress":
        return <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20">{t('calls.status.inProgress')}</Badge>;
      case "ended":
        return <Badge className="bg-slate-500/10 text-slate-700 dark:text-slate-400 border-slate-500/20">{t('calls.status.ended')}</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getSentimentBadge = (sentiment: string | null) => {
    if (!sentiment) return null;
    switch (sentiment) {
      case "positive":
        return <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20">{t('calls.sentiment.positive')}</Badge>;
      case "negative":
        return <Badge className="bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20">{t('calls.sentiment.negative')}</Badge>;
      case "neutral":
        return <Badge className="bg-slate-500/10 text-slate-700 dark:text-slate-400 border-slate-500/20">{t('calls.sentiment.neutral')}</Badge>;
      default:
        return <Badge variant="outline">{sentiment}</Badge>;
    }
  };

  const getClassificationBadge = (classification: string | null) => {
    if (!classification) return null;
    switch (classification) {
      case "hot":
        return <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20">{t('calls.classification.hot')}</Badge>;
      case "warm":
        return <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20">{t('calls.classification.warm')}</Badge>;
      case "cold":
        return <Badge className="bg-slate-500/10 text-slate-700 dark:text-slate-400 border-slate-500/20">{t('calls.classification.cold')}</Badge>;
      case "lost":
        return <Badge className="bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20">{t('calls.classification.lost')}</Badge>;
      case "completed_successful":
        return <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20">{t('calls.classification.successful')}</Badge>;
      case "completed_failed":
        return <Badge className="bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20">{t('calls.status.failed')}</Badge>;
      case "completed":
        return <Badge className="bg-slate-500/10 text-slate-700 dark:text-slate-400 border-slate-500/20">{t('calls.status.completed')}</Badge>;
      default:
        return <Badge variant="outline">{classification}</Badge>;
    }
  };

  const getEngineBadge = (engine?: string) => {
    if (engine === 'twilio-openai') {
      return <Badge className="bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20">Twilio+OpenAI</Badge>;
    }
    if (engine === 'plivo-openai') {
      return <Badge className="bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20">Plivo+OpenAI</Badge>;
    }
    if (engine === 'openai') {
      return <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20">OpenAI</Badge>;
    }
    return <Badge className="bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20">ElevenLabs</Badge>;
  };

  const getWidgetBadge = (call: Call) => {
    if (!call.widgetId) return null;
    return (
      <Badge className="bg-brand/10 text-brand border-brand/20 gap-1">
        <Globe className="h-3 w-3" />
        {call.widget?.name || 'Widget'}
      </Badge>
    );
  };

  const formatRelativeTime = (dateString: string | null) => {
    if (!dateString) return null;
    try {
      return formatDistanceToNow(new Date(dateString), { addSuffix: true });
    } catch {
      return null;
    }
  };

  const hasRecording = (call: Call) => {
    if (unavailableRecordingIds.has(call.id)) return false;
    // Calls that never connected or have no audio content
    if (['pending', 'failed', 'no-answer', 'initiated', 'ringing'].includes(call.status)) return false;
    if (!call.duration || call.duration === 0) return false;
    if (call.recordingUrl || call.elevenLabsConversationId) return true;
    if (call.engine === 'twilio-openai' && call.twilioSid) return true;
    if (call.engine === 'plivo-openai' && (call.plivoCallUuid || call.recordingUrl)) return true;
    return false;
  };

  const isOpenAIEngine = (call: Call) => {
    return call.engine === 'openai';
  };

  const handlePlayRecording = async (e: React.MouseEvent, call: Call) => {
    e.stopPropagation();
    
    if (playingCallId === call.id) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setPlayingCallId(null);
      currentPlayingIdRef.current = null;
      return;
    }
    
    if (audioRef.current) {
      audioRef.current.pause();
    }
    
    currentPlayingIdRef.current = call.id;
    setLoadingRecording(call.id);
    
    try {
      const headers: Record<string, string> = {};
      const authHeader = AuthStorage.getAuthHeader();
      if (authHeader) {
        headers["Authorization"] = authHeader;
      }
      
      const response = await fetch(`/api/calls/${call.id}/recording`, {
        headers,
        credentials: "include",
      });
      
      if (currentPlayingIdRef.current !== call.id) {
        return;
      }
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to fetch recording");
      }
      
      const blob = await response.blob();
      
      if (currentPlayingIdRef.current !== call.id) {
        return;
      }
      
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      
      if (currentPlayingIdRef.current !== call.id) {
        URL.revokeObjectURL(audioUrl);
        return;
      }
      
      audioRef.current = audio;
      setPlayingCallId(call.id);
      setLoadingRecording(null);
      
      audio.onended = () => {
        if (currentPlayingIdRef.current === call.id) {
          setPlayingCallId(null);
          audioRef.current = null;
        }
        URL.revokeObjectURL(audioUrl);
      };
      
      audio.onerror = () => {
        if (currentPlayingIdRef.current === call.id) {
          setPlayingCallId(null);
          audioRef.current = null;
        }
        toast({
          title: "Playback Error",
          description: "Unable to play this recording.",
          variant: "destructive",
        });
      };
      
      await audio.play();
    } catch (error: any) {
      if (currentPlayingIdRef.current === call.id) {
        setLoadingRecording(null);
        setPlayingCallId(null);
        setUnavailableRecordingIds(prev => new Set([...prev, call.id]));
      }
      toast({
        title: "Recording Unavailable",
        description: error.message || "No recording found for this call.",
        variant: "destructive",
      });
    }
  };

  const getDirectionIcon = (direction: string | null) => {
    if (direction === 'incoming') {
      return <PhoneIncoming className="h-4 w-4 text-emerald-500" />;
    }
    return <PhoneOutgoing className="h-4 w-4 text-blue-500" />;
  };

  const filteredCalls = (calls || []).filter((call) => {
    const contactFullName = call.contact ? `${call.contact.firstName} ${call.contact.lastName || ""}`.toLowerCase() : "";
    const matchesSearch = 
      searchQuery === "" || 
      contactFullName.includes(searchQuery.toLowerCase()) ||
      call.contact?.phone?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      call.phoneNumber?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      call.transcript?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      call.aiSummary?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      call.id.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === "all" || call.status === statusFilter;
    const matchesSentiment = sentimentFilter === "all" || call.sentiment === sentimentFilter;
    const matchesDirection = directionFilter === "all" || call.callDirection === directionFilter;
    const matchesLead = leadFilter === "all" || call.classification === leadFilter;
    
    return matchesSearch && matchesStatus && matchesSentiment && matchesDirection && matchesLead;
  });

  const callsWithTranscripts = filteredCalls.filter(call => call.transcript);
  const callsWithRecordings = filteredCalls.filter(call => hasRecording(call));

  const allPagination = usePagination(filteredCalls, 10);
  const transcribedPagination = usePagination(callsWithTranscripts, 10);
  const recordingsPagination = usePagination(callsWithRecordings, 10);

  const totalCalls = calls?.length || 0;
  const completedCalls = calls?.filter(c => c.status === 'completed').length || 0;
  const incomingCalls = calls?.filter(c => c.callDirection === 'incoming').length || 0;
  const outgoingCalls = calls?.filter(c => c.callDirection === 'outgoing').length || 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const renderCallCard = (call: Call, testIdPrefix: string = "") => (
    <div 
      key={call.id}
      className="group bg-card border rounded-lg overflow-hidden hover:shadow-lg transition-all duration-200 cursor-pointer"
      onClick={() => setLocation(`/app/calls/${call.id}`)}
      data-testid={`card-call-${testIdPrefix}${call.id}`}
    >
      <div className="flex">
        <div className={`w-1 ${call.status === 'completed' ? 'bg-emerald-500' : (call.status === 'failed' || call.status === 'credit_failed') ? 'bg-rose-500' : 'bg-amber-500'}`} />
        
        <div className="flex-1 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className={`flex-shrink-0 h-10 w-10 rounded-full flex items-center justify-center ${
                call.callDirection === 'incoming' 
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' 
                  : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
              }`}>
                {getDirectionIcon(call.callDirection)}
              </div>
              
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-foreground truncate">
                    {(() => {
                      // Widget calls: show widget name or "Website Widget"
                      if (call.widgetId) {
                        return call.widget?.name || (call.metadata as any)?.widgetName || 'Website Widget';
                      }
                      const hasContactName = call.contact?.firstName && call.contact.firstName.toLowerCase() !== 'unknown';
                      if (hasContactName) {
                        return `${call.contact!.firstName} ${call.contact!.lastName || ""}`.trim();
                      }
                      if (call.callDirection === 'incoming') {
                        return formatSipEndpoint(call.fromNumber, call.engine) || call.contact?.phone || call.phoneNumber || `Call ${call.id.slice(0, 8)}`;
                      }
                      return formatSipEndpoint(call.toNumber, call.engine) || call.contact?.phone || call.phoneNumber || `Call ${call.id.slice(0, 8)}`;
                    })()}
                  </h3>
                  {getEngineBadge(call.engine)}
                  {getWidgetBadge(call)}
                  {getStatusBadge(call.status)}
                  {getSentimentBadge(call.sentiment)}
                  {getClassificationBadge(call.classification)}
                </div>
                
                <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground flex-wrap">
                  {call.callDirection === 'incoming' ? (
                    <>
                      {call.fromNumber && (
                        <span className="font-mono text-xs flex items-center gap-1">
                          <span className="text-muted-foreground/70">From:</span> {formatSipEndpoint(call.fromNumber, call.engine)}
                        </span>
                      )}
                      {call.toNumber && (
                        <span className="font-mono text-xs flex items-center gap-1">
                          <span className="text-muted-foreground/70">To:</span> {formatSipEndpoint(call.toNumber, call.engine)}
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      {call.toNumber && (
                        <span className="font-mono text-xs flex items-center gap-1">
                          <span className="text-muted-foreground/70">To:</span> {formatSipEndpoint(call.toNumber, call.engine)}
                        </span>
                      )}
                      {call.fromNumber && (
                        <span className="font-mono text-xs flex items-center gap-1">
                          <span className="text-muted-foreground/70">From:</span> {formatSipEndpoint(call.fromNumber, call.engine)}
                        </span>
                      )}
                    </>
                  )}
                  {call.campaign && (
                    <span className="truncate max-w-[150px]">{call.campaign.name}</span>
                  )}
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-2 flex-shrink-0">
              {hasRecording(call) && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-full"
                  onClick={(e) => handlePlayRecording(e, call)}
                  disabled={loadingRecording === call.id}
                  data-testid={`button-play-${testIdPrefix}${call.id}`}
                >
                  {loadingRecording === call.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : playingCallId === call.id ? (
                    <Pause className="h-4 w-4 text-primary" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                </Button>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-4 mt-3 flex-wrap">
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              <span className="font-medium">{formatDuration(call.duration)}</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Calendar className="h-3.5 w-3.5" />
              <span>{formatRelativeTime(call.createdAt) || format(new Date(call.createdAt), "MMM d, h:mm a")}</span>
            </div>
          </div>
          
          {(call.aiSummary || call.transcript) && (
            <div className="mt-3 pt-3 border-t border-border/50">
              {call.aiSummary && (
                <div className="flex items-start gap-2">
                  <Sparkles className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {call.aiSummary}
                  </p>
                </div>
              )}
              {!call.aiSummary && call.transcript && (
                <div className="flex items-start gap-2">
                  <MessageSquare className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {call.transcript}
                  </p>
                </div>
              )}
            </div>
          )}
          
          <div className="flex items-center justify-between gap-2 mt-3">
            <div className="flex items-center gap-2">
              {hasRecording(call) ? (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Mic className="h-3 w-3" />
                  <span>{t('calls.details.recording')}</span>
                </div>
              ) : isOpenAIEngine(call) ? (
                <div className="flex items-center gap-1 text-xs text-muted-foreground/50" title="OpenAI calls don't have server-side recordings">
                  <Mic className="h-3 w-3" />
                  <span className="line-through">Recording N/A</span>
                </div>
              ) : null}
              {call.transcript && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <FileText className="h-3 w-3" />
                  <span>{t('calls.details.transcript')}</span>
                </div>
              )}
              {call.aiSummary && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Sparkles className="h-3 w-3" />
                  <span>{t('calls.details.aiAnalysis')}</span>
                </div>
              )}
            </div>
            
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setLocation(`/app/calls/${call.id}`);
              }}
              data-testid={`button-view-details-${testIdPrefix}${call.id}`}
            >
              <Eye className="h-4 w-4 mr-1" />
              {t('calls.viewDetails')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-blue-50 via-indigo-50 to-sky-50 dark:from-blue-950/40 dark:via-indigo-950/30 dark:to-sky-950/40 border p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
              <Phone className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">{t('calls.title')}</h1>
              <p className="text-muted-foreground text-sm">{t('calls.description')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="default"
              onClick={handleExportCsv}
              data-testid="button-export-calls"
            >
              <Download className="h-4 w-4 mr-2" />
              {t('common.export')}
            </Button>
          </div>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
          <div className="bg-background/60 backdrop-blur-sm rounded-lg p-3 border">
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span className="text-2xl font-bold text-foreground" data-testid="text-total-calls">{totalCalls}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{t('calls.stats.totalCalls')}</p>
          </div>
          <div className="bg-background/60 backdrop-blur-sm rounded-lg p-3 border">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span className="text-2xl font-bold text-foreground">{completedCalls}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{t('calls.status.completed')}</p>
          </div>
          <div className="bg-background/60 backdrop-blur-sm rounded-lg p-3 border">
            <div className="flex items-center gap-2">
              <PhoneIncoming className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span className="text-2xl font-bold text-foreground">{incomingCalls}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{t('calls.filters.incoming')}</p>
          </div>
          <div className="bg-background/60 backdrop-blur-sm rounded-lg p-3 border">
            <div className="flex items-center gap-2">
              <PhoneOutgoing className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span className="text-2xl font-bold text-foreground">{outgoingCalls}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{t('calls.filters.outgoing')}</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] w-full sm:w-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('calls.searchPlaceholder')}
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            data-testid="input-search-calls"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[130px]" data-testid="select-filter-status">
            <SelectValue placeholder={t('calls.details.status')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('calls.filters.allStatus')}</SelectItem>
            <SelectItem value="completed">{t('calls.status.completed')}</SelectItem>
            <SelectItem value="failed">{t('calls.status.failed')}</SelectItem>
            <SelectItem value="credit_failed" data-testid="filter-status-credit-failed">Not Billed - Low Credits</SelectItem>
            <SelectItem value="in_progress">{t('calls.status.inProgress')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sentimentFilter} onValueChange={setSentimentFilter}>
          <SelectTrigger className="w-full sm:w-[130px]" data-testid="select-filter-sentiment">
            <SelectValue placeholder={t('calls.details.sentiment')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('calls.filters.allSentiment')}</SelectItem>
            <SelectItem value="positive">{t('calls.sentiment.positive')}</SelectItem>
            <SelectItem value="neutral">{t('calls.sentiment.neutral')}</SelectItem>
            <SelectItem value="negative">{t('calls.sentiment.negative')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={directionFilter} onValueChange={setDirectionFilter}>
          <SelectTrigger className="w-full sm:w-[130px]" data-testid="select-filter-direction">
            <SelectValue placeholder={t('calls.details.direction')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('calls.filters.allDirections')}</SelectItem>
            <SelectItem value="incoming">{t('calls.filters.incoming')}</SelectItem>
            <SelectItem value="outgoing">{t('calls.filters.outgoing')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={leadFilter} onValueChange={setLeadFilter}>
          <SelectTrigger className="w-full sm:w-[130px]" data-testid="select-filter-lead">
            <SelectValue placeholder={t('calls.filters.leadQuality')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('calls.filters.allLeads')}</SelectItem>
            <SelectItem value="hot">{t('calls.classification.hot')}</SelectItem>
            <SelectItem value="warm">{t('calls.classification.warm')}</SelectItem>
            <SelectItem value="cold">{t('calls.classification.cold')}</SelectItem>
            <SelectItem value="lost">{t('calls.classification.lost')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="all" className="space-y-4">
        <TabsList>
          <TabsTrigger value="all" data-testid="tab-all">
            {t('calls.allCalls')} ({filteredCalls.length})
          </TabsTrigger>
          <TabsTrigger value="transcribed" data-testid="tab-transcribed">
            {t('calls.transcribed')} ({callsWithTranscripts.length})
          </TabsTrigger>
          <TabsTrigger value="recordings" data-testid="tab-recordings">
            {t('calls.recordings')} ({callsWithRecordings.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-3">
          {filteredCalls.length === 0 ? (
            <Card className="p-12 text-center">
              <Phone className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <h3 className="font-medium text-lg mb-1">{t('calls.noCalls')}</h3>
              <p className="text-muted-foreground text-sm">
                {calls?.length === 0 
                  ? t('calls.createCampaignToStart') 
                  : t('calls.noMatchingFilters')}
              </p>
            </Card>
          ) : (
            <>
              <div className="grid gap-3">
                {allPagination.paginatedItems.map((call) => renderCallCard(call))}
              </div>
              <DataPagination
                currentPage={allPagination.currentPage}
                totalPages={allPagination.totalPages}
                totalItems={allPagination.totalItems}
                itemsPerPage={allPagination.itemsPerPage}
                onPageChange={allPagination.handlePageChange}
                onItemsPerPageChange={allPagination.handleItemsPerPageChange}
                data-testid="pagination-all-calls"
              />
            </>
          )}
        </TabsContent>

        <TabsContent value="transcribed" className="space-y-3">
          {callsWithTranscripts.length === 0 ? (
            <Card className="p-12 text-center">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <h3 className="font-medium text-lg mb-1">{t('calls.noTranscribed')}</h3>
              <p className="text-muted-foreground text-sm">
                {t('calls.transcriptsWillAppear')}
              </p>
            </Card>
          ) : (
            <>
              <div className="grid gap-3">
                {transcribedPagination.paginatedItems.map((call) => renderCallCard(call, "transcribed-"))}
              </div>
              <DataPagination
                currentPage={transcribedPagination.currentPage}
                totalPages={transcribedPagination.totalPages}
                totalItems={transcribedPagination.totalItems}
                itemsPerPage={transcribedPagination.itemsPerPage}
                onPageChange={transcribedPagination.handlePageChange}
                onItemsPerPageChange={transcribedPagination.handleItemsPerPageChange}
                data-testid="pagination-transcribed-calls"
              />
            </>
          )}
        </TabsContent>

        <TabsContent value="recordings" className="space-y-3">
          {callsWithRecordings.length === 0 ? (
            <Card className="p-12 text-center">
              <Mic className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <h3 className="font-medium text-lg mb-1">{t('calls.noRecordings')}</h3>
              <p className="text-muted-foreground text-sm">
                {t('calls.trySyncRecordings')}
              </p>
            </Card>
          ) : (
            <>
              <div className="grid gap-3">
                {recordingsPagination.paginatedItems.map((call) => renderCallCard(call, "recording-"))}
              </div>
              <DataPagination
                currentPage={recordingsPagination.currentPage}
                totalPages={recordingsPagination.totalPages}
                totalItems={recordingsPagination.totalItems}
                itemsPerPage={recordingsPagination.itemsPerPage}
                onPageChange={recordingsPagination.handlePageChange}
                onItemsPerPageChange={recordingsPagination.handleItemsPerPageChange}
                data-testid="pagination-recordings-calls"
              />
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
