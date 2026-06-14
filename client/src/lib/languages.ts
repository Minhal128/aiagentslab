export type ProviderSupport = "elevenlabs" | "openai" | "both";

export interface LanguageOption {
  value: string;
  label: string;
  providers: ProviderSupport;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { value: "af", label: "Afrikaans", providers: "both" },
  { value: "ar", label: "Arabic", providers: "both" },
  { value: "hy", label: "Armenian", providers: "elevenlabs" },
  { value: "as", label: "Assamese", providers: "elevenlabs" },
  { value: "az", label: "Azerbaijani", providers: "elevenlabs" },
  { value: "be", label: "Belarusian", providers: "elevenlabs" },
  { value: "bn", label: "Bengali", providers: "both" },
  { value: "bs", label: "Bosnian", providers: "elevenlabs" },
  { value: "bg", label: "Bulgarian", providers: "both" },
  { value: "ca", label: "Catalan", providers: "both" },
  { value: "ceb", label: "Cebuano", providers: "elevenlabs" },
  { value: "ny", label: "Chichewa", providers: "elevenlabs" },
  { value: "zh", label: "Chinese", providers: "both" },
  { value: "hr", label: "Croatian", providers: "both" },
  { value: "cs", label: "Czech", providers: "both" },
  { value: "da", label: "Danish", providers: "both" },
  { value: "nl", label: "Dutch", providers: "both" },
  { value: "en", label: "English", providers: "both" },
  { value: "et", label: "Estonian", providers: "both" },
  { value: "fil", label: "Filipino", providers: "both" },
  { value: "fi", label: "Finnish", providers: "both" },
  { value: "fr", label: "French", providers: "both" },
  { value: "gl", label: "Galician", providers: "elevenlabs" },
  { value: "ka", label: "Georgian", providers: "elevenlabs" },
  { value: "de", label: "German", providers: "both" },
  { value: "el", label: "Greek", providers: "both" },
  { value: "gu", label: "Gujarati", providers: "both" },
  { value: "ha", label: "Hausa", providers: "elevenlabs" },
  { value: "he", label: "Hebrew", providers: "both" },
  { value: "hi", label: "Hindi", providers: "both" },
  { value: "hu", label: "Hungarian", providers: "both" },
  { value: "is", label: "Icelandic", providers: "elevenlabs" },
  { value: "id", label: "Indonesian", providers: "both" },
  { value: "ga", label: "Irish", providers: "elevenlabs" },
  { value: "it", label: "Italian", providers: "both" },
  { value: "ja", label: "Japanese", providers: "both" },
  { value: "jv", label: "Javanese", providers: "elevenlabs" },
  { value: "kn", label: "Kannada", providers: "both" },
  { value: "kk", label: "Kazakh", providers: "elevenlabs" },
  { value: "ky", label: "Kirghiz", providers: "elevenlabs" },
  { value: "ko", label: "Korean", providers: "both" },
  { value: "lv", label: "Latvian", providers: "both" },
  { value: "ln", label: "Lingala", providers: "elevenlabs" },
  { value: "lt", label: "Lithuanian", providers: "both" },
  { value: "lb", label: "Luxembourgish", providers: "elevenlabs" },
  { value: "mk", label: "Macedonian", providers: "elevenlabs" },
  { value: "ms", label: "Malay", providers: "both" },
  { value: "ml", label: "Malayalam", providers: "both" },
  { value: "mr", label: "Marathi", providers: "both" },
  { value: "ne", label: "Nepali", providers: "elevenlabs" },
  { value: "no", label: "Norwegian", providers: "both" },
  { value: "ps", label: "Pashto", providers: "elevenlabs" },
  { value: "fa", label: "Persian", providers: "both" },
  { value: "pl", label: "Polish", providers: "both" },
  { value: "pt", label: "Portuguese", providers: "both" },
  { value: "pa", label: "Punjabi", providers: "both" },
  { value: "ro", label: "Romanian", providers: "both" },
  { value: "ru", label: "Russian", providers: "both" },
  { value: "sr", label: "Serbian", providers: "elevenlabs" },
  { value: "sd", label: "Sindhi", providers: "elevenlabs" },
  { value: "sk", label: "Slovak", providers: "both" },
  { value: "sl", label: "Slovenian", providers: "both" },
  { value: "so", label: "Somali", providers: "elevenlabs" },
  { value: "es", label: "Spanish", providers: "both" },
  { value: "sw", label: "Swahili", providers: "both" },
  { value: "sv", label: "Swedish", providers: "both" },
  { value: "ta", label: "Tamil", providers: "both" },
  { value: "te", label: "Telugu", providers: "both" },
  { value: "th", label: "Thai", providers: "both" },
  { value: "tr", label: "Turkish", providers: "both" },
  { value: "uk", label: "Ukrainian", providers: "both" },
  { value: "ur", label: "Urdu", providers: "both" },
  { value: "vi", label: "Vietnamese", providers: "both" },
  { value: "cy", label: "Welsh", providers: "elevenlabs" },
];

export function getLanguageLabel(value: string): string {
  const lang = SUPPORTED_LANGUAGES.find(l => l.value === value);
  return lang?.label || value;
}

export function isProviderSupported(value: string, provider: "elevenlabs" | "openai"): boolean {
  const lang = SUPPORTED_LANGUAGES.find(l => l.value === value);
  if (!lang) return false;
  return lang.providers === "both" || lang.providers === provider;
}

export function getLanguagesForProvider(provider: "elevenlabs" | "openai"): LanguageOption[] {
  return SUPPORTED_LANGUAGES.filter(lang => 
    lang.providers === "both" || lang.providers === provider
  );
}
