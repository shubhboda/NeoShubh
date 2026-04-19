import React, { useState, useRef, useEffect } from "react";
import { Send, Sparkles, Leaf, AlertCircle, Loader2, Database, Upload, ChevronDown, X, ArrowLeft, Plus, Link2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import Markdown from "react-markdown";
import { GoogleGenAI } from "@google/genai";
import { parseKnowledgeCsv, type KnowledgeRow } from "./parseKnowledgeCsv";

const SUPABASE_IMG = "https://yidjcuymlbmdxbjcjjbd.supabase.co/storage/v1/object/public/generated-images/VaidyaRAG";
const IMG = {
  chatBg:          `${SUPABASE_IMG}/chat-bg-texture.jpg`,
  sidebarHerbs:    `${SUPABASE_IMG}/sidebar-herbs.jpg`,
  avatarVaidya:    `${SUPABASE_IMG}/avatar-vaidya.png`,
  manuscriptStrip: `${SUPABASE_IMG}/manuscript-strip.jpg`,
  welcomeMandala:  `${SUPABASE_IMG}/welcome-mandala.png`,
  nullLeaf:        `${SUPABASE_IMG}/null-state-leaf.png`,
  corpusTexture:   `${SUPABASE_IMG}/corpus-texture.jpg`,
};

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
    "Vercel: Project -> Settings ->’ Environment Variables -> GEMINI_API_KEY add karein, " +
    "Production + Preview dono par lagayein, phir Redeploy."
  );
}

interface Message {
  id: string;
  role: "user" | "bot";
  content: string;
  isNullState?: boolean;
  isStreaming?: boolean;
  similarity?: number;
}

const WELCOME_EN = "Namaste. I am your Ayurvedic intelligence system, drawing from the _Sushruta Samhita_, _Charaka Samhita_, and classical texts.\n\nDescribe your condition, symptom, or query — in English or Hindi.";
const WELCOME_HI = "नमस्ते। मैं आपका आयुर्वेदिक बुद्धिमत्ता प्रणाली हूँ — _सुश्रुत संहिता_, _चरक संहिता_, और अन्य शास्त्रीय ग्रंथों पर आधारित।\n\nअपनी स्वास्थ्य समस्या या प्रश्न हिंदी या अंग्रेज़ी में बताएं।";

export default function App() {
  const hasGeminiKey =
    typeof process.env.GEMINI_API_KEY === "string" &&
    process.env.GEMINI_API_KEY.trim().length > 0;

  const [isAdmin, setIsAdmin] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { id: "init", role: "bot", content: WELCOME_EN },
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
  const [selectedKnowledgeBase, setSelectedKnowledgeBase] = useState(DEFAULT_KNOWLEDGE_BASE);
  const [outputLang, setOutputLang] = useState<"auto" | "hindi" | "english">("auto");
  
  // Chat History Types and State
  interface ChatSession {
    id: string;
    title: string;
    timestamp: number;
    messages: Message[];
  }
  const [chatHistory, setChatHistory] = useState<ChatSession[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string>("new");

  // Neo4j Node and Relationship Management
  const [nodeType, setNodeType] = useState<"Disease" | "Symptom" | "Treatment">("Disease");
  const [nodeName, setNodeName] = useState("");
  const [isAddingNode, setIsAddingNode] = useState(false);
  const [nodeError, setNodeError] = useState("");
  const [nodeSuccess, setNodeSuccess] = useState("");
  
  const [relFromType, setRelFromType] = useState<"Disease" | "Symptom" | "Treatment">("Disease");
  const [relFromName, setRelFromName] = useState("");
  const [relToType, setRelToType] = useState<"Symptom" | "Treatment" | "Disease">("Symptom");
  const [relToName, setRelToName] = useState("");
  const [relationType, setRelationType] = useState<"HAS_DISEASE" | "HAS_SYMPTOM" | "HAS_TREATMENT">("HAS_DISEASE");
  const [isAddingRel, setIsAddingRel] = useState(false);
  const [relError, setRelError] = useState("");
  const [relSuccess, setRelSuccess] = useState("");

  // Supabase to Neo4j Transfer
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferProgress, setTransferProgress] = useState("");
  const [transferError, setTransferError] = useState("");
  const [transferSuccess, setTransferSuccess] = useState("");

  // Neo4j CSV Bulk Import
  const [isNeo4jBulkImporting, setIsNeo4jBulkImporting] = useState(false);
  const [neo4jBulkProgress, setNeo4jBulkProgress] = useState("");
  const [neo4jBulkError, setNeo4jBulkError] = useState("");
  const [neo4jBulkSuccess, setNeo4jBulkSuccess] = useState("");
  const neo4jBulkFileInputRef = useRef<HTMLInputElement>(null);

  // View Nodes
  const [neo4jNodes, setNeo4jNodes] = useState<Array<{type: string, name: string}>>([]);
  const [isLoadingNodes, setIsLoadingNodes] = useState(false);
  const [nodeViewError, setNodeViewError] = useState("");

  // Update welcome message instantly when lang toggle changes
  useEffect(() => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === "init"
          ? { ...m, content: outputLang === "hindi" ? WELCOME_HI : WELCOME_EN }
          : m
      )
    );
  }, [outputLang]);

  const bulkFileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  // Load chat history from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("ayurveda_chat_history");
    if (saved) {
      try {
        setChatHistory(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load chat history", e);
      }
    }
  }, []);

  // Save chat history to localStorage whenever it changes
  useEffect(() => {
    if (chatHistory.length > 0) {
      localStorage.setItem("ayurveda_chat_history", JSON.stringify(chatHistory));
    }
  }, [chatHistory]);

  // Update current chat in history when messages change
  useEffect(() => {
    if (currentChatId !== "new" && messages.length > 1) {
      setChatHistory(prev =>
        prev.map(chat =>
          chat.id === currentChatId ? { ...chat, messages: [...messages] } : chat
        )
      );
    }
  }, [messages, currentChatId]);

  const startNewChat = () => {
    saveCurrentChatToHistory();
    setMessages([{ id: "init", role: "bot", content: outputLang === "hindi" ? WELCOME_HI : WELCOME_EN }]);
    setCurrentChatId("new");
    setInput("");
  };

  const saveCurrentChatToHistory = () => {
    if (messages.length <= 1 || currentChatId === "new") return;
    const userMessage = messages.find(m => m.role === "user")?.content || "Chat";
    const title = userMessage.slice(0, 45) + (userMessage.length > 45 ? "…" : "");
    const chatId = Date.now().toString();
    const newSession: ChatSession = {
      id: chatId,
      title,
      timestamp: Date.now(),
      messages: [...messages]
    };
    setChatHistory(prev => [newSession, ...prev].slice(0, 50));
  };

  const loadChatFromHistory = (chatId: string) => {
    const chat = chatHistory.find(c => c.id === chatId);
    if (chat) {
      setMessages(chat.messages);
      setCurrentChatId(chatId);
    }
  };

  const deleteChatFromHistory = (chatId: string) => {
    setChatHistory(prev => prev.filter(c => c.id !== chatId));
    if (currentChatId === chatId) {
      startNewChat();
    }
  };

  const clearAllHistory = () => {
    if (window.confirm("Clear all chat history?")) {
      setChatHistory([]);
      localStorage.removeItem("ayurveda_chat_history");
      startNewChat();
    }
  };

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
    withEmb: { topic: string; content: string; embedding: number[] }[],
    totalLabel: number,
    knowledgeBase: string
  ) => {
    for (let i = 0; i < withEmb.length; i += BULK_INGEST_CHUNK) {
      const chunk = withEmb.slice(i, i + BULK_INGEST_CHUNK);
      const end = Math.min(i + chunk.length, withEmb.length);
      setBulkProgress(`Saving ${i + 1} - ${end} / ${totalLabel}...`);
      addDebug(`Ingest batch ${i / BULK_INGEST_CHUNK + 1}`);
      const response = await fetch(apiUrl("/api/ingest"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: chunk, knowledgeBase }),
      });
      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData.error || "Batch ingest failed");
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
      `${rows.length} alag topics import honge (alag-alag DB rows). Gemini se embedding ${rows.length} baar banegi â€” thoda time lagega. Continue?`
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
        setBulkProgress(`Embedding ${i + 1} / ${rows.length}: ${topic.slice(0, 48)}â€¦`);
        addDebug(`Bulk embed ${i + 1}/${rows.length}`);
        const textForEmbedding = `Topic: ${topic}\n\n${content}`;
        const embeddingResult = await gemini.models.embedContent({
          model: "gemini-embedding-2-preview",
          contents: [textForEmbedding],
        });
        withEmb.push({
          topic,
          content,
          embedding: embeddingResult.embeddings![0].values!,
        });
        await new Promise((r) => setTimeout(r, 100));
      }

      await ingestEmbeddingBatches(withEmb, rows.length, knowledgeBase);
      addDebug(`Bulk import done: ${rows.length} rows from ${label}`);
      alert(`${rows.length} topics successfully import ho gaye (${label}) in "${knowledgeBase}".`);
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
      const embedding = embeddingResult.embeddings![0].values!;
      addDebug(`Embedding generated (Size: ${embedding.length})`);

      addDebug("Sending to backend...");
      const response = await fetch(apiUrl("/api/ingest"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: [{ topic, content: body, embedding }],
          knowledgeBase: selectedKnowledgeBase,
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

  const handleAddNode = async () => {
    if (!nodeName.trim()) {
      setNodeError("Node name is required");
      return;
    }
    setIsAddingNode(true);
    setNodeError("");
    setNodeSuccess("");
    try {
      const response = await fetch(apiUrl("/api/neo4j/add-node"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeType: nodeType,
          nodeName: nodeName.trim()
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to add node");
      }
      setNodeSuccess(`✓ ${nodeType} "${nodeName}" created`);
      setNodeName("");
      setTimeout(() => setNodeSuccess(""), 3000);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to add node";
      setNodeError(msg);
    } finally {
      setIsAddingNode(false);
    }
  };

  const handleAddRelationship = async () => {
    if (!relFromName.trim() || !relToName.trim()) {
      setRelError("Both node names are required");
      return;
    }
    setIsAddingRel(true);
    setRelError("");
    setRelSuccess("");
    try {
      const response = await fetch(apiUrl("/api/neo4j/add-relationship"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromType: relFromType,
          fromName: relFromName.trim(),
          toType: relToType,
          toName: relToName.trim(),
          relationType: relationType
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to create relationship");
      }
      setRelSuccess(`✓ Relationship created`);
      setRelFromName("");
      setRelToName("");
      setTimeout(() => setRelSuccess(""), 3000);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to create relationship";
      setRelError(msg);
    } finally {
      setIsAddingRel(false);
    }
  };

  const handleTransferToNeo4j = async () => {
    if (savedKnowledge.length === 0) {
      setTransferError("No knowledge entries to transfer");
      return;
    }

    setIsTransferring(true);
    setTransferError("");
    setTransferSuccess("");
    setTransferProgress("Starting transfer...");

    try {
      const total = savedKnowledge.length;
      let processed = 0;
      let created = 0;

      // Process each knowledge entry
      for (const item of savedKnowledge) {
        processed++;
        setTransferProgress(`Processing ${processed}/${total}: ${item.topic || "untitled"}...`);

        // Detect entity type from topic or use Disease as default
        let entityType: "Disease" | "Symptom" | "Treatment" = "Disease";
        const topic = (item.topic || item.content).toLowerCase();
        
        if (topic.includes("symptom") || topic.includes("लक्षण")) {
          entityType = "Symptom";
        } else if (topic.includes("treatment") || topic.includes("चिकित्सा") || topic.includes("उपचार")) {
          entityType = "Treatment";
        }

        // Create node in Neo4j
        const nodeName = (item.topic || `Entry_${item.id}`).trim();
        const response = await fetch(apiUrl("/api/neo4j/add-node"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeType: entityType,
            nodeName: nodeName
          })
        });

        if (response.ok) {
          created++;
        } else {
          const err = await response.json();
          console.warn(`Failed to create node for ${nodeName}:`, err.error);
        }

        // Small delay to avoid overwhelming the server
        await new Promise(r => setTimeout(r, 100));
      }

      setTransferSuccess(`✓ Transferred ${created}/${total} entries to Neo4j`);
      setTransferProgress("");
      setTimeout(() => setTransferSuccess(""), 4000);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Transfer failed";
      setTransferError(msg);
      setTransferProgress("");
    } finally {
      setIsTransferring(false);
    }
  };

  const handleNeo4jBulkImport = async (csvText: string, fileName: string) => {
    setIsNeo4jBulkImporting(true);
    setNeo4jBulkError("");
    setNeo4jBulkSuccess("");
    setNeo4jBulkProgress("Parsing CSV...");

    try {
      // Parse CSV
      const lines = csvText.trim().split("\n");
      if (lines.length < 2) {
        throw new Error("CSV must have at least 1 data row (plus header)");
      }

      const headers = lines[0].toLowerCase().split(",").map(h => h.trim());
      const nodeTypeIdx = headers.indexOf("nodetype");
      const nodeNameIdx = headers.indexOf("nodename") >= 0 ? headers.indexOf("nodename") : headers.indexOf("topic");
      const contentIdx = headers.indexOf("content") >= 0 ? headers.indexOf("content") : headers.indexOf("description");

      if (nodeNameIdx < 0) {
        throw new Error("CSV must have 'nodeName' or 'topic' column");
      }

      const dataRows = lines.slice(1).filter(line => line.trim());
      if (dataRows.length === 0) {
        throw new Error("No data rows found in CSV");
      }

      let created = 0;
      const total = dataRows.length;

      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i].split(",").map(v => v.trim());
        setNeo4jBulkProgress(`Processing ${i + 1}/${total}...`);

        let nodeType: "Disease" | "Symptom" | "Treatment" = "Disease";
        if (nodeTypeIdx >= 0 && row[nodeTypeIdx]) {
          const type = row[nodeTypeIdx].toLowerCase();
          if (type.includes("symptom")) nodeType = "Symptom";
          else if (type.includes("treatment")) nodeType = "Treatment";
          else nodeType = "Disease";
        } else {
          // Auto-detect from nodeName
          const name = row[nodeNameIdx].toLowerCase();
          if (name.includes("symptom") || name.includes("लक्षण")) nodeType = "Symptom";
          else if (name.includes("treatment") || name.includes("चिकित्सा") || name.includes("उपचार")) nodeType = "Treatment";
        }

        const nodeName = row[nodeNameIdx];
        if (!nodeName) continue;

        const response = await fetch(apiUrl("/api/neo4j/add-node"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeType,
            nodeName
          })
        });

        if (response.ok) {
          created++;
        } else {
          const err = await response.json();
          console.warn(`Failed to create node for ${nodeName}:`, err.error);
        }

        await new Promise(r => setTimeout(r, 100));
      }

      setNeo4jBulkSuccess(`✓ Created ${created}/${total} nodes from CSV`);
      setNeo4jBulkProgress("");
      setTimeout(() => setNeo4jBulkSuccess(""), 4000);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "CSV import failed";
      setNeo4jBulkError(msg);
      setNeo4jBulkProgress("");
    } finally {
      setIsNeo4jBulkImporting(false);
    }
  };

  const fetchAllNodes = async () => {
    setIsLoadingNodes(true);
    setNodeViewError("");
    try {
      const response = await fetch(apiUrl("/api/neo4j/nodes"), {
        method: "GET",
        headers: { "Content-Type": "application/json" }
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch nodes");
      }
      // Transform the response to match our node format
      const transformedNodes = data.nodes.map((n: any) => ({
        type: n.types && n.types.length > 0 ? n.types[0] : "Unknown",
        name: n.name
      }));
      setNeo4jNodes(transformedNodes);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to fetch nodes";
      setNodeViewError(msg);
    } finally {
      setIsLoadingNodes(false);
    }
  };

  const deleteNodeFromGraph = async (nodeType: string, nodeName: string) => {
    if (!window.confirm(`Delete ${nodeType} "${nodeName}"?`)) return;
    try {
      const response = await fetch(apiUrl("/api/neo4j/delete-node"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeType, nodeName })
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to delete node");
      }
      await fetchAllNodes();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Delete failed");
    }
  };

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;

    const currentInput = input.trim();
    const userMsg: Message = { id: Date.now().toString(), role: "user", content: currentInput };
    setMessages((prev) => [...prev, userMsg]);
    
    // Auto-save to history on first message
    if (currentChatId === "new" && messages.length === 1) {
      const chatId = Date.now().toString();
      const title = currentInput.slice(0, 45) + (currentInput.length > 45 ? "…" : "");
      const newSession: ChatSession = {
        id: chatId,
        title,
        timestamp: Date.now(),
        messages: [...messages, userMsg]
      };
      setChatHistory(prev => [newSession, ...prev].slice(0, 50));
      setCurrentChatId(chatId);
    }
    
    setInput("");
    setIsLoading(true);

    const gemini = getGeminiClient();
    if (!gemini) {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "bot",
          content: "**GEMINI_API_KEY** is not configured. Please add it in Vercel â†’ Environment Variables, then redeploy.",
        },
      ]);
      setIsLoading(false);
      return;
    }

    try {
      // 1. Generate embedding (client-side)
      const embResult = await gemini.models.embedContent({
        model: "gemini-embedding-2-preview",
        contents: [currentInput],
      });
      const embedding = embResult.embeddings![0].values!;

      // 2. Call /api/chat â€” SSE streaming
      const response = await fetch(apiUrl("/api/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: currentInput, embedding, knowledgeBase: selectedKnowledgeBase, lang: outputLang !== "auto" ? outputLang : undefined }),
      });

      if (!response.ok || !response.body) {
        const err = await response.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "Chat request failed");
      }

      const botId = (Date.now() + 1).toString();
      setMessages((prev) => [...prev, { id: botId, role: "bot", content: "", isStreaming: true }]);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;

      while (!done) {
        const { done: readerDone, value } = await reader.read();
        if (readerDone) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") { done = true; break; }

          // Parse JSON separately so a parse failure doesn't swallow event handler errors
          let payload: { type: string; text?: string; similarity?: number; message?: string };
          try {
            payload = JSON.parse(raw);
          } catch {
            continue; // skip malformed chunk, keep reading
          }

          if (payload.type === "null_state") {
            const pct = Math.round((payload.similarity ?? 0) * 100);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === botId
                  ? {
                      ...m,
                      isNullState: true,
                      isStreaming: false,
                      similarity: payload.similarity,
                      content: `**No knowledge match found** — relevance score: ${pct}% (minimum: 75%)

The corpus doesn't have a strong enough match for this query. Try rephrasing, or ingest relevant data first from the Knowledge panel.`,
                    }
                  : m
              )
            );
            done = true;
          } else if (payload.type === "text" && payload.text) {
            setMessages((prev) =>
              prev.map((m) => (m.id === botId ? { ...m, content: m.content + payload.text } : m))
            );
          } else if (payload.type === "error") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === botId
                  ? { ...m, isStreaming: false, content: `**Error:** ${payload.message ?? "Unknown server error"}` }
                  : m
              )
            );
            done = true;
          }
        }
      }

      // Mark streaming complete; show fallback if content is still empty
      setMessages((prev) =>
        prev.map((m) =>
          m.id === botId
            ? { ...m, isStreaming: false, content: m.content || "_No response received. Please check your knowledge base has data ingested, then try again._" }
            : m
        )
      );
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "bot",
          content: `Something went wrong: ${error instanceof Error ? error.message : "Unknown error"}`,
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
          embedding: embeddingResult.embeddings![0].values!,
        });
      }

      const response = await fetch(apiUrl("/api/ingest"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: dataWithEmbeddings, knowledgeBase: selectedKnowledgeBase }),
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
    <div className="chat-shell">
      {/* ── BACKGROUND LAYERS ── */}
      {/* Photographic texture base */}
      <div
        className="chat-bg-photo"
        style={{ backgroundImage: `url('${IMG.chatBg}')` }}
      />
      {/* Sage-green tint overlay to unify */}
      <div className="chat-bg-tint" />
      {/* Grain film overlay */}
      <div className="chat-bg-grain" />

      {/* ── SIDEBAR PANEL ── */}
      <aside className="chat-sidebar">
        <div className="chat-sidebar-photo" style={{ backgroundImage: `url('${IMG.sidebarHerbs}')` }} />
        <div className="chat-sidebar-overlay" />
        <div className="chat-sidebar-content">
          {/* Logo mark */}
          <div className="chat-sidebar-logo">
            <button
              className="chat-back-btn"
              onClick={() => { window.history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); }}
              aria-label="Back to home"
            >
              <ArrowLeft size={13} />
              <span>Home</span>
            </button>
            <div className="chat-sidebar-logo-row">
              <div className="chat-sidebar-leaf-wrap">
                <Leaf size={18} className="chat-sidebar-leaf" />
              </div>
              <div>
                <div className="chat-sidebar-brand">VedaAI</div>
                <div className="chat-sidebar-tagline">Āyurvedic Intelligence</div>
              </div>
            </div>
          </div>

          {/* corpus pills */}
          <div className="chat-sidebar-section">
            <div className="chat-sidebar-section-label">Knowledge Corpus</div>
            {["Sushruta Samhitā", "Charaka Samhitā", "Ashtānga Hridayam"].map((t, i) => (
              <div key={i} className="chat-sidebar-corpus-pill">
                <span className="chat-sidebar-corpus-dot" />
                {t}
              </div>
            ))}
          </div>

          <div className="chat-sidebar-divider" />

          {/* System status */}
          <div className="chat-sidebar-section">
            <div className="chat-sidebar-section-label">System</div>
            <div className="chat-sidebar-stat">
              <span className="chat-sidebar-stat-key">Model</span>
              <span className="chat-sidebar-stat-val">Gemini 2.5 Flash</span>
            </div>
            <div className="chat-sidebar-stat">
              <span className="chat-sidebar-stat-key">Retrieval</span>
              <span className="chat-sidebar-stat-val">Hybrid RAG</span>
            </div>
            <div className="chat-sidebar-stat">
              <span className="chat-sidebar-stat-key">Vector DB</span>
              <span className="chat-sidebar-stat-val">pgvector</span>
            </div>
            <div className="chat-sidebar-stat">
              <span className="chat-sidebar-stat-key">DB</span>
              <span className={`chat-sidebar-stat-val ${dbStatus === "connected" ? "chat-stat-online" : "chat-stat-offline"}`}>
                {dbStatus === "checking" ? "checking…" : dbStatus === "connected" ? "● online" : "● offline"}
              </span>
            </div>
          </div>

          <div className="chat-sidebar-divider" />

          {/* Lang toggle */}
          <div className="chat-sidebar-section">
            <div className="chat-sidebar-section-label">Response Language</div>
            <div className="chat-lang-row">
              {(["auto", "english", "hindi"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setOutputLang(l)}
                  className={`chat-lang-btn${outputLang === l ? " chat-lang-btn-active" : ""}`}
                >
                  {l === "auto" ? "Auto" : l === "english" ? "EN" : "हि"}
                </button>
              ))}
            </div>
          </div>

          {/* Admin toggle */}
          {isAdmin && (
            <>
              <div className="chat-sidebar-divider" />
              <div className="chat-sidebar-section">
                <button
                  onClick={() => setShowAdmin((v) => !v)}
                  className={`chat-admin-btn${showAdmin ? " chat-admin-btn-active" : ""}`}
                >
                  <Database size={12} />
                  Knowledge Pipeline
                  <ChevronDown size={11} style={{ marginLeft: "auto", transform: showAdmin ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
                </button>
                {!hasGeminiKey && (
                  <div className="chat-api-warn">
                    <AlertCircle size={10} /> GEMINI_API_KEY missing
                  </div>
                )}
              </div>
            </>
          )}

          <div style={{ flex: 1 }} />

          {/* Chat History */}
          {chatHistory.length > 0 && (
            <div style={{ borderTop: "1px solid rgba(240,232,213,0.1)", paddingTop: "1rem", marginTop: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", padding: "0 0.25rem" }}>
                <span style={{ fontSize: "0.68rem", letterSpacing: "0.15em", textTransform: "uppercase", color: "rgba(240,232,213,0.6)", fontWeight: 700 }}>Recent</span>
                <button onClick={clearAllHistory} style={{ background: "none", border: "none", color: "rgba(240,232,213,0.4)", cursor: "pointer", fontSize: "0.7rem", fontWeight: 600 }}>
                  Clear
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", maxHeight: "150px", overflowY: "auto" }}>
                {chatHistory.slice(0, 10).map((chat) => (
                  <div
                    key={chat.id}
                    onClick={() => loadChatFromHistory(chat.id)}
                    style={{
                      padding: "0.6rem 0.7rem",
                      backgroundColor: currentChatId === chat.id ? "rgba(0,194,112,0.12)" : "transparent",
                      borderLeft: currentChatId === chat.id ? "2px solid rgba(0,194,112,0.4)" : "none",
                      borderRadius: "7px",
                      cursor: "pointer",
                      fontSize: "0.72rem",
                      color: "rgba(240,232,213,0.7)",
                      transition: "all 0.2s",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center"
                    }}
                  >
                    <span style={{ flex: 1 }}>{chat.title}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteChatFromHistory(chat.id);
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        color: "rgba(220,80,60,0.5)",
                        cursor: "pointer",
                        marginLeft: "0.3rem",
                        fontSize: "0.8rem",
                        padding: "0"
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* New Chat Button */}
          <button
            onClick={startNewChat}
            style={{
              width: "100%",
              padding: "0.7rem 1rem",
              backgroundColor: "rgba(0,194,112,0.18)",
              border: "1px solid rgba(0,194,112,0.3)",
              borderRadius: "9px",
              color: "rgba(240,232,213,0.85)",
              fontSize: "0.73rem",
              fontWeight: 700,
              cursor: "pointer",
              transition: "all 0.2s",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              marginBottom: "1rem",
              marginTop: chatHistory.length > 0 ? "0" : "1rem"
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLButtonElement).style.backgroundColor = "rgba(0,194,112,0.25)";
              (e.target as HTMLButtonElement).style.borderColor = "rgba(0,194,112,0.45)";
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLButtonElement).style.backgroundColor = "rgba(0,194,112,0.18)";
              (e.target as HTMLButtonElement).style.borderColor = "rgba(0,194,112,0.3)";
            }}
          >
            + New Chat
          </button>
          <div className="chat-sidebar-footer">
            <div className="chat-sidebar-footer-text">Threshold · 0.55 · FTS fusion</div>
          </div>
        </div>
      </aside>

      {/* ── MAIN COLUMN ── */}
      <div className="chat-main">

        {/* ── TOP MANUSCRIPT STRIP ── */}
        <div className="chat-manuscript-strip" style={{ backgroundImage: `url('${IMG.manuscriptStrip}')` }}>
          <div className="chat-manuscript-strip-mask" />
          <div className="chat-manuscript-strip-text">
            <span>सुश्रुत संहिता</span>
            <span className="chat-strip-dot">·</span>
            <span>चरक संहिता</span>
            <span className="chat-strip-dot">·</span>
            <span>अष्टांग हृदयम्</span>
          </div>
        </div>

        {/* ── ADMIN PANEL ── */}
        <AnimatePresence>
          {showAdmin && isAdmin && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.28 }}
              className="chat-admin-panel overflow-hidden"
            >
              <div className="chat-admin-inner">
                <div className="chat-admin-header">
                  <Database size={11} />
                  <span>Knowledge Pipeline — {selectedKnowledgeBase}</span>
                  <button onClick={() => setShowAdmin(false)} className="chat-admin-close"><X size={13} /></button>
                </div>

                {/* DB config */}
                <div className="chat-admin-card" style={{ backgroundImage: `url('${IMG.corpusTexture}')` }}>
                  <div className="chat-admin-card-overlay" />
                  <div className="chat-admin-card-body">
                    <div className="chat-admin-row-top">
                      <span className="chat-admin-label">Active Table</span>
                      <div className="flex gap-2">
                        {[
                          { label: `pgvector: ${dbDetails?.vectorExtension ? "on" : "off"}`, ok: !!dbDetails?.vectorExtension },
                          { label: `table: ${dbDetails?.tableExists ? "ready" : "missing"}`, ok: !!dbDetails?.tableExists },
                        ].map(({ label, ok }) => (
                          <span key={label} className={`chat-admin-badge ${ok ? "chat-badge-ok" : "chat-badge-err"}`}>{label}</span>
                        ))}
                      </div>
                    </div>
                    <input
                      type="text"
                      value={selectedKnowledgeBase}
                      onChange={(e) => setSelectedKnowledgeBase(e.target.value.trim().toLowerCase())}
                      placeholder="e.g. ayurveda_knowledge"
                      className="chat-admin-input"
                    />
                    {dbStatus === "error" && <p className="chat-admin-err">{dbError}</p>}
                    <div className="flex flex-wrap gap-2 mt-3">
                      <button onClick={initializeDb} disabled={isInitializing} className="chat-admin-action-btn chat-btn-gold">
                        {isInitializing ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                        {dbDetails?.tableExists ? "reset db" : "init db"}
                      </button>
                      <button onClick={seedDatabase} disabled={isSeeding} className="chat-admin-action-btn chat-btn-green">
                        {isSeeding ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                        seed sample data
                      </button>
                    </div>
                  </div>
                </div>

                {/* Ingest fields */}
                <div className="space-y-3 mt-4">
                  <div>
                    <label className="chat-admin-field-label">Topic</label>
                    <input type="text" value={knowledgeTopic} onChange={(e) => setKnowledgeTopic(e.target.value)} placeholder="e.g. Diabetes (Madhumeha)" className="chat-admin-input" />
                  </div>
                  <div>
                    <label className="chat-admin-field-label">Content</label>
                    <textarea value={customKnowledge} onChange={(e) => setCustomKnowledge(e.target.value)} placeholder="Paste Ayurvedic knowledge text for this topic..." rows={4} className="chat-admin-input chat-admin-textarea" />
                  </div>

                  {/* Bulk CSV */}
                  <div className="chat-admin-csv-box">
                    <p className="chat-admin-label" style={{ marginBottom: "10px" }}>
                      Bulk CSV — requires <code className="chat-admin-code">topic</code> + <code className="chat-admin-code">text</code> columns
                    </p>
                    <input ref={bulkFileInputRef} type="file" accept=".csv,text/csv" className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0]; const el = e.target;
                        if (!file) return;
                        const kb = askKnowledgeBaseForUpload();
                        if (!kb) { el.value = ""; return; }
                        const text = await file.text(); el.value = "";
                        await runBulkKnowledgeImport(text, file.name, kb);
                      }}
                    />
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={isBulkImporting || isIngesting || dbStatus !== "connected"} onClick={() => bulkFileInputRef.current?.click()} className="chat-admin-action-btn chat-btn-green">
                        {isBulkImporting ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                        choose csv
                      </button>
                      <button type="button" disabled={isBulkImporting || isIngesting || dbStatus !== "connected"}
                        onClick={async () => { try { const kb = askKnowledgeBaseForUpload(); if (!kb) return; const r = await fetch("/sushruta_sam.csv"); if (!r.ok) { alert("sushruta_sam.csv not found in public/"); return; } const text = await r.text(); await runBulkKnowledgeImport(text, "sushruta_sam.csv", kb); } catch { alert("Fetch failed."); } }}
                        className="chat-admin-action-btn chat-btn-gold">
                        import sushruta csv
                      </button>
                    </div>
                    {bulkProgress && <p className="mt-2 text-[10px]" style={{ fontFamily: "monospace", color: "#7de8b5" }}>{bulkProgress}</p>}
                  </div>

                  <div className="flex justify-end pt-1">
                    <button onClick={handleIngestCustom} disabled={!customKnowledge.trim() || isIngesting || isBulkImporting} className="chat-admin-action-btn chat-btn-green">
                      {isIngesting ? <Loader2 size={11} className="animate-spin" /> : <Database size={11} />}
                      ingest knowledge
                    </button>
                  </div>
                </div>

                {/* Corpus list */}
                <div className="mt-5">
                  <p className="chat-admin-label" style={{ marginBottom: "8px" }}>corpus — {savedKnowledge.length} fragments</p>
                  <div className="space-y-1 max-h-44 overflow-y-auto custom-scrollbar pr-1">
                    {isLoadingKnowledge ? (
                      <div className="flex items-center gap-2 py-3 text-xs chat-admin-muted"><Loader2 size={11} className="animate-spin" /> loading…</div>
                    ) : savedKnowledge.length === 0 ? (
                      <p className="text-xs py-3 chat-admin-muted">No corpus entries yet.</p>
                    ) : (
                      savedKnowledge.map((item) => (
                        <div key={item.id} className="chat-corpus-row">
                          <span className="chat-corpus-id">#{item.id}</span>
                          {item.topic?.trim() ? <span className="chat-corpus-topic">{item.topic}</span> : null}
                          <span className="chat-corpus-preview">{item.content.slice(0, 90)}…</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* ── LINK NODES (Neo4j) ── */}
                <div className="mt-6 pt-5" style={{ borderTop: "1px solid rgba(240,232,213,0.1)" }}>
                  <p className="chat-admin-label" style={{ marginBottom: "12px" }}>Link Nodes — Graph Database</p>
                  
                  {/* Add Node Section */}
                  <div className="space-y-3 mb-5">
                    <p style={{ fontSize: "0.7rem", color: "rgba(240,232,213,0.6)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Add Node</p>
                    <div className="flex gap-2">
                      <select value={nodeType} onChange={(e) => setNodeType(e.target.value as any)} className="chat-admin-input" style={{ flex: 0.6 }}>
                        <option>Disease</option>
                        <option>Symptom</option>
                        <option>Treatment</option>
                      </select>
                      <input
                        type="text"
                        value={nodeName}
                        onChange={(e) => setNodeName(e.target.value)}
                        placeholder="Node name"
                        className="chat-admin-input"
                        style={{ flex: 1 }}
                      />
                    </div>
                    {nodeError && <p style={{ fontSize: "0.7rem", color: "#dc4d4d" }}>✗ {nodeError}</p>}
                    {nodeSuccess && <p style={{ fontSize: "0.7rem", color: "#00c270" }}>{nodeSuccess}</p>}
                    <button
                      onClick={handleAddNode}
                      disabled={isAddingNode || !nodeName.trim()}
                      className="chat-admin-action-btn chat-btn-green"
                      style={{ width: "100%" }}
                    >
                      {isAddingNode ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                      Add Node
                    </button>
                  </div>

                  {/* Add Relationship Section */}
                  <div className="space-y-3">
                    <p style={{ fontSize: "0.7rem", color: "rgba(240,232,213,0.6)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Link Nodes</p>
                    
                    <div className="flex gap-2">
                      <select value={relFromType} onChange={(e) => setRelFromType(e.target.value as any)} className="chat-admin-input" style={{ flex: 0.4 }}>
                        <option>Disease</option>
                        <option>Symptom</option>
                        <option>Treatment</option>
                      </select>
                      <input
                        type="text"
                        value={relFromName}
                        onChange={(e) => setRelFromName(e.target.value)}
                        placeholder="Source"
                        className="chat-admin-input"
                        style={{ flex: 0.6 }}
                      />
                    </div>

                    <div className="flex gap-2">
                      <select value={relationType} onChange={(e) => setRelationType(e.target.value as any)} className="chat-admin-input" style={{ flex: 0.4 }}>
                        <option>HAS_DISEASE</option>
                        <option>HAS_SYMPTOM</option>
                        <option>HAS_TREATMENT</option>
                      </select>
                      <span style={{ flex: 0.6, display: "flex", alignItems: "center", fontSize: "0.7rem", color: "rgba(240,232,213,0.5)" }}>→</span>
                    </div>

                    <div className="flex gap-2">
                      <select value={relToType} onChange={(e) => setRelToType(e.target.value as any)} className="chat-admin-input" style={{ flex: 0.4 }}>
                        <option>Symptom</option>
                        <option>Treatment</option>
                        <option>Disease</option>
                      </select>
                      <input
                        type="text"
                        value={relToName}
                        onChange={(e) => setRelToName(e.target.value)}
                        placeholder="Target"
                        className="chat-admin-input"
                        style={{ flex: 0.6 }}
                      />
                    </div>

                    {relError && <p style={{ fontSize: "0.7rem", color: "#dc4d4d" }}>✗ {relError}</p>}
                    {relSuccess && <p style={{ fontSize: "0.7rem", color: "#00c270" }}>{relSuccess}</p>}
                    <button
                      onClick={handleAddRelationship}
                      disabled={isAddingRel || !relFromName.trim() || !relToName.trim()}
                      className="chat-admin-action-btn chat-btn-gold"
                      style={{ width: "100%" }}
                    >
                      {isAddingRel ? <Loader2 size={11} className="animate-spin" /> : <Link2 size={11} />}
                      Create Link
                    </button>
                  </div>

                  {/* Neo4j Bulk CSV */}
                  <div className="space-y-3 mt-5 pt-5" style={{ borderTop: "1px solid rgba(240,232,213,0.08)" }}>
                    <p style={{ fontSize: "0.7rem", color: "rgba(240,232,213,0.6)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Bulk CSV Upload</p>
                    <p style={{ fontSize: "0.65rem", color: "rgba(240,232,213,0.5)", lineHeight: "1.4" }}>
                      CSV requires <code style={{ backgroundColor: "rgba(0,0,0,0.3)", padding: "2px 4px", borderRadius: "3px" }}>nodeName</code> (or <code style={{ backgroundColor: "rgba(0,0,0,0.3)", padding: "2px 4px", borderRadius: "3px" }}>topic</code>) column. Optionally include <code style={{ backgroundColor: "rgba(0,0,0,0.3)", padding: "2px 4px", borderRadius: "3px" }}>nodeType</code> column.
                    </p>
                    <input 
                      ref={neo4jBulkFileInputRef} 
                      type="file" 
                      accept=".csv,text/csv" 
                      style={{ display: "none" }}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        const el = e.target;
                        if (!file) return;
                        const text = await file.text();
                        el.value = "";
                        await handleNeo4jBulkImport(text, file.name);
                      }}
                    />
                    <div className="flex gap-2">
                      <button 
                        type="button" 
                        disabled={isNeo4jBulkImporting} 
                        onClick={() => neo4jBulkFileInputRef.current?.click()} 
                        className="chat-admin-action-btn chat-btn-green"
                        style={{ flex: 1 }}
                      >
                        {isNeo4jBulkImporting ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                        Choose CSV
                      </button>
                    </div>
                    {neo4jBulkProgress && <p style={{ fontSize: "0.7rem", color: "rgba(0,194,112,0.7)", fontFamily: "monospace" }}>⟳ {neo4jBulkProgress}</p>}
                    {neo4jBulkError && <p style={{ fontSize: "0.7rem", color: "#dc4d4d" }}>✗ {neo4jBulkError}</p>}
                    {neo4jBulkSuccess && <p style={{ fontSize: "0.7rem", color: "#00c270" }}>{neo4jBulkSuccess}</p>}
                  </div>

                  {/* Transfer Supabase to Neo4j */}
                  <div className="space-y-3 mt-5 pt-5" style={{ borderTop: "1px solid rgba(240,232,213,0.08)" }}>
                    <p style={{ fontSize: "0.7rem", color: "rgba(240,232,213,0.6)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Transfer to Graph</p>
                    <p style={{ fontSize: "0.65rem", color: "rgba(240,232,213,0.5)", lineHeight: "1.4" }}>
                      Migrate all corpus entries from Supabase to Neo4j as nodes. Topics with "symptom", "treatment", etc. will be auto-typed.
                    </p>
                    {transferProgress && <p style={{ fontSize: "0.7rem", color: "rgba(0,194,112,0.7)", fontFamily: "monospace" }}>⟳ {transferProgress}</p>}
                    {transferError && <p style={{ fontSize: "0.7rem", color: "#dc4d4d" }}>✗ {transferError}</p>}
                    {transferSuccess && <p style={{ fontSize: "0.7rem", color: "#00c270" }}>{transferSuccess}</p>}
                    <button
                      onClick={handleTransferToNeo4j}
                      disabled={isTransferring || savedKnowledge.length === 0}
                      className="chat-admin-action-btn chat-btn-green"
                      style={{ width: "100%" }}
                    >
                      {isTransferring ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                      Transfer {savedKnowledge.length} Entries
                    </button>
                  </div>

                  {/* View All Nodes */}
                  <div className="space-y-3 mt-5 pt-5" style={{ borderTop: "1px solid rgba(240,232,213,0.08)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <p style={{ fontSize: "0.7rem", color: "rgba(240,232,213,0.6)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Graph Nodes ({neo4jNodes.length})</p>
                      <button
                        onClick={fetchAllNodes}
                        disabled={isLoadingNodes}
                        style={{
                          fontSize: "0.65rem",
                          color: "rgba(0,194,112,0.7)",
                          background: "none",
                          border: "1px solid rgba(0,194,112,0.3)",
                          borderRadius: "4px",
                          padding: "4px 8px",
                          cursor: "pointer",
                          transition: "all 0.2s"
                        }}
                        onMouseEnter={(e) => {
                          (e.target as HTMLButtonElement).style.borderColor = "rgba(0,194,112,0.6)";
                          (e.target as HTMLButtonElement).style.color = "rgba(0,194,112,1)";
                        }}
                        onMouseLeave={(e) => {
                          (e.target as HTMLButtonElement).style.borderColor = "rgba(0,194,112,0.3)";
                          (e.target as HTMLButtonElement).style.color = "rgba(0,194,112,0.7)";
                        }}
                      >
                        {isLoadingNodes ? "Loading..." : "Refresh"}
                      </button>
                    </div>
                    {nodeViewError && <p style={{ fontSize: "0.7rem", color: "#dc4d4d" }}>✗ {nodeViewError}</p>}
                    <div style={{ maxHeight: "200px", overflowY: "auto", borderRadius: "8px", border: "1px solid rgba(240,232,213,0.1)", padding: "0.75rem" }}>
                      {neo4jNodes.length === 0 ? (
                        <p style={{ fontSize: "0.7rem", color: "rgba(240,232,213,0.4)" }}>No nodes yet. Create some to see them here.</p>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                          {neo4jNodes.map((node, idx) => (
                            <div
                              key={idx}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                padding: "0.6rem",
                                backgroundColor: "rgba(0,194,112,0.08)",
                                borderLeft: `2px solid rgba(0,194,112,0.3)`,
                                borderRadius: "4px"
                              }}
                            >
                              <div style={{ flex: 1 }}>
                                <span style={{ fontSize: "0.65rem", color: "rgba(0,194,112,0.6)", fontWeight: 600 }}>{node.type}</span>
                                <span style={{ fontSize: "0.75rem", color: "rgba(240,232,213,0.8)", marginLeft: "0.5rem", fontWeight: 500 }}>{node.name}</span>
                              </div>
                              <button
                                onClick={() => deleteNodeFromGraph(node.type, node.name)}
                                style={{
                                  background: "none",
                                  border: "none",
                                  color: "rgba(220,80,60,0.5)",
                                  cursor: "pointer",
                                  fontSize: "0.8rem",
                                  padding: "0 4px",
                                  transition: "color 0.2s"
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(220,80,60,0.8)")}
                                onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(220,80,60,0.5)")}
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── CHAT MESSAGES ── */}
        <main className="chat-messages-area custom-scrollbar">
          <div className="chat-messages-inner">

            {/* Welcome state illustration — inline SVG yantra */}
            {messages.length === 1 && messages[0].id === "init" && (
              <div className="chat-welcome-visual">
                <svg viewBox="0 0 200 200" fill="none" className="chat-welcome-mandala" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="100" cy="100" r="88" stroke="rgba(0,194,112,0.18)" strokeWidth="0.8"/>
                  <circle cx="100" cy="100" r="72" stroke="rgba(201,169,110,0.2)" strokeWidth="0.6"/>
                  <circle cx="100" cy="100" r="55" stroke="rgba(0,194,112,0.15)" strokeWidth="0.6"/>
                  <polygon points="100,28 166,142 34,142" stroke="rgba(0,194,112,0.22)" strokeWidth="0.8" fill="none"/>
                  <polygon points="100,172 34,58 166,58" stroke="rgba(201,169,110,0.22)" strokeWidth="0.8" fill="none"/>
                  <circle cx="100" cy="100" r="14" stroke="rgba(0,194,112,0.3)" strokeWidth="0.8" fill="none"/>
                  <circle cx="100" cy="100" r="4" fill="rgba(0,194,112,0.35)"/>
                  {[0,45,90,135,180,225,270,315].map((deg, i) => {
                    const rad = (deg * Math.PI) / 180;
                    const x = 100 + 55 * Math.cos(rad);
                    const y = 100 + 55 * Math.sin(rad);
                    return <circle key={i} cx={x} cy={y} r="1.5" fill="rgba(201,169,110,0.3)"/>;
                  })}
                </svg>
              </div>
            )}

            <AnimatePresence initial={false}>
              {messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                  className={`chat-msg-row ${msg.role === "user" ? "chat-msg-row-user" : "chat-msg-row-bot"}`}
                >
                  {msg.role === "bot" ? (
                    <div className="chat-bot-row">
                      {/* Bot avatar */}
                      <div className="chat-avatar-wrap">
                        <img
                          src={IMG.avatarVaidya}
                          alt="Vaidya"
                          className="chat-avatar-img"
                          onError={(e) => {
                            const t = e.target as HTMLImageElement;
                            t.style.display = "none";
                            t.parentElement!.innerHTML = `<div class="chat-avatar-fallback"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/><path d="M8 12s1.5 4 4 4 4-4 4-4"/></svg></div>`;
                          }}
                        />
                      </div>
                      <div className={`chat-bubble-bot ${msg.isNullState ? "chat-bubble-null" : ""} ${msg.isStreaming ? "streaming-cursor" : ""}`}>
                        {msg.isNullState ? (
                          <div className="chat-null-state">
                            <img src={IMG.nullLeaf} alt="" className="chat-null-icon" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                            <div className="rag-prose"><Markdown>{msg.content}</Markdown></div>
                          </div>
                        ) : (
                          <div className="rag-prose"><Markdown>{msg.content}</Markdown></div>
                        )}
                        {msg.similarity !== undefined && !msg.isNullState && (
                          <div className="chat-relevance-tag">relevance · {Math.round(msg.similarity * 100)}%</div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="chat-user-row">
                      <div className="chat-bubble-user">{msg.content}</div>
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>

            {isLoading && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="chat-bot-row">
                <div className="chat-avatar-wrap">
                  <img src={IMG.avatarVaidya} alt="" className="chat-avatar-img" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                </div>
                <div className="chat-bubble-bot chat-bubble-thinking">
                  <span className="chat-thinking-dot" /><span className="chat-thinking-dot" /><span className="chat-thinking-dot" />
                </div>
              </motion.div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </main>

        {/* ── INPUT BAR ── */}
        <div className="chat-input-bar">
          <form onSubmit={handleSend} className="chat-input-form">
            <div className="chat-input-wrap">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px";
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
                }}
                placeholder="Describe your health query or condition…"
                rows={1}
                className="chat-input-textarea"
              />
              <div className="chat-input-actions">
                <button
                  type="submit"
                  disabled={!input.trim() || isLoading}
                  className="chat-send-btn"
                >
                  {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={15} />}
                </button>
              </div>
            </div>
            <p className="chat-input-hint">Shift + Enter for new line · responds in Sanskrit-rooted classical tradition</p>
          </form>
        </div>
      </div>
    </div>
  );

}
