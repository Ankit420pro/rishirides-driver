from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.models.ride import RideStatus


class Coordinates(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class RideStatusUpdate(BaseModel):
    ride_status: RideStatus


class RidePublic(BaseModel):
    id: str
    passenger_id: str | None = None
    passenger_name: str | None = None
    passenger_phone: str | None = None
    passenger_count: int = 1
    luggage_count: int = 0
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


class PassengerRideRequest(BaseModel):
    pickup_location: str = Field(min_length=2, max_length=300)
    destination: str = Field(min_length=2, max_length=300)
    pickup_coordinates: Coordinates | None = None
    destination_coordinates: Coordinates | None = None
    passenger_count: int = Field(default=1, ge=1, le=8)
    luggage_count: int = Field(default=0, ge=0, le=10)

    @field_validator("pickup_location", "destination")
    @classmethod
    def trim_location(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Location cannot be blank")
        return cleaned