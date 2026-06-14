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

export type ProviderSupport = "elevenlabs" | "openai" | "both";

export interface LanguageSeedData {
  code: string;
  label: string;
  providers: ProviderSupport;
  sortOrder: number;
  isActive: boolean;
}

export const LANGUAGES_SEED_DATA: LanguageSeedData[] = [
  { code: "en", label: "English", providers: "both", sortOrder: 1, isActive: true },
  { code: "es", label: "Spanish", providers: "both", sortOrder: 2, isActive: true },
  { code: "fr", label: "French", providers: "both", sortOrder: 3, isActive: true },
  { code: "de", label: "German", providers: "both", sortOrder: 4, isActive: true },
  { code: "it", label: "Italian", providers: "both", sortOrder: 5, isActive: true },
  { code: "pt", label: "Portuguese", providers: "both", sortOrder: 6, isActive: true },
  { code: "zh", label: "Chinese", providers: "both", sortOrder: 7, isActive: true },
  { code: "ja", label: "Japanese", providers: "both", sortOrder: 8, isActive: true },
  { code: "ko", label: "Korean", providers: "both", sortOrder: 9, isActive: true },
  { code: "hi", label: "Hindi", providers: "both", sortOrder: 10, isActive: true },
  { code: "ar", label: "Arabic", providers: "both", sortOrder: 11, isActive: true },
  { code: "ru", label: "Russian", providers: "both", sortOrder: 12, isActive: true },
  { code: "nl", label: "Dutch", providers: "both", sortOrder: 13, isActive: true },
  { code: "pl", label: "Polish", providers: "both", sortOrder: 14, isActive: true },
  { code: "sv", label: "Swedish", providers: "both", sortOrder: 15, isActive: true },
  { code: "no", label: "Norwegian", providers: "both", sortOrder: 16, isActive: true },
  { code: "da", label: "Danish", providers: "both", sortOrder: 17, isActive: true },
  { code: "fi", label: "Finnish", providers: "both", sortOrder: 18, isActive: true },
  { code: "el", label: "Greek", providers: "both", sortOrder: 19, isActive: true },
  { code: "cs", label: "Czech", providers: "both", sortOrder: 20, isActive: true },
  { code: "sk", label: "Slovak", providers: "both", sortOrder: 21, isActive: true },
  { code: "hu", label: "Hungarian", providers: "both", sortOrder: 22, isActive: true },
  { code: "ro", label: "Romanian", providers: "both", sortOrder: 23, isActive: true },
  { code: "bg", label: "Bulgarian", providers: "both", sortOrder: 24, isActive: true },
  { code: "hr", label: "Croatian", providers: "both", sortOrder: 25, isActive: true },
  { code: "uk", label: "Ukrainian", providers: "both", sortOrder: 26, isActive: true },
  { code: "tr", label: "Turkish", providers: "both", sortOrder: 27, isActive: true },
  { code: "id", label: "Indonesian", providers: "both", sortOrder: 28, isActive: true },
  { code: "ms", label: "Malay", providers: "both", sortOrder: 29, isActive: true },
  { code: "vi", label: "Vietnamese", providers: "both", sortOrder: 30, isActive: true },
  { code: "fil", label: "Filipino", providers: "both", sortOrder: 31, isActive: true },
  { code: "ta", label: "Tamil", providers: "both", sortOrder: 32, isActive: true },
  { code: "th", label: "Thai", providers: "both", sortOrder: 33, isActive: true },
  { code: "he", label: "Hebrew", providers: "both", sortOrder: 34, isActive: true },
  { code: "bn", label: "Bengali", providers: "both", sortOrder: 35, isActive: true },
  { code: "te", label: "Telugu", providers: "both", sortOrder: 36, isActive: true },
  { code: "mr", label: "Marathi", providers: "both", sortOrder: 37, isActive: true },
  { code: "gu", label: "Gujarati", providers: "both", sortOrder: 38, isActive: true },
  { code: "kn", label: "Kannada", providers: "both", sortOrder: 39, isActive: true },
  { code: "ml", label: "Malayalam", providers: "both", sortOrder: 40, isActive: true },
  { code: "pa", label: "Punjabi", providers: "both", sortOrder: 41, isActive: true },
  { code: "ur", label: "Urdu", providers: "both", sortOrder: 42, isActive: true },
  { code: "fa", label: "Persian", providers: "both", sortOrder: 43, isActive: true },
  { code: "sw", label: "Swahili", providers: "both", sortOrder: 44, isActive: true },
  { code: "af", label: "Afrikaans", providers: "both", sortOrder: 45, isActive: true },
  { code: "ca", label: "Catalan", providers: "both", sortOrder: 46, isActive: true },
  { code: "lt", label: "Lithuanian", providers: "both", sortOrder: 47, isActive: true },
  { code: "lv", label: "Latvian", providers: "both", sortOrder: 48, isActive: true },
  { code: "sl", label: "Slovenian", providers: "both", sortOrder: 49, isActive: true },
  { code: "et", label: "Estonian", providers: "both", sortOrder: 50, isActive: true },
  { code: "sr", label: "Serbian", providers: "elevenlabs", sortOrder: 51, isActive: true },
  { code: "mk", label: "Macedonian", providers: "elevenlabs", sortOrder: 52, isActive: true },
  { code: "az", label: "Azerbaijani", providers: "elevenlabs", sortOrder: 53, isActive: true },
  { code: "ka", label: "Georgian", providers: "elevenlabs", sortOrder: 54, isActive: true },
  { code: "am", label: "Amharic", providers: "elevenlabs", sortOrder: 55, isActive: true },
  { code: "ne", label: "Nepali", providers: "elevenlabs", sortOrder: 56, isActive: true },
  { code: "si", label: "Sinhala", providers: "elevenlabs", sortOrder: 57, isActive: true },
  { code: "my", label: "Burmese", providers: "elevenlabs", sortOrder: 58, isActive: true },
  { code: "km", label: "Khmer", providers: "elevenlabs", sortOrder: 59, isActive: true },
  { code: "lo", label: "Lao", providers: "elevenlabs", sortOrder: 60, isActive: true },
  { code: "mn", label: "Mongolian", providers: "elevenlabs", sortOrder: 61, isActive: true },
  { code: "bo", label: "Tibetan", providers: "elevenlabs", sortOrder: 62, isActive: true },
  { code: "sq", label: "Albanian", providers: "elevenlabs", sortOrder: 63, isActive: true },
  { code: "bs", label: "Bosnian", providers: "elevenlabs", sortOrder: 64, isActive: true },
  { code: "is", label: "Icelandic", providers: "elevenlabs", sortOrder: 65, isActive: true },
  { code: "mt", label: "Maltese", providers: "elevenlabs", sortOrder: 66, isActive: true },
  { code: "cy", label: "Welsh", providers: "elevenlabs", sortOrder: 67, isActive: true },
  { code: "ga", label: "Irish", providers: "elevenlabs", sortOrder: 68, isActive: true },
  { code: "eu", label: "Basque", providers: "elevenlabs", sortOrder: 69, isActive: true },
  { code: "gl", label: "Galician", providers: "elevenlabs", sortOrder: 70, isActive: true },
  { code: "zu", label: "Zulu", providers: "elevenlabs", sortOrder: 71, isActive: true },
  { code: "xh", label: "Xhosa", providers: "elevenlabs", sortOrder: 72, isActive: true },
];
