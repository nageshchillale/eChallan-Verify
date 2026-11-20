
from pathlib import Path
import re

import cv2
import easyocr
import numpy as np
from ultralytics import YOLO

ROOT = Path(__file__).resolve().parents[1]

MODEL_PATH = (
    ROOT / "runs" / "detect" / "runs"
    / "plate_detection" / "cpu_baseline"
    / "weights" / "best.pt"
)
IMAGE_PATH = ROOT / "datasets" / "test" / "my_vehicle.jpg"
OUTPUT_DIR = ROOT / "runs" / "plate_ocr"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

CONFIDENCE_THRESHOLD = 0.25


def normalize_registration(text):
    return re.sub(r"[^A-Z0-9]", "", text.upper())



def prepare_variants(crop):
    """Create OCR variants with tighter margins and larger characters."""
    height, width = crop.shape[:2]

    # Trim a small border while preserving the plate characters.
    # Keep the full crop if it is too small to trim safely.
    if width > 12 and height > 8:
        margin_x = max(1, int(width * 0.02))
        margin_y = max(1, int(height * 0.05))
        crop = crop[
            margin_y:height - margin_y,
            margin_x:width - margin_x
        ]

    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)

    # Upscale for small printed characters.
    enlarged = cv2.resize(
        gray, None, fx=4, fy=4,
        interpolation=cv2.INTER_CUBIC
    )

    # Improve contrast without aggressively binarizing characters.
    clahe = cv2.createCLAHE(
        clipLimit=1.5, tileGridSize=(8, 8)
    )
    enhanced = clahe.apply(enlarged)

    # Gentle sharpening.
    blurred = cv2.GaussianBlur(enhanced, (0, 0), 1.2)
    sharpened = cv2.addWeighted(
        enhanced, 1.3, blurred, -0.3, 0
    )

    return {
        "gray_enlarged": enlarged,
        "contrast_enhanced": enhanced,
        "sharpened": sharpened,
    }


def main():
    if not MODEL_PATH.exists():
        raise FileNotFoundError(f"Model not found: {MODEL_PATH}")
    if not IMAGE_PATH.exists():
        raise FileNotFoundError(f"Image not found: {IMAGE_PATH}")

    print("Loading YOLO model...")
    detector = YOLO(str(MODEL_PATH))

    print("Loading EasyOCR...")
    reader = easyocr.Reader(["en"], gpu=False)

    image = cv2.imread(str(IMAGE_PATH))
    if image is None:
        raise ValueError(f"Cannot read image: {IMAGE_PATH}")

    result = detector.predict(
        source=image,
        imgsz=416,
        conf=CONFIDENCE_THRESHOLD,
        verbose=False,
    )[0]

    if result.boxes is None or len(result.boxes) == 0:
        print("No license plate detected.")
        return

    # Select the highest-confidence plate detection.
    confidences = result.boxes.conf.cpu().tolist()
    best_index = max(
        range(len(confidences)),
        key=lambda i: confidences[i],
    )
    x1, y1, x2, y2 = map(
        int, result.boxes.xyxy[best_index].cpu().tolist()
    )

    height, width = image.shape[:2]
    x1, x2 = max(0, x1), min(width, x2)
    y1, y2 = max(0, y1), min(height, y2)

    if x2 <= x1 or y2 <= y1:
        print("Invalid plate crop.")
        return

    crop = image[y1:y2, x1:x2]
    cv2.imwrite(str(OUTPUT_DIR / "detected_plate.jpg"), crop)

    variants = prepare_variants(crop)
    all_candidates = []

    print("\n--- Plate detection ---")
    print(f"Detection confidence: {confidences[best_index]:.3f}")
    print(f"Crop saved in: {OUTPUT_DIR}")

    for variant_name, processed in variants.items():
        output_path = OUTPUT_DIR / f"{variant_name}.jpg"
        cv2.imwrite(str(output_path), processed)

        # OCR accepts grayscale images as well.
        detections = reader.readtext(
            processed,
            detail=1,
            paragraph=False,
            allowlist="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        )

        print(f"\n--- OCR variant: {variant_name} ---")

        if not detections:
            print("No text recognized.")
            continue

        for _, text, confidence in detections:
            normalized = normalize_registration(text)
            if not normalized:
                continue

            candidate = {
                "variant": variant_name,
                "raw_text": text,
                "normalized": normalized,
                "confidence": float(confidence),
            }
            all_candidates.append(candidate)

            print(
                f"Text={text!r}, normalized={normalized}, "
                f"confidence={confidence:.3f}"
            )

    print("\n--- Candidate summary ---")
    if not all_candidates:
        print("OCR did not recognize any text.")
        return

    # Rank candidates by OCR confidence only.
    # This does not establish that a candidate is correct.
    ranked = sorted(
        all_candidates,
        key=lambda item: item["confidence"],
        reverse=True,
    )

    for candidate in ranked:
        print(
            f"{candidate['normalized']} | "
            f"{candidate['confidence']:.3f} | "
            f"{candidate['variant']}"
        )

    print("\nHighest-confidence OCR candidate:")
    print(ranked[0]["normalized"])
    print(
        "Review the crop and candidate list before accepting "
        "a registration number."
    )


if __name__ == "__main__":
    main()
