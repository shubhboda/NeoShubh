import express from "express";
import cors from "cors";
import pg from "pg";

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

  app.use("/api", router);
  app.use(router);

  return app;
}
