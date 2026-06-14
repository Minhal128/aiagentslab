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
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Phone, Calendar, Clock, TrendingUp, MessageSquare, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { useLocation } from "wouter";
import { useTranslation } from 'react-i18next';

interface Call {
  id: string;
  campaignId: string;
  contactId: string | null;
  status: string;
  duration: number | null;
  recordingUrl: string | null;
  transcript: string | null;
  aiSummary: string | null;
  classification: string | null;
  sentiment: string | null;
  metadata: Record<string, any> | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

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

interface CallWithRelations {
  call: Call;
  contact?: Contact | null;
  campaign?: Campaign | null;
}

export default function Conversations() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterSentiment, setFilterSentiment] = useState("all");

  const { data: calls, isLoading } = useQuery<Call[]>({
    queryKey: ["/api/calls"],
  });

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20">{t('conversations.status.completed')}</Badge>;
      case "failed":
        return <Badge className="bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20">{t('conversations.status.failed')}</Badge>;
      case "in_progress":
      case "in-progress":
        return <Badge className="bg-slate-500/10 text-slate-700 dark:text-slate-400 border-slate-500/20">{t('conversations.status.inProgress')}</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getSentimentBadge = (sentiment: string | null) => {
    if (!sentiment) return null;
    switch (sentiment) {
      case "positive":
        return <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20">{t('conversations.sentiment.positive')}</Badge>;
      case "negative":
        return <Badge className="bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20">{t('conversations.sentiment.negative')}</Badge>;
      case "neutral":
        return <Badge className="bg-slate-500/10 text-slate-700 dark:text-slate-400 border-slate-500/20">{t('conversations.sentiment.neutral')}</Badge>;
      default:
        return <Badge variant="outline">{sentiment}</Badge>;
    }
  };

  const getClassificationBadge = (classification: string | null) => {
    if (!classification) return null;
    switch (classification) {
      case "hot":
        return <Badge className="bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20">{t('conversations.classification.hotLead')}</Badge>;
      case "warm":
        return <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20">{t('conversations.classification.warmLead')}</Badge>;
      case "lost":
        return <Badge className="bg-slate-500/10 text-slate-700 dark:text-slate-400 border-slate-500/20">{t('conversations.classification.lost')}</Badge>;
      default:
        return <Badge variant="outline">{classification}</Badge>;
    }
  };

  const filteredCalls = calls?.filter(call => {
    const matchesSearch = searchQuery === "" || 
      call.transcript?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      call.aiSummary?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = filterStatus === "all" || call.status === filterStatus;
    const matchesSentiment = filterSentiment === "all" || call.sentiment === filterSentiment;
    
    return matchesSearch && matchesStatus && matchesSentiment;
  }) || [];

  const callsWithTranscripts = filteredCalls.filter(call => call.transcript);
  const callsWithoutTranscripts = filteredCalls.filter(call => !call.transcript);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-semibold text-foreground">{t('conversations.title')}</h1>
        <p className="text-muted-foreground mt-1">{t('conversations.subtitle')}</p>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('conversations.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-conversations"
          />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[150px]" data-testid="select-filter-status">
            <SelectValue placeholder={t('conversations.filters.status')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('conversations.filters.allStatus')}</SelectItem>
            <SelectItem value="completed">{t('conversations.status.completed')}</SelectItem>
            <SelectItem value="failed">{t('conversations.status.failed')}</SelectItem>
            <SelectItem value="in_progress">{t('conversations.status.inProgress')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterSentiment} onValueChange={setFilterSentiment}>
          <SelectTrigger className="w-[150px]" data-testid="select-filter-sentiment">
            <SelectValue placeholder={t('conversations.filters.sentiment')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('conversations.filters.allSentiment')}</SelectItem>
            <SelectItem value="positive">{t('conversations.sentiment.positive')}</SelectItem>
            <SelectItem value="neutral">{t('conversations.sentiment.neutral')}</SelectItem>
            <SelectItem value="negative">{t('conversations.sentiment.negative')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="all" className="space-y-4">
        <TabsList>
          <TabsTrigger value="all" data-testid="tab-all">
            {t('conversations.tabs.allCalls', { count: filteredCalls.length })}
          </TabsTrigger>
          <TabsTrigger value="transcribed" data-testid="tab-transcribed">
            {t('conversations.tabs.transcribed', { count: callsWithTranscripts.length })}
          </TabsTrigger>
          <TabsTrigger value="pending" data-testid="tab-pending">
            {t('conversations.tabs.pending', { count: callsWithoutTranscripts.length })}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-4">
          {filteredCalls.length === 0 ? (
            <Card className="p-8 text-center text-muted-foreground">
              {t('conversations.noConversations')}
            </Card>
          ) : (
            <div className="space-y-4">
              {filteredCalls.map((call) => (
                <Card 
                  key={call.id} 
                  className="p-6 hover:shadow-md transition-shadow cursor-pointer hover-elevate"
                  onClick={() => setLocation(`/app/calls/${call.id}`)}
                  data-testid={`card-conversation-${call.id}`}
                >
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Phone className="h-5 w-5 text-muted-foreground" />
                        <span className="font-medium">{t('conversations.callId')}: {call.id.slice(0, 8)}</span>
                        {getStatusBadge(call.status)}
                        {getSentimentBadge(call.sentiment)}
                        {getClassificationBadge(call.classification)}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          <span>{formatDuration(call.duration)}</span>
                        </div>
                        {call.startedAt && (
                          <div className="flex items-center gap-1">
                            <Calendar className="h-4 w-4" />
                            <span>{format(new Date(call.startedAt), "MMM d, h:mm a")}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {call.aiSummary && (
                      <div className="border-l-4 border-primary/20 pl-4">
                        <p className="text-sm font-medium mb-1">{t('conversations.aiSummary')}</p>
                        <p className="text-sm text-muted-foreground line-clamp-3">
                          {call.aiSummary}
                        </p>
                      </div>
                    )}

                    {call.transcript && (
                      <div className="bg-muted/30 rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <MessageSquare className="h-4 w-4 text-muted-foreground" />
                          <p className="text-sm font-medium">{t('conversations.transcriptPreview')}</p>
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-4">
                          {call.transcript}
                        </p>
                      </div>
                    )}

                    {!call.transcript && !call.aiSummary && (
                      <p className="text-sm text-muted-foreground italic">
                        {t('conversations.noTranscriptYet')}
                      </p>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="transcribed" className="space-y-4">
          {callsWithTranscripts.length === 0 ? (
            <Card className="p-8 text-center text-muted-foreground">
              {t('conversations.noTranscribedYet')}
            </Card>
          ) : (
            <div className="space-y-4">
              {callsWithTranscripts.map((call) => (
                <Card 
                  key={call.id} 
                  className="p-6 hover:shadow-md transition-shadow cursor-pointer hover-elevate"
                  onClick={() => setLocation(`/app/calls/${call.id}`)}
                  data-testid={`card-transcribed-${call.id}`}
                >
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Phone className="h-5 w-5 text-muted-foreground" />
                        <span className="font-medium">{t('conversations.callId')}: {call.id.slice(0, 8)}</span>
                        {getStatusBadge(call.status)}
                        {getSentimentBadge(call.sentiment)}
                        {getClassificationBadge(call.classification)}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          <span>{formatDuration(call.duration)}</span>
                        </div>
                        {call.startedAt && (
                          <div className="flex items-center gap-1">
                            <Calendar className="h-4 w-4" />
                            <span>{format(new Date(call.startedAt), "MMM d, h:mm a")}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {call.aiSummary && (
                      <div className="border-l-4 border-primary/20 pl-4">
                        <p className="text-sm font-medium mb-1">{t('conversations.aiSummary')}</p>
                        <p className="text-sm text-muted-foreground">
                          {call.aiSummary}
                        </p>
                      </div>
                    )}

                    <div className="bg-muted/30 rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <MessageSquare className="h-4 w-4 text-muted-foreground" />
                        <p className="text-sm font-medium">{t('conversations.transcript')}</p>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-6">
                        {call.transcript}
                      </p>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="pending" className="space-y-4">
          {callsWithoutTranscripts.length === 0 ? (
            <Card className="p-8 text-center text-muted-foreground">
              {t('conversations.allTranscribed')}
            </Card>
          ) : (
            <div className="space-y-4">
              {callsWithoutTranscripts.map((call) => (
                <Card 
                  key={call.id} 
                  className="p-6 hover:shadow-md transition-shadow cursor-pointer hover-elevate"
                  onClick={() => setLocation(`/app/calls/${call.id}`)}
                  data-testid={`card-pending-${call.id}`}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Phone className="h-5 w-5 text-muted-foreground" />
                        <span className="font-medium">{t('conversations.callId')}: {call.id.slice(0, 8)}</span>
                        {getStatusBadge(call.status)}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          <span>{formatDuration(call.duration)}</span>
                        </div>
                        {call.startedAt && (
                          <div className="flex items-center gap-1">
                            <Calendar className="h-4 w-4" />
                            <span>{format(new Date(call.startedAt), "MMM d, h:mm a")}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground italic">
                      {t('conversations.transcriptPending')}
                    </p>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
