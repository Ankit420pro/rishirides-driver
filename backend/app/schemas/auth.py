import re

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.models.driver import VehicleType


def normalize_phone(value: str) -> str:
    normalized = re.sub(r"[\s().-]", "", value)
    if not re.fullmatch(r"\+[1-9]\d{7,14}", normalized):
        raise ValueError("Phone must be in international format, for example +14155552671")
    return normalized


class DriverSignup(BaseModel):
    full_name: str = Field(min_length=2, max_length=100)
    phone: str = Field(min_length=8, max_length=24)
    password: str = Field(min_length=12, max_length=128)
    otp: str = Field(min_length=6, max_length=8, pattern=r"^\d+$")
    vehicle_type: VehicleType
    vehicle_number: str = Field(min_length=3, max_length=20)
    driving_license_number: str = Field(min_length=4, max_length=40)

    @field_validator("full_name", "vehicle_number", "driving_license_number")
    @classmethod
    def trim_text(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("This field cannot be blank")
        return cleaned

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        return normalize_phone(value)

    @field_validator("vehicle_number", "driving_license_number")
    @classmethod
    def normalize_identifiers(cls, value: str) -> str:
        return value.strip().upper()


class DriverLogin(BaseModel):
    phone: str = Field(min_length=8, max_length=24)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        return normalize_phone(value)


class DriverSignupOtpRequest(BaseModel):
    phone: str = Field(min_length=8, max_length=24)

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        return normalize_phone(value)


class AdminLogin(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: EmailStr) -> str:
        return str(value).strip().lower()


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class SafeActor(BaseModel):
    id: str
    role: str
    full_name: str | None = None
    email: EmailStr | None = None
    phone: str | None = None
    profile_image_url: str | None = None
    profile_status: str | None = None
    availability_status: str | None = None