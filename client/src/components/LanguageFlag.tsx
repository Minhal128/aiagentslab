import { Globe } from 'lucide-react';
import { useMemo } from 'react';
import * as Flags from 'country-flag-icons/react/3x2';

// Map common language codes to country codes for flags
// This covers cases where the language code doesn't match the country code (e.g. 'en' -> 'US')
const LANG_TO_COUNTRY: Record<string, string> = {
    en: 'US',
    ar: 'SA',
    he: 'IL',
    zh: 'CN',
    ko: 'KR',
    ja: 'JP',
    hi: 'IN',
    nb: 'NO',
    pt: 'BR', // Common choice for Portuguese
    sv: 'SE',
    da: 'DK',
    fi: 'FI',
    el: 'GR',
    uk: 'UA',
    vi: 'VN',
    th: 'TH',
    id: 'ID',
    fa: 'IR',
    ur: 'PK',
    bn: 'BD',
    ta: 'IN',
    te: 'IN',
    mr: 'IN',
    gu: 'IN',
    kn: 'IN',
    ml: 'IN',
    pa: 'IN',
};

/**
 * Tries to extract a 2-letter country code from a flag emoji
 */
function emojiToCountryCode(emoji: string): string | null {
    if (!emoji || emoji.length < 4) return null; // Emojis are usually 2-4 bytes in UTF-16

    const chars = [...emoji];
    if (chars.length !== 2) return null;

    const code = chars.map(char => {
        const codePoint = char.codePointAt(0);
        if (codePoint && codePoint >= 0x1F1E6 && codePoint <= 0x1F1FF) {
            return String.fromCharCode(codePoint - 0x1F1E6 + 65);
        }
        return '';
    }).join('');

    return code.length === 2 ? code : null;
}

interface LanguageFlagProps {
    code: string;
    flag?: string | null;
    className?: string;
}

export function LanguageFlag({ code, flag, className = "w-full h-full" }: LanguageFlagProps) {
    const icon = useMemo(() => {
        const normalizedCode = code.toLowerCase();
        const cleanFlag = flag?.trim();

        // Strategy 1: Check if 'flag' field is a 2-letter country code (e.g. "UZ", "TR")
        if (cleanFlag && /^[A-Z]{2}$/i.test(cleanFlag)) {
            const FlagComp = (Flags as any)[cleanFlag.toUpperCase()];
            if (FlagComp) return <FlagComp className="w-full h-full object-cover" />;
        }

        // Strategy 2: If 'flag' is an emoji, try to derive the country code (e.g. "🇺🇿" -> "UZ")
        const derivedFromEmoji = cleanFlag ? emojiToCountryCode(cleanFlag) : null;
        if (derivedFromEmoji) {
            const FlagComp = (Flags as any)[derivedFromEmoji];
            if (FlagComp) return <FlagComp className="w-full h-full object-cover" />;
        }

        // Strategy 3: Check manually defined mapping (e.g. "en" -> "US")
        const mappedCountryCode = LANG_TO_COUNTRY[normalizedCode];
        if (mappedCountryCode) {
            const FlagComp = (Flags as any)[mappedCountryCode];
            if (FlagComp) return <FlagComp className="w-full h-full object-cover" />;
        }

        // Strategy 4: Check if 'code' itself is a valid country code (e.g. "tr", "uz", "de")
        if (normalizedCode.length === 2) {
            const FlagComp = (Flags as any)[normalizedCode.toUpperCase()];
            if (FlagComp) return <FlagComp className="w-full h-full object-cover" />;
        }

        // Fallback Phase

        // Fallback 1: If it's a URL, render image
        if (cleanFlag && (cleanFlag.startsWith('http') || cleanFlag.startsWith('/'))) {
            return <img src={cleanFlag} alt={code} className="w-full h-full object-cover" />;
        }

        // Fallback 2: Render the flag string as-is (emoji or whatever it is)
        if (cleanFlag) {
            return (
                <div className="w-full h-full flex items-center justify-center text-lg leading-none">
                    {cleanFlag}
                </div>
            );
        }

        // Fallback 3: Globe icon
        return (
            <div className="w-full h-full flex items-center justify-center bg-muted text-muted-foreground">
                <Globe className="w-3 h-3" />
            </div>
        );
    }, [code, flag]);

    return <div className={className}>{icon}</div>;
}
