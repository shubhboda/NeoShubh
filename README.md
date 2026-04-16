<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/d0ae564a-b2a0-4ff6-be30-5148ccf66a7c

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Required Environment Variables

This app uses:
- Gemini (LLM + embeddings)
- Supabase/Postgres with `pgvector` (vector RAG)
- Neo4j (graph RAG)

Make a file `.env.local` from `.env.example`, and ensure these are set:
- `GEMINI_API_KEY`
- `DATABASE_URL` (Postgres/Supabase connection string for the `vector` extension + knowledge tables)
- `NEO4J_URI`
- `NEO4J_USER` (or `NEO4J_USERNAME`)
- `NEO4J_PASSWORD`

## Hybrid RAG Flow (`POST /api/ask`)

Request body:
```json
{ "query": "Pet me jalan", "knowledgeBase": "ayurveda_knowledge" }
```

Pipeline (server-side):
1. Extract entities from the query (Neo4j)
2. Retrieve graph context (Neo4j graph facts)
3. Create query embedding (Gemini embeddings)
4. Retrieve vector context from Postgres/pgvector (by `knowledgeBase`)
5. Merge both contexts and generate final answer (Gemini)

Response:
```json
{
  "answer": "string",
  "vectorContext": "string",
  "graphContext": "string",
  "context": "string",
  "entities": { "pet": "string", "disease": "string", "symptom": "string", "treatment": "string" }
}
```

### Fallback behavior
- If Gemini generation hits quota/rate-limit, the API returns a still-useful bullet answer using the available graph/vector context.
- If vector retrieval fails (vector DB misconfig), it falls back to graph-only context.

## Graph Setup Endpoints (Neo4j)

- Initialize graph schema:
  - `POST /api/graph/init`
- Reset graph (delete nodes/relationships):
  - `POST /api/graph/reset`
- Build graph from existing knowledge tables in Postgres:
  - `POST /api/graph/build-from-existing-knowledge`
  - body example:
    ```json
    { "knowledgeBases": ["animal_pet"], "limitPerTable": 20, "extractionIntervalMs": 0 }
    ```

## Key Backend Files
- `api/apiApp.ts` : Express routes (including `/api/ask`)
- `api/services/vectorService.ts` : pgvector/knowledge retrieval + warmup
- `api/services/embeddingService.ts` : Gemini embedding generation (`gemini-embedding-2-preview`)
- `api/services/graphService.ts` : Neo4j graph retrieval wrappers
- `api/services/mergeService.ts` : hybrid context merge
- `api/hybridGraphRag.ts` : Neo4j logic + `mergeHybridContext()`
