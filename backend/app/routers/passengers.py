from fastapi import APIRouter, Depends, HTTPException, status

from app.database.mongodb import get_database
from app.dependencies.auth import require_passenger
from app.models.ride import RideStatus
from app.schemas.ride import PassengerRideRequest, RidePublic
from app.services.driver_service import utc_now
from app.services.ride_service import public_ride

router = APIRouter(prefix="/api/passengers/me/rides", tags=["passengers"])
ACTIVE_STATUSES = [
    RideStatus.REQUESTED,
    RideStatus.ACCEPTED,
    RideStatus.DRIVER_ARRIVING,
    RideStatus.IN_PROGRESS,
]


@router.post("", response_model=RidePublic, status_code=status.HTTP_201_CREATED)
def request_ride(
    payload: PassengerRideRequest,
    passenger=Depends(require_passenger),
    database=Depends(get_database),
):
    if database.rides.find_one({"passenger_id": passenger["_id"], "ride_status": {"$in": ACTIVE_STATUSES}}):
        raise HTTPException(status_code=409, detail="You already have an active ride")

    now = utc_now()
    ride = {
        "passenger_id": passenger["_id"],
        "passenger": {"full_name": passenger["full_name"], "phone": passenger["phone"]},
        "pickup_location": payload.pickup_location,
        "destination": payload.destination,
        "pickup_coordinates": payload.pickup_coordinates.model_dump() if payload.pickup_coordinates else None,
        "destination_coordinates": payload.destination_coordinates.model_dump() if payload.destination_coordinates else None,
        "passenger_count": payload.passenger_count,
        "luggage_count": payload.luggage_count,
        "ride_status": RideStatus.REQUESTED,
        "requested_at": now,
    }
    result = database.rides.insert_one(ride)
    ride["_id"] = result.inserted_id
    return public_ride(ride)


@router.get("", response_model=list[RidePublic])
def list_my_rides(passenger=Depends(require_passenger), database=Depends(get_database)):
    rides = database.rides.find({"passenger_id": passenger["_id"]}).sort("requested_at", -1).limit(100)
    return [public_ride(ride) for ride in rides]
