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
import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { useState, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, ArrowRight, Play, Pause, Download, Loader2, Phone, Clock, Calendar, MessageSquare, PhoneIncoming, PhoneOutgoing, CheckCircle2, XCircle, User, Volume2, Heart, Target, Mail, Bot, ChevronLeft, ChevronRight, Globe, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { AuthStorage } from "@/lib/auth-storage";
import { formatSipEndpoint } from "@/lib/formatters";

interface Contact {
  id: string;
  firstName: string;
  lastName?: string | null;
  phone: string;
  email?: string | null;
}

interface Campaign {
  id: string;
  name: string;
}

interface Call {
  id: string;
  campaignId: string | null;
  contactId: string | null;
  phoneNumber?: string | null;
  fromNumber?: string | null;
  toNumber?: string | null;
  status: string;
  duration: number | null;
  recordingUrl: string | null;
  elevenLabsConversationId?: string | null;
  twilioSid?: string | null;
  plivoCallUuid?: string | null;
  transcript: string | null;
  aiSummary: string | null;
  classification: string | null;
  sentiment: string | null;
  metadata: Record<string, any> | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  callDirection: string | null;
  contact?: Contact | null;
  campaign?: Campaign | null;
  engine?: 'elevenlabs' | 'twilio-openai' | 'plivo-openai' | 'openai';
  agent?: { id: string; name: string } | null;
  widgetId?: string | null;
  widget?: { id: string; name: string } | null;
}

export default function CallDetail() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [recordingBlobUrl, setRecordingBlobUrl] = useState<string | null>(null);

  const { data: call, isLoading: callLoading } = useQuery<Call>({
    queryKey: [`/api/calls/${id}`],
    enabled: !!id,
  });

  // Fetch all calls to enable next/previous navigation
  const { data: allCalls } = useQuery<Call[]>({
    queryKey: ["/api/calls"],
  });

  // Find current call index and get prev/next call IDs
  const currentIndex = allCalls?.findIndex(c => c.id === id) ?? -1;
  const prevCall = currentIndex > 0 ? allCalls?.[currentIndex - 1] : null;
  const nextCall = currentIndex >= 0 && currentIndex < (allCalls?.length ?? 0) - 1 ? allCalls?.[currentIndex + 1] : null;

  // Extract contact and campaign from the call object (now embedded)
  const contact = call?.contact;
  const campaign = call?.campaign;

  // Check if call has recording available (either stored URL or ElevenLabs conversation)
  // OpenAI widget calls use WebRTC and don't have server-side recordings
  const hasRecording = call?.engine !== 'openai' && (call?.recordingUrl || call?.elevenLabsConversationId || call?.twilioSid || call?.plivoCallUuid);

  // Fetch recording as blob with authentication
  useEffect(() => {
    const abortController = new AbortController();
    let fetchedBlobUrl: string | null = null;
    
    // Fetch recording if we have either a recordingUrl OR an elevenLabsConversationId
    // Skip OpenAI widget calls - they use WebRTC and don't have server-side recordings
    if (call?.engine !== 'openai' && (call?.recordingUrl || call?.elevenLabsConversationId || call?.twilioSid || call?.plivoCallUuid) && id) {
      const fetchRecording = async () => {
        try {
          if (!AuthStorage.isAuthenticated()) {
            console.error('No authentication token found');
            return;
          }
          
          const headers: Record<string, string> = {};
          const authHeader = AuthStorage.getAuthHeader();
          if (authHeader) {
            headers['Authorization'] = authHeader;
          }
          
          const response = await fetch(`/api/calls/${id}/recording`, {
            headers,
            credentials: 'include',
            signal: abortController.signal
          });
          
          if (response.ok) {
            const blob = await response.blob();
            
            // Check if this fetch was aborted before creating blob URL
            if (!abortController.signal.aborted) {
              fetchedBlobUrl = URL.createObjectURL(blob);
              
              // Revoke old blob URL before setting new one
              setRecordingBlobUrl((prevUrl) => {
                if (prevUrl) {
                  URL.revokeObjectURL(prevUrl);
                }
                return fetchedBlobUrl;
              });
            }
          } else {
            console.error('Failed to fetch recording:', response.statusText);
          }
        } catch (error: any) {
          // Ignore abort errors
          if (error.name !== 'AbortError') {
            console.error('Failed to fetch recording:', error);
          }
        }
      };
      
      fetchRecording();
    }
    
    // Cleanup: abort in-flight request and revoke any blob URLs
    return () => {
      abortController.abort();
      
      if (audioRef.current) {
        audioRef.current.pause();
      }
      
      // Revoke the blob URL created by this effect instance
      if (fetchedBlobUrl) {
        URL.revokeObjectURL(fetchedBlobUrl);
      }
      
      // Clear state on unmount
      setRecordingBlobUrl((prevUrl) => {
        if (prevUrl) {
          URL.revokeObjectURL(prevUrl);
        }
        return null;
      });
    };
  }, [call?.engine, call?.recordingUrl, call?.elevenLabsConversationId, call?.twilioSid, call?.plivoCallUuid, id]);

  if (callLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!call) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => setLocation("/app/calls")} data-testid="button-back">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Calls
        </Button>
        <Card className="p-16 text-center">
          <h3 className="text-lg font-semibold mb-2">Call not found</h3>
          <p className="text-muted-foreground">The call you're looking for doesn't exist</p>
        </Card>
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <Badge className="bg-green-500/10 text-green-500 border-green-500/20">Successful</Badge>;
      case "failed":
        return <Badge className="bg-red-500/10 text-red-500 border-red-500/20">Failed</Badge>;
      case "credit_failed":
        return (
          <Badge
            className="bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20"
            data-testid="badge-status-credit-failed"
          >
            Not Billed - Low Credits
          </Badge>
        );
      case "no-answer":
        return <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">No answer</Badge>;
      case "busy":
        return <Badge className="bg-orange-500/10 text-orange-500 border-orange-500/20">Busy</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getSentimentBadge = (sentiment: string | null) => {
    if (!sentiment) return null;
    switch (sentiment) {
      case "positive":
        return <Badge className="bg-green-500/10 text-green-500 border-green-500/20">Positive</Badge>;
      case "negative":
        return <Badge className="bg-red-500/10 text-red-500 border-red-500/20">Negative</Badge>;
      case "neutral":
        return <Badge className="bg-gray-500/10 text-gray-500 border-gray-500/20">Neutral</Badge>;
      default:
        return <Badge variant="outline">{sentiment}</Badge>;
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

  const getWidgetBadge = () => {
    if (!call.widgetId) return null;
    return (
      <Badge className="bg-brand/10 text-brand border-brand/20 gap-1">
        <Globe className="h-3 w-3" />
        Widget
      </Badge>
    );
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const isIncoming = call.callDirection === 'incoming';
  const primaryNumber = isIncoming 
    ? formatSipEndpoint(call.fromNumber, call.engine) || contact?.phone || call.phoneNumber || "Unknown"
    : formatSipEndpoint(call.toNumber, call.engine) || contact?.phone || call.phoneNumber || "Unknown";
  const secondaryNumber = isIncoming 
    ? formatSipEndpoint(call.toNumber, call.engine) || "Your number"
    : formatSipEndpoint(call.fromNumber, call.engine) || "Your number";
  
  // For widget calls, show widget name instead of Unknown
  const contactName = call.widgetId 
    ? (call.widget?.name || (call.metadata as any)?.widgetName || 'Website Widget')
    : (contact && contact.firstName && contact.firstName.toLowerCase() !== 'unknown'
      ? `${contact.firstName} ${contact.lastName || ""}`.trim()
      : primaryNumber);

  const creditError = (call.metadata as any)?.creditError
    || (call.metadata as any)?.creditDeductionError
    || 'Insufficient credits';
  const creditsRequired = (call.metadata as any)?.creditsRequired;

  return (
    <div className="space-y-6">
      {call.status === 'credit_failed' && (
        <div
          className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 flex flex-col sm:flex-row sm:items-center gap-3"
          data-testid="banner-credit-failed"
        >
          <div className="flex items-start gap-3 flex-1">
            <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-red-700 dark:text-red-300">
                This call was not billed because your credits ran out mid-call.
              </p>
              <p className="text-red-700/80 dark:text-red-300/80 mt-1">
                The call connected and ran to completion, but we could not deduct the
                {creditsRequired ? ` ${creditsRequired} ` : ' '}credits required ({creditError}).
                No further calls will be billed until you top up.
              </p>
            </div>
          </div>
          <Button
            onClick={() => setLocation('/app/billing')}
            data-testid="button-topup-credits"
            className="shrink-0"
          >
            Top Up Credits
          </Button>
        </div>
      )}

      {/* Page Header with Blue/Indigo Gradient */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-50 via-indigo-100/50 to-sky-50 dark:from-blue-950/40 dark:via-indigo-900/30 dark:to-sky-950/40 border border-blue-100 dark:border-blue-900/50 p-6 md:p-8">
        <div className="absolute inset-0 bg-grid-slate-200/50 dark:bg-grid-slate-700/20 [mask-image:linear-gradient(0deg,transparent,rgba(255,255,255,0.5))]" />
        
        {/* Navigation row */}
        <div className="relative mb-4 flex items-center justify-between">
          <Button 
            variant="ghost" 
            onClick={() => setLocation("/app/calls")} 
            className="-ml-2"
            data-testid="button-back"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Calls
          </Button>
          
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => prevCall && setLocation(`/app/calls/${prevCall.id}`)}
              disabled={!prevCall}
              className="bg-background/80"
              data-testid="button-prev-call"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => nextCall && setLocation(`/app/calls/${nextCall.id}`)}
              disabled={!nextCall}
              className="bg-background/80"
              data-testid="button-next-call"
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>

        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/25">
              {isIncoming ? (
                <PhoneIncoming className="h-7 w-7 text-white" />
              ) : (
                <PhoneOutgoing className="h-7 w-7 text-white" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl md:text-3xl font-bold text-foreground">
                  {contactName}
                </h1>
                {getEngineBadge(call.engine)}
                {getWidgetBadge()}
                {getStatusBadge(call.status)}
                {getSentimentBadge(call.sentiment)}
              </div>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap text-muted-foreground">
                <span>{isIncoming ? "Incoming Call" : "Outgoing Call"}</span>
                <span>•</span>
                {isIncoming ? (
                  <>
                    <span className="font-mono text-sm">From: {primaryNumber}</span>
                    {secondaryNumber !== "Your number" && <span className="font-mono text-sm">To: {secondaryNumber}</span>}
                  </>
                ) : (
                  <>
                    <span className="font-mono text-sm">To: {primaryNumber}</span>
                    {secondaryNumber !== "Your number" && <span className="font-mono text-sm">From: {secondaryNumber}</span>}
                  </>
                )}
              </div>
            </div>
          </div>
          {hasRecording && recordingBlobUrl && (
            <Button 
              data-testid="button-download"
              onClick={() => {
                if (recordingBlobUrl) {
                  const link = document.createElement('a');
                  link.href = recordingBlobUrl;
                  link.download = `call-recording-${call.id}.mp3`;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                }
              }}
            >
              <Download className="h-4 w-4 mr-2" />
              Download Recording
            </Button>
          )}
        </div>

        {/* Stats Row */}
        <div className="relative mt-6 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="bg-white/80 dark:bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-blue-100/50 dark:border-blue-800/30">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <div className="text-2xl font-bold text-blue-700 dark:text-blue-300">{formatDuration(call.duration)}</div>
            </div>
            <div className="text-blue-600/70 dark:text-blue-400/70 text-sm">Duration</div>
          </div>
          <div className="bg-white/80 dark:bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-indigo-100/50 dark:border-indigo-800/30">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              <div className="text-lg font-bold text-indigo-700 dark:text-indigo-300">{format(new Date(call.createdAt), "MMM d, h:mm a")}</div>
            </div>
            <div className="text-indigo-600/70 dark:text-indigo-400/70 text-sm">Date & Time</div>
          </div>
          <div className="bg-white/80 dark:bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-emerald-100/50 dark:border-emerald-800/30">
            <div className="flex items-center gap-2">
              {call.transcript ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <XCircle className="h-4 w-4 text-slate-400" />
              )}
              <div className="text-lg font-bold text-emerald-700 dark:text-emerald-300">{call.transcript ? "Available" : "None"}</div>
            </div>
            <div className="text-emerald-600/70 dark:text-emerald-400/70 text-sm">Transcript</div>
          </div>
          <div className="bg-white/80 dark:bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-sky-100/50 dark:border-sky-800/30">
            <div className="flex items-center gap-2">
              {hasRecording ? (
                <Volume2 className="h-4 w-4 text-sky-600 dark:text-sky-400" />
              ) : (
                <XCircle className="h-4 w-4 text-slate-400" />
              )}
              <div className="text-lg font-bold text-sky-700 dark:text-sky-300">{hasRecording ? "Available" : "None"}</div>
            </div>
            <div className="text-sky-600/70 dark:text-sky-400/70 text-sm">Recording</div>
          </div>
        </div>
      </div>

      {hasRecording && (
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 border border-slate-700/50 p-6">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-blue-500/10 via-transparent to-transparent" />
          
          <div className="relative">
            <div className="flex items-center gap-2 mb-4">
              <Volume2 className="h-5 w-5 text-blue-400" />
              <h3 className="text-sm font-medium text-slate-300">Audio Recording</h3>
            </div>
            
            {recordingBlobUrl ? (
              <div className="flex items-center gap-4">
                <Button
                  size="icon"
                  className="rounded-full bg-blue-600 text-white shadow-lg shadow-blue-600/30"
                  onClick={() => {
                    if (audioRef.current) {
                      if (isPlaying) {
                        audioRef.current.pause();
                      } else {
                        audioRef.current.play();
                      }
                    }
                  }}
                  data-testid="button-play-pause"
                >
                  {isPlaying ? (
                    <Pause className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4 ml-0.5" />
                  )}
                </Button>
                
                <div className="flex-1">
                  <div className="h-16 bg-slate-800/50 rounded-xl flex items-center justify-center px-4 border border-slate-700/30">
                    <div className="flex items-end gap-[3px] h-12 w-full">
                      {Array.from({ length: 60 }).map((_, i) => {
                        const height = 25 + Math.abs(Math.sin(i * 0.35) * 45 + Math.cos(i * 0.2) * 25);
                        const isActive = call.duration && currentTime > 0 
                          ? i < (currentTime / call.duration) * 60 
                          : false;
                        return (
                          <div
                            key={i}
                            className={`flex-1 rounded-full transition-all duration-150 ${
                              isActive ? 'bg-blue-500' : 'bg-slate-600/60'
                            }`}
                            style={{
                              height: `${height}%`,
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between mt-2 px-1">
                    <span className="text-sm font-mono text-blue-400">
                      {formatDuration(Math.floor(currentTime))}
                    </span>
                    <span className="text-sm font-mono text-slate-500">
                      {formatDuration(call.duration)}
                    </span>
                  </div>
                </div>
                
                <audio
                  ref={audioRef}
                  src={recordingBlobUrl}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => setIsPlaying(false)}
                  onTimeUpdate={(e) => {
                    setCurrentTime(e.currentTarget.currentTime);
                  }}
                  onLoadedMetadata={(e) => {
                    if (!call.duration && e.currentTarget.duration) {
                      setCurrentTime(0);
                    }
                  }}
                />
              </div>
            ) : (
              <div className="flex items-center gap-3 py-4">
                <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
                <span className="text-sm text-slate-400">Loading recording...</span>
              </div>
            )}
          </div>
        </div>
      )}

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="transcription" data-testid="tab-transcription">Transcription</TabsTrigger>
          <TabsTrigger value="metadata" data-testid="tab-metadata">Client data</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {/* AI Summary Card */}
          <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-indigo-50/80 via-blue-50/50 to-slate-50 dark:from-indigo-950/40 dark:via-blue-950/30 dark:to-slate-950/40 border border-indigo-100/50 dark:border-indigo-900/30 p-6">
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-indigo-500/10 to-transparent rounded-full -mr-16 -mt-16" />
            <div className="relative">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-8 w-8 rounded-lg bg-indigo-500/10 dark:bg-indigo-500/20 flex items-center justify-center">
                  <MessageSquare className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                </div>
                <h3 className="text-lg font-semibold text-indigo-900 dark:text-indigo-100">AI Summary</h3>
              </div>
              <p className="text-indigo-800/80 dark:text-indigo-200/80 leading-relaxed">
                {call.aiSummary || "No AI summary available for this call. The call may still be processing or did not complete successfully."}
              </p>
            </div>
          </div>

          {/* Call Metrics Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {/* Call Status */}
            <div className="bg-white dark:bg-slate-900/50 rounded-xl p-4 border border-slate-200 dark:border-slate-800 hover-elevate">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="h-4 w-4 text-slate-400" />
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</p>
              </div>
              <div>{getStatusBadge(call.status)}</div>
            </div>

            {/* Duration */}
            <div className="bg-white dark:bg-slate-900/50 rounded-xl p-4 border border-slate-200 dark:border-slate-800 hover-elevate">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="h-4 w-4 text-slate-400" />
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Duration</p>
              </div>
              <p className="text-2xl font-bold text-foreground">{formatDuration(call.duration)}</p>
            </div>

            {/* Sentiment */}
            {call.sentiment && (
              <div className="bg-white dark:bg-slate-900/50 rounded-xl p-4 border border-slate-200 dark:border-slate-800 hover-elevate">
                <div className="flex items-center gap-2 mb-3">
                  <Heart className="h-4 w-4 text-slate-400" />
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Sentiment</p>
                </div>
                <div>{getSentimentBadge(call.sentiment)}</div>
              </div>
            )}

            {/* Lead Classification */}
            {call.classification && (
              <div className="bg-white dark:bg-slate-900/50 rounded-xl p-4 border border-slate-200 dark:border-slate-800 hover-elevate">
                <div className="flex items-center gap-2 mb-3">
                  <Target className="h-4 w-4 text-slate-400" />
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Classification</p>
                </div>
                <Badge variant="outline" className="text-sm font-medium">
                  {call.classification.charAt(0).toUpperCase() + call.classification.slice(1)}
                </Badge>
              </div>
            )}

            {/* Call Time */}
            {call.startedAt && (
              <div className="bg-white dark:bg-slate-900/50 rounded-xl p-4 border border-slate-200 dark:border-slate-800 hover-elevate">
                <div className="flex items-center gap-2 mb-3">
                  <Calendar className="h-4 w-4 text-slate-400" />
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Call Time</p>
                </div>
                <p className="text-sm font-medium text-foreground">{format(new Date(call.startedAt), "MMM d, yyyy")}</p>
                <p className="text-xs text-muted-foreground">{format(new Date(call.startedAt), "h:mm a")}</p>
              </div>
            )}

            {/* Direction (for incoming calls) */}
            {call.callDirection === 'incoming' && (
              <div className="bg-white dark:bg-slate-900/50 rounded-xl p-4 border border-slate-200 dark:border-slate-800 hover-elevate">
                <div className="flex items-center gap-2 mb-3">
                  <PhoneIncoming className="h-4 w-4 text-slate-400" />
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Direction</p>
                </div>
                <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20">Incoming</Badge>
              </div>
            )}
          </div>

          {/* Contact & Campaign Info */}
          {(contact || campaign || (call.callDirection === 'incoming' && call.metadata?.incomingAgentName)) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Contact Card */}
              {contact && (
                <div className="bg-white dark:bg-slate-900/50 rounded-xl p-5 border border-slate-200 dark:border-slate-800">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="h-10 w-10 rounded-full bg-blue-500/10 dark:bg-blue-500/20 flex items-center justify-center">
                      <User className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Contact</p>
                      <p className="font-semibold text-foreground">{contact.firstName} {contact.lastName || ""}</p>
                    </div>
                  </div>
                  <div className="space-y-2 pl-[52px]">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Phone className="h-3.5 w-3.5" />
                      <span>{contact.phone}</span>
                    </div>
                    {contact.email && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Mail className="h-3.5 w-3.5" />
                        <span>{contact.email}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Campaign Card */}
              {campaign && (
                <div className="bg-white dark:bg-slate-900/50 rounded-xl p-5 border border-slate-200 dark:border-slate-800">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="h-10 w-10 rounded-full bg-purple-500/10 dark:bg-purple-500/20 flex items-center justify-center">
                      <Target className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Campaign</p>
                      <Button
                        variant="ghost"
                        className="p-0 h-auto font-semibold text-foreground underline-offset-4 hover:underline"
                        onClick={() => setLocation(`/app/campaigns/${campaign.id}`)}
                        data-testid="link-campaign"
                      >
                        {campaign.name}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Incoming Agent Card */}
              {call.callDirection === 'incoming' && call.metadata?.incomingAgentName && (
                <div className="bg-white dark:bg-slate-900/50 rounded-xl p-5 border border-slate-200 dark:border-slate-800">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="h-10 w-10 rounded-full bg-amber-500/10 dark:bg-amber-500/20 flex items-center justify-center">
                      <Bot className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Incoming Agent</p>
                      <p className="font-semibold text-foreground">{call.metadata.incomingAgentName}</p>
                    </div>
                  </div>
                  {call.metadata?.calledNumber && (
                    <div className="pl-[52px]">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Phone className="h-3.5 w-3.5" />
                        <span>Called: {call.metadata.calledNumber}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="transcription">
          <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 border border-slate-200 dark:border-slate-800 p-6">
            <div className="flex items-center gap-2 mb-6">
              <div className="h-8 w-8 rounded-lg bg-blue-500/10 dark:bg-blue-500/20 flex items-center justify-center">
                <MessageSquare className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className="text-lg font-semibold">Call Transcript</h3>
            </div>
            
            {call.transcript ? (
              <div className="max-h-[600px] overflow-y-auto space-y-4 pr-2">
                {(() => {
                  let parsed: any = call.transcript;
                  if (typeof parsed === 'string') {
                    try { parsed = JSON.parse(parsed); } catch { parsed = null; }
                  }
                  if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].role && 'message' in parsed[0]) {
                    return parsed
                      .filter((entry: any) => entry.message && entry.message.trim())
                      .map((entry: any, index: number) => {
                        const isAgent = entry.role === 'agent' || entry.role === 'ai' || entry.role === 'assistant';
                        const speaker = isAgent ? 'Agent' : 'User';
                        return (
                          <div 
                            key={index} 
                            className={`flex gap-3 ${isAgent ? 'flex-row' : 'flex-row-reverse'}`}
                            data-testid={`transcript-entry-${index}`}
                          >
                            <div className={`flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${
                              isAgent 
                                ? 'bg-blue-500/10 dark:bg-blue-500/20' 
                                : 'bg-emerald-500/10 dark:bg-emerald-500/20'
                            }`}>
                              {isAgent ? (
                                <Bot className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                              ) : (
                                <User className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                              )}
                            </div>
                            <div className={`flex-1 max-w-[80%] ${isAgent ? '' : 'flex flex-col items-end'}`}>
                              <div className={`rounded-2xl px-4 py-3 ${
                                isAgent 
                                  ? 'bg-slate-100 dark:bg-slate-800/80 rounded-tl-md' 
                                  : 'bg-blue-500/10 dark:bg-blue-600/20 rounded-tr-md'
                              }`}>
                                <div className="flex items-center gap-2 mb-1">
                                  <span className={`text-xs font-medium ${
                                    isAgent ? 'text-blue-600 dark:text-blue-400' : 'text-emerald-600 dark:text-emerald-400'
                                  }`} data-testid={`transcript-speaker-${index}`}>
                                    {speaker}
                                  </span>
                                </div>
                                <p className="text-sm leading-relaxed" data-testid={`transcript-message-${index}`}>{entry.message}</p>
                              </div>
                            </div>
                          </div>
                        );
                      });
                  }
                  const textTranscript = typeof call.transcript === 'string' ? call.transcript : JSON.stringify(call.transcript, null, 2);
                  return textTranscript.split('\n').filter((line: string) => line.trim()).map((line: string, index: number) => {
                    const timestampMatch = line.match(/^\[(\d{2}:\d{2})\]\s*(.+)/);
                    const speakerMatch = timestampMatch ? timestampMatch[2].match(/^(Agent|User|AI|Customer):\s*(.+)/) : null;
                    
                    if (timestampMatch && speakerMatch) {
                      const timestamp = timestampMatch[1];
                      const speaker = speakerMatch[1];
                      const message = speakerMatch[2];
                      const isAgent = speaker === 'Agent' || speaker === 'AI';
                      
                      return (
                        <div 
                          key={index} 
                          className={`flex gap-3 ${isAgent ? 'flex-row' : 'flex-row-reverse'}`}
                          data-testid={`transcript-entry-${index}`}
                        >
                          <div className={`flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${
                            isAgent 
                              ? 'bg-blue-500/10 dark:bg-blue-500/20' 
                              : 'bg-emerald-500/10 dark:bg-emerald-500/20'
                          }`}>
                            {isAgent ? (
                              <Bot className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                            ) : (
                              <User className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                            )}
                          </div>
                          <div className={`flex-1 max-w-[80%] ${isAgent ? '' : 'flex flex-col items-end'}`}>
                            <div className={`rounded-2xl px-4 py-3 ${
                              isAgent 
                                ? 'bg-slate-100 dark:bg-slate-800/80 rounded-tl-md' 
                                : 'bg-blue-500/10 dark:bg-blue-600/20 rounded-tr-md'
                            }`}>
                              <div className="flex items-center gap-2 mb-1">
                                <span className={`text-xs font-medium ${
                                  isAgent ? 'text-blue-600 dark:text-blue-400' : 'text-emerald-600 dark:text-emerald-400'
                                }`} data-testid={`transcript-speaker-${index}`}>
                                  {speaker}
                                </span>
                                <span className="text-[10px] text-muted-foreground font-mono" data-testid={`transcript-timestamp-${index}`}>
                                  {timestamp}
                                </span>
                              </div>
                              <p className="text-sm leading-relaxed" data-testid={`transcript-message-${index}`}>{message}</p>
                            </div>
                          </div>
                        </div>
                      );
                    }
                    
                    return (
                      <div key={index} className="px-4 py-2">
                        <p className="text-sm leading-relaxed text-muted-foreground">{line}</p>
                      </div>
                    );
                  });
                })()}
              </div>
            ) : (
              <div className="text-center py-8">
                <MessageSquare className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground">
                  No transcript available for this call. The call may still be processing or did not complete successfully.
                </p>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="metadata">
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Call Metadata</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="text-muted-foreground">Call ID</div>
                <div className="font-mono">{call.id}</div>

                {call.metadata?.twilioCallSid && (
                  <>
                    <div className="text-muted-foreground">Twilio Call SID</div>
                    <div className="font-mono text-xs">{call.metadata.twilioCallSid}</div>
                  </>
                )}

                {contact && (
                  <>
                    <div className="text-muted-foreground">Contact ID</div>
                    <div className="font-mono">{contact.id}</div>
                  </>
                )}

                <div className="text-muted-foreground">Created At</div>
                <div>{format(new Date(call.createdAt), "MMM d, yyyy 'at' h:mm:ss a")}</div>

                {call.endedAt && (
                  <>
                    <div className="text-muted-foreground">Ended At</div>
                    <div>{format(new Date(call.endedAt), "MMM d, yyyy 'at' h:mm:ss a")}</div>
                  </>
                )}

                {call.metadata && Object.keys(call.metadata).length > 0 && (
                  <>
                    <div className="text-muted-foreground col-span-2 mt-4 font-medium">Additional Metadata</div>
                    <div className="col-span-2">
                      <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
                        {JSON.stringify(call.metadata, null, 2)}
                      </pre>
                    </div>
                  </>
                )}
              </div>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
