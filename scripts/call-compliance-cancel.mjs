/**
 * Authenticated POST to /api/compliance/cancel (stopAll).
 * Usage: node scripts/call-compliance-cancel.mjs
 */
const BASE = process.env.APP_URL ?? "http://localhost:3000";
const USER = process.env.SEED_ADMIN_USERNAME ?? "admin";
const PASS = process.env.SEED_ADMIN_PASSWORD ?? "admin123";

function parseCookies(setCookieHeaders) {
  const jar = new Map();
  for (const line of setCookieHeaders) {
    const part = line.split(";")[0];
    const eq = part.indexOf("=");
    if (eq > 0) jar.set(part.slice(0, eq), part.slice(eq + 1));
  }
  return jar;
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function main() {
  const jar = new Map();

  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const csrfBody = await csrfRes.json();
  for (const h of csrfRes.headers.getSetCookie?.() ?? []) {
    for (const [k, v] of parseCookies([h])) jar.set(k, v);
  }

  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader(jar),
    },
    body: new URLSearchParams({
      csrfToken: csrfBody.csrfToken,
      username: USER,
      password: PASS,
      json: "true",
    }),
    redirect: "manual",
  });

  for (const h of loginRes.headers.getSetCookie?.() ?? []) {
    for (const [k, v] of parseCookies([h])) jar.set(k, v);
  }

  if (loginRes.status !== 200 && loginRes.status !== 302) {
    const text = await loginRes.text();
    throw new Error(`Login failed (${loginRes.status}): ${text.slice(0, 200)}`);
  }

  console.log("Logged in, calling POST /api/compliance/cancel ...");

  const cancelRes = await fetch(`${BASE}/api/compliance/cancel`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader(jar),
    },
    body: JSON.stringify({ stopAll: true }),
  });

  const cancelBody = await cancelRes.json().catch(() => ({}));
  console.log(`Cancel response (${cancelRes.status}):`, JSON.stringify(cancelBody, null, 2));

  if (!cancelRes.ok) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
