import { Router, Response } from 'express';
import { z } from 'zod';
import { AdminRequest, requireAdminPermission } from '../../middleware/admin-auth';
import {
  ALL_ENGINES,
  executeBackfill,
  getLastBackfillResult,
  getLastScanResult,
  setLastBackfillResult,
  triggerScanNow,
  type BackfillEngine,
} from '../../services/credit-backfill-monitor';

const enginesSchema = z
  .array(z.enum(ALL_ENGINES as unknown as [BackfillEngine, ...BackfillEngine[]]))
  .optional();

const scanBodySchema = z.object({
  sinceDays: z.number().int().positive().max(3650).optional(),
});

const runBodySchema = z.object({
  engines: enginesSchema,
  sinceDays: z.number().int().positive().max(3650).optional(),
  dryRun: z.boolean().optional(),
  userId: z.string().min(1).optional(),
});

export function registerCreditBackfillRoutes(router: Router) {
  router.get(
    '/credit-backfill/status',
    requireAdminPermission('billing', 'credits', 'read'),
    async (_req: AdminRequest, res: Response) => {
      try {
        res.json({
          success: true,
          data: {
            engines: ALL_ENGINES,
            lastScan: getLastScanResult(),
            lastBackfill: getLastBackfillResult(),
          },
        });
      } catch (err: any) {
        console.error('[CreditBackfill] status error:', err);
        res.status(500).json({ success: false, error: 'Failed to load status' });
      }
    },
  );

  router.post(
    '/credit-backfill/scan',
    requireAdminPermission('billing', 'credits', 'read'),
    async (req: AdminRequest, res: Response) => {
      try {
        const body = scanBodySchema.parse(req.body ?? {});
        const result = await triggerScanNow({ sinceDays: body.sinceDays });
        res.json({ success: true, data: result });
      } catch (err: any) {
        if (err instanceof z.ZodError) {
          return res.status(400).json({ success: false, error: 'Invalid request', details: err.errors });
        }
        console.error('[CreditBackfill] scan error:', err);
        res.status(500).json({ success: false, error: 'Failed to run scan' });
      }
    },
  );

  router.post(
    '/credit-backfill/run',
    requireAdminPermission('billing', 'credits', 'update'),
    async (req: AdminRequest, res: Response) => {
      try {
        const body = runBodySchema.parse(req.body ?? {});
        const result = await executeBackfill({
          engines: body.engines,
          sinceDays: body.sinceDays,
          dryRun: body.dryRun ?? false,
          userId: body.userId,
        });
        setLastBackfillResult(result);
        res.json({ success: true, data: result });
      } catch (err: any) {
        if (err instanceof z.ZodError) {
          return res.status(400).json({ success: false, error: 'Invalid request', details: err.errors });
        }
        console.error('[CreditBackfill] run error:', err);
        res.status(500).json({ success: false, error: 'Failed to run backfill' });
      }
    },
  );
}
