import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('test harness', () => {
  it('runs inside the Workers runtime with test bindings', () => {
    expect(env.ENVIRONMENT).toBe('development');
    expect(env.AUTH_SECRET).toBe('test-secret');
  });

  it('applies schema.sql before each test file', async () => {
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM projects').first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});
