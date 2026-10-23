from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pymongo.errors import DuplicateKeyError
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.config import get_settings
from app.core.security import create_access_token, hash_password, verify_password
from app.database.mongodb import get_database
from app.dependencies.auth import get_current_actor, revocation_document
from app.models.driver import AvailabilityStatus, ProfileStatus
from app.schemas.auth import AdminLogin, DriverLogin, DriverSignup, SafeActor, TokenResponse
from app.services.driver_service import public_driver, utc_now

router = APIRouter(prefix="/api/auth", tags=["authentication"])
limiter = Limiter(key_func=get_remote_address)


def _token_response(actor_id: str, role: str) -> TokenResponse:
    token, _ = create_access_token(actor_id, role)
    return TokenResponse(access_token=token, expires_in=get_settings().access_token_minutes * 60)


@router.post("/driver/signup", response_model=SafeActor, status_code=201)
@limiter.limit("5/minute")
def driver_signup(request: Request, payload: DriverSignup, database=Depends(get_database)):
    now = utc_now()
    driver = {
        "full_name": payload.full_name,
        "email": payload.email,
        "phone": payload.phone,
        "password_hash": hash_password(payload.password),
        "vehicle_type": payload.vehicle_type.value,
        "vehicle_number": payload.vehicle_number,
        "driving_license_number": payload.driving_license_number,
        "profile_image_url": None,
        "profile_status": ProfileStatus.PENDING.value,
        "availability_status": AvailabilityStatus.OFFLINE.value,
        "is_verified": False,
        "is_suspended": False,
        "created_at": now,
        "updated_at": now,
    }
    try:
        result = database.drivers.insert_one(driver)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Email or phone is already registered") from None
    driver["_id"] = result.inserted_id
    driver["role"] = "driver"
    return {"id": str(result.inserted_id), "role": "driver", **public_driver(driver)}


@router.post("/driver/login", response_model=TokenResponse)
@limiter.limit("10/minute")
def driver_login(request: Request, payload: DriverLogin, database=Depends(get_database)):
    driver = database.drivers.find_one({"$or": [{"email": payload.identifier}, {"phone": payload.identifier}]})
    if not driver or not verify_password(payload.password, driver.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return _token_response(str(driver["_id"]), "driver")


@router.post("/admin/login", response_model=TokenResponse)
@limiter.limit("10/minute")
def admin_login(request: Request, payload: AdminLogin, database=Depends(get_database)):
    admin = database.admins.find_one({"email": str(payload.email).lower()})
    if not admin or not verify_password(payload.password, admin.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return _token_response(str(admin["_id"]), "admin")


@router.get("/me", response_model=SafeActor)
def current_profile(actor=Depends(get_current_actor)):
    if actor["role"] == "driver":
        return {"id": str(actor["_id"]), "role": "driver", **public_driver(actor)}
    return {"id": str(actor["_id"]), "role": "admin", "email": actor["email"], "full_name": actor.get("full_name")}


@router.post("/logout", status_code=204)
def logout(actor=Depends(get_current_actor), database=Depends(get_database)):
    document = revocation_document(actor)
    database.revoked_tokens.update_one({"jti": document["jti"]}, {"$setOnInsert": document}, upsert=True)
    return None