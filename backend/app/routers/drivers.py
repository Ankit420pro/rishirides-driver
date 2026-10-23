from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from app.database.mongodb import get_database
from app.dependencies.auth import require_driver
from app.models.ride import RideStatus
from app.schemas.driver import AvailabilityUpdate, DriverProfileUpdate, DriverPublic
from app.schemas.ride import RidePublic
from app.services.driver_service import public_driver, set_availability, update_profile
from app.services.ride_service import public_ride

router = APIRouter(prefix="/api/drivers", tags=["drivers"])


@router.get("/me", response_model=DriverPublic)
def get_my_profile(driver=Depends(require_driver)):
    return public_driver(driver)


@router.put("/me", response_model=DriverPublic)
def update_my_profile(payload: DriverProfileUpdate, driver=Depends(require_driver), database=Depends(get_database)):
    updated = update_profile(database, driver, payload.model_dump(mode="json", exclude_unset=True))
    return public_driver(updated)


@router.patch("/me/availability", response_model=DriverPublic)
def update_my_availability(payload: AvailabilityUpdate, driver=Depends(require_driver), database=Depends(get_database)):
    updated = set_availability(database, driver, payload.availability_status)
    return public_driver(updated)


@router.get("/me/rides", response_model=list[RidePublic])
def get_my_active_rides(
    limit: int = Query(default=50, ge=1, le=100),
    driver=Depends(require_driver), database=Depends(get_database),
):
    rows = database.rides.find({"driver_id": driver["_id"], "ride_status": {"$in": ["accepted", "driver_arriving", "in_progress"]}}).sort("requested_at", -1).limit(limit)
    return [public_ride(row) for row in rows]


@router.get("/me/rides/history", response_model=list[RidePublic])
def get_my_ride_history(
    limit: int = Query(default=50, ge=1, le=100),
    before: datetime | None = None,
    driver=Depends(require_driver), database=Depends(get_database),
):
    query = {"driver_id": driver["_id"], "ride_status": {"$in": [RideStatus.COMPLETED, RideStatus.CANCELLED]}}
    if before:
        query["requested_at"] = {"$lt": before.astimezone(timezone.utc)}
    rows = database.rides.find(query).sort("requested_at", -1).limit(limit)
    return [public_ride(row) for row in rows]


@router.get("/me/stats")
def get_my_stats(driver=Depends(require_driver), database=Depends(get_database)):
    return {
        "completed_rides": database.rides.count_documents({"driver_id": driver["_id"], "ride_status": "completed"}),
        "cancelled_rides": database.rides.count_documents({"driver_id": driver["_id"], "ride_status": "cancelled"}),
    }