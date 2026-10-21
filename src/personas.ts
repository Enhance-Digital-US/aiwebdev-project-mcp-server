import type { Role } from './store.js';

export type { Role };

// Simulated users for the course. There are no real accounts: a student signs
// in as one of these personas, and the persona's role becomes the token scope.
export interface Persona {
  id: string;
  name: string;
  role: Role;
  secret: 'PERSONA_PASSWORD_ADMIN' | 'PERSONA_PASSWORD_MEMBER' | 'PERSONA_PASSWORD_VIEWER';
}

export const PERSONAS: readonly Persona[] = [
  { id: 'user-alice', name: 'Alice', role: 'admin', secret: 'PERSONA_PASSWORD_ADMIN' },
  { id: 'user-bob', name: 'Bob', role: 'member', secret: 'PERSONA_PASSWORD_MEMBER' },
  { id: 'user-carol', name: 'Carol', role: 'viewer', secret: 'PERSONA_PASSWORD_VIEWER' },
];

export type PersonaSecrets = Record<Persona['secret'], string | undefined>;

export function findPersona(id: string): Persona | undefined {
  return PERSONAS.find((persona) => persona.id === id);
}

async function sha256(text: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
}

// Hashing both sides first gives equal-length inputs, so the comparison takes
// the same time however much of the guess is right.
export async function verifyPersonaPassword(
  env: PersonaSecrets,
  personaId: string,
  password: string,
): Promise<Persona | null> {
  const persona = findPersona(personaId);
  if (!persona) return null;
  const expected = env[persona.secret];
  if (!expected) return null; // an unconfigured password never matches, not even ''
  const [a, b] = await Promise.all([sha256(password), sha256(expected)]);
  return crypto.subtle.timingSafeEqual(a, b) ? persona : null;
}

// Stored in each grant at login. When the persona's password is rotated the
// fingerprint changes, and tokens issued under the old password stop working.
export async function passwordFingerprint(env: PersonaSecrets, persona: Persona): Promise<string | null> {
  const password = env[persona.secret];
  if (!password) return null;
  const digest = new Uint8Array(await sha256(`${persona.id}:${password}`));
  return Array.from(digest.slice(0, 8), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
