from datetime import datetime, timezone

from bson import ObjectId
from fastapi.testclient import TestClient

from app.main import create_app


def signup_payload(phone="+14155550101", otp="123456"):
    return {
        "full_name": "New Driver",
        "phone": phone,
        "password": "correct-horse-battery-12",
        "otp": otp,
        "vehicle_type": "auto",
        "vehicle_number": "KA02CD5678",
        "driving_license_number": "DL9876543210",
    }


def driver_token(api, phone="+14155550100", password="a-correct-horse-battery"):
    response = api.post("/api/auth/driver/login", json={"phone": phone, "password": password})
    assert response.status_code == 200
    return response.json()["access_token"]


def test_signup_hashes_password_and_returns_safe_profile(api, database, mock_whatsapp):
    assert api.post("/api/auth/driver/signup/otp", json={"phone": "+14155550101"}).status_code == 202
    response = api.post("/api/auth/driver/signup", json=signup_payload(otp=mock_whatsapp["code"]))
    assert response.status_code == 201
    assert response.json()["profile_status"] == "pending"
    assert response.json()["email"] is None
    assert "password_hash" not in response.json()
    assert "driving_license_number" not in response.json()
    stored = database.drivers.find_one({"phone": "+14155550101"})
    assert stored["password_hash"] != signup_payload()["password"]
    assert database.signup_otps.count_documents({}) == 0


def test_duplicate_driver_phone_returns_conflict(api, make_driver):
    make_driver()
    assert api.post("/api/auth/driver/signup/otp", json={"phone": "+14155550100"}).status_code == 409


def test_driver_login_and_invalid_credentials(api, make_driver):
    make_driver()
    assert api.post("/api/auth/driver/login", json={"phone": "+1 (415) 555-0100", "password": "a-correct-horse-battery"}).status_code == 200
    assert api.post("/api/auth/driver/login", json={"phone": "+14155550100", "password": "wrong-password"}).status_code == 401


def test_signup_requires_valid_single_use_otp(api, database, mock_whatsapp):
    api.post("/api/auth/driver/signup/otp", json={"phone": "+14155550101"})
    invalid = api.post("/api/auth/driver/signup", json=signup_payload(otp="000000"))
    assert invalid.status_code == 400
    assert database.drivers.count_documents({}) == 0
    valid = api.post("/api/auth/driver/signup", json=signup_payload(otp=mock_whatsapp["code"]))
    assert valid.status_code == 201
    replay = api.post("/api/auth/driver/signup", json=signup_payload(otp=mock_whatsapp["code"]))
    assert replay.status_code == 400


def test_passenger_can_request_ride_and_driver_gets_contact_after_acceptance(api, database, make_driver, mock_whatsapp):
    otp_request = api.post("/api/auth/passenger/signup/otp", json={"phone": "+14155550111"})
    assert otp_request.status_code == 202
    signup = api.post("/api/auth/passenger/signup", json={
        "full_name": "  Asha Rao  ",
        "phone": "+14155550111",
        "password": "a-correct-passenger-password",
        "otp": mock_whatsapp["code"],
    })
    assert signup.status_code == 201
    assert signup.json()["full_name"] == "Asha Rao"
    assert "password_hash" not in signup.json()
    assert database.passengers.find_one({"phone": "+14155550111"})["password_hash"] != "a-correct-passenger-password"

    login = api.post("/api/auth/passenger/login", json={
        "phone": "+14155550111",
        "password": "a-correct-passenger-password",
    })
    assert login.status_code == 200
    stored_passenger = database.passengers.find_one({"phone": "+14155550111"})
    assert stored_passenger["full_name"] == "Asha Rao"
    assert stored_passenger["phone"] == "+14155550111"
    assert stored_passenger["last_login_at"] is not None
    passenger_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    assert api.get("/api/auth/me", headers=passenger_headers).json()["full_name"] == "Asha Rao"
    requested = api.post("/api/passengers/me/rides", headers=passenger_headers, json={
        "pickup_location": "  Central Station ",
        "destination": "Airport",
        "pickup_coordinates": {"latitude": 12.97, "longitude": 77.59},
        "destination_coordinates": {"latitude": 13.2, "longitude": 77.7},
        "passenger_count": 3,
        "luggage_count": 2,
    })
    assert requested.status_code == 201
    assert requested.json()["pickup_location"] == "Central Station"
    assert requested.json()["passenger_count"] == 3
    assert requested.json()["luggage_count"] == 2
    assert api.post("/api/passengers/me/rides", headers=passenger_headers, json={
        "pickup_location": "Station", "destination": "Airport",
    }).status_code == 409
    assert api.get("/api/passengers/me/rides", headers=passenger_headers).json()[0]["destination"] == "Airport"

    make_driver()
    driver_headers = {"Authorization": f"Bearer {driver_token(api)}"}
    assert api.patch("/api/drivers/me/availability", json={"availability_status": "online"},
                     headers=driver_headers).status_code == 200
    ride_id = requested.json()["id"]
    available = api.get("/api/rides/available", headers=driver_headers).json()
    assert available[0]["passenger_count"] == 3
    assert available[0]["luggage_count"] == 2
    assert available[0]["passenger_id"] is None
    assert available[0]["passenger_name"] is None
    assert available[0]["passenger_phone"] is None
    accepted = api.post(f"/api/rides/{ride_id}/accept", headers=driver_headers)
    assert accepted.status_code == 200
    assert accepted.json()["passenger_id"] == signup.json()["id"]
    assert accepted.json()["passenger_name"] == "Asha Rao"
    assert accepted.json()["passenger_phone"] == "+14155550111"
    assert accepted.json()["destination_coordinates"] == {"latitude": 13.2, "longitude": 77.7}


def test_passenger_endpoints_require_passenger_role(api, make_driver):
    make_driver()
    headers = {"Authorization": f"Bearer {driver_token(api)}"}
    assert api.post("/api/passengers/me/rides", headers=headers, json={
        "pickup_location": "Station", "destination": "Airport",
    }).status_code == 403


def test_docs_and_health_are_available_when_database_is_offline():
    def unavailable_database():
        raise RuntimeError("MongoDB is offline")

    app = create_app(client_factory=unavailable_database)
    with TestClient(app) as client:
        assert client.get("/docs").status_code == 200
        assert client.get("/openapi.json").status_code == 200
        assert client.get("/health").status_code == 503
        response = client.post("/api/auth/driver/login", json={"phone": "+14155550100", "password": "pass"})
        assert response.status_code == 503


def test_jwt_protected_profile_and_logout(api, make_driver):
    make_driver()
    token = driver_token(api)
    assert api.get("/api/drivers/me").status_code == 401
    headers = {"Authorization": f"Bearer {token}"}
    assert api.get("/api/auth/me", headers=headers).json()["role"] == "driver"
    assert api.post("/api/auth/logout", headers=headers).status_code == 204
    assert api.get("/api/drivers/me", headers=headers).status_code == 401


def test_unapproved_driver_cannot_go_online_or_accept_ride(api, database, make_driver):
    driver_id = make_driver(profile_status="pending", is_verified=False)
    ride_id = database.rides.insert_one({"pickup_location": "A", "destination": "B", "ride_status": "requested",
                                         "driver_id": None, "requested_at": datetime.now(timezone.utc)}).inserted_id
    headers = {"Authorization": f"Bearer {driver_token(api)}"}
    assert api.patch("/api/drivers/me/availability", json={"availability_status": "online"}, headers=headers).status_code == 403
    assert api.post(f"/api/rides/{ride_id}/accept", headers=headers).status_code == 403
    assert database.drivers.find_one({"_id": driver_id})["availability_status"] == "offline"


def test_profile_update_and_approval_fields_are_not_writable(api, database, make_driver):
    driver_id = make_driver()
    headers = {"Authorization": f"Bearer {driver_token(api)}"}
    response = api.put("/api/drivers/me", json={"full_name": "  Updated Name  "}, headers=headers)
    assert response.status_code == 200
    assert response.json()["full_name"] == "Updated Name"
    forbidden = api.put("/api/drivers/me", json={"profile_status": "approved", "is_verified": True}, headers=headers)
    assert forbidden.status_code == 422
    assert database.drivers.find_one({"_id": driver_id})["profile_status"] == "approved"


def test_admin_authorization_search_and_approval_audit(api, database, make_admin, make_driver):
    driver_id = make_driver()
    assert api.get("/api/admin/drivers").status_code == 401
    driver_headers = {"Authorization": f"Bearer {driver_token(api)}"}
    assert api.get("/api/admin/drivers", headers=driver_headers).status_code == 403
    login = api.post("/api/auth/admin/login", json={"email": "admin@example.com", "password": "another-correct-horse"})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    found = api.get("/api/admin/drivers?search=KA01AB1234", headers=headers)
    assert found.status_code == 200
    assert found.json()["total"] == 1
    changed = api.patch(f"/api/admin/drivers/{driver_id}/approval", json={"profile_status": "rejected"}, headers=headers)
    assert changed.status_code == 200
    assert database.admin_audit_logs.count_documents({"action": "approval_decision"}) == 1


def test_ride_acceptance_conflict_and_ownership(api, database, make_driver):
    make_driver()
    token = driver_token(api)
    headers = {"Authorization": f"Bearer {token}"}
    assert api.patch("/api/drivers/me/availability", json={"availability_status": "online"}, headers=headers).status_code == 200
    ride_id = database.rides.insert_one({"passenger_id": str(ObjectId()), "pickup_location": "A",
                                         "destination": "B", "fare_estimate": 12.5, "ride_status": "requested",
                                         "requested_at": datetime.now(timezone.utc)}).inserted_id
    accepted = api.post(f"/api/rides/{ride_id}/accept", headers=headers)
    assert accepted.status_code == 200
    assert accepted.json()["ride_status"] == "accepted"
    assert api.post(f"/api/rides/{ride_id}/accept", headers=headers).status_code == 409
    another_driver = make_driver(email="second@example.com", phone="+14155550102")
    other_token = api.post("/api/auth/driver/login", json={"phone": "+14155550102", "password": "a-correct-horse-battery"}).json()["access_token"]
    assert api.patch(f"/api/rides/{ride_id}/status", json={"ride_status": "driver_arriving"},
                     headers={"Authorization": f"Bearer {other_token}"}).status_code == 404
    assert database.rides.find_one({"_id": ride_id})["driver_id"] != another_driver


def test_ride_status_transitions(api, database, make_driver):
    make_driver()
    headers = {"Authorization": f"Bearer {driver_token(api)}"}
    ride_id = database.rides.insert_one({"driver_id": database.drivers.find_one({"email": "driver@example.com"})["_id"],
                                         "pickup_location": "A", "destination": "B", "ride_status": "accepted",
                                         "requested_at": datetime.now(timezone.utc)}).inserted_id
    assert api.patch(f"/api/rides/{ride_id}/status", json={"ride_status": "in_progress"}, headers=headers).status_code == 409
    for state in ("driver_arriving", "in_progress", "completed"):
        response = api.patch(f"/api/rides/{ride_id}/status", json={"ride_status": state}, headers=headers)
        assert response.status_code == 200
    assert database.rides.find_one({"_id": ride_id})["completed_at"] is not None
    assert api.get("/api/drivers/me/stats", headers=headers).json()["completed_rides"] == 1