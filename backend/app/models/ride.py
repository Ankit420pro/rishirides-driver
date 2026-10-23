from enum import StrEnum


class RideStatus(StrEnum):
    REQUESTED = "requested"
    ACCEPTED = "accepted"
    DRIVER_ARRIVING = "driver_arriving"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


DRIVER_TRANSITIONS = {
    RideStatus.ACCEPTED: {RideStatus.DRIVER_ARRIVING, RideStatus.CANCELLED},
    RideStatus.DRIVER_ARRIVING: {RideStatus.IN_PROGRESS, RideStatus.CANCELLED},
    RideStatus.IN_PROGRESS: {RideStatus.COMPLETED},
}