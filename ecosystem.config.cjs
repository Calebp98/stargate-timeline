module.exports = {
    apps: [{
      name: 'stargate-timeline',
      script: './dist/server/entry.mjs',
      cwd: '/home/hello/stargate-timeline',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOST: '0.0.0.0'
      },
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_file: './logs/combined.log',
      time: true
    }]
  }
