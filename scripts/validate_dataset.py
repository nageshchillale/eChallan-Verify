
from pathlib import Path
import csv
import xml.etree.ElementTree as ET
from collections import Counter

ROOT = (
    Path(__file__).resolve().parent.parent
    / "datasets"
    / "raw"
    / "indian_vehicle_license_plate"
)

REPORT_DIR = Path(__file__).resolve().parent.parent / "reports"
REPORT_DIR.mkdir(parents=True, exist_ok=True)

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}

images = [
    p for p in ROOT.rglob("*")
    if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS
]

xml_files = list(ROOT.rglob("*.xml"))

# Index images by filename, ignoring case.
image_index = {}
for image in images:
    image_index.setdefault(image.name.casefold(), []).append(image)

matched = 0
missing_images = []
invalid_xml = []
invalid_boxes = []
valid_boxes = 0
object_count = 0
labels = Counter()
report_rows = []

for xml_path in xml_files:
    try:
        tree = ET.parse(xml_path)
        annotation = tree.getroot()
    except (ET.ParseError, OSError) as exc:
        invalid_xml.append((str(xml_path), str(exc)))
        continue

    filename = annotation.findtext("filename", "").strip()
    candidates = image_index.get(Path(filename).name.casefold(), [])

    # Prefer an image beside the XML if filenames are duplicated.
    local_matches = [p for p in candidates if p.parent == xml_path.parent]
    image_path = local_matches[0] if local_matches else (
        candidates[0] if len(candidates) == 1 else None
    )

    if image_path is None:
        missing_images.append((str(xml_path), filename))
        report_rows.append({
            "xml": str(xml_path),
            "image": filename,
            "status": "MISSING_OR_AMBIGUOUS_IMAGE",
            "objects": 0,
            "labels": "",
        })
        continue

    matched += 1
    size = annotation.find("size")
    width = int(size.findtext("width", "0")) if size is not None else 0
    height = int(size.findtext("height", "0")) if size is not None else 0

    object_labels = []
    xml_box_errors = []

    for obj in annotation.findall("object"):
        object_count += 1
        label = obj.findtext("name", "").strip()
        labels[label] += 1
        object_labels.append(label)

        box = obj.find("bndbox")
        try:
            if box is None:
                raise ValueError("Missing bndbox")

            xmin = float(box.findtext("xmin"))
            ymin = float(box.findtext("ymin"))
            xmax = float(box.findtext("xmax"))
            ymax = float(box.findtext("ymax"))

            if not (
                width > 0 and height > 0
                and 0 <= xmin < xmax <= width
                and 0 <= ymin < ymax <= height
            ):
                raise ValueError(
                    f"Invalid box {(xmin, ymin, xmax, ymax)} "
                    f"for image size {(width, height)}"
                )

            valid_boxes += 1

        except (ValueError, TypeError) as exc:
            xml_box_errors.append(str(exc))
            invalid_boxes.append((str(xml_path), str(exc)))

    report_rows.append({
        "xml": str(xml_path),
        "image": str(image_path),
        "status": "MATCHED" if not xml_box_errors else "INVALID_BOX",
        "objects": len(object_labels),
        "labels": "; ".join(object_labels),
    })

with (REPORT_DIR / "dataset_validation.csv").open(
    "w", newline="", encoding="utf-8"
) as file:
    columns = ["xml", "image", "status", "objects", "labels"]
    writer = csv.DictWriter(file, fieldnames=columns)
    writer.writeheader()
    writer.writerows(report_rows)

print("\n=== eChallan Verify: Dataset Validation ===")
print(f"Dataset folder:             {ROOT}")
print(f"Image files:                {len(images)}")
print(f"XML annotation files:       {len(xml_files)}")
print(f"XML files parsed:           {len(xml_files) - len(invalid_xml)}")
print(f"XML-image matches:          {matched}")
print(f"Missing/ambiguous images:   {len(missing_images)}")
print(f"Invalid XML files:          {len(invalid_xml)}")
print(f"Annotated objects:          {object_count}")
print(f"Valid bounding boxes:       {valid_boxes}")
print(f"Invalid bounding boxes:     {len(invalid_boxes)}")

print("\nMost common annotation labels:")
for label, count in labels.most_common(15):
    print(f"  {label or '[empty label]'}: {count}")

print(f"\nDetailed report: {REPORT_DIR / 'dataset_validation.csv'}")

if missing_images:
    print("\nFirst missing/ambiguous image references:")
    for xml_path, filename in missing_images[:5]:
        print(f"  XML: {xml_path}")
        print(f"  Expected image: {filename}")

if invalid_xml:
    print("\nFirst XML parsing errors:")
    for path, error in invalid_xml[:5]:
        print(f"  {path}: {error}")

if invalid_boxes:
    print("\nFirst invalid bounding boxes:")
    for path, error in invalid_boxes[:5]:
        print(f"  {path}: {error}")
