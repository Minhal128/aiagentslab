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
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTranslation } from 'react-i18next';
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Search, ChevronDown, Play, Pause, Volume2, Loader2, Check } from "lucide-react";

interface AccountVoice {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
  preview_url?: string;
}

interface VoiceSearchPickerProps {
  value: string;
  onChange: (voiceId: string) => void;
  placeholder?: string;
}

function generateAvatarColor(name: string): string {
  const colors = [
    "from-blue-400 to-cyan-400",
    "from-purple-400 to-pink-400",
    "from-green-400 to-emerald-400",
    "from-orange-400 to-yellow-400",
    "from-red-400 to-pink-400",
    "from-indigo-400 to-purple-400",
    "from-brand to-brand/90",
    "from-rose-400 to-orange-400",
  ];
  
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  return colors[Math.abs(hash) % colors.length];
}

function VoiceAvatar({ name }: { name: string }) {
  const colorClass = generateAvatarColor(name);
  
  return (
    <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${colorClass} flex items-center justify-center flex-shrink-0`}>
      <Volume2 className="w-4 h-4 text-white" />
    </div>
  );
}

function VoiceItem({ 
  voice, 
  isSelected, 
  onSelect,
  onPreview,
  isPlaying,
}: { 
  voice: AccountVoice; 
  isSelected: boolean;
  onSelect: () => void;
  onPreview: () => void;
  isPlaying: boolean;
}) {
  const tags: string[] = [];
  
  if (voice.labels?.language) {
    const langDisplay = voice.labels.accent 
      ? `${voice.labels.language} (${voice.labels.accent})`
      : voice.labels.language;
    tags.push(langDisplay);
  }
  
  if (voice.labels?.gender) tags.push(voice.labels.gender);
  if (voice.labels?.age) tags.push(voice.labels.age);
  if (voice.category) tags.push(voice.category);
  
  const displayTags = tags.slice(0, 3);
  const moreCount = tags.length - 3;

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover-elevate rounded-md ${
        isSelected ? "bg-accent" : ""
      }`}
      onClick={onSelect}
      data-testid={`voice-item-${voice.voice_id}`}
    >
      <VoiceAvatar name={voice.name} />
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{voice.name}</span>
          {isSelected && <Check className="w-4 h-4 text-primary flex-shrink-0" />}
        </div>
        
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          {displayTags.map((tag, index) => (
            <Badge 
              key={index} 
              variant="secondary" 
              className="text-xs px-1.5 py-0 h-5"
            >
              {tag}
            </Badge>
          ))}
          {moreCount > 0 && (
            <span className="text-xs text-muted-foreground">+{moreCount} more...</span>
          )}
        </div>
      </div>
      
      {voice.preview_url && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="flex-shrink-0 h-8 w-8"
          onClick={(e) => {
            e.stopPropagation();
            onPreview();
          }}
          data-testid={`voice-preview-${voice.voice_id}`}
        >
          {isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>
      )}
    </div>
  );
}

export default function VoiceSearchPicker({ 
  value, 
  onChange,
  placeholder,
}: VoiceSearchPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (open && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [open]);

  const { data: accountVoices, isLoading } = useQuery<AccountVoice[]>({
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

  const selectedVoice = accountVoices?.find(v => v.voice_id === value);

  const handlePreview = useCallback((voice: AccountVoice) => {
    if (!voice.preview_url) return;

    if (playingVoiceId === voice.voice_id) {
      audioRef.current?.pause();
      setPlayingVoiceId(null);
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
    }

    const audio = new Audio(voice.preview_url);
    audioRef.current = audio;
    
    audio.play().catch(console.error);
    setPlayingVoiceId(voice.voice_id);
    
    audio.onended = () => setPlayingVoiceId(null);
    audio.onerror = () => setPlayingVoiceId(null);
  }, [playingVoiceId]);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  const handleSelect = (voice: AccountVoice) => {
    onChange(voice.voice_id);
    setOpen(false);
    setSearch("");
    
    if (audioRef.current) {
      audioRef.current.pause();
      setPlayingVoiceId(null);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal overflow-hidden"
          data-testid="voice-picker-trigger"
        >
          {selectedVoice ? (
            <div className="flex items-center gap-2 min-w-0 overflow-hidden flex-1 max-w-[calc(100%-24px)]">
              <VoiceAvatar name={selectedVoice.name} />
              <span className="truncate block max-w-full">{selectedVoice.name}</span>
            </div>
          ) : (
            <span className="text-muted-foreground">
              {placeholder || t('voicePicker.selectVoice', 'Select a voice...')}
            </span>
          )}
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      
      <PopoverContent 
        className="w-[400px] p-0 max-h-[450px] overflow-y-auto" 
        align="start"
        side="bottom"
        sideOffset={4}
        style={{
          scrollbarWidth: 'thin',
          scrollbarColor: 'hsl(var(--muted-foreground) / 0.3) transparent',
          WebkitOverflowScrolling: 'touch'
        } as React.CSSProperties}
      >
        <div className="p-3 border-b bg-background sticky top-0 z-10">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              placeholder={t('voicePicker.searchPlaceholder', 'Search for a voice...')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              data-testid="voice-search-input"
            />
          </div>
          <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
            <span>{accountVoices?.length || 0} {t('voicePicker.voicesAvailable', 'voices available')}</span>
            {isLoading && <Loader2 className="h-3 w-3 animate-spin" />}
          </div>
        </div>
        
        <div className="p-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredVoices.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              {debouncedSearch 
                ? t('voicePicker.noResults', 'No voices found')
                : t('voicePicker.noVoices', 'No voices available')
              }
            </div>
          ) : (
            filteredVoices.map((voice) => (
              <VoiceItem
                key={voice.voice_id}
                voice={voice}
                isSelected={value === voice.voice_id}
                onSelect={() => handleSelect(voice)}
                onPreview={() => handlePreview(voice)}
                isPlaying={playingVoiceId === voice.voice_id}
              />
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
