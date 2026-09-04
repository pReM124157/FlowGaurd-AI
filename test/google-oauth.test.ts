import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { handleRequest } from "../src/server/api.ts";
import { resetGoogleOAuthForTests } from "../src/server/google-oauth.ts";

const BASE = "http://localhost:3000";
const originalFetch = globalThis.fetch;

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "test-secret";
  process.env.GOOGLE_REDIRECT_URI = "http://localhost:3000/auth/google/callback";
  resetGoogleOAuthForTests();
});

afterEach(() => { globalThis.fetch = originalFetch; });

describe("Google OAuth", () => {
  it("starts a server-controlled authorization and binds state to an HttpOnly cookie", async () => {
    const response = await handleRequest(new Request(`${BASE}/auth/google`));
    assert.equal(response.status, 302);
    const location = new URL(response.headers.get("location") ?? "");
    assert.equal(location.origin, "https://accounts.google.com");
    assert.ok(location.searchParams.get("state"));
    const cookie = response.headers.getSetCookie().join("\n");
    assert.match(cookie, /fg_oauth_state=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
  });

  it("rejects callbacks without the matching browser-bound state", async () => {
    const start = await handleRequest(new Request(`${BASE}/auth/google`));
    const state = new URL(start.headers.get("location") ?? "").searchParams.get("state");
    const response = await handleRequest(new Request(`${BASE}/auth/google/callback?code=code&state=${state}`));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "FG_OAUTH_INVALID_STATE");
  });

  it("creates an account, links a returning identity, and issues a server session", async () => {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") return Response.json({ id_token: "verified-id-token" });
      if (url.startsWith("https://oauth2.googleapis.com/tokeninfo")) return Response.json({ sub: "google-sub-1", email: "person@example.com", email_verified: "true", name: "Person", aud: process.env.GOOGLE_CLIENT_ID, iss: "https://accounts.google.com" });
      throw new Error("Unexpected request");
    };

    const first = await completeOAuth();
    assert.equal(first.response.status, 302);
    assert.equal(first.response.headers.get("location"), "/pages/onboarding.html");
    const sessionCookie = first.response.headers.getSetCookie().find((value) => value.startsWith("fg_session=")) ?? "";
    assert.match(sessionCookie, /HttpOnly/);
    assert.match(sessionCookie, /SameSite=Lax/);

    const me = await handleRequest(new Request(`${BASE}/api/me`, { headers: { cookie: sessionCookie.split(";")[0] } }));
    assert.equal(me.status, 200);
    const firstUser = (await me.json()).user;
    assert.equal(firstUser.email, "person@example.com");

    const second = await completeOAuth();
    const secondSession = second.response.headers.getSetCookie().find((value) => value.startsWith("fg_session=")) ?? "";
    const linked = await handleRequest(new Request(`${BASE}/api/me`, { headers: { cookie: secondSession.split(";")[0] } }));
    assert.equal((await linked.json()).user.userId, firstUser.userId);
  });

  it("invalidates its server session on logout and protects dashboard resources", async () => {
    const protectedPage = await handleRequest(new Request(`${BASE}/pages/dashboard.html`));
    assert.equal(protectedPage.status, 302);
    assert.match(protectedPage.headers.get("location") ?? "", /pages\/login\.html/);

    const logout = await handleRequest(new Request(`${BASE}/auth/logout`, { method: "POST", headers: { cookie: "fg_session=missing" } }));
    assert.equal(logout.status, 204);
    assert.match(logout.headers.get("set-cookie") ?? "", /Max-Age=0/);
  });
});

async function completeOAuth() {
  const start = await handleRequest(new Request(`${BASE}/auth/google`));
  const state = new URL(start.headers.get("location") ?? "").searchParams.get("state") ?? "";
  const stateCookie = start.headers.getSetCookie().find((value) => value.startsWith("fg_oauth_state="))?.split(";")[0] ?? "";
  const response = await handleRequest(new Request(`${BASE}/auth/google/callback?code=code&state=${encodeURIComponent(state)}`, { headers: { cookie: stateCookie } }));
  return { response };
}
