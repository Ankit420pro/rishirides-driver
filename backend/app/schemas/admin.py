from pydantic import BaseModel, Field, field_validator

from app.models.driver import ProfileStatus


class ApprovalUpdate(BaseModel):
    profile_status: ProfileStatus

    @field_validator("profile_status")
    @classmethod
    def validate_approval(cls, value: ProfileStatus) -> ProfileStatus:
        if value not in {ProfileStatus.APPROVED, ProfileStatus.REJECTED}:
            raise ValueError("Admin decisions must be approved or rejected")
        return value


class SuspensionUpdate(BaseModel):
    suspended: bool
    reason: str = Field(min_length=5, max_length=300)


class DriverListPage(BaseModel):
    items: list[dict]
    total: int
    page: int
    page_size: int
    pages: int
    counts: dict[str, int]