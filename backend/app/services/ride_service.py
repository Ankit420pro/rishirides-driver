from datetime import datetime, timezone

from bson import ObjectId
from fastapi import HTTPException
from pymongo import ReturnDocument

from app.models.driver import AvailabilityStatus, ProfileStatus
from app.models.ride import DRIVER_TRANSITIONS, RideStatus
from app.services.driver_service import ensure_driver_active, object_id_or_404, utc_now


def public_ride(ride: dict) -> dict:
    result = {key: ride.get(key) for key in (
        "passenger_id", "driver_id", "pickup_location", "destination", "pickup_coordinates",
        "destination_coordinates", "fare_estimate", "ride_status", "requested_at", "accepted_at", "completed_at",
    )}
    result["id"] = str(ride["_id"])
    for key in ("passenger_id", "driver_id"):
        if result.get(key) is not None:
            result[key] = str(result[key])
    for key in ("pickup_coordinates", "destination_coordinates"):
        value = result.get(key)
        if value and "lat" in value and "latitude" not in value:
            result[key] = {"latitude": value["lat"], "longitude": value["lng"]}
    return result


def accept_ride(database, driver: dict, ride_id: str) -> dict:
    ensure_driver_active(driver)
    ride_object_id = object_id_or_404(ride_id)
    reserved = database.drivers.find_one_and_update(
        {"_id": driver["_id"], "profile_status": ProfileStatus.APPROVED,
         "is_suspended": {"$ne": True}, "availability_status": AvailabilityStatus.ONLINE},
        {"$set": {"availability_status": AvailabilityStatus.ON_RIDE, "updated_at": utc_now()}},
        return_document=ReturnDocument.AFTER,
    )
    if not reserved:
        raise HTTPException(status_code=409, detail="Driver must be approved, online, and not on another ride")

    now = utc_now()
    try:
        ride = database.rides.find_one_and_update(
            {"_id": ride_object_id, "ride_status": RideStatus.REQUESTED,
             "$or": [{"driver_id": None}, {"driver_id": {"$exists": False}}]},
            {"$set": {"driver_id": driver["_id"], "ride_status": RideStatus.ACCEPTED, "accepted_at": now}},
            return_document=ReturnDocument.AFTER,
        )
    except Exception:
        database.drivers.update_one(
            {"_id": driver["_id"], "availability_status": AvailabilityStatus.ON_RIDE},
            {"$set": {"availability_status": AvailabilityStatus.ONLINE, "updated_at": utc_now()}},
        )
        raise

    if not ride:
        database.drivers.update_one(
            {"_id": driver["_id"], "availability_status": AvailabilityStatus.ON_RIDE},
            {"$set": {"availability_status": AvailabilityStatus.ONLINE, "updated_at": utc_now()}},
        )
        raise HTTPException(status_code=409, detail="Ride is no longer available")
    return ride


def update_ride_status(database, driver: dict, ride_id: str, next_status: RideStatus) -> dict:
    ride_object_id = object_id_or_404(ride_id)
    ride = database.rides.find_one({"_id": ride_object_id, "driver_id": driver["_id"]})
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found")
    current = RideStatus(ride["ride_status"])
    if next_status not in DRIVER_TRANSITIONS.get(current, set()):
        raise HTTPException(status_code=409, detail=f"Invalid ride transition: {current} to {next_status}")

    now = utc_now()
    update = {"ride_status": next_status}
    if next_status == RideStatus.COMPLETED:
        update["completed_at"] = now
    updated = database.rides.find_one_and_update(
        {"_id": ride_object_id, "driver_id": driver["_id"], "ride_status": current},
        {"$set": update},
        return_document=ReturnDocument.AFTER,
    )
    if not updated:
        raise HTTPException(status_code=409, detail="Ride state changed; reload and try again")
    if next_status in {RideStatus.COMPLETED, RideStatus.CANCELLED}:
        database.drivers.update_one(
            {"_id": driver["_id"], "availability_status": AvailabilityStatus.ON_RIDE},
            {"$set": {"availability_status": AvailabilityStatus.ONLINE, "updated_at": now}},
        )
    return updated