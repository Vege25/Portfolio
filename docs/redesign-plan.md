# Portfolio redesign plan (2026)

Status: phases 1–4 built on branch `redesign-2026` (2026-11-03). Not yet committed or deployed.

## Decisions made (2026-11-03)

- Astro, not a React SPA refactor. Astro 6.4 (Astro 7 needs Node ≥ 22.23; this machine has 22.13).
- GPS: no physical arrow. The device will be an ESP32 with a Waveshare screen that shows the arrow while you move in the web app. Not finished, and the site says so. The navigation code may ship in the public bundle.
- The old live projects (Threadle, innovation project) stay, with the same links. The innovation report PDF keeps its old URL.
- MyCashflow: only what it is and that I do software development there.
- English only, location Tampere, no photo on the site (the CV has one).

## Still open

- [ ] Rewrite the texts in your own words (all four `src/content/projects/*.mdx`, plus `index.astro` hero/how I work/about, plus `src/data/site.ts`).
- [ ] Aura: real photos (device on desk and in bedroom, CAD render, print). Replace the screen recreation as the cover.
- [ ] Buddyfall: fresh screenshots of the current build. The current ones are from before the August polish.
- [ ] Säästöt: 2× resolution screenshots (the demo renders are 390 px wide). The demo link is in.
- [ ] GPS: link the hosted ESP32/Waveshare demo when it exists.
- [ ] `public/cv.pdf`
- [ ] Netlify: point the site at this repo and branch (the current live build came from elsewhere).

## 1. Where it is now

**What the site says about you today:** "full-stack web developer", plus a wall of skill badges and five school projects. Every project gets the same card with a GitHub button.

**What it should say:** *I'm a software engineer. When something in my life doesn't work, I build the fix, and I build it all the way: backend, app, security, even the hardware.*

### Problems in the current site

| Area | Problem |
|---|---|
| Message | The site is about tools (badge wall), not about problems solved. "Greetings!" and the copy ("leverage a diverse skill set", "seamless and innovative", "where innovation meets clean code") read as generic or AI text. |
| Projects | All are school projects with the same card layout. They have no status, no "why", and nothing hard about them. The four new projects are private, so a GitHub-button card doesn't work for them at all. |
| Visuals | The 2017-era "cyan on #0b0c10" palette, a stock background image, glow shadows, and every button the same cyan pill. |
| Contact | The "Send message" form only opens `mailto:`. It looks like a form but isn't one. |
| Performance | Font Awesome kit (an external, render-blocking script), 30 TTF files (3 used), and `react-scroll` for something CSS does natively. |
| Code | One file per section with hard-coded data. Nav reads `window.innerWidth` in state instead of using CSS breakpoints. The mobile menu is duplicated. Inline vendor-prefixed shadows. |
| Source of truth | **The live Netlify site is not built from this repo.** Live has *Threadle*, *Highlight from work: Innovation project* and more skills (C#, PHP, Python, Java). None of that is in `main` here or on `origin`. This must be resolved first (see §9). |

## 2. Positioning: what the page should prove in 30 seconds

A recruiter or lead dev should leave knowing three things:

1. **You ship real things that people use.** A budgeting app in daily use with real bank data, a multiplayer game in closed beta, and hardware that runs.
2. **You take on hard problems on purpose.** Per-user encryption of financial data, a server-authoritative realtime game server with a self-tuning bot AI, navigation maths ported from TypeScript to C for a microcontroller, and a 3D-printed enclosure.
3. **You work professionally.** Your day job is PHP 8.2 / Symfony 7.4 (Doctrine, Twig) at MyCashflow. You use AI tools seriously: you build your own Claude Code skills and workflows, and you back AI-assisted speed with tests.

Skills become a **side-effect** of the projects. The stack is listed in each project's spec sheet, not in a badge wall.

### Proof points the repos give us (verified)

| Project | Proof point |
|---|---|
| **Säästöt** | 866 commits since 26.9.2026, about 1,950 test cases in 271 test files, 72 DB migrations, and CI with typecheck, lint, tests, audit and a web smoke test. Bank sync over PSD2 (Enable Banking). Per-user envelope encryption, RLS on every table, and device-bound keys with PIN and fingerprint unlock. Runs on Android and web (PWA with passkeys). |
| **Buddyfall** | About 58k lines of backend and 72k of frontend. 375 backend test files. A stress test with 200+ concurrent WebSocket players. 60 cards, 8 spells and 12 rulesets. A minimax bot whose evaluation weights are tuned by a genetic algorithm. The backend architecture changed twice (Express services → Cloudflare Durable Objects → one authoritative Node/WS/Postgres server). Android via Capacitor. Live at buddyfall.com. |
| **GPS arrow** | Pure TS core with about 331 tests: route matching, pure-pursuit lookahead, Kalman and outlier filters, dead reckoning, and adaptive GPS polling (1 s near corners, up to 12 s on long straights). Ported to C11 with 11 native C test programs. Runs end to end on hardware (GPS fix → C navigation → motor-driven arrow). |
| **Aura (modular alarm)** | ESP32-S3 with a 480×480 round touch display, written in C with ESP-IDF and LVGL 9. NTP plus an RTC backup, automatic night mode and anti-burn-in pixel drift. A desktop simulator shares the UI code with the device build. Custom 3D-modelled, 3D-printed case. |

These numbers go in the spec sheets. **Use them sparingly**, and don't turn the site into a stats dashboard.

## 3. Design direction: "engineering logbook"

The personal hook is that you build tools for your own life, including hiking and hardware. So the site should feel like a well-kept engineer's notebook or datasheet, not a startup landing page.

### Things to deliberately avoid (the "vibecoded" look)

- Gradient blobs and glowing orbs
- Glassmorphism cards
- Bento grids
- Purple-blue gradients
- Sparkle icons
- Emoji headings ("Hi, I'm Veeti 👋")
- Typewriter hero
- Tech-logo marquees
- Inter + zinc shadcn cards
- Every element fading up on scroll
- "Passionate full-stack developer crafting digital experiences"

### Visual language

- **Colour.** The background is a warm near-black (`#0f0f0d`), not blue-black. Text is warm off-white (`#ecebe6`), with muted grey (`#8b8a83`) and hairline borders (`#262521`). **One accent: trail-marker orange** (`#ff6a2b`, tuned for contrast), a nod to the painted markers on Finnish hiking trails. It is used rarely: links, the arrow, the status of live things. Status dots use green for in use, amber for beta and grey-blue for prototype.
- **Type.**
  - Headings and body: **Schibsted Grotesk** (variable). It comes from a Nordic media house, has character and isn't overused.
  - Metadata such as labels, spec sheets, status and dates: **JetBrains Mono** or **IBM Plex Mono**.
  - Both are self-hosted woff2 files: two files instead of 30 TTFs.
- **Structure.**
  - Thin 1px rules between sections, like a technical document.
  - Small mono section labels (`01 — SÄÄSTÖT`).
  - A generous left-aligned grid, not centred everything.
  - Large type for the problem statement; quiet type for everything else.
- **Spec sheet per project.** A small mono table with Status, Role, Platform, Stack, Since and Links. It reads like hardware documentation, which fits someone who does both software and electronics.
- **Signature element: the arrow.** The GPS watch's arrow becomes the site's mark.
  - In the hero, a small round "watch face" whose arrow follows the cursor (on touch devices it points down to the work).
  - Link arrows (→) turn towards where they lead on hover.
  - The GPS case study turns the same arrow into a real interactive demo.
  - It's one idea used consistently, and it's personal.
- **Imagery.** Real photos and real screenshots only: device photos, the printed case, game screenshots, app screens in a phone frame. A personal photo (e.g. on a hike) in About is much more "you" than any illustration.

### Motion: "smooth" without gimmicks

- Page-to-page transitions with the **View Transitions API**. The project image grows into the case-study header.
- Native `scroll-behavior: smooth` and `scroll-margin-top`. No scroll-jacking library.
- Short, purposeful motion (150–300 ms, ease-out): hover states, arrow rotation, image reveals in case studies. Not every paragraph.
- Short muted looping videos (webm/mp4, under 3 MB, autoplay only when in view) where motion *is* the content: a Buddyfall match, the alarm display cross-fading digits, the stepper arrow moving.
- Respect `prefers-reduced-motion` everywhere.

## 4. Information architecture

### Home (`/`)

1. **Nav.** Name on the left; Work · About · Contact on the right. Sticky, with a hairline border that appears on scroll. One responsive component, CSS-only breakpoints.
2. **Hero** (about 70vh, not a full-screen splash):
   - A plain statement in your voice (drafts in §6), the "now" line (role at MyCashflow) and the arrow watch face.
   - Two links: "See the work ↓" and "Contact".
3. **Selected work.** Four large rows, one per project, in this order: Säästöt, Buddyfall, Aura, GPS arrow. Each row has:
   - index, name and the one-sentence problem
   - status tag
   - one strong visual
   - two or three stack words in mono
   - "Read the case →"
   - No GitHub button, because those repos are private.
4. **Day job.** MyCashflow, software engineer: PHP 8.2 · Symfony 7.4 · Doctrine · Twig. Two or three lines about what you work on. Then a short timeline:
   - MyCashflow
   - the previous job, with the **innovation project** from the live site (mass product transfer between systems) and its "full report (FI)" link
   - studies (Metropolia)
5. **How I work.** A short, honest paragraph about AI:
   - You use Claude Code daily and have built your own skills and workflows (investigate → plan → implement → finalize, plus a teaching skill for learning PHP/Symfony).
   - AI makes you fast; tests and review are how you keep it right. Säästöt is the example: 866 commits and about 1,950 tests in about 5 weeks.
   - This is a stronger 2026 signal than any skill list.
6. **Earlier work** (2023–24, school). A compact list, one line each with a GitHub link: Threadle, Hodaripuoti, Heat or Not, Brand design copy (Samsung), the student-restaurant finder. It shows growth without taking space.
7. **About.** Three or four sentences: who you are, hiking, why you build things. Add a photo.
8. **Contact.**
   - A big email address with a copy button, plus LinkedIn and GitHub.
   - Optionally a CV PDF and an "open to …" line.
   - Remove the fake form.

### Case study pages (`/work/saastot`, `/work/buddyfall`, `/work/aura`, `/work/gps-arrow`)

Each case study uses the same skeleton, so they're quick to read and quick to write:

1. **Header.** Name, one-line problem, status tag, spec sheet, primary link (demo / landing page / none).
2. **The problem.** Personal, concrete, 3–5 sentences.
3. **What I built.** How it works for the user, with screenshots or photos.
4. **The hard part.** One to three engineering problems, explained plainly, with a diagram where it helps.
5. **Where it is now / what's next.**
6. **Next project →**

Separate pages (not modals) mean each project can be shared as its own link, with its own social preview image.

## 5. Project content plan

### 01 Säästöt: personal finance app
- **Status:** In daily use (by me) · public demo coming.
- **Visuals:** three or four phone-framed screens (Tänään, Suunnitelma, Yhteenveto, the payment-sorting sheet). Take them from the demo-data renders in `project-savings/.review-out/*/app.png` (fake user "Maija"). **Never real data.** The gitignored `.playwright-mcp` screenshots in that repo are unverified, so don't use them.
- **Hard parts to tell:**
  1. **Your share, not the bank's total.** Every card purchase arrives automatically; you sort it and enter only your share (full / half / custom / split). Bank apps can't do this, so their category totals lie.
  2. **Security first.** Each user's data is encrypted with their own key, and a stolen database is just noise. Mention the class of measures only (per-user encryption, row-level security, device-bound keys, PIN/biometric). Nothing more specific; `docs/data-security-plan.md` marks what stays private.
  3. **Card holds vs final charges.** A pending purchase can disappear or come back with a different amount, even after the month is closed, and the totals still never change.
- **Link:** the demo link when `project-savings/docs/plans/build/19-public-demo.md` ships. Until then, "Demo coming" with no dead link.

### 02 Buddyfall: multiplayer strategy card game
- **Status:** Closed beta · link to buddyfall.com only.
- **Visuals:**
  - Logo and card art (`frontend/public/Buddyfall-logo*.png`, `frontend/src/assets/cards/`).
  - **Fresh** screenshots of the current build. The PNGs in the repo root are from before the August polish.
  - A 10–15 s looping clip of a match.
- **Hard parts:**
  - A server-authoritative realtime game, clock included, with premoves.
  - The backend rebuilt twice, and why.
  - A bot AI with self-tuned weights.
  - A 200-player stress test.
  - Game economy maths (Monte Carlo collection targets).
- **Explain the game in one sentence:** chess-like 6×6 board, cards with arrow strengths, capture the opponent's main piece.

### 03 Aura: modular desk/bedroom display
- **Status:** v1 running on my desk · not testable online.
- **Problem:** I checked the time and weather on my phone and ended up scrolling.
- **What I learnt:** electronics, C on ESP-IDF + LVGL, 3D modelling and printing.
- **Visuals needed from you:** product photos (device on desk and in bedroom), the case CAD render, a photo of the print, screen captures, and ideally a short clip of the night-mode fade. **The repo has none** (`images/` only holds the clock wallpapers).
- **Honesty note:** the repo's weather row is still a placeholder value. Describe only what works today and list weather under "next".

### 04 GPS arrow: phone-free hiking navigation
- **Status:** Prototype · works end to end on hardware · wearable version in planning.
- **Problem:** pulling the phone out on hikes to check the route, and the battery drain.
- **Solution:** a device that shows only an arrow. Straight up means on track; off track, the arrow turns towards the route. Adaptive GPS polling saves battery: GPS checks are less frequent on long straights and more frequent near corners or when you drift off the route.
- **Centrepiece: an interactive demo inside the case study (and a small version on the home page).** See §7.
- **⚠ Needs your confirmation:** the repo shows the arrow as a **physical hand driven by a stepper motor**. The proof of concept is an Arduino Uno with a NEO-6M GPS and a NEMA17 stepper; Gen 2 plans a XIAO ESP32-S3 and a flat stepper. There's **no screen**. The Waveshare round display is in the *alarm* repo. See the questions in §9.

## 6. Copy: your voice, not AI's

### Rules
- First person, short sentences, concrete nouns.
- Say what was annoying, what you built, and what was hard.
- Banned: *leverage, seamless, innovative, passionate, robust, cutting-edge, crafting, dive into, on a mission, turn ideas into reality, elevate*.
- Few em dashes, no triple adjectives, no "not just X, but Y".
- I write drafts; **you rewrite them in your own words.** Simple English that sounds like you beats polished English that sounds like ChatGPT.

### Draft examples (to show the tone)

**Hero**
> **Veeti Sorakivi**
> Software engineer. I build things when something in my own life doesn't work.
> Right now that's a budgeting app I use every day, a multiplayer card game in closed beta, and a hiking compass that runs without a phone.
> Day job: PHP and Symfony at MyCashflow.

**Säästöt, one-liner**
> I was bad at budgeting, and my bank app wasn't helping. When I pay for dinner for two, half of it isn't my spending.

**Buddyfall, one-liner**
> A strategy card game on a chess-like board. My biggest project, and the one that taught me the most about backends.

**Aura, one-liner**
> I kept picking up my phone to check the time and losing focus. So I built a clock that can't distract me.

**GPS arrow, one-liner**
> On hikes I kept taking my phone out to check if I was still on the trail. This device only has an arrow.

## 7. GPS arrow interactive demo (spec)

**Goal.** Anyone can understand the device in 10 seconds by moving a hiker and watching the arrow react.

### Layout
- Left: a stylised route on a dark contour background, as SVG with no map tiles.
- Right: a round watch face with the arrow.
- On mobile they stack.

### Route
- One real GPX from `gps/tests/fixtures/gpx` (the short "Torppis" loop).
- Simplified and projected to local x/y at build time, then shipped as a small JSON file.

### Controls
- **D-pad buttons** (↑ ← → ↓) and the keyboard arrow keys / WASD move the hiker.
- **"Walk the route"** auto-walks the route.
- **"Wander off"** drifts sideways so you see the arrow turn back.
- **Reset**

### What the user sees
- The arrow uses the real logic: lookahead point → bearing − heading, with a turn-rate limit like the motor.
- **GPS fixes as dots**, plus a small readout: "next fix in 9 s: long straight" / "1 s: corner ahead" / "1 s: off track". This *shows* the battery optimisation, which is the clever part.

### Code
- Copy the pure functions (`src/core/navigation.ts`, `gpsInterval.ts`, geo helpers, `src/core-simple/route.ts` lookahead) into `src/components/gps-demo/core/`, along with a few of their unit tests.
- The demo is a React island that loads only when scrolled into view.
- ⚠ This makes that logic readable in the public JS bundle. It needs your OK; the alternative is a simplified re-implementation.
- **Optional:** also deploy the existing `gps/dist/watch-sim.html` (static, OpenFreeMap tiles, no keys) as "full simulator →". Note that it uses fixed 1 s polling and has no manual controls, which is why the custom demo above is better as the main piece.

## 8. Technical plan / refactor

The current code is about 600 lines and mostly static content, so a clean rebuild is cheaper than refactoring section by section.

**Recommendation: rebuild on Astro (static) + TypeScript + Tailwind CSS 4, with React islands only where there's interaction.**

- **Why Astro over upgrading the Vite/React SPA:**
  - The page ships as plain HTML: fast first load and good SEO/social previews for each case page.
  - View Transitions are built in.
  - Case studies are MDX files that are easy for you to edit, which matters because you should write the texts.
  - You keep React for the GPS demo and the arrow.
- Netlify deploys it out of the box.

### Structure

```
src/
  content.config.ts            # zod schema for projects (title, slug, order, status, problem, stack, links, cover, metrics)
  content/projects/
    saastot.mdx  buddyfall.mdx  aura.mdx  gps-arrow.mdx
  content/earlier/             # small entries: threadle, hodaripuoti, heat-or-not, brand-copy, ravintolat
  layouts/Base.astro           # <head>, fonts, meta/OG, nav, footer, ClientRouter (view transitions)
  components/
    Nav.astro  Hero.astro  ArrowMark.tsx  CaseRow.astro  SpecSheet.astro  StatusTag.astro
    WorkTimeline.astro  EarlierWork.astro  Contact.astro  Footer.astro  PhoneFrame.astro  LoopVideo.astro
    gps-demo/ GpsDemo.tsx  core/*.ts  route.json
  pages/
    index.astro  work/[slug].astro  404.astro
  styles/global.css            # @theme tokens: colours, fonts, spacing; base styles
public/
  cv.pdf  og/*.png  favicon.svg
netlify.toml
```

### Removed
- Font Awesome kit → inline SVG icons
- `react-scroll` → CSS
- 30 TTFs → 2 woff2 files
- `bg-1/2.jpg`
- the `mailto` form
- the `window.innerWidth` nav logic

### Quality bar
- Lighthouse 95+ on all four categories
- Images through `astro:assets` (AVIF/WebP, responsive sizes)
- Keyboard-navigable demo
- Visible focus rings
- AA contrast (check the orange on dark)
- Per-page OG images
- `sitemap.xml`
- A proper `<title>` and description
- Optional privacy-friendly analytics (Netlify or Plausible)

## 9. Open questions (need your answers before or while building)

1. **GPS hardware.** The repo shows a stepper-motor arrow (Arduino Uno PoC → XIAO ESP32-S3 planned), with no screen. You described "ESP32 with a Waveshare screen". Is there a newer version that isn't committed, or was that the alarm? The case study depends on this.
2. **Live site source.** Where is the code that's deployed on Netlify (Threadle, the innovation project, extra skills)? Another machine, or a manual upload? Should the rebuild deploy from this repo via Git?
3. **GPS demo code.** May the real navigation functions ship in the public bundle, or should the demo use a simplified version?
4. **MyCashflow.** What can be said publicly: title, start date, one or two things you've built (e.g. features you can describe without internal details)?
5. **Assets from you:**
   - Aura photos, case CAD render and print photos
   - a photo of yourself
   - CV PDF
   - a short Buddyfall gameplay clip (or OK for me to capture one from the testing build)
6. **Basics.** Location line (city)? Language: English only, or EN/FI? An "open to …" line, or none?
7. **Framework.** OK with the Astro rebuild, or keep React/Vite and refactor?

## 10. Build order

| Phase | Work | Result |
|---|---|---|
| 0. Prep | Answer §9. Find the live source. Collect assets. Pick Säästöt screens from demo data. Capture fresh Buddyfall screenshots. | Everything needed to build |
| 1. Foundation | New Astro project on a branch. Tokens, fonts, Base layout, Nav, Footer. `netlify.toml` and a Netlify deploy preview. | Empty but styled site live on a preview URL |
| 2. Home | Hero + arrow mark, selected work rows, day job + timeline, how I work, earlier work, about, contact. | Home complete with draft copy |
| 3. Case studies | Content schema, `[slug]` template, spec sheet, the 4 MDX case studies, view transitions. | 4 shareable project pages |
| 4. GPS demo | Port the core and its tests, route JSON, SVG map, watch face, controls, fix visualisation. Home mini version. | Interactive demo |
| 5. Copy pass | You rewrite the texts in your voice; I tighten them and check them against the banned list. | Final texts |
| 6. Polish | Motion pass, reduced motion, a11y, Lighthouse, OG images, 404, mobile QA at 360/390/768/1280/1440. | Release |
| 7. Launch | Merge, switch Netlify to this repo, update the README. | New site live |
| Later | Säästöt public demo link; Aura v2 and GPS Gen 2 updates as new entries in each case's "where it is now". | |
