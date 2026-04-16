import { GoogleGenAI } from "@google/genai";

function getGeminiClient(): GoogleGenAI {
  const key = typeof process.env.GEMINI_API_KEY === "string" ? process.env.GEMINI_API_KEY.trim() : "";
  if (!key) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to .env.local locally and to Vercel → Environment Variables for production."
    );
  }
  return new GoogleGenAI({ apiKey: key });
}

/**
 * Creates an embedding vector for input text using Gemini embeddings.
 * Returned array is suitable for pgvector similarity search.
 */
export async function embedText(text: string): Promise<number[]> {
  const gemini = getGeminiClient();
  const embeddingResult = await gemini.models.embedContent({
    model: "gemini-embedding-2-preview",
    contents: [text],
  });

  const embedding = embeddingResult.embeddings[0]?.values;
  if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
    throw new Error("Failed to generate embedding");
  }
  return embedding;
}

