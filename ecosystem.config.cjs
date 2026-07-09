// pm2 process config — run the bot directly (no Docker) on Windows or Linux.
//
//   npm ci && npm run build
//   pm2 start ecosystem.config.cjs
//   pm2 save                # persist the process list
//
// Secrets are read from .env in this directory (loaded by the app via dotenv),
// so keep .env alongside this file. pm2 auto-restarts on crash and (with
// `pm2 startup` / a Windows service) on machine reboot.

module.exports = {
  apps: [
    {
      name: "supermarket-ops-agent",
      script: "dist/index.js",
      cwd: __dirname,
      instances: 1, // Telegram allows only one poller per bot token
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
