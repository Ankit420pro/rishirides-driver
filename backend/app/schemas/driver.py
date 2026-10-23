from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, HttpUrl, field_validator

from app.models.driver import AvailabilityStatus, ProfileStatus, VehicleType
from app.schemas.auth import normalize_phone


class DriverProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    full_name: str | None = Field(default=None, min_length=2, max_length=100)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, min_length=8, max_length=24)
    vehicle_type: VehicleType | None = None
    vehicle_number: str | None = Field(default=None, min_length=3, max_length=20)
    driving_license_number: str | None = Field(default=None, min_length=4, max_length=40)
    profile_image_url: HttpUrl | None = None

    @field_validator("full_name", "vehicle_number", "driving_license_number")
    @classmethod
    def normalize_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("This field cannot be blank")
        return value

    @field_validator("vehicle_number", "driving_license_number")
    @classmethod
    def normalize_identifiers(cls, value: str | None) -> str | None:
        return value.upper() if value else None

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: EmailStr | None) -> str | None:
        return str(value).strip().lower() if value else None

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str | None) -> str | None:
        return normalize_phone(value) if value else None


class AvailabilityUpdate(BaseModel):
    availability_status: AvailabilityStatus


class DriverPublic(BaseModel):
    id: str
    full_name: str
    email: EmailStr
    phone: str
    vehicle_type: VehicleType
    vehicle_number: str
    profile_image_url: str | None = None
    profile_status: ProfileStatus
    availability_status: AvailabilityStatus
    is_verified: bool
    is_suspended: bool = False
    created_at: datetime
    updated_at: datetime