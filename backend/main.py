import sqlite3
import base64
import csv
import difflib
import re

from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Literal

import cv2
import easyocr
import numpy as np

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from ultralytics import YOLO


# ---------------------------------------------------------
# APPLICATION CONFIGURATION
# ---------------------------------------------------------

app = FastAPI(
    title="eChallan Verify API",
    description="AI-assisted traffic evidence verification system",
    version="0.5.0",
)

BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent
DATA_DIR = BASE_DIR / "data"
STATIC_DIR = BASE_DIR / "static"
TEMPLATES_DIR = BASE_DIR / "templates"

DATABASE_PATH = DATA_DIR / "reviews.db"

PLATE_MODEL_PATH = (
    PROJECT_DIR
    / "runs"
    / "detect"
    / "runs"
    / "plate_detection"
    / "cpu_baseline"
    / "weights"
    / "best.pt"
)

VEHICLE_MODEL_NAME = "yolo11n.pt"

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_IMAGE_SIZE = 10 * 1024 * 1024

CHALLAN_CSV_FIELDS = [
    "challan_id",
    "registration_no",
    "violation_type",
    "offense_section",
    "fine_amount",
    "location",
    "evidence_file",
]

VEHICLE_CLASS_MAPPING = {
    2: ("car", "four_wheeler"),
    3: ("motorcycle", "two_wheeler"),
    5: ("bus", "bus"),
    7: ("truck", "truck"),
}


# ---------------------------------------------------------
# REQUEST MODELS
# ---------------------------------------------------------

class ChallanUpsertRequest(BaseModel):
    challan_id: str | None = Field(default=None, max_length=32)
    registration_no: str = Field(..., min_length=4, max_length=20)
    violation_type: str = Field(..., min_length=2, max_length=200)
    offense_section: str = Field(default="Sec 177 MVA", max_length=100)
    fine_amount: str = Field(default="500", max_length=50)
    location: str = Field(default="Maharashtra", max_length=120)
    evidence_file: str = Field(default="uploaded_evidence.jpg", max_length=120)


class ReviewRequest(BaseModel):
    challan_id: str
    ai_status: str
    vehicle_type_status: str

    registration_decision: Literal[
        "confirmed_match",
        "mismatch",
        "needs_review",
    ]

    vehicle_type_decision: Literal[
        "confirmed_match",
        "mismatch",
        "needs_review",
    ]

    notes: str = Field(default="", max_length=2000)


# ---------------------------------------------------------
# DATABASE
# ---------------------------------------------------------

def initialize_review_database():
    """Create the review table and safely migrate existing databases."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(DATABASE_PATH) as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS evidence_reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                challan_id TEXT NOT NULL,
                ai_status TEXT NOT NULL,
                reviewer_decision TEXT NOT NULL,
                notes TEXT NOT NULL DEFAULT '',
                reviewed_at TEXT NOT NULL
            )
        """)

        columns = {
            row[1]
            for row in connection.execute(
                "PRAGMA table_info(evidence_reviews)"
            ).fetchall()
        }

        migrations = {
            "registration_decision": "TEXT",
            "vehicle_type_decision": "TEXT",
            "vehicle_type_status": "TEXT",
        }

        for column_name, column_type in migrations.items():
            if column_name not in columns:
                connection.execute(
                    f"ALTER TABLE evidence_reviews "
                    f"ADD COLUMN {column_name} {column_type}"
                )


def save_review(review: ReviewRequest) -> dict:
    reviewed_at = datetime.now(timezone.utc).isoformat()

    if (
        review.registration_decision == "mismatch"
        or review.vehicle_type_decision == "mismatch"
    ):
        overall_decision = "mismatch"
    elif (
        review.registration_decision == "confirmed_match"
        and review.vehicle_type_decision == "confirmed_match"
    ):
        overall_decision = "confirmed_match"
    else:
        overall_decision = "needs_review"

    with sqlite3.connect(DATABASE_PATH) as connection:
        cursor = connection.execute(
            """
            INSERT INTO evidence_reviews (
                challan_id,
                ai_status,
                reviewer_decision,
                notes,
                reviewed_at,
                registration_decision,
                vehicle_type_decision,
                vehicle_type_status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                review.challan_id,
                review.ai_status,
                overall_decision,
                review.notes.strip(),
                reviewed_at,
                review.registration_decision,
                review.vehicle_type_decision,
                review.vehicle_type_status,
            ),
        )

        review_id = cursor.lastrowid

    return {
        "id": review_id,
        "challan_id": review.challan_id,
        "ai_status": review.ai_status,
        "vehicle_type_status": review.vehicle_type_status,
        "registration_decision": review.registration_decision,
        "vehicle_type_decision": review.vehicle_type_decision,
        "reviewer_decision": overall_decision,
        "notes": review.notes.strip(),
        "reviewed_at": reviewed_at,
    }


initialize_review_database()

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


# ---------------------------------------------------------
# DASHBOARD AND DATA HELPERS
# ---------------------------------------------------------

@app.get("/dashboard", include_in_schema=False)
def dashboard():
    return FileResponse(TEMPLATES_DIR / "index.html")


def read_csv(filename: str) -> list[dict]:
    file_path = DATA_DIR / filename

    if not file_path.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Dataset file not found: {filename}",
        )

    with file_path.open("r", encoding="utf-8-sig", newline="") as file:
        return list(csv.DictReader(file))


def format_challan_row(row: dict) -> dict:
    """Ensure consistent challan fields even if legacy CSV rows omit optional columns."""
    challan_id = (row.get("challan_id") or "").strip()
    return {
        "challan_id": challan_id,
        "registration_no": normalize_registration(row.get("registration_no", "")),
        "violation_type": (row.get("violation_type") or "").strip(),
        "offense_section": (row.get("offense_section") or "Sec 177 MVA").strip(),
        "fine_amount": (row.get("fine_amount") or "500").strip(),
        "location": (row.get("location") or "Maharashtra").strip(),
        "evidence_file": (
            row.get("evidence_file") or f"{challan_id.lower()}.jpg"
        ).strip(),
    }


def write_challans_csv(challans: list[dict]) -> None:
    file_path = DATA_DIR / "challans.csv"
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    with file_path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=CHALLAN_CSV_FIELDS)
        writer.writeheader()
        for item in challans:
            writer.writerow(format_challan_row(item))


def next_challan_id(challans: list[dict]) -> str:
    max_num = 0
    for item in challans:
        match = re.fullmatch(r"CH(\d+)", (item.get("challan_id") or "").strip().upper())
        if match:
            max_num = max(max_num, int(match.group(1)))
    return f"CH{max_num + 1:03d}"


def normalize_registration(text: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (text or "").upper())


def get_registry_vehicle(registration_no: str) -> dict | None:
    """Return a synthetic registry row for a normalized registration."""
    target = normalize_registration(registration_no)

    if not target:
        return None

    for vehicle in read_csv("vehicles.csv"):
        if normalize_registration(
            vehicle.get("registration_no", "")
        ) == target:
            return vehicle

    return None


# ---------------------------------------------------------
# MODEL LOADERS
# ---------------------------------------------------------

@lru_cache(maxsize=1)
def get_detector():
    if not PLATE_MODEL_PATH.exists():
        raise RuntimeError(
            f"Plate detection model not found: {PLATE_MODEL_PATH}"
        )

    return YOLO(str(PLATE_MODEL_PATH))


@lru_cache(maxsize=1)
def get_vehicle_detector():
    return YOLO(VEHICLE_MODEL_NAME)


@lru_cache(maxsize=1)
def get_ocr_reader():
    return easyocr.Reader(["en"], gpu=False)


# ---------------------------------------------------------
# OCR
# ---------------------------------------------------------

def get_ocr_candidates(plate_crop):
    gray = cv2.cvtColor(plate_crop, cv2.COLOR_BGR2GRAY)

    enlarged = cv2.resize(
        gray,
        None,
        fx=4,
        fy=4,
        interpolation=cv2.INTER_CUBIC,
    )

    clahe = cv2.createCLAHE(
        clipLimit=1.5,
        tileGridSize=(8, 8),
    )

    enhanced = clahe.apply(enlarged)

    variants = {
        "gray_enlarged": enlarged,
        "contrast_enhanced": enhanced,
    }

    reader = get_ocr_reader()
    candidates = []

    for variant_name, variant_image in variants.items():
        detections = reader.readtext(
            variant_image,
            detail=1,
            paragraph=False,
            allowlist="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        )

        for _, text, confidence in detections:
            normalized = normalize_registration(text)

            if len(normalized) < 4:
                continue

            candidates.append({
                "raw_text": text,
                "normalized": normalized,
                "confidence": round(float(confidence), 4),
                "variant": variant_name,
            })

    best_by_text = {}

    for candidate in candidates:
        key = candidate["normalized"]

        if (
            key not in best_by_text
            or candidate["confidence"]
            > best_by_text[key]["confidence"]
        ):
            best_by_text[key] = candidate

    return sorted(
        best_by_text.values(),
        key=lambda item: item["confidence"],
        reverse=True,
    )


# ---------------------------------------------------------
# IMAGE HELPERS
# ---------------------------------------------------------

def encode_image(image, extension=".jpg") -> str:
    success, buffer = cv2.imencode(extension, image)

    if not success:
        raise HTTPException(
            status_code=500,
            detail="Failed to encode image preview.",
        )

    encoded = base64.b64encode(
        buffer.tobytes()
    ).decode("ascii")

    return f"data:image/jpeg;base64,{encoded}"


def draw_plate_box(image, box, confidence):
    annotated = image.copy()
    x1, y1, x2, y2 = box

    green = (0, 220, 100)

    cv2.rectangle(
        annotated,
        (x1, y1),
        (x2, y2),
        green,
        3,
    )

    cv2.putText(
        annotated,
        f"Plate {confidence:.2f}",
        (x1, max(y1 - 10, 25)),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        green,
        2,
        cv2.LINE_AA,
    )

    return annotated


def draw_combined_annotations(image, plate_detection, vehicles):
    """Draw vehicle boxes in cyan and the plate box in green."""
    annotated = image.copy()
    image_height, image_width = annotated.shape[:2]

    for vehicle in vehicles or []:
        x1, y1, x2, y2 = map(
            int,
            vehicle["bounding_box"],
        )

        x1 = max(0, min(x1, image_width - 1))
        y1 = max(0, min(y1, image_height - 1))
        x2 = max(x1 + 1, min(x2, image_width - 1))
        y2 = max(y1 + 1, min(y2, image_height - 1))

        cyan = (255, 255, 0)

        cv2.rectangle(
            annotated,
            (x1, y1),
            (x2, y2),
            cyan,
            4,
        )

        label = (
            f"{vehicle['vehicle_type'].upper()} "
            f"{float(vehicle['confidence']) * 100:.1f}%"
        )

        font = cv2.FONT_HERSHEY_SIMPLEX
        scale = 0.60
        thickness = 2

        (text_width, text_height), baseline = cv2.getTextSize(
            label, font, scale, thickness
        )

        label_top = max(0, y1 - text_height - baseline - 10)
        label_right = min(image_width - 1, x1 + text_width + 12)
        label_bottom = min(
            image_height - 1,
            label_top + text_height + baseline + 10,
        )

        cv2.rectangle(
            annotated,
            (x1, label_top),
            (label_right, label_bottom),
            cyan,
            -1,
        )

        cv2.putText(
            annotated,
            label,
            (x1 + 5, min(label_bottom - baseline - 3, image_height - 1)),
            font,
            scale,
            (0, 0, 0),
            thickness,
            cv2.LINE_AA,
        )

    if plate_detection is not None:
        x1, y1, x2, y2 = map(int, plate_detection["box"])

        x1 = max(0, min(x1, image_width - 1))
        y1 = max(0, min(y1, image_height - 1))
        x2 = max(x1 + 1, min(x2, image_width - 1))
        y2 = max(y1 + 1, min(y2, image_height - 1))

        green = (0, 255, 0)

        cv2.rectangle(
            annotated,
            (x1, y1),
            (x2, y2),
            green,
            4,
        )

        label = (
            f"NUMBER PLATE "
            f"{float(plate_detection['confidence']) * 100:.1f}%"
        )

        label_y = min(y2 + 25, image_height - 8)

        cv2.putText(
            annotated,
            label,
            (x1, label_y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.60,
            green,
            2,
            cv2.LINE_AA,
        )

    return annotated


def decode_uploaded_image(file_bytes: bytes):
    image_array = np.frombuffer(file_bytes, dtype=np.uint8)
    image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)

    if image is None:
        raise HTTPException(
            status_code=400,
            detail="Could not decode the uploaded image.",
        )

    return image


async def read_uploaded_image(file: UploadFile):
    extension = Path(file.filename or "").suffix.lower()

    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Upload a JPG, JPEG, PNG, or WEBP image.",
        )

    image_bytes = await file.read(MAX_IMAGE_SIZE + 1)

    if not image_bytes:
        raise HTTPException(
            status_code=400,
            detail="Uploaded image is empty.",
        )

    if len(image_bytes) > MAX_IMAGE_SIZE:
        raise HTTPException(
            status_code=413,
            detail="Image exceeds the 10 MB upload limit.",
        )

    return decode_uploaded_image(image_bytes)


# ---------------------------------------------------------
# NUMBER PLATE DETECTION
# ---------------------------------------------------------

def detect_plate(image):
    try:
        detector = get_detector()

        result = detector.predict(
            source=image,
            imgsz=416,
            conf=0.25,
            verbose=False,
        )[0]

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Plate detection failed: {type(exc).__name__}",
        ) from exc

    if result.boxes is None or len(result.boxes) == 0:
        return None

    confidences = result.boxes.conf.cpu().tolist()

    best_index = max(
        range(len(confidences)),
        key=lambda i: confidences[i],
    )

    x1, y1, x2, y2 = map(
        int,
        result.boxes.xyxy[best_index].cpu().tolist(),
    )

    height, width = image.shape[:2]

    x1 = max(0, min(x1, width - 1))
    y1 = max(0, min(y1, height - 1))
    x2 = max(x1 + 1, min(x2, width))
    y2 = max(y1 + 1, min(y2, height))

    crop = image[y1:y2, x1:x2]

    if crop.size == 0:
        raise HTTPException(
            status_code=500,
            detail="The detected plate crop was empty.",
        )

    confidence = float(confidences[best_index])
    box = (x1, y1, x2, y2)

    return {
        "box": box,
        "crop": crop,
        "confidence": confidence,
        "annotated": draw_plate_box(image, box, confidence),
    }


# ---------------------------------------------------------
# VEHICLE TYPE DETECTION
# ---------------------------------------------------------

def detect_vehicles(image):
    try:
        model = get_vehicle_detector()

        result = model.predict(
            source=image,
            conf=0.25,
            verbose=False,
        )[0]

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Vehicle detection failed: {type(exc).__name__}",
        ) from exc

    detections = []

    if result.boxes is None:
        return detections

    height, width = image.shape[:2]

    for box in result.boxes:
        class_id = int(box.cls[0].item())

        if class_id not in VEHICLE_CLASS_MAPPING:
            continue

        vehicle_type, category = VEHICLE_CLASS_MAPPING[class_id]
        confidence = float(box.conf[0].item())

        x1, y1, x2, y2 = map(
            int,
            box.xyxy[0].tolist(),
        )

        x1 = max(0, min(x1, width - 1))
        y1 = max(0, min(y1, height - 1))
        x2 = max(x1 + 1, min(x2, width))
        y2 = max(y1 + 1, min(y2, height))

        detections.append({
            "vehicle_type": vehicle_type,
            "vehicle_category": category,
            "confidence": round(confidence, 4),
            "bounding_box": [x1, y1, x2, y2],
        })

    return detections


# ---------------------------------------------------------
# PLATE-TO-VEHICLE ASSOCIATION
# ---------------------------------------------------------

def associate_plate_with_vehicle(plate_box, vehicles):
    if not plate_box or not vehicles:
        return None, "no_vehicle_association"

    px1, py1, px2, py2 = plate_box

    plate_center_x = (px1 + px2) / 2
    plate_center_y = (py1 + py2) / 2

    containing_vehicles = []

    for vehicle in vehicles:
        x1, y1, x2, y2 = vehicle["bounding_box"]

        if (
            x1 <= plate_center_x <= x2
            and y1 <= plate_center_y <= y2
        ):
            containing_vehicles.append(vehicle)

    if len(containing_vehicles) == 1:
        return containing_vehicles[0], "associated"

    if len(containing_vehicles) > 1:
        return None, "ambiguous_vehicle_association"

    return None, "no_vehicle_association"


# ---------------------------------------------------------
# REGISTRY VEHICLE TYPE NORMALIZATION
# ---------------------------------------------------------

def normalize_vehicle_category(registered_type):
    value = re.sub(
        r"[^a-z]",
        "",
        (registered_type or "").lower(),
    )

    mapping = {
        "car": "four_wheeler",
        "fourwheeler": "four_wheeler",
        "motorcycle": "two_wheeler",
        "motorbike": "two_wheeler",
        "bike": "two_wheeler",
        "scooter": "two_wheeler",
        "twowheeler": "two_wheeler",
        "bus": "bus",
        "truck": "truck",
    }

    return mapping.get(value)


def compare_vehicle_types(detected_vehicle, registered_type):
    registered_category = normalize_vehicle_category(
        registered_type or ""
    )

    if detected_vehicle is None:
        return {
            "detected_vehicle_type": None,
            "detected_vehicle_category": None,
            "vehicle_detection_confidence": None,
            "registered_vehicle_type": registered_type or None,
            "registered_vehicle_category": registered_category,
            "vehicle_type_match": None,
            "vehicle_type_status": "manual_review",
            "vehicle_type_reason": (
                "The detected plate could not be reliably associated "
                "with a visible vehicle."
            ),
        }

    detected_category = detected_vehicle["vehicle_category"]
    confidence = detected_vehicle["confidence"]

    if confidence < 0.50:
        status = "manual_review"
        match = None
        reason = "Vehicle classification confidence is too low."

    elif registered_category is None:
        status = "manual_review"
        match = None
        reason = "Registered vehicle type could not be normalized."

    elif detected_category == registered_category:
        status = "consistent"
        match = True
        reason = (
            "Detected and registered vehicle categories are consistent."
        )

    else:
        status = "possible_mismatch"
        match = False
        reason = (
            "Detected vehicle category differs from the registered "
            "vehicle category. Human verification is required."
        )

    return {
        "detected_vehicle_type": detected_vehicle["vehicle_type"],
        "detected_vehicle_category": detected_category,
        "vehicle_detection_confidence": confidence,
        "registered_vehicle_type": registered_type or None,
        "registered_vehicle_category": registered_category,
        "vehicle_type_match": match,
        "vehicle_type_status": status,
        "vehicle_type_reason": reason,
    }


def analyze_vehicle_type(image, plate_detection, challan):
    """Compare detected vehicle class with the synthetic registry record."""
    vehicles = detect_vehicles(image)

    registered_vehicle = get_registry_vehicle(
        challan.get("registration_no", "")
    )

    registered_type = (
        registered_vehicle.get("registered_type", "")
        if registered_vehicle
        else ""
    )

    if plate_detection is None:
        comparison = compare_vehicle_types(None, registered_type)

        return {
            "vehicle_detections": vehicles,
            "plate_vehicle_association": "plate_not_detected",
            "registered_vehicle": registered_vehicle,
            "registry_record_found": registered_vehicle is not None,
            **comparison,
        }

    associated_vehicle, association_status = associate_plate_with_vehicle(
        plate_detection["box"],
        vehicles,
    )

    comparison = compare_vehicle_types(
        associated_vehicle,
        registered_type,
    )

    return {
        "vehicle_detections": vehicles,
        "plate_vehicle_association": association_status,
        "registered_vehicle": registered_vehicle,
        "registry_record_found": registered_vehicle is not None,
        **comparison,
    }


# ---------------------------------------------------------
# REGISTRATION COMPARISON
# ---------------------------------------------------------

def compare_with_registry(candidates):
    """
    Compare OCR candidates with synthetic registry records.

    Fuzzy matches are suggestions only and must never be treated
    as confirmed vehicle identities.
    """
    vehicles = read_csv("vehicles.csv")
    registry = {}

    for vehicle in vehicles:
        registration = normalize_registration(
            vehicle.get("registration_no", "")
        )

        if registration:
            registry[registration] = vehicle

    if not candidates:
        return {
            "status": "manual_review",
            "matched_vehicle": None,
            "matched_registration": None,
            "possible_matches": [],
            "registry_source": "Synthetic Registry",
            "registry_record_count": len(registry),
            "reason": "No readable registration text was detected.",
        }

    # Exact match against any OCR candidate.
    for candidate in candidates:
        registration = normalize_registration(
            candidate.get("normalized", "")
        )

        if registration in registry:
            return {
                "status": "registry_match",
                "matched_vehicle": registry[registration],
                "matched_registration": registration,
                "matched_ocr_confidence": candidate.get("confidence"),
                "possible_matches": [],
                "registry_source": "Synthetic Registry",
                "registry_record_count": len(registry),
                "reason": (
                    "An OCR candidate exactly matches a synthetic registry "
                    "record. This is a prototype data match, not official "
                    "vehicle-registration verification."
                ),
            }

    top_candidate = normalize_registration(
        candidates[0].get("normalized", "")
    )

    possible_matches = []

    for registration, vehicle in registry.items():
        similarity = difflib.SequenceMatcher(
            None,
            top_candidate,
            registration,
        ).ratio()

        if similarity >= 0.75:
            possible_matches.append({
                "registration_no": vehicle["registration_no"],
                "similarity": round(similarity, 3),
                "registered_type": vehicle.get("registered_type"),
                "vehicle_category": vehicle.get("vehicle_category"),
                "manufacturer": vehicle.get("manufacturer"),
                "model": vehicle.get("model"),
                "rto_code": vehicle.get("rto_code"),
                "record_status": vehicle.get("record_status"),
                "review_required": True,
            })

    possible_matches.sort(
        key=lambda item: item["similarity"],
        reverse=True,
    )

    return {
        "status": "manual_review",
        "matched_vehicle": None,
        "matched_registration": None,
        "possible_matches": possible_matches[:5],
        "registry_source": "Synthetic Registry",
        "registry_record_count": len(registry),
        "reason": (
            "No exact registry match was found. Similar registrations are "
            "suggestions for human review, not confirmed identities."
        ),
    }


# ---------------------------------------------------------
# BASIC API ROUTES
# ---------------------------------------------------------

@app.get("/")
def home():
    return {
        "project": "eChallan Verify",
        "message": "Traffic evidence verification API is running",
        "version": "0.5.0",
        "registry_source": "Synthetic Registry",
    }


@app.get("/health")
def health():
    return {"status": "healthy"}


@app.get("/vehicles")
def get_vehicles():
    vehicles = read_csv("vehicles.csv")

    return {
        "total_records": len(vehicles),
        "registry_source": "Synthetic Registry",
        "vehicles": vehicles,
    }


@app.get("/challans")
def get_challans():
    return [format_challan_row(row) for row in read_csv("challans.csv")]


@app.get("/challans/{challan_id}")
def get_challan(challan_id: str):
    for row in read_csv("challans.csv"):
        formatted = format_challan_row(row)
        if formatted["challan_id"] == challan_id:
            return formatted

    raise HTTPException(
        status_code=404,
        detail="Challan record not found",
    )


@app.post("/challans", status_code=201)
def create_challan(payload: ChallanUpsertRequest):
    challans = [format_challan_row(row) for row in read_csv("challans.csv")]

    normalized_reg = normalize_registration(payload.registration_no)
    if len(normalized_reg) < 4:
        raise HTTPException(
            status_code=400,
            detail="Registration number must contain at least 4 alphanumeric characters.",
        )

    challan_id = (payload.challan_id or "").strip().upper() or next_challan_id(challans)
    if any(item["challan_id"] == challan_id for item in challans):
        raise HTTPException(
            status_code=409,
            detail=f"Challan ID {challan_id} already exists.",
        )

    new_record = format_challan_row({
        "challan_id": challan_id,
        "registration_no": normalized_reg,
        "violation_type": payload.violation_type,
        "offense_section": payload.offense_section,
        "fine_amount": payload.fine_amount,
        "location": payload.location,
        "evidence_file": payload.evidence_file or f"{challan_id.lower()}.jpg",
    })

    challans.append(new_record)
    write_challans_csv(challans)
    return new_record


@app.put("/challans/{challan_id}")
def update_challan(challan_id: str, payload: ChallanUpsertRequest):
    challans = [format_challan_row(row) for row in read_csv("challans.csv")]
    target_id = challan_id.strip().upper()

    normalized_reg = normalize_registration(payload.registration_no)
    if len(normalized_reg) < 4:
        raise HTTPException(
            status_code=400,
            detail="Registration number must contain at least 4 alphanumeric characters.",
        )

    updated_record = None
    for index, item in enumerate(challans):
        if item["challan_id"] == target_id:
            updated_record = format_challan_row({
                "challan_id": target_id,
                "registration_no": normalized_reg,
                "violation_type": payload.violation_type,
                "offense_section": payload.offense_section,
                "fine_amount": payload.fine_amount,
                "location": payload.location,
                "evidence_file": payload.evidence_file or item["evidence_file"],
            })
            challans[index] = updated_record
            break

    if updated_record is None:
        raise HTTPException(
            status_code=404,
            detail="Challan record not found",
        )

    write_challans_csv(challans)
    return updated_record


@app.get("/vehicles/{registration_no}/challans")
def get_vehicle_challans(registration_no: str):
    target = normalize_registration(registration_no)
    vehicles = read_csv("vehicles.csv")

    vehicle = next(
        (
            item for item in vehicles
            if normalize_registration(
                item["registration_no"]
            ) == target
        ),
        None,
    )

    if vehicle is None:
        raise HTTPException(
            status_code=404,
            detail="Vehicle registration not found",
        )

    challans = [format_challan_row(row) for row in read_csv("challans.csv")]

    vehicle_challans = [
        challan for challan in challans
        if normalize_registration(
            challan["registration_no"]
        ) == target
    ]

    return {
        **vehicle,
        "registration_no": vehicle["registration_no"],
        "registered_type": vehicle["registered_type"],
        "registry_source": "Synthetic Registry",
        "challan_count": len(vehicle_challans),
        "challans": vehicle_challans,
    }


# ---------------------------------------------------------
# GENERAL EVIDENCE VERIFICATION
# ---------------------------------------------------------

@app.post("/verify-evidence")
async def verify_evidence(file: UploadFile = File(...)):
    image = await read_uploaded_image(file)
    detection = detect_plate(image)

    if detection is None:
        return {
            "filename": file.filename,
            "plate_detected": False,
            "detection_confidence": None,
            "evidence_preview": encode_image(image),
            "annotated_preview": None,
            "plate_crop_preview": None,
            "ocr_candidates": [],
            "registry_source": "Synthetic Registry",
            "verification": {
                "status": "manual_review",
                "matched_vehicle": None,
                "matched_registration": None,
                "possible_matches": [],
                "registry_source": "Synthetic Registry",
                "reason": "No license plate was detected.",
            },
        }

    crop = detection["crop"]

    try:
        candidates = get_ocr_candidates(crop)
        verification = compare_with_registry(candidates)

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=(
                "OCR or registry comparison failed: "
                f"{type(exc).__name__}"
            ),
        ) from exc

    x1, y1, x2, y2 = detection["box"]

    return {
        "filename": file.filename,
        "plate_detected": True,
        "bounding_box": {
            "x1": x1,
            "y1": y1,
            "x2": x2,
            "y2": y2,
        },
        "detection_confidence": round(
            detection["confidence"], 4
        ),
        "evidence_preview": encode_image(image),
        "annotated_preview": encode_image(
            detection["annotated"]
        ),
        "plate_crop_preview": encode_image(crop),
        "ocr_candidates": candidates,
        "verification": verification,
        "registry_source": "Synthetic Registry",
        "disclaimer": (
            "This is an experimental AI-assisted result. Registry matches "
            "and possible mismatches require human review. The registry "
            "contains synthetic records, not official vehicle data."
        ),
    }


# ---------------------------------------------------------
# CHALLAN-SPECIFIC EVIDENCE VERIFICATION
# ---------------------------------------------------------

@app.post("/challans/{challan_id}/verify-evidence")
async def verify_challan_evidence(
    challan_id: str,
    file: UploadFile = File(...),
):
    challans = [format_challan_row(row) for row in read_csv("challans.csv")]

    challan = next(
        (
            item for item in challans
            if item["challan_id"] == challan_id
        ),
        None,
    )

    if challan is None:
        raise HTTPException(
            status_code=404,
            detail="Challan record not found",
        )

    image = await read_uploaded_image(file)
    detection = detect_plate(image)

    # Run vehicle detection independently of plate detection.
    vehicle_analysis = analyze_vehicle_type(
        image,
        detection,
        challan,
    )

    annotated_image = draw_combined_annotations(
        image,
        detection,
        vehicle_analysis["vehicle_detections"],
    )

    expected_vehicle = get_registry_vehicle(
        challan["registration_no"]
    )

    if detection is None:
        registry_verification = compare_with_registry([])
        return {
            "challan_id": challan_id,
            "expected_registration": challan["registration_no"],
            "expected_vehicle": expected_vehicle,
            "registry_source": "Synthetic Registry",
            "status": "manual_review",
            "reason": "No license plate was detected.",
            "plate_detected": False,
            "detection_confidence": None,
            "evidence_preview": encode_image(image),
            "annotated_preview": encode_image(annotated_image),
            "plate_crop_preview": None,
            "bounding_box": None,
            "ocr_candidates": [],
            "registry_verification": registry_verification,
            **vehicle_analysis,
            "challan": challan,
            "disclaimer": (
                "Vehicle detection alone cannot establish which "
                "registration belongs to which vehicle. Registry "
                "information is synthetic test data."
            ),
        }

    crop = detection["crop"]

    try:
        candidates = get_ocr_candidates(crop)
        registry_verification = compare_with_registry(candidates)

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"OCR or registry verification failed: {type(exc).__name__}",
        ) from exc

    expected_registration = normalize_registration(
        challan["registration_no"]
    )

    matching_candidates = [
        candidate for candidate in candidates
        if normalize_registration(
            candidate.get("normalized", "")
        ) == expected_registration
    ]

    if matching_candidates:
        status = "registration_match"
        reason = (
            "An OCR candidate exactly matches the challan registration. "
            "The image and violation still require human review."
        )

    elif candidates and candidates[0]["confidence"] >= 0.70:
        status = "possible_mismatch"
        reason = (
            "OCR produced a relatively confident candidate but none "
            "exactly matches the challan. Human review is required."
        )

    else:
        status = "manual_review"
        reason = (
            "OCR was inconclusive or no candidate exactly matched. "
            "Human review is required."
        )

    x1, y1, x2, y2 = detection["box"]

    return {
        "challan_id": challan_id,
        "expected_registration": challan["registration_no"],
        "expected_vehicle": expected_vehicle,
        "registry_source": "Synthetic Registry",
        "status": status,
        "reason": reason,
        "plate_detected": True,
        "bounding_box": {
            "x1": x1,
            "y1": y1,
            "x2": x2,
            "y2": y2,
        },
        "detection_confidence": round(
            detection["confidence"], 4
        ),
        "evidence_preview": encode_image(image),
        "annotated_preview": encode_image(annotated_image),
        "plate_crop_preview": encode_image(crop),
        "ocr_candidates": candidates,
        "registry_verification": registry_verification,
        **vehicle_analysis,
        "challan": challan,
        "disclaimer": (
            "This result compares OCR text and detected vehicle type "
            "with synthetic challan and registry records. It does not "
            "establish that a violation occurred, that evidence is "
            "authentic, or that a vehicle belongs to a particular person."
        ),
    }


# ---------------------------------------------------------
# REVIEWER DECISIONS
# ---------------------------------------------------------

@app.post("/reviews", status_code=201)
def create_review(review: ReviewRequest):
    challans = [format_challan_row(row) for row in read_csv("challans.csv")]

    challan = next(
        (
            item for item in challans
            if item["challan_id"] == review.challan_id
        ),
        None,
    )

    if challan is None:
        raise HTTPException(
            status_code=404,
            detail="Challan record not found",
        )

    allowed_ai_statuses = {
        "registration_match",
        "possible_mismatch",
        "manual_review",
        "registry_match",
    }

    allowed_vehicle_statuses = {
        "consistent",
        "possible_mismatch",
        "manual_review",
    }

    if review.ai_status not in allowed_ai_statuses:
        raise HTTPException(
            status_code=400,
            detail="Unsupported registration AI status",
        )

    if review.vehicle_type_status not in allowed_vehicle_statuses:
        raise HTTPException(
            status_code=400,
            detail="Unsupported vehicle-type AI status",
        )

    return save_review(review)


@app.get("/reviews")
def get_reviews(challan_id: str | None = None):
    with sqlite3.connect(DATABASE_PATH) as connection:
        connection.row_factory = sqlite3.Row

        query = """
            SELECT
                id,
                challan_id,
                ai_status,
                vehicle_type_status,
                reviewer_decision,
                registration_decision,
                vehicle_type_decision,
                notes,
                reviewed_at
            FROM evidence_reviews
        """

        if challan_id:
            rows = connection.execute(
                query + """
                    WHERE challan_id = ?
                    ORDER BY id DESC
                """,
                (challan_id,),
            ).fetchall()
        else:
            rows = connection.execute(
                query + " ORDER BY id DESC"
            ).fetchall()

    return [dict(row) for row in rows]