
from pathlib import Path
import csv
import hashlib
import random
import shutil
import xml.etree.ElementTree as ET
from collections import defaultdict

# Project paths
PROJECT_ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = PROJECT_ROOT / "datasets" / "raw" / "indian_vehicle_license_plate"
OUT_DIR = PROJECT_ROOT / "datasets" / "processed" / "plate_detection"
REPORT_DIR = PROJECT_ROOT / "reports"

# Reproducible split
TRAIN_RATIO = 0.80
RANDOM_SEED = 42
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def get_image_dimensions(path):
    # Pillow was installed with the initial backend dependencies.
    from PIL import Image

    with Image.open(path) as image:
        return image.size


def find_image(xml_path, filename, image_index):
    candidates = image_index.get(Path(filename).name.casefold(), [])

    # Prefer the image in the same directory as its XML.
    local = [p for p in candidates if p.parent == xml_path.parent]

    if len(local) == 1:
        return local[0]
    if len(local) > 1:
        return None

    # Otherwise accept only a globally unique filename.
    if len(candidates) == 1:
        return candidates[0]

    return None


def parse_annotation(xml_path, image_path):
    root = ET.parse(xml_path).getroot()

    size = root.find("size")
    if size is None:
        raise ValueError("Missing image size")

    width = float(size.findtext("width", "0"))
    height = float(size.findtext("height", "0"))

    actual_width, actual_height = get_image_dimensions(image_path)

    if width <= 0 or height <= 0:
        raise ValueError("Invalid image dimensions in XML")

    objects = []
    for obj in root.findall("object"):
        box = obj.find("bndbox")
        if box is None:
            raise ValueError("Object has no bounding box")

        xmin = float(box.findtext("xmin"))
        ymin = float(box.findtext("ymin"))
        xmax = float(box.findtext("xmax"))
        ymax = float(box.findtext("ymax"))

        if not (
            0 <= xmin < xmax <= width
            and 0 <= ymin < ymax <= height
        ):
            raise ValueError(f"Invalid bounding box: {xmin, ymin, xmax, ymax}")

        # Normalized YOLO coordinates:
        # class_id x_center y_center box_width box_height
        x_center = ((xmin + xmax) / 2) / width
        y_center = ((ymin + ymax) / 2) / height
        box_width = (xmax - xmin) / width
        box_height = (ymax - ymin) / height

        objects.append({
            "yolo": (
                f"0 {x_center:.6f} {y_center:.6f} "
                f"{box_width:.6f} {box_height:.6f}"
            ),
            "registration_text": obj.findtext("name", "").strip(),
        })

    if not objects:
        raise ValueError("No annotated objects")

    return objects, (int(width), int(height)), (actual_width, actual_height)


def main():
    if not RAW_DIR.exists():
        raise FileNotFoundError(f"Dataset directory not found: {RAW_DIR}")

    # Build filename index.
    images = [
        p for p in RAW_DIR.rglob("*")
        if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS
    ]
    image_index = defaultdict(list)
    for image in images:
        image_index[image.name.casefold()].append(image)

    xml_files = sorted(RAW_DIR.rglob("*.xml"))

    # Clear only our generated output directory.
    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)

    for split in ("train", "val"):
        (OUT_DIR / "images" / split).mkdir(parents=True, exist_ok=True)
        (OUT_DIR / "labels" / split).mkdir(parents=True, exist_ok=True)

    REPORT_DIR.mkdir(parents=True, exist_ok=True)

    records = []
    errors = []
    unmatched = []

    for xml_path in xml_files:
        try:
            root = ET.parse(xml_path).getroot()
            filename = root.findtext("filename", "").strip()

            image_path = find_image(xml_path, filename, image_index)
            if image_path is None:
                unmatched.append((str(xml_path), filename))
                continue

            objects, xml_size, actual_size = parse_annotation(
                xml_path, image_path
            )

            records.append({
                "xml": xml_path,
                "image": image_path,
                "objects": objects,
                "hash": sha256_file(image_path),
                "xml_size": xml_size,
                "actual_size": actual_size,
            })

        except Exception as exc:
            errors.append((str(xml_path), str(exc)))

    # Keep byte-identical images in the same split to reduce leakage.
    duplicate_groups = defaultdict(list)
    for record in records:
        duplicate_groups[record["hash"]].append(record)

    groups = list(duplicate_groups.values())
    random.Random(RANDOM_SEED).shuffle(groups)

    total_images = sum(len(group) for group in groups)
    target_train = round(total_images * TRAIN_RATIO)
    train_count = 0
    split_records = {"train": [], "val": []}

    for group in groups:
        # Do not split a duplicate group across train and validation.
        if train_count < target_train:
            split = "train"
            train_count += len(group)
        else:
            split = "val"

        split_records[split].extend(group)

    # Copy images and create labels with unique generated filenames.
    mapping_rows = []
    sample_index = 0

    for split in ("train", "val"):
        for record in split_records[split]:
            sample_index += 1
            output_name = f"plate_{sample_index:05d}"

            output_image = (
                OUT_DIR / "images" / split
                / f"{output_name}{record['image'].suffix.lower()}"
            )
            output_label = (
                OUT_DIR / "labels" / split / f"{output_name}.txt"
            )

            shutil.copy2(record["image"], output_image)

            output_label.write_text(
                "\n".join(obj["yolo"] for obj in record["objects"]) + "\n",
                encoding="utf-8",
            )

            for obj in record["objects"]:
                mapping_rows.append({
                    "split": split,
                    "output_image": str(output_image.relative_to(OUT_DIR)),
                    "source_image": str(record["image"]),
                    "source_xml": str(record["xml"]),
                    "registration_text": obj["registration_text"],
                    "image_hash": record["hash"],
                    "xml_width": record["xml_size"][0],
                    "xml_height": record["xml_size"][1],
                    "actual_width": record["actual_size"][0],
                    "actual_height": record["actual_size"][1],
                })

    # Preserve registration text and provenance for future OCR work.
    with (REPORT_DIR / "yolo_conversion_mapping.csv").open(
        "w", newline="", encoding="utf-8"
    ) as file:
        columns = [
            "split", "output_image", "source_image", "source_xml",
            "registration_text", "image_hash", "xml_width", "xml_height",
            "actual_width", "actual_height",
        ]
        writer = csv.DictWriter(file, fieldnames=columns)
        writer.writeheader()
        writer.writerows(mapping_rows)

    with (REPORT_DIR / "yolo_conversion_issues.csv").open(
        "w", newline="", encoding="utf-8"
    ) as file:
        writer = csv.writer(file)
        writer.writerow(["xml_path", "issue"])
        writer.writerows(unmatched)
        writer.writerows(errors)

    yaml_path = OUT_DIR / "data.yaml"
    yaml_path.write_text(
        "path: " + OUT_DIR.resolve().as_posix() + "\n"
        "train: images/train\n"
        "val: images/val\n"
        "names:\n"
        "  0: license_plate\n",
        encoding="utf-8",
    )

    train_images = len(split_records["train"])
    val_images = len(split_records["val"])

    print("\n=== YOLO Conversion Summary ===")
    print(f"Source images found:       {len(images)}")
    print(f"XML files found:           {len(xml_files)}")
    print(f"Matched annotated images:  {len(records)}")
    print(f"Train images:              {train_images}")
    print(f"Validation images:         {val_images}")
    print(f"Unmatched/ambiguous XML:   {len(unmatched)}")
    print(f"Invalid annotations:       {len(errors)}")
    print(f"Exact duplicate groups:    {sum(len(g) > 1 for g in groups)}")
    print(f"YOLO dataset:              {OUT_DIR}")
    print(f"Dataset config:            {yaml_path}")
    print(f"Mapping report:             {REPORT_DIR / 'yolo_conversion_mapping.csv'}")
    print(f"Issues report:              {REPORT_DIR / 'yolo_conversion_issues.csv'}")

    dimension_mismatches = sum(
        r["xml_size"] != r["actual_size"] for r in records
    )
    if dimension_mismatches:
        print(
            f"WARNING: {dimension_mismatches} images have dimensions "
            "that differ from their XML metadata. Review the mapping report."
        )


if __name__ == "__main__":
    main()
