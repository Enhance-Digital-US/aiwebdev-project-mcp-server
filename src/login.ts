import { AuthorizationError, CimdFetchError, type ConsentDescription } from '@cloudflare/workers-oauth-provider';
import type { Hono } from 'hono';
import type { Bindings } from './index.js';
import { getAuthorizationServer, type AuthProps } from './oauth.js';
import { PERSONAS, passwordFingerprint, verifyPersonaPassword } from './personas.js';

// The persona login is also the OAuth consent page: the student picks a
// simulated user, proves it with that persona's password, and allows the
// client to act as them. Follows the library's docs/consent-page.md.

const LOGIN_FAILED = 'Incorrect persona or password.';

const ROLE_HINTS: Record<string, string> = {
  admin: 'can do everything, including delete projects',
  member: 'can create and edit issues',
  viewer: 'read-only',
};

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const NO_FRAMING = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': "frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
};

export function renderLoginPage(details: ConsentDescription, handle: string, error?: string): string {
  const client = escape(details.clientName);
  const origin = details.clientDomain
    ? `Published by <strong>${escape(details.clientDomain)}</strong>.`
    : 'This app registered itself; its name is not verified.';
  const personas = PERSONAS.map(
    (persona, i) =>
      `<label><input type="radio" name="persona" value="${escape(persona.id)}"${i === 0 ? ' checked' : ''}> ` +
      `${escape(persona.name)} — ${persona.role} (${ROLE_HINTS[persona.role]})</label>`,
  ).join('<br>');
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in to Issue Tracker MCP</title>
<h1>Sign in to Issue Tracker MCP</h1>
<p><strong>${client}</strong> wants to use the issue tracker as you. ${origin}
Access will be sent to <strong>${escape(details.redirectHost)}</strong>.</p>
${details.redirectIsLoopback ? '<p><strong>This sends access to an app on your computer.</strong> Continue only if you just started signing in from it.</p>' : ''}
${error ? `<p role="alert"><strong>${escape(error)}</strong></p>` : ''}
<form method="post">
  <input type="hidden" name="handle" value="${escape(handle)}">
  <fieldset>
    <legend>Sign in as</legend>
    ${personas}
  </fieldset>
  <p><label>Password <input type="password" name="password" autocomplete="current-password"></label></p>
  <p><button name="decision" value="approve">Sign in and allow</button> <button name="decision" value="deny">Deny</button></p>
</form>`;
}

function errorPage(message: string, status: number): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Sign-in problem</title><p>${escape(message)}</p>` +
      '<p>Start signing in again from your MCP client.</p>',
    { status, headers: NO_FRAMING },
  );
}

// Errors from the library: redirect only when it has validated where to send them.
function handleAuthorizationError(error: unknown): Response {
  if (error instanceof AuthorizationError && error.redirectTo) {
    return Response.redirect(error.redirectTo, 302);
  }
  if (error instanceof AuthorizationError) return errorPage(error.description, 400);
  if (error instanceof CimdFetchError) return errorPage('This app could not be verified.', 400);
  throw error; // a bug or an outage: let it surface as a 500
}

export function registerLoginRoutes(app: Hono<{ Bindings: Bindings }>): void {
  app.get('/authorize', async (c) => {
    try {
      const oauth = getAuthorizationServer(c.env).getOAuthApi(c.env);
      const request = await oauth.parseAuthRequest(c.req.raw);
      const details = await oauth.describeConsent(request);
      const consent = await oauth.beginConsent(request);
      for (const [name, value] of Object.entries(NO_FRAMING)) consent.headers.set(name, value);
      return new Response(renderLoginPage(details, consent.handle), { headers: consent.headers });
    } catch (error) {
      return handleAuthorizationError(error);
    }
  });

  app.post('/authorize', async (c) => {
    try {
      const oauth = getAuthorizationServer(c.env).getOAuthApi(c.env);
      const form = await c.req.formData();
      const handle = String(form.get('handle') ?? '');

      if (form.get('decision') !== 'approve') {
        const denied = await oauth.denyConsent(c.req.raw, handle);
        denied.headers.set('Location', denied.redirectTo);
        return new Response(null, { status: 302, headers: denied.headers });
      }

      const persona = await verifyPersonaPassword(
        c.env,
        String(form.get('persona') ?? ''),
        String(form.get('password') ?? ''),
      );
      if (!persona) {
        // The handle is only spent by approve/deny, so the same form can be shown again.
        const request = await oauth.parseAuthRequest(c.req.raw);
        const details = await oauth.describeConsent(request);
        return new Response(renderLoginPage(details, handle, LOGIN_FAILED), { status: 401, headers: NO_FRAMING });
      }

      // The role comes from the persona, never from what the client asked for.
      const scope = [persona.role];
      const approved = await oauth.approveConsent(c.req.raw, handle, { scope });
      const props: AuthProps = {
        userId: persona.id,
        role: persona.role,
        pwfp: await passwordFingerprint(c.env, persona),
      };
      const { redirectTo } = await oauth.completeAuthorization({
        request: approved.request, // from storage, not from the form
        userId: persona.id,
        metadata: { persona: persona.id },
        scope,
        props,
      });
      approved.headers.set('Location', redirectTo);
      return new Response(null, { status: 302, headers: approved.headers });
    } catch (error) {
      return handleAuthorizationError(error);
    }
  });
}
