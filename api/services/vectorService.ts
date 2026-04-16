import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export const DEFAULT_KNOWLEDGE_TABLE = "ayurveda_knowledge";

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

function ensureSafeIdentifier(identifier: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(identifier)) {
    throw new Error("Unsafe SQL identifier");
  }
  return `"${identifier}"`;
}

export function normalizeTableName(input: unknown): string {
  const raw = typeof input === "string" ? input.trim().toLowerCase() : "";
  const candidate = raw || DEFAULT_KNOWLEDGE_TABLE;
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(candidate)) {
    throw new Error(
      "Invalid knowledgeBase name. Use only lowercase letters, numbers, and underscore (start with letter)."
    );
  }
  return candidate;
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

export async function retrieveVectorContext(embedding: number[], tableName: string): Promise<string> {
  const chunks = await retrieveVectorTopChunks(embedding, tableName);
  return chunks
    .map((c) => {
      const t = (c.topic ?? "").trim();
      const raw = (c.content ?? "").trim();
      return t ? `Topic: ${t}\n\n${raw}` : raw;
    })
    .join("\n\n");
}

export async function retrieveVectorTopChunks(
  embedding: number[],
  tableName: string
): Promise<Array<{ topic: string; content: string }>> {
  const safeTable = ensureSafeIdentifier(tableName);
  const client = await getPool().connect();
  try {
    await ensureKnowledgeTable(client, tableName);
    const vectorStr = `[${embedding.join(",")}]`;

    const searchResult = await client.query(
      `
      SELECT topic, content, 1 - (embedding <=> $1::vector) as similarity
      FROM ${safeTable}
      ORDER BY embedding <=> $1::vector
      LIMIT 3;
    `,
      [vectorStr]
    );

    const maxCharsPerChunk = 1200;
    return searchResult.rows
      .filter((row) => row.similarity > 0.5)
      .map((row) => {
        const t = (row.topic ?? "").trim();
        const raw = (row.content ?? "").trim();
        const clipped = raw.length > maxCharsPerChunk ? raw.slice(0, maxCharsPerChunk).trim() + "..." : raw;
        return { topic: t, content: clipped };
      });
  } finally {
    client.release();
  }
}

/** Runs once: ensure vector extension + default table exist. Safe to call multiple times. */
export function warmupDatabase(): Promise<void> {
  if (!warmupPromise) {
    warmupPromise = (async () => {
      const client = await getPool().connect();
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

// Needed by ingestion routes: create table + normalize embedding dimension.
export { ensureKnowledgeTable, ensureSafeIdentifier };

