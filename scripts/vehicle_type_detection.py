
from pathlib import Path
import argparse

import cv2
from ultralytics import YOLO


# COCO class IDs used by YOLO
VEHICLE_CLASSES = {
    2: "car",
    3: "motorcycle",
    5: "bus",
    7: "truck",
}

CATEGORY_MAPPING = {
    "car": "four_wheeler",
    "motorcycle": "two_wheeler",
    "bus": "heavy_vehicle",
    "truck": "heavy_vehicle",
}


def detect_vehicle_types(image_path: str, confidence: float = 0.25):
    image_path = Path(image_path)

    if not image_path.exists():
        raise FileNotFoundError(f"Image not found: {image_path}")

    image = cv2.imread(str(image_path))

    if image is None:
        raise ValueError(f"Unable to read image: {image_path}")

    # Pretrained COCO model; downloads weights on first run if needed.
    model = YOLO("yolo11n.pt")

    results = model.predict(
        source=image,
        conf=confidence,
        verbose=False
    )

    detections = []

    for result in results:
        for box in result.boxes:
            class_id = int(box.cls[0].item())

            if class_id not in VEHICLE_CLASSES:
                continue

            vehicle_type = VEHICLE_CLASSES[class_id]
            category = CATEGORY_MAPPING[vehicle_type]
            score = float(box.conf[0].item())

            x1, y1, x2, y2 = map(
                int, box.xyxy[0].tolist()
            )

            detections.append({
                "vehicle_type": vehicle_type,
                "vehicle_category": category,
                "confidence": round(score, 4),
                "bounding_box": [x1, y1, x2, y2]
            })

            # Draw detection box
            cv2.rectangle(
                image,
                (x1, y1),
                (x2, y2),
                (0, 255, 0),
                2
            )

            cv2.putText(
                image,
                f"{vehicle_type}: {score:.2f}",
                (x1, max(y1 - 10, 20)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (0, 255, 0),
                2
            )

    output_path = image_path.parent / (
        image_path.stem + "_vehicle_detection.jpg"
    )

    cv2.imwrite(str(output_path), image)

    return {
        "image": str(image_path),
        "vehicle_count": len(detections),
        "detections": detections,
        "annotated_image": str(output_path)
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Detect vehicle types in traffic evidence"
    )

    parser.add_argument(
        "--image",
        required=True,
        help="Path to the traffic evidence image"
    )

    parser.add_argument(
        "--confidence",
        type=float,
        default=0.25
    )

    args = parser.parse_args()

    output = detect_vehicle_types(
        args.image,
        args.confidence
    )

    print("\nVEHICLE DETECTION RESULT")
    print("=" * 45)
    print(f"Vehicles detected: {output['vehicle_count']}")

    for index, detection in enumerate(output["detections"], 1):
        print(f"\nVehicle {index}")
        print(f"Type       : {detection['vehicle_type']}")
        print(f"Category   : {detection['vehicle_category']}")
        print(f"Confidence : {detection['confidence']}")
        print(f"Bounding box: {detection['bounding_box']}")

    print(f"\nAnnotated image: {output['annotated_image']}")
