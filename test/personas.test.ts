import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { PERSONAS, findPersona, passwordFingerprint, verifyPersonaPassword } from '../src/personas.js';

describe('mcp-authorization: simulated personas', () => {
  it('defines exactly Alice (admin), Bob (member) and Carol (viewer)', () => {
    expect(PERSONAS.map((p) => [p.id, p.name, p.role])).toEqual([
      ['user-alice', 'Alice', 'admin'],
      ['user-bob', 'Bob', 'member'],
      ['user-carol', 'Carol', 'viewer'],
    ]);
  });

  it('accepts the configured password', async () => {
    const persona = await verifyPersonaPassword(env, 'user-carol', 'viewer-pw-test');
    expect(persona?.id).toBe('user-carol');
  });

  it('rejects a wrong password', async () => {
    expect(await verifyPersonaPassword(env, 'user-carol', 'wrong')).toBeNull();
  });

  it('rejects an unknown persona', async () => {
    expect(findPersona('user-mallory')).toBeUndefined();
    expect(await verifyPersonaPassword(env, 'user-mallory', 'viewer-pw-test')).toBeNull();
  });

  it.each([['' as const], [undefined]])('blocks sign-in when the password is not configured (%j)', async (unset) => {
    const unconfigured = { ...env, PERSONA_PASSWORD_MEMBER: unset as string };
    expect(await verifyPersonaPassword(unconfigured, 'user-bob', '')).toBeNull();
    expect(await passwordFingerprint(unconfigured, findPersona('user-bob')!)).toBeNull();
  });

  it('changes the fingerprint when the password changes', async () => {
    const carol = findPersona('user-carol')!;
    const before = await passwordFingerprint(env, carol);
    const after = await passwordFingerprint({ ...env, PERSONA_PASSWORD_VIEWER: 'rotated' }, carol);
    expect(before).toMatch(/^[0-9a-f]{16}$/);
    expect(after).not.toBe(before);
  });
});
