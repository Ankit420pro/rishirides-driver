from fastapi import APIRouter, Depends, Query

from app.database.mongodb import get_database
from app.dependencies.auth import require_driver
from app.models.driver import AvailabilityStatus, ProfileStatus
from app.models.ride import RideStatus
from app.schemas.ride import RidePublic, RideStatusUpdate
from app.services.driver_service import ensure_driver_active
from app.services.ride_service import accept_ride, public_ride, update_ride_status

router = APIRouter(prefix="/api/rides", tags=["rides"])


@router.get("/available", response_model=list[RidePublic])
def available_rides(
    limit: int = Query(default=50, ge=1, le=100),
    driver=Depends(require_driver), database=Depends(get_database),
):
    ensure_driver_active(driver)
    if driver["availability_status"] != AvailabilityStatus.ONLINE:
        return []
    rows = database.rides.find({"ride_status": RideStatus.REQUESTED,
                                "$or": [{"driver_id": None}, {"driver_id": {"$exists": False}}]}).sort("requested_at", 1).limit(limit)
    return [public_ride(row) for row in rows]


@router.post("/{ride_id}/accept", response_model=RidePublic)
def accept_available_ride(ride_id: str, driver=Depends(require_driver), database=Depends(get_database)):
    return public_ride(accept_ride(database, driver, ride_id))


@router.patch("/{ride_id}/status", response_model=RidePublic)
def change_ride_status(
    ride_id: str, payload: RideStatusUpdate,
    driver=Depends(require_driver), database=Depends(get_database),
):
    return public_ride(update_ride_status(database, driver, ride_id, payload.ride_status))