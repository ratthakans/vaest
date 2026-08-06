import { SB } from '../lib/plans.js';

// The client's half of "which database is this?".
//
// js/app.js is a static file with no build step, so the Supabase address could not be injected at
// deploy time — it was compiled in, and every environment therefore shared one project's data.
// This is the smallest thing that fixes it: the client asks, once, at boot, and keeps its
// compiled-in production values if the answer never comes. A staging deployment sets SUPABASE_URL
// and SUPABASE_ANON_KEY on Preview scope and its client follows without a code change.
//
// Nothing secret is served. The publishable key already ships inside the bundle to every visitor;
// that is what publishable means. The service-role key is not here and must never be.
export default function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'GET only' }); return; }
  // Short cache: long enough that a reload is free, short enough that repointing an environment
  // takes effect within a minute rather than whenever a browser feels like it.
  res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate');
  res.status(200).json({ supabaseUrl: SB.url, supabaseKey: SB.key });
}
