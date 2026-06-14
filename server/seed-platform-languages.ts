/**
 * ============================================================
 * Platform Language Seed Script
 * Seeds all 11 default platform UI languages with complete translations.
 * Run with: npx tsx server/seed-platform-languages.ts
 * Use --force to reseed and overwrite existing languages
 * ============================================================
 */
import { db } from './db';
import { platformLanguages } from '@shared/schema';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

interface LanguageConfig {
  code: string;
  name: string;
  nativeName: string;
  flag: string;
  direction: 'ltr' | 'rtl';
  isDefault: boolean;
  sortOrder: number;
}

const PLATFORM_LANGUAGES: LanguageConfig[] = [
  { code: 'en', name: 'English', nativeName: 'English', flag: '🇺🇸', direction: 'ltr', isDefault: true, sortOrder: 0 },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦', direction: 'rtl', isDefault: false, sortOrder: 1 },
  { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪', direction: 'ltr', isDefault: false, sortOrder: 2 },
  { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸', direction: 'ltr', isDefault: false, sortOrder: 3 },
  { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷', direction: 'ltr', isDefault: false, sortOrder: 4 },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', flag: '🇮🇳', direction: 'ltr', isDefault: false, sortOrder: 5 },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', flag: '🇮🇹', direction: 'ltr', isDefault: false, sortOrder: 6 },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵', direction: 'ltr', isDefault: false, sortOrder: 7 },
  { code: 'pl', name: 'Polish', nativeName: 'Polski', flag: '🇵🇱', direction: 'ltr', isDefault: false, sortOrder: 8 },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', flag: '🇧🇷', direction: 'ltr', isDefault: false, sortOrder: 9 },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska', flag: '🇸🇪', direction: 'ltr', isDefault: false, sortOrder: 10 },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', flag: '🇷🇺', direction: 'ltr', isDefault: false, sortOrder: 11 },
];

function loadTranslations(code: string): Record<string, unknown> {
  const localesDir = path.join(process.cwd(), 'client', 'src', 'i18n', 'locales');
  const filePath = path.join(localesDir, `${code}.json`);

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Failed to load translations for ${code}:`, error);
    return {};
  }
}

export async function seedPlatformLanguages(force: boolean = false): Promise<{ success: boolean; message: string }> {
  try {
    const existing = await db.select().from(platformLanguages).limit(1);

    if (existing.length > 0 && !force) {
      return {
        success: false,
        message: 'Languages already exist. Use --force to reseed.'
      };
    }

    if (force && existing.length > 0) {
      console.log('Force mode: Deleting existing languages...');
      await db.delete(platformLanguages);
    }

    console.log('Seeding platform UI languages...');

    for (const lang of PLATFORM_LANGUAGES) {
      const translations = loadTranslations(lang.code);

      console.log(`  Seeding ${lang.name} (${lang.code})...`);

      await db.insert(platformLanguages).values({
        code: lang.code,
        name: lang.name,
        nativeName: lang.nativeName,
        flag: lang.flag,
        direction: lang.direction,
        isEnabled: true,
        isDefault: lang.isDefault,
        sortOrder: lang.sortOrder,
        translations: translations,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    console.log(`\nSuccessfully seeded ${PLATFORM_LANGUAGES.length} languages.`);
    return {
      success: true,
      message: `Seeded ${PLATFORM_LANGUAGES.length} languages successfully`
    };
  } catch (error) {
    console.error('Error seeding languages:', error);
    return {
      success: false,
      message: `Failed to seed languages: ${error}`
    };
  }
}

// Run directly if called as script (ES module compatible)
// Only run standalone when this file is executed directly, NOT when bundled
const isMainModule = process.argv[1]?.includes('seed-platform-languages') &&
  !process.argv[1]?.includes('dist/index.js');

if (isMainModule) {
  const force = process.argv.includes('--force');

  console.log('========================================');
  console.log('Platform Language Seeder');
  console.log('========================================');
  if (force) {
    console.log('Running in FORCE mode - will overwrite existing languages');
  }
  console.log('');

  seedPlatformLanguages(force)
    .then((result) => {
      console.log('');
      console.log(result.message);
      process.exit(result.success ? 0 : 1);
    })
    .catch((error) => {
      console.error('Seed failed:', error);
      process.exit(1);
    });
}
