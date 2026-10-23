from functools import lru_cache

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    mongodb_uri: str = Field(validation_alias="MONGODB_URI")
    mongodb_database: str = Field(default="rishiride", validation_alias="MONGODB_DATABASE")
    jwt_secret: SecretStr = Field(validation_alias="JWT_SECRET")
    access_token_minutes: int = Field(default=30, ge=5, le=1440, validation_alias="ACCESS_TOKEN_MINUTES")
    cors_origins: str = Field(default="http://localhost:8081,http://localhost:3000", validation_alias="CORS_ORIGINS")
    whatsapp_access_token: SecretStr | None = Field(default=None, validation_alias="WHATSAPP_ACCESS_TOKEN")
    whatsapp_phone_number_id: str | None = Field(default=None, validation_alias="WHATSAPP_PHONE_NUMBER_ID")
    whatsapp_otp_template: str = Field(default="driver_signup_otp", validation_alias="WHATSAPP_OTP_TEMPLATE")
    whatsapp_api_version: str = Field(default="v23.0", validation_alias="WHATSAPP_API_VERSION")

    @field_validator("jwt_secret")
    @classmethod
    def require_strong_jwt_secret(cls, secret: SecretStr) -> SecretStr:
        if len(secret.get_secret_value()) < 32:
            raise ValueError("JWT_SECRET must contain at least 32 characters")
        return secret

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()