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
import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search, Play, Mic, Square, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from 'react-i18next';
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import OpenAIVoicePreviewButton from "@/components/OpenAIVoicePreviewButton";

interface AccountVoice {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
  preview_url?: string;
}

interface OpenAIVoiceInfo {
  id: string;
  name: string;
  description: string;
  gender: string;
  style: string;
}

const OPENAI_VOICES: OpenAIVoiceInfo[] = [
  { id: 'alloy', name: 'Alloy', description: 'Neutral, versatile voice suitable for a wide range of applications', gender: 'Neutral', style: 'Balanced' },
  { id: 'echo', name: 'Echo', description: 'Warm, engaging voice with a friendly tone', gender: 'Male', style: 'Warm' },
  { id: 'shimmer', name: 'Shimmer', description: 'Expressive, dynamic voice with clear articulation', gender: 'Female', style: 'Expressive' },
  { id: 'ash', name: 'Ash', description: 'Calm, professional voice ideal for business contexts', gender: 'Male', style: 'Professional' },
  { id: 'ballad', name: 'Ballad', description: 'Smooth, melodic voice with a soothing quality', gender: 'Female', style: 'Melodic' },
  { id: 'coral', name: 'Coral', description: 'Bright, energetic voice with an upbeat tone', gender: 'Female', style: 'Energetic' },
  { id: 'sage', name: 'Sage', description: 'Wise, authoritative voice conveying expertise', gender: 'Male', style: 'Authoritative' },
  { id: 'verse', name: 'Verse', description: 'Articulate, clear voice perfect for narration', gender: 'Neutral', style: 'Narrative' },
  { id: 'cedar', name: 'Cedar', description: 'Deep, resonant voice with a grounded presence', gender: 'Male', style: 'Deep' },
  { id: 'marin', name: 'Marin', description: 'Fresh, youthful voice with modern appeal', gender: 'Female', style: 'Youthful' },
];

export default function Voices() {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("elevenlabs");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data: accountVoices, isLoading, isError, error } = useQuery<AccountVoice[]>({
    queryKey: ["/api/elevenlabs/voices"],
    staleTime: 60000,
  });

  const filteredVoices = useMemo(() => {
    if (!accountVoices) return [];
    if (!debouncedSearch) return accountVoices;
    const searchLower = debouncedSearch.toLowerCase();
    return accountVoices.filter(v => 
      v.name.toLowerCase().includes(searchLower) ||
      v.labels?.language?.toLowerCase().includes(searchLower) ||
      v.labels?.gender?.toLowerCase().includes(searchLower) ||
      v.labels?.accent?.toLowerCase().includes(searchLower) ||
      v.category?.toLowerCase().includes(searchLower)
    );
  }, [accountVoices, debouncedSearch]);

  const filteredOpenAIVoices = useMemo(() => {
    if (!debouncedSearch) return OPENAI_VOICES;
    const searchLower = debouncedSearch.toLowerCase();
    return OPENAI_VOICES.filter(v => 
      v.name.toLowerCase().includes(searchLower) ||
      v.description.toLowerCase().includes(searchLower) ||
      v.gender.toLowerCase().includes(searchLower) ||
      v.style.toLowerCase().includes(searchLower)
    );
  }, [debouncedSearch]);

  const handlePlayPreview = (voiceId: string, previewUrl?: string) => {
    if (!previewUrl) return;
    
    if (playingVoice === voiceId) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current = null;
      }
      setPlayingVoice(null);
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }

    const audio = new Audio(previewUrl);
    audioRef.current = audio;
    audio.play();
    setPlayingVoice(voiceId);
    audio.onended = () => {
      setPlayingVoice(null);
      audioRef.current = null;
    };
  };

  const formatLanguageName = (code: string) => {
    const languageNames: Record<string, string> = {
      en: "English",
      es: "Spanish",
      fr: "French",
      de: "German",
      it: "Italian",
      pt: "Portuguese",
      ja: "Japanese",
      ko: "Korean",
      zh: "Chinese",
      ru: "Russian",
      ar: "Arabic",
      hi: "Hindi",
      nl: "Dutch",
      pl: "Polish",
      sv: "Swedish",
      tr: "Turkish",
      id: "Indonesian",
      th: "Thai",
      vi: "Vietnamese",
      cs: "Czech",
      el: "Greek",
      hu: "Hungarian",
      ro: "Romanian",
      uk: "Ukrainian",
      he: "Hebrew",
      ms: "Malay",
      fil: "Filipino",
      da: "Danish",
      fi: "Finnish",
      no: "Norwegian",
      sk: "Slovak",
      bg: "Bulgarian",
      hr: "Croatian",
      lt: "Lithuanian",
      lv: "Latvian",
      sl: "Slovenian",
      et: "Estonian",
    };
    return languageNames[code?.toLowerCase()] || code?.toUpperCase() || "Unknown";
  };

  const getTotalVoiceCount = () => {
    if (activeTab === "elevenlabs") {
      return accountVoices?.length || 0;
    }
    return OPENAI_VOICES.length;
  };

  const getFilteredCount = () => {
    if (activeTab === "elevenlabs") {
      return filteredVoices.length;
    }
    return filteredOpenAIVoices.length;
  };

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-pink-50 via-rose-100/50 to-fuchsia-50 dark:from-pink-950/40 dark:via-rose-900/30 dark:to-fuchsia-950/40 border border-pink-100 dark:border-pink-900/50 p-6 md:p-8">
        <div className="absolute inset-0 bg-grid-slate-200/50 dark:bg-grid-slate-700/20 [mask-image:linear-gradient(0deg,transparent,rgba(255,255,255,0.5))]" />
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center shadow-lg shadow-pink-500/25">
              <Mic className="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-foreground">{t('voices.title')}</h1>
              <p className="text-muted-foreground mt-0.5">
                {t('voices.subtitleBrowse', 'Browse and preview available voices')}
              </p>
            </div>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList data-testid="tabs-voice-provider">
          <TabsTrigger value="elevenlabs" data-testid="tab-elevenlabs">
            ElevenLabs ({accountVoices?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="openai" data-testid="tab-openai">
            OpenAI ({OPENAI_VOICES.length})
          </TabsTrigger>
        </TabsList>

        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('voices.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                data-testid="input-search-voices"
              />
            </div>
          </div>

          {(activeTab === "openai" || !isLoading) && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {debouncedSearch 
                  ? t('voices.showingFiltered', { count: getFilteredCount(), total: getTotalVoiceCount() })
                  : t('voices.totalVoices', { count: getTotalVoiceCount() })}
              </span>
            </div>
          )}
        </div>

        <TabsContent value="elevenlabs" className="space-y-4">
          {isError ? (
        <Alert variant="destructive" data-testid="alert-voices-error">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t('common.error')}</AlertTitle>
          <AlertDescription>
            {(error as Error)?.message || t('voices.errorLoading', 'Failed to load voices. Please check your ElevenLabs API key configuration.')}
          </AlertDescription>
        </Alert>
      ) : isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <Skeleton className="h-5 w-3/4 mb-2" />
                  <div className="flex gap-2">
                    <Skeleton className="h-5 w-16" />
                    <Skeleton className="h-5 w-12" />
                  </div>
                </div>
                <Skeleton className="h-9 w-9 rounded-md" />
              </div>
            </Card>
          ))}
        </div>
      ) : filteredVoices.length === 0 ? (
        <Card className="p-16 text-center">
          <Mic className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-semibold mb-2">
            {debouncedSearch 
              ? t('voices.noVoicesMatch', 'No voices match your search')
              : t('voices.noVoicesAvailable', 'No voices available')}
          </h3>
          <p className="text-muted-foreground">
            {debouncedSearch 
              ? t('voices.tryDifferentSearch', 'Try a different search term')
              : t('voices.voicesWillAppear', 'Your ElevenLabs account voices will appear here')}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredVoices.map((voice) => (
            <Card
              key={voice.voice_id}
              className="p-4 hover-elevate relative overflow-visible border-green-200 dark:border-green-800/50"
              data-testid={`card-voice-${voice.voice_id}`}
            >
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-green-400 via-emerald-500 to-green-400 rounded-t-lg" />
              
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold truncate mb-1.5" data-testid="text-voice-name">
                    {voice.name}
                  </h3>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {voice.labels?.language && (
                      <Badge variant="secondary" className="text-xs">
                        {formatLanguageName(voice.labels.language)}
                      </Badge>
                    )}
                    {voice.labels?.gender && (
                      <Badge variant="outline" className="text-xs capitalize">
                        {voice.labels.gender}
                      </Badge>
                    )}
                    {voice.labels?.accent && (
                      <Badge variant="outline" className="text-xs capitalize">
                        {voice.labels.accent}
                      </Badge>
                    )}
                  </div>
                </div>
                {voice.preview_url && (
                  <Button
                    variant={playingVoice === voice.voice_id ? "default" : "ghost"}
                    size="icon"
                    onClick={() => handlePlayPreview(voice.voice_id, voice.preview_url)}
                    data-testid="button-play-voice"
                  >
                    {playingVoice === voice.voice_id ? (
                      <Square className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                {voice.category && (
                  <Badge className="text-xs capitalize bg-gradient-to-r from-green-500 to-emerald-500 text-white border-0">
                    {voice.category}
                  </Badge>
                )}
                {voice.labels?.age && (
                  <Badge variant="outline" className="text-xs capitalize">
                    {voice.labels.age}
                  </Badge>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
        </TabsContent>

        <TabsContent value="openai" className="space-y-4">
          {filteredOpenAIVoices.length === 0 ? (
            <Card className="p-16 text-center">
              <Mic className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-semibold mb-2">
                {t('voices.noVoicesMatch', 'No voices match your search')}
              </h3>
              <p className="text-muted-foreground">
                {t('voices.tryDifferentSearch', 'Try a different search term')}
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredOpenAIVoices.map((voice) => (
                <Card
                  key={voice.id}
                  className="p-4 hover-elevate relative overflow-visible border-violet-200 dark:border-violet-800/50"
                  data-testid={`card-openai-voice-${voice.id}`}
                >
                  <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-violet-400 via-purple-500 to-violet-400 rounded-t-lg" />
                  
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold truncate mb-1.5" data-testid="text-openai-voice-name">
                        {voice.name}
                      </h3>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant="secondary" className="text-xs">
                          {voice.gender}
                        </Badge>
                        <Badge variant="outline" className="text-xs capitalize">
                          {voice.style}
                        </Badge>
                      </div>
                    </div>
                    <OpenAIVoicePreviewButton
                      voiceId={voice.id}
                      voiceName={voice.name}
                    />
                  </div>

                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {voice.description}
                  </p>

                  <div className="mt-3">
                    <Badge className="text-xs bg-gradient-to-r from-violet-500 to-purple-500 text-white border-0">
                      OpenAI Realtime
                    </Badge>
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
