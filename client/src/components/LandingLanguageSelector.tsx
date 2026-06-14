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

interface LandingLanguageSelectorProps {
  needsLightText?: boolean;
  className?: string;
}

export function LandingLanguageSelector({ needsLightText = false, className }: LandingLanguageSelectorProps) {
  const { i18n } = useTranslation();
  const { languages } = useDynamicLanguages();
  const currentLang = languages.find(l => l.code === i18n.language) || languages[0];

  const handleLanguageChange = (code: string) => {
    i18n.changeLanguage(code);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`gap-2 ${needsLightText ? 'text-gray-300 hover:text-white hover:bg-white/10' : 'text-gray-600 hover:text-gray-900 hover:bg-black/5 dark:text-gray-300 dark:hover:text-white dark:hover:bg-white/10'} ${className}`}
          data-testid="button-landing-language-selector"
        >
          <div className="w-5 h-5 rounded-full overflow-hidden border border-gray-200 dark:border-white/20 shadow-sm">
            <LanguageFlag code={currentLang.code} flag={currentLang.flag} />
          </div>
          <span className="uppercase text-xs font-medium">{currentLang.code}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {languages.map((lang) => (
          <DropdownMenuItem
            key={lang.code}
            onClick={() => handleLanguageChange(lang.code)}
            className={`gap-3 cursor-pointer ${i18n.language === lang.code ? 'bg-accent' : ''}`}
            data-testid={`landing-lang-option-${lang.code}`}
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
