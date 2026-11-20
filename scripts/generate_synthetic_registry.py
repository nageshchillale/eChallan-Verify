
import csv
import random
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "backend" / "data" / "vehicles.csv"

random.seed(42)

FIELDS = [
    "registration_no",
    "registered_type",
    "vehicle_category",
    "manufacturer",
    "model",
    "fuel_type",
    "registration_date",
    "rto_code",
    "record_status",
    "data_source",
]

# Keep existing demo records working during migration.
legacy_records = [
    {
        "registration_no": "DEMO001",
        "registered_type": "Scooter",
        "vehicle_category": "Two-wheeler",
        "manufacturer": "Demo Motors",
        "model": "Demo Scooter",
        "fuel_type": "Petrol",
        "registration_date": "2023-01-10",
        "rto_code": "DEMO",
        "record_status": "Active",
        "data_source": "Synthetic - Legacy Demo",
    },
    {
        "registration_no": "DEMO002",
        "registered_type": "Car",
        "vehicle_category": "Four-wheeler",
        "manufacturer": "Demo Motors",
        "model": "Demo Car",
        "fuel_type": "Petrol",
        "registration_date": "2022-05-15",
        "rto_code": "DEMO",
        "record_status": "Active",
        "data_source": "Synthetic - Legacy Demo",
    },
    {
        "registration_no": "DEMO003",
        "registered_type": "Truck",
        "vehicle_category": "Heavy Vehicle",
        "manufacturer": "Demo Motors",
        "model": "Demo Truck",
        "fuel_type": "Diesel",
        "registration_date": "2021-08-20",
        "rto_code": "DEMO",
        "record_status": "Active",
        "data_source": "Synthetic - Legacy Demo",
    },
    {
        "registration_no": "DEMO004",
        "registered_type": "Motorcycle",
        "vehicle_category": "Two-wheeler",
        "manufacturer": "Demo Motors",
        "model": "Demo Motorcycle",
        "fuel_type": "Petrol",
        "registration_date": "2024-02-12",
        "rto_code": "DEMO",
        "record_status": "Active",
        "data_source": "Synthetic - Legacy Demo",
    },
    {
        "registration_no": "DEMO005",
        "registered_type": "Bus",
        "vehicle_category": "Heavy Vehicle",
        "manufacturer": "Demo Motors",
        "model": "Demo Bus",
        "fuel_type": "Diesel",
        "registration_date": "2020-11-05",
        "rto_code": "DEMO",
        "record_status": "Active",
        "data_source": "Synthetic - Legacy Demo",
    },
]

# Illustrative Maharashtra RTO codes and labels.
rtos = ["MH01", "MH02", "MH03", "MH04", "MH05",
        "MH12", "MH14", "MH15", "MH20", "MH31"]

vehicle_options = {
    "Motorcycle": [
        ("Hero", "Splendor Plus", "Petrol"),
        ("Honda", "Shine", "Petrol"),
        ("Bajaj", "Pulsar 150", "Petrol"),
        ("TVS", "Apache RTR", "Petrol"),
    ],
    "Scooter": [
        ("Honda", "Activa 6G", "Petrol"),
        ("TVS", "Jupiter", "Petrol"),
        ("Suzuki", "Access 125", "Petrol"),
    ],
    "Car": [
        ("Maruti Suzuki", "Swift", "Petrol"),
        ("Hyundai", "i20", "Petrol"),
        ("Tata", "Nexon", "Petrol"),
        ("Honda", "City", "Petrol"),
        ("Tata", "Nexon EV", "Electric"),
    ],
    "Truck": [
        ("Tata", "407", "Diesel"),
        ("Ashok Leyland", "Partner", "Diesel"),
    ],
    "Bus": [
        ("Tata", "Starbus", "Diesel"),
        ("Ashok Leyland", "Viking", "Diesel"),
    ],
}

categories = {
    "Motorcycle": "Two-wheeler",
    "Scooter": "Two-wheeler",
    "Car": "Four-wheeler",
    "Truck": "Heavy Vehicle",
    "Bus": "Heavy Vehicle",
}

def random_registration(rto):
    letters = "".join(random.choices("ABCDEFGHJKLMNPRSTUVWXYZ", k=2))
    number = random.randint(1000, 9999)
    return f"{rto}{letters}{number}"

records = list(legacy_records)
used_numbers = {r["registration_no"] for r in records}

start_date = date(2018, 1, 1)
end_date = date(2025, 12, 31)
date_range = (end_date - start_date).days

for _ in range(100):
    rto = random.choice(rtos)
    registration_no = random_registration(rto)

    while registration_no in used_numbers:
        registration_no = random_registration(rto)

    used_numbers.add(registration_no)

    registered_type = random.choice(list(vehicle_options))
    manufacturer, model, fuel = random.choice(
        vehicle_options[registered_type]
    )

    registered_on = start_date + timedelta(
        days=random.randint(0, date_range)
    )

    records.append({
        "registration_no": registration_no,
        "registered_type": registered_type,
        "vehicle_category": categories[registered_type],
        "manufacturer": manufacturer,
        "model": model,
        "fuel_type": fuel,
        "registration_date": registered_on.isoformat(),
        "rto_code": rto,
        "record_status": random.choices(
            ["Active", "Inactive"],
            weights=[95, 5],
        )[0],
        "data_source": "Synthetic - Generated",
    })

OUTPUT.parent.mkdir(parents=True, exist_ok=True)

with OUTPUT.open("w", newline="", encoding="utf-8") as file:
    writer = csv.DictWriter(file, fieldnames=FIELDS)
    writer.writeheader()
    writer.writerows(records)

print(f"Registry generated: {OUTPUT}")
print(f"Total records: {len(records)}")
print(f"Generated records: {len(records) - len(legacy_records)}")
print("All records are synthetic; none are official VAHAN records.")
