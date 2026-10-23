import math
import re
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query

from app.database.mongodb import get_database
from app.dependencies.auth import require_admin
from app.schemas.admin import ApprovalUpdate, SuspensionUpdate
from app.services.driver_service import public_driver, utc_now

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/drivers")
def list_drivers(
    page: int = Query(default=1, ge=1), page_size: int = Query(default=20, ge=1, le=100),
    search: str | None = Query(default=None, max_length=100),
    profile_status: str | None = None, availability_status: str | None = None,
    vehicle_type: str | None = None, admin=Depends(require_admin), database=Depends(get_database),
):
    query = {}
    for key, value in (("profile_status", profile_status), ("availability_status", availability_status), ("vehicle_type", vehicle_type)):
        if value:
            query[key] = value
    if search:
        pattern = re.escape(search.strip())
        query["$or"] = [{field: {"$regex": pattern, "$options": "i"}} for field in ("full_name", "phone", "email", "vehicle_number")]
    offset = (page - 1) * page_size
    items = [public_driver(row) for row in database.drivers.find(query).sort("created_at", -1).skip(offset).limit(page_size)]
    total = database.drivers.count_documents(query)
    counts = {status: database.drivers.count_documents({**query, "profile_status": status}) for status in ("pending", "approved", "rejected")}
    return {"items": items, "total": total, "page": page, "page_size": page_size,
            "pages": math.ceil(total / page_size), "counts": counts}


@router.get("/drivers/{driver_id}")
def get_driver(driver_id: str, admin=Depends(require_admin), database=Depends(get_database)):
    if not ObjectId.is_valid(driver_id):
        raise HTTPException(status_code=404, detail="Driver not found")
    driver = database.drivers.find_one({"_id": ObjectId(driver_id)})
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    completed = database.rides.count_documents({"driver_id": driver["_id"], "ride_status": "completed"})
    cancelled = database.rides.count_documents({"driver_id": driver["_id"], "ride_status": "cancelled"})
    result = public_driver(driver)
    license_number = driver.get("driving_license_number", "")
    result["driving_license_number_masked"] = f"{'*' * max(0, len(license_number) - 4)}{license_number[-4:]}" if license_number else None
    result["ride_statistics"] = {"completed": completed, "cancelled": cancelled}
    return result


@router.patch("/drivers/{driver_id}/approval")
def decide_driver_approval(driver_id: str, payload: ApprovalUpdate, admin=Depends(require_admin), database=Depends(get_database)):
    if payload.profile_status.value not in {"approved", "rejected"}:
        raise HTTPException(status_code=422, detail="Approval must be approved or rejected")
    if not ObjectId.is_valid(driver_id):
        raise HTTPException(status_code=404, detail="Driver not found")
    now = utc_now()
    updates = {"profile_status": payload.profile_status.value, "is_verified": payload.profile_status.value == "approved",
               "approval_decided_at": now, "approval_decided_by": admin["_id"], "updated_at": now}
    if payload.profile_status.value == "rejected":
        updates["availability_status"] = "offline"
    driver = database.drivers.find_one_and_update(
        {"_id": ObjectId(driver_id)},
        {"$set": updates},
        return_document=True,
    )
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    database.admin_audit_logs.insert_one({"admin_id": admin["_id"], "driver_id": driver["_id"], "action": "approval_decision",
                                          "decision": payload.profile_status.value, "created_at": now})
    return public_driver(driver)


@router.patch("/drivers/{driver_id}/suspend")
def change_driver_suspension(driver_id: str, payload: SuspensionUpdate, admin=Depends(require_admin), database=Depends(get_database)):
    if not ObjectId.is_valid(driver_id):
        raise HTTPException(status_code=404, detail="Driver not found")
    now = utc_now()
    updates = {"is_suspended": payload.suspended, "updated_at": now}
    if payload.suspended:
        updates["availability_status"] = "offline"
    driver = database.drivers.find_one_and_update(
        {"_id": ObjectId(driver_id)}, {"$set": updates}, return_document=True,
    )
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    database.admin_audit_logs.insert_one({"admin_id": admin["_id"], "driver_id": driver["_id"],
                                          "action": "suspension_changed", "suspended": payload.suspended,
                                          "reason": payload.reason, "created_at": now})
    return public_driver(driver)


@router.get("/stats")
def get_stats(admin=Depends(require_admin), database=Depends(get_database)):
    drivers = database.drivers
    return {
        "total_drivers": drivers.count_documents({}),
        "pending_approvals": drivers.count_documents({"profile_status": "pending"}),
        "approved_drivers": drivers.count_documents({"profile_status": "approved"}),
        "online_drivers": drivers.count_documents({"availability_status": "online"}),
        "drivers_on_rides": drivers.count_documents({"availability_status": "on_ride"}),
        "completed_rides": database.rides.count_documents({"ride_status": "completed"}),
    }