import React, { useState, useRef, useEffect } from "react";
import { Send, Bot, User, Sparkles, Leaf, Info, AlertCircle, Loader2, Database, Upload } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import Markdown from "react-markdown";
import { parseKnowledgeCsv, type KnowledgeRow } from "./parseKnowledgeCsv";

const BULK_INGEST_CHUNK = 12;
const DEFAULT_KNOWLEDGE_BASE = "ayurveda_knowledge";

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
  const [hasGeminiKey, setHasGeminiKey] = useState<boolean>(true);

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
  const [graphStatus, setGraphStatus] = useState<"checking" | "connected" | "error">("checking");
  const [graphError, setGraphError] = useState("");
  const [isGraphInitLoading, setIsGraphInitLoading] = useState(false);
  const [isGraphBuildLoading, setIsGraphBuildLoading] = useState(false);
  const [isGraphResetLoading, setIsGraphResetLoading] = useState(false);
  const [graphBuildSummary, setGraphBuildSummary] = useState("");
  const [graphSourceTables, setGraphSourceTables] = useState("animal_pet");
  const [debugInfo, setDebugInfo] = useState<string[]>([]);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isBulkImporting, setIsBulkImporting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState("");
  const [selectedKnowledgeBase, setSelectedKnowledgeBase] = useState(DEFAULT_KNOWLEDGE_BASE);
  const bulkFileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(apiUrl("/api/ai-status"));
        const data = await res.json();
        setHasGeminiKey(Boolean(data?.hasGeminiKey));
      } catch {
        // If backend is unreachable, keep the banner visible so user knows something is wrong.
        setHasGeminiKey(false);
      }
    })();
  }, []);

  useEffect(() => {
    // Admin unlock can come from admin page or direct URL token.
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const urlToken = params.get("admin");
      if (urlToken === "7783") {
        sessionStorage.setItem("ayurveda_admin", "1");
        localStorage.setItem("ayurveda_admin", "1");
        params.delete("admin");
        const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}${window.location.hash}`;
        window.history.replaceState({}, "", next);
      }

      const unlocked =
        sessionStorage.getItem("ayurveda_admin") === "1" ||
        localStorage.getItem("ayurveda_admin") === "1";
      if (unlocked) setIsAdmin(true);
    }
  }, []);

  const addDebug = (msg: string) => {
    setDebugInfo(prev => [new Date().toLocaleTimeString() + ": " + msg, ...prev].slice(0, 5));
  };

  const fetchKnowledge = async () => {
    setIsLoadingKnowledge(true);
    try {
      addDebug("Fetching knowledge list...");
      const res = await fetch(
        apiUrl(`/api/list-knowledge?knowledgeBase=${encodeURIComponent(selectedKnowledgeBase)}`)
      );
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
      const res = await fetch(apiUrl(`/api/db-status?knowledgeBase=${encodeURIComponent(selectedKnowledgeBase)}`));
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

  const checkGraphStatus = async () => {
    try {
      addDebug("Checking Neo4j status...");
      const res = await fetch(apiUrl("/api/graph/health"));
      const data = await res.json();
      if (!res.ok || data.status !== "connected") {
        setGraphStatus("error");
        setGraphError(data.message || "Neo4j not connected");
        addDebug("Neo4j error: " + (data.message || "Unknown error"));
        return;
      }
      setGraphStatus("connected");
      setGraphError("");
      addDebug("Neo4j connected");
    } catch (error) {
      setGraphStatus("error");
      setGraphError(error instanceof Error ? error.message : "Neo4j check failed");
      addDebug("Neo4j check failed");
    }
  };

  const runGraphInit = async (): Promise<boolean> => {
    setIsGraphInitLoading(true);
    try {
      addDebug("Initializing graph schema...");
      const res = await fetch(apiUrl("/api/graph/init"), { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Graph init failed");
      setGraphBuildSummary("Graph schema initialized.");
      addDebug("Graph schema ready");
      await checkGraphStatus();
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Graph init failed";
      setGraphError(msg);
      setGraphStatus("error");
      addDebug("Graph init error: " + msg);
      alert(`Graph init failed: ${msg}`);
      return false;
    } finally {
      setIsGraphInitLoading(false);
    }
  };

  const runGraphBuildFromExisting = async (): Promise<boolean> => {
    const tables = graphSourceTables
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    if (tables.length === 0) {
      alert("At least one source table required.");
      return false;
    }

    setIsGraphBuildLoading(true);
    try {
      addDebug(`Graph build started for ${tables.length} table(s)`);
      const res = await fetch(apiUrl("/api/graph/build-from-existing-knowledge"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          knowledgeBases: tables,
          // Keep default build quick in UI; run multiple times for full ingest.
          limitPerTable: 20,
          extractionIntervalMs: 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Graph build failed");
      const summary = `Processed ${data.processedRows}, extracted ${data.extractedRows}, imported ${data.imported}, failed ${data.failedExtractions}`;
      setGraphBuildSummary(summary);
      addDebug("Graph build done: " + summary);
      await checkGraphStatus();
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Graph build failed";
      setGraphError(msg);
      setGraphStatus("error");
      addDebug("Graph build error: " + msg);
      alert(`Graph build failed: ${msg}`);
      return false;
    } finally {
      setIsGraphBuildLoading(false);
    }
  };

  const runGraphReset = async (): Promise<boolean> => {
    setIsGraphResetLoading(true);
    try {
      addDebug("Resetting graph...");
      const res = await fetch(apiUrl("/api/graph/reset"), { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Graph reset failed");
      setGraphBuildSummary("Graph reset complete. Build graph again.");
      addDebug("Graph reset done");
      await checkGraphStatus();
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Graph reset failed";
      setGraphError(msg);
      setGraphStatus("error");
      addDebug("Graph reset error: " + msg);
      alert(`Graph reset failed: ${msg}`);
      return false;
    } finally {
      setIsGraphResetLoading(false);
    }
  };

  const runFullGraphSetup = async () => {
    const inited = await runGraphInit();
    if (!inited) return;
    await runGraphBuildFromExisting();
  };

  const initializeDb = async () => {
    setIsInitializing(true);
    addDebug("Starting DB initialization...");
    try {
      const res = await fetch(apiUrl("/api/init-db"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ knowledgeBase: selectedKnowledgeBase }),
      });
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
    checkGraphStatus();
  }, [selectedKnowledgeBase]);

  const askKnowledgeBaseForUpload = () => {
    const candidate = window
      .prompt(
        "CSV kis knowledge base/table me import karna hai? (example: ayurveda_knowledge, charakshita_knowledge)",
        selectedKnowledgeBase
      )
      ?.trim()
      .toLowerCase();
    if (!candidate) return null;
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(candidate)) {
      alert("Invalid name. Sirf lowercase letters, numbers, underscore allow hain.");
      return null;
    }
    setSelectedKnowledgeBase(candidate);
    return candidate;
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const ingestEmbeddingBatches = async (
    withEmb: { topic: string; content: string }[],
    totalLabel: number,
    knowledgeBase: string
  ) => {
    for (let i = 0; i < withEmb.length; i += BULK_INGEST_CHUNK) {
      const chunk = withEmb.slice(i, i + BULK_INGEST_CHUNK);
      const end = Math.min(i + chunk.length, withEmb.length);
      setBulkProgress(`Saving ${i + 1}–${end} / ${totalLabel}…`);
      addDebug(`Ingest batch ${i / BULK_INGEST_CHUNK + 1}`);
      for (const item of chunk) {
        const response = await fetch(apiUrl("/api/graph/ingest-text"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic: item.topic, content: item.content }),
        });
        const resData = await response.json();
        if (!response.ok) throw new Error(resData.error || "Batch ingest failed");
      }
    }
  };

  const runBulkKnowledgeImport = async (raw: string, label: string, knowledgeBase: string) => {
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
      `${rows.length} alag topics import honge. Server par graph extraction + save hoga — thoda time lagega. Continue?`
    );
    if (!ok) return;

    setIsBulkImporting(true);
    setBulkProgress("");

    try {
      const withEmb: { topic: string; content: string }[] = [];
      for (let i = 0; i < rows.length; i++) {
        const { topic, content } = rows[i];
        withEmb.push({
          topic,
          content,
        });
        setBulkProgress(`Preparing ${i + 1} / ${rows.length}: ${topic.slice(0, 48)}…`);
        addDebug(`Bulk queue ${i + 1}/${rows.length}`);
      }

      await ingestEmbeddingBatches(withEmb, rows.length, knowledgeBase);
      addDebug(`Bulk import done: ${rows.length} rows from ${label}`);
      alert(`${rows.length} topics successfully import ho gaye (${label}).`);
      await checkGraphStatus();
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

    setIsIngesting(true);

    const topic = knowledgeTopic.trim();
    const body = customKnowledge.trim();

    try {
      addDebug("Sending to backend (graph extract + save)...");
      const response = await fetch(apiUrl("/api/graph/ingest-text"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          content: body,
        }),
      });

      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData.error || "Ingestion failed");
      }
      addDebug("Ingestion successful");
      alert(resData.message || "Graph added successfully!");
      setCustomKnowledge("");
      setKnowledgeTopic("");
      await checkGraphStatus();
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
      // Server-side RAG: /api/ask does embedding + DB retrieval + final generation.
      const askResponse = await fetch(apiUrl("/api/ask"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: currentInput, knowledgeBase: selectedKnowledgeBase }),
      });

      const data = await askResponse.json();
      if (!askResponse.ok) throw new Error(data.error || "Ask failed");

      const botMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "bot",
        content: data.answer || "Maaf kijiye, kuch error aa gaya.",
      };

      setMessages((prev) => [...prev, botMessage]);
    } catch (error) {
      console.error("Error:", error);
      const outLang = detectOutputLanguage(currentInput);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "bot",
          content:
            outLang === "hindi"
              ? "Kuch problem aa gayi. Backend/DB connection check karein."
              : "Something went wrong. Please check your backend/DB connection.",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const seedDatabase = async () => {
    setIsSeeding(true);
    const sampleData = [
      {
        topic: "Parvo (Canine Parvovirus)",
        content:
          "Dog ko parvo (canine parvovirus) ho sakta hai. Symptoms: vomiting, diarrhea, lethargy. Treatments: IV fluids, antiemetic medicines, and isolation/supportive care. Pet: dog and disease: parvo.",
      },
      {
        topic: "Skin Allergy (Cat)",
        content:
          "Cat me skin allergy ke lakshan. Symptoms: itching, rashes, redness. Treatments: early diagnosis, medication, supportive care. Pet: cat and disease: skin allergy.",
      },
      {
        topic: "Feline Flu",
        content:
          "Cat ko feline flu ho sakta hai. Symptoms: sneezing, fever, nasal discharge. Treatments: hydration, supportive care. Pet: cat and disease: feline flu.",
      },
      {
        topic: "Skin Allergy (Cat) - Repeat",
        content:
          "Cat me skin allergy ke symptoms: itching and rashes. Treatments: medication and supportive care. Pet: cat and disease: skin allergy.",
      },
      {
        topic: "Parvo (Canine Parvovirus) - Repeat",
        content:
          "Dog ko parvo ke symptoms: vomiting, diarrhea, lethargy. Treatments: IV fluids, antiemetic medicines, and isolation. Pet: dog and disease: parvo.",
      },
    ];

    try {
      for (const item of sampleData) {
        const response = await fetch(apiUrl("/api/graph/ingest-text"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            topic: item.topic,
            content: item.content,
          }),
        });
        const resData = await response.json();
        if (!response.ok) throw new Error(resData.error || "Seeding failed");
      }
      alert("Graph seeded successfully!");
      await checkGraphStatus();
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

                <div className="mb-4">
                  <label className="block text-[11px] font-bold text-stone-500 uppercase tracking-wider mb-1.5">
                    Active Knowledge Base (Table Name)
                  </label>
                  <input
                    type="text"
                    value={selectedKnowledgeBase}
                    onChange={(e) => setSelectedKnowledgeBase(e.target.value.trim().toLowerCase())}
                    placeholder="e.g. ayurveda_knowledge or charakshita_knowledge"
                    className="w-full bg-white border border-stone-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                  />
                  <p className="mt-1.5 text-[11px] text-stone-500 leading-relaxed">
                    Chat search, list, single ingest, and CSV import is table naam par chalega.
                  </p>
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

              <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3 text-stone-700 text-sm font-semibold">
                    <Database className="w-5 h-5 text-blue-600" />
                    Graph Configuration (Neo4j)
                  </div>
                  <div
                    className={`px-2 py-1 rounded text-[10px] font-bold ${
                      graphStatus === "connected"
                        ? "bg-emerald-100 text-emerald-700"
                        : graphStatus === "checking"
                        ? "bg-stone-100 text-stone-600"
                        : "bg-red-100 text-red-700"
                    }`}
                  >
                    GRAPH: {graphStatus === "connected" ? "ONLINE" : graphStatus === "checking" ? "CHECKING" : "OFFLINE"}
                  </div>
                </div>

                <div className="mb-4">
                  <label className="block text-[11px] font-bold text-stone-500 uppercase tracking-wider mb-1.5">
                    Source Knowledge Tables (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={graphSourceTables}
                    onChange={(e) => setGraphSourceTables(e.target.value)}
                    placeholder="animal_pet, ashtanga_hridaya, ayurveda_knowledge, knowledge_of_charak"
                    className="w-full bg-white border border-stone-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                  />
                  <p className="mt-1.5 text-[11px] text-stone-500 leading-relaxed">
                    Existing Supabase tables se direct graph build hoga. Naya table banane ki zarurat nahi.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={runGraphInit}
                    disabled={isGraphInitLoading || isGraphBuildLoading || isGraphResetLoading}
                    className="bg-blue-600 text-white px-4 py-2 rounded-xl text-xs font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {isGraphInitLoading ? <Loader2 className="animate-spin w-3.5 h-3.5" /> : <Database className="w-3.5 h-3.5" />}
                    Init Graph
                  </button>
                  <button
                    onClick={runGraphBuildFromExisting}
                    disabled={isGraphInitLoading || isGraphBuildLoading || isGraphResetLoading}
                    className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-xs font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {isGraphBuildLoading ? <Loader2 className="animate-spin w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
                    Build Graph
                  </button>
                  <button
                    onClick={runGraphReset}
                    disabled={isGraphInitLoading || isGraphBuildLoading || isGraphResetLoading}
                    className="bg-rose-600 text-white px-4 py-2 rounded-xl text-xs font-semibold hover:bg-rose-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {isGraphResetLoading ? <Loader2 className="animate-spin w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                    Reset Graph
                  </button>
                  <button
                    onClick={runFullGraphSetup}
                    disabled={isGraphInitLoading || isGraphBuildLoading || isGraphResetLoading}
                    className="bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-semibold hover:bg-emerald-800 transition-colors disabled:opacity-50"
                  >
                    One-click Full Graph Setup
                  </button>
                </div>

                {graphError ? (
                  <p className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    {graphError}
                  </p>
                ) : null}
                {graphBuildSummary ? (
                  <p className="mt-3 text-xs text-blue-800 bg-white border border-blue-200 rounded-lg px-3 py-2">
                    {graphBuildSummary}
                  </p>
                ) : null}
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
                      const knowledgeBase = askKnowledgeBaseForUpload();
                      if (!knowledgeBase) {
                        inputEl.value = "";
                        return;
                      }
                      const text = await file.text();
                      inputEl.value = "";
                      await runBulkKnowledgeImport(text, file.name, knowledgeBase);
                    }}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={isBulkImporting || isIngesting || graphStatus !== "connected"}
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
                      disabled={isBulkImporting || isIngesting || graphStatus !== "connected"}
                      onClick={async () => {
                        try {
                          const knowledgeBase = askKnowledgeBaseForUpload();
                          if (!knowledgeBase) return;
                          const res = await fetch("/sushruta_sam.csv");
                          if (!res.ok) {
                            alert("sushruta_sam.csv load nahi hua — public/ folder check karein.");
                            return;
                          }
                          const text = await res.text();
                          await runBulkKnowledgeImport(text, "sushruta_sam.csv (bundled)", knowledgeBase);
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
