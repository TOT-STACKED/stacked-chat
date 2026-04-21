# CLAUDE.md — Stacked Chat redesign implementation

You are implementing a redesign of Stacked Chat. Everything you need is in this folder.

## What this is

- `README.md` — full design spec (screens, layout, tokens, interactions)
- `Stacked Chat.html` + `app/*.jsx` — runnable HTML prototype, your source of truth
- `assets/` — brand SVGs (wordmark, bowls mark)
- `colors_and_type.css` — design tokens from the Stacked brand system

The HTML is a **reference**, not shippable code. Your job is to recreate it in this repo using its existing stack.

## Ground rules

1. **Do not copy the HTML files into `src/`.** Keep them as references. Build fresh React components that match.
2. **Use this repo's existing patterns** — routing, component library, state management, design tokens. If the repo has `<Button>`, use it. If it uses Tailwind, port tokens into `tailwind.config`. If it uses CSS vars, copy them from `colors_and_type.css`.
3. **Preserve the three novel moments exactly** — they are the soul of the redesign:
   - **Stack Constellation** (Triage home): 6-col grid of site cells, pulsing status pips, 6 vertical vendor bars per cell, big score number
   - **Diagnostic Timeline** (Issue screen): 7-step horizontal scrubber at top, click any step to see its evidence below
   - **Handoff Baton-Pass** (Handoff screen): 3 recipient cards + read-only attached chart with permission checkboxes
4. **Match copy verbatim** — the voice is operator-first, hospitality-native. Don't rewrite it generic.

## Suggested order

1. Port design tokens from `colors_and_type.css` into the repo's token system. Verify colors render.
2. Build the **AppShell** (sidebar + topbar) against your real router. No screens inside yet.
3. Build **TriageScreen**. Get the constellation grid pixel-perfect before moving on — it's the hardest.
4. Build **IssueScreen** with the scrubbable timeline. Wire to real issue data.
5. Build **HandoffScreen**.
6. Build the lighter screens (Health, Runbooks, Sites, Widget preview) in any order.
7. Replace mock data with real data sources. Keep the data shapes defined in `README.md` as your contract.

## Don'ts

- Don't ship the Tweaks panel — it's a design-time affordance, not a product feature.
- Don't add loaders/skeletons yet; match the design first, then add states.
- Don't swap the serif display font — Fraunces is intentional, it's the brand.
- Don't dim the orange. The `--stacked-orange-500` is exactly the brand spec.

## When in doubt

Open `Stacked Chat.html` in a browser. The prototype is the spec.
