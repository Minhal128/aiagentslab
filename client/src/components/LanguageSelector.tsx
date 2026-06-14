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
import { useTranslation } from 'react-i18next';
import { useDynamicLanguages } from '@/contexts/dynamic-languages';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Globe } from 'lucide-react';
import { LanguageFlag } from './LanguageFlag';

interface LanguageSelectorProps {
  variant?: 'default' | 'compact' | 'icon';
  className?: string;
}

export function LanguageSelector({ variant = 'default', className }: LanguageSelectorProps) {
  const { i18n, t } = useTranslation();
  const { languages } = useDynamicLanguages();
  const currentLang = languages.find(l => l.code === i18n.language) || languages[0];

  const handleLanguageChange = (code: string) => {
    i18n.changeLanguage(code);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === 'icon' ? (
          <Button variant="ghost" size="icon" className={className} data-testid="button-language-selector">
            <Globe className="h-4 w-4" />
          </Button>
        ) : variant === 'compact' ? (
          <Button variant="ghost" size="sm" className={`gap-2 ${className}`} data-testid="button-language-selector">
            <div className="w-5 h-5 rounded-full overflow-hidden border border-border shadow-sm">
              <LanguageFlag code={currentLang.code} flag={currentLang.flag} />
            </div>
            <span className="uppercase text-xs font-medium">{currentLang.code}</span>
          </Button>
        ) : (
          <Button variant="ghost" className={`gap-2 ${className}`} data-testid="button-language-selector">
            <div className="w-5 h-5 rounded-full overflow-hidden border border-border shadow-sm">
              <LanguageFlag code={currentLang.code} flag={currentLang.flag} />
            </div>
            <span className="text-sm">{currentLang.nativeName}</span>
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {languages.map((lang) => (
          <DropdownMenuItem
            key={lang.code}
            onClick={() => handleLanguageChange(lang.code)}
            className={`gap-3 cursor-pointer ${i18n.language === lang.code ? 'bg-accent' : ''}`}
            data-testid={`lang-option-${lang.code}`}
          >
            <div className="w-6 h-6 rounded-full overflow-hidden border border-border shadow-sm flex-shrink-0">
              <LanguageFlag code={lang.code} flag={lang.flag} />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium">{lang.nativeName}</span>
              <span className="text-xs text-muted-foreground">{lang.name}</span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
