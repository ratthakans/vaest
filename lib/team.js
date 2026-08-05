import { readRow, writeRow, deleteRow } from './plans.js';

// ── Seats that can actually be filled ────────────────────────────────────────
//
// Team was a price, not a feature. Checkout billed by quantity, the webhook stored it, and the
// plan scaled by it — and there was no way for a second person to get in. The only allowlists in
// the product are INVITED and PLAN_MAP, both hardcoded Sets requiring a redeploy, so a studio
// buying ten seats got one usable account and a bill for ten. Worse, once the plan scaled by
// quantity that one account held ten seats' worth of quota by itself.
//
// Two rows, because access resolution happens on every single request and must not scan:
//   team:<owner>    → { members: [email] }   the roster, edited by the person who pays
//   teamof:<member> → { owner }              the reverse index, read on the hot path
// They are written together; the reverse index is what resolveAccess actually consults.
//
// The whole team shares ONE usage pool — the owner's row. That is what "billed per seat" has to
// mean: ten seats buy ten times the allowance, not ten separate allowances, and certainly not ten
// times the allowance for each of ten people.

const rosterKey = owner => 'team:' + (owner || '').toLowerCase();
const memberKey = member => 'teamof:' + (member || '').toLowerCase();

export async function readRoster(owner) {
  const r = await readRow(rosterKey(owner));
  return { members: (r && Array.isArray(r.members)) ? r.members : [] };
}

// Which team, if any, does this address belong to? One read, on the request path.
export async function ownerOf(member) {
  const r = await readRow(memberKey(member));
  return (r && r.owner) || null;
}

// seats includes the owner, so a 10-seat plan has room for the owner plus 9.
export function seatsLeft(quantity, roster) {
  const q = Math.max(1, parseInt(quantity, 10) || 1);
  return Math.max(0, (q - 1) - roster.members.length);
}

export async function addMember(owner, member, quantity) {
  const o = (owner || '').toLowerCase(), m = (member || '').toLowerCase();
  if (!m || m === o) return { ok: false, error: 'That is the account that owns the plan.' };
  const roster = await readRoster(o);
  if (roster.members.includes(m)) return { ok: false, error: 'They are already on the team.' };
  if (seatsLeft(quantity, roster) <= 0) return { ok: false, error: 'Every seat on the plan is taken — add seats in billing first.' };
  // One person cannot sit on two teams: whose pool would their work meter against?
  const existing = await ownerOf(m);
  if (existing && existing !== o) return { ok: false, error: 'That address is already on another team.' };

  const next = { members: [...roster.members, m] };
  if (!(await writeRow(rosterKey(o), next))) return { ok: false, error: 'Could not save just now — try again.' };
  // The reverse index is what grants access, so if it fails the roster must not claim they are in.
  if (!(await writeRow(memberKey(m), { owner: o, addedAt: Date.now() }))) {
    await writeRow(rosterKey(o), roster);
    return { ok: false, error: 'Could not save just now — try again.' };
  }
  return { ok: true, roster: next };
}

export async function removeMember(owner, member) {
  const o = (owner || '').toLowerCase(), m = (member || '').toLowerCase();
  const roster = await readRoster(o);
  if (!roster.members.includes(m)) return { ok: true, roster };      // already gone
  // Revoke access first. If the roster write fails afterwards the person is out, which is the
  // direction an admin who just clicked "remove" expects; the reverse would leave them still in.
  await deleteRow(memberKey(m));
  const next = { members: roster.members.filter(x => x !== m) };
  await writeRow(rosterKey(o), next);
  return { ok: true, roster: next };
}
