import express from "express";
import cors from "cors";
import pg from "pg";
import { GoogleGenAI } from "@google/genai";
import { randomUUID } from "crypto";
import {
  buildKnowledgeGraph,
  ensureGraphSchema,
  getNeo4jDriver,
  normalizeGraphRows,
} from "./services/graphService";
import { mergeHybridContext } from "./services/mergeService";
import type { ExtractedEntities } from "./hybridGraphRag";
import {
  buildTemporaryKnowledgeGraph,
  cleanupTemporaryKnowledgeGraph,
  retrieveTemporaryGraphContext,
} from "./hybridGraphRag";
import {
  DEFAULT_KNOWLEDGE_TABLE,
  ensureKnowledgeTable,
  ensureSafeIdentifier,
  getPool,
  normalizeTableName,
  retrieveVectorTopChunks,
  retrieveVectorContext,
  warmupDatabase,
} from "./services/vectorService";
import { embedText } from "./services/embeddingService";
import type { PetGraphRow } from "./hybridGraphRag";

export { getPool, warmupDatabase } from "./services/vectorService";
const ALLOWED_PETS = new Set([
  "dog",
  "cat",
  "cow",
  "buffalo",
  "goat",
  "sheep",
  "horse",
  "rabbit",
  "pig",
  "camel",
  "bird",
  "chicken",
  "poultry",
  "fish",
]);
const NOISE_TERMS = new Set([
  "somebody",
  "dinner",
  "behind",
  "pass",
  "language",
  "order",
  "above",
  "old",
  "himself",
  "sometimes",
  "ago",
  "generation",
]);

function getGeminiServer(): GoogleGenAI {
  const key = typeof process.env.GEMINI_API_KEY === "string" ? process.env.GEMINI_API_KEY.trim() : "";
  if (!key) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to .env.local locally and to Vercel → Environment Variables for production."
    );
  }
  return new GoogleGenAI({ apiKey: key });
}

type OutputLang = "hindi" | "english";
function detectOutputLanguage(text: string): OutputLang {
  const devanagari = (text.match(/[\u0900-\u097F]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return devanagari > latin ? "hindi" : "english";
}

function buildQuotaFallbackAnswer(query: string, vectorContext: string, graphContext: string): string {
  const outLang = detectOutputLanguage(query);
  const graph = graphContext.trim();
  const vector = vectorContext.trim();

  // Try to give a useful, clean answer even if generation is rate-limited.
  // Prefer graph facts, then vector context.
  const petHint = (() => {
    const q = query.toLowerCase();
    for (const pet of ALLOWED_PETS) {
      if (q.includes(pet)) return pet;
    }
    return "";
  })();

  const parseGraphFacts = (text: string) => {
    const items: { pet: string; disease: string; symptoms: string[]; treatments: string[] }[] = [];
    const lines = text.split(/\r?\n/);
    let cur: { pet: string; disease: string; symptoms: string[]; treatments: string[] } | null = null;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line.toLowerCase() === "graph facts:" || line.toLowerCase() === "graph context:") continue;
      if (line.startsWith("- Pet:")) {
        if (cur) items.push(cur);
        cur = { pet: line.replace(/^- Pet:\s*/i, "").trim(), disease: "", symptoms: [], treatments: [] };
        continue;
      }
      if (!cur) continue;
      if (line.startsWith("Disease:") || line.startsWith("- Disease:") || line.startsWith("Disease :")) {
        cur.disease = line.replace(/^-?\s*Disease\s*:\s*/i, "").trim();
        continue;
      }
      if (line.startsWith("Symptoms:") || line.startsWith("- Symptoms:") || line.startsWith("Symptoms :")) {
        const v = line.replace(/^-?\s*Symptoms\s*:\s*/i, "").trim();
        cur.symptoms = v ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];
        continue;
      }
      if (line.startsWith("Treatments:") || line.startsWith("- Treatments:") || line.startsWith("Treatments :")) {
        const v = line.replace(/^-?\s*Treatments\s*:\s*/i, "").trim();
        cur.treatments = v ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];
        continue;
      }
    }
    if (cur) items.push(cur);
    return items;
  };

  if (graph) {
    const facts = parseGraphFacts(graph);
    const picked =
      facts.filter((f) => (petHint ? f.pet.toLowerCase() === petHint : true)).slice(0, 2) ||
      facts.slice(0, 2);

    if (picked.length) {
      if (outLang === "hindi") {
        const f = picked[0];
        const lines: string[] = [];
        lines.push(`- पशु: ${f.pet || petHint || "—"}`);
        if (f.disease) lines.push(`- संभावित बीमारी: ${f.disease}`);
        if (f.symptoms.length) lines.push(`- लक्षण: ${f.symptoms.join(", ")}`);
        if (f.treatments.length) lines.push(`- उपचार: ${f.treatments.join(", ")}`);
        lines.push(`- नोट: ये जवाब उपलब्ध knowledge aur graph facts ke base par diya gaya hai।`);
        return lines.join("\n");
      }

      const f = picked[0];
      const lines: string[] = [];
      lines.push(`- Pet: ${f.pet || petHint || "—"}`);
      if (f.disease) lines.push(`- Possible disease: ${f.disease}`);
      if (f.symptoms.length) lines.push(`- Symptoms: ${f.symptoms.join(", ")}`);
      if (f.treatments.length) lines.push(`- Treatments: ${f.treatments.join(", ")}`);
      lines.push(`- Note: This answer is based on the available knowledge and graph facts.`);
      return lines.join("\n");
    }
  }

  if (vector) {
    const snippet = vector.slice(0, 900).trim();
    if (outLang === "hindi") {
      return `- उपलब्ध knowledge के अनुसार:\n${snippet}\n\n- नोट: ये जवाब उपलब्ध knowledge ke base par diya gaya hai।`;
    }
    return `- Based on available knowledge:\n${snippet}\n\n- Note: This answer is based on the available knowledge.`;
  }

  if (outLang === "hindi") {
    return "Abhi quota/rate-limit ki wajah se answer generate nahi ho pa raha. Thodi der baad dubara try karein.";
  }
  return "Due to quota/rate-limit, an answer can't be generated right now. Please try again shortly.";
}

function normalizePetName(value: string): string {
  const v = value.trim().toLowerCase();
  if (v === "dogs") return "dog";
  if (v === "cats") return "cat";
  if (v === "cattle") return "cow";
  return v;
}

function isMeaningfulVetTerm(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v.length < 3) return false;
  if (!/[a-z]/i.test(v)) return false;
  if (NOISE_TERMS.has(v)) return false;
  return true;
}

// Vector/pg helpers moved to `api/services/vectorService.ts`.

function parseGraphCsv(csv: string): PetGraphRow[] {
  const lines = csv
    .split(/\r?\n/g)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idxPet = headers.findIndex((h) => h === "pet");
  const idxDisease = headers.findIndex((h) => h === "disease");
  const idxSymptoms = headers.findIndex((h) => h === "symptoms" || h === "symptom");
  const idxTreatments = headers.findIndex((h) => h === "treatments" || h === "treatment");
  if (idxPet === -1 || idxDisease === -1 || idxSymptoms === -1 || idxTreatments === -1) {
    throw new Error('CSV headers required: "pet,disease,symptoms,treatments"');
  }

  const rows: unknown[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    rows.push({
      pet: cols[idxPet] ?? "",
      disease: cols[idxDisease] ?? "",
      symptoms: cols[idxSymptoms] ?? "",
      treatments: cols[idxTreatments] ?? "",
    });
  }
  return normalizeGraphRows(rows);
}

async function extractGraphRowFromKnowledge(
  gemini: GoogleGenAI,
  topic: string,
  content: string
): Promise<PetGraphRow | null> {
  const prompt = `
Extract structured veterinary graph fields from the text.
Return STRICT JSON only with keys:
{
  "pet": "string",
  "disease": "string",
  "symptoms": ["string"],
  "treatments": ["string"]
}

Rules:
- Use empty string for unknown scalar values.
- Use empty array for unknown list values.
- symptoms and treatments must be concise normalized strings.
- No markdown, no prose, only JSON.
- IMPORTANT: If this text is not clearly about animal/pet disease, return empty values for all fields.
- Pet must be one of: dog, cat, cow, buffalo, goat, sheep, horse, rabbit, pig, camel, bird, chicken, poultry, fish.

Topic:
${topic || ""}

Content:
${content}
`.trim();

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await gemini.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
      });

      const raw = (res.text || "").trim();
      if (!raw) return null;

      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
          try {
            parsed = JSON.parse(match[0]);
          } catch {
            parsed = null;
          }
        }
      }
      if (!parsed) return null;

      const pet = typeof parsed.pet === "string" ? normalizePetName(parsed.pet) : "";
      const disease = typeof parsed.disease === "string" ? parsed.disease.trim() : "";
      const symptoms = Array.isArray(parsed.symptoms)
        ? parsed.symptoms.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean)
        : [];
      const treatments = Array.isArray(parsed.treatments)
        ? parsed.treatments.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean)
        : [];

      if (!pet || !disease) return null;
      if (!ALLOWED_PETS.has(pet)) return null;
      if (!isMeaningfulVetTerm(disease)) return null;

      const cleanSymptoms = symptoms.filter(isMeaningfulVetTerm).slice(0, 8);
      const cleanTreatments = treatments.filter(isMeaningfulVetTerm).slice(0, 8);
      if (cleanSymptoms.length === 0 && cleanTreatments.length === 0) return null;

      const combinedText = `${topic}\n${content}`.toLowerCase();
      if (!combinedText.includes(pet) && !combinedText.includes(disease.toLowerCase())) {
        return null;
      }

      return {
        pet,
        disease,
        symptoms: cleanSymptoms,
        treatments: cleanTreatments,
      };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const isRateLimited =
        message.includes("RESOURCE_EXHAUSTED") || message.includes("429") || message.includes("quota");
      if (!isRateLimited || attempt === 2) break;
      const backoffMs = 2000 * attempt;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  if (lastError) {
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
  return null;
}

export function createApiApp(): express.Express {
  const app = express();
  app.use(cors());
  const bodyLimit = process.env.VERCEL ? "4mb" : "50mb";
  app.use(express.json({ limit: bodyLimit }));

  const shouldWarmupPostgres = (path: string): boolean => {
    // Warm the vector DB only for endpoints that actually need embeddings/vector similarity.
    // Graph-only endpoints must work without DATABASE_URL/vector extension.
    return (
      path === "/api/search" ||
      path === "/api/ingest-text" ||
      path === "/api/ingest" ||
      path === "/api/init-db" ||
      path === "/api/list-knowledge" ||
      path === "/api/db-status"
    );
  };

  app.use(async (req, res, next) => {
    try {
      if (shouldWarmupPostgres(req.path)) {
        await warmupDatabase();
      }
      next();
    } catch {
      res
        .status(503)
        .json({ status: "error", message: "Database unavailable (check DATABASE_URL)" });
    }
  });

  const router = express.Router();

  router.get("/ai-status", async (_req, res) => {
    const hasKey =
      typeof process.env.GEMINI_API_KEY === "string" && process.env.GEMINI_API_KEY.trim().length > 0;
    res.json({ hasGeminiKey: hasKey });
  });

  router.post("/graph/init", async (_req, res) => {
    try {
      await ensureGraphSchema();
      res.json({ message: "Graph schema initialized successfully" });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Graph init failed" });
    }
  });

  router.post("/graph/reset", async (_req, res) => {
    try {
      const driver = getNeo4jDriver();
      const session = driver.session();
      await session.run("MATCH (n) DETACH DELETE n");
      await session.close();
      await ensureGraphSchema();
      res.json({ message: "Graph reset successfully" });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Graph reset failed",
      });
    }
  });

  router.post("/graph/ingest-text", async (req, res) => {
    const topic = typeof req.body?.topic === "string" ? req.body.topic.trim() : "";
    const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";

    if (!content) {
      return res.status(400).json({ error: "Content is required" });
    }

    try {
      const gemini = getGeminiServer();
      const extracted = await extractGraphRowFromKnowledge(gemini, topic, content);
      if (!extracted) {
        return res.status(400).json({
          error:
            "No graph-ready pet disease fields extracted. Provide text that clearly mentions a pet (dog/cat/cow/...) and the disease.",
        });
      }

      const result = await buildKnowledgeGraph([extracted]);
      res.json({ message: "Graph ingest successful", imported: result.imported, extracted });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Graph ingest failed",
      });
    }
  });

  router.get("/graph/health", async (_req, res) => {
    try {
      const driver = getNeo4jDriver();
      const session = driver.session();
      const result = await session.run("RETURN 1 AS ok");
      await session.close();
      const ok = Number(result.records[0]?.get("ok") ?? 0) === 1;
      res.json({ status: ok ? "connected" : "error" });
    } catch (error) {
      res.status(500).json({
        status: "error",
        message: error instanceof Error ? error.message : "Graph health check failed",
      });
    }
  });

  router.post("/graph/build", async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    try {
      const normalized = normalizeGraphRows(rows);
      const result = await buildKnowledgeGraph(normalized);
      res.json({ message: "Graph built successfully", imported: result.imported });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Graph build failed" });
    }
  });

  router.post("/graph/build-from-csv", async (req, res) => {
    const csv = typeof req.body?.csv === "string" ? req.body.csv : "";
    if (!csv.trim()) return res.status(400).json({ error: "csv is required" });
    try {
      const normalized = parseGraphCsv(csv);
      const result = await buildKnowledgeGraph(normalized);
      res.json({ message: "Graph built from CSV successfully", imported: result.imported });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Graph CSV ingest failed" });
    }
  });

  router.post("/graph/build-from-postgres", async (req, res) => {
    const sourceTable = typeof req.body?.sourceTable === "string" ? req.body.sourceTable.trim() : "";
    if (!sourceTable) return res.status(400).json({ error: "sourceTable is required" });
    let client: pg.PoolClient | null = null;
    try {
      const safeTable = ensureSafeIdentifier(sourceTable.toLowerCase());
      client = await getPool().connect();
      const data = await client.query(
        `SELECT pet, disease, symptoms, treatments FROM ${safeTable} ORDER BY disease ASC LIMIT 5000`
      );
      const normalized = normalizeGraphRows(data.rows);
      const result = await buildKnowledgeGraph(normalized);
      res.json({ message: "Graph built from Postgres successfully", imported: result.imported });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Graph DB ingest failed" });
    } finally {
      client?.release();
    }
  });

  router.post("/graph/build-from-existing-knowledge", async (req, res) => {
    const tableNamesInput = Array.isArray(req.body?.knowledgeBases) ? req.body.knowledgeBases : [];
    const limitPerTableInput = Number(req.body?.limitPerTable);
    const limitPerTable = Number.isFinite(limitPerTableInput) && limitPerTableInput > 0
      ? Math.min(Math.floor(limitPerTableInput), 2000)
      : 100;
    const extractionIntervalInput = Number(req.body?.extractionIntervalMs);
    const extractionIntervalMs =
      Number.isFinite(extractionIntervalInput) && extractionIntervalInput >= 0
        ? Math.floor(extractionIntervalInput)
        : 12000;

    const tableNames = tableNamesInput
      .map((t: unknown) => (typeof t === "string" ? t.trim().toLowerCase() : ""))
      .filter(Boolean);

    if (tableNames.length === 0) {
      return res.status(400).json({
        error: "knowledgeBases array is required (example: ['animal_pet','ashtanga_hridaya'])",
      });
    }

    let client: pg.PoolClient | null = null;
    try {
      const gemini = getGeminiServer();
      client = await getPool().connect();
      await ensureGraphSchema();

      const extractedRows: PetGraphRow[] = [];
      let processed = 0;
      let failedExtractions = 0;
      const skippedTables: string[] = [];

      for (const tableNameRaw of tableNames) {
        const tableName = normalizeTableName(tableNameRaw);
        const table = ensureSafeIdentifier(tableName);
        const tableExistsCheck = await client.query<{ exists: boolean }>(
          `SELECT to_regclass($1) IS NOT NULL AS exists`,
          [`public.${tableName}`]
        );
        if (!tableExistsCheck.rows[0]?.exists) {
          skippedTables.push(tableName);
          continue;
        }
        const rows = await client.query<{ topic: string; content: string }>(
          `SELECT topic, content FROM ${table} ORDER BY id DESC LIMIT $1`,
          [limitPerTable]
        );

        for (const row of rows.rows) {
          const topic = (row.topic || "").trim();
          const content = (row.content || "").trim();
          if (!content) continue;
          processed += 1;
          try {
            const extracted = await extractGraphRowFromKnowledge(gemini, topic, content);
            if (extracted) extractedRows.push(extracted);
          } catch {
            failedExtractions += 1;
          }
          if (extractionIntervalMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, extractionIntervalMs));
          }
        }
      }

      const normalized = normalizeGraphRows(extractedRows);
      const graphResult = await buildKnowledgeGraph(normalized);
      res.json({
        message: "Graph built from existing knowledge tables successfully",
        tables: tableNames,
        processedRows: processed,
        extractedRows: normalized.length,
        failedExtractions,
        skippedTables,
        imported: graphResult.imported,
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Graph build from existing knowledge failed",
      });
    } finally {
      client?.release();
    }
  });

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
      const context = await retrieveVectorContext(embedding, tableName);
      res.json({ context });
    } catch (error) {
      console.error("Error in /search:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Something went wrong" });
    }
  });

  router.post("/ask", async (req, res) => {
    const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
    const knowledgeBase = req.body?.knowledgeBase;

    if (!query) {
      return res.status(400).json({ error: "Query is required" });
    }

    try {
      const gemini = getGeminiServer();
      const outLang = detectOutputLanguage(query);
      const fallback =
        outLang === "hindi"
          ? "Iska Ayurveda data available nahi hai"
          : "No relevant Ayurveda data found in the uploaded knowledge base.";

      // 1) Vector context (Supabase/Postgres vector)
      let vectorContext = "";
      let vectorChunks: Array<{ topic: string; content: string }> = [];
      try {
        await warmupDatabase(); // ensure `vector` extension exists before we create vector columns
        const tableName = normalizeTableName(knowledgeBase);

        const embedding = await embedText(query);
        vectorChunks = await retrieveVectorTopChunks(embedding, tableName);

        vectorContext = vectorChunks
          .map((c) => {
            const t = (c.topic ?? "").trim();
            const raw = (c.content ?? "").trim();
            return t ? `Topic: ${t}\n\n${raw}` : raw;
          })
          .join("\n\n");
      } catch (vectorErr) {
        console.warn("Vector/RAG part failed (answering with fallback only):", vectorErr);
        vectorContext = "";
        vectorChunks = [];
      }

      // 2) Graph context (Neo4j) WITHOUT manual Neo4j data ingestion:
      // - We extract pet/disease/symptoms/treatments from the retrieved vector chunks.
      // - Build a TEMP Neo4j graph for this request only.
      let graphContext = "";
      let entities: ExtractedEntities = {};
      let tempSessionId: string | null = null;
      try {
        if (vectorChunks.length > 0) {
          const q = query.toLowerCase();
          const detectedPet = Array.from(ALLOWED_PETS).find((p) => q.includes(p)) || "human";

          const makeDiseaseName = (c: { topic: string; content: string }): string => {
            const t = (c.topic ?? "").trim();
            if (t) return t;
            // Fallback: take first non-empty line from content.
            const firstLine = (c.content ?? "")
              .split(/\r?\n/g)
              .map((l) => l.trim())
              .find(Boolean);
            return firstLine ? firstLine.slice(0, 120).trim() : "";
          };

          const tempRows: PetGraphRow[] = vectorChunks.slice(0, 3).map((c) => ({
            pet: detectedPet,
            disease: makeDiseaseName(c),
            symptoms: [],
            treatments: [],
          }));

          const usableRows = tempRows.filter((r) => r.pet && r.disease);
          if (usableRows.length > 0) {
            tempSessionId = randomUUID();
            await buildTemporaryKnowledgeGraph(usableRows, tempSessionId);
            graphContext = await retrieveTemporaryGraphContext(tempSessionId);

            const first = usableRows[0];
            entities = {
              pet: first.pet,
              disease: first.disease,
              symptom: first.symptoms?.[0],
              treatment: first.treatments?.[0],
            };
          }
        }
      } catch (graphErr) {
        // If Neo4j is not configured / temp graph build fails,
        // still answer from vector context.
        console.warn("Graph RAG (temp Neo4j) failed; falling back to vector-only:", graphErr);
        graphContext = "";
        entities = {};
      } finally {
        if (tempSessionId) {
          await cleanupTemporaryKnowledgeGraph(tempSessionId).catch(() => {
            /* ignore cleanup errors */
          });
        }
      }

      const context = mergeHybridContext(vectorContext, graphContext);

      if (!context) {
        return res.json({
          answer: fallback,
          vectorContext,
          graphContext,
          context: "",
          entities,
        });
      }

      // 5) Generate final answer grounded in hybrid context
      const outLangInstruction =
        outLang === "hindi"
          ? "Answer ONLY in Hindi (Devanagari). Do not use English words unless unavoidable."
          : "Answer ONLY in English. Do not use Hindi words.";

      const prompt = `
You are an Ayurveda expert. ${outLangInstruction}
Use ONLY the CONTEXT below to answer.

If CONTEXT does not support the answer, reply with:
- Hindi: "${fallback}"
- English: "${fallback}"

CONTEXT:
${context}

USER QUERY:
${query}

OUTPUT (max 6 bullets total, max ~120 words overall):
- Diet:
- Avoid:
- Herbs:
- Lifestyle:
Only write a line if that info is present in CONTEXT; otherwise omit that line.
`.trim();

      let finalAnswer = fallback;
      try {
        const gen = await gemini.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
        });
        finalAnswer = gen.text || fallback;
      } catch (genError) {
        const message = genError instanceof Error ? genError.message : String(genError);
        const isQuota =
          message.includes("RESOURCE_EXHAUSTED") ||
          message.includes("429") ||
          message.toLowerCase().includes("quota");
        if (!isQuota) throw genError;
        // Rate-limited: still try to return best possible grounded bullet answer.
        finalAnswer = buildQuotaFallbackAnswer(query, vectorContext, graphContext);
      }

      res.json({
        answer: finalAnswer,
        vectorContext,
        graphContext,
        context,
        entities,
      });
    } catch (error) {
      console.error("Error in /ask:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Something went wrong" });
    }
  });

  router.post("/ingest-text", async (req, res) => {
    const topic = typeof req.body?.topic === "string" ? req.body.topic.trim() : "";
    const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
    const knowledgeBase = req.body?.knowledgeBase;

    if (!content) {
      return res.status(400).json({ error: "Content is required" });
    }

    try {
      const tableName = normalizeTableName(knowledgeBase);
      const table = ensureSafeIdentifier(tableName);

      const textForEmbedding = topic ? `Topic: ${topic}\n\n${content}` : content;
      const embedding = await embedText(textForEmbedding);

      const client = await getPool().connect();
      await ensureKnowledgeTable(client, tableName);
      const vectorStr = `[${embedding.join(",")}]`;
      await client.query(
        `INSERT INTO ${table} (topic, content, embedding) VALUES ($1, $2, $3::vector)`,
        [topic, content, vectorStr]
      );
      client.release();

      res.json({ message: "Data ingested successfully" });
    } catch (error) {
      console.error("Error in /ingest-text:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Ingestion failed" });
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
