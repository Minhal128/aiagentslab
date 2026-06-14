/**
 * PM2 Ecosystem Configuration for AgentLabs (PRODUCTION)
 * 
 * This file configures PM2 process manager for production deployment:
 * - Auto-restart on crash or memory limits exceeded
 * - Dynamic memory limit (75% of system RAM)
 * - Graceful shutdown handling
 * - Log management
 * 
 * IMPORTANT: You must build before starting!
 * 
 * Production Deployment Steps:
 *   1. npm install
 *   2. node scripts/build-plugin-backend.js   (compile plugins)
 *   3. npm run build                          (build frontend + server)
 *   4. pm2 start ecosystem.config.cjs         (start with PM2)
 * 
 * If plugins have database migrations:
 *   psql $DATABASE_URL -f plugins/team-management/migrations/001_team_tables.sql
 * 
 * PM2 Commands:
 *   pm2 start ecosystem.config.cjs    - Start the application
 *   pm2 restart agentlabs             - Restart the application
 *   pm2 stop agentlabs                - Stop the application
 *   pm2 logs agentlabs                - View logs
 *   pm2 monit                         - Monitor in terminal
 *   pm2 status                        - Check status
 */

const os = require('os');

const totalMemoryBytes = os.totalmem();
const totalMemoryGB = totalMemoryBytes / (1024 * 1024 * 1024);
const memoryLimitGB = Math.max(1, Math.floor(totalMemoryGB * 0.75));
const memoryLimitString = `${memoryLimitGB}G`;

console.log(`[PM2 Config] System RAM: ${totalMemoryGB.toFixed(2)} GB`);
console.log(`[PM2 Config] Memory Limit (75%): ${memoryLimitString}`);

module.exports = {
  apps: [{
    name: 'agentlabs',
    script: 'dist/index.js',
    
    env: {
      NODE_ENV: 'production',
      PORT: 5000,
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 5000,
    },
    
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    restart_delay: 1000,
    
    max_memory_restart: memoryLimitString,
    
    watch: false,
    ignore_watch: ['node_modules', 'logs', '.git', 'dist'],
    
    kill_timeout: 10000,
    wait_ready: true,
    listen_timeout: 10000,
    
    error_file: 'logs/pm2-error.log',
    out_file: 'logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    
    instances: 1,
    exec_mode: 'fork',
    
    exp_backoff_restart_delay: 100,
  }]
};
