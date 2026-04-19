import neo4j from "neo4j-driver";
import type { Driver, Session } from "neo4j-driver";

export interface PetGraphRow {
  pet: string;
  disease: string;
  symptoms: string[];
  treatments: string[];
}

export interface ExtractedEntities {
  pet?: string;
  disease?: string;
  symptom?: string;
  treatment?: string;
}

let neo4jDriver: Driver | null = null;

export function getNeo4jDatabase(): string {
  return process.env.NEO4J_DATABASE?.trim() || process.env.AURA_INSTANCEID?.trim() || "neo4j";
}

export function getNeo4jDriver(): Driver {
  if (neo4jDriver) return neo4jDriver;
  const uri = process.env.NEO4J_URI?.trim();
  const user = process.env.NEO4J_USER?.trim() || process.env.NEO4J_USERNAME?.trim();
  const password = process.env.NEO4J_PASSWORD?.trim();

  if (!uri || !user || !password) {
    throw new Error(
      "Neo4j is not configured. Set NEO4J_URI, NEO4J_USER (or NEO4J_USERNAME), and NEO4J_PASSWORD."
    );
  }

  neo4jDriver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
    disableLosslessIntegers: true,
  });
  return neo4jDriver;
}

function normalizeScalar(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function uniqueNonEmpty(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value.trim());
  }
  return out;
}

function splitDelimited(raw: string): string[] {
  if (!raw) return [];
  return uniqueNonEmpty(
    raw
      .split(/[;,|]/g)
      .map((v) => v.trim())
      .filter(Boolean)
  );
}

export function normalizeGraphRows(rows: unknown[]): PetGraphRow[] {
  const out: PetGraphRow[] = [];
  for (const row of rows) {
    const obj = row as Record<string, unknown>;
    const pet = normalizeScalar(obj.pet);
    const disease = normalizeScalar(obj.disease);
    if (!pet || !disease) continue;

    const symptomSource = Array.isArray(obj.symptoms)
      ? (obj.symptoms as unknown[]).map((v) => normalizeScalar(v))
      : splitDelimited(normalizeScalar(obj.symptoms));
    const treatmentSource = Array.isArray(obj.treatments)
      ? (obj.treatments as unknown[]).map((v) => normalizeScalar(v))
      : splitDelimited(normalizeScalar(obj.treatments || obj.treatment));

    out.push({
      pet,
      disease,
      symptoms: uniqueNonEmpty(symptomSource.filter(Boolean)),
      treatments: uniqueNonEmpty(treatmentSource.filter(Boolean)),
    });
  }
  return out;
}

export async function ensureGraphSchema(): Promise<void> {
  const driver = getNeo4jDriver();
  const session = driver.session({ database: getNeo4jDatabase() });
  try {
    await session.run("CREATE CONSTRAINT pet_name_unique IF NOT EXISTS FOR (p:Pet) REQUIRE p.name IS UNIQUE");
    await session.run(
      "CREATE CONSTRAINT disease_name_unique IF NOT EXISTS FOR (d:Disease) REQUIRE d.name IS UNIQUE"
    );
    await session.run(
      "CREATE CONSTRAINT symptom_name_unique IF NOT EXISTS FOR (s:Symptom) REQUIRE s.name IS UNIQUE"
    );
    await session.run(
      "CREATE CONSTRAINT treatment_name_unique IF NOT EXISTS FOR (t:Treatment) REQUIRE t.name IS UNIQUE"
    );
  } finally {
    await session.close();
  }
}

export async function buildKnowledgeGraph(rows: PetGraphRow[]): Promise<{ imported: number }> {
  if (rows.length === 0) return { imported: 0 };
  await ensureGraphSchema();
  const driver = getNeo4jDriver();
  const session = driver.session({ database: getNeo4jDatabase() });
  try {
    await session.executeWrite(async (tx) => {
      await tx.run(
        `
        UNWIND $rows AS row
        MERGE (p:Pet {name: row.pet})
        MERGE (d:Disease {name: row.disease})
        MERGE (p)-[:HAS_DISEASE]->(d)
        WITH row, d
        UNWIND row.symptoms AS symptomName
          MERGE (s:Symptom {name: symptomName})
          MERGE (d)-[:HAS_SYMPTOM]->(s)
        `,
        { rows }
      );
      await tx.run(
        `
        UNWIND $rows AS row
        MERGE (d:Disease {name: row.disease})
        WITH row, d
        UNWIND row.treatments AS treatmentName
          MERGE (t:Treatment {name: treatmentName})
          MERGE (d)-[:HAS_TREATMENT]->(t)
        `,
        { rows }
      );
    });
    return { imported: rows.length };
  } finally {
    await session.close();
  }
}

async function findBestEntityByLabel(
  session: Session,
  label: "Pet" | "Disease" | "Symptom" | "Treatment",
  query: string
): Promise<string | undefined> {
  const result = await session.run(
    `
    MATCH (n:${label})
    WHERE toLower($query) CONTAINS toLower(n.name)
       OR toLower(n.name) CONTAINS toLower($query)
    RETURN n.name AS name, size(n.name) AS nameSize
    ORDER BY nameSize DESC
    LIMIT 1
    `,
    { query }
  );
  const name = result.records[0]?.get("name");
  return typeof name === "string" && name.trim() ? name.trim() : undefined;
}

export async function extractEntitiesFromQuery(query: string): Promise<ExtractedEntities> {
  const driver = getNeo4jDriver();
  const session = driver.session({ database: getNeo4jDatabase() });
  try {
    const q = query.trim();
    if (!q) return {};
    // Neo4j session does not allow concurrent run() calls on the same session.
    const pet = await findBestEntityByLabel(session, "Pet", q);
    const disease = await findBestEntityByLabel(session, "Disease", q);
    const symptom = await findBestEntityByLabel(session, "Symptom", q);
    const treatment = await findBestEntityByLabel(session, "Treatment", q);
    return { pet, disease, symptom, treatment };
  } finally {
    await session.close();
  }
}

export async function retrieveGraphContext(entities: ExtractedEntities): Promise<string> {
  const hasEntity = Object.values(entities).some(Boolean);
  if (!hasEntity) return "";

  const driver = getNeo4jDriver();
  const session = driver.session({ database: getNeo4jDatabase() });
  try {
    const result = await session.run(
      `
      MATCH (p:Pet)-[:HAS_DISEASE]->(d:Disease)
      WHERE ($pet IS NULL OR toLower(p.name) = toLower($pet))
        AND ($disease IS NULL OR toLower(d.name) = toLower($disease))
      OPTIONAL MATCH (d)-[:HAS_SYMPTOM]->(s:Symptom)
      OPTIONAL MATCH (d)-[:HAS_TREATMENT]->(t:Treatment)
      WITH p, d, s, t
      WHERE ($symptom IS NULL OR (s IS NOT NULL AND toLower(s.name) = toLower($symptom)))
        AND ($treatment IS NULL OR (t IS NOT NULL AND toLower(t.name) = toLower($treatment)))
      RETURN p.name AS pet, d.name AS disease,
             collect(DISTINCT s.name) AS symptoms,
             collect(DISTINCT t.name) AS treatments
      LIMIT 12
      `,
      {
        pet: entities.pet ?? null,
        disease: entities.disease ?? null,
        symptom: entities.symptom ?? null,
        treatment: entities.treatment ?? null,
      }
    );

    if (result.records.length === 0) return "";
    const lines: string[] = [];
    lines.push("Graph facts:");
    for (const record of result.records) {
      const pet = String(record.get("pet") ?? "").trim();
      const disease = String(record.get("disease") ?? "").trim();
      const symptoms = ((record.get("symptoms") as string[]) ?? []).filter(Boolean);
      const treatments = ((record.get("treatments") as string[]) ?? []).filter(Boolean);
      lines.push(`- Pet: ${pet}`);
      lines.push(`  Disease: ${disease}`);
      if (symptoms.length) lines.push(`  Symptoms: ${uniqueNonEmpty(symptoms).join(", ")}`);
      if (treatments.length) lines.push(`  Treatments: ${uniqueNonEmpty(treatments).join(", ")}`);
    }
    return lines.join("\n");
  } finally {
    await session.close();
  }
}

export function mergeHybridContext(vectorContext: string, graphContext: string): string {
  const v = vectorContext.trim();
  const g = graphContext.trim();
  if (v && g) return `Vector context:\n${v}\n\nGraph context:\n${g}`;
  if (v) return `Vector context:\n${v}`;
  if (g) return `Graph context:\n${g}`;
  return "";
}

function normalizeSessionId(sessionId: string): string {
  // Keep it simple and safe for Cypher params (Neo4j properties are strings).
  return sessionId.trim().slice(0, 128);
}

/**
 * Builds a TEMP graph inside Neo4j for the current request only.
 * After answering, caller must cleanup via `cleanupTemporaryKnowledgeGraph(sessionId)`.
 */
export async function buildTemporaryKnowledgeGraph(
  rows: PetGraphRow[],
  sessionId: string
): Promise<{ imported: number }> {
  const sid = normalizeSessionId(sessionId);
  const safeRows = rows.filter((r) => r.pet && r.disease);
  if (safeRows.length === 0) return { imported: 0 };

  const driver = getNeo4jDriver();
  const session = driver.session({ database: getNeo4jDatabase() });

  try {
    // Constraints are schema-level and do not depend on data rows.
    // This makes the temp graph safer to query even on first run.
    await ensureGraphSchema();

    await session.executeWrite(async (tx) => {
      await tx.run(
        `
        UNWIND $rows AS row
        WITH row, $sid AS sid
        MERGE (p:Pet {name: row.pet + '__' + sid, _sid: sid})
          SET p.displayName = row.pet
        MERGE (d:Disease {name: row.disease + '__' + sid, _sid: sid})
          SET d.displayName = row.disease
        MERGE (p)-[:HAS_DISEASE]->(d)
        WITH row, d, sid
        UNWIND row.symptoms AS symptomName
          MERGE (s:Symptom {name: symptomName + '__' + sid, _sid: sid})
            SET s.displayName = symptomName
          MERGE (d)-[:HAS_SYMPTOM]->(s)
        WITH row, d, sid
        UNWIND row.treatments AS treatmentName
          MERGE (t:Treatment {name: treatmentName + '__' + sid, _sid: sid})
            SET t.displayName = treatmentName
          MERGE (d)-[:HAS_TREATMENT]->(t)
        `,
        { rows: safeRows, sid }
      );
    });

    return { imported: safeRows.length };
  } finally {
    await session.close();
  }
}

/**
 * Retrieves facts only from temp graph nodes created with the provided session id.
 */
export async function retrieveTemporaryGraphContext(sessionId: string): Promise<string> {
  const sid = normalizeSessionId(sessionId);
  const driver = getNeo4jDriver();
  const session = driver.session({ database: getNeo4jDatabase() });

  try {
    const result = await session.run(
      `
      MATCH (p:Pet {_sid: $sid})-[:HAS_DISEASE]->(d:Disease {_sid: $sid})
      OPTIONAL MATCH (d)-[:HAS_SYMPTOM]->(s:Symptom {_sid: $sid})
      OPTIONAL MATCH (d)-[:HAS_TREATMENT]->(t:Treatment {_sid: $sid})
      WITH p, d, s, t
      RETURN p.displayName AS pet, d.displayName AS disease,
             collect(DISTINCT s.displayName) AS symptoms,
             collect(DISTINCT t.displayName) AS treatments
      LIMIT 12
      `,
      { sid }
    );

    if (result.records.length === 0) return "";

    const lines: string[] = [];
    lines.push("Graph facts:");

    for (const record of result.records) {
      const pet = String(record.get("pet") ?? "").trim();
      const disease = String(record.get("disease") ?? "").trim();
      const symptoms = ((record.get("symptoms") as string[]) ?? []).filter(Boolean);
      const treatments = ((record.get("treatments") as string[]) ?? []).filter(Boolean);
      lines.push(`- Pet: ${pet}`);
      lines.push(`  Disease: ${disease}`);
      if (symptoms.length) lines.push(`  Symptoms: ${uniqueNonEmpty(symptoms).join(", ")}`);
      if (treatments.length) lines.push(`  Treatments: ${uniqueNonEmpty(treatments).join(", ")}`);
    }

    return lines.join("\n");
  } finally {
    await session.close();
  }
}

/**
 * Deletes ONLY temp graph nodes created for a given session id.
 * This prevents Neo4j from accumulating data across requests.
 */
export async function cleanupTemporaryKnowledgeGraph(sessionId: string): Promise<void> {
  const sid = normalizeSessionId(sessionId);
  const driver = getNeo4jDriver();
  const session = driver.session({ database: getNeo4jDatabase() });

  try {
    await session.run(`MATCH (n) WHERE n._sid = $sid DETACH DELETE n`, { sid });
  } finally {
    await session.close();
  }
}

