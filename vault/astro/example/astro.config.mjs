import { defineConfig } from 'astro/config';
export default defineConfig({ site: process.env.OHM_SITE || 'https://alice.example.com' });
