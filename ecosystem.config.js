module.exports = {
  apps: [
    {
      name: 'wasabi-crm',
      script: 'node_modules/next/dist/bin/next',
      args: 'start --port 3000',
      cwd: __dirname,
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
      },
      // Restart automatically on crash
      autorestart: true,
      // Wait 3s before restarting after a crash
      restart_delay: 3000,
      // Maximum restarts in 15 min window before giving up
      max_restarts: 10,
      min_uptime: '10s',
      // Logs
      out_file: 'logs/pm2-out.log',
      error_file: 'logs/pm2-error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
}
