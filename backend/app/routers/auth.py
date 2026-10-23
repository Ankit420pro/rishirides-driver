import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pymongo.errors import DuplicateKeyError
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.config import get_settings
from app.core.security import create_access_token, hash_password, verify_password
from app.database.mongodb import get_database
from app.dependencies.auth import get_current_actor, revocation_document
from app.models.driver import AvailabilityStatus, ProfileStatus
from app.schemas.auth import AdminLogin, DriverLogin, DriverSignup, DriverSignupOtpRequest, SafeActor, TokenResponse
from app.services.driver_service import public_driver, utc_now
from app.services.whatsapp_service import send_signup_otp

router = APIRouter(prefix="/api/auth", tags=["authentication"])
limiter = Limiter(key_func=get_remote_address)


def _token_response(actor_id: str, role: str) -> TokenResponse:
    token, _ = create_access_token(actor_id, role)
    return TokenResponse(access_token=token, expires_in=get_settings().access_token_minutes * 60)


def _otp_digest(phone: str, code: str) -> str:
    secret = get_settings().jwt_secret.get_secret_value().encode()
    return hmac.new(secret, f"{phone}:{code}".encode(), hashlib.sha256).hexdigest()


@router.post("/driver/signup/otp", status_code=202)
@limiter.limit("5/minute")
def request_driver_signup_otp(request: Request, payload: DriverSignupOtpRequest, database=Depends(get_database)):
    if database.drivers.find_one({"phone": payload.phone}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="Phone is already registered")

    code = f"{secrets.randbelow(1_000_000):06d}"
    digest = _otp_digest(payload.phone, code)
    now = utc_now()
    database.signup_otps.update_one(
        {"phone": payload.phone},
        {"$set": {"otp_hash": digest, "attempts": 0, "created_at": now,
                   "expires_at": now + timedelta(minutes=5)}},
        upsert=True,
    )
    try:
        send_signup_otp(payload.phone, code)
    except HTTPException:
        database.signup_otps.delete_one({"phone": payload.phone, "otp_hash": digest})
        raise
    return {"detail": "Verification code sent to WhatsApp"}


@router.post("/driver/signup", response_model=SafeActor, status_code=201)
@limiter.limit("5/minute")
def driver_signup(request: Request, payload: DriverSignup, database=Depends(get_database)):
    now = utc_now()
    otp = database.signup_otps.find_one({"phone": payload.phone})
    if not otp or otp.get("expires_at") <= now:
        if otp:
            database.signup_otps.delete_one({"_id": otp["_id"]})
        raise HTTPException(status_code=400, detail="Request a new WhatsApp verification code")
    if otp.get("attempts", 0) >= 5:
        raise HTTPException(status_code=429, detail="Too many incorrect codes; request a new one")
    digest = _otp_digest(payload.phone, payload.otp)
    if not hmac.compare_digest(otp["otp_hash"], digest):
        database.signup_otps.update_one({"_id": otp["_id"]}, {"$inc": {"attempts": 1}})
        raise HTTPException(status_code=400, detail="Invalid WhatsApp verification code")
    if not database.signup_otps.find_one_and_delete({"_id": otp["_id"], "otp_hash": digest}):
        raise HTTPException(status_code=400, detail="Verification code has already been used")

    driver = {
        "full_name": payload.full_name,
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
        raise HTTPException(status_code=409, detail="Phone is already registered") from None
    driver["_id"] = result.inserted_id
    driver["role"] = "driver"
    return {"id": str(result.inserted_id), "role": "driver", **public_driver(driver)}


@router.post("/driver/login", response_model=TokenResponse)
@limiter.limit("10/minute")
def driver_login(request: Request, payload: DriverLogin, database=Depends(get_database)):
    driver = database.drivers.find_one({"phone": payload.phone})
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