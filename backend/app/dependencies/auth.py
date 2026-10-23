from datetime import datetime, timezone

import jwt
from bson import ObjectId
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.security import decode_access_token
from app.database.mongodb import get_database

bearer = HTTPBearer(auto_error=False)


def get_current_actor(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    database=Depends(get_database),
) -> dict:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    try:
        payload = decode_access_token(credentials.credentials)
        actor_id = ObjectId(payload["sub"])
        role = payload["role"]
        token_id = payload["jti"]
    except (jwt.PyJWTError, KeyError, TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token") from None

    if database.revoked_tokens.find_one({"jti": token_id}):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    collection = database.admins if role == "admin" else database.drivers if role == "driver" else None
    actor = collection.find_one({"_id": actor_id}) if collection is not None else None
    if not actor:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    if role == "driver" and actor.get("is_suspended", False):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Driver account is suspended")
    actor["role"] = role
    actor["token_id"] = token_id
    actor["token_exp"] = payload["exp"]
    return actor


def require_driver(actor: dict = Depends(get_current_actor)) -> dict:
    if actor["role"] != "driver":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Driver access required")
    return actor


def require_admin(actor: dict = Depends(get_current_actor)) -> dict:
    if actor["role"] != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return actor


def revocation_document(actor: dict) -> dict:
    return {
        "jti": actor["token_id"],
        "expires_at": datetime.fromtimestamp(actor["token_exp"], tz=timezone.utc),
    }