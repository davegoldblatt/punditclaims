// The page relays answer only a GitHub Actions run from this repository
// (functions/feeds/_middleware.js). These cases sign tokens with a local key
// and check what the relay accepts and refuses.
import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto as crypto } from "node:crypto";
// @ts-expect-error a plain JavaScript Pages function
import { verifyToken, onRequest } from "../functions/feeds/_middleware.js";

const ISSUER = "https://token.actions.githubusercontent.com";
const AUD = "https://example.test";
const b64u = (b: ArrayBuffer | string) => Buffer.from(typeof b === "string" ? b : new Uint8Array(b)).toString("base64url");
const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "k1" };
const now = Math.floor(Date.now() / 1000);
async function token(claims: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", kid: "k1", typ: "JWT" }, key = pair.privateKey) {
  const body = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(claims))}`;
  return `${body}.${b64u(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(body)))}`;
}
const good = { iss: ISSUER, aud: AUD, exp: now + 300, nbf: now - 5, repository: "davegoldblatt/punditclaims" };

test("a valid run token is accepted and its claims returned", async () => {
  const c = await verifyToken(await token(good), AUD, [jwk]);
  assert.equal(c?.repository, "davegoldblatt/punditclaims");
});
test("wrong audience, issuer, expiry, key, algorithm and tampering are refused", async () => {
  assert.equal(await verifyToken(await token({ ...good, aud: "https://elsewhere.test" }), AUD, [jwk]), null);
  assert.equal(await verifyToken(await token({ ...good, iss: "https://evil.test" }), AUD, [jwk]), null);
  assert.equal(await verifyToken(await token({ ...good, exp: now - 1 }), AUD, [jwk]), null);
  assert.equal(await verifyToken(await token(good, { alg: "RS256", kid: "other" }), AUD, [jwk]), null);
  assert.equal(await verifyToken(await token(good, { alg: "none", kid: "k1" }), AUD, [jwk]), null);
  const other = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  assert.equal(await verifyToken(await token(good, undefined, other.privateKey), AUD, [jwk]), null);
  const t = await token(good);
  const [h, , s] = t.split(".");
  assert.equal(await verifyToken(`${h}.${b64u(JSON.stringify({ ...good, repository: "someone/fork" }))}.${s}`, AUD, [jwk]), null);
  assert.equal(await verifyToken("not-a-token", AUD, [jwk]), null);
});
test("the relay refuses a request with no token and lets the open feed through", async () => {
  const next = async () => new Response("ok", { headers: { "Cache-Control": "public, max-age=900" } });
  const guarded = await onRequest({ request: new Request(`${AUD}/feeds/substack-post/name/slug`), env: {}, next });
  assert.equal(guarded.status, 404);
  const archive = await onRequest({ request: new Request(`${AUD}/feeds/substack-archive/name?x=1`, { headers: { Authorization: "Bearer short" } }), env: {}, next });
  assert.equal(archive.status, 404);
  const open = await onRequest({ request: new Request(`${AUD}/feeds/substack/name`), env: {}, next });
  assert.equal(await open.text(), "ok");
});
