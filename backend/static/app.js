let currentAnalysis = null;

const form = document.getElementById("verify-form");
const challanSelect = document.getElementById("challan-id");
const fileInput = document.getElementById("evidence-file");
const submitButton = document.getElementById("submit-button");
const dropzone = document.getElementById("dropzone");
const resultPanel = document.getElementById("result-panel");


// ---------------------------------------------------------
// GENERAL HELPERS
// ---------------------------------------------------------

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value ?? "—";
}

function setNotice(id, message, type = "info") {
  const element = document.getElementById(id);
  element.textContent = message;
  element.className = `notice show ${type}`;
}

function formatStatus(value) {
  return String(value ?? "unknown").replaceAll("_", " ");
}

function setMeter(id, score) {
  const bar = document.getElementById(id);
  if (bar) bar.style.width = Number.isFinite(score)
    ? `${Math.max(0, Math.min(1, score)) * 100}%`
    : "0%";
}

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    let message = data.detail ?? `Request failed (${response.status})`;
    if (Array.isArray(message)) {
      message = message.map(item => item.msg || "Invalid request").join("; ");
    }
    throw new Error(message);
  }
  return data;
}


// ---------------------------------------------------------
// STATUS DISPLAY
// ---------------------------------------------------------

function setStatus(id, value) {
  const element = document.getElementById(id);
  const status = value ?? "manual_review";

  element.textContent = formatStatus(status);
  element.className = "status";

  if (["registration_match", "registry_match", "consistent"].includes(status)) {
    element.classList.add("status-success");
  } else if (["possible_mismatch", "mismatch"].includes(status)) {
    element.classList.add("status-warning");
  } else {
    element.classList.add("status-neutral");
  }
}


// ---------------------------------------------------------
// IMAGE PREVIEWS
// ---------------------------------------------------------

function renderImage(imageId, unavailableId, source) {
  const image = document.getElementById(imageId);
  const unavailable = unavailableId ? document.getElementById(unavailableId) : null;

  if (source) {
    image.src = source;
    image.hidden = false;
    if (unavailable) unavailable.hidden = true;
  } else {
    image.removeAttribute("src");
    image.hidden = true;
    if (unavailable) unavailable.hidden = false;
  }
}


// ---------------------------------------------------------
// UPLOAD DROPZONE (UI only)
// ---------------------------------------------------------

let thumbUrl = null;

function updateDropzone() {
  const file = fileInput.files[0];
  const thumb = document.getElementById("dz-preview");

  if (thumbUrl) URL.revokeObjectURL(thumbUrl);
  thumbUrl = null;

  if (!file) {
    dropzone.classList.remove("has-file");
    setText("dz-title", "Drop an image or browse");
    setText("dz-sub", "JPG, PNG or WEBP · up to 10 MB");
    return;
  }

  thumbUrl = URL.createObjectURL(file);
  thumb.src = thumbUrl;
  dropzone.classList.add("has-file");
  setText("dz-title", file.name);
  setText("dz-sub", `${(file.size / 1024 / 1024).toFixed(2)} MB · click to replace`);
}

fileInput.addEventListener("change", updateDropzone);

["dragenter", "dragover"].forEach(type =>
  dropzone.addEventListener(type, () => dropzone.classList.add("drag"))
);
["dragleave", "drop"].forEach(type =>
  dropzone.addEventListener(type, () => dropzone.classList.remove("drag"))
);


// ---------------------------------------------------------
// LOAD DASHBOARD DATA
// ---------------------------------------------------------

async function loadDashboardData() {
  const dot = document.getElementById("api-dot");

  try {
    const [vehicleResponse, challans] = await Promise.all([
      fetchJSON("/vehicles"),
      fetchJSON("/challans")
    ]);

    // Support both the older bare-array response and the current API object.
    const vehicles = Array.isArray(vehicleResponse)
      ? vehicleResponse
      : (vehicleResponse.vehicles ?? []);

    setText("vehicle-count", vehicleResponse.total_records ?? vehicles.length);
    setText("challan-count", challans.length);
    setText("api-status", "Online");
    dot.className = "stat-dot online";

    challanSelect.replaceChildren();

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select a challan";
    placeholder.disabled = true;
    placeholder.selected = true;
    challanSelect.appendChild(placeholder);

    for (const challan of challans) {
      const option = document.createElement("option");
      option.value = challan.challan_id;
      option.textContent =
        `${challan.challan_id} · ${challan.violation_type} · ${challan.registration_no}`;
      challanSelect.appendChild(option);
    }

  } catch (error) {
    setText("api-status", "Offline");
    dot.className = "stat-dot offline";

    challanSelect.replaceChildren();

    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Could not load challans";
    challanSelect.appendChild(option);

    setNotice("form-notice", `Could not load API data: ${error.message}`, "error");
  }
}


// ---------------------------------------------------------
// OCR CANDIDATES
// ---------------------------------------------------------

function renderCandidates(candidates = []) {
  const list = document.getElementById("ocr-list");
  list.replaceChildren();

  if (!candidates.length) {
    const empty = document.createElement("p");
    empty.className = "helper";
    empty.textContent = "No OCR candidates were recognized.";
    list.appendChild(empty);
    return;
  }

  for (const candidate of candidates) {
    const row = document.createElement("article");
    row.className = "list-card candidate-row";

    const value = document.createElement("code");
    value.textContent = candidate.normalized || candidate.raw_text || "Unknown";

    const confidence = document.createElement("span");
    const score = Number(candidate.confidence);

    confidence.textContent = Number.isFinite(score)
      ? `${(score * 100).toFixed(1)}% OCR confidence`
      : "Confidence unavailable";

    row.append(value, confidence);
    list.appendChild(row);
  }
}


// ---------------------------------------------------------
// VEHICLE DETECTIONS
// ---------------------------------------------------------

function renderVehicleDetections(detections = []) {
  const list = document.getElementById("vehicle-detection-list");
  list.replaceChildren();

  if (!detections.length) {
    const empty = document.createElement("p");
    empty.className = "helper";
    empty.textContent = "No supported vehicle classes detected.";
    list.appendChild(empty);
    return;
  }

  detections.forEach((vehicle, index) => {
    const row = document.createElement("article");
    row.className = "list-card vehicle-row";

    const name = document.createElement("strong");
    name.textContent =
      `Vehicle ${index + 1}: ${vehicle.vehicle_type} (${vehicle.vehicle_category})`;

    const confidence = document.createElement("span");
    const score = Number(vehicle.confidence);

    confidence.textContent = Number.isFinite(score)
      ? `${(score * 100).toFixed(1)}% detection confidence`
      : "Confidence unavailable";

    row.append(name, confidence);
    list.appendChild(row);
  });
}


// ---------------------------------------------------------
// SYNTHETIC REGISTRY DETAILS
// ---------------------------------------------------------

function renderRegistryDetails(data) {
  const vehicle = data.expected_vehicle ?? data.registered_vehicle ?? null;
  const source = data.registry_source ?? "Synthetic Registry";

  setText("registry-source", source);
  setText("registry-registration", vehicle?.registration_no);
  setText("registry-manufacturer", vehicle?.manufacturer);
  setText("registry-model", vehicle?.model);
  setText("registry-fuel", vehicle?.fuel_type);
  setText("registry-date", vehicle?.registration_date);
  setText("registry-rto", vehicle?.rto_code);
  setText("registry-status", vehicle?.record_status);
  setText("registry-data-source", vehicle?.data_source);

  const notFound = document.getElementById("registry-not-found");
  if (notFound) notFound.hidden = Boolean(vehicle);
}


// ---------------------------------------------------------
// RENDER COMPLETE VERIFICATION RESULT
// ---------------------------------------------------------

function renderResult(data) {
  currentAnalysis = data;

  document.getElementById("empty-result").hidden = true;
  document.getElementById("result-content").hidden = false;

  // Registration verification.
  setStatus("result-status", data.status ?? "manual_review");
  setText("result-challan", data.challan_id);
  setText("result-expected", data.expected_registration);
  setText("result-detected", data.plate_detected ? "Yes" : "No");

  const plateConfidence = Number(data.detection_confidence);

  setText(
    "result-confidence",
    Number.isFinite(plateConfidence)
      ? `${(plateConfidence * 100).toFixed(1)}%`
      : "Unavailable"
  );
  setMeter("plate-meter", plateConfidence);

  // Images.
  renderImage("annotated-preview", "annotated-unavailable", data.annotated_preview);
  renderImage("evidence-preview", null, data.evidence_preview);
  renderImage("plate-preview", "plate-unavailable", data.plate_crop_preview);

  // OCR.
  renderCandidates(data.ocr_candidates ?? []);

  // Vehicle information.
  setText("detected-vehicle-type", data.detected_vehicle_type ?? "Not associated");
  setText("registered-vehicle-type", data.registered_vehicle_type ?? "Unavailable");
  setText("detected-vehicle-category", data.detected_vehicle_category ?? "Unknown");
  setText("registered-vehicle-category", data.registered_vehicle_category ?? "Unknown");

  const vehicleConfidence = Number(data.vehicle_detection_confidence);
  const hasVehicleConfidence =
    data.vehicle_detection_confidence !== null &&
    data.vehicle_detection_confidence !== undefined &&
    Number.isFinite(vehicleConfidence);

  setText(
    "vehicle-confidence",
    hasVehicleConfidence ? `${(vehicleConfidence * 100).toFixed(1)}%` : "Unavailable"
  );
  setMeter("vehicle-meter", hasVehicleConfidence ? vehicleConfidence : NaN);

  setText("plate-vehicle-association", formatStatus(data.plate_vehicle_association));
  setStatus("vehicle-type-status", data.vehicle_type_status ?? "manual_review");
  setText("vehicle-type-reason", data.vehicle_type_reason ?? "Vehicle comparison unavailable.");

  renderVehicleDetections(data.vehicle_detections ?? []);

  // Synthetic registry metadata for the challan's expected registration.
  renderRegistryDetails(data);

  // Registration explanation.
  setText("result-reason", data.reason ?? "No registration explanation provided.");

  // Reset reviewer form for new analysis.
  document.getElementById("registration-decision").value = "";
  document.getElementById("vehicle-type-decision").value = "";
  document.getElementById("review-notes").value = "";
  document.getElementById("review-notice").className = "notice";

  // Load reviewer history.
  loadReviewHistory(data.challan_id);

  // On stacked (mobile) layouts, bring the result into view.
  if (window.matchMedia("(max-width: 980px)").matches) {
    resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}


// ---------------------------------------------------------
// ANALYZE EVIDENCE FORM
// ---------------------------------------------------------

form.addEventListener("submit", async event => {
  event.preventDefault();

  const challanId = challanSelect.value;
  const file = fileInput.files[0];

  if (!challanId) {
    setNotice("form-notice", "Select a challan before continuing.", "error");
    return;
  }

  if (!file) {
    setNotice("form-notice", "Choose an evidence image first.", "error");
    return;
  }

  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  const allowedExtensions = /\.(jpe?g|png|webp)$/i;

  if (
    (file.type && !allowedTypes.includes(file.type)) ||
    !allowedExtensions.test(file.name)
  ) {
    setNotice("form-notice", "Use a JPG, PNG, or WEBP image.", "error");
    return;
  }

  if (file.size > 10 * 1024 * 1024) {
    setNotice("form-notice", "The image must be no larger than 10 MB.", "error");
    return;
  }

  const body = new FormData();
  body.append("file", file);

  submitButton.disabled = true;
  submitButton.classList.add("is-loading");
  submitButton.textContent = "Analyzing…";
  resultPanel.classList.add("loading");

  currentAnalysis = null;

  setNotice("form-notice", "Detecting the plate and vehicle type...");

  try {
    const result = await fetchJSON(
      `/challans/${encodeURIComponent(challanId)}/verify-evidence`,
      { method: "POST", body }
    );

    renderResult(result);

    setNotice(
      "form-notice",
      "Analysis complete. Review both results before recording decisions.",
      "success"
    );

  } catch (error) {
    setNotice("form-notice", `Analysis failed: ${error.message}`, "error");

  } finally {
    submitButton.disabled = false;
    submitButton.classList.remove("is-loading");
    submitButton.textContent = "Analyze evidence";
    resultPanel.classList.remove("loading");
  }
});


// ---------------------------------------------------------
// LOAD REVIEW HISTORY
// ---------------------------------------------------------

async function loadReviewHistory(challanId) {
  const history = document.getElementById("review-history");

  if (!challanId) {
    history.textContent = "Analyze a challan to load its review history.";
    return;
  }

  history.textContent = "Loading review history…";

  try {
    const reviews = await fetchJSON(
      `/reviews?challan_id=${encodeURIComponent(challanId)}`
    );

    history.replaceChildren();

    if (!reviews.length) {
      const empty = document.createElement("p");
      empty.className = "helper";
      empty.textContent = "No reviewer decisions recorded yet.";
      history.appendChild(empty);
      return;
    }

    for (const review of reviews) {
      const card = document.createElement("article");
      card.className = "list-card history-card";

      const heading = document.createElement("strong");
      heading.textContent =
        `Review #${review.id} · ${formatStatus(review.reviewer_decision)}`;

      const registration = document.createElement("p");
      registration.textContent =
        `Registration decision: ${formatStatus(review.registration_decision || "legacy review")}`;

      const vehicle = document.createElement("p");
      vehicle.textContent =
        `Vehicle-type decision: ${formatStatus(review.vehicle_type_decision || "legacy review")}`;

      const ai = document.createElement("p");
      ai.textContent =
        `AI statuses — Registration: ${formatStatus(review.ai_status)}; Vehicle: ${
          formatStatus(review.vehicle_type_status || "not recorded")
        }`;

      const notes = document.createElement("p");
      notes.textContent = review.notes || "No notes provided.";

      const timestamp = document.createElement("small");
      const date = new Date(review.reviewed_at);

      timestamp.textContent = Number.isNaN(date.getTime())
        ? review.reviewed_at
        : date.toLocaleString();

      card.append(heading, registration, vehicle, ai, notes, timestamp);
      history.appendChild(card);
    }

  } catch (error) {
    history.textContent = `Could not load review history: ${error.message}`;
  }
}


// ---------------------------------------------------------
// SAVE TWO INDEPENDENT REVIEWER DECISIONS
// ---------------------------------------------------------

document.getElementById("review-form").addEventListener("submit", async event => {
  event.preventDefault();

  if (!currentAnalysis?.challan_id) {
    setNotice("review-notice", "Analyze a challan before submitting a review.", "error");
    return;
  }

  const registrationDecision = document.getElementById("registration-decision").value;
  const vehicleTypeDecision = document.getElementById("vehicle-type-decision").value;
  const notes = document.getElementById("review-notes").value.trim();

  if (!registrationDecision || !vehicleTypeDecision) {
    setNotice("review-notice", "Please select both reviewer decisions.", "error");
    return;
  }

  const button = document.getElementById("save-review-button");

  button.disabled = true;
  button.textContent = "Saving…";

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
        notes
      })
    });

    setNotice("review-notice", "Both reviewer decisions saved successfully.", "success");
    document.getElementById("review-notes").value = "";

    await loadReviewHistory(currentAnalysis.challan_id);

  } catch (error) {
    setNotice("review-notice", `Could not save review: ${error.message}`, "error");

  } finally {
    button.disabled = false;
    button.textContent = "Save reviewer decisions";
  }
});


// ---------------------------------------------------------
// INITIALIZE DASHBOARD
// ---------------------------------------------------------

loadDashboardData();


// ---------------------------------------------------------
// EVIDENCE TABS (UI only)
// ---------------------------------------------------------

document.querySelectorAll(".tabs [data-tab]").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tabs [data-tab]").forEach(t =>
      t.setAttribute("aria-selected", String(t === tab))
    );
    document.querySelectorAll(".pane").forEach(p =>
      p.classList.toggle("active", p.dataset.pane === tab.dataset.tab)
    );
  });
});