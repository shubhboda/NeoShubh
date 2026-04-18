import express from "express";
import cors from "cors";
import pg from "pg";
import { GoogleGenAI } from "@google/genai";
import {
  extractEntitiesFromQuery,
  retrieveGraphContext,
  mergeHybridContext,
} from "./hybridGraphRag";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString?.trim()) {
      throw new Error(
        "DATABASE_URL is not set. Add it to .env locally and to Vercel → Environment Variables for production."
      );
    }
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

let warmupPromise: Promise<void> | null = null;
const DEFAULT_KNOWLEDGE_TABLE = "ayurveda_knowledge";
const KNOWLEDGE_TABLES = [
  "ayurveda_knowledge",
  "knowledge_of_chakshita",
  "ashtanga_hridayam_rag",
] as const;

function normalizeTableName(input: unknown): string {
  const raw = typeof input === "string" ? input.trim().toLowerCase() : "";
  const candidate = raw || DEFAULT_KNOWLEDGE_TABLE;
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(candidate)) {
    throw new Error(
      "Invalid knowledgeBase name. Use only lowercase letters, numbers, and underscore (start with letter)."
    );
  }
  return candidate;
}

function ensureSafeIdentifier(identifier: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(identifier)) {
    throw new Error("Unsafe SQL identifier");
  }
  return `"${identifier}"`;
}

async function ensureKnowledgeTable(client: pg.PoolClient, tableName: string): Promise<void> {
  const table = ensureSafeIdentifier(tableName);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${table} (
      id SERIAL PRIMARY KEY,
      topic TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      embedding vector(3072)
    );
  `);
  await client.query(`
    ALTER TABLE ${table}
    ADD COLUMN IF NOT EXISTS topic TEXT NOT NULL DEFAULT '';
  `);

  const dimCheck = await client.query<{ embedding_type: string | null }>(
    `
      SELECT pg_catalog.format_type(a.atttypid, a.atttypmod) AS embedding_type
      FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = to_regclass($1)
        AND a.attname = 'embedding'
        AND a.attnum > 0
        AND NOT a.attisdropped
      LIMIT 1;
    `,
    [`public.${tableName}`]
  );

  const embeddingType = dimCheck.rows[0]?.embedding_type ?? null;
  if (embeddingType && embeddingType !== "vector(3072)") {
    // Old tables may still have vector(1536). Recreate embedding column in 3072 to avoid ingest failures.
    await client.query(`ALTER TABLE ${table} DROP COLUMN embedding;`);
    await client.query(`ALTER TABLE ${table} ADD COLUMN embedding vector(3072);`);
    console.warn(
      `Knowledge base "${tableName}" had ${embeddingType}; embedding column reset to vector(3072).`
    );
  }
}

/** Runs once: extension + table. Safe to call multiple times (same promise). */
export function warmupDatabase(): Promise<void> {
  if (!warmupPromise) {
    warmupPromise = (async () => {
      const p = getPool();
      const client = await p.connect();
      try {
        await client.query("CREATE EXTENSION IF NOT EXISTS vector;");
        await ensureKnowledgeTable(client, DEFAULT_KNOWLEDGE_TABLE);
        console.log("Database initialized successfully.");
      } finally {
        client.release();
      }
    })().catch((err) => {
      console.error("Database initialization failed:", err);
      warmupPromise = null;
      throw err;
    });
  }
  return warmupPromise;
}

// ─────────────────────────────────────────────────────────────────
// RAG PIPELINE UTILITIES
// ─────────────────────────────────────────────────────────────────

export const SIMILARITY_THRESHOLD = 0.55;

export interface SearchResult {
  topic: string;
  content: string;
  similarity: number;
}

/** Hybrid retrieval: vector cosine similarity + PostgreSQL full-text search, fused via RRF. */
export async function hybridSearch(
  client: pg.PoolClient,
  tableName: string,
  embedding: number[],
  query: string,
  limit = 5
): Promise<SearchResult[]> {
  const table = ensureSafeIdentifier(tableName);
  const vectorStr = `[${embedding.join(",")}]`;

  const vectorResult = await client.query<{
    id: number;
    topic: string;
    content: string;
    similarity: number;
  }>(
    `SELECT id, topic, content, 1 - (embedding <=> $1::vector) AS similarity
     FROM ${table}
     ORDER BY embedding <=> $1::vector
     LIMIT $2;`,
    [vectorStr, limit]
  );

  let ftsRows: { id: number; topic: string; content: string; fts_score: number }[] = [];
  try {
    const ftsResult = await client.query<{
      id: number;
      topic: string;
      content: string;
      fts_score: number;
    }>(
      `SELECT id, topic, content,
              ts_rank(
                to_tsvector('english', coalesce(content,'') || ' ' || coalesce(topic,'')),
                plainto_tsquery('english', $1)
              ) AS fts_score
       FROM ${table}
       WHERE to_tsvector('english', coalesce(content,'') || ' ' || coalesce(topic,''))
             @@ plainto_tsquery('english', $1)
       LIMIT $2;`,
      [query, limit]
    );
    ftsRows = ftsResult.rows;
  } catch {
    // FTS may fail on degenerate queries — fall back to vector only
  }

  const seen = new Map<number, SearchResult>();
  for (const row of vectorResult.rows) {
    seen.set(row.id, { topic: row.topic, content: row.content, similarity: row.similarity });
  }
  for (const row of ftsRows) {
    if (!seen.has(row.id)) {
      seen.set(row.id, {
        topic: row.topic,
        content: row.content,
        similarity: 0.5 + row.fts_score * 0.15,
      });
    } else {
      const existing = seen.get(row.id)!;
      existing.similarity = Math.min(1.0, existing.similarity + row.fts_score * 0.05);
    }
  }

  return Array.from(seen.values())
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

/** Search across all knowledge tables and fuse results, de-duplicated by content prefix. */
export async function multiTableHybridSearch(
  client: pg.PoolClient,
  embedding: number[],
  query: string,
  limit = 5
): Promise<SearchResult[]> {
  const allResults: SearchResult[] = [];

  for (const table of KNOWLEDGE_TABLES) {
    try {
      const results = await hybridSearch(client, table, embedding, query, limit);
      allResults.push(...results);
    } catch {
      // Skip tables that are empty or unavailable
    }
  }

  // De-duplicate by content (first 120 chars as key), keep highest similarity
  const seen = new Map<string, SearchResult>();
  for (const r of allResults) {
    const key = r.content.slice(0, 120);
    if (!seen.has(key) || seen.get(key)!.similarity < r.similarity) {
      seen.set(key, r);
    }
  }

  return Array.from(seen.values())
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

/** Build a structured <context> XML block from search results. */
export function buildContextXml(results: SearchResult[]): string {
  const fragments = results
    .map((r, i) => {
      const topic = (r.topic || "").trim();
      const body = (r.content || "").trim().slice(0, 900);
      return [
        `  <fragment index="${i + 1}" similarity="${r.similarity.toFixed(4)}">`,
        `    <topic>${topic}</topic>`,
        `    <body>${body}</body>`,
        `  </fragment>`,
      ].join("\n");
    })
    .join("\n");
  return `<context>\n${fragments}\n</context>`;
}

/** Masterclass System Prompt — Role, Operational Constraints, Cognitive Workflow. */
export function buildSystemPrompt(outputLang: "english" | "hindi"): string {
  const langInstruction =
    outputLang === "hindi"
      ? "Respond EXCLUSIVELY in Hindi (Devanagari script). Avoid English words unless medically unavoidable."
      : "Respond EXCLUSIVELY in English. Be precise and clinically structured.";

  return `You are an elite Ayurvedic intelligence system — a masterclass-level clinical advisor synthesizing millennia of Ayurvedic wisdom with rigorous scholarly precision.

ROLE: Senior Ayurvedic Physician & Knowledge Synthesizer  
DOMAIN AUTHORITY: Sushruta Samhita, Charaka Samhita, Ashtanga Hridayam

OPERATIONAL CONSTRAINTS:
1. Draw answers EXCLUSIVELY from the provided <context> XML block
2. Never fabricate, extrapolate, or hallucinate beyond what the context explicitly supports
3. If a context fragment does not address a specific recommendation, omit that section entirely
4. Reference the <topic> source for each major recommendation cluster
5. ${langInstruction}

FORMATTING RULES — STRICTLY ENFORCED:
- NEVER use asterisks (*) or double-asterisks (**) for any purpose
- NEVER use markdown bold or italic syntax
- Use plain section headings followed by a colon on their own line, e.g. "Assessment:"
- Use a simple dash (-) for list items, never bullet symbols or asterisks
- Separate sections with a single blank line
- Do not use hashtags (#) for headings
- Write numbers and Sanskrit terms plainly without special formatting

COGNITIVE WORKFLOW:
Step 1 — Query Analysis: Identify the symptom pattern, probable dosha imbalance (Vata/Pitta/Kapha), and urgency signal
Step 2 — Context Cross-Reference: Scan ALL <fragment> elements; rank by relevance to the query
Step 3 — Evidence Synthesis: Extract only what the context directly supports
Step 4 — Structured Output: Format under these plain-text headings (omit any heading if unsupported):
  Assessment:
  Diet:
  Avoid:
  Herbs:
  Lifestyle:
Step 5 — Constraint: Maximum 200 words. Precision and brevity over verbosity.`;
}

export function createApiApp(): express.Express {
  const app = express();
  app.use(cors());
  const bodyLimit = process.env.VERCEL ? "4mb" : "50mb";
  app.use(express.json({ limit: bodyLimit }));

  app.use(async (req, res, next) => {
    try {
      await warmupDatabase();
      next();
    } catch {
      res
        .status(503)
        .json({ status: "error", message: "Database unavailable (check DATABASE_URL)" });
    }
  });

  const router = express.Router();

  router.post("/init-db", async (req, res) => {
    let tableName = DEFAULT_KNOWLEDGE_TABLE;
    try {
      tableName = normalizeTableName(req.body?.knowledgeBase);
      const table = ensureSafeIdentifier(tableName);
      const c = await getPool().connect();
      await c.query("CREATE EXTENSION IF NOT EXISTS vector;");
      await c.query(`DROP TABLE IF EXISTS ${table};`);
      await c.query(`
        CREATE TABLE ${table} (
          id SERIAL PRIMARY KEY,
          topic TEXT NOT NULL DEFAULT '',
          content TEXT NOT NULL,
          embedding vector(3072)
        );
      `);
      c.release();
      res.json({
        message: `Knowledge base "${tableName}" initialized successfully with 3072 dimensions`,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Initialization failed" });
    }
  });

  router.get("/list-knowledge", async (req, res) => {
    let tableName = DEFAULT_KNOWLEDGE_TABLE;
    try {
      tableName = normalizeTableName(req.query.knowledgeBase);
      const table = ensureSafeIdentifier(tableName);
      const client = await getPool().connect();
      const result = await client.query(
        `SELECT id, topic, content FROM ${table} ORDER BY id DESC LIMIT 200;`
      );
      client.release();
      res.json({ items: result.rows });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch knowledge" });
    }
  });

  router.get("/db-status", async (req, res) => {
    let tableName = DEFAULT_KNOWLEDGE_TABLE;
    try {
      tableName = normalizeTableName(req.query.knowledgeBase);
      const client = await getPool().connect();
      const tableExistsQuery = `
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = $1
        );
      `;
      const extCheck = await client.query("SELECT * FROM pg_extension WHERE extname = 'vector';");
      const tableCheck = await client.query(tableExistsQuery, [tableName]);
      client.release();
      res.json({
        status: "connected",
        knowledgeBase: tableName,
        vectorExtension: extCheck.rows.length > 0,
        tableExists: tableCheck.rows[0].exists,
      });
    } catch (error) {
      res.status(500).json({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post("/search", async (req, res) => {
    const { embedding, knowledgeBase } = req.body;

    if (!embedding || !Array.isArray(embedding)) {
      return res.status(400).json({ error: "Embedding is required" });
    }

    try {
      const tableName = normalizeTableName(knowledgeBase);
      const table = ensureSafeIdentifier(tableName);
      const client = await getPool().connect();
      await ensureKnowledgeTable(client, tableName);
      const vectorStr = `[${embedding.join(",")}]`;
      const searchResult = await client.query(
        `
        SELECT topic, content, 1 - (embedding <=> $1::vector) as similarity
        FROM ${table}
        ORDER BY embedding <=> $1::vector
        LIMIT 3;
      `,
        [vectorStr]
      );
      client.release();

      const maxCharsPerChunk = 800;
      const context = searchResult.rows
        .filter((row) => row.similarity > 0.5)
        .map((row) => {
          const t = (row.topic ?? "").trim();
          const raw = (row.content ?? "").trim();
          const clipped =
            raw.length > maxCharsPerChunk
              ? raw.slice(0, maxCharsPerChunk).trim() + "..."
              : raw;
          return t ? `Topic: ${t}\n\n${clipped}` : clipped;
        })
        .join("\n\n");

      res.json({ context });
    } catch (error) {
      console.error("Error in /search:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Something went wrong" });
    }
  });

  router.post("/ingest", async (req, res) => {
    const { data, knowledgeBase } = req.body;

    if (!data || !Array.isArray(data)) {
      return res.status(400).json({ error: "Invalid data format" });
    }

    try {
      const tableName = normalizeTableName(knowledgeBase);
      const table = ensureSafeIdentifier(tableName);
      const client = await getPool().connect();
      await ensureKnowledgeTable(client, tableName);
      for (const item of data) {
        if (typeof item.content !== "string" || !item.content.trim()) {
          client.release();
          return res.status(400).json({ error: "Each item needs non-empty content" });
        }
        if (!Array.isArray(item.embedding) || item.embedding.length === 0) {
          client.release();
          return res.status(400).json({ error: "Each item needs a valid embedding array" });
        }
        const topic = typeof item.topic === "string" ? item.topic.trim() : "";
        const vectorStr = `[${item.embedding.join(",")}]`;
        await client.query(
          `INSERT INTO ${table} (topic, content, embedding) VALUES ($1, $2, $3::vector)`,
          [topic, item.content.trim(), vectorStr]
        );
      }
      client.release();
      res.json({ message: "Data ingested successfully" });
    } catch (error) {
      console.error("Ingestion failed:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Ingestion failed" });
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // /api/chat — Hybrid RAG + LLM Bridge with Edge Streaming (SSE)
  // ─────────────────────────────────────────────────────────────────
  router.post("/chat", async (req, res) => {
    const { query, embedding, knowledgeBase, lang } = req.body;

    if (!query || typeof query !== "string" || !query.trim()) {
      return res.status(400).json({ error: "query is required" });
    }
    if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
      return res.status(400).json({ error: "embedding array is required" });
    }

    const geminiKey = process.env.GEMINI_API_KEY?.trim();
    if (!geminiKey) {
      return res.status(503).json({ error: "GEMINI_API_KEY not configured on server." });
    }

    let tableName = DEFAULT_KNOWLEDGE_TABLE;
    try {
      tableName = normalizeTableName(knowledgeBase);
    } catch {
      return res.status(400).json({ error: "Invalid knowledgeBase name" });
    }

    // ── SSE headers ──
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    res.socket?.setNoDelay(true);

    const send = (payload: object) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
      (res as unknown as { flush?: () => void }).flush?.();
    };

    let results: SearchResult[] = [];
    try {
      const client = await getPool().connect();
      try {
        results = await multiTableHybridSearch(client, embedding, query.trim());
      } finally {
        client.release();
      }
    } catch (err) {
      send({ type: "error", message: err instanceof Error ? err.message : "Search failed" });
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    const maxSimilarity = results.length > 0 ? results[0].similarity : 0;

    // ── Safety Layer: Similarity Threshold ──
    if (maxSimilarity < SIMILARITY_THRESHOLD) {
      send({ type: "null_state", similarity: maxSimilarity });
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    // ── Context Injection ──
    let vectorContext = buildContextXml(results);

    // ── Graph RAG: Extract entities and retrieve graph context ──
    let graphContext = "";
    try {
      const entities = await extractEntitiesFromQuery(query.trim());
      graphContext = await retrieveGraphContext(entities);
    } catch (err) {
      // Graph context is optional; if Neo4j fails, continue with vector context only
      console.warn("Graph context retrieval failed:", err instanceof Error ? err.message : String(err));
    }

    // ── Merge vector + graph contexts ──
    const contextXml = mergeHybridContext(vectorContext, graphContext);

    // ── Language Detection — explicit override or auto-detect ──
    const validLangs = ["hindi", "english"] as const;
    const forcedLang = typeof lang === "string" && (validLangs as readonly string[]).includes(lang)
      ? (lang as "hindi" | "english")
      : null;
    const devanagariCount = (query.match(/[\u0900-\u097F]/g) ?? []).length;
    const latinCount = (query.match(/[A-Za-z]/g) ?? []).length;
    const outputLang: "hindi" | "english" = forcedLang ?? (devanagariCount > latinCount ? "hindi" : "english");

    // ── LLM Bridge ──
    const systemPrompt = buildSystemPrompt(outputLang);
    const fullPrompt = `${systemPrompt}\n\n${contextXml}\n\nUSER QUERY:\n${query.trim()}`;

    try {
      const gemini = new GoogleGenAI({ apiKey: geminiKey });
      const stream = await gemini.models.generateContentStream({
        model: "gemini-2.5-flash",
        contents: fullPrompt,
      });

      send({ type: "meta", similarity: maxSimilarity, fragments: results.length });

      for await (const chunk of stream) {
        const text = chunk.text;
        if (text) {
          send({ type: "text", text });
        }
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      // Surface 429 rate-limit with retry delay hint
      const retryMatch = raw.match(/retry[^\d]*(\d+(?:\.\d+)?)\s*s/i);
      const msg = raw.includes("429") || raw.includes("RESOURCE_EXHAUSTED")
        ? `Rate limit reached (free-tier quota). ${retryMatch ? `Retry in ~${Math.ceil(Number(retryMatch[1]))}s.` : "Please wait a moment and try again."}  \n\n_Tip: Switch to a paid Gemini API plan for no quota limits._`
        : `LLM error: ${raw.slice(0, 300)}`;
      send({ type: "error", message: msg });
    }

    res.write("data: [DONE]\n\n");
    res.end();
  });

  app.use("/api", router);
  app.use(router);

  return app;
}
