import { Router, Response } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { AdminRequest, requireAdminPermission } from '../../middleware/admin-auth';
import { systemUpdateService } from '../../services/system-update-service';
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { createRateLimiter } from '../../middleware/rateLimiter';
import { logAuditEvent } from '../../services/audit-log';

const updateUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/zip' || file.mimetype === 'application/x-zip-compressed' || file.originalname.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Only .zip files are allowed'));
    }
  },
});

function clientIp(req: AdminRequest): string {
  return (
    req.ip ||
    (req.headers['x-forwarded-for']?.toString().split(',')[0]) ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

// Per-IP rate limit on destructive operations: max 3 attempts per hour.
// We override the default user-id key generator so a single source IP
// can't bypass the limit by rotating admin accounts.
const destructiveRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  maxRequests: 3,
  keyGenerator: (req) => `system-update-ip:${clientIp(req as AdminRequest)}`,
  message: 'Too many update operations from this IP. Please wait before trying again.',
});

export function registerSystemUpdateRoutes(router: Router) {
  router.get('/system-update/status',
    requireAdminPermission('settings', 'system_settings', 'read'),
    async (req: AdminRequest, res: Response) => {
      try {
        const status = systemUpdateService.getStatus();
        res.json({
          success: true,
          data: {
            ...status,
            currentVersion: systemUpdateService.getCurrentVersion(),
          },
        });
      } catch (error: any) {
        console.error('[SystemUpdate] Status error:', error);
        res.status(500).json({ success: false, error: 'Failed to get update status' });
      }
    }
  );

  router.get('/system-update/history',
    requireAdminPermission('settings', 'system_settings', 'read'),
    async (req: AdminRequest, res: Response) => {
      try {
        const history = await systemUpdateService.getUpdateHistory();
        res.json({ success: true, data: { history } });
      } catch (error: any) {
        console.error('[SystemUpdate] History error:', error);
        res.status(500).json({ success: false, error: 'Failed to get update history' });
      }
    }
  );

  router.post('/system-update/validate',
    requireAdminPermission('settings', 'system_settings', 'create'),
    updateUpload.single('update'),
    async (req: AdminRequest, res: Response) => {
      try {
        if (!req.file) {
          return res.status(400).json({ success: false, error: 'No file uploaded' });
        }

        const validation = systemUpdateService.validateZip(req.file.buffer);

        if (!validation.valid) {
          return res.status(400).json({
            success: false,
            error: 'Validation failed',
            message: validation.error,
          });
        }

        // Surface a disk-space warning at validation time so the admin sees
        // it before they confirm the destructive action.
        const diskWarning = systemUpdateService.preflightDiskSpace(req.file.size);

        res.json({
          success: true,
          data: {
            manifest: validation.manifest,
            fileCount: validation.fileCount,
            totalSize: validation.estimatedSize,
            currentVersion: systemUpdateService.getCurrentVersion(),
            diskSpaceWarning: diskWarning || undefined,
          },
        });
      } catch (error: any) {
        console.error('[SystemUpdate] Validation error:', error);
        res.status(500).json({ success: false, error: 'Failed to validate update package' });
      }
    }
  );

  router.post('/system-update/apply',
    requireAdminPermission('settings', 'system_settings', 'create'),
    destructiveRateLimiter,
    updateUpload.single('update'),
    async (req: AdminRequest, res: Response) => {
      try {
        if (!req.file) {
          return res.status(400).json({ success: false, error: 'No file uploaded' });
        }

        // Block apply in the dev workspace. Running an update under `tsx
        // server/index.ts` rewrites node_modules under the live process and
        // kills it mid `npm install`, leaving stuck .maintenance and
        // .update-state.json files. The validate endpoint stays usable so
        // admins can still inspect a zip before deploying.
        if (systemUpdateService.isDevMode()) {
          return res.status(400).json({
            success: false,
            error: 'Application updates can only be applied to a deployed/production build. The dev workspace runs source files directly with tsx, so an in-place update would kill the running process. Deploy the app first, then apply the update from the deployed admin panel.',
          });
        }

        const status = systemUpdateService.getStatus();
        if (status.inProgress) {
          return res.status(409).json({ success: false, error: 'An update is already in progress' });
        }

        const performedBy = req.userId || req.adminTeamMember?.email || 'unknown';

        await logAuditEvent({
          action: 'admin.settings_update',
          userId: req.userId,
          resourceType: 'system_update',
          resourceId: 'apply',
          ipAddress: clientIp(req),
          userAgent: req.headers['user-agent']?.toString(),
          metadata: { event: 'system_update.apply', sizeBytes: req.file.size, filename: req.file.originalname },
          severity: 'warning',
        }).catch(() => {});

        res.json({
          success: true,
          message: 'Update process started. Check status endpoint for progress.',
        });

        systemUpdateService.performUpdate(req.file.buffer, performedBy).catch((err) => {
          console.error('[SystemUpdate] Async update error:', err);
        });
      } catch (error: any) {
        console.error('[SystemUpdate] Apply error:', error);
        res.status(500).json({ success: false, error: 'Failed to start update' });
      }
    }
  );

  router.post('/system-update/reset',
    requireAdminPermission('settings', 'system_settings', 'create'),
    async (req: AdminRequest, res: Response) => {
      try {
        await logAuditEvent({
          action: 'admin.settings_update',
          userId: req.userId,
          resourceType: 'system_update',
          resourceId: 'reset',
          ipAddress: clientIp(req),
          userAgent: req.headers['user-agent']?.toString(),
          metadata: { event: 'system_update.force_reset' },
          severity: 'warning',
        }).catch(() => {});

        // Safety gate: refuse to reset while an update is genuinely in
        // progress in production — clearing .maintenance under a live
        // performUpdate() would expose user traffic to a half-applied
        // workspace. In dev mode the gate is intentionally bypassed because
        // an `inProgress=true` snapshot in dev is by definition stuck (the
        // tsx process that started the update is dead — the current process
        // only inherited the state from disk).
        const current = systemUpdateService.getStatus();
        if (current.inProgress && !systemUpdateService.isDevMode()) {
          return res.status(409).json({
            success: false,
            error: 'Refusing to reset: an update is currently in progress. Wait for it to finish (or fail) before resetting.',
          });
        }

        const status = systemUpdateService.forceReset();
        res.json({ success: true, message: 'Update state cleared', data: status });
      } catch (error: any) {
        console.error('[SystemUpdate] Reset error:', error);
        res.status(500).json({ success: false, error: error.message || 'Failed to reset update state' });
      }
    }
  );

  router.post('/system-update/dismiss',
    requireAdminPermission('settings', 'system_settings', 'create'),
    async (req: AdminRequest, res: Response) => {
      try {
        systemUpdateService.dismissLastResult();
        res.json({ success: true, message: 'Update notice dismissed' });
      } catch (error: any) {
        res.status(409).json({ success: false, error: error.message || 'Failed to dismiss' });
      }
    }
  );

  router.post('/system-update/rollback/:updateId',
    requireAdminPermission('settings', 'system_settings', 'create'),
    destructiveRateLimiter,
    async (req: AdminRequest, res: Response) => {
      try {
        const currentStatus = systemUpdateService.getStatus();
        if (currentStatus.inProgress) {
          return res.status(409).json({ success: false, error: 'Cannot rollback while an update is in progress' });
        }

        const { updateId } = req.params;

        let backupPath: string | null = null;
        try {
          const result = await db.execute(sql`
            SELECT backup_path FROM system_updates WHERE id = ${updateId}
          `);
          if (result.rows.length > 0) {
            backupPath = (result.rows[0] as any).backup_path;
          }
        } catch {
          return res.status(404).json({ success: false, error: 'Update record not found' });
        }

        if (!backupPath) {
          return res.status(404).json({ success: false, error: 'No backup path found for this update' });
        }

        if (!fs.existsSync(backupPath)) {
          return res.status(404).json({ success: false, error: 'Backup directory no longer exists' });
        }

        await logAuditEvent({
          action: 'admin.settings_update',
          userId: req.userId,
          resourceType: 'system_update',
          resourceId: updateId,
          ipAddress: clientIp(req),
          userAgent: req.headers['user-agent']?.toString(),
          metadata: { event: 'system_update.rollback', backupPath },
          severity: 'warning',
        }).catch(() => {});

        // Fire-and-forget: respond immediately so the UI can switch to
        // status polling for live progress feedback. The server-side
        // rollback persists its phase/progress to .update-state.json so
        // the polling client can pick up the latest state even across
        // the restart that follows a successful rollback.
        res.json({
          success: true,
          message: 'Rollback started. Check status endpoint for progress.',
        });

        systemUpdateService
          .rollback(backupPath)
          .then(async () => {
            try {
              await db.execute(sql`
                UPDATE system_updates SET status = 'rolled_back' WHERE id = ${updateId}
              `);
            } catch {}
          })
          .catch((err) => {
            console.error('[SystemUpdate] Async rollback error:', err);
          });
        return;
      } catch (error: any) {
        console.error('[SystemUpdate] Rollback error:', error);
        res.status(500).json({ success: false, error: error.message || 'Failed to rollback' });
      }
    }
  );

  router.get('/system-update/backups/:updateId/download',
    requireAdminPermission('settings', 'system_settings', 'read'),
    async (req: AdminRequest, res: Response) => {
      try {
        const { updateId } = req.params;

        let backupPath: string | null = null;
        try {
          const result = await db.execute(sql`
            SELECT backup_path FROM system_updates WHERE id = ${updateId}
          `);
          if (result.rows.length > 0) {
            backupPath = (result.rows[0] as any).backup_path;
          }
        } catch {
          return res.status(404).json({ success: false, error: 'Update record not found' });
        }

        if (!backupPath || !fs.existsSync(backupPath)) {
          return res.status(404).json({ success: false, error: 'Backup is no longer available on disk' });
        }

        await logAuditEvent({
          action: 'admin.settings_update',
          userId: req.userId,
          resourceType: 'system_update',
          resourceId: updateId,
          ipAddress: clientIp(req),
          userAgent: req.headers['user-agent']?.toString(),
          metadata: { event: 'system_update.backup_download', backupPath },
          severity: 'info',
        }).catch(() => {});

        const filename = `${path.basename(backupPath)}.zip`;
        const ok = systemUpdateService.streamBackupZip(backupPath, res, filename);
        if (!ok && !res.headersSent) {
          return res.status(500).json({ success: false, error: 'Failed to build backup ZIP' });
        }
      } catch (error: any) {
        console.error('[SystemUpdate] Download backup error:', error);
        if (!res.headersSent) {
          res.status(500).json({ success: false, error: 'Failed to download backup' });
        }
      }
    }
  );

  router.delete('/system-update/backups/:updateId',
    requireAdminPermission('settings', 'system_settings', 'delete'),
    destructiveRateLimiter,
    async (req: AdminRequest, res: Response) => {
      try {
        const currentStatus = systemUpdateService.getStatus();
        if (currentStatus.inProgress) {
          return res.status(409).json({ success: false, error: 'Cannot delete backups while an update is in progress' });
        }

        const { updateId } = req.params;

        let backupPath: string | null = null;
        try {
          const result = await db.execute(sql`
            SELECT backup_path FROM system_updates WHERE id = ${updateId}
          `);
          if (result.rows.length > 0) {
            backupPath = (result.rows[0] as any).backup_path;
          }
        } catch {
          return res.status(404).json({ success: false, error: 'Update record not found' });
        }

        if (!backupPath) {
          return res.status(404).json({ success: false, error: 'No backup path found for this update' });
        }

        if (fs.existsSync(backupPath)) {
          fs.rmSync(backupPath, { recursive: true, force: true });
        }

        try {
          await db.execute(sql`
            UPDATE system_updates SET backup_path = NULL WHERE id = ${updateId}
          `);
        } catch {}

        await logAuditEvent({
          action: 'admin.settings_update',
          userId: req.userId,
          resourceType: 'system_update',
          resourceId: updateId,
          ipAddress: clientIp(req),
          userAgent: req.headers['user-agent']?.toString(),
          metadata: { event: 'system_update.backup_delete', backupPath },
          severity: 'warning',
        }).catch(() => {});

        res.json({
          success: true,
          message: 'Backup deleted successfully',
        });
      } catch (error: any) {
        console.error('[SystemUpdate] Delete backup error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete backup' });
      }
    }
  );
}
