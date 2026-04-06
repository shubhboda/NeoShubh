import express from "express";
import cors from "cors";
import path from "path";
import { createServer as createViteServer } from "vite";
import pg from "pg";

const { Pool } = pg;

// Initialize Postgres Pool
const pool = new Pool({
  connectionString: "postgresql://postgres.yidjcuymlbmdxbjcjjbd:ehcRMFn2TaBdR5FR@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres",
  ssl: { rejectUnauthorized: false }
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  // Long knowledge text + 3072-dim embedding exceeds Express default ~100kb JSON limit.
  app.use(express.json({ limit: "50mb" }));

  // Database Initialization (Create table if not exists)
  try {
    const client = await pool.connect();
    await client.query("CREATE EXTENSION IF NOT EXISTS vector;");
    await client.query(`
      CREATE TABLE IF NOT EXISTS ayurveda_knowledge (
        id SERIAL PRIMARY KEY,
        topic TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        embedding VECTOR(3072)
      );
    `);
    await client.query(`
      ALTER TABLE ayurveda_knowledge
      ADD COLUMN IF NOT EXISTS topic TEXT NOT NULL DEFAULT '';
    `);
    client.release();
    console.log("Database initialized successfully.");
  } catch (err) {
    console.error("Database initialization failed:", err);
  }

  // API Endpoint: /init-db
  app.post("/api/init-db", async (req, res) => {
    try {
      const client = await pool.connect();
      // 1. Enable vector extension
      await client.query("CREATE EXTENSION IF NOT EXISTS vector;");
      
      // 2. Drop existing table to fix dimension mismatch
      await client.query("DROP TABLE IF EXISTS ayurveda_knowledge;");
      
      // 3. Create table with correct dimensions (3072 for Gemini Embedding 2)
      await client.query(`
        CREATE TABLE ayurveda_knowledge (
          id SERIAL PRIMARY KEY,
          topic TEXT NOT NULL DEFAULT '',
          content TEXT NOT NULL,
          embedding VECTOR(3072)
        );
      `);
      client.release();
      res.json({ message: "Database initialized successfully with 3072 dimensions" });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Initialization failed" });
    }
  });

  // API Endpoint: /list-knowledge
  app.get("/api/list-knowledge", async (req, res) => {
    try {
      const client = await pool.connect();
      const result = await client.query(
        "SELECT id, topic, content FROM ayurveda_knowledge ORDER BY id DESC LIMIT 200;"
      );
      client.release();
      res.json({ items: result.rows });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch knowledge" });
    }
  });

  // API Endpoint: /db-status
  app.get("/api/db-status", async (req, res) => {
    try {
      const client = await pool.connect();
      // Check if extension exists
      const extCheck = await client.query("SELECT * FROM pg_extension WHERE extname = 'vector';");
      // Check if table exists
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
        tableExists: tableCheck.rows[0].exists 
      });
    } catch (error) {
      res.status(500).json({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  });

  // API Endpoint: /search
  app.post("/api/search", async (req, res) => {
    const { embedding } = req.body;

    if (!embedding || !Array.isArray(embedding)) {
      return res.status(400).json({ error: "Embedding is required" });
    }

    try {
      // Perform similarity search in Supabase (pgvector)
      const client = await pool.connect();
      // Convert array to string format [1,2,3] for pgvector
      const vectorStr = `[${embedding.join(",")}]`;
      const searchResult = await client.query(`
        SELECT topic, content, 1 - (embedding <=> $1::vector) as similarity
        FROM ayurveda_knowledge
        ORDER BY embedding <=> $1::vector
        LIMIT 3;
      `, [vectorStr]);
      client.release();

      const context = searchResult.rows
        .filter(row => row.similarity > 0.5) // Threshold
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

  // Ingestion Endpoint (Store data + embedding)
  app.post("/api/ingest", async (req, res) => {
    const { data } = req.body; // Array of { topic?: string, content: string, embedding: number[] }

    if (!data || !Array.isArray(data)) {
      return res.status(400).json({ error: "Invalid data format" });
    }

    try {
      const client = await pool.connect();
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
        console.log(
          `Ingesting topic="${topic}" content: ${item.content.substring(0, 50)}... with embedding length: ${item.embedding.length}`
        );
        // Convert array to string format [1,2,3] for pgvector
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

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
