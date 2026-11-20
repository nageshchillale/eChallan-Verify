import { useEffect, useRef, useState } from "react";
import LandingPage from "./components/LandingPage.jsx";
import { TRAFFIC_ACTS } from "./data/trafficActs.js";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ALLOWED_EXTENSIONS = /\.(jpe?g|png|webp)$/i;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

function formatStatus(value) {
  return String(value ?? "unknown").replaceAll("_", " ");
}

function getStatusClass(value) {
  const status = value ?? "manual_review";
  if (["registration_match", "registry_match", "consistent"].includes(status)) {
    return "status status-success";
  }
  if (["possible_mismatch", "mismatch"].includes(status)) {
    return "status status-warning";
  }
  return "status status-neutral";
}

function getMeterWidth(score) {
  const num = Number(score);
  if (!Number.isFinite(num)) return "0%";
  return `${Math.max(0, Math.min(1, num)) * 100}%`;
}

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    let message = data.detail ?? `Request failed (${response.status})`;
    if (Array.isArray(message)) {
      message = message.map((item) => item.msg || "Invalid request").join("; ");
    }
    throw new Error(message);
  }
  return data;
}

export default function App() {
  // Active page view: "landing" | "review"
  const [activeView, setActiveView] = useState("landing");

  // Intake mode: "challan" (Challan Audit) | "direct" (Quick Scan Image Only)
  const [intakeMode, setIntakeMode] = useState("challan");

  // System state
  const [apiState, setApiState] = useState("checking"); // "checking" | "online" | "offline"
  const [challans, setChallans] = useState([]);
  const [registryVehicles, setRegistryVehicles] = useState([]);

  // Intake form state
  const [selectedChallanId, setSelectedChallanId] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [dzPreviewUrl, setDzPreviewUrl] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [formNotice, setFormNotice] = useState({ message: "", type: "info" });

  // Challan Create / Edit Drawer state
  const [challanEditorMode, setChallanEditorMode] = useState(null); // null | "create" | "edit"
  const [editorRegNo, setEditorRegNo] = useState("");
  const [editorViolation, setEditorViolation] = useState("");
  const [editorSection, setEditorSection] = useState("");
  const [editorFine, setEditorFine] = useState("500");
  const [editorLocation, setEditorLocation] = useState("");
  const [isSavingChallan, setIsSavingChallan] = useState(false);

  // Analysis & tabs state
  const [currentAnalysis, setCurrentAnalysis] = useState(null);
  const [activeTab, setActiveTab] = useState("annotated");

  // Reviewer decision state
  const [registrationDecision, setRegistrationDecision] = useState("");
  const [vehicleTypeDecision, setVehicleTypeDecision] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");
  const [isSavingReview, setIsSavingReview] = useState(false);
  const [reviewNotice, setReviewNotice] = useState({ message: "", type: "info" });

  // Review history state
  const [reviews, setReviews] = useState([]);
  const [reviewsStatus, setReviewsStatus] = useState("idle"); // "idle" | "loading" | "loaded" | "error"
  const [reviewsError, setReviewsError] = useState("");

  const resultPanelRef = useRef(null);
  const fileInputRef = useRef(null);

  // Load initial dashboard data and challans
  useEffect(() => {
    let isMounted = true;

    async function loadDashboardData() {
      try {
        const [vehicleResponse, challanList] = await Promise.all([
          fetchJSON("/vehicles"),
          fetchJSON("/challans"),
        ]);

        if (!isMounted) return;

        const vehicles = Array.isArray(vehicleResponse)
          ? vehicleResponse
          : vehicleResponse.vehicles ?? [];

        setRegistryVehicles(vehicles);
        setChallans(challanList);
        setApiState("online");
      } catch (error) {
        if (!isMounted) return;
        setApiState("offline");
        setFormNotice({
          message: `Could not load API data: ${error.message}`,
          type: "error",
        });
      }
    }

    loadDashboardData();
    return () => {
      isMounted = false;
    };
  }, []);

  // Manage object URL lifecycle for dropzone thumbnail
  useEffect(() => {
    if (!selectedFile) {
      setDzPreviewUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(selectedFile);
    setDzPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedFile]);

  const selectedChallanObj =
    challans.find((c) => c.challan_id === selectedChallanId) ?? null;

  function openCreateChallanForm(prefillReg = "") {
    setIntakeMode("challan");
    setChallanEditorMode("create");
    setEditorRegNo(prefillReg);
    setEditorViolation("Jumping signal");
    setEditorSection("MMVR 239/177 MVA");
    setEditorFine("500");
    setEditorLocation("Pune, Maharashtra");
  }

  function openEditChallanForm() {
    if (!selectedChallanObj) return;
    setChallanEditorMode("edit");
    setEditorRegNo(selectedChallanObj.registration_no ?? "");
    setEditorViolation(selectedChallanObj.violation_type ?? "");
    setEditorSection(selectedChallanObj.offense_section ?? "Sec 177 MVA");
    setEditorFine(selectedChallanObj.fine_amount ?? "500");
    setEditorLocation(selectedChallanObj.location ?? "Maharashtra");
  }

  function handleSelectRulePreset(srNoString) {
    const rule = TRAFFIC_ACTS.find((item) => String(item.srNo) === srNoString);
    if (!rule) return;
    setEditorViolation(rule.english);
    setEditorSection(rule.section);
    setEditorFine(rule.fine);
  }

  async function handleSaveChallanRecord(event) {
    event.preventDefault();

    const cleanedReg = editorRegNo.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    if (cleanedReg.length < 4) {
      setFormNotice({
        message: "Enter a valid registration number (at least 4 characters).",
        type: "error",
      });
      return;
    }

    setIsSavingChallan(true);

    try {
      const payload = {
        registration_no: cleanedReg,
        violation_type: editorViolation.trim() || "Traffic Violation",
        offense_section: editorSection.trim() || "Sec 177 MVA",
        fine_amount: editorFine.trim() || "500",
        location: editorLocation.trim() || "Maharashtra",
      };

      let saved;
      if (challanEditorMode === "edit" && selectedChallanObj) {
        saved = await fetchJSON(
          `/challans/${encodeURIComponent(selectedChallanObj.challan_id)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }
        );
        setChallans((prev) =>
          prev.map((item) =>
            item.challan_id === saved.challan_id ? saved : item
          )
        );
        setFormNotice({
          message: `Updated ${saved.challan_id} (${saved.registration_no}).`,
          type: "success",
        });
      } else {
        saved = await fetchJSON("/challans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        setChallans((prev) => [...prev, saved]);
        setSelectedChallanId(saved.challan_id);
        setFormNotice({
          message: `Created ${saved.challan_id} for ${saved.registration_no}.`,
          type: "success",
        });
      }

      setChallanEditorMode(null);
    } catch (error) {
      setFormNotice({
        message: `Could not save challan: ${error.message}`,
        type: "error",
      });
    } finally {
      setIsSavingChallan(false);
    }
  }

  async function loadReviewHistory(challanId) {
    if (!challanId) {
      setReviewsStatus("idle");
      setReviews([]);
      return;
    }

    setReviewsStatus("loading");
    setReviewsError("");

    try {
      const data = await fetchJSON(
        `/reviews?challan_id=${encodeURIComponent(challanId)}`
      );
      setReviews(data);
      setReviewsStatus("loaded");
    } catch (error) {
      setReviewsError(`Could not load review history: ${error.message}`);
      setReviewsStatus("error");
    }
  }

  function handleFileChange(event) {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
  }

  function handleDrop(event) {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer?.files?.[0] ?? null;
    if (file) {
      setSelectedFile(file);
      if (fileInputRef.current) {
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInputRef.current.files = dt.files;
      }
    }
  }

  async function handleAnalyzeSubmit(event) {
    event.preventDefault();

    if (intakeMode === "challan" && !selectedChallanId) {
      setFormNotice({ message: "Select a challan before continuing.", type: "error" });
      return;
    }

    if (!selectedFile) {
      setFormNotice({ message: "Choose an evidence image first.", type: "error" });
      return;
    }

    if (
      (selectedFile.type && !ALLOWED_TYPES.includes(selectedFile.type)) ||
      !ALLOWED_EXTENSIONS.test(selectedFile.name)
    ) {
      setFormNotice({ message: "Use a JPG, PNG, or WEBP image.", type: "error" });
      return;
    }

    if (selectedFile.size > MAX_IMAGE_SIZE) {
      setFormNotice({
        message: "The image must be no larger than 10 MB.",
        type: "error",
      });
      return;
    }

    const body = new FormData();
    body.append("file", selectedFile);

    setIsAnalyzing(true);
    setCurrentAnalysis(null);
    setFormNotice({
      message:
        intakeMode === "direct"
          ? "Scanning image for license plate, OCR text, and registry match..."
          : "Detecting the plate, OCR candidates, and vehicle type...",
      type: "info",
    });

    try {
      if (intakeMode === "direct") {
        const raw = await fetchJSON("/verify-evidence", {
          method: "POST",
          body,
        });

        const normalizedDirect = {
          ...raw,
          scan_mode: "direct",
          challan_id: null,
          status: raw.verification?.status ?? "manual_review",
          reason: raw.verification?.reason ?? "Direct image scan completed.",
          registry_verification: raw.verification ?? null,
          expected_vehicle: raw.verification?.matched_vehicle ?? null,
          expected_registration:
            raw.verification?.matched_registration ??
            raw.ocr_candidates?.[0]?.normalized ??
            null,
        };

        setCurrentAnalysis(normalizedDirect);
        setActiveTab("annotated");
        setReviewsStatus("idle");
        setReviews([]);

        setFormNotice({
          message: "Direct image scan complete.",
          type: "success",
        });
      } else {
        const result = await fetchJSON(
          `/challans/${encodeURIComponent(selectedChallanId)}/verify-evidence`,
          { method: "POST", body }
        );

        setCurrentAnalysis({ ...result, scan_mode: "challan" });
        setActiveTab("annotated");
        setRegistrationDecision("");
        setVehicleTypeDecision("");
        setReviewNotes("");
        setReviewNotice({ message: "", type: "info" });

        setFormNotice({
          message: "Analysis complete. Review all three checks before deciding.",
          type: "success",
        });

        await loadReviewHistory(result.challan_id);
      }

      if (window.matchMedia("(max-width: 980px)").matches && resultPanelRef.current) {
        resultPanelRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (error) {
      setFormNotice({ message: `Analysis failed: ${error.message}`, type: "error" });
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleReviewSubmit(event) {
    event.preventDefault();

    if (!currentAnalysis?.challan_id) {
      setReviewNotice({
        message: "Analyze a challan before submitting a review.",
        type: "error",
      });
      return;
    }

    if (!registrationDecision || !vehicleTypeDecision) {
      setReviewNotice({
        message: "Please select both reviewer decisions.",
        type: "error",
      });
      return;
    }

    setIsSavingReview(true);

    try {
      await fetchJSON("/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challan_id: currentAnalysis.challan_id,
          ai_status: currentAnalysis.status ?? "manual_review",
          vehicle_type_status: currentAnalysis.vehicle_type_status ?? "manual_review",
          registration_decision: registrationDecision,
          vehicle_type_decision: vehicleTypeDecision,
          notes: reviewNotes.trim(),
        }),
      });

      setReviewNotice({
        message: "Both reviewer decisions saved successfully.",
        type: "success",
      });
      setReviewNotes("");
      await loadReviewHistory(currentAnalysis.challan_id);
    } catch (error) {
      setReviewNotice({
        message: `Could not save review: ${error.message}`,
        type: "error",
      });
    } finally {
      setIsSavingReview(false);
    }
  }

  const isDirectScan = currentAnalysis?.scan_mode === "direct";

  const plateConfidence = Number(currentAnalysis?.detection_confidence);
  const hasPlateConfidence =
    currentAnalysis?.detection_confidence !== null &&
    currentAnalysis?.detection_confidence !== undefined &&
    Number.isFinite(plateConfidence);

  const vehicleConfidence = Number(currentAnalysis?.vehicle_detection_confidence);
  const hasVehicleConfidence =
    currentAnalysis?.vehicle_detection_confidence !== null &&
    currentAnalysis?.vehicle_detection_confidence !== undefined &&
    Number.isFinite(vehicleConfidence);

  const registryVehicle =
    currentAnalysis?.expected_vehicle ?? currentAnalysis?.registered_vehicle ?? null;

  const regVerification = currentAnalysis?.registry_verification ?? null;

  const topDetectedPlate =
    currentAnalysis?.ocr_candidates?.[0]?.normalized ?? "";

  return (
    <>
      <header className="masthead">
        <div className="masthead-in">
          <div className="brand-block">
            <img
              src="/logo.png"
              alt="eChallan Verify logo"
              className="brand-logo"
              onClick={() => setActiveView("landing")}
              style={{ cursor: "pointer" }}
            />
            <div>
              <div
                className="brand"
                onClick={() => setActiveView("landing")}
                style={{ cursor: "pointer" }}
              >
                eChallan <span>Verify</span>
              </div>
              <div className="subtitle">Traffic evidence review desk</div>
            </div>

            <nav className="top-nav" aria-label="Primary navigation">
              <button
                type="button"
                className={`nav-tab ${activeView === "landing" ? "active" : ""}`}
                onClick={() => setActiveView("landing")}
              >
                Overview &amp; Acts
              </button>
              <button
                type="button"
                className={`nav-tab ${activeView === "review" ? "active" : ""}`}
                onClick={() => setActiveView("review")}
              >
                Evidence Review
              </button>
            </nav>
          </div>
        </div>
      </header>

      {activeView === "landing" ? (
        <LandingPage
          onOpenReview={() => {
            setActiveView("review");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      ) : (
        <main className="page">
          <section className="page-heading">
            <h1>Evidence review</h1>
            <p>
              Audit a challan against photo evidence—or run a direct Quick Scan on any
              vehicle photo to detect its plate and look up registry records.
            </p>
          </section>

          <div className="console">
            {/* LEFT INTAKE PANEL */}
            <aside className="panel upload-panel">
              <div className="panel-head">
                <h2>Intake</h2>
                <p className="panel-description">
                  Choose Challan Audit or Direct Image Scan.
                </p>
              </div>
              <div className="panel-body">
                {/* INTAKE MODE SWITCHER */}
                <div
                  className="mode-toggle"
                  role="group"
                  aria-label="Select verification mode"
                >
                  <button
                    type="button"
                    className={`mode-btn ${intakeMode === "challan" ? "active" : ""}`}
                    onClick={() => {
                      setIntakeMode("challan");
                      setFormNotice({ message: "", type: "info" });
                    }}
                  >
                    Challan Audit
                  </button>
                  <button
                    type="button"
                    className={`mode-btn ${intakeMode === "direct" ? "active" : ""}`}
                    onClick={() => {
                      setIntakeMode("direct");
                      setChallanEditorMode(null);
                      setFormNotice({ message: "", type: "info" });
                    }}
                  >
                    Quick Scan (Image)
                  </button>
                </div>

                {intakeMode === "direct" ? (
                  <div className="challan-meta-card">
                    <div style={{ fontWeight: 600, color: "var(--ink)" }}>
                      Direct Image-Only Scan
                    </div>
                    <p style={{ margin: 0, color: "var(--ink-2)", lineHeight: 1.45 }}>
                      Upload any vehicle photo directly without a challan ID. The AI
                      will detect the plate, read OCR text, and search the vehicle
                      registry.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* CHALLAN SELECTOR + ACTION BAR */}
                    <div className="challan-label-row">
                      <label htmlFor="challan-id" style={{ margin: 0 }}>
                        Challan record
                      </label>
                      <div className="challan-mini-actions">
                        <button
                          type="button"
                          className="mini-btn"
                          onClick={() => openCreateChallanForm("")}
                          disabled={apiState !== "online"}
                        >
                          + New
                        </button>
                        {selectedChallanObj && (
                          <button
                            type="button"
                            className="mini-btn"
                            onClick={openEditChallanForm}
                            disabled={apiState !== "online"}
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    </div>

                    <select
                      id="challan-id"
                      value={selectedChallanId}
                      onChange={(e) => {
                        setSelectedChallanId(e.target.value);
                        setChallanEditorMode(null);
                      }}
                      required
                    >
                      {apiState === "checking" && (
                        <option value="">Loading challans…</option>
                      )}
                      {apiState === "offline" && (
                        <option value="">Could not load challans</option>
                      )}
                      {apiState === "online" && (
                        <>
                          <option value="" disabled>
                            Select a challan
                          </option>
                          {challans.map((challan) => (
                            <option
                              key={challan.challan_id}
                              value={challan.challan_id}
                            >
                              {challan.challan_id} · {challan.registration_no} ·{" "}
                              {challan.violation_type}
                            </option>
                          ))}
                        </>
                      )}
                    </select>

                    {/* SELECTED CHALLAN METADATA PREVIEW */}
                    {selectedChallanObj && !challanEditorMode && (
                      <div className="challan-meta-card">
                        <div className="meta-row">
                          <span>Expected Plate</span>
                          <code className="plate-chip">
                            {selectedChallanObj.registration_no}
                          </code>
                        </div>
                        <div className="meta-row">
                          <span>Act / Section</span>
                          <b>{selectedChallanObj.offense_section}</b>
                        </div>
                        <div className="meta-row">
                          <span>Penalty</span>
                          <b>₹ {selectedChallanObj.fine_amount}</b>
                        </div>
                        <div className="meta-row">
                          <span>Location</span>
                          <span>{selectedChallanObj.location}</span>
                        </div>
                      </div>
                    )}

                    {/* INLINE CREATE / EDIT CHALLAN FORM */}
                    {challanEditorMode && (
                      <form
                        className="challan-editor-box"
                        onSubmit={handleSaveChallanRecord}
                      >
                        <div className="editor-title">
                          {challanEditorMode === "edit"
                            ? `Edit ${selectedChallanObj?.challan_id}`
                            : "Create New Challan Record"}
                        </div>

                        <label htmlFor="editor-reg">
                          Registration Number (from plate or registry)
                        </label>
                        <input
                          id="editor-reg"
                          type="text"
                          list="registry-plates-list"
                          value={editorRegNo}
                          onChange={(e) =>
                            setEditorRegNo(e.target.value.toUpperCase())
                          }
                          placeholder="e.g. MH12TK4872 or MH02AG4657"
                          required
                        />
                        <datalist id="registry-plates-list">
                          {registryVehicles.map((v) => (
                            <option
                              key={v.registration_no}
                              value={v.registration_no}
                            >
                              {v.manufacturer} {v.model} ({v.registered_type})
                            </option>
                          ))}
                        </datalist>

                        <label htmlFor="editor-rule-preset">
                          Quick-Fill Offence from MVA / CMVR Schedule
                        </label>
                        <select
                          id="editor-rule-preset"
                          defaultValue=""
                          onChange={(e) => handleSelectRulePreset(e.target.value)}
                        >
                          <option value="">
                            -- Choose an MVA/CMVR rule (optional) --
                          </option>
                          {TRAFFIC_ACTS.slice(0, 125).map((act) => (
                            <option key={act.srNo} value={act.srNo}>
                              #{act.srNo} · {act.section} · {act.english} (₹
                              {act.fine})
                            </option>
                          ))}
                        </select>

                        <label htmlFor="editor-violation">
                          Violation Description
                        </label>
                        <input
                          id="editor-violation"
                          type="text"
                          value={editorViolation}
                          onChange={(e) => setEditorViolation(e.target.value)}
                          required
                        />

                        <div className="two-col" style={{ gap: "8px" }}>
                          <div>
                            <label htmlFor="editor-section">Section</label>
                            <input
                              id="editor-section"
                              type="text"
                              value={editorSection}
                              onChange={(e) => setEditorSection(e.target.value)}
                            />
                          </div>
                          <div>
                            <label htmlFor="editor-fine">Fine (₹)</label>
                            <input
                              id="editor-fine"
                              type="text"
                              value={editorFine}
                              onChange={(e) => setEditorFine(e.target.value)}
                            />
                          </div>
                        </div>

                        <label htmlFor="editor-location">Location</label>
                        <input
                          id="editor-location"
                          type="text"
                          value={editorLocation}
                          onChange={(e) => setEditorLocation(e.target.value)}
                        />

                        <div className="editor-actions">
                          <button
                            type="submit"
                            className="button button-primary btn-sm"
                            disabled={isSavingChallan}
                          >
                            {isSavingChallan ? "Saving…" : "Save Challan"}
                          </button>
                          <button
                            type="button"
                            className="button button-secondary btn-sm"
                            onClick={() => setChallanEditorMode(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    )}
                  </>
                )}

                {/* EVIDENCE UPLOAD & ANALYZE FORM */}
                <form onSubmit={handleAnalyzeSubmit}>
                  <label htmlFor="evidence-file">Traffic evidence image</label>
                  <label
                    className={`dropzone ${selectedFile ? "has-file" : ""} ${
                      isDragging ? "drag" : ""
                    }`}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                  >
                    {dzPreviewUrl && (
                      <img
                        src={dzPreviewUrl}
                        className="dz-preview"
                        alt="Selected evidence preview"
                      />
                    )}
                    <svg
                      className="dz-icon"
                      width="26"
                      height="26"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M12 16V4m0 0L7 9m5-5l5 5" />
                      <path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" />
                    </svg>
                    <strong>
                      {selectedFile ? selectedFile.name : "Drop an image or browse"}
                    </strong>
                    <small>
                      {selectedFile
                        ? `${(selectedFile.size / 1024 / 1024).toFixed(
                            2
                          )} MB · click to replace`
                        : "JPG, PNG or WEBP · up to 10 MB"}
                    </small>
                    <input
                      ref={fileInputRef}
                      id="evidence-file"
                      type="file"
                      accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                      onChange={handleFileChange}
                      required
                    />
                  </label>
                  <p className="helper">Use images you have permission to process.</p>

                  <button
                    className={`button button-primary ${
                      isAnalyzing ? "is-loading" : ""
                    }`}
                    type="submit"
                    disabled={isAnalyzing}
                  >
                    {isAnalyzing
                      ? "Analyzing…"
                      : intakeMode === "direct"
                      ? "Scan image directly"
                      : "Analyze evidence"}
                  </button>

                  {formNotice.message && (
                    <div
                      className={`notice show ${formNotice.type}`}
                      role="status"
                      aria-live="polite"
                    >
                      {formNotice.message}
                    </div>
                  )}
                </form>
              </div>
            </aside>

            {/* RIGHT CASE FILE PANEL */}
            <section
              ref={resultPanelRef}
              className={`panel result-panel ${isAnalyzing ? "loading" : ""}`}
              aria-labelledby="result-heading"
            >
              <div className="panel-head">
                <h2 id="result-heading">
                  {isDirectScan ? "Direct image scan result" : "Case file"}
                </h2>
                <p className="panel-description">
                  {isDirectScan
                    ? "License plate OCR and vehicle registry lookup without a prior challan."
                    : "Three independent AI checks: Challan Plate, Vehicle Registry, and Vehicle Type."}
                </p>
              </div>

              {!currentAnalysis ? (
                <div className="empty-state">
                  <svg
                    width="34"
                    height="34"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M6 3h9l4 4v14H6z" />
                    <path d="M14 3v5h5M9 13h7M9 17h7" />
                  </svg>
                  <strong>No case loaded</strong>
                  <p>
                    Pick a challan (or switch to Quick Scan) and upload an image to
                    view AI analysis.
                  </p>
                </div>
              ) : (
                <div className="result-content" aria-live="polite">
                  <div className="casefile-id">
                    <span>
                      {isDirectScan
                        ? `Direct Scan · ${currentAnalysis.filename ?? "Uploaded image"}`
                        : `Challan · ${currentAnalysis.challan?.offense_section ?? ""} ${
                            currentAnalysis.challan?.fine_amount
                              ? `(₹ ${currentAnalysis.challan.fine_amount})`
                              : ""
                          }`}
                    </span>
                    <b>
                      {isDirectScan
                        ? topDetectedPlate || "NO PLATE"
                        : currentAnalysis.challan_id ?? "—"}
                    </b>
                  </div>

                  {/* ONE-CLICK ACTION FOR DIRECT SCAN */}
                  {isDirectScan && topDetectedPlate && (
                    <div
                      className="challan-meta-card"
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: "10px",
                      }}
                    >
                      <span>
                        Detected plate <b>{topDetectedPlate}</b> — want to log a
                        challan for this vehicle?
                      </span>
                      <button
                        type="button"
                        className="button button-primary btn-sm"
                        style={{ width: "auto" }}
                        onClick={() => openCreateChallanForm(topDetectedPlate)}
                      >
                        + Create Challan for {topDetectedPlate}
                      </button>
                    </div>
                  )}

                  {/* INDEPENDENT CHECKS TABLE */}
                  <div className="findings">
                    <div className="f-row f-head">
                      <span>Check</span>
                      <span>Reference</span>
                      <span>AI reading</span>
                      <span>Outcome</span>
                    </div>

                    {/* 1. OCR VS CHALLAN REGISTRATION (Only in Challan Mode) */}
                    {!isDirectScan && (
                      <div className="f-row">
                        <div className="f-check">1. Challan Plate</div>
                        <div className="f-cell">
                          <small>Expected on challan</small>
                          <strong className="plate">
                            {currentAnalysis.expected_registration ?? "—"}
                          </strong>
                        </div>
                        <div className="f-cell">
                          <small>Top OCR candidate</small>
                          <strong>
                            {currentAnalysis.ocr_candidates?.[0]?.normalized ??
                              (currentAnalysis.plate_detected
                                ? "Unreadable text"
                                : "No plate detected")}
                          </strong>
                          <span>
                            Plate detection{" "}
                            <b>
                              {hasPlateConfidence
                                ? `${(plateConfidence * 100).toFixed(1)}%`
                                : "Unavailable"}
                            </b>
                          </span>
                          <div className="meter">
                            <i
                              style={{
                                width: hasPlateConfidence
                                  ? getMeterWidth(plateConfidence)
                                  : "0%",
                              }}
                            />
                          </div>
                        </div>
                        <div>
                          <div className={getStatusClass(currentAnalysis.status)}>
                            {formatStatus(currentAnalysis.status ?? "manual_review")}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 2. OCR VS VEHICLE REGISTRY */}
                    <div className="f-row">
                      <div className="f-check">
                        {isDirectScan ? "1. Plate & Registry" : "2. Registry Lookup"}
                      </div>
                      <div className="f-cell">
                        <small>Vehicle Registry</small>
                        <strong>
                          {regVerification?.matched_registration ??
                            "No exact OCR match"}
                        </strong>
                        <p>
                          {regVerification?.matched_vehicle
                            ? `${regVerification.matched_vehicle.manufacturer} ${regVerification.matched_vehicle.model} (${regVerification.matched_vehicle.registered_type})`
                            : "Registry searched"}
                        </p>
                      </div>
                      <div className="f-cell">
                        <small>
                          {isDirectScan
                            ? "Detected OCR & Suggestions"
                            : "Fuzzy suggestions"}
                        </small>
                        <strong>
                          {isDirectScan
                            ? topDetectedPlate || "No plate text"
                            : regVerification?.possible_matches?.length
                            ? `${regVerification.possible_matches.length} close match(es)`
                            : regVerification?.status === "registry_match"
                            ? "Exact match found"
                            : "None >= 75% similarity"}
                        </strong>
                        {isDirectScan && hasPlateConfidence && (
                          <span>
                            Plate confidence:{" "}
                            <b>{(plateConfidence * 100).toFixed(1)}%</b>
                          </span>
                        )}
                        {regVerification?.possible_matches?.length > 0 && (
                          <span>
                            Top suggestion:{" "}
                            <b>
                              {regVerification.possible_matches[0].registration_no} (
                              {(
                                regVerification.possible_matches[0].similarity * 100
                              ).toFixed(0)}
                              %)
                            </b>
                          </span>
                        )}
                      </div>
                      <div>
                        <div
                          className={getStatusClass(
                            regVerification?.status ?? "manual_review"
                          )}
                        >
                          {formatStatus(
                            regVerification?.status ?? "manual_review"
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 3. VEHICLE TYPE VS REGISTRY (Only in Challan Mode) */}
                    {!isDirectScan && (
                      <div className="f-row">
                        <div className="f-check">3. Vehicle Type</div>
                        <div className="f-cell">
                          <small>Registered as</small>
                          <strong>
                            {currentAnalysis.registered_vehicle_type ?? "Unavailable"}
                          </strong>
                          <p>{currentAnalysis.registered_vehicle_category ?? "Unknown"}</p>
                        </div>
                        <div className="f-cell">
                          <small>Detected as</small>
                          <strong>
                            {currentAnalysis.detected_vehicle_type ?? "Not associated"}
                          </strong>
                          <p>{currentAnalysis.detected_vehicle_category ?? "Unknown"}</p>
                          <span>
                            Confidence{" "}
                            <b>
                              {hasVehicleConfidence
                                ? `${(vehicleConfidence * 100).toFixed(1)}%`
                                : "Unavailable"}
                            </b>{" "}
                            · Plate link{" "}
                            <b>
                              {formatStatus(
                                currentAnalysis.plate_vehicle_association
                              )}
                            </b>
                          </span>
                          <div className="meter">
                            <i
                              style={{
                                width: hasVehicleConfidence
                                  ? getMeterWidth(vehicleConfidence)
                                  : "0%",
                              }}
                            />
                          </div>
                        </div>
                        <div>
                          <div
                            className={getStatusClass(
                              currentAnalysis.vehicle_type_status
                            )}
                          >
                            {formatStatus(
                              currentAnalysis.vehicle_type_status ?? "manual_review"
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* EXPLANATIONS */}
                  <div className="block two-col">
                    <div>
                      <h3>Registration &amp; registry explanation</h3>
                      <p className="reason">
                        {currentAnalysis.reason ??
                          "No registration explanation provided."}
                      </p>
                      {!isDirectScan && regVerification?.reason && (
                        <p className="helper" style={{ marginTop: "6px" }}>
                          {regVerification.reason}
                        </p>
                      )}
                    </div>
                    {!isDirectScan && (
                      <div>
                        <h3>Vehicle-type explanation</h3>
                        <p className="reason">
                          {currentAnalysis.vehicle_type_reason ??
                            "Vehicle comparison unavailable."}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* EVIDENCE TABS */}
                  <div className="block">
                    <h3>Evidence</h3>
                    <div className="tabs" role="tablist">
                      {[
                        { key: "annotated", label: "Annotated" },
                        { key: "original", label: "Original" },
                        { key: "plate", label: "Plate crop" },
                      ].map((tab) => (
                        <button
                          key={tab.key}
                          type="button"
                          role="tab"
                          aria-selected={activeTab === tab.key}
                          onClick={() => setActiveTab(tab.key)}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    {activeTab === "annotated" && (
                      <div className="pane active">
                        <div className="legend">
                          <span>
                            <i className="legend-box legend-plate" /> Number plate
                          </span>
                          {!isDirectScan && (
                            <span>
                              <i className="legend-box legend-vehicle" /> Vehicle
                            </span>
                          )}
                          <span>Labels show predicted class and confidence.</span>
                        </div>
                        {currentAnalysis.annotated_preview ? (
                          <img
                            src={currentAnalysis.annotated_preview}
                            className="preview"
                            alt="Evidence with bounding boxes"
                          />
                        ) : (
                          <p className="helper">No annotated preview is available.</p>
                        )}
                      </div>
                    )}

                    {activeTab === "original" && (
                      <div className="pane active">
                        {currentAnalysis.evidence_preview && (
                          <img
                            src={currentAnalysis.evidence_preview}
                            className="preview"
                            alt="Original uploaded traffic evidence"
                          />
                        )}
                      </div>
                    )}

                    {activeTab === "plate" && (
                      <div className="pane active">
                        {currentAnalysis.plate_crop_preview ? (
                          <img
                            src={currentAnalysis.plate_crop_preview}
                            className="preview plate-preview"
                            alt="Cropped detected number plate"
                          />
                        ) : (
                          <p className="helper">
                            No plate crop is available for this image.
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* OCR CANDIDATES & VEHICLE DETECTIONS */}
                  <div className="block two-col">
                    <div>
                      <h3>OCR candidates</h3>
                      <div className="stack-list">
                        {(currentAnalysis.ocr_candidates ?? []).length === 0 ? (
                          <p className="helper">No OCR candidates were recognized.</p>
                        ) : (
                          currentAnalysis.ocr_candidates.map((candidate, idx) => {
                            const score = Number(candidate.confidence);
                            return (
                              <article
                                key={`${candidate.normalized}-${idx}`}
                                className="list-card candidate-row"
                              >
                                <code>
                                  {candidate.normalized ||
                                    candidate.raw_text ||
                                    "Unknown"}
                                </code>
                                <span>
                                  {Number.isFinite(score)
                                    ? `${(score * 100).toFixed(1)}% OCR confidence`
                                    : "Confidence unavailable"}
                                </span>
                              </article>
                            );
                          })
                        )}
                      </div>
                    </div>

                    {!isDirectScan && (
                      <div>
                        <h3>Vehicle detections</h3>
                        <div className="stack-list">
                          {(currentAnalysis.vehicle_detections ?? []).length === 0 ? (
                            <p className="helper">
                              No supported vehicle classes detected.
                            </p>
                          ) : (
                            currentAnalysis.vehicle_detections.map(
                              (vehicle, index) => {
                                const score = Number(vehicle.confidence);
                                return (
                                  <article
                                    key={`${vehicle.vehicle_type}-${index}`}
                                    className="list-card vehicle-row"
                                  >
                                    <strong>
                                      Vehicle {index + 1}: {vehicle.vehicle_type} (
                                      {vehicle.vehicle_category})
                                    </strong>
                                    <span>
                                      {Number.isFinite(score)
                                        ? `${(score * 100).toFixed(
                                            1
                                          )}% detection confidence`
                                        : "Confidence unavailable"}
                                    </span>
                                  </article>
                                );
                              }
                            )
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* VEHICLE REGISTRY DETAILS */}
                  <details className="block" open>
                    <summary>
                      {isDirectScan
                        ? "Matched vehicle registry record"
                        : "Vehicle registry record (Expected Challan Plate)"}
                    </summary>
                    <dl className="ledger">
                      <div>
                        <dt>Registration number</dt>
                        <dd>{registryVehicle?.registration_no ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>Manufacturer</dt>
                        <dd>{registryVehicle?.manufacturer ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>Model</dt>
                        <dd>{registryVehicle?.model ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>Fuel type</dt>
                        <dd>{registryVehicle?.fuel_type ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>Registration date</dt>
                        <dd>{registryVehicle?.registration_date ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>RTO code</dt>
                        <dd>{registryVehicle?.rto_code ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>Record status</dt>
                        <dd>{registryVehicle?.record_status ?? "—"}</dd>
                      </div>
                    </dl>
                    {!registryVehicle && (
                      <p className="helper">
                        No matching vehicle registry record was found.
                      </p>
                    )}
                  </details>

                  {/* REVIEWER DECISION FORM & HISTORY (Only in Challan Audit Mode) */}
                  {!isDirectScan && (
                    <section className="block">
                      <h3>Reviewer decision</h3>
                      <p className="helper" style={{ margin: "0 0 14px" }}>
                        Record separate decisions for registration and vehicle type.
                        They do not change the AI results.
                      </p>

                      <form onSubmit={handleReviewSubmit}>
                        <div className="two-col">
                          <div>
                            <label htmlFor="registration-decision">
                              Registration
                            </label>
                            <select
                              id="registration-decision"
                              value={registrationDecision}
                              onChange={(e) =>
                                setRegistrationDecision(e.target.value)
                              }
                              required
                            >
                              <option value="">Select registration decision</option>
                              <option value="confirmed_match">
                                Confirmed registration match
                              </option>
                              <option value="mismatch">
                                Registration mismatch identified
                              </option>
                              <option value="needs_review">
                                Needs further review
                              </option>
                            </select>
                          </div>
                          <div>
                            <label htmlFor="vehicle-type-decision">
                              Vehicle type
                            </label>
                            <select
                              id="vehicle-type-decision"
                              value={vehicleTypeDecision}
                              onChange={(e) =>
                                setVehicleTypeDecision(e.target.value)
                              }
                              required
                            >
                              <option value="">Select vehicle-type decision</option>
                              <option value="confirmed_match">
                                Confirmed vehicle-type match
                              </option>
                              <option value="mismatch">
                                Vehicle-type mismatch identified
                              </option>
                              <option value="needs_review">
                                Needs further review
                              </option>
                            </select>
                          </div>
                        </div>

                        <label htmlFor="review-notes">Notes</label>
                        <textarea
                          id="review-notes"
                          maxLength={2000}
                          rows={4}
                          value={reviewNotes}
                          onChange={(e) => setReviewNotes(e.target.value)}
                          placeholder="Explain your independent assessment..."
                        />

                        <button
                          className="button button-primary"
                          type="submit"
                          style={{ width: "auto" }}
                          disabled={isSavingReview}
                        >
                          {isSavingReview ? "Saving…" : "Save reviewer decisions"}
                        </button>

                        {reviewNotice.message && (
                          <div
                            className={`notice show ${reviewNotice.type}`}
                            role="status"
                            aria-live="polite"
                          >
                            {reviewNotice.message}
                          </div>
                        )}
                      </form>

                      <h3 className="history-heading">
                        Previous reviews for this challan
                      </h3>
                      <div className="stack-list">
                        {reviewsStatus === "idle" && (
                          <p className="helper">
                            Analyze a challan to load its review history.
                          </p>
                        )}
                        {reviewsStatus === "loading" && (
                          <p className="helper">Loading review history…</p>
                        )}
                        {reviewsStatus === "error" && (
                          <p className="helper">{reviewsError}</p>
                        )}
                        {reviewsStatus === "loaded" && reviews.length === 0 && (
                          <p className="helper">
                            No reviewer decisions recorded yet.
                          </p>
                        )}
                        {reviewsStatus === "loaded" &&
                          reviews.map((review) => {
                            const date = new Date(review.reviewed_at);
                            return (
                              <article
                                key={review.id}
                                className="list-card history-card"
                              >
                                <strong>
                                  Review #{review.id} ·{" "}
                                  {formatStatus(review.reviewer_decision)}
                                </strong>
                                <p>
                                  Registration decision:{" "}
                                  {formatStatus(
                                    review.registration_decision ||
                                      "legacy review"
                                  )}
                                </p>
                                <p>
                                  Vehicle-type decision:{" "}
                                  {formatStatus(
                                    review.vehicle_type_decision ||
                                      "legacy review"
                                  )}
                                </p>
                                <p>
                                  AI statuses — Registration:{" "}
                                  {formatStatus(review.ai_status)}; Vehicle:{" "}
                                  {formatStatus(
                                    review.vehicle_type_status || "not recorded"
                                  )}
                                </p>
                                <p>{review.notes || "No notes provided."}</p>
                                <small>
                                  {Number.isNaN(date.getTime())
                                    ? review.reviewed_at
                                    : date.toLocaleString()}
                                </small>
                              </article>
                            );
                          })}
                      </div>
                    </section>
                  )}
                </div>
              )}
            </section>
          </div>
        </main>
      )}

      {/* COMPACT PROFESSIONAL FOOTER */}
      <footer className="compact-footer">
        <div className="compact-footer-in">
          <div className="footer-left">
            <strong>eChallan Verify</strong>
            <span>·</span>
            <span>AI-Assisted Traffic Evidence Verification System</span>
          </div>
          <div className="footer-right">
            <span>Dept. of Information Technology, WCE Sangli</span>
            <span>·</span>
            <a
              href="#acts-directory"
              onClick={(e) => {
                if (activeView !== "landing") {
                  e.preventDefault();
                  setActiveView("landing");
                }
              }}
            >
              MVA &amp; CMVR Rules
            </a>
            <span>·</span>
            <a
              href="/act-and-rules.pdf"
              target="_blank"
              rel="noopener noreferrer"
            >
              Act PDF
            </a>
          </div>
        </div>
      </footer>
    </>
  );
}