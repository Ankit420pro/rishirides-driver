import argparse
from getpass import getpass

from pymongo.errors import DuplicateKeyError

from app.core.security import hash_password
from app.database.mongodb import connect_database
from app.services.driver_service import utc_now


def create_admin() -> None:
    email = input("Admin email: ").strip().lower()
    full_name = input("Admin name: ").strip()
    password = getpass("Admin password (12+ characters): ")
    confirmation = getpass("Confirm password: ")
    if len(password) < 12 or password != confirmation:
        raise SystemExit("Passwords must match and contain at least 12 characters")
    client, database = connect_database()
    try:
        database.admins.insert_one({"email": email, "full_name": full_name,
                                    "password_hash": hash_password(password), "created_at": utc_now()})
    except DuplicateKeyError:
        raise SystemExit("An admin with that email already exists") from None
    finally:
        client.close()
    print("Admin account created.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="RishiRide administration tools")
    parser.add_argument("command", choices=["create-admin"])
    command = parser.parse_args().command
    if command == "create-admin":
        create_admin()