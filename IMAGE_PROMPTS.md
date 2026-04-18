# VaidyaRAG — Image Generation Guide

**Supabase Bucket Path:**
`generated-images/VaidyaRAG/`

**Full public URL base:**
`https://yidjcuymlbmdxbjcjjbd.supabase.co/storage/v1/object/public/generated-images/VaidyaRAG/`

All images share a unified aesthetic:
- **Palette:** Warm linen · Deep forest green · Vital emerald (#00C270) · Ancient gold (#C9A96E) · Abyss black (#060C08)
- **Style:** Editorial luxury · macro botanical · sacred geometry · cinematic depth
- **Mood:** Healing sanctum, ancient wisdom, meditative calm, Ayurvedic sanctuary feel

---

## CHAT INTERFACE IMAGES (7 files)
Used in `src/App.tsx`

---

### 1. `chat-bg-texture.jpg`
**Used in:** Chat main column background (full-bleed)
**Dimensions:** 1920 × 1080 px minimum. Landscape.

**Midjourney / DALL-E Prompt:**
```
Extreme macro photograph of an aged palm leaf manuscript (Tala patra) lying open on a stone surface. Warm amber evening light rakes across the surface from the left, revealing the ancient hand-incised Sanskrit characters beneath translucent oxidized leaf. Dark forest-green shadows fill the right side. Subtle bokeh depth-of-field. Museum quality still life. Shot on Hasselblad medium format. Muted warm linen tones — cream, amber, dark green. High detail, editorial luxury, --ar 16:9
```

---

### 2. `sidebar-herbs.jpg`
**Used in:** Left sidebar panel background (portrait crop, top-anchored)
**Dimensions:** 540 × 960 px minimum. Portrait.

**Midjourney / DALL-E Prompt:**
```
Dark moody studio photograph of Ayurvedic medicinal herbs arranged in a loose composition on black slate. Ashwagandha root, dried neem leaves, turmeric rhizome, brahmi sprigs, and dried lotus petals. Dramatic cold-to-warm crosslight. Deep emerald-black background. Gold metallic mortar and pestle in background. Ultra sharp macro details on foreground herbs, soft bokeh beyond. Botanical apothecary aesthetic. Shot on Phase One. --ar 9:16
```

---

### 3. `avatar-vaidya.png`
**Used in:** Bot message avatar (circular crop, 34×34px rendered)
**Dimensions:** 256 × 256 px. Transparent background (PNG).

**Midjourney / DALL-E Prompt:**
```
Illustrated portrait of a serene ancient Indian physician/sage — calm, wise expression, warm golden skin tone, subtle sacred marks on forehead, half-closed meditative eyes, wearing simple saffron cloth. Soft watercolor illustration style meets editorial art. Dark forest green circular vignette framing. Transparent background. No text. Centered composition. Sacred, dignified, not cartoonish. --ar 1:1
```

---

### 4. `manuscript-strip.jpg`
**Used in:** Thin horizontal strip at top of chat area (38px rendered height, wide)
**Dimensions:** 1920 × 120 px minimum. Panoramic strip.

**Midjourney / DALL-E Prompt:**
```
Ultra-wide panoramic crop of an open ancient Sanskrit manuscript page. Devanagari script barely legible, warm candlelight glow from upper right. Extreme shallow depth of field — left crisp, right blurred. Dark vignette at both edges. Parchment + ink texture. Very horizontal aspect ratio. For use as a thin decorative UI header band. --ar 16:1
```

---

### 5. `welcome-mandala.png`
**Used in:** Welcome state illustration above first message (120×120px rendered, slow spin animation)
**Dimensions:** 512 × 512 px. Transparent background (PNG).

**Midjourney / DALL-E Prompt:**
```
Sacred Shri Yantra mandala with outer lotus petals. Fine single-weight gold line art on transparent background. Geometric precision — interlocking triangles, concentric circles, eight-petal lotus. Ancient gold color (#C9A96E) only — no fill, pure linework. Minimal, meditative, architectural. Looks like it was drawn with a single ruled pen on black ground. Transparent PNG. --ar 1:1
```

---

### 6. `null-state-leaf.png`
**Used in:** "No knowledge match found" empty state icon (28×28px rendered)
**Dimensions:** 256 × 256 px. Transparent background (PNG).

**Midjourney / DALL-E Prompt:**
```
Single wilted and fallen Brahmi leaf (Bacopa monnieri). Macro photograph on transparent background. Slightly desaturated, soft grey-green tones with hints of dry amber edges. Studio lit with a single diffused backlight to reveal leaf venation. Melancholy, quiet, contemplative. Transparent PNG. No background. --ar 1:1
```

---

### 7. `corpus-texture.jpg`
**Used in:** Admin panel knowledge pipeline card background
**Dimensions:** 780 × 200 px minimum. Landscape.

**Midjourney / DALL-E Prompt:**
```
Close-up photograph of an ancient handbound book cover. Dark forest-green aged leather with intricate gold embossed geometric border. Oblique raking light from the left reveals texture and wear. Gold inlay Sanskrit characters partially legible. Museum conservation aesthetic. Deep rich tones — forest black, ancient gold. --ar 4:1
```

---

---

## LANDING PAGE IMAGES (8 files)
Used in `src/LandingPage.tsx`

---

### 8. `hero-bg-texture.jpg`
**Used in:** Hero section full-bleed background
**Dimensions:** 1920 × 1080 px minimum. Landscape.

**Midjourney / DALL-E Prompt:**
```
Fine art aerial photograph of an Ayurvedic healing garden at dawn. Symmetrical medicinal herb beds arranged in a mandala-like geometric pattern viewed from directly above. Dark forest floor with emerald green ashwagandha, neem, and tulsi plants catching first light. Ancient stone path borders. Morning mist. Drone photography aesthetic, extreme detail. Dark emerald and warm gold palette. --ar 16:9
```

---

### 9. `hero-mandala-overlay.png`
**Used in:** Hero section decorative layered over the SVG yantra
**Dimensions:** 900 × 900 px. Transparent PNG.

**Midjourney / DALL-E Prompt:**
```
Ancient star chart and mandala hybrid. Combination of a Vedic astrological wheel (Jyotish Kundali) and a sacred geometry yantra. Fine gold linework on transparent background. Outer ring shows Sanskrit Devanagari diacritics. Inner interlocking triangles — Shatkona. Concentric dotted circles with ancient astronomical markings. Single color: warm gold (#C9A96E). No fill. Transparent PNG. --ar 1:1
```

---

### 10. `corpus-sushruta.jpg`
**Used in:** Sushruta Samhita corpus card background
**Dimensions:** 600 × 800 px. Portrait.

**Midjourney / DALL-E Prompt:**
```
Macro photograph of ancient Indian surgical instruments arranged on dark slate. Thin gold inlay scalpels, probes, and forceps in perfect geometric order. Dramatic raking side light from upper left. Deep emerald-black background shadows. Museum object photography. One instrument catches a bright specular highlight. Cinematic still life. --ar 3:4
```

---

### 11. `corpus-charaka.jpg`
**Used in:** Charaka Samhita corpus card background
**Dimensions:** 600 × 800 px. Portrait.

**Midjourney / DALL-E Prompt:**
```
Overhead flat-lay of Ayurvedic medicinal botanicals on dark linen cloth. Ashwagandha root, neem leaves, turmeric rhizome, dried lotus petals, vibhitaki berry, amalaki fruit. Arranged in a loose circular pattern leaving negative space. Warm backlight from the left, deep green shadows. Editorial food photography meets natural history. Vogue Living aesthetic. --ar 3:4
```

---

### 12. `corpus-ashtanga.jpg`
**Used in:** Ashtanga Hridayam corpus card background
**Dimensions:** 600 × 800 px. Portrait.

**Midjourney / DALL-E Prompt:**
```
Long exposure photograph of a single flame reflected on still black water. Seven points of bioluminescent teal-green light arranged vertically above the water, connected by faint light trails — representing the seven dhatus. Translucent silk fabric with gold thread weave partially in frame. Mystical, meditative, sacred geometry. Fine art photography. Deep black and emerald palette. --ar 3:4
```

---

### 13. `features-botanical.jpg`
**Used in:** Features section atmospheric background
**Dimensions:** 1920 × 800 px. Wide landscape.

**Midjourney / DALL-E Prompt:**
```
Extreme ultra-macro photograph of a single Brahmi leaf (Bacopa monnieri). Enormous individual water droplets suspended on the surface catch light like crystal spheres. Dark forest emerald bokeh background. Studio backlight creates the leaf's veins as translucent emerald threads. Shot on Phase One IQ4, extreme depth of field control. Scientific botanical illustration meets luxury fashion photography. --ar 24:10
```

---

### 14. `cta-atmosphere.jpg`
**Used in:** CTA (Call to Action) section full-bleed background
**Dimensions:** 1920 × 1080 px. Landscape.

**Midjourney / DALL-E Prompt:**
```
Fine art long-exposure night photography. A glowing Shri Yantra geometry floats above perfectly still dark water. The sacred geometry reflects as bioluminescent emerald light trails in the water below. Stars reflected in water create a double universe effect. Thin gold line of the yantra against absolute black. 30-second exposure quality. --ar 16:9
```

---

### 15. `knowledge-layers.jpg`
**Used in:** How It Works section accent image
**Dimensions:** 780 × 520 px. Landscape.

**Midjourney / DALL-E Prompt:**
```
Scientific cross-section illustration style photograph. Microscopic view of an ancient palm leaf manuscript page showing cross-sectional layers — outer protective leaf cuticle, carbon ink inscription layer, inner cell structure, preservation resin layer. False-color emerald and gold palette as if seen through an electron microscope. Ultra-detailed, data visualization meets natural history museum exhibit photography. --ar 3:2
```

---

---

## MASTER CHECKLIST

| # | Filename | Section | Format | Size |
|---|---|---|---|---|
| 1 | `chat-bg-texture.jpg` | Chat · main BG | JPG | 1920×1080 |
| 2 | `sidebar-herbs.jpg` | Chat · sidebar BG | JPG | 540×960 |
| 3 | `avatar-vaidya.png` | Chat · bot avatar | PNG (transparent) | 256×256 |
| 4 | `manuscript-strip.jpg` | Chat · top strip | JPG | 1920×120 |
| 5 | `welcome-mandala.png` | Chat · welcome state | PNG (transparent) | 512×512 |
| 6 | `null-state-leaf.png` | Chat · null/empty state | PNG (transparent) | 256×256 |
| 7 | `corpus-texture.jpg` | Chat · admin panel card | JPG | 780×200 |
| 8 | `hero-bg-texture.jpg` | Landing · hero BG | JPG | 1920×1080 |
| 9 | `hero-mandala-overlay.png` | Landing · hero yantra layer | PNG (transparent) | 900×900 |
| 10 | `corpus-sushruta.jpg` | Landing · Sushruta card | JPG | 600×800 |
| 11 | `corpus-charaka.jpg` | Landing · Charaka card | JPG | 600×800 |
| 12 | `corpus-ashtanga.jpg` | Landing · Ashtanga card | JPG | 600×800 |
| 13 | `features-botanical.jpg` | Landing · features BG | JPG | 1920×800 |
| 14 | `cta-atmosphere.jpg` | Landing · CTA BG | JPG | 1920×1080 |
| 15 | `knowledge-layers.jpg` | Landing · How It Works | JPG | 780×520 |

**Total: 15 images**

---

## RECOMMENDED TOOLS

- **Midjourney v6.1** — best for photorealistic editorial (images 1,2,4,10,11,12,13,14,15)
- **DALL-E 3 (ChatGPT)** — best for precise compositions, transparent PNGs (images 3,5,6,9)
- **Adobe Firefly** — best for commercial-safe botanical macro (images 1,2,13,15)
- **Stable Diffusion XL + ComfyUI** — best for full creative control + transparent backgrounds

## UPLOAD INSTRUCTIONS

1. Generate all 15 images
2. In Supabase Dashboard → Storage → `generated-images` bucket
3. Create folder: `VaidyaRAG/`
4. Upload each file with the exact filename from the checklist above
5. Ensure bucket is set to **Public** access
6. Files will be live at:
   `https://yidjcuymlbmdxbjcjjbd.supabase.co/storage/v1/object/public/generated-images/VaidyaRAG/<filename>`
