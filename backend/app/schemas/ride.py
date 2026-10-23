from datetime import datetime

from pydantic import BaseModel, Field

from app.models.ride import RideStatus


class Coordinates(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class RideStatusUpdate(BaseModel):
    ride_status: RideStatus


class RidePublic(BaseModel):
    id: str
    passenger_id: str | None = None
    driver_id: str | None = None
    pickup_location: str
    destination: str
    pickup_coordinates: Coordinates | None = None
    destination_coordinates: Coordinates | None = None
    fare_estimate: float | None = None
    ride_status: RideStatus
    requested_at: datetime
    accepted_at: datetime | None = None
    completed_at: datetime | None = None