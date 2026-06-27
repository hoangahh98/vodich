import hashlib
from functools import wraps

from flask import redirect, session, url_for

from config import normalize_admin_user
from db import db_cursor


class AuthService:
    @staticmethod
    def hash_password(password):
        return hashlib.sha256(password.encode("utf-8")).hexdigest()

    @staticmethod
    def verify_password(plain, hashed):
        return AuthService.hash_password(plain) == hashed

    @staticmethod
    def login(email, password, role):
        login_name = normalize_admin_user(email) if role == "admin" else (email or "").strip().lower()
        with db_cursor() as cursor:
            cursor.execute(
                """
                SELECT id, email, password_hash, role, display_name
                FROM travel_users
                WHERE role = %s
                  AND active = TRUE
                  AND (
                    lower(email) = lower(%s)
                    OR (%s = 'admin' AND lower(split_part(email, '@', 1)) = lower(%s))
                  );
                """,
                (role, login_name, role, login_name),
            )
            user = cursor.fetchone()
        if not user:
            return None, "User/email hoặc vai trò không đúng"
        if not AuthService.verify_password(password, user[2]):
            return None, "Mật khẩu sai"
        return {
            "id": user[0],
            "email": user[1],
            "role": user[3],
            "display_name": user[4] or user[1],
        }, None

    @staticmethod
    def register_admin(email, password, display_name="Admin"):
        email = normalize_admin_user(email)
        with db_cursor(commit=True) as cursor:
            cursor.execute("SELECT 1 FROM travel_users WHERE lower(email) = lower(%s);", (email,))
            if cursor.fetchone():
                return False, "User admin đã tồn tại"
            cursor.execute(
                """
                INSERT INTO travel_users (email, password_hash, role, display_name)
                VALUES (%s, %s, 'admin', %s);
                """,
                (email, AuthService.hash_password(password), display_name),
            )
        return True, "Tạo admin thành công"


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if "user" not in session:
            return redirect(url_for("login"))
        return fn(*args, **kwargs)
    return wrapper


def admin_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if "user" not in session or session["user"].get("role") != "admin":
            return redirect(url_for("login"))
        return fn(*args, **kwargs)
    return wrapper
