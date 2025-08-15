module.exports = {
  apps: [
    {
      name: "stargate_timeline",
      script: "dist/server/entry.mjs",
      interpreter: "node",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        PORT: "8080"
        // add any other runtime env here, e.g. API_URL, DATABASE_URL, etc.
      },
      instances: 1,     // set to "max" ONLY if your SSR is stateless
      exec_mode: "fork",
      watch: false,
      restart_delay: 3000
    }
  ]
}

