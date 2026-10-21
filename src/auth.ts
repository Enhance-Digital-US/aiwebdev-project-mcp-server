import {
  OAuthError,
  type AuthInfo,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function createDevVerifier(secret: string): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      const parts = token.split('.');
      if (parts.length !== 3) {
        throw new OAuthError('invalid_token', 'Malformed JWT');
      }
      const [headerB64, payloadB64, signatureB64] = parts;

      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['verify'],
      );

      const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
      const signature = base64UrlDecode(signatureB64);
      const valid = await crypto.subtle.verify(
        'HMAC', key, signature as unknown as ArrayBuffer, data as unknown as ArrayBuffer,
      );
      if (!valid) throw new OAuthError('invalid_token', 'Invalid signature');

      const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));

      if (!payload.exp) throw new OAuthError('invalid_token', 'Missing exp claim');
      if (payload.exp < Date.now() / 1000) throw new OAuthError('invalid_token', 'Token expired');
      if (!payload.sub) throw new OAuthError('invalid_token', 'Missing sub claim');
      if (!payload.aud) throw new OAuthError('invalid_token', 'Missing aud claim');

      return {
        token,
        clientId: payload.client_id ?? 'dev-client',
        scopes: (payload.scope ?? '').split(' ').filter(Boolean),
        expiresAt: payload.exp,
        resource: payload.aud,
        extra: { sub: payload.sub },
      };
    },
  };
}

export async function createDevToken(
  secret: string,
  claims: { sub: string; scope: string; aud?: string; client_id?: string; expiresIn?: number },
): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const { expiresIn = 3600, ...rest } = claims;
  const payload = {
    ...rest,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + expiresIn,
  };

  const encode = (obj: unknown) => {
    const json = new TextEncoder().encode(JSON.stringify(obj));
    return btoa(String.fromCharCode(...json))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  };

  const headerB64 = encode(header);
  const payloadB64 = encode(payload);

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `${headerB64}.${payloadB64}.${sigB64}`;
}
