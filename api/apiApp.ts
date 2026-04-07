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

/** Runs once: extension + table. Safe to call multiple times (same promise). */
export function warmupDatabase(): Promise<void> {
  if (!warmupPromise) {
    warmupPromise = (async () => {
      const p = getPool();
      const client = await p.connect();
      try {
        await client.query("CREATE EXTENSION IF NOT EXISTS vector;");
        await client.query(`
      CREATE TABLE IF NOT EXISTS ayurveda_knowledge (
        id SERIAL PRIMARY KEY,
        topic TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        embedding vector(3072)
      );
    `);
        await client.query(`
      ALTER TABLE ayurveda_knowledge
      ADD COLUMN IF NOT EXISTS topic TEXT NOT NULL DEFAULT '';
    `);
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
    try {
      const c = await getPool().connect();
      await c.query("CREATE EXTENSION IF NOT EXISTS vector;");
      await c.query("DROP TABLE IF EXISTS ayurveda_knowledge;");
      await c.query(`
        CREATE TABLE ayurveda_knowledge (
          id SERIAL PRIMARY KEY,
          topic TEXT NOT NULL DEFAULT '',
          content TEXT NOT NULL,
          embedding vector(3072)
        );
      `);
      c.release();
      res.json({ message: "Database initialized successfully with 3072 dimensions" });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Initialization failed" });
    }
  });

  router.get("/list-knowledge", async (req, res) => {
    try {
      const client = await getPool().connect();
      const result = await client.query(
        "SELECT id, topic, content FROM ayurveda_knowledge ORDER BY id DESC LIMIT 200;"
      );
      client.release();
      res.json({ items: result.rows });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch knowledge" });
    }
  });

  router.get("/db-status", async (req, res) => {
    try {
      const client = await getPool().connect();
      const extCheck = await client.query("SELECT * FROM pg_extension WHERE extname = 'vector';");
      const tableCheck = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'ayurveda_knowledge'
        );
      `);
      client.release();
      res.json({
        status: "connected",
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
    const { embedding } = req.body;

    if (!embedding || !Array.isArray(embedding)) {
      return res.status(400).json({ error: "Embedding is required" });
    }

    try {
      const client = await getPool().connect();
      const vectorStr = `[${embedding.join(",")}]`;
      const searchResult = await client.query(
        `
        SELECT topic, content, 1 - (embedding <=> $1::vector) as similarity
        FROM ayurveda_knowledge
        ORDER BY embedding <=> $1::vector
        LIMIT 3;
      `,
        [vectorStr]
      );
      client.release();

      const context = searchResult.rows
        .filter((row) => row.similarity > 0.5)
        .map((row) => {
          const t = (row.topic ?? "").trim();
          return t ? `Topic: ${t}\n\n${row.content}` : row.content;
        })
        .join("\n\n");

      res.json({ context });
    } catch (error) {
      console.error("Error in /search:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Something went wrong" });
    }
  });

  router.post("/ingest", async (req, res) => {
    const { data } = req.body;

    if (!data || !Array.isArray(data)) {
      return res.status(400).json({ error: "Invalid data format" });
    }

    try {
      const client = await getPool().connect();
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
          "INSERT INTO ayurveda_knowledge (topic, content, embedding) VALUES ($1, $2, $3::vector)",
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
