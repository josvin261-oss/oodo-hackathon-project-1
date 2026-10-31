# Security & multi-user notes

This app is a **pure client-side, single-file-per-browser** app: there is no
server, and `localStorage`/`sessionStorage` are the *entire* database and
session store. That architecture is what makes the "no backend, works from
`file://`" pitch possible — but it also means **no check in `js/engine.js`
is actually enforced**. Every "only an admin can…" guard runs in the same
JavaScript the browser hands to the end user, so it can be bypassed from the
DevTools console by design, not by a bug. Two concrete demonstrations:

```js
// 1) Grant yourself admin with no password at all, from any logged-out tab:
const anyAdminId = JSON.parse(localStorage.getItem('brightloop_db_v1')).users
  .find(u => u.role === 'admin').id;
sessionStorage.setItem('brightloop_session_v1', JSON.stringify({ userId: anyAdminId }));
location.reload(); // now "logged in" as that admin, no credentials checked

// 2) Call the "admin-only" API directly, lying about who's calling:
BL.Auth.addStaff({ name: 'x', email: 'x@x.com', password: 'Xx1!aaaa', role: 'admin' },
                  { role: 'admin' }); // the "actingUser" check trusts whatever object you pass
```

Both were verified against this codebase while preparing this patch.

## Fixed in this pass (client-side, no backend required)

| Issue | Fix |
|---|---|
| Password hashing was a single salted SHA-256 pass (fast to brute-force if the DB ever leaks) | Switched to PBKDF2-SHA256, 150,000 iterations (`js/db.js`) |
| Login told you *which* error you hit ("no account" vs "incorrect password") — email enumeration | Both now return one generic `"Incorrect email or password."` (`js/engine.js`) |
| Demo customer logins (`priya@acme.com`, `daniel@nimbus.io`, `fatima@koru.co`) had **no subscriptions linked** — "My Subscriptions" was always empty | Seeded subscriptions for "Acme Retail" / "Nimbus Labs" / "Koru Collective" now carry the matching `customerEmail` (`js/db.js`) |
| Dead variable in the billing loop | Removed (`js/engine.js`) |

Verified with a Node-level harness exercising `db.js`/`engine.js` directly,
and a full Playwright run through the real UI (login, billing run, staff
creation, customer portal, login-error copy) — zero console/page errors.

## NOT fixable without a backend

These are inherent to "no server" and are **not** bugs in this codebase —
they're the trade-off of the architecture:

- **Anyone with access to the browser/device can read or edit the entire
  database**, including every user's password hash, via DevTools.
- **Role checks (`admin`/`staff`/`customer`) are UI conveniences, not
  security boundaries** — see the two snippets above.
- **The "forgot password" flow hands the reset link straight back to
  whoever typed the email**, because there's no mail server to send it to
  the real owner. Typing `admin@brightloop.com` into "Forgot password" lets
  anyone set a new admin password on the spot.
- **Data never leaves one browser.** Two people — even two admins — looking
  at "the same" Brightloop instance on two different computers are actually
  looking at two completely separate, unsynced datasets.

## What "real" multi-user auth requires

For actual users (plural) to share data and have roles that mean something,
business logic has to move server-side:

1. A small backend (Vercel Serverless Functions, or any Node/Express API)
   that owns the database — not the browser.
2. Password checks and role checks happen **on the server**, never trusting
   anything the client sends about who it claims to be.
3. Sessions become signed, `httpOnly` cookies (or JWTs) issued by the
   server — not a plain object in `sessionStorage` the client can edit.
4. Password reset actually emails a time-limited token (e.g. via Resend/
   Postgres + a mail provider) instead of displaying it on-screen.
5. Data lives in a real database (Vercel Postgres, Neon, Supabase, etc.)
   shared by every user/device, instead of one `localStorage` blob per
   browser.

That's a genuine backend build, not a patch — happy to scaffold it
(Vercel Functions + Postgres, bcrypt/argon2, server-verified roles) as a
next step if you want this to be a real multi-user product rather than a
single-browser demo/prototype.
