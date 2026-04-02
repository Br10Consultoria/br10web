"""
BR10 NetManager - Security Module
Implementa hashing de senhas, JWT, criptografia e 2FA.
Usa bcrypt diretamente (sem passlib) para evitar incompatibilidades de versão.
"""
import base64
import os
import secrets
from datetime import datetime, timedelta
from typing import Any, Dict, Optional, Union

import bcrypt
import pyotp
import qrcode
import io
from cryptography.fernet import Fernet
from jose import JWTError, jwt

from app.core.config import settings

# ─── Password Hashing (bcrypt direto, sem passlib) ───────────────────────────

def hash_password(password: str) -> str:
    """Gera hash seguro da senha usando bcrypt."""
    # bcrypt tem limite de 72 bytes; fazemos pré-hash com SHA-256 para suportar senhas longas
    import hashlib
    password_bytes = password.encode("utf-8")
    # Pré-hash para suportar senhas maiores que 72 bytes com segurança
    prehashed = base64.b64encode(hashlib.sha256(password_bytes).digest())
    salt = bcrypt.gensalt(rounds=settings.BCRYPT_ROUNDS)
    hashed = bcrypt.hashpw(prehashed, salt)
    return hashed.decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifica senha contra hash bcrypt."""
    try:
        import hashlib
        password_bytes = plain_password.encode("utf-8")
        prehashed = base64.b64encode(hashlib.sha256(password_bytes).digest())
        return bcrypt.checkpw(prehashed, hashed_password.encode("utf-8"))
    except Exception:
        return False


# ─── JWT Tokens ──────────────────────────────────────────────────────────────
def create_access_token(
    subject: Union[str, Any],
    expires_delta: Optional[timedelta] = None,
    extra_claims: Optional[Dict] = None,
) -> str:
    """Cria JWT de acesso com claims adicionais opcionais."""
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(
            minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
        )

    to_encode: Dict[str, Any] = {
        "exp": expire,
        "iat": datetime.utcnow(),
        "sub": str(subject),
        "type": "access",
        "jti": secrets.token_urlsafe(16),
    }

    if extra_claims:
        to_encode.update(extra_claims)

    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_refresh_token(subject: Union[str, Any]) -> str:
    """Cria JWT de refresh de longa duração."""
    expire = datetime.utcnow() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode = {
        "exp": expire,
        "iat": datetime.utcnow(),
        "sub": str(subject),
        "type": "refresh",
        "jti": secrets.token_urlsafe(16),
    }
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str) -> Optional[Dict]:
    """Decodifica e valida JWT, retorna None se inválido."""
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )
        return payload
    except JWTError:
        return None


# ─── 2FA / TOTP ──────────────────────────────────────────────────────────────
def generate_totp_secret() -> str:
    """Gera segredo TOTP aleatório para 2FA."""
    return pyotp.random_base32()


def get_totp_uri(secret: str, username: str) -> str:
    """Retorna URI TOTP para QR Code."""
    totp = pyotp.TOTP(secret)
    return totp.provisioning_uri(
        name=username,
        issuer_name=settings.TOTP_ISSUER,
    )


def generate_qr_code_base64(uri: str) -> str:
    """Gera QR Code em base64 para exibição no frontend com prefixo data URI."""
    qr = qrcode.QRCode(version=1, box_size=10, border=5)
    qr.add_data(uri)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    buffer.seek(0)
    img_base64 = base64.b64encode(buffer.read()).decode("utf-8")
    return f"data:image/png;base64,{img_base64}"


def verify_totp(secret: str, token: str) -> bool:
    """Verifica token TOTP com janela de 1 período de tolerância."""
    totp = pyotp.TOTP(secret)
    return totp.verify(token, valid_window=1)


# ─── Field-Level Encryption (Fernet) ─────────────────────────────────────────
def get_fernet() -> Fernet:
    """Retorna instância Fernet para criptografia de campos sensíveis."""
    import hashlib
    
    # Tentar usar ENCRYPTION_KEY se fornecida
    if settings.ENCRYPTION_KEY:
        try:
            # Verificar se é uma chave Fernet válida (32 bytes base64)
            key = settings.ENCRYPTION_KEY.encode()
            return Fernet(key)
        except Exception:
            # Se inválida, gerar chave derivada do SECRET_KEY
            pass
    
    # Fallback: gerar chave válida a partir do SECRET_KEY
    key_bytes = hashlib.sha256(settings.SECRET_KEY.encode()).digest()
    key = base64.urlsafe_b64encode(key_bytes)
    return Fernet(key)


def encrypt_field(value: str) -> str:
    """Criptografa campo sensível (ex: senha de dispositivo)."""
    if not value:
        return value
    f = get_fernet()
    return f.encrypt(value.encode()).decode()


def decrypt_field(encrypted_value: str) -> str:
    """Descriptografa campo sensível."""
    if not encrypted_value:
        return encrypted_value
    f = get_fernet()
    return f.decrypt(encrypted_value.encode()).decode()


# ─── Utilities ───────────────────────────────────────────────────────────────
def generate_secure_password(length: int = 16) -> str:
    """Gera senha aleatória segura."""
    alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*"
    return "".join(secrets.choice(alphabet) for _ in range(length))
