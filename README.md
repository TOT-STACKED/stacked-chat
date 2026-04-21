# Handoff: Stacked Chat — full product app

## Overview
Stacked Chat is an AI operator-support product for multi-site UK hospitality groups (pubs, restaurants, coffee chains). When a device, vendor, or process breaks at a site, the operator opens a chat, the AI diagnoses the issue using a library of runbooks + live vendor APIs, walks the operator through a fix, and hands off to a human (vendor support, internal ops, or Stacked's concierge) if it gets stuck.

This handoff covers the full **operator-facing web app** — 7 connected screens plus a persistent shell, keyboard-navigable, dark-mode-first, designed around three novel UX moments (see "Novel moments" below).

## About the design files
The HTML/JSX files in this bundle are **design references** — a hi-fi prototype built with vanilla React + Babel standalone so the design can be viewed in a browser without a build step. **They are not production code to copy verbatim.** Your task is to recreate these designs inside your existing app's environment (whatever framework / component library / routing / auth the real Stacked Chat app already uses), preserving the visual system and interaction model but using your own primitives.

If the production app does not yet exist, choose a stack that matches the design's character: Next.js App Router + Tailwind or CSS Modules is a natural fit; the design is pure client-side React with no server integration assumptions.

## Fidelity
**High-fidelity.** All typography, colors, spacing, radii, and iconography are final and should be reproduced pixel-accurately. The one thing worth confirming with the designer before shipping is real copy (site names, vendor names, incident descriptions are plausible placeholders drawn from the brief).

---

## App architecture

### Shell (persistent on every screen)
- **Left nav** (240px fixed): wordmark + "CHAT" tag, org switcher, primary CTA (**+ New issue**), 6 route items, footer with system-status dot and user row.
- **Top bar**: breadcrumb ("Pieminister Group › Triage"), global search (⌘K), notifications bell with red dot, "Invite team" ghost button.
- **Content area**: scrolls independently. All screens follow `padding: 24–28px 32px 40–48px`, `display: grid`, `gap: 22–28px`.

### Routes
| ID | Label | Purpose |
|---|---|---|
| `triage` | Triage | Home. Estate overview, active incidents, resolved feed. |
| `issues` (→ `issue`, `handoff`) | Issues | Active diagnostic + baton-pass to human. |
| `health` | Stack health | Vendor grades, incident heatmap, recommendations. |
| `runbooks` | Runbooks | Knowledge-base library. |
| `sites` | Sites | Table of all sites in the estate. |
| `widget` | Widget preview | Embed demo (phone-sized chat widget). |

Routing is flat and stored in `localStorage['sc:route']`. "Issue" and "Handoff" are sub-routes reached from the Triage cards — the left nav collapses them back to the "Issues" top-level item when highlighting active state.

---

## Screens

### 1. Triage (`app/triage.jsx`)
**Purpose:** the home view. Answer the operator's first question — "is anything on fire?" — in under 2 seconds.

**Layout (top-to-bottom, all 32px gutters):**
1. **Header row** — two columns: left is `"Thursday · 21 April · 18.42 BST"` eyebrow + `"Evening Sam. <orange>2 sites need a look.</orange>"` H1 (Fraunces 46/-0.02em) + supporting subhead. Right is a 4-column KPI strip (`Open`, `AI-resolved today`, `Avg TTR`, `Saved to human`) — each KPI is a 140×auto card with uppercase label (10px/800/0.14 tracking), display-font number (38px), and a single-line subtext.
2. **Active incidents row** — auto-fill grid, min 260px. Each card has a 1.5px colored border (red for critical, amber for watch), uppercase status pill top-left, site code top-right, brand name in display font, incident text in matching color, mini-progress bar, bottom row "Diagnosing… / Open chat →". Click → goes to issue screen.
3. **The stack constellation** (NOVEL MOMENT #1) — a 6-column grid of site cells. Each cell: 1px colored border matching state, pulsing dot (critical + watch only, 1200ms flash animation), brand name in mono/uppercase, site name, 6 stack-health pips (EPOS / Pay / Net / Print / Rota / Del) in green/amber/red, large display-font score bottom-left. Subtle vertical gradient tinted to the state color.
4. **Today's resolved feed** — 6-column row grid (`10px 60px 1.4fr 1.6fr 1.4fr 110px`): pip, time, site, issue, fix summary (green for AI-fixed, amber for human-handed), "View chart" button. Uses mono font throughout for chronological feel.

### 2. Issue / live diagnostic (`app/issue.jsx`)
**Purpose:** the hero screen. Everything the operator needs during an active incident.

**Layout:**
1. **Header row**: back button (ghost), meta block (LIVE pill + H1 incident title + mono case ID), actions (Copy to WhatsApp / Assign / Hand off to human — orange primary with 4px offset shadow).
2. **Diagnostic timeline scrubber** (NOVEL MOMENT #2) — a 7-column horizontal track. Each step has a 28px pin (filled green = done, filled orange = active, hollow = idle), label, mono timestamp. Clicking any pin updates a detail panel below showing the mono timestamp, step name (orange uppercase), and a sentence of AI reasoning/evidence. This exposes the AI's work for trust.
3. **Conversation + context** — 2-column (1fr 300px):
   - **Conversation** (left): message list with small bot avatar (circle, orange bg, bowls-orange.svg inside), two bubble styles (bot = ink-700 bordered, left-radius-4; operator = orange solid, right-radius-4), and **card messages** — rich embedded objects like a pairing code (48px display font, letter-spacing 0.12em, orange with offset text-shadow) or an evidence block (mono font with ✓/⚠ status glyphs). Composer is a pill-shaped input with "Mark fixed ✓" and orange Send button.
   - **Context rail** (right): three stacked 14px-radius cards — Site context (name, mono meta, KV pairs with dashed dividers), last-7-days issues at this site, runbook excerpt with "Open full runbook →".

### 3. Handoff (`app/handoff.jsx`)
**Purpose:** visibly pass the baton when the AI gets stuck. NOVEL MOMENT #3.

**Layout:** 2-column (1fr 1.1fr). Left column is 3 recipient option cards — each with avatar, name + role, colored tag (RECOMMENDED / TEAM / PAID), response ETA, click-through arrow. The first (recommended) has a green border. Right column is the **attached chart**: a read-only list of every step the AI already took (✓ each), a highlighted hypothesis row (amber pip), 3 privacy toggles (include name, include context, expose health score), and a large orange "Send chart & open thread →" button that flips to "✓ Sent to Jo · awaiting reply" on click.

### 4. Stack health (`app/health.jsx`)
**Purpose:** diagnostic intelligence over the estate.

**Layout:** grid of panels, each 16px-radius, 22px padding:
1. Header with H1 + overall estate score card (72px display-font number).
2. **Incident heatmap** — 14 rows × 30 cols. Each cell 16px tall, bg color scaled from `rgba(59,211,111,0.18)` (healthy) to `rgba(245,165,36,0.35)` → `0.75` → `var(--stacked-red-500)` based on incident density. Axis labels at top-left and a 4-step legend at the foot.
3. **Vendor grades** — auto-fill cards (min 220px). Each: category eyebrow, trend delta (▲/▼ mono), vendor name (display 22px), **score** (display 40px, colored by tier ≥90 green / ≥75 amber / <75 red), progress bar, "N incidents this month · Drill →".
4. **What we'd change** — 3 stacked recommendations, each: mono "REC · 0N", display-font title, muted body copy, dark ghost action button.

### 5. Runbooks (`app/extras.jsx` → `RunbooksScreen`)
Filter chips row (first is active: dark-on-cream pill) + search/sort, then auto-fill card grid. Cards show mono KB-ID + category tag, title, 3-line description (min-height 56px so cards align), footer with uses count, first-pass-rate percent (colored by tier), "Open →".

### 6. Sites (`app/extras.jsx` → `SitesScreen`)
Simple data table: `1.6fr 1fr 1fr 1fr 80px 80px`. Uppercase header row, dashed dividers, score colored by tier, "● N open" in red mono if any issues else em-dash.

### 7. Widget preview (`app/extras.jsx` → `WidgetScreen`)
Two-column marketing-style page. Left: H1 + explainer + feature checklist + install code snippet. Right: a 300px-wide iPhone-style phone frame showing the Stacked Chat widget mid-conversation (header strip with brand avatar + "online" green dot, 4 bubbles incl. one card, composer with round orange send button). Phone has an 8px #1a1a1a bezel and notch.

---

## Novel moments (worth preserving exactly)
1. **Stack constellation** (Triage) — sites as a living grid with pulsing vitals, not a list. Conveys estate state in one glance.
2. **Scrubbable diagnostic timeline** (Issue) — clicking any step reveals what the AI thought/did at that step. Exposes AI reasoning for operator trust.
3. **Baton-pass handoff** (Handoff) — the literal UI of passing a chart to a human, with explicit privacy controls per-field.

---

## Design tokens

### Colors (CSS variables — see `Stacked Chat.html` `<style>`)
```
--ink-900:        #0A0A0A   /* app background */
--ink-800:        #131313   /* cards, panels, nav */
--ink-700:        #1D1D1D   /* nav active, bot bubbles */
--fg:             #F4EFE6   /* primary text (warm cream, not white) */
--fg-muted:       #928A7C   /* secondary text */
--fg-dim:         #555048   /* tertiary */
--border:         #262421   /* hairlines */

--stacked-orange-500: #E87830  /* primary accent */
--stacked-orange-700: #A34F15  /* accent shadow/dark */
--stacked-green-500:  #3BD36F  /* healthy, success */
--stacked-green-700:  #1E8A44
--stacked-amber-500:  #F5A524  /* watch state */
--stacked-red-500:    #E5484D  /* critical */
--stacked-purple-500: #C7B3F2  /* user avatar */
--stacked-purple-700: #1D1340
```

### Typography
- **Display**: Fraunces, weights 500–900, used for H1/H2, score numbers, quoted values. Always with `letter-spacing: -0.01em` to -0.02em at larger sizes. **Never use for body copy or UI.**
- **Sans**: Geist, weights 400–800. All UI, body, buttons.
- **Mono**: Geist Mono, weights 400–600. Timestamps, IDs, case numbers, evidence blocks, labels with letter-spacing 0.14px and uppercase.

Load via Google Fonts in the head (see existing link tag). If your codebase uses Next.js, swap to `next/font`.

### Spacing & radii
- Page padding: 24–28px × 32px
- Panel padding: 18–22px
- Panel radius: 14–16px
- Card radius: 10–14px
- Button radius: 8px (standard), 999px (pill), 6px (small)
- Gaps: 8 / 10 / 12 / 16 / 18 / 22 / 28px

### Primary button (orange CTA) — specific
```
background: var(--stacked-orange-500);
color: #fff;
border: 0;
padding: 11–14px 14–18px;
border-radius: 8px (or 999px for pill);
box-shadow: 0 4px 0 0 var(--stacked-orange-700);  /* chunky offset shadow */
font-weight: 800;
```
The offset shadow is part of the visual identity — don't swap for a soft shadow.

### Animations
- `@keyframes flash` — used only on constellation cells for active incidents. 1200ms infinite, opacity 1 → 0.35 → 1.
- All transitions: 120ms for hover affordance, 800ms for progress bars.

---

## State management
- **Route** — `localStorage['sc:route']` string, default `'triage'`. Single state for top-level + sub-route.
- **Tweaks** — `localStorage['sc:tweaks']` JSON: `{ accent, density, tone }`. Accent remaps `--stacked-orange-500` and `-700` CSS vars. Used for preview only; drop in production unless you want to ship theming.
- **Scrub position** on Issue screen — `useState(4)` (index of currently-inspected diagnostic step).
- **Sent flag** on Handoff screen — `useState(false)`.
- All other data is static in the mock. Replace with real data layer in production.

---

## Assets
All in `assets/`:
- `wordmark-orange.svg`, `wordmark-green.svg`, `wordmark-purple.svg` — the "stacked" wordmark in three colorways. Used in nav (20px tall).
- `bowls-orange.svg`, `bowls-green.svg`, `bowls-purple.svg` — the glyph-mark. Used as avatar inside orange-bg circle (14–16px).
- `logo-full-cream.svg`, `logo-full-orange.svg` — full lock-up (unused in current screens; keep for nav collapsed state or marketing).

---

## Files in this bundle
- `Stacked Chat.html` — entry point with tokens, tweaks panel, edit-mode protocol, React mount.
- `app/shell.jsx` — `AppShell`, `useRoute`, `ROUTES` array.
- `app/triage.jsx` — Triage screen + `Kpi` helper.
- `app/issue.jsx` — Issue screen + `ConvMsg` helper.
- `app/handoff.jsx` — Handoff screen.
- `app/health.jsx` — Stack health screen.
- `app/extras.jsx` — Runbooks, Sites, Widget preview (three smaller screens).
- `assets/` — SVG logos and marks.

Open `Stacked Chat.html` in a browser to view the full prototype. Click any active-incident card on Triage to navigate into the Issue flow and then Handoff.

---

## Notes for the implementing developer
- **Strip the Tweaks panel** before shipping (it's dev-only). The `<script>` block between `#tweaks` styles and the Babel scripts handles it — delete both the `#tweaks` DOM node and that script.
- **Replace Babel standalone** with your build pipeline. All the JSX is plain React 18 with hooks; no special features.
- **Global styles objects** in the JSX files (`shellStyles`, `triageStyles`, etc.) are namespaced per-file deliberately to avoid collision when compiled together — port them to your styling solution (CSS Modules, Tailwind `@apply`, styled-components, vanilla-extract — whatever you use).
- Icons are all inline SVG paths (no icon library dependency). Feel free to swap for Lucide / Phosphor / your house kit, but match the 1.6–2px stroke weight and rounded linecaps.
- The **orange offset-shadow button**, **warm cream `#F4EFE6` foreground on near-black**, and **Fraunces display face** are the three load-bearing brand signals. Don't lose them.
