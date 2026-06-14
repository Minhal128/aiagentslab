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
import { Router, Response, Request } from 'express';
import { db } from '../db';
import { platformLanguages } from '@shared/schema';
import { checkSuperAdmin, AdminRequest } from '../middleware/admin-auth';
import { eq, asc } from 'drizzle-orm';
import { z } from 'zod';

// Helper function to get enabled languages
async function getEnabledLanguages() {
  return db
    .select()
    .from(platformLanguages)
    .where(eq(platformLanguages.isEnabled, true))
    .orderBy(asc(platformLanguages.sortOrder), asc(platformLanguages.name));
}

// Public router - no authentication required
export const platformLanguagesPublicRouter = Router();
platformLanguagesPublicRouter.get('/', async (req: Request, res: Response) => {
  try {
    const languages = await getEnabledLanguages();
    res.json(languages);
  } catch (error) {
    console.error('Error fetching enabled platform languages:', error);
    res.status(500).json({ error: 'Failed to fetch languages' });
  }
});

// Admin router - requires super admin authentication
const router = Router();

// All admin routes require super admin authentication
router.use(checkSuperAdmin);

// GET /api/admin/platform-languages - List all platform languages
router.get('/', async (req: AdminRequest, res: Response) => {
  try {
    const languages = await db
      .select()
      .from(platformLanguages)
      .orderBy(asc(platformLanguages.sortOrder), asc(platformLanguages.name));

    res.json(languages);
  } catch (error) {
    console.error('Error fetching platform languages:', error);
    res.status(500).json({ error: 'Failed to fetch platform languages' });
  }
});

// POST /api/admin/platform-languages - Create a new language
router.post('/', async (req: AdminRequest, res: Response) => {
  try {
    const createData = z.object({
      code: z.string().min(2).max(5),
      name: z.string().min(1),
      nativeName: z.string().min(1),
      flag: z.string().optional(),
      direction: z.enum(['ltr', 'rtl']).default('ltr'),
      isEnabled: z.boolean().default(true),
      isDefault: z.boolean().default(false),
      sortOrder: z.number().default(0),
      translations: z.record(z.unknown()),
    }).parse(req.body);

    // Check if language code already exists
    const existing = await db
      .select()
      .from(platformLanguages)
      .where(eq(platformLanguages.code, createData.code))
      .limit(1);

    if (existing.length > 0) {
      return res.status(400).json({ error: 'Language code already exists' });
    }

    // If this is set as default, unset other defaults
    if (createData.isDefault) {
      await db
        .update(platformLanguages)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(platformLanguages.isDefault, true));
    }

    const [newLanguage] = await db
      .insert(platformLanguages)
      .values({
        ...createData,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    res.status(201).json(newLanguage);
  } catch (error) {
    console.error('Error creating platform language:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    res.status(500).json({ error: 'Failed to create platform language' });
  }
});

// PATCH /api/admin/platform-languages/:id - Update a language
router.patch('/:id', async (req: AdminRequest, res: Response) => {
  try {
    const { id } = req.params;

    const updateData = z.object({
      name: z.string().min(1).optional(),
      nativeName: z.string().min(1).optional(),
      flag: z.string().optional(),
      direction: z.enum(['ltr', 'rtl']).optional(),
      isEnabled: z.boolean().optional(),
      isDefault: z.boolean().optional(),
      sortOrder: z.number().optional(),
      translations: z.record(z.unknown()).optional(),
    }).parse(req.body);

    // Verify language exists
    const existingLanguage = await db
      .select()
      .from(platformLanguages)
      .where(eq(platformLanguages.id, id))
      .limit(1);

    if (existingLanguage.length === 0) {
      return res.status(404).json({ error: 'Language not found' });
    }

    // If this is set as default, unset other defaults and reorder
    if (updateData.isDefault === true) {
      // Unset previous default
      await db
        .update(platformLanguages)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(platformLanguages.isDefault, true));
      
      // Get all languages sorted by current order
      const allLanguages = await db
        .select()
        .from(platformLanguages)
        .orderBy(asc(platformLanguages.sortOrder));
      
      // Shift all languages that were before the new default down by 1
      const currentSortOrder = existingLanguage[0].sortOrder;
      for (const lang of allLanguages) {
        if (lang.id !== id && lang.sortOrder < currentSortOrder) {
          await db
            .update(platformLanguages)
            .set({ sortOrder: lang.sortOrder + 1, updatedAt: new Date() })
            .where(eq(platformLanguages.id, lang.id));
        }
      }
      
      // Set the new default to sortOrder 0
      updateData.sortOrder = 0;
    }

    // Prevent disabling the default language
    if (updateData.isEnabled === false && existingLanguage[0].isDefault) {
      return res.status(400).json({ error: 'Cannot disable the default language' });
    }

    await db
      .update(platformLanguages)
      .set({
        ...updateData,
        updatedAt: new Date(),
      })
      .where(eq(platformLanguages.id, id));

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating platform language:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    res.status(500).json({ error: 'Failed to update platform language' });
  }
});

// DELETE /api/admin/platform-languages/:id - Delete a language
router.delete('/:id', async (req: AdminRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Verify language exists
    const existingLanguage = await db
      .select()
      .from(platformLanguages)
      .where(eq(platformLanguages.id, id))
      .limit(1);

    if (existingLanguage.length === 0) {
      return res.status(404).json({ error: 'Language not found' });
    }

    // Prevent deleting the default language
    if (existingLanguage[0].isDefault) {
      return res.status(400).json({ error: 'Cannot delete the default language' });
    }

    await db
      .delete(platformLanguages)
      .where(eq(platformLanguages.id, id));

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting platform language:', error);
    res.status(500).json({ error: 'Failed to delete platform language' });
  }
});

// POST /api/admin/platform-languages/seed - Seed initial languages from static files
router.post('/seed', async (req: AdminRequest, res: Response) => {
  try {
    const { seedPlatformLanguages } = await import('../seed-platform-languages');
    const result = await seedPlatformLanguages(false);
    
    if (result.success) {
      res.json({ success: true, message: result.message });
    } else {
      res.status(400).json({ error: result.message });
    }
  } catch (error) {
    console.error('Error seeding platform languages:', error);
    res.status(500).json({ error: 'Failed to seed platform languages' });
  }
});

// Helper to set nested value in object
function setNestedValue(obj: Record<string, unknown>, path: string[], value: unknown): Record<string, unknown> {
  const result = JSON.parse(JSON.stringify(obj)); // Deep clone
  let current = result;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[path[path.length - 1]] = value;
  return result;
}

// Helper to delete nested value from object
function deleteNestedValue(obj: Record<string, unknown>, path: string[]): Record<string, unknown> {
  const result = JSON.parse(JSON.stringify(obj)); // Deep clone
  let current = result;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
      return result; // Path doesn't exist, return unchanged
    }
    current = current[key] as Record<string, unknown>;
  }
  delete current[path[path.length - 1]];
  return result;
}

// POST /api/admin/platform-languages/add-key - Add a translation key to one or all languages
router.post('/add-key', async (req: AdminRequest, res: Response) => {
  try {
    const addKeyData = z.object({
      keyPath: z.string().min(1).regex(/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/, 
        'Key path must be valid (e.g., custom.myKey or section.subsection.key)'),
      values: z.record(z.string()), // { languageCode: translationValue }
      syncToAll: z.boolean().default(false), // If true, add empty placeholder to all languages
    }).parse(req.body);

    const keyParts = addKeyData.keyPath.split('.');
    
    // Get all languages
    const allLanguages = await db
      .select()
      .from(platformLanguages)
      .orderBy(asc(platformLanguages.sortOrder));

    if (allLanguages.length === 0) {
      return res.status(400).json({ error: 'No languages configured' });
    }

    // Update each language
    for (const lang of allLanguages) {
      const translations = lang.translations as Record<string, unknown>;
      let newValue: string;
      
      if (addKeyData.values[lang.code] !== undefined) {
        // Use provided value
        newValue = addKeyData.values[lang.code];
      } else if (addKeyData.syncToAll) {
        // Add empty placeholder for sync
        newValue = '';
      } else {
        // Skip this language
        continue;
      }

      const updatedTranslations = setNestedValue(translations, keyParts, newValue);
      
      await db
        .update(platformLanguages)
        .set({ 
          translations: updatedTranslations,
          updatedAt: new Date() 
        })
        .where(eq(platformLanguages.id, lang.id));
    }

    res.json({ success: true, message: `Key "${addKeyData.keyPath}" added successfully` });
  } catch (error) {
    console.error('Error adding translation key:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    res.status(500).json({ error: 'Failed to add translation key' });
  }
});

// POST /api/admin/platform-languages/delete-key - Delete a translation key from one or all languages
// Using POST instead of DELETE to ensure request body is properly parsed
router.post('/delete-key', async (req: AdminRequest, res: Response) => {
  try {
    const deleteKeyData = z.object({
      keyPath: z.string().min(1),
      languageId: z.string().optional(), // If provided, delete only from this language; otherwise delete from all
    }).parse(req.body);

    const keyParts = deleteKeyData.keyPath.split('.');
    
    if (deleteKeyData.languageId) {
      // Delete from single language
      const [lang] = await db
        .select()
        .from(platformLanguages)
        .where(eq(platformLanguages.id, deleteKeyData.languageId))
        .limit(1);

      if (!lang) {
        return res.status(404).json({ error: 'Language not found' });
      }

      const translations = lang.translations as Record<string, unknown>;
      const updatedTranslations = deleteNestedValue(translations, keyParts);
      
      await db
        .update(platformLanguages)
        .set({ 
          translations: updatedTranslations,
          updatedAt: new Date() 
        })
        .where(eq(platformLanguages.id, lang.id));
    } else {
      // Delete from all languages
      const allLanguages = await db
        .select()
        .from(platformLanguages);

      for (const lang of allLanguages) {
        const translations = lang.translations as Record<string, unknown>;
        const updatedTranslations = deleteNestedValue(translations, keyParts);
        
        await db
          .update(platformLanguages)
          .set({ 
            translations: updatedTranslations,
            updatedAt: new Date() 
          })
          .where(eq(platformLanguages.id, lang.id));
      }
    }

    res.json({ success: true, message: `Key "${deleteKeyData.keyPath}" deleted successfully` });
  } catch (error) {
    console.error('Error deleting translation key:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    res.status(500).json({ error: 'Failed to delete translation key' });
  }
});

export default router;
