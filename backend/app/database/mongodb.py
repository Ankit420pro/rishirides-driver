from pymongo import ASCENDING, DESCENDING, MongoClient
from fastapi import Request

from app.core.config import get_settings


def create_indexes(database) -> None:
    drivers = database["drivers"]
    drivers.create_index([("email", ASCENDING)], unique=True, name="driver_email_unique")
    drivers.create_index([("phone", ASCENDING)], unique=True, name="driver_phone_unique")
    drivers.create_index([("profile_status", ASCENDING), ("availability_status", ASCENDING)])
    drivers.create_index([("vehicle_type", ASCENDING), ("created_at", DESCENDING)])

    rides = database["rides"]
    rides.create_index([("ride_status", ASCENDING), ("requested_at", ASCENDING)])
    rides.create_index([("driver_id", ASCENDING), ("ride_status", ASCENDING)])
    rides.create_index([("passenger_id", ASCENDING), ("requested_at", DESCENDING)])

    database["admins"].create_index([("email", ASCENDING)], unique=True, name="admin_email_unique")
    database["revoked_tokens"].create_index([("jti", ASCENDING)], unique=True)
    database["revoked_tokens"].create_index([("expires_at", ASCENDING)], expireAfterSeconds=0)
    database["admin_audit_logs"].create_index([("created_at", DESCENDING)])


def connect_database():
    settings = get_settings()
    client = MongoClient(settings.mongodb_uri, tz_aware=True, serverSelectionTimeoutMS=5000)
    database = client[settings.mongodb_database]
    client.admin.command("ping")
    create_indexes(database)
    return client, database


def get_database(request: Request):
    return request.app.state.database