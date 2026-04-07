import React, { useState, useRef, useEffect } from "react";
import { Send, Bot, User, Sparkles, Leaf, Info, AlertCircle, Loader2, Database, Upload } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import Markdown from "react-markdown";
import { GoogleGenAI } from "@google/genai";
import { parseKnowledgeCsv, type KnowledgeRow } from "./parseKnowledgeCsv";

const BULK_INGEST_CHUNK = 12;

/** Same origin on Vercel; set only if API is hosted on another domain. */
const API_BASE_RAW = import.meta.env.VITE_API_BASE_URL;
const API_BASE =
  typeof API_BASE_RAW === "string" && API_BASE_RAW.length > 0
    ? API_BASE_RAW.replace(/\/$/, "")
    : "";

function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return API_BASE ? `${API_BASE}${p}` : p;
}

type OutputLang = "hindi" | "english";
function detectOutputLanguage(text: string): OutputLang {
  // Simple heuristic: if the user uses mostly Devanagari, respond in Hindi; otherwise English.
  const devanagari = (text.match(/[\u0900-\u097F]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return devanagari > latin ? "hindi" : "english";
}

/** Browser SDK throws if apiKey is null/undefined; avoid that so the UI can still mount. */
let geminiSingleton: GoogleGenAI | null | undefined;
function getGeminiClient(): GoogleGenAI | null {
  if (geminiSingleton !== undefined) return geminiSingleton;
  const key =
    typeof process.env.GEMINI_API_KEY === "string" ? process.env.GEMINI_API_KEY.trim() : "";
  if (!key) {
    geminiSingleton = null;
    return null;
  }
  geminiSingleton = new GoogleGenAI({ apiKey: key });
  return geminiSingleton;
}

function geminiMissingMessage() {
  return (
    "GEMINI_API_KEY set nahi hai.\n\n" +
    "Vercel: Project → Settings → Environment Variables → GEMINI_API_KEY add karein, " +
    "Production + Preview dono par lagayein, phir Redeploy."
  );
}

interface Message {
  id: string;
  role: "user" | "bot";
  content: string;
}

export default function App() {
  const hasGeminiKey =
    typeof process.env.GEMINI_API_KEY === "string" &&
    process.env.GEMINI_API_KEY.trim().length > 0;

  const [isAdmin, setIsAdmin] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "bot",
      content: "Namaste! Main aapka Ayurveda assistant hoon. Aapko kya health issue hai? (e.g., 'Pet me jalan', 'Digestion issue', 'Acidity')",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [customKnowledge, setCustomKnowledge] = useState("");
  const [isIngesting, setIsIngesting] = useState(false);
  const [savedKnowledge, setSavedKnowledge] = useState<
    { id: number; topic: string; content: string }[]
  >([]);
  const [knowledgeTopic, setKnowledgeTopic] = useState("");
  const [isLoadingKnowledge, setIsLoadingKnowledge] = useState(false);
  const [dbStatus, setDbStatus] = useState<"checking" | "connected" | "error">("checking");
  const [dbDetails, setDbDetails] = useState<{vectorExtension: boolean, tableExists: boolean} | null>(null);
  const [dbError, setDbError] = useState("");
  const [debugInfo, setDebugInfo] = useState<string[]>([]);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isBulkImporting, setIsBulkImporting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState("");
  const bulkFileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Admin only via `admin7783.html` (which sets localStorage).
    if (typeof window !== "undefined") {
      if (sessionStorage.getItem("ayurveda_admin") === "1") setIsAdmin(true);
    }
  }, []);

  const addDebug = (msg: string) => {
    setDebugInfo(prev => [new Date().toLocaleTimeString() + ": " + msg, ...prev].slice(0, 5));
  };

  const fetchKnowledge = async () => {
    setIsLoadingKnowledge(true);
    try {
      addDebug("Fetching knowledge list...");
      const res = await fetch(apiUrl("/api/list-knowledge"));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Fetch failed");
      setSavedKnowledge(data.items || []);
      addDebug(`Found ${data.items?.length || 0} items`);
    } catch (err) {
      console.error("Failed to fetch knowledge:", err);
      addDebug("Error fetching knowledge: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsLoadingKnowledge(false);
    }
  };

  const checkDbStatus = async () => {
    try {
      addDebug("Checking DB status...");
      const res = await fetch(apiUrl("/api/db-status"));
      const data = await res.json();
      if (data.status === "connected") {
        setDbStatus("connected");
        setDbDetails({ vectorExtension: data.vectorExtension, tableExists: data.tableExists });
        addDebug(`DB Connected. Extension: ${data.vectorExtension}, Table: ${data.tableExists}`);
        fetchKnowledge();
      } else {
        setDbStatus("error");
        setDbError(data.message || "Unknown error");
        addDebug("DB Error: " + (data.message || "Unknown error"));
      }
    } catch (err) {
      setDbStatus("error");
      setDbError("Could not reach backend");
      addDebug("Backend unreachable");
    }
  };

  const initializeDb = async () => {
    setIsInitializing(true);
    addDebug("Starting DB initialization...");
    try {
      const res = await fetch(apiUrl("/api/init-db"), { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        alert("Database initialized successfully!");
        addDebug("DB Init Success");
        checkDbStatus();
      } else {
        alert(`Initialization failed: ${data.error}`);
        addDebug("DB Init Failed: " + data.error);
      }
    } catch (err) {
      alert("Failed to initialize database");
      addDebug("DB Init Network Error");
    } finally {
      setIsInitializing(false);
    }
  };

  useEffect(() => {
    checkDbStatus();
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const ingestEmbeddingBatches = async (
    withEmb: { topic: string; content: string; embedding: number[] }[],
    totalLabel: number
  ) => {
    for (let i = 0; i < withEmb.length; i += BULK_INGEST_CHUNK) {
      const chunk = withEmb.slice(i, i + BULK_INGEST_CHUNK);
      const end = Math.min(i + chunk.length, withEmb.length);
      setBulkProgress(`Saving ${i + 1}–${end} / ${totalLabel}…`);
      addDebug(`Ingest batch ${i / BULK_INGEST_CHUNK + 1}`);
      const response = await fetch(apiUrl("/api/ingest"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: chunk }),
      });
      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData.error || "Batch ingest failed");
      }
    }
  };

  const runBulkKnowledgeImport = async (raw: string, label: string) => {
    if (isBulkImporting || isIngesting) return;
    let rows: KnowledgeRow[];
    try {
      rows = parseKnowledgeCsv(raw);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Invalid CSV");
      return;
    }
    if (rows.length === 0) {
      alert("CSV mein koi valid row nahi mili (topic + text khali na ho).");
      return;
    }

    const ok = confirm(
      `${rows.length} alag topics import honge (alag-alag DB rows). Gemini se embedding ${rows.length} baar banegi — thoda time lagega. Continue?`
    );
    if (!ok) return;

    const gemini = getGeminiClient();
    if (!gemini) {
      alert(geminiMissingMessage());
      return;
    }

    setIsBulkImporting(true);
    setBulkProgress("");

    try {
      const withEmb: { topic: string; content: string; embedding: number[] }[] = [];
      for (let i = 0; i < rows.length; i++) {
        const { topic, content } = rows[i];
        setBulkProgress(`Embedding ${i + 1} / ${rows.length}: ${topic.slice(0, 48)}…`);
        addDebug(`Bulk embed ${i + 1}/${rows.length}`);
        const textForEmbedding = `Topic: ${topic}\n\n${content}`;
        const embeddingResult = await gemini.models.embedContent({
          model: "gemini-embedding-2-preview",
          contents: [textForEmbedding],
        });
        withEmb.push({
          topic,
          content,
          embedding: embeddingResult.embeddings[0].values,
        });
        await new Promise((r) => setTimeout(r, 100));
      }

      await ingestEmbeddingBatches(withEmb, rows.length);
      addDebug(`Bulk import done: ${rows.length} rows from ${label}`);
      alert(`${rows.length} topics successfully import ho gaye (${label}).`);
      fetchKnowledge();
    } catch (error) {
      console.error("Bulk import error:", error);
      const errMsg = error instanceof Error ? error.message : "Bulk import failed";
      addDebug("Bulk import error: " + errMsg);
      alert(`Error: ${errMsg}`);
    } finally {
      setBulkProgress("");
      setIsBulkImporting(false);
    }
  };

  const handleIngestCustom = async () => {
    if (!customKnowledge.trim() || isIngesting || isBulkImporting) return;

    const gemini = getGeminiClient();
    if (!gemini) {
      alert(geminiMissingMessage());
      return;
    }

    setIsIngesting(true);

    const topic = knowledgeTopic.trim();
    const body = customKnowledge.trim();
    const textForEmbedding = topic ? `Topic: ${topic}\n\n${body}` : body;

    try {
      addDebug("Generating embedding...");
      const embeddingResult = await gemini.models.embedContent({
        model: "gemini-embedding-2-preview",
        contents: [textForEmbedding],
      });
      const embedding = embeddingResult.embeddings[0].values;
      addDebug(`Embedding generated (Size: ${embedding.length})`);

      addDebug("Sending to backend...");
      const response = await fetch(apiUrl("/api/ingest"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: [{ topic, content: body, embedding }],
        }),
      });

      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData.error || "Ingestion failed");
      }
      addDebug("Ingestion successful");
      alert(resData.message || "Knowledge added successfully!");
      setCustomKnowledge("");
      setKnowledgeTopic("");
      fetchKnowledge(); // Refresh the list
    } catch (error) {
      console.error("Ingestion error:", error);
      const errMsg = error instanceof Error ? error.message : "Failed to add knowledge";
      addDebug("Ingestion Error: " + errMsg);
      alert(`Error: ${errMsg}`);
    } finally {
      setIsIngesting(false);
    }
  };

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input,
    };

    setMessages((prev) => [...prev, userMessage]);
    const currentInput = input;
    setInput("");
    setIsLoading(true);

    try {
      const gemini = getGeminiClient();
      if (!gemini) {
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            role: "bot",
            content:
              "**GEMINI_API_KEY** live site par set nahi hai. Vercel → Environment Variables → add karein aur redeploy karein.",
          },
        ]);
        return;
      }

      // 1. Generate embedding for the query in the frontend
      const embeddingResult = await gemini.models.embedContent({
        model: "gemini-embedding-2-preview",
        contents: [currentInput],
      });
      const queryEmbedding = embeddingResult.embeddings[0].values;

      // 2. Call backend to search for context
      const searchResponse = await fetch(apiUrl("/api/search"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embedding: queryEmbedding }),
      });

      const { context } = await searchResponse.json();
      
      const outLang = detectOutputLanguage(currentInput);
      const outLangInstruction =
        outLang === "hindi"
          ? "Answer ONLY in Hindi (Devanagari). Do not use English words unless unavoidable."
          : "Answer ONLY in English. Do not use Hindi words.";

      if (!context) {
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            role: "bot",
            content:
              outLang === "hindi"
                ? "Iska Ayurveda data available nahi hai"
                : "No relevant Ayurveda data found in the uploaded knowledge base.",
          },
        ]);
        return;
      }

      // 3. Generate final answer using Gemini in the frontend
      const prompt = `
        You are an Ayurveda expert. ${outLangInstruction}
        Use ONLY the CONTEXT below to answer.
        
        If CONTEXT does not support the answer, reply with:
        - Hindi: "Iska Ayurveda data available nahi hai"
        - English: "No relevant Ayurveda data found in the uploaded knowledge base."

        CONTEXT:
        ${context}

        USER QUERY:
        ${currentInput}

        OUTPUT (max 6 bullets total, max ~120 words overall):
        - Diet:
        - Avoid:
        - Herbs:
        - Lifestyle:
        Only write a line if that info is present in CONTEXT; otherwise omit that line.
      `;

      const response = await gemini.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
      });

      const botMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "bot",
        content: response.text || "Maaf kijiye, kuch error aa gaya.",
      };

      setMessages((prev) => [...prev, botMessage]);
    } catch (error) {
      console.error("Error:", error);
      setMessages((prev) => [
        ...prev,
        { id: Date.now().toString(), role: "bot", content: "Something went wrong. Please check your connection." },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const seedDatabase = async () => {
    setIsSeeding(true);
    const sampleData = [
      {
        topic: "Acidity (Amlapitta)",
        content:
          "Pet me jalan, khatti dakar, aur seene me jalan iske mukhya lakshan hain. Diet: Thanda doodh, nariyal pani, aur saunf ka sevan karein. Avoid: Mirch-masala, chai, coffee, aur dahi raat ko na khayein. Herbs: Avipattikar Churna, Shankh Bhasma, aur Mulethi. Lifestyle: Khana khane ke baad turant na soyein, thoda tahlein.",
      },
      {
        topic: "Digestion (Ajeerna)",
        content:
          "Bhookh na lagna, pet bhari rehna, aur gas banna. Diet: Garm pani piyein, adrak aur namak khane se pehle lein. Avoid: Maida, bhari khana, aur thanda pani. Herbs: Hingvashtak Churna, Trikatu, aur Ajwain. Lifestyle: Vajrasana me baithein khane ke baad.",
      },
      {
        topic: "Constipation (Vibandha)",
        content:
          "Pet saaf na hona, mal tyag me kathinai. Diet: Papaya, hari sabziyan, aur ghee ka sevan karein. Avoid: Junk food, dry snacks, aur raat ka bacha hua khana. Herbs: Triphala Churna, Isabgol, aur Castor oil. Lifestyle: Subah garm pani piyein aur yoga karein.",
      },
      {
        topic: "Headache (Shirshool)",
        content:
          "Stress ya acidity ki wajah se sar dard. Diet: Ghee, badam, aur dhoodh. Avoid: Tez dhoop, shor, aur bhookha rehna. Herbs: Brahmi, Shankhpushpi, aur Jatamansi. Lifestyle: Pranayama aur meditation karein.",
      },
      {
        topic: "Skin Issues (Twak Roga)",
        content:
          "Khujli, rashes, ya pimples. Diet: Neem ka pani, karela, aur haldi. Avoid: Jyada namak, khatta, aur non-veg. Herbs: Mahamanjisthadi Kwath, Neem, aur Khadir. Lifestyle: Saaf-safai ka dhyan rakhein aur cotton kapde pehnein.",
      },
    ];

    try {
      const gemini = getGeminiClient();
      if (!gemini) {
        alert(geminiMissingMessage());
        return;
      }

      const dataWithEmbeddings = [];
      for (const item of sampleData) {
        const textForEmbedding = `Topic: ${item.topic}\n\n${item.content}`;
        const embeddingResult = await gemini.models.embedContent({
          model: "gemini-embedding-2-preview",
          contents: [textForEmbedding],
        });
        dataWithEmbeddings.push({
          topic: item.topic,
          content: item.content,
          embedding: embeddingResult.embeddings[0].values,
        });
      }

      const response = await fetch(apiUrl("/api/ingest"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: dataWithEmbeddings }),
      });
      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData.error || "Seeding failed");
      }
      alert(resData.message || "Database seeded successfully!");
      fetchKnowledge();
    } catch (error) {
      console.error("Seeding error:", error);
      alert(`Seeding failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsSeeding(false);
    }
  };

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 font-sans flex flex-col">
      {!hasGeminiKey ? (
        <div className="bg-amber-100 border-b border-amber-300 px-4 py-3 text-center text-sm text-amber-950">
          <strong>GEMINI_API_KEY missing.</strong> Vercel → Project → Settings → Environment Variables → add{" "}
          <code className="bg-white/70 px-1 rounded">GEMINI_API_KEY</code> for Production (and Preview), then{" "}
          <strong>Redeploy</strong>. Until then chat / embeddings kaam nahi karenge.
        </div>
      ) : null}
      {/* Header */}
      <header className="bg-white border-b border-stone-200 py-4 px-6 sticky top-0 z-10 shadow-sm">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="bg-emerald-600 p-2 rounded-lg">
              <Leaf className="text-white w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-emerald-900">Ayurveda Nutrition System</h1>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <>
                <div
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    dbStatus === "connected"
                      ? dbDetails?.vectorExtension && dbDetails?.tableExists
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-amber-100 text-amber-700"
                      : dbStatus === "error"
                      ? "bg-red-100 text-red-700"
                      : "bg-stone-100 text-stone-500"
                  }`}
                >
                  <div
                    className={`w-1.5 h-1.5 rounded-full ${
                      dbStatus === "connected"
                        ? dbDetails?.vectorExtension && dbDetails?.tableExists
                          ? "bg-emerald-500 animate-pulse"
                          : "bg-amber-500"
                        : dbStatus === "error"
                        ? "bg-red-500"
                        : "bg-stone-400"
                    }`}
                  />
                  {dbStatus === "connected"
                    ? dbDetails?.vectorExtension && dbDetails?.tableExists
                      ? "DB Online"
                      : "Setup Req."
                    : dbStatus === "error"
                    ? "DB Offline"
                    : "Checking DB"}
                </div>
                <button
                  onClick={() => setShowAdmin(!showAdmin)}
                  className="flex items-center gap-2 text-xs font-medium bg-stone-100 hover:bg-stone-200 text-stone-600 px-3 py-1.5 rounded-full transition-colors"
                >
                  <Database className="w-3 h-3" />
                  {showAdmin ? "Close Manager" : "Manage Knowledge"}
                </button>
                <button
                  onClick={seedDatabase}
                  disabled={isSeeding}
                  className="flex items-center gap-2 text-xs font-medium bg-stone-100 hover:bg-stone-200 text-stone-600 px-3 py-1.5 rounded-full transition-colors disabled:opacity-50"
                >
                  <Sparkles className="w-3 h-3" />
                  {isSeeding ? "Seeding..." : "Seed Knowledge Base"}
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Admin Panel */}
      <AnimatePresence>
        {showAdmin && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-white border-b border-stone-200 overflow-hidden"
          >
            <div className="max-w-4xl mx-auto p-6">
              <h2 className="text-sm font-semibold text-stone-600 mb-4 flex items-center gap-2 uppercase tracking-wider">
                <Database className="w-4 h-4" /> Add Knowledge to RAG Pipeline
              </h2>
              
              {/* Detailed Status & Initialization */}
              <div className="mb-6 p-4 bg-stone-50 border border-stone-200 rounded-xl">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3 text-stone-700 text-sm font-semibold">
                    <Database className="w-5 h-5 text-emerald-600" />
                    Database Configuration
                  </div>
                  <div className="flex gap-2">
                    <div className={`px-2 py-1 rounded text-[10px] font-bold ${dbDetails?.vectorExtension ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                      VECTOR EXT: {dbDetails?.vectorExtension ? "ON" : "OFF"}
                    </div>
                    <div className={`px-2 py-1 rounded text-[10px] font-bold ${dbDetails?.tableExists ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                      TABLE: {dbDetails?.tableExists ? "READY" : "MISSING"}
                    </div>
                  </div>
                </div>
                
                <p className="text-xs text-stone-500 mb-4 leading-relaxed">
                  If you see "Dimension Mismatch" errors (expected 768, got 3072), click the button below to recreate the table with correct settings. 
                  <span className="text-red-500 font-medium ml-1">Warning: This will delete all saved knowledge!</span>
                </p>

                <button
                  onClick={initializeDb}
                  disabled={isInitializing}
                  className="bg-amber-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-amber-700 transition-colors disabled:opacity-50 flex items-center gap-2 shadow-sm"
                >
                  {isInitializing ? <Loader2 className="animate-spin w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
                  {dbDetails?.tableExists ? "Reset & Fix Database (3072 Dimensions)" : "Initialize Database"}
                </button>
              </div>

              {dbStatus === "error" && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 text-xs text-red-800">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <div>
                    <strong>Database Connection Error:</strong> {dbError}
                    <p className="mt-1">Please check your Supabase credentials and ensure the 'vector' extension is enabled.</p>
                  </div>
                </div>
              )}
              <div className="space-y-4">
                <div>
                  <label className="block text-[11px] font-bold text-stone-500 uppercase tracking-wider mb-1.5">
                    Topic (alag row ke liye)
                  </label>
                  <input
                    type="text"
                    value={knowledgeTopic}
                    onChange={(e) => setKnowledgeTopic(e.target.value)}
                    placeholder="e.g. Diabetes (Madhumeha), Neem herb, General intro — har topic ke liye alag save karein"
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                  />
                  <p className="mt-1.5 text-[11px] text-stone-500 leading-relaxed">
                    Ek hi topic ke liye yahan use karein. Bahut saari rows ke liye neeche CSV import use karein.
                  </p>
                </div>
                <div className="p-4 bg-emerald-50/80 border border-emerald-200 rounded-xl space-y-3">
                  <h3 className="text-xs font-bold text-emerald-900 uppercase tracking-wider flex items-center gap-2">
                    <Upload className="w-4 h-4" /> Bulk import (CSV — topic + text columns)
                  </h3>
                  <p className="text-[11px] text-emerald-900/80 leading-relaxed">
                    Header mein <code className="bg-white/80 px-1 rounded">topic</code> aur{" "}
                    <code className="bg-white/80 px-1 rounded">text</code> hona chahiye (jaise{" "}
                    <code className="bg-white/80 px-1 rounded">sushruta_sam.csv</code>). Har row alag DB entry banegi.
                  </p>
                  <input
                    ref={bulkFileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      const inputEl = e.target;
                      if (!file) return;
                      const text = await file.text();
                      inputEl.value = "";
                      await runBulkKnowledgeImport(text, file.name);
                    }}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={isBulkImporting || isIngesting || dbStatus !== "connected"}
                      onClick={() => bulkFileInputRef.current?.click()}
                      className="bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-semibold hover:bg-emerald-800 transition-colors disabled:opacity-50 flex items-center gap-2"
                    >
                      {isBulkImporting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Upload className="w-3.5 h-3.5" />
                      )}
                      Choose CSV file
                    </button>
                    <button
                      type="button"
                      disabled={isBulkImporting || isIngesting || dbStatus !== "connected"}
                      onClick={async () => {
                        try {
                          const res = await fetch("/sushruta_sam.csv");
                          if (!res.ok) {
                            alert("sushruta_sam.csv load nahi hua — public/ folder check karein.");
                            return;
                          }
                          const text = await res.text();
                          await runBulkKnowledgeImport(text, "sushruta_sam.csv (bundled)");
                        } catch {
                          alert("Sample CSV fetch failed.");
                        }
                      }}
                      className="bg-white border border-emerald-300 text-emerald-900 px-4 py-2 rounded-xl text-xs font-semibold hover:bg-emerald-50 transition-colors disabled:opacity-50"
                    >
                      Import bundled Sushruta CSV
                    </button>
                  </div>
                  {bulkProgress ? (
                    <p className="text-[11px] font-mono text-emerald-800 bg-white/70 rounded-lg px-3 py-2 border border-emerald-100">
                      {bulkProgress}
                    </p>
                  ) : null}
                </div>
                <textarea
                  value={customKnowledge}
                  onChange={(e) => setCustomKnowledge(e.target.value)}
                  placeholder="Is topic ka detail yahan — sirf yahi hissa is row ki 'content' banega..."
                  className="w-full h-32 bg-stone-50 border border-stone-200 rounded-xl p-4 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                />
                <div className="flex justify-end">
                  <button
                    onClick={handleIngestCustom}
                    disabled={!customKnowledge.trim() || isIngesting || isBulkImporting}
                    className="bg-emerald-600 text-white px-6 py-2 rounded-xl text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {isIngesting ? <Loader2 className="animate-spin w-4 h-4" /> : <Database className="w-4 h-4" />}
                    Add to Knowledge Base
                  </button>
                </div>

                <div className="mt-8">
                  <h3 className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <Info className="w-3 h-3" /> Debug Info (Last 5 events)
                  </h3>
                  <div className="bg-stone-900 rounded-xl p-4 font-mono text-[10px] text-emerald-400 space-y-1">
                    {debugInfo.length === 0 ? (
                      <div className="text-stone-600 italic">No events logged yet...</div>
                    ) : (
                      debugInfo.map((info, i) => <div key={i}>{info}</div>)
                    )}
                  </div>
                </div>

                <div className="mt-8">
                  <h3 className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <Info className="w-3 h-3" /> Recently Saved Knowledge ({savedKnowledge.length})
                  </h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
                    {isLoadingKnowledge ? (
                      <div className="flex items-center justify-center py-8 text-stone-400 text-sm gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" /> Fetching data...
                      </div>
                    ) : savedKnowledge.length === 0 ? (
                      <div className="text-center py-8 text-stone-400 text-sm border-2 border-dashed border-stone-100 rounded-xl">
                        No knowledge saved yet. Add some above!
                      </div>
                    ) : (
                      savedKnowledge.map((item) => (
                        <div key={item.id} className="p-3 bg-stone-50 border border-stone-100 rounded-lg text-xs text-stone-600 leading-relaxed hover:border-emerald-200 transition-colors">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <span className="font-bold text-emerald-700">#{item.id}</span>
                            {item.topic?.trim() ? (
                              <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-semibold text-[10px] uppercase tracking-wide">
                                {item.topic.trim()}
                              </span>
                            ) : null}
                          </div>
                          {item.content}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat Area */}
      <main className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div className={`flex gap-3 max-w-[85%] ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm ${
                    msg.role === "user" ? "bg-emerald-100 text-emerald-700" : "bg-white text-emerald-600 border border-stone-200"
                  }`}>
                    {msg.role === "user" ? <User size={18} /> : <Bot size={18} />}
                  </div>
                  <div className={`p-4 rounded-2xl shadow-sm ${
                    msg.role === "user" 
                      ? "bg-emerald-600 text-white rounded-tr-none" 
                      : "bg-white border border-stone-200 text-stone-800 rounded-tl-none"
                  }`}>
                    <div className="prose prose-stone max-w-none prose-sm md:prose-base dark:prose-invert">
                      <Markdown>{msg.content}</Markdown>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {isLoading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex justify-start"
            >
              <div className="flex gap-3 items-center text-stone-400 italic text-sm ml-11">
                <Loader2 className="animate-spin w-4 h-4" />
                Vaidya ji soch rahe hain...
              </div>
            </motion.div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Input Area */}
      <footer className="p-4 md:p-6 bg-white border-t border-stone-200">
        <div className="max-w-4xl mx-auto">
          <form onSubmit={handleSend} className="relative group">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Apni health problem batayein... (e.g. Pet me jalan)"
              className="w-full bg-stone-50 border border-stone-200 rounded-2xl py-4 pl-6 pr-14 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all shadow-inner"
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="absolute right-2 top-2 bottom-2 bg-emerald-600 text-white p-3 rounded-xl hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:hover:bg-emerald-600 shadow-md"
            >
              <Send size={20} />
            </button>
          </form>
          <div className="mt-3 flex gap-4 justify-center text-[10px] md:text-xs text-stone-400 font-medium uppercase tracking-widest">
            <span className="flex items-center gap-1"><Sparkles className="w-3 h-3" /> AI Powered</span>
            <span className="flex items-center gap-1"><Leaf className="w-3 h-3" /> Ayurvedic Wisdom</span>
            <span className="flex items-center gap-1"><Info className="w-3 h-3" /> RAG Pipeline</span>
          </div>
        </div>
      </footer>

      {/* Floating Disclaimer */}
      <div className="fixed bottom-24 right-6 max-w-xs hidden lg:block">
        <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl shadow-lg flex gap-3">
          <AlertCircle className="text-amber-600 shrink-0 w-5 h-5" />
          <p className="text-[10px] text-amber-800 leading-relaxed">
            <strong>Disclaimer:</strong> Yeh AI-generated advice hai. Gambhir samasya ke liye kripya doctor se sampark karein.
          </p>
        </div>
      </div>
    </div>
  );
}
