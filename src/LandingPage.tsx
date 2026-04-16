import { useRef } from "react";
import { motion, useScroll, useTransform } from "motion/react";
import {
  Leaf, Sparkles, ArrowRight, Database, Brain,
  Globe, Shield, Activity, BookOpen,
} from "lucide-react";

const SUPABASE_IMG = "https://yidjcuymlbmdxbjcjjbd.supabase.co/storage/v1/object/public/generated-images/VaidyaRAG";
const LIMG = {
  heroBg:         `${SUPABASE_IMG}/hero-bg-texture.jpg`,
  heroMandala:    `${SUPABASE_IMG}/hero-mandala-overlay.png`,
  corpusSushruta: `${SUPABASE_IMG}/corpus-sushruta.jpg`,
  corpusCharaka:  `${SUPABASE_IMG}/corpus-charaka.jpg`,
  corpusAshtanga: `${SUPABASE_IMG}/corpus-ashtanga.jpg`,
  featuresBg:     `${SUPABASE_IMG}/features-botanical.jpg`,
  ctaBg:          `${SUPABASE_IMG}/cta-atmosphere.jpg`,
  howItWorks:     `${SUPABASE_IMG}/knowledge-layers.jpg`,
  avatarVaidya:   `${SUPABASE_IMG}/avatar-vaidya.png`,
};

interface LandingPageProps {
  onEnter: () => void;
}

// ─── Data ──────────────────────────────────────────────────────────────────

const CORPUS_CARDS = [
  {
    num: "01",
    name: "Sushruta Samhita",
    sanskrit: "सुश्रुत संहिता",
    role: "The Surgical Canon",
    desc: "The foundational text of Ayurvedic surgery. 184 chapters covering surgical techniques, medicinal botany, anatomy, wound care, and post-operative protocols. Composed by the sage Sushruta circa 600 BCE.",
    accent: "#00C270",
  },
  {
    num: "02",
    name: "Charaka Samhita",
    sanskrit: "चरक संहिता",
    role: "The Internal Medicine Canon",
    desc: "Attributed to the physician Charaka — the master treatise on internal medicine, the tri-dosha theory (Vata · Pitta · Kapha), longevity, pharmacology, and the ethics of Ayurvedic practice.",
    accent: "#C9A96E",
  },
  {
    num: "03",
    name: "Ashtanga Hridayam",
    sanskrit: "अष्टांग हृदयम्",
    role: "The Heart of Eight Branches",
    desc: "Authored by Vagbhata — a masterclass synthesis of all eight Ayurvedic branches: internal medicine, surgery, toxicology, pediatrics, rejuvenation, aphrodisiacs, eye/ear/throat, and spirit medicine.",
    accent: "#8FA888",
  },
];

const FEATURES = [
  {
    Icon: Database,
    title: "Hybrid RAG Retrieval",
    desc: "Vector cosine similarity fused with PostgreSQL full-text search via Reciprocal Rank Fusion. The most relevant fragment always rises to the top.",
  },
  {
    Icon: Brain,
    title: "Gemini 2.5 Intelligence",
    desc: "Powered by Google's most advanced model, with responses constrained exclusively to corpus evidence. Hallucination is architecturally blocked.",
  },
  {
    Icon: Globe,
    title: "Bilingual by Design",
    desc: "Auto-detects Hindi (Devanagari) or English from your query. The system responds in the same tongue — no configuration required.",
  },
  {
    Icon: Shield,
    title: "Clinical Safety Layer",
    desc: "Responses only surface when a similarity threshold is met. Ambiguous or off-topic queries trigger a null-state rather than speculation.",
  },
  {
    Icon: Activity,
    title: "Streaming Response",
    desc: "Server-Sent Events deliver the synthesis token-by-token, recreating the cadence of a live consultation with ancient knowledge.",
  },
  {
    Icon: Sparkles,
    title: "Three-Corpus Search",
    desc: "All three tables — Sushruta, Charaka, Ashtanga Hridayam — are searched simultaneously. The best answers emerge, regardless of source.",
  },
];

const MARQUEE_ITEMS = [
  "Sushruta Samhita", "Charaka Samhita", "Ashtanga Hridayam",
  "Hybrid RAG Engine", "Bilingual AI", "Gemini 2.5 Flash",
  "Vata · Pitta · Kapha", "Dosha Intelligence", "Clinical Precision",
  "Sanskrit Corpus", "pgvector Search", "SSE Streaming",
];

// ─── Sub-components ────────────────────────────────────────────────────────

function MandalaSVG({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 400 400"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <path
          id="text-ring-outer"
          d="M200,200 m-172,0 a172,172 0 1,1 344,0 a172,172 0 1,1 -344,0"
        />
        <radialGradient id="orb-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#00C270" stopOpacity="0.35" />
          <stop offset="55%" stopColor="#1C5C3A" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#060C08" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Outermost decorative ring */}
      <circle cx="200" cy="200" r="190" stroke="rgba(201,169,110,0.04)" strokeWidth="0.5" />
      <circle cx="200" cy="200" r="172" stroke="rgba(201,169,110,0.08)" strokeWidth="0.5" strokeDasharray="3 7" />

      {/* Rotating Sanskrit text ring */}
      <g className="svg-spin-slow">
        <text
          fontSize="9"
          fill="rgba(201,169,110,0.5)"
          fontFamily="serif"
          letterSpacing="3"
        >
          <textPath href="#text-ring-outer" startOffset="0%">
            ✦ सुश्रुत संहिता ✦ चरक संहिता ✦ अष्टांग हृदयम् ✦ आयुर्वेद ✦ ॐ तत् सत् ✦ 
          </textPath>
        </text>
      </g>

      {/* Mid ring */}
      <circle cx="200" cy="200" r="128" stroke="rgba(0,194,112,0.07)" strokeWidth="0.5" />

      {/* Sacred Shatkona (Star of David / Yantra) */}
      <g opacity="0.07" stroke="rgba(0,194,112,1)" strokeWidth="0.6" fill="none">
        <polygon points="200,82 294,245 106,245" />
        <polygon points="200,318 106,155 294,155" />
      </g>

      {/* 8 compass tick marks */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => {
        const rad = (angle * Math.PI) / 180;
        return (
          <line
            key={angle}
            x1={200 + 122 * Math.cos(rad)}
            y1={200 + 122 * Math.sin(rad)}
            x2={200 + 133 * Math.cos(rad)}
            y2={200 + 133 * Math.sin(rad)}
            stroke="rgba(0,194,112,0.25)"
            strokeWidth="1"
          />
        );
      })}

      {/* Counter-spinning inner ring */}
      <g className="svg-spin-reverse">
        <circle cx="200" cy="200" r="72" stroke="rgba(0,194,112,0.07)" strokeWidth="0.5" strokeDasharray="2 6" />
      </g>

      {/* Central orb glow */}
      <circle cx="200" cy="200" r="80" fill="url(#orb-glow)" />

      {/* Glass orb */}
      <circle cx="200" cy="200" r="43" fill="rgba(8,14,10,0.92)" stroke="rgba(0,194,112,0.28)" strokeWidth="1" />
      <circle cx="200" cy="200" r="38" fill="rgba(8,14,10,0.96)" stroke="rgba(0,194,112,0.1)" strokeWidth="0.5" />

      {/* 4 axis cross-hairs */}
      {[0, 90, 180, 270].map((angle) => {
        const rad = (angle * Math.PI) / 180;
        return (
          <line
            key={`ch-${angle}`}
            x1={200 + 48 * Math.cos(rad)}
            y1={200 + 48 * Math.sin(rad)}
            x2={200 + 60 * Math.cos(rad)}
            y2={200 + 60 * Math.sin(rad)}
            stroke="rgba(0,194,112,0.45)"
            strokeWidth="0.8"
          />
        );
      })}

      {/* Centre nucleus */}
      <circle cx="200" cy="200" r="5" fill="#00C270" opacity="0.7" />
      <circle cx="200" cy="200" r="2.5" fill="#00C270" />
    </svg>
  );
}

function MarqueeBand() {
  const doubled = [...MARQUEE_ITEMS, ...MARQUEE_ITEMS, ...MARQUEE_ITEMS];
  return (
    <div className="lp-marquee-band" aria-hidden="true">
      <div className="lp-marquee-track">
        {doubled.map((item, i) => (
          <span key={i} className="lp-marquee-item">
            {item}
            <span className="lp-marquee-dot">✦</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function LandingPage({ onEnter }: LandingPageProps) {
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll();
  const heroTextY = useTransform(scrollY, [0, 480], [0, -60]);
  const heroTextOpacity = useTransform(scrollY, [0, 400], [1, 0]);

  return (
    <div className="lp-root">

      {/* ══ NAVIGATION ══════════════════════════════════════════════════════ */}
      <motion.nav
        initial={{ opacity: 0, y: -24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: "easeOut" }}
        className="lp-nav"
      >
        <div className="lp-nav-logo">
          <Leaf size={16} className="lp-nav-logo-icon" />
          <span className="lp-nav-logo-text">
            Veda<span className="lp-nav-logo-em">AI</span>
          </span>
        </div>

        <div className="lp-nav-links">
          <a href="#corpus" className="lp-nav-link">Corpus</a>
          <a href="#how" className="lp-nav-link">Intelligence</a>
          <a href="#features" className="lp-nav-link">Features</a>
        </div>

        <button onClick={onEnter} className="lp-nav-cta">
          Consult <ArrowRight size={13} className="inline ml-1" />
        </button>
      </motion.nav>

      {/* ══ HERO ════════════════════════════════════════════════════════════ */}
      <section ref={heroRef} className="lp-hero">
        {/* Photo background — botanical garden from above */}
        <div className="lp-hero-photo" style={{ backgroundImage: `url('${LIMG.heroBg}')` }} />
        <div className="lp-hero-photo-tint" />
        {/* Grain texture overlay */}
        <div className="lp-hero-grain" />

        {/* Background yantra — very faint, full bleed */}
        <div className="lp-hero-bg-yantra">
          <MandalaSVG />
        </div>

        <div className="lp-hero-inner">
          {/* ── Left: Typography ── */}
          <motion.div
            style={{ y: heroTextY, opacity: heroTextOpacity }}
            className="lp-hero-text"
          >
            <motion.span
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, delay: 0.3 }}
              className="lp-eyebrow"
            >
              Ancient Wisdom × Artificial Intelligence
            </motion.span>

            <motion.h1
              initial={{ opacity: 0, y: 36 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, delay: 0.5 }}
              className="lp-hero-h1"
            >
              The Sacred Corpus,<br />
              <span className="lp-hero-h1-em">
                Intelligently<br />Synthesized.
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, delay: 0.75 }}
              className="lp-hero-sub"
            >
              Three millennia of Ayurvedic knowledge —{" "}
              <em>Sushruta Samhita</em>, <em>Charaka Samhita</em>, and{" "}
              <em>Ashtanga Hridayam</em> — unified through precision hybrid
              retrieval and Gemini 2.5 synthesis.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 1.0 }}
              className="lp-hero-cta-row"
            >
              <button onClick={onEnter} className="lp-hero-btn-primary">
                Begin Consultation
                <ArrowRight size={15} className="inline ml-2" />
              </button>
              <a href="#corpus" className="lp-hero-btn-ghost">
                Explore Corpus
              </a>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 1, delay: 1.4 }}
              className="lp-hero-stats"
            >
              {[
                { num: "3", label: "Sacred Texts" },
                { num: "5000+", label: "Years of Knowledge" },
                { num: "2", label: "Languages" },
              ].map((s, i) => (
                <div key={i} className="lp-hero-stat-group">
                  {i > 0 && <div className="lp-hero-stat-sep" />}
                  <div className="lp-hero-stat">
                    <span className="lp-hero-stat-num">{s.num}</span>
                    <span className="lp-hero-stat-label">{s.label}</span>
                  </div>
                </div>
              ))}
            </motion.div>
          </motion.div>

          {/* ── Right: Mandala Visual ── */}
          <motion.div
            initial={{ opacity: 0, scale: 0.88 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1.6, delay: 0.35, ease: "easeOut" }}
            className="lp-hero-visual"
          >
            <div className="lp-mandala-wrap">
              <MandalaSVG className="lp-mandala-svg" />
              {/* Counter-animated center icon */}
              <div className="lp-mandala-center">
                <Leaf size={22} className="lp-mandala-leaf" />
              </div>
            </div>
          </motion.div>
        </div>

        {/* Scroll hint */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2.2, duration: 1 }}
          className="lp-scroll-hint"
        >
          <div className="lp-scroll-line" />
          <span>SCROLL</span>
        </motion.div>
      </section>

      {/* ══ MARQUEE ═════════════════════════════════════════════════════════ */}
      <MarqueeBand />

      {/* ══ CORPUS ══════════════════════════════════════════════════════════ */}
      <section id="corpus" className="lp-section lp-corpus">
        <div className="lp-section-inner">
          <motion.div
            initial={{ opacity: 0, y: 32 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.9 }}
            className="lp-section-header"
          >
            <span className="lp-eyebrow">The Knowledge Base</span>
            <h2 className="lp-section-h2">Three Sacred Texts</h2>
            <p className="lp-section-sub">
              Five thousand years of empirical medicine, encoded. Each corpus is
              independently indexed and simultaneously retrieved — so the most
              relevant fragment always surfaces, regardless of which text holds it.
            </p>
          </motion.div>

          <div className="lp-corpus-grid">
            {CORPUS_CARDS.map((card, i) => (
              <motion.div
                key={card.num}
                initial={{ opacity: 0, y: 48 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.15 }}
                transition={{ duration: 0.85, delay: i * 0.16 }}
                className={`lp-corpus-card lp-corpus-card-${i + 1}`}
              >
                {/* Photo texture layer */}
                <div
                  className="lp-corpus-card-photo"
                  style={{ backgroundImage: `url('${[LIMG.corpusSushruta, LIMG.corpusCharaka, LIMG.corpusAshtanga][i]}')` }}
                />
                <div className="lp-corpus-num" style={{ color: card.accent }}>
                  {card.num}
                </div>
                <div className="lp-corpus-rule" style={{ background: card.accent }} />
                <div className="lp-corpus-sanskrit">{card.sanskrit}</div>
                <h3 className="lp-corpus-title">{card.name}</h3>
                <div className="lp-corpus-role">{card.role}</div>
                <p className="lp-corpus-desc">{card.desc}</p>
                <div className="lp-corpus-status">
                  <span
                    className="lp-status-dot"
                    style={{ background: card.accent }}
                  />
                  Indexed · Active
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ HOW IT WORKS ════════════════════════════════════════════════════ */}
      <section id="how" className="lp-section lp-how">
        <div className="lp-section-inner">
          <motion.div
            initial={{ opacity: 0, y: 32 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.9 }}
            className="lp-section-header"
          >
            <span className="lp-eyebrow">The Engine</span>
            <h2 className="lp-section-h2">How Intelligence Flows</h2>
          </motion.div>

          <div className="lp-how-steps">
            {[
              {
                n: "01",
                title: "You Ask",
                desc: "Describe your condition, symptom, or query in English or Hindi. The system detects script and language automatically — no toggle required.",
                indent: 0,
              },
              {
                n: "02",
                title: "The Corpus Searches",
                desc: "A hybrid engine fires vector cosine similarity and PostgreSQL full-text search simultaneously across all three sacred texts. Results are fused with Reciprocal Rank Fusion.",
                indent: 1,
              },
              {
                n: "03",
                title: "Intelligence Synthesizes",
                desc: "The top-ranked fragments are injected as structured XML context into Gemini 2.5-flash. The model synthesizes a clinical, structured response — grounded exclusively in what the ancient texts say.",
                indent: 2,
              },
            ].map((step, i) => (
              <motion.div
                key={step.n}
                initial={{ opacity: 0, x: i % 2 === 0 ? -36 : 36 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.85, delay: i * 0.18 }}
                className="lp-how-step"
                style={{ paddingLeft: `${step.indent * 3}rem` }}
              >
                <div className="lp-how-num">{step.n}</div>
                <div className="lp-how-content">
                  <h3 className="lp-how-title">{step.title}</h3>
                  <p className="lp-how-desc">{step.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ FEATURES ════════════════════════════════════════════════════════ */}
      <section id="features" className="lp-section lp-features">
        {/* Botanical macro background */}
        <div className="lp-section-bg-photo" style={{ backgroundImage: `url('${LIMG.featuresBg}')` }} />
        <div className="lp-section-inner">
          <motion.div
            initial={{ opacity: 0, y: 32 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.9 }}
            className="lp-section-header"
          >
            <span className="lp-eyebrow">Capabilities</span>
            <h2 className="lp-section-h2">Precision-Engineered</h2>
          </motion.div>

          <div className="lp-features-grid">
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 36 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.15 }}
                transition={{ duration: 0.7, delay: i * 0.09 }}
                className="lp-feature-card"
              >
                <div className="lp-feature-icon-box">
                  <f.Icon size={19} className="lp-feature-icon" />
                </div>
                <h4 className="lp-feature-title">{f.title}</h4>
                <p className="lp-feature-desc">{f.desc}</p>
              </motion.div>
            ))}
          </div>

          {/* Knowledge layers accent — cross-section of manuscript layers */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 1, delay: 0.2 }}
            className="lp-knowledge-strip"
          >
            <img src={LIMG.howItWorks} alt="Manuscript knowledge layers" className="lp-knowledge-strip-img" />
            <div className="lp-knowledge-strip-caption">
              <span className="lp-eyebrow" style={{ margin: 0 }}>How Retrieval Works</span>
              <p>Each query passes through pgvector similarity search and PostgreSQL full-text scoring, fused via Reciprocal Rank Fusion before synthesis.</p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ══ CTA ═════════════════════════════════════════════════════════════ */}
      <section className="lp-cta">
        {/* Atmospheric night photo */}
        <div
          className="lp-cta-photo"
          style={{ backgroundImage: `url('${LIMG.ctaBg}')` }}
        />
        {/* Background yantra */}
        <div className="lp-cta-bg">
          <MandalaSVG />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 1 }}
          className="lp-cta-inner"
        >
          <span className="lp-eyebrow">The Sanctuary</span>
          <h2 className="lp-cta-h2">
            Ancient Medicine,<br />
            <span className="lp-cta-h2-em">Modern Intelligence.</span>
          </h2>
          <p className="lp-cta-sub">
            Consult three sacred texts, synthesized by AI in real time.
            <br />Available in English and Hindi.
          </p>
          <button onClick={onEnter} className="lp-cta-btn">
            Enter the Sanctuary
            <ArrowRight size={17} className="inline ml-2" />
          </button>
        </motion.div>
      </section>

      {/* ══ FOOTER ══════════════════════════════════════════════════════════ */}
      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-footer-logo">
            <Leaf size={13} className="lp-footer-leaf" />
            <span>VedaAI</span>
          </div>
          <p className="lp-footer-note">
            Responses are grounded exclusively in classical Ayurvedic texts.
            Not a substitute for professional medical advice.
          </p>
          <p className="lp-footer-credits">
            Sushruta Samhita · Charaka Samhita · Ashtanga Hridayam
          </p>
        </div>
      </footer>

      {/* ══ FAB — Consult Vaidya ════════════════════════════════════════════ */}
      <button className="lp-fab" onClick={onEnter} aria-label="Consult Vaidya">
        <span className="lp-fab-pulse-ring" />
        <div className="lp-fab-avatar">
          <img
            src={LIMG.avatarVaidya}
            alt="Vaidya"
            className="lp-fab-img"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <Leaf size={22} className="lp-fab-fallback-icon" />
        </div>
        <span className="lp-fab-tooltip">Consult Vaidya</span>
      </button>
    </div>
  );
}
