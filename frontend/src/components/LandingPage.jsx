import { useMemo, useState } from "react";
import { TRAFFIC_ACTS } from "../data/trafficActs";

const QUICK_CATEGORIES = [
  { id: "all", label: "All Offences (233)" },
  { id: "plate", label: "Number Plate & Registration" },
  { id: "safety", label: "Helmet, Seatbelt & Speed" },
  { id: "compoundable", label: "Compoundable Fines" },
  { id: "non_compoundable", label: "Non-Compoundable (Court)" },
];

const LANDING_CONTENT = {
  en: {
    badge: "AI-Assisted Traffic Evidence Verification System",
    title: "Verify Traffic Challan Evidence Before Enforcement",
    leadBefore: "eChallan Verify",
    leadAfter:
      " combines computer vision and OCR to audit traffic violation photos against challan records and vehicle registry metadata — surfacing number plate anomalies and vehicle-type mismatches while keeping final decisions with human reviewers.",
    ctaPrimary: "Open Evidence Review Desk →",
    ctaSecondary: "View Attached Act & Rules PDF",
    rulesMetric: "MVA & CMVR Offence Rules",
    rulesSub: "Searchable schedule & fine directory",
  },
  mr: {
    badge: "AI-आधारित वाहतूक पुरावा पडताळणी प्रणाली",
    title: "कारवाईपूर्वी वाहतूक चलन पुराव्यांची अचूक पडताळणी करा",
    leadBefore: "eChallan Verify",
    leadAfter:
      " संगणकीय दृष्टी (Computer Vision) आणि OCR तंत्रज्ञानाचा वापर करून वाहतूक नियमभंगाच्या छायाचित्रांची चलन नोंदी आणि वाहन नोंदणी माहितीशी पडताळणी करते — नंबर प्लेटमधील विसंगती आणि वाहन प्रकारातील तफावत शोधून अंतिम निर्णय मानवी समीक्षकांकडे सुरक्षित ठेवते.",
    ctaPrimary: "पुरावा पडताळणी कक्ष उघडा →",
    ctaSecondary: "जोडलेला कायदा व नियम PDF पहा",
    rulesMetric: "MVA आणि CMVR गुन्हे व दंड नियम",
    rulesSub: "शोधण्यायोग्य नियम आणि दंड सूची",
  },
  hi: {
    badge: "AI-आधारित यातायात साक्ष्य सत्यापन प्रणाली",
    title: "कार्रवाई से पहले यातायात चालान साक्ष्यों का सत्यापन करें",
    leadBefore: "eChallan Verify",
    leadAfter:
      " कंप्यूटर विज़न और OCR तकनीक का उपयोग करके यातायात उल्लंघन की तस्वीरों का चालान रिकॉर्ड और वाहन पंजीकरण विवरण से मिलान करता है — नंबर प्लेट की विसंगतियों और वाहन प्रकार के अंतर को सामने लाते हुए अंतिम निर्णय मानव समीक्षक के पास सुरक्षित रखता है।",
    ctaPrimary: "साक्ष्य समीक्षा डेस्क खोलें →",
    ctaSecondary: "संलग्न अधिनियम एवं नियम PDF देखें",
    rulesMetric: "MVA और CMVR अपराध नियम",
    rulesSub: "खोजने योग्य नियम एवं जुर्माना सूची",
  },
};

export default function LandingPage({ onOpenReview }) {
  const [lang, setLang] = useState("en"); // "en" (default) | "mr" | "hi"
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");

  const copy = LANDING_CONTENT[lang] ?? LANDING_CONTENT.en;

  const filteredActs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return TRAFFIC_ACTS.filter((act) => {
      if (activeCategory === "plate") {
        const text = `${act.section} ${act.english}`.toLowerCase();
        if (
          !text.includes("plate") &&
          !text.includes("registration") &&
          !text.includes("cmvr 50") &&
          !text.includes("cmvr 51")
        ) {
          return false;
        }
      } else if (activeCategory === "safety") {
        const text = `${act.section} ${act.english}`.toLowerCase();
        if (
          !text.includes("helmet") &&
          !text.includes("seatbelt") &&
          !text.includes("speed") &&
          !text.includes("signal")
        ) {
          return false;
        }
      } else if (activeCategory === "compoundable") {
        if (act.isNonCompoundable) return false;
      } else if (activeCategory === "non_compoundable") {
        if (!act.isNonCompoundable) return false;
      }

      if (!query) return true;

      const searchable = [
        String(act.srNo),
        act.section,
        act.english,
        act.marathi,
        act.fine,
        act.repetitiveFine,
      ]
        .join(" ")
        .toLowerCase();

      return searchable.includes(query);
    });
  }, [searchQuery, activeCategory]);

  return (
    <main className="page">
      {/* HERO SECTION */}
      <section className="hero-card">
        <div className="hero-content">
          <div className="hero-top-bar">
            <span className="hero-badge">{copy.badge}</span>

            <div
              className="lang-switcher"
              role="group"
              aria-label="Select description language"
            >
              <button
                type="button"
                className={`lang-btn ${lang === "en" ? "active" : ""}`}
                onClick={() => setLang("en")}
              >
                English
              </button>
              <button
                type="button"
                className={`lang-btn ${lang === "mr" ? "active" : ""}`}
                onClick={() => setLang("mr")}
              >
                मराठी
              </button>
              <button
                type="button"
                className={`lang-btn ${lang === "hi" ? "active" : ""}`}
                onClick={() => setLang("hi")}
              >
                हिंदी
              </button>
            </div>
          </div>

          <h1>{copy.title}</h1>
          <p className="hero-lead">
            <strong>{copy.leadBefore}</strong>
            {copy.leadAfter}
          </p>

          <div className="hero-actions">
            <button
              type="button"
              className="button button-primary hero-cta"
              onClick={onOpenReview}
            >
              {copy.ctaPrimary}
            </button>
            <a
              href="/act-and-rules.pdf"
              target="_blank"
              rel="noopener noreferrer"
              className="button button-secondary"
            >
              {copy.ctaSecondary}
            </a>
          </div>
        </div>

        <div className="hero-metrics" style={{ alignContent: "center" }}>
          <a
            href="#acts-directory"
            className="metric-box"
            style={{
              textDecoration: "none",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: "6px",
              padding: "18px 20px",
            }}
          >
            <span className="metric-num" style={{ fontSize: "34px" }}>
              {TRAFFIC_ACTS.length}
            </span>
            <span
              className="metric-label"
              style={{ textAlign: "left", fontWeight: 700, color: "var(--ink)" }}
            >
              {copy.rulesMetric}
            </span>
            <span style={{ fontSize: "12px", color: "var(--mute)" }}>
              {copy.rulesSub} ↓
            </span>
          </a>
        </div>
      </section>

      {/* MOTOR VEHICLE ACT & FINE SEARCH DIRECTORY */}
      <section className="panel acts-panel" id="acts-directory">
        <div className="panel-head acts-head">
          <div>
            <h2>Motor Vehicle Act &amp; Traffic Offence Directory</h2>
            <p className="panel-description">
              Searchable schedule of MVA, CMVR, MMVR, and MVDR traffic sections and
              penalties (Offence Details Version 21.0).
            </p>
          </div>
          <div className="pdf-actions">
            <a
              href="/act-and-rules.pdf"
              download="act_and_rules.pdf"
              className="button button-secondary btn-sm"
            >
              Download PDF (9 Pages)
            </a>
          </div>
        </div>

        <div className="panel-body">
          {/* SEARCH BAR & FILTER PILLS */}
          <div className="search-controls">
            <div className="search-input-wrap">
              <svg
                className="search-icon"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="search"
                className="act-search-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by Act/Section (e.g. CMVR 50, 194(D), 184), offence keyword (e.g. Number Plate, Helmet, Speed), or Marathi..."
                aria-label="Search traffic acts and fines"
              />
              {searchQuery && (
                <button
                  type="button"
                  className="clear-search-btn"
                  onClick={() => setSearchQuery("")}
                >
                  Clear
                </button>
              )}
            </div>

            <div className="filter-pills" role="group" aria-label="Filter by category">
              {QUICK_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  className={`filter-pill ${
                    activeCategory === cat.id ? "active" : ""
                  }`}
                  onClick={() => setActiveCategory(cat.id)}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            <div className="search-meta">
              Showing <b>{filteredActs.length}</b> of <b>{TRAFFIC_ACTS.length}</b>{" "}
              offences
              {searchQuery && (
                <>
                  {" "}
                  matching <code>"{searchQuery}"</code>
                </>
              )}
            </div>
          </div>

          {/* ACTS & FINES TABLE */}
          {filteredActs.length === 0 ? (
            <div className="empty-state">
              <strong>No matching offences found</strong>
              <p>
                Try searching with a different section number (like <code>177</code>,{" "}
                <code>192</code>, <code>CMVR 50</code>) or keyword (like{" "}
                <code>helmet</code>, <code>plate</code>, <code>parking</code>).
              </p>
            </div>
          ) : (
            <div className="acts-table-wrap">
              <table className="acts-table">
                <thead>
                  <tr>
                    <th style={{ width: "64px" }}>Sr.</th>
                    <th style={{ width: "210px" }}>Offense Section</th>
                    <th>Offense Name (English &amp; Marathi)</th>
                    <th style={{ width: "170px" }}>First Offence Fine</th>
                    <th style={{ width: "170px" }}>Repetitive Fine</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredActs.map((act) => (
                    <tr key={act.srNo}>
                      <td className="mono-cell">{act.srNo}</td>
                      <td>
                        <span className="section-badge">{act.section}</span>
                      </td>
                      <td>
                        <div className="offense-en">{act.english}</div>
                        <div className="offense-mr">{act.marathi}</div>
                      </td>
                      <td>
                        {act.isNonCompoundable ? (
                          <span className="status status-warning">Court / 0</span>
                        ) : (
                          <strong className="fine-amount">₹ {act.fine}</strong>
                        )}
                      </td>
                      <td>
                        <span
                          className={`status ${
                            act.isNonCompoundable
                              ? "status-warning"
                              : "status-neutral"
                          }`}
                        >
                          {act.repetitiveFine === "Same"
                            ? `₹ ${act.fine} (Same)`
                            : act.repetitiveFine === "NA" ||
                              act.isNonCompoundable ||
                              act.repetitiveFine.includes("within")
                            ? act.repetitiveFine
                            : `₹ ${act.repetitiveFine}`}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}