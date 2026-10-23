from pymongo import ASCENDING, DESCENDING, MongoClient
from fastapi import HTTPException, Request

from app.core.config import get_settings


def create_indexes(database) -> None:
    drivers = database["drivers"]
    email_index = drivers.index_information().get("driver_email_unique")
    if email_index and email_index.get("unique") and not email_index.get("sparse"):
        drivers.drop_index("driver_email_unique")
    drivers.create_index([("email", ASCENDING)], unique=True, sparse=True, name="driver_email_unique")
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
    database["signup_otps"].create_index([("expires_at", ASCENDING)], expireAfterSeconds=0)


def connect_database():
    settings = get_settings()
    client = MongoClient(settings.mongodb_uri, tz_aware=True, serverSelectionTimeoutMS=5000)
    database = client[settings.mongodb_database]
    client.admin.command("ping")
    create_indexes(database)
    return client, database


def get_database(request: Request):
    database = request.app.state.database
    if database is None:
        raise HTTPException(status_code=503, detail="Database is unavailable; configure MongoDB and retry")
    return database