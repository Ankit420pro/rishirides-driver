# RishiRide Driver Management API

The backend provides driver and passenger APIs, with separate `mobile/` Expo driver and `admin-web/` React clients. Passenger rides are stored in the same MongoDB database and assigned to drivers through the ride API.

## Requirements and Setup

- Python 3.11 or newer
- MongoDB 6+ locally or a MongoDB Atlas deployment
- A virtual environment

From `backend/`:

```sh
python3 -m venv ../.venv
source ../.venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Set `MONGODB_URI` to a local URI or Atlas connection string and replace `JWT_SECRET` with a random secret of at least 32 characters. Never commit `.env`. The API uses the `rishiride` database by default. Allowed browser origins are an explicit comma-separated list in `CORS_ORIGINS`.

Start MongoDB, then run:

```sh
cd backend
../.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Swagger UI: <http://127.0.0.1:8000/docs>. Health check: <http://127.0.0.1:8000/health>.

Start the driver app in another terminal:

```sh
cd mobile
npm install
cp .env.example .env
# Set EXPO_PUBLIC_API_URL for your device/platform, then:
npm start
```

For the admin dashboard:

```sh
cd admin-web
npm install
cp .env.example .env
# Set VITE_API_URL and add the browser origin to backend CORS_ORIGINS.
npm run dev
```

The admin development server defaults to <http://localhost:5173>. Build it with `npm run build`.

Create the first admin through the interactive management command; it prompts for credentials and hashes the password:

```sh
cd backend
../.venv/bin/python -m app.cli create-admin
```

Run tests with the same environment activated:

```sh
cd backend
../.venv/bin/python -m pytest -q
```

Tests use `mongomock` and a dedicated in-memory test database. They do not connect to, clear, or reset a production MongoDB instance.

## Environment Variables

| Name | Required | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | Yes | Local MongoDB or Atlas URI |
| `MONGODB_DATABASE` | No | Database name; defaults to `rishiride` |
| `JWT_SECRET` | Yes | HS256 signing key, minimum 32 characters |
| `ACCESS_TOKEN_MINUTES` | No | Access token lifetime, defaults to 30 minutes |
| `CORS_ORIGINS` | No | Explicit comma-separated browser origins |
| `WHATSAPP_ACCESS_TOKEN` | For driver signup | Meta WhatsApp Cloud API access token; keep it secret |
| `WHATSAPP_PHONE_NUMBER_ID` | For driver signup | Meta Cloud API phone number ID |
| `WHATSAPP_OTP_TEMPLATE` | No | Approved WhatsApp template with one body parameter; defaults to `driver_signup_otp` |
| `WHATSAPP_API_VERSION` | No | Graph API version; defaults to `v23.0` |

For the admin dev server include `http://localhost:5173` in `CORS_ORIGINS`. For Expo web, include the actual browser origin. Physical mobile and native emulator requests do not use browser CORS.

There is no refresh-token endpoint: access tokens expire and clients sign in again. Logout revokes the presented token until its expiration.

## Collections and Indexes

The API creates indexes at startup:

- `drivers`: unique `email`, unique `phone`, compound approval/availability, vehicle type/registration date.
- `passengers`: unique `phone`.
- `rides`: ride status/request time, driver/status, passenger/request time.
- `admins`: unique email.
- `revoked_tokens`: unique token ID and TTL expiration.
- `admin_audit_logs`: descending event time.

Passenger accounts are stored in the `passengers` MongoDB collection and are not deleted on login/logout; successful logins also save `last_login_at`. Each ride stores the passenger ID and a small name/phone snapshot, along with passenger count, luggage count, pickup/drop-off addresses and optional coordinates. Available ride requests hide passenger ID/name/phone. Assigned ride details include them.

## API

All application routes use the `/api` prefix. Access tokens are sent as `Authorization: Bearer <token>`.

| Method | Endpoint | Access |
| --- | --- | --- |
| POST | `/api/auth/driver/signup/otp` | Public, rate-limited; sends WhatsApp OTP |
| POST | `/api/auth/driver/signup` | Public, rate-limited |
| POST | `/api/auth/driver/login` | Public, rate-limited |
| POST | `/api/auth/passenger/signup/otp` | Public, rate-limited; sends WhatsApp OTP |
| POST | `/api/auth/passenger/signup` | Public, rate-limited |
| POST | `/api/auth/passenger/login` | Public, rate-limited |
| POST | `/api/auth/admin/login` | Public, rate-limited |
| GET | `/api/auth/me` | Authenticated |
| POST | `/api/auth/logout` | Authenticated |
| GET | `/api/drivers/me` | Driver |
| PUT | `/api/drivers/me` | Driver; permitted profile fields only |
| PATCH | `/api/drivers/me/availability` | Driver; online requires approval |
| GET | `/api/drivers/me/rides` | Driver's active rides |
| GET | `/api/drivers/me/rides/history` | Driver's completed/cancelled rides |
| GET | `/api/drivers/me/stats` | Driver's completed/cancelled ride counts |
| GET | `/api/rides/available` | Approved online driver |
| POST | `/api/rides/{ride_id}/accept` | Approved online driver; accepted ride and passenger ID/details |
| PATCH | `/api/rides/{ride_id}/status` | Assigned driver |
| POST | `/api/passengers/me/rides` | Passenger; request a ride |
| GET | `/api/passengers/me/rides` | Passenger; list their rides |
| GET | `/api/admin/drivers` | Admin; pagination and filters |
| GET | `/api/admin/drivers/{driver_id}` | Admin; masked license and ride statistics |
| PATCH | `/api/admin/drivers/{driver_id}/approval` | Admin; approve/reject and audit |
| PATCH | `/api/admin/drivers/{driver_id}/suspend` | Admin; suspend/reactivate and audit |
| GET | `/api/admin/stats` | Admin |

Driver status transitions are `accepted -> driver_arriving -> in_progress -> completed`; cancellation is permitted before `in_progress`. Ride claims use a conditional MongoDB update and only the assigned driver can inspect or update an assigned ride.

Request a WhatsApp verification code before signup:

```json
{"phone": "+14155552671"}
```

Send this to `POST /api/auth/driver/signup/otp`. Configure an approved WhatsApp authentication template matching `WHATSAPP_OTP_TEMPLATE`, with a body variable for the six-digit code. OTPs expire after five minutes, allow up to five attempts, and are consumed once. The driver profile is inserted only after a valid OTP is provided. Driver signup and login use a phone number; email remains optional for older driver records. Admin login continues to use email.

Signup example:

```json
{
  "full_name": "Asha Rao",
  "phone": "+14155552671",
  "password": "a-long-unique-passphrase",
  "otp": "123456",
  "vehicle_type": "car",
  "vehicle_number": "KA01AB1234",
  "driving_license_number": "DL1234567890"
}
```

Signup returns a safe profile with `profile_status: "pending"`; it never returns a password hash or license number. A driver cannot go online or accept rides until an admin approves the account.

Driver login example:

```json
{"phone": "+14155552671", "password": "a-long-unique-passphrase"}
```

Successful driver login returns `access_token`, `token_type`, and `expires_in` seconds. Driver phone numbers use E.164 format. Admin login continues to accept an email address.

Passenger signup uses the same WhatsApp OTP flow and password requirements. After passenger login, submit a ride request with pickup/drop-off addresses, optional latitude/longitude coordinates, `passenger_count` (1-8), and `luggage_count` (0-10). The API fills in the passenger name and verified phone from the authenticated account; clients cannot spoof passenger identity in a ride request. Only one active ride per passenger is allowed. Passenger contact details are returned to a driver only after that driver accepts the ride.

For drivers, `POST /api/rides/{ride_id}/accept` returns the accepted ride including `passenger_id`, passenger name, and phone. The driver's `GET /api/drivers/me/rides` returns only their assigned active rides with those details; history is available from `GET /api/drivers/me/rides/history`. Before acceptance, `GET /api/rides/available` intentionally omits passenger identity.

Example passenger ride request:

```json
{
  "pickup_location": "Central Station",
  "destination": "Airport",
  "pickup_coordinates": {"latitude": 12.97, "longitude": 77.59},
  "destination_coordinates": {"latitude": 13.2, "longitude": 77.7},
  "passenger_count": 3,
  "luggage_count": 2
}
```

Admin driver listing supports `page`, `page_size` (maximum 100), `search`, `profile_status`, `availability_status`, and `vehicle_type`. Ride discovery currently uses polling; clients can poll `/api/rides/available` while online. No unauthenticated real-time channel is exposed.

## Connecting the Mobile App

The Expo client lives in `mobile/` and includes driver signup/login, SecureStore access-token storage, approval state, online status, polling ride requests, ride progression, recent history, completed counts, errors and logout. Set `EXPO_PUBLIC_API_URL` to a reachable `/api` URL: Android emulator `http://10.0.2.2:8000/api`, physical phone `http://<computer-LAN-IP>:8000/api`, and HTTPS in production. This is a separate client because no original Expo routes or authentication context were present to extend.

## Connecting the Admin Dashboard

The React/Vite dashboard lives in `admin-web/`. It provides admin sign-in, overview statistics, searchable/filterable/paginated driver records, driver details, approval/rejection, suspension/reactivation, and ride statistics. Configure `VITE_API_URL`, authenticate via `/api/auth/admin/login`, and use the backend's explicit CORS origin allowlist. The admin detail endpoint masks the license number; never render raw license values in tables or logs.

## Production Notes

Use HTTPS, Atlas network access controls, a randomly generated secret, and managed secret storage in production. Configure `CORS_ORIGINS` with exact trusted web origins. Passenger ride creation and passenger authentication are deliberately outside this driver-only module. Notification delivery is polling-only in this initial API; an authenticated WebSocket or push service can be added alongside the passenger backend and event infrastructure. The Expo install reported 26 transitive npm audit findings in the current Expo toolchain; forced npm fixes recommend incompatible major downgrades and were not applied.