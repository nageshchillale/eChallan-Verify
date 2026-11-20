
from pathlib import Path
import random

import cv2
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parent.parent
IMAGE_DIR = ROOT / "datasets/processed/plate_detection/images/train"
LABEL_DIR = ROOT / "datasets/processed/plate_detection/labels/train"
OUTPUT_DIR = ROOT / "reports/sample_annotations"

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

image_paths = [
    p for p in IMAGE_DIR.iterdir()
    if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
]

if not image_paths:
    raise RuntimeError(f"No images found in {IMAGE_DIR}")

random.seed(42)
samples = random.sample(image_paths, min(12, len(image_paths)))

for image_path in samples:
    label_path = LABEL_DIR / f"{image_path.stem}.txt"

    image = cv2.imread(str(image_path))
    if image is None:
        print(f"Could not read image: {image_path}")
        continue

    height, width = image.shape[:2]

    if not label_path.exists():
        print(f"Missing label: {label_path}")
        continue

    for line in label_path.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if len(parts) != 5:
            print(f"Invalid label line: {label_path}: {line}")
            continue

        class_id, xc, yc, bw, bh = map(float, parts)

        x1 = int((xc - bw / 2) * width)
        y1 = int((yc - bh / 2) * height)
        x2 = int((xc + bw / 2) * width)
        y2 = int((yc + bh / 2) * height)

        cv2.rectangle(
            image,
            (x1, y1),
            (x2, y2),
            (0, 255, 0),
            2,
        )
        cv2.putText(
            image,
            "license_plate",
            (x1, max(20, y1 - 8)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (0, 255, 0),
            2,
        )

    output_path = OUTPUT_DIR / f"{image_path.stem}.jpg"
    cv2.imwrite(str(output_path), image)

print(f"Saved {len(list(OUTPUT_DIR.glob('*.jpg')))} annotated images.")
print(f"Output directory: {OUTPUT_DIR}")
