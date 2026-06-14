import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Play, Pause, Square, Loader2, Volume2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AuthStorage } from "@/lib/auth-storage";
import { useTranslation } from "react-i18next";

interface OpenAIVoicePreviewButtonProps {
  voiceId: string | null;
  voiceName?: string;
  speed?: number;
  previewText?: string;
}

async function fetchOpenAIVoicePreview(
  voiceId: string,
  text: string,
  speed: number = 1.0
): Promise<Blob> {
  const authHeader = AuthStorage.getAuthHeader();
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };
  if (authHeader) {
    headers["Authorization"] = authHeader;
  }

  const response = await fetch("/api/openai/voices/preview", {
    method: "POST",
    headers,
    body: JSON.stringify({
      voiceId,
      text,
      speed,
    }),
  });

  if (!response.ok) {
    let errorMessage = "Failed to generate preview";
    try {
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const error = await response.json();
        errorMessage = error.error || error.message || errorMessage;
      } else {
        const errorText = await response.text();
        errorMessage = errorText || `Server error: ${response.status}`;
      }
    } catch {
      errorMessage = `Server error: ${response.status} ${response.statusText}`;
    }
    throw new Error(errorMessage);
  }

  return response.blob();
}

export default function OpenAIVoicePreviewButton({
  voiceId,
  voiceName,
  speed = 1.0,
  previewText,
}: OpenAIVoicePreviewButtonProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const defaultText = t('voicePreview.defaultText', "Hello! This is a preview of how I'll sound. I can adjust my tone and style based on your preferences.");

  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  const playAudio = useCallback(async (url: string) => {
    if (audioRef.current) {
      audioRef.current.src = url;
      audioRef.current.load();
      await audioRef.current.play();
      setIsPlaying(true);
    }
  }, []);

  const handleAudioEnded = () => {
    setIsPlaying(false);
  };

  const stopPlayback = () => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    setIsPlaying(false);
  };

  const quickPreview = async () => {
    if (!voiceId) {
      toast({
        title: t('voicePreview.noVoiceSelected'),
        description: t('voicePreview.pleaseSelectVoice'),
        variant: "destructive",
      });
      return;
    }
    
    setIsLoading(true);
    try {
      const blob = await fetchOpenAIVoicePreview(voiceId, previewText || defaultText, speed);
      const url = URL.createObjectURL(blob);
      
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
      setAudioUrl(url);
      await playAudio(url);
    } catch (error: any) {
      console.error("OpenAI voice preview error:", error);
      toast({
        title: t('voicePreview.error'),
        description: error.message || t('voicePreview.failedToGenerate'),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <audio ref={audioRef} onEnded={handleAudioEnded} />
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={audioUrl && isPlaying ? stopPlayback : quickPreview}
        disabled={!voiceId || isLoading}
        data-testid="button-openai-voice-preview"
        title={voiceName ? `Preview ${voiceName}` : "Preview voice"}
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : isPlaying ? (
          <Square className="h-4 w-4" />
        ) : (
          <Volume2 className="h-4 w-4" />
        )}
      </Button>
    </>
  );
}
