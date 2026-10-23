from datetime import datetime, timezone

from bson import ObjectId
from fastapi import HTTPException, status
from pymongo.errors import DuplicateKeyError

from app.models.driver import AvailabilityStatus, ProfileStatus


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def public_driver(driver: dict) -> dict:
    return {
        "id": str(driver["_id"]),
        "full_name": driver["full_name"],
        "email": driver.get("email"),
        "phone": driver["phone"],
        "vehicle_type": driver["vehicle_type"],
        "vehicle_number": driver["vehicle_number"],
        "profile_image_url": driver.get("profile_image_url"),
        "profile_status": driver["profile_status"],
        "availability_status": driver["availability_status"],
        "is_verified": driver["is_verified"],
        "is_suspended": driver.get("is_suspended", False),
        "created_at": driver["created_at"],
        "updated_at": driver["updated_at"],
    }


def ensure_driver_active(driver: dict) -> None:
    if driver["profile_status"] != ProfileStatus.APPROVED:
        raise HTTPException(status_code=403, detail="Driver approval is required")
    if driver.get("is_suspended", False):
        raise HTTPException(status_code=403, detail="Driver account is suspended")


def update_profile(database, driver: dict, changes: dict) -> dict:
    values = {key: value for key, value in changes.items() if value is not None}
    if not values:
        raise HTTPException(status_code=400, detail="Provide at least one profile field to update")
    values["updated_at"] = utc_now()
    try:
        database.drivers.update_one({"_id": driver["_id"]}, {"$set": values})
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Phone is already registered") from None
    return database.drivers.find_one({"_id": driver["_id"]})


def set_availability(database, driver: dict, requested: AvailabilityStatus) -> dict:
    if requested == AvailabilityStatus.ON_RIDE:
        raise HTTPException(status_code=400, detail="Ride assignment controls on_ride availability")
    if requested == AvailabilityStatus.ONLINE:
        ensure_driver_active(driver)
    if driver["availability_status"] == AvailabilityStatus.ON_RIDE and requested == AvailabilityStatus.OFFLINE:
        raise HTTPException(status_code=409, detail="Finish or cancel the active ride before going offline")
    database.drivers.update_one(
        {"_id": driver["_id"], "availability_status": {"$ne": AvailabilityStatus.ON_RIDE}},
        {"$set": {"availability_status": requested, "updated_at": utc_now()}},
    )
    return database.drivers.find_one({"_id": driver["_id"]})


def object_id_or_404(value: str) -> ObjectId:
    if not ObjectId.is_valid(value):
        raise HTTPException(status_code=404, detail="Resource not found")
    return ObjectId(value)