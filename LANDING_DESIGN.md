# VaidyaAI — Landing Page Design Document
**Creative Direction: Award-Winning Luxury Digital Design**
*Archetype: Organic Modernism × Ethereal Precision*

---

## The Vibe Board

Five keywords that define every design decision:

| # | Word | Meaning in context |
|---|------|--------------------|
| 1 | **Reverent** | The weight of 5000-year-old medical knowledge — every choice honours it |
| 2 | **Precision** | Sacred geometry, monospaced data accents, pixel-perfect spacing |
| 3 | **Ritual** | The act of asking a question feels like consulting an ancient master |
| 4 | **Luminous** | Deep darkness interrupted by surgical light — emerald on abyss |
| 5 | **Unassuming** | No noise, no decoration for decoration's sake. Museum-quality negative space |

---

## Hex-Code Palette

```
#060C08   Abyss Black      — Primary background. Darker than midnight green.
#F0E8D5   Healer Parchment — Primary text / headlines. Warm off-white, like aged manuscript.
#00C270   Vital Emerald    — Action + highlight. The colour of fresh neem and life force.
#C9A96E   Ancient Gold     — Eyebrow labels, Sanskrit text, secondary accents.
#7A9E87   Forest Shadow    — Body copy, muted labels, subdued UI elements.
```

**Accent palette for corpus cards:**
- Sushruta: `#00C270` (Vital Emerald)
- Charaka: `#C9A96E` (Ancient Gold)
- Ashtanga Hridayam: `#8FA888` (Sage)

---

## Typography Stack

### Headline / Display
**Playfair Display** — `'Playfair Display', Georgia, serif`
- Weight 400 (regular) for main headlines — *never bold, always authoritative*
- Italic variant for emotional emphasis (`font-style: italic`)
- Usage: H1, H2, corpus card titles, CTA headlines, stat numbers
- Why: Playfair's high contrast between thick and thin strokes mirrors the ink of ancient manuscripts. Its optical size feel is editorial and premium.

### Body / UI
**Space Grotesk** — `'Space Grotesk', Inter, sans-serif`
- Weight 400 (body), 500 (labels), 600 (CTAs)
- Usage: Body copy, navigation, buttons, feature descriptions, eyebrows
- Why: Space Grotesk's geometric skeleton with humanist details creates tension with the organic serif headlines — precision meeting soul.

### Data / Code
**JetBrains Mono** — `'JetBrains Mono', monospace`
- Usage: Similarity scores, status indicators, code snippets
- Why: Reinforces the "scientific sanctuary" archetype — ancient wisdom measured in vectors.

### Typography Scale
```
Hero H1:        clamp(2.7rem, 5vw, 4.3rem) / line-height 1.1
Section H2:     clamp(2rem, 3.5vw, 3rem)   / line-height 1.2
CTA H2:         clamp(2.4rem, 4.5vw, 3.8rem)
Corpus card:    1.35rem serif
Feature title:  1.08rem serif
Body copy:      0.97rem / line-height 1.8
Small label:    0.67–0.73rem / letter-spacing 0.13–0.20em / UPPERCASE
```

---

## Section-by-Section Visual Specification

### 1. Navigation Bar
- **Position:** Fixed, full-width
- **Background:** `rgba(6,12,8,0.88)` + `backdrop-filter: blur(22px)`
- **Border:** `1px solid rgba(0,194,112,0.06)` — barely visible, like light through jungle canopy
- **Logo:** Playfair serif + Leaf icon in Vital Emerald. "AI" in italic emerald.
- **Links:** Uppercase tracking 0.13em, Forest Shadow color, transition on hover
- **CTA button:** 1px emerald border, no fill. Text: `CONSULT →`
- **Spacing:** `padding: 1.2rem 4rem` — generous horizontal breathing room

### 2. Hero Section
- **Layout:** Asymmetric 50/50 grid. Left: pure typography. Right: animated mandala.
- **Background:** Pure Abyss Black (`#060C08`)
- **Grain overlay:** CSS SVG `feTurbulence` noise at 3.8% opacity — the "aged parchment" feel
- **Cinematic element:** The **Yantra** (see Wildcard section)
- **Headline:** Two-line Playfair Display H1. "Intelligently Synthesized." in emerald italic. Font size: `clamp(2.7rem, 5vw, 4.3rem)`
- **Eyebrow pill:** 0.67rem uppercase, gold border, 1px rounded border-radius
- **CTA:** Filled emerald button (primary) + Ghost underline link (secondary)
- **Stats row:** Three figures in large Playfair serif, separated by 1px vertical dividers
- **Parallax:** Left column fades and translates up 60px as user scrolls past 400px
- **Entrance animation:** Staggered `motion.div` reveals — eyebrow at 0.3s, H1 at 0.5s, body at 0.75s, CTA at 1.0s, stats at 1.4s

### 3. Marquee Band
- **Height:** ~2.7rem
- **Background:** `rgba(0,194,112,0.016)` — the faintest green tint
- **Borders:** 1px top and bottom in emerald at 6% opacity
- **Content:** 12 items × 3 repetitions, CSS `translateX` animation at 38s
- **Typography:** 0.69rem / 0.15em tracking / UPPERCASE / Forest Shadow
- **Gold dividers:** `✦` glyphs in Ancient Gold

### 4. Corpus Section — "Three Sacred Texts"
- **Layout rule:** **Asymmetric editorial grid** — `1fr 1.28fr 1fr`. The center card (Charaka, the most comprehensive text) breaks the rhythm by being 2.5rem taller on both top and bottom.
- **Card aesthetic:** Near-black glass (`rgba(10,20,12,0.72)`) with 1px emerald border at 6%
- **Hover state:** Slightly lighter background + border opacity doubles
- **Card anatomy (top to bottom):**
  - Large Playfair numeral (3.2rem, 75% opacity, accent color)
  - 2.4rem horizontal rule (accent color)
  - Sanskrit name in gold serif
  - English title in Playfair 500
  - Role tag in 0.66rem uppercase Forest Shadow
  - Description in 0.85rem body copy at 50% parchment opacity
  - Status indicator: pulsing color dot + "Indexed · Active"
- **Animation:** `whileInView` staggered at 0.16s intervals, `y: 48` to `y: 0`

### 5. How It Works — "The Engine"
- **Layout:** **Z-pattern** — three steps, each indented further right (`0rem → 3rem → 6rem`)
- **Background:** Black at 18% — creates clear alternating section rhythm
- **Vertical connector:** CSS `::before` pseudo-element — 1px line, gradient from transparent to emerald 20% and back to transparent, positioned along left axis
- **Step anatomy:**
  - Large Playfair numeral in emerald (65% opacity)
  - Title: Playfair 500, 1.45rem
  - Body: 0.88rem / 1.82 line-height / Forest Shadow
- **Animation:** Alternating `x: -36` / `x: 36` slide-in, `whileInView`

### 6. Features Grid — "Precision-Engineered"
- **Layout:** `3 × 2` grid separated by 1.5px hairline joints (via `gap: 1.5px` on emerald-tinted background)
- **Card:** Almost-black solid fill. No border on individual cards — the gap IS the border.
- **Icon box:** 2.4rem square, 1px emerald border at 18%, 2px border-radius
- **Hover micro-interaction:** Icon box border brightens, background lightens slightly
- **Typography:** Playfair title + Space Grotesk description
- **Animation:** `whileInView` staggered at 0.09s per card

### 7. CTA Section — "The Sanctuary"
- **Background:** Pure Abyss + `radial-gradient` emerald glow at center (10% opacity)
- **Wildcard element:** Full-bleed background Yantra at 5.5% opacity, spinning at 100s
- **Headline:** Playfair 4rem, "Modern Intelligence." in emerald italic
- **Button:** Ghost style — transparent fill, 1px emerald border, uppercase monospaced
- **Hover state:** Subtle emerald glow with `box-shadow: 0 0 48px rgba(0,194,112,0.14)`
- **Entrance:** Single `whileInView` reveal, `y: 40 → 0`

### 8. Footer
- **Height:** Minimal — 2.4rem padding
- **Border:** 1px top at emerald 6%
- **Three columns:** Logo | Legal disclaimer | Corpus credits
- **Typography:** All at 0.65–0.69rem / Forest Shadow color

---

## Motion & Micro-Interactions

| Element | Animation | Library |
|---------|-----------|---------|
| Page entrance (nav, hero) | `initial → animate` opacity + y | motion/react |
| Scroll parallax (hero text) | `useScroll → useTransform` y + opacity | motion/react |
| Section reveals | `whileInView` opacity + y/x | motion/react |
| Mandala ring (hero) | CSS `transform: rotate()` 75s linear infinite | CSS |
| BG Yantra (hero, CTA) | CSS `transform: rotate()` 100–120s | CSS |
| Sanskrit text ring | CSS `svg-spin-slow` class, 44s | CSS |
| Counter-spin ring | CSS `svg-spin-reverse` class, 60s | CSS |
| Status indicator dots | CSS `scale + opacity` pulse, 2.6s | CSS |
| Scroll line hint | CSS `width` breathe, 2s | CSS |
| Marquee ticker | CSS `translateX` 38s | CSS |
| Leaf icon in CTA | Counter-spins relative to mandala | CSS |
| CTA button hover | `translateY(-2px)` + box-shadow | CSS transition |
| Primary CTA hover | `translateY(-2px)` + green glow | CSS transition |

---

## Layout Rules

### Spacing System
- **Section padding:** `8rem 0` (major sections) / `10rem 0` (CTA)
- **Inner max-width:** `1300px` centered
- **Horizontal gutters:** `4rem` (desktop) / `2rem` (mobile)
- **Negative space philosophy:** Every element needs room to breathe. When in doubt, add 20% more padding.

### The Asymmetric Editorial Law
No equal columns. The eye must travel, not scan:
- Corpus grid: `1fr : 1.28fr : 1fr` — center card elevated
- How-it-works: Indented Z-pattern (0 / 3rem / 6rem)
- Hero: 50/50 split, but left is pure text density, right is 90% empty SVG space

### Negative Space
- The hero right column is almost entirely empty SVG space — the mandala sits in **a sea of dark**
- Section headers are centered and isolated with 4rem of space below
- Corpus card descriptions at 50% opacity push everything into the background, making titles feel sculpted

---

## The Wildcard — The Living Vedic Yantra

**Concept:** An animated **SVG sacred geometry construct** — inspired by the Shatkona (Six-Pointed Star / Sri Yantra concept) — that lives in the hero section and CTA.

**Why it's award-winning:** No stock photography. No gradient blobs. Most "premium" health/wellness sites use soft orb gradients — this site uses *an actual geometric construct that appears in 5000-year-old Indian cosmology*. It is simultaneously the most futuristic and most ancient visual possible. When presented in the context of an AI system synthesizing those same 5000-year-old texts, it creates a moment of conceptual resonance that stops scroll.

**Visual anatomy:**
- Outermost: 1px dashed circle, Ancient Gold at 8% — barely visible
- Rotating ring: Sanskrit text path — "सुश्रुत संहिता · चरक संहिता · अष्टांग हृदयम् · आयुर्वेद · ॐ तत् सत्" — at 50% opacity gold, rotating at 44s
- Sacred geometry: Two overlapping equilateral triangles (Shatkona) — lines at 7% emerald opacity
- 8 compass tick-marks at the 128px radius circle — at 25% emerald opacity
- Counter-rotating inner dashed circle at 60s reverse
- Central glass orb: Near-black circle with 1px emerald border at 28%, small nucleus dot
- 4 cross-hairs extending from center
- **Leaf icon** in the dead center, counter-spinning against the mandala rotation

**Behavior:**
- Hero: Mandala wrapper animates at 75s. SVG internal layers spin independently.
- Background hero: Huge version (68vw) at 12% opacity, spinning at 120s — only visible peripherally
- CTA: Full-bleed, 72vmax, spinning at 100s, at 5.5% opacity

**The poetic effect:** As the user reads about ancient Ayurvedic knowledge, behind the text, the yantra slowly turns — like the cosmos rotating around a fixed truth. The faster inner and outer rings moving at different speeds create a parallax of time — ancient knowledge in perpetual motion, never static.

---

## File Architecture

```
src/
  LandingPage.tsx     — Full landing page component
  App.tsx             — Existing chat UI (unchanged)
  main.tsx            — Root: shows LandingPage first, App on "Enter"
  index.css           — All styles: existing + .lp-* landing prefixed

index.html            — Updated: title, Google Fonts (Playfair Display + Space Grotesk)
LANDING_DESIGN.md     — This document
```

---

## Design Tokens Quick Reference

```css
--lp-abyss:     #060C08    /* Background */
--lp-forest:    #0C1810    /* Card backgrounds */
--lp-emerald:   #1C5C3A    /* Mid-tone green */
--lp-vital:     #00C270    /* Primary accent — action */
--lp-gold:      #C9A96E    /* Secondary accent — labels */
--lp-parchment: #F0E8D5    /* Primary text */
--lp-shadow:    #7A9E87    /* Muted text / body copy */
--ff-serif:     'Playfair Display', Georgia, serif
--ff-sans:      'Space Grotesk', Inter, sans-serif
```

---

*Designed to honour the gravity of ancient medical knowledge through the discipline of restraint.*
