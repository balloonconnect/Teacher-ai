/**
 * Creates the first platform admin (needed to upload textbooks) on a production database that has no demo accounts.
 * Add ADMIN_RESET=1 to give an existing account a new password and the admin role.
 *   ADMIN_EMAIL=you@school.org ADMIN_NAME="Your Name" ADMIN_PASSWORD='a-long-password-1' npx tsx scripts/create-admin.ts
 * Without ADMIN_PASSWORD a random one is generated and printed once. Run it against the same DATABASE_URL as the server.
 */
import { randomBytes } from 'node:crypto';
import { openDb, q } from '../server/db';
import { hashPassword, uid } from '../server/security';
import { iso } from '../server/clock';

const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase(); const name = (process.env.ADMIN_NAME ?? 'Platform Admin').trim();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { console.error('Set ADMIN_EMAIL to a valid email address.'); process.exit(1); }
const generated = !process.env.ADMIN_PASSWORD; const password = process.env.ADMIN_PASSWORD ?? randomBytes(12).toString('base64url') + '1';
if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) { console.error('ADMIN_PASSWORD needs at least 10 characters with letters and a number.'); process.exit(1); }
const db = await openDb();
if (await q.get(db, 'SELECT 1 FROM users WHERE email=?', email)) {
  if (process.env.ADMIN_RESET !== '1') { console.error(`${email} already has an account. To make it a platform admin with a new password, run again with ADMIN_RESET=1.`); await db.close(); process.exit(1); }
  await q.run(db, "UPDATE users SET password_hash=?, role='admin', disabled=0 WHERE email=?", await hashPassword(password), email);
  console.log(`Admin reset: ${email}`); if (generated) console.log(`Temporary password (shown once, change it after signing in): ${password}`); await db.close(); process.exit(0);
}
await q.run(db, 'INSERT INTO users(id,email,display_name,password_hash,role,school_id,consent_at,created_at,is_demo) VALUES (?,?,?,?,?,?,?,?,0)', uid(), email, name, await hashPassword(password), 'admin', null, iso(), iso());
console.log(`Admin created: ${email}`); if (generated) console.log(`Temporary password (shown once, change it after signing in): ${password}`);
await db.close(); process.exit(0);
