// Viewers: how someone signed in to ohm is recognised on a member's own website, so the site can
// show them what that member shares with friends.
//
// A site cannot read the viewer's ohm session: it lives on ohm's address. So ohm hands the site a
// viewer token instead, by sending the viewer's browser back to the site with it:
//
//   1. The site sends the viewer to /vault/xrpc/com.ohmmmm.content.view?owner=<DID>&return=<address>.
//   2. ohm reads who is signed in, makes a token for that viewer and that one member, and posts it
//      back to the return address. The address must be one of the member's own sites, which only
//      the member, signed in to ohm, lists.
//   3. The site's server keeps the token (in its own cookie) and sends it with content reads.
//
// A token names the viewer's DID and one member's, and lasts ten minutes. It proves only who the
// viewer is: whether they may see Friends is checked against the friend list on every read, so
// removing a friend takes effect at once. It never carries the session or any key.
//
// `db` has the shape of a Cloudflare D1 database; `secret` is the service's VIEWER_TOKEN_SECRET.
import { Refused } from './store.mjs';

export const LASTS = 10 * 60;
const DID = /^did:[a-z]+:[A-Za-z0-9._:%-]+$/;
const encoder = new TextEncoder();
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const unb64 = text => Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));

async function keyOf(secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Refused(503, 'ViewersUnavailable', 'Friends reads are not set up on this service');
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function makeViewerToken(secret, { viewer, owner, now = Date.now() }) {
  const body = b64(encoder.encode(JSON.stringify({ aud: 'com.ohmmmm.content', viewer, owner, exp: Math.floor(now / 1000) + LASTS })));
  return `${body}.${b64(await crypto.subtle.sign('HMAC', await keyOf(secret), encoder.encode(body)))}`;
}

// The viewer a token proves, for reading `owner`'s content. Refused, never guessed, if it does not.
export async function viewerOf(secret, token, owner, { now = Date.now() } = {}) {
  const invalid = () => { throw new Refused(401, 'ViewerTokenInvalid', 'The viewer token is not valid for this member, or has run out. Send the viewer to ohm again'); };
  const [body, signature, more] = String(token).split('.');
  if (!body || !signature || more !== undefined) invalid();
  let ok = false;
  try { ok = await crypto.subtle.verify('HMAC', await keyOf(secret), unb64(signature), encoder.encode(body)); } catch (problem) { if (problem instanceof Refused) throw problem; }
  if (!ok) invalid();
  let claims;
  try { claims = JSON.parse(new TextDecoder().decode(unb64(body))); } catch { invalid(); }
  if (claims?.aud !== 'com.ohmmmm.content' || claims.owner !== owner || !DID.test(claims.viewer ?? '') || !(claims.exp > now / 1000)) invalid();
  return claims.viewer;
}

// The member's own sites: the only addresses a viewer token is ever sent to.
export function siteStore(db) {
  const originOf = value => {
    let url;
    try { url = new URL(value); } catch { throw new Refused(400, 'InvalidRequest', 'A site is an https address'); }
    if (url.protocol !== 'https:' || url.username || url.password) throw new Refused(400, 'InvalidRequest', 'A site is an https address');
    return url.origin;
  };
  return {
    originOf,
    async list(did) {
      const { results } = await db.prepare('SELECT origin, added_at FROM sites WHERE did = ?1 ORDER BY origin').bind(did).all();
      return { sites: results.map(row => ({ origin: row.origin, added: row.added_at })) };
    },
    async add(did, value, { now = new Date() } = {}) {
      const origin = originOf(value);
      const result = await db.prepare('INSERT INTO sites (did, origin, added_at) VALUES (?1, ?2, ?3) ON CONFLICT (did, origin) DO NOTHING').bind(did, origin, now.toISOString()).run();
      return { origin, ...(result.meta.changes ? {} : { unchanged: true }) };
    },
    async remove(did, value) {
      const origin = originOf(value);
      const result = await db.prepare('DELETE FROM sites WHERE did = ?1 AND origin = ?2').bind(did, origin).run();
      return { origin, ...(result.meta.changes ? { removed: true } : { unchanged: true }) };
    },
    // The return address, if it is one of the owner's sites; refused otherwise.
    async returnTo(owner, value) {
      const origin = originOf(value);
      const held = await db.prepare('SELECT 1 AS yes FROM sites WHERE did = ?1 AND origin = ?2').bind(owner, origin).first();
      if (!held) throw new Refused(400, 'NotTheirSite', 'That address is not one of this member\'s sites');
      return new URL(value).href;
    },
  };
}

// The page that hands the token to the site: a form posted back to the return address, so the
// token is never left in an address bar or a log. It sends `viewer`, or `error` when there is no
// token to give (not signed in, or no AT Protocol account connected).
export function handBack(returnTo, fields) {
  const nonce = b64(crypto.getRandomValues(new Uint8Array(16)));
  const escape = value => String(value).replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
  const inputs = Object.entries(fields).map(([name, value]) => `<input type="hidden" name="${escape(name)}" value="${escape(value)}">`).join('');
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Back to the site</title></head>`
    + `<body><form method="post" action="${escape(returnTo)}">${inputs}<button type="submit">Continue to the site</button></form>`
    + `<script nonce="${nonce}">document.forms[0].submit()</script></body></html>`;
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; form-action ${new URL(returnTo).origin}; frame-ancestors 'none'; base-uri 'none'`,
    },
  });
}
