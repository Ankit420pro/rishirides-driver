import httpx
from fastapi import HTTPException

from app.core.config import get_settings


def send_signup_otp(phone: str, code: str) -> None:
    settings = get_settings()
    access_token = settings.whatsapp_access_token
    phone_number_id = settings.whatsapp_phone_number_id
    if not access_token or not access_token.get_secret_value() or not phone_number_id:
        raise HTTPException(status_code=503, detail="WhatsApp OTP is not configured on the server")

    endpoint = f"https://graph.facebook.com/{settings.whatsapp_api_version}/{phone_number_id}/messages"
    payload = {
        "messaging_product": "whatsapp",
        "to": phone,
        "type": "template",
        "template": {
            "name": settings.whatsapp_otp_template,
            "language": {"code": "en_US"},
            "components": [{
                "type": "body",
                "parameters": [{"type": "text", "text": code}],
            }],
        },
    }
    try:
        response = httpx.post(
            endpoint,
            headers={"Authorization": f"Bearer {access_token.get_secret_value()}"},
            json=payload,
            timeout=10,
        )
        response.raise_for_status()
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Could not send WhatsApp verification code") from None