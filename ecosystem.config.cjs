module.exports = {
  apps: [{
    name: 'stargate-timeline',
    script: './dist/server/entry.mjs',
    cwd: '/home/hello/stargate-timeline',
    env: {
      NODE_ENV: 'production',
      PORT: 4321,
      HOST: '0.0.0.0'
    },
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '1G',
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }]
};