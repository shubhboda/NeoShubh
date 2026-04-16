# Changelog — RAG Pipeline Upgrade

## Overview

This document details every change made to the project during the high-fidelity RAG pipeline and UI redesign session.

---

## 1. `api/apiApp.ts` — Backend RAG Pipeline

### New Import
```ts
import { GoogleGenAI } from "@google/genai";
```
Added to enable server-side LLM streaming via the Gemini SDK.

---

### New: `SIMILARITY_THRESHOLD` constant
```ts
export const SIMILARITY_THRESHOLD = 0.75;
```
A safety gate. Any query whose best vector match scores below 75% relevance is rejected before reaching the LLM.

---

### New: `SearchResult` interface
```ts
export interface SearchResult {
  topic: string;
  content: string;
  similarity: number;
}
```
Typed contract for all retrieval results flowing through the RAG pipeline.

---

### New: `hybridSearch()` — Hybrid Retrieval
**What it does:**  
Combines two retrieval strategies and fuses them:

1. **Vector Similarity Search** — Uses `pgvector`'s `<=>` cosine distance operator to find the top N semantically similar fragments.
2. **Full-Text Search (FTS)** — Uses PostgreSQL's `to_tsvector` + `plainto_tsquery` to find keyword-matching fragments. Gracefully falls back to vector-only if the query is malformed for FTS.
3. **RRF Fusion** — Results are merged into a single scored list. If a fragment appears in both result sets, its FTS score is added as a bonus to its vector similarity score (boosting precision). FTS-only hits are included at a base score of `0.5 + fts_score * 0.15`.

**Why this matters:**  
Pure vector search can miss exact keyword matches (e.g., herb names, specific symptom terms). FTS catches those. Fusion gives the best of both worlds.

---

### New: `buildContextXml()` — Context Injection
**What it does:**  
Converts the `SearchResult[]` array into a structured `<context>` XML block injected directly into the LLM prompt:

```xml
<context>
  <fragment index="1" similarity="0.8821">
    <topic>Acidity (Amlapitta)</topic>
    <body>Pet me jalan, khatti dakar...</body>
  </fragment>
</context>
```

**Why XML?**  
XML is unambiguous for LLMs to parse. Similarity scores are embedded for the model's self-awareness of evidence quality. Body text is clipped to 900 chars to control token budget.

---

### New: `buildSystemPrompt()` — Masterclass System Prompt
A structured multi-section system prompt with three components:

**Role:**  
Senior Ayurvedic Physician & Knowledge Synthesizer, authoritative on Sushruta Samhita, Charaka Samhita, Ashtanga Hridayam.

**Operational Constraints (6 rules):**
1. Draw ONLY from the provided `<context>` XML
2. Never fabricate or hallucinate beyond context
3. Omit sections with no supporting evidence
4. Reference `<topic>` sources for traceability
5. Language instruction (Hindi or English based on query detection)
6. (Implicit — inherited from rule 1)

**Cognitive Workflow (5 steps):**
1. Query Analysis — identify symptom pattern and dosha imbalance
2. Context Cross-Reference — scan ALL fragments and rank
3. Evidence Synthesis — extract only what context supports
4. Structured Output — render as clinical bullets under: Assessment, Diet, Avoid, Herbs, Lifestyle
5. Constraint — max 180 words

**Language detection:**  
The function accepts `"english" | "hindi"` and injects the appropriate instruction.

---

### New: `/api/chat` SSE Streaming Endpoint
**Route:** `POST /api/chat`  
**Input:** `{ query: string, embedding: number[], knowledgeBase?: string }`

**Pipeline flow:**
1. Validates inputs
2. Checks `GEMINI_API_KEY` on server
3. Sets SSE headers (`Content-Type: text/event-stream`)
4. Calls `hybridSearch()` to get ranked fragments
5. **Safety check:** If top similarity < 0.75, emits `{ type: "null_state", similarity }` and closes stream — LLM is never called
6. Calls `buildContextXml()` to structure context
7. Detects output language from Devanagari vs Latin character ratio
8. Calls `buildSystemPrompt()` with detected language
9. Streams from `gemini.models.generateContentStream()` using `gemini-2.0-flash`
10. Each text chunk emits `{ type: "text", text: "..." }`
11. First chunk also emits `{ type: "meta", similarity, fragments }` 
12. On completion, emits `data: [DONE]`

**Event types emitted:**
| Type | Payload | Meaning |
|------|---------|---------|
| `meta` | `{ similarity, fragments }` | Retrieval quality stats |
| `text` | `{ text }` | LLM output chunk |
| `null_state` | `{ similarity }` | Below threshold, no answer |
| `error` | `{ message }` | Any pipeline failure |

---

### Unchanged
- `getPool()`, `warmupDatabase()`, `ensureKnowledgeTable()`, `normalizeTableName()`, `ensureSafeIdentifier()`
- `/api/init-db`, `/api/list-knowledge`, `/api/db-status`, `/api/search`, `/api/ingest` routes — all preserved as-is

---

## 2. `src/App.tsx` — Frontend

### Updated: `Message` interface
Added three optional fields to support the new streaming and safety-layer states:
```ts
interface Message {
  id: string;
  role: "user" | "bot";
  content: string;
  isNullState?: boolean;   // true if similarity threshold was not met
  isStreaming?: boolean;   // true while the SSE stream is active
  similarity?: number;     // top fragment similarity score from /api/chat meta event
}
```

### Added: `textareaRef`
```ts
const textareaRef = useRef<HTMLTextAreaElement>(null);
```
Used to auto-resize the input textarea as the user types.

### Updated: Initial welcome message
Changed from an informal Hindi greeting to a bilingual, editorial-tone opening that sets the professional register.

### Replaced: `handleSend()` — SSE Streaming Client
**Old behaviour:** Called `/api/search`, assembled a prompt client-side, called `gemini.models.generateContent()` (blocking, no streaming), used `gemini-3-flash-preview`.

**New behaviour:**
1. Generates embedding client-side (unchanged — avoids server key exposure)
2. POSTs to `/api/chat` with `{ query, embedding, knowledgeBase }`
3. Reads response as a `ReadableStream` using `response.body.getReader()`
4. Decodes SSE lines manually using `TextDecoder` with `stream: true`
5. On `meta` event — nothing visible, stores for potential future use
6. On `text` event — appends text to the bot message incrementally (typewriter effect)
7. On `null_state` event — replaces bot message with a structured null-state explanation including the actual relevance percentage
8. On `[DONE]` — marks `isStreaming: false` on the message
9. The bot message is created as a shell `{ content: "", isStreaming: true }` before streaming starts, so the cursor appears immediately

### Updated: Lucide icon imports
Removed unused: `Bot`, `User`, `Info`  
Added: `ChevronDown`

---

## 3. `src/index.css` — Design System

Complete redesign. All old Tailwind `stone-*` light-mode styles replaced with a dark, premium design system.

### New design tokens (via `@theme`)
- `--font-serif`: `"Georgia", "Times New Roman", ui-serif, serif`  

### New utility classes

| Class | Purpose |
|-------|---------|
| `.custom-scrollbar` | 3px emerald-tinted scrollbar |
| `.streaming-cursor` | `::after` pseudo-element with blinking `▋` in emerald |
| `.glass` | Dark glassmorphism panel — `rgba(10,22,14,0.82)` + `blur(20px)` |
| `.glass-light` | Lighter glassmorphism variant |
| `.bubble-bot` | Bot message bubble — dark emerald tint |
| `.bubble-user` | User message bubble — warm gold tint |
| `.bubble-null` | Null-state message bubble — dark red tint |
| `.rag-prose` | Scoped Markdown prose styles for dark theme |

### `.rag-prose` specifics
- `ul` items use `·` (CSS `content`) in emerald instead of native bullets
- `strong` renders in muted sage (`#a8d5c0`)
- `h1/h2/h3` use Georgia serif in light sage (`#c9f0dc`)
- `code` uses `JetBrains Mono` with an emerald-tinted background

---

## 4. New UI — Design Language

### Visual archetype
**"Ethereal Precision"** blended with **"Organic Modernism"**:
- Background: Deep forest black `#030a05 → #050d08 → #04090a` (CSS gradient)
- Ambient glows: Two radial gradients — emerald at top-left, gold at bottom-right
- Primary accent: `#00c270` (Healer Emerald)
- Secondary accent: `#c9a96e` (Warm Gold)
- Text: `#dff0e8` (Sage White)

### Header
- Glassmorphism strip (`glass` class) sticky at top
- Wordmark in Georgia serif with monospace RAG/DB tagline beneath
- DB status pill with live glow dot
- Knowledge panel toggle with animated `ChevronDown`

### Admin/Knowledge Panel
- Slides in with `AnimatePresence` + height animation
- Monospace labels throughout for a "scientific terminal" aesthetic
- Inline DB status badges (pgvector, table readiness)
- Preserved all admin logic: table selection, init DB, seed, single ingest, bulk CSV, bundled Sushruta CSV import, corpus list

### Chat messages
- Bot bubbles: left-aligned with a leaf icon avatar, `bubble-bot` surface, `rag-prose` Markdown
- User bubbles: right-aligned, `bubble-user` warm gold surface, no icon
- Null-state bubbles: `bubble-null` red tint, explains exactly why no answer was given (score + threshold)
- Streaming cursor appears on the active bot message via `.streaming-cursor` class that's removed once streaming ends
- Similarity score displayed beneath each bot response in monospace

### Input bar
- Auto-expanding `<textarea>` (1–~5 rows) replacing the single-line `<input>`
- `Enter` to submit, `Shift+Enter` for newline
- Glassmorphism container with emerald caret
- Footer tagline in monospace uppercase listing the full pipeline

---

## 5. No breaking changes to existing routes

All existing API routes (`/api/search`, `/api/ingest`, `/api/init-db`, `/api/list-knowledge`, `/api/db-status`) are fully preserved. The new `/api/chat` endpoint is purely additive.

The old `/api/search` path is no longer used by the main chat UI but remains available (used internally by the new `/api/chat`, and still callable externally).
