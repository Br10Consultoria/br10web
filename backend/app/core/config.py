"""
BR10 NetManager - Core Configuration
Configuração central da aplicação com validação e segurança.
"""
import secrets
from typing import List, Optional
from pydantic_settings import BaseSettings
from pydantic import AnyHttpUrl, validator


class Settings(BaseSettings):
    # Application
    APP_NAME: str = "BR10 NetManager"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    API_V1_STR: str = "/api/v1"

    # Security
    SECRET_KEY: str = secrets.token_urlsafe(64)
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    BCRYPT_ROUNDS: int = 12
    MAX_LOGIN_ATTEMPTS: int = 5
    LOCKOUT_DURATION_MINUTES: int = 30

    # 2FA
    TOTP_ISSUER: str = "BR10 NetManager"

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://br10user:br10password@localhost:5432/br10netmanager"
    DATABASE_URL_SYNC: str = "postgresql://br10user:br10password@localhost:5432/br10netmanager"

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # File Storage
    UPLOAD_DIR: str = "/app/uploads"
    MAX_FILE_SIZE_MB: int = 10
    ALLOWED_IMAGE_TYPES: List[str] = ["jpg", "jpeg", "png", "gif", "webp"]

    # Backup
    BACKUP_DIR: str = "/app/backups"
    BACKUP_RETENTION_DAYS: int = 30

    # CORS
    ALLOWED_ORIGINS: List[str] = [
        "https://br10web.br10consultoria.com.br",
        "http://localhost:3000",
        "http://localhost:5173",
    ]

    # Encryption key for device passwords (Fernet)
    ENCRYPTION_KEY: Optional[str] = None

    # Rate Limiting
    RATE_LIMIT_PER_MINUTE: int = 60
    RATE_LIMIT_LOGIN_PER_MINUTE: int = 5

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
