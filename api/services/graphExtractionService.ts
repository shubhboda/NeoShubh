import { GoogleGenAI } from "@google/genai";
import type { PetGraphRow } from "../hybridGraphRag";

const ALLOWED_PETS = new Set([
  "human",
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

function getGeminiClient(): GoogleGenAI {
  const key = typeof process.env.GEMINI_API_KEY === "string" ? process.env.GEMINI_API_KEY.trim() : "";
  if (!key) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to .env.local locally and to Vercel → Environment Variables for production."
    );
  }
  return new GoogleGenAI({ apiKey: key });
}

function normalizePetName(value: string): string {
  const v = value.trim().toLowerCase();
  if (v === "dogs") return "dog";
  if (v === "cats") return "cat";
  if (v === "cattle") return "cow";
  if (!v) return "human";
  return v;
}

function isMeaningfulVetTerm(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v.length < 3) return false;
  if (!/[a-z]/i.test(v)) return false;
  if (NOISE_TERMS.has(v)) return false;
  return true;
}

function parseStrictJsonFromModelText(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    // Try to extract the first `{ ... }` block.
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
}

/**
 * Extract structured veterinary graph fields from a text chunk.
 * Returns `null` if the chunk is not clearly about an animal/pet disease.
 */
export async function extractGraphRowFromTextChunk(
  topic: string,
  content: string
): Promise<PetGraphRow | null> {
  const gemini = getGeminiClient();

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
- IMPORTANT: If this text is not clearly about a disease/condition, return empty values for all fields.
- Pet must be one of: ${Array.from(ALLOWED_PETS).join(", ")}.

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

      const parsed = parseStrictJsonFromModelText(raw);
      if (!parsed) return null;

      let pet = typeof parsed.pet === "string" ? normalizePetName(parsed.pet) : "";
      const disease = typeof parsed.disease === "string" ? parsed.disease.trim() : "";
      const symptoms = Array.isArray(parsed.symptoms)
        ? parsed.symptoms.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean)
        : [];
      const treatments = Array.isArray(parsed.treatments)
        ? parsed.treatments.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean)
        : [];

      if (!disease) return null;
      if (!pet) pet = "human";
      if (!ALLOWED_PETS.has(pet)) pet = "human";
      if (!isMeaningfulVetTerm(disease)) return null;

      const cleanSymptoms = symptoms.filter(isMeaningfulVetTerm).slice(0, 8);
      const cleanTreatments = treatments.filter(isMeaningfulVetTerm).slice(0, 8);

      // Light grounding check: if chunk doesn't mention pet/disease, ignore.
      // We intentionally rely on the model's "return empty values if not clearly about animal/pet disease"
      // instruction rather than performing strict string matching here, because vector chunks can be clipped
      // and may contain paraphrases.

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

