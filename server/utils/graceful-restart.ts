let restartScheduled = false;
let restartTimer: ReturnType<typeof setTimeout> | null = null;

const RESTART_DELAY_MS = 2000;

export function scheduleGracefulRestart(reason: string) {
  if (restartScheduled) {
    console.log(`[GracefulRestart] Restart already scheduled, coalescing: ${reason}`);
    return;
  }

  restartScheduled = true;
  console.log(`[GracefulRestart] Server restart scheduled in ${RESTART_DELAY_MS}ms - ${reason}`);

  restartTimer = setTimeout(() => {
    console.log(`[GracefulRestart] Initiating graceful shutdown - ${reason}`);

    const httpServer = (global as any).__httpServer;
    if (httpServer) {
      httpServer.close(() => {
        console.log(`[GracefulRestart] HTTP server closed, exiting process`);
        process.exit(0);
      });

      setTimeout(() => {
        console.log(`[GracefulRestart] Forced exit after timeout`);
        process.exit(0);
      }, 5000);
    } else {
      process.exit(0);
    }
  }, RESTART_DELAY_MS);
}

export function isRestartScheduled(): boolean {
  return restartScheduled;
}
