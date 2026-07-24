# VÆST — working constitution

VÆST is the idea-crystallizing **instrument** of the studio **ORIONS.Agency**. It is not
"AI that writes." It is a **taste instrument** for creative studios: brief → client-ready
document, in one voice. The north star is one phrase — *considered down to the inch*.

Live at **vaest.orions.agency** · root `/` serves the app (`index.html`); marketing is `/home`.
Stack: static `index.html` + plain-script `js/app.js` (NOT a module — validate with `node --check`)
+ `css/app.css` · Vercel serverless (`api/*`, ESM, region sin1) · Supabase (auth + Postgres REST + RLS)
· Anthropic SDK behind all three white-label engines (+ Gemini for the tiny `tag` topic label).

## The laws (broken these before — cost real rework)

1. **Never leak a model / provider id — to anyone, internal included.** The engines are the
   product — **three** now, all on Anthropic: **Galdr** (the mind you think with · Idea sandbox +
   Think pushes + taste/voice distillation), **Odin** (every word on the page · Crystallize, the
   only engine that writes the canvas), **Norrsken** (the last light before it ships · Refine +
   Present). Show engine name + role + version only. The model behind them is ours.
   (See `renderAbout`, `ENGINES`.)

2. **Critic ≠ writer.** Galdr and Norrsken only ever *propose*; **Odin writes every word that
   lands on the canvas.** That separation is why one document keeps one voice and why the
   critique is honest. Never let a critic engine write to the canvas.

3. **Calm comes first.** The user has repeatedly rejected clutter. Do NOT add: horizontal card
   strips, heavy bold, mono-glyph headers, tag-chip rows, long explanatory captions the UI
   already implies, feature grids on the marketing pages. When adding UI, reuse an existing
   calm pattern; never invent a new visual language. Hide anything the interface already shows.

4. **Serif is VÆST's writing voice.** Everything VÆST *writes* (chat replies, the canvas) is
   serif (Newsreader / Noto Serif Thai) at a warm off-white (`--ink #e6e0d3`, body `#d9d4c9`).
   Sans (Inter / IBM Plex Sans Thai Looped) is UI chrome only. Never make VÆST's prose sans,
   and never use pure `#fff` for text (it halates, esp. Thai).

5. **Margin floor 30%.** Every paid path is metered in real baht; the monthly spend cap =
   **70% of plan price** (`PLANS[x].spendCap`). Any price/entitlement change MUST keep
   `spendCap = 0.70 × price`. Quality-first routing is fine *because* the cap guarantees margin —
   spend where the user can see it (paid Idea, Brief interview, deck), never on invisible plumbing.

6. **Ship + verify on production, in a browser.** Workflow every change: `node --check js/app.js`
   → `npm test` (unit + server billing/margin math + `tests/ssrf.mjs` + `tests/audit.mjs`,
   which must print `AUDIT CLEAN` — it enforces law #1 and #4 mechanically) → **for anything that
   takes untrusted input or touches money, a deliberate adversarial review before shipping** (a
   guard that merely exists is not a guard: /api/extract shipped "SSRF-guarded" and was fully
   exploitable) →
   commit → push → poll the deploy READY → **open it in the browser and look**, because login and
   payment can't be scripted. `curl` sometimes hits a Vercel bot checkpoint — the browser passes it.

## Anatomy

- **Three modes** (`item.mode`): **idea** (single Galdr chat) · **brief** (VÆST interviews you →
  compiled brief; Brief's identity is *asking questions back*) · **crystallize** (desk → canvas →
  Think/Refine). Mode switch = a segmented control at the **top of the rail, above New**.
- **Rail = 284px** and `.app` grid column MUST equal it (a mismatch clips the rail's right edge).
- **Access tiers** (`lib/billing.js resolveAccess`): internal (any `@orions.agency`, unlimited) →
  active Stripe sub → PLAN_MAP comp → INVITED → **free tier** (Galdr chat + **one lifetime
  Crystallize**, then paywall). Anonymous: Galdr, 5 messages, mode `idea` only.
- **toneSys()** carries persona + reply-language + project voice + **taste memory** (every
  approve/skip) into every call — this is the moat; keep it flowing.
- Stripe is **LIVE mode** — test payments charge real cards (refundable). Webhook + KV are live.

## Gotchas

- Three engines, one provider (Anthropic): Galdr = Sonnet 5, Odin = Opus 5, Norrsken = Fable 5.
  Opus 5 **thinks by default** — `thinking:{type:'disabled'}` is set on every call (`streamAnthropic`
  in `api/chat.js`, `callAnthropic` in `lib/apiengine.js`) to keep the old token/latency profile.
  OpenAI/Mimir is fully retired (was GPT-5.6 Sol · the second opinion is now Galdr on Sonnet, a
  genuinely different mind from Odin on Opus).
- Each engine still falls back **silently** to a cheaper Anthropic model (Galdr→Haiku, and specialty
  models→workhorse). Internal `/api/access` exposes wired booleans so a dying key shows itself.
- **Type traps that already cost a rewrite.** (a) Google Fonts ships only the weights you ask
  for — `Inter:wght@400;500;600;700` + `font-weight:650` **snaps up to 700**, so the whole site
  rendered fully bold while the CSS claimed 650. Use a weight you actually loaded. (b) Newsreader
  is requested per-page; 5 pages once loaded the *italic* axis only (`1,6..72,500`) and so silently
  fell back to Inter for all display type. (c) `index.html` loads Newsreader **400/500 only** while
  Noto Serif Thai has 400–700 — a serif heading at 600 renders 500 in Latin and 600 in Thai, i.e.
  two weights inside one Thai heading. Display type is serif 500; hierarchy comes from size,
  space and colour, never weight.
- The **exported** document builds its own inline stylesheet in `js/app.js` (~line 3010) — it does
  NOT inherit `css/app.css`. Any canvas type change must be mirrored there or the file the client
  receives stops matching the screen.
- Env-var changes need a redeploy to take effect. Static-asset cache is `max-age=0,
  must-revalidate` (a normal reload gets new CSS/JS — no service worker).
- Memory files under the session memory dir hold longer context: `vaest-engines`, `vaest-billing`.
