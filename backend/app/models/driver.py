from enum import StrEnum


class VehicleType(StrEnum):
    AUTO = "auto"
    BIKE = "bike"
    CAR = "car"


class ProfileStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class AvailabilityStatus(StrEnum):
    ONLINE = "online"
    OFFLINE = "offline"
    ON_RIDE = "on_ride"