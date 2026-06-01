// @ts-check
import { defineConfig } from 'astro/config';

// Static site (default). The redirect tracer runs as a Netlify function in
// netlify/functions, so no Astro adapter is needed.
export default defineConfig({
  site: 'https://liltrace.netlify.app',
});
