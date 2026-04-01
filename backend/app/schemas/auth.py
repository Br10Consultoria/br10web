"""
BR10 NetManager - Auth Schemas
Schemas Pydantic para autenticação e gerenciamento de usuários.
"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, EmailStr, validator, Field
import re


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=8)
    totp_code: Optional[str] = Field(None, min_length=6, max_length=6)


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user_id: str
    username: str
    role: str
    requires_2fa: bool = False
    two_fa_setup_required: bool = False


class TwoFASetupResponse(BaseModel):
    secret: str
    qr_code_base64: str
    provisioning_uri: str


class TwoFAVerifyRequest(BaseModel):
    totp_code: str = Field(..., min_length=6, max_length=6)


class RefreshTokenRequest(BaseModel):
    refresh_token: str


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=8)
    new_password: str = Field(..., min_length=8)
    confirm_password: str = Field(..., min_length=8)

    @validator("new_password")
    def validate_password_strength(cls, v):
        if not re.search(r"[A-Z]", v):
            raise ValueError("Senha deve conter ao menos uma letra maiúscula")
        if not re.search(r"[a-z]", v):
            raise ValueError("Senha deve conter ao menos uma letra minúscula")
        if not re.search(r"\d", v):
            raise ValueError("Senha deve conter ao menos um número")
        if not re.search(r"[!@#$%^&*(),.?\":{}|<>]", v):
            raise ValueError("Senha deve conter ao menos um caractere especial")
        return v

    @validator("confirm_password")
    def passwords_match(cls, v, values):
        if "new_password" in values and v != values["new_password"]:
            raise ValueError("Senhas não coincidem")
        return v


class UserCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: EmailStr
    full_name: str = Field(..., min_length=2, max_length=255)
    password: str = Field(..., min_length=8)
    role: str = "viewer"
    phone: Optional[str] = None

    @validator("password")
    def validate_password_strength(cls, v):
        if not re.search(r"[A-Z]", v):
            raise ValueError("Senha deve conter ao menos uma letra maiúscula")
        if not re.search(r"[a-z]", v):
            raise ValueError("Senha deve conter ao menos uma letra minúscula")
        if not re.search(r"\d", v):
            raise ValueError("Senha deve conter ao menos um número")
        if not re.search(r"[!@#$%^&*(),.?\":{}|<>]", v):
            raise ValueError("Senha deve conter ao menos um caractere especial")
        return v


class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    full_name: Optional[str] = Field(None, min_length=2, max_length=255)
    role: Optional[str] = None
    phone: Optional[str] = None
    is_active: Optional[bool] = None


class UserResponse(BaseModel):
    id: str
    username: str
    email: str
    full_name: str
    role: str
    is_active: bool
    is_verified: bool
    totp_enabled: bool
    last_login: Optional[datetime]
    last_login_ip: Optional[str]
    created_at: datetime
    avatar_url: Optional[str]
    phone: Optional[str]

    class Config:
        from_attributes = True
