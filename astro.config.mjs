// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: node({
    mode: 'standalone'
  }),
  base: '/stargate-timeline',
  server: {
    port: 4321,
    host: true
  },
  vite: {
    server: {
      host: true,
      allowedHosts: ['calebparikh.xyz', 'www.calebparikh.xyz', 'localhost', '127.0.0.1']
    }
  }
});
