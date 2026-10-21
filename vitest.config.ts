import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      // Top level of wrangler.jsonc = the development environment.
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        // Test-only secrets; these override anything in .dev.vars.
        bindings: {
          AUTH_SECRET: 'test-secret',
          PERSONA_PASSWORD_ADMIN: 'admin-pw-test',
          PERSONA_PASSWORD_MEMBER: 'member-pw-test',
          PERSONA_PASSWORD_VIEWER: 'viewer-pw-test',
        },
      },
    }),
  ],
  test: {
    setupFiles: ['./test/setup.ts'],
  },
});
