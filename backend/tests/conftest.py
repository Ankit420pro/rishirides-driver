import os

os.environ.setdefault("MONGODB_URI", "mongodb://localhost:27017")
os.environ.setdefault("MONGODB_DATABASE", "rishiride_test")
os.environ.setdefault("JWT_SECRET", "test-only-secret-with-more-than-32-characters")

import mongomock
import pytest
from fastapi.testclient import TestClient

from app.core.security import hash_password
from app.main import create_app
from app.services.driver_service import utc_now


@pytest.fixture
def database():
    client = mongomock.MongoClient(tz_aware=True)
    database = client.rishiride_test
    yield database
    client.close()


@pytest.fixture
def api(database):
    app = create_app(database=database)
    with TestClient(app) as client:
        yield client


@pytest.fixture
def make_driver(database):
    def create(**overrides):
        values = {
            "full_name": "Rishi Driver",
            "email": "driver@example.com",
            "phone": "+14155550100",
            "password_hash": hash_password("a-correct-horse-battery"),
            "vehicle_type": "car",
            "vehicle_number": "KA01AB1234",
            "driving_license_number": "DL1234567890",
            "profile_image_url": None,
            "profile_status": "approved",
            "availability_status": "offline",
            "is_verified": True,
            "is_suspended": False,
            "created_at": utc_now(),
            "updated_at": utc_now(),
        }
        values.update(overrides)
        return database.drivers.insert_one(values).inserted_id
    return create


@pytest.fixture
def make_admin(database):
    return database.admins.insert_one({
        "email": "admin@example.com",
        "full_name": "Ride Admin",
        "password_hash": hash_password("another-correct-horse"),
        "created_at": utc_now(),
    }).inserted_id