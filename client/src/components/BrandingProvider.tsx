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
import { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "./ThemeProvider";

interface BrandingData {
  app_name: string;
  app_tagline: string;
  logo_url: string | null;
  logo_url_light: string | null;
  logo_url_dark: string | null;
  favicon_url: string | null;
  admin_email: string | null;
  app_location: string | null;
  social_twitter_url: string | null;
  social_linkedin_url: string | null;
  social_github_url: string | null;
  theme_primary: string | null;
  theme_primary_foreground: string | null;
  theme_accent: string | null;
  theme_background: string | null;
  theme_sidebar: string | null;
  theme_website_accent: string | null;
  theme_website_foreground: string | null;
}

interface CachedBranding {
  data: BrandingData;
  timestamp: number;
}

type BrandingProviderProps = {
  children: React.ReactNode;
};

type BrandingProviderState = {
  branding: BrandingData;
  currentLogo: string | null;
  showLogo: boolean;
  showFavicon: boolean;
  isLoading: boolean;
  refetch: () => void;
};

const CACHE_KEY = "agentlabs-branding:v3";
const CACHE_TTL = 1000 * 60 * 60 * 24;

const defaultBranding: BrandingData = {
  app_name: "",
  app_tagline: "",
  logo_url: null,
  logo_url_light: null,
  logo_url_dark: null,
  favicon_url: null,
  admin_email: null,
  app_location: null,
  social_twitter_url: null,
  social_linkedin_url: null,
  social_github_url: null,
  theme_primary: null,
  theme_primary_foreground: null,
  theme_accent: null,
  theme_background: null,
  theme_sidebar: null,
  theme_website_accent: null,
  theme_website_foreground: null
};

function hexToHsl(hex: string): string | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return null;
  let r = parseInt(result[1], 16) / 255;
  let g = parseInt(result[2], 16) / 255;
  let b = parseInt(result[3], 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function deriveHslLight(h: number, s: number, l: number): string {
  // Lighter variant: bring L towards 95% (for backgrounds)
  const lightL = Math.min(95, l + (95 - l) * 0.7);
  return `${h} ${Math.round(s)}% ${Math.round(lightL)}%`;
}

function deriveHslDark(h: number, s: number, l: number): string {
  // Darker variant: reduce L by ~35% (for hover states)
  const darkL = Math.max(5, l * 0.65);
  return `${h} ${Math.round(s)}% ${Math.round(darkL)}%`;
}

function parseBrandHsl(hslStr: string): [number, number, number] | null {
  // e.g. "175 80% 44%"
  const m = hslStr.trim().match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/);
  if (!m) return null;
  return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
}

function applyThemeColors(branding: BrandingData): void {
  const el = document.documentElement;
  const vars: [string, string | null][] = [
    ['--primary', branding.theme_primary],
    ['--primary-foreground', branding.theme_primary_foreground],
    ['--accent', branding.theme_accent],
    ['--background', branding.theme_background],
    ['--sidebar', branding.theme_sidebar],
    ['--brand', branding.theme_website_accent],
    ['--brand-foreground', branding.theme_website_foreground],
  ];
  for (const [varName, hexValue] of vars) {
    if (hexValue && hexValue.startsWith('#')) {
      const hsl = hexToHsl(hexValue);
      if (hsl) {
        el.style.setProperty(varName, hsl);
        // Derive light/dark variants for --brand
        if (varName === '--brand') {
          const parsed = parseBrandHsl(hsl);
          if (parsed) {
            el.style.setProperty('--brand-light', deriveHslLight(...parsed));
            el.style.setProperty('--brand-dark', deriveHslDark(...parsed));
          }
        }
      }
    } else {
      el.style.removeProperty(varName);
      if (varName === '--brand') {
        el.style.removeProperty('--brand-light');
        el.style.removeProperty('--brand-dark');
      }
    }
  }
}

function readCache(): BrandingData | null {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;
    const parsed: CachedBranding = JSON.parse(cached);
    const age = Date.now() - parsed.timestamp;
    if (age > CACHE_TTL) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCache(data: BrandingData): void {
  try {
    const cached: CachedBranding = { data, timestamp: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cached));
  } catch {
    // localStorage might be full or disabled
  }
}

function getBrandingSignature(data: BrandingData): string {
  return [
    data.app_name,
    data.logo_url,
    data.logo_url_light,
    data.logo_url_dark,
    data.favicon_url,
    data.admin_email,
    data.app_location,
    data.theme_primary,
    data.theme_primary_foreground,
    data.theme_accent,
    data.theme_background,
    data.theme_sidebar,
    data.theme_website_accent,
    data.theme_website_foreground
  ].join("|");
}

const BrandingProviderContext = createContext<BrandingProviderState | undefined>(undefined);

export function BrandingProvider({ children }: BrandingProviderProps) {
  const cachedData = useMemo(() => readCache(), []);
  const initialData = cachedData || defaultBranding;

  const [branding, setBranding] = useState<BrandingData>(initialData);
  const [hasLoaded, setHasLoaded] = useState(!!cachedData);
  const { theme } = useTheme();

  const { data, isLoading, refetch } = useQuery<BrandingData>({
    queryKey: ["/api/branding"],
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
    initialData: cachedData || undefined,
    initialDataUpdatedAt: cachedData ? 0 : undefined,
  });

  useEffect(() => {
    if (data) {
      const newBranding: BrandingData = {
        app_name: data.app_name || defaultBranding.app_name,
        app_tagline: data.app_tagline || defaultBranding.app_tagline,
        logo_url: data.logo_url,
        logo_url_light: data.logo_url_light,
        logo_url_dark: data.logo_url_dark,
        favicon_url: data.favicon_url,
        admin_email: data.admin_email,
        app_location: data.app_location,
        social_twitter_url: data.social_twitter_url,
        social_linkedin_url: data.social_linkedin_url,
        social_github_url: data.social_github_url,
        theme_primary: data.theme_primary,
        theme_primary_foreground: data.theme_primary_foreground,
        theme_accent: data.theme_accent,
        theme_background: data.theme_background,
        theme_sidebar: data.theme_sidebar,
        theme_website_accent: data.theme_website_accent,
        theme_website_foreground: data.theme_website_foreground
      };

      const oldSig = getBrandingSignature(branding);
      const newSig = getBrandingSignature(newBranding);

      if (oldSig !== newSig || !hasLoaded) {
        setBranding(newBranding);
        writeCache(newBranding);
      }

      setHasLoaded(true);
    }
  }, [data]);

  useEffect(() => {
    applyThemeColors(branding);
  }, [
    branding.theme_primary,
    branding.theme_primary_foreground,
    branding.theme_accent,
    branding.theme_background,
    branding.theme_sidebar,
    branding.theme_website_accent,
    branding.theme_website_foreground
  ]);

  useEffect(() => {
    if (branding.favicon_url) {
      const existingFavicon = document.querySelector("link[rel='icon']");
      if (existingFavicon) {
        existingFavicon.setAttribute("href", branding.favicon_url);
      } else {
        const favicon = document.createElement("link");
        favicon.rel = "icon";
        favicon.href = branding.favicon_url;
        document.head.appendChild(favicon);
      }
    }
  }, [branding.favicon_url]);

  useEffect(() => {
    if (branding.app_name && hasLoaded) {
      const expectedTitle = branding.app_tagline
        ? `${branding.app_name} - ${branding.app_tagline}`
        : branding.app_name;
      if (document.title !== expectedTitle) {
        document.title = expectedTitle;
      }
    }
  }, [branding.app_name, branding.app_tagline, hasLoaded]);

  const handleRefetch = useCallback(() => {
    refetch();
  }, [refetch]);

  const currentLogo = theme === 'dark'
    ? (branding.logo_url_dark || branding.logo_url_light || branding.logo_url)
    : (branding.logo_url_light || branding.logo_url);

  const showLogo = !!currentLogo;
  const showFavicon = !!branding.favicon_url;

  return (
    <BrandingProviderContext.Provider value={{
      branding,
      currentLogo,
      showLogo,
      showFavicon,
      isLoading: isLoading && !hasLoaded,
      refetch: handleRefetch
    }}>
      {children}
    </BrandingProviderContext.Provider>
  );
}

export function useBranding() {
  const context = useContext(BrandingProviderContext);
  if (context === undefined) {
    throw new Error("useBranding must be used within a BrandingProvider");
  }
  return context;
}
