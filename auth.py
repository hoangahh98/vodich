"""
Há»‡ thá»‘ng xÃ¡c thá»±c cho Admin & VÄV
- Admin: email + password
- VÄV: email + password (123456789)
"""
from db import db_cursor
from functools import wraps
from flask import session, redirect, url_for
from config import normalize_admin_user

class AuthService:
    @staticmethod
    def hash_password(password):
        """Simple hash (trong production dÃ¹ng werkzeug.security.generate_password_hash)"""
        import hashlib
        return hashlib.sha256(password.encode()).hexdigest()

    @staticmethod
    def verify_password(plain, hashed):
        """Verify password"""
        return AuthService.hash_password(plain) == hashed

    @staticmethod
    def login_admin(email, password):
        """Login cho admin"""
        login_name = normalize_admin_user(email)
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT id, email, password
                FROM users
                WHERE role = 'admin'
                  AND (
                    lower(email) = lower(%s)
                    OR lower(split_part(email, '@', 1)) = lower(%s)
                  );
            """, (login_name, login_name))
            user = cursor.fetchone()

        if not user:
            return None, "Email khÃ´ng tá»“n táº¡i"

        if not AuthService.verify_password(password, user[2]):
            return None, "Máº­t kháº©u sai"

        return {"id": user[0], "email": normalize_admin_user(user[1]), "role": "admin"}, None

    @staticmethod
    def register_admin(email, password):
        """Táº¡o tÃ i khoáº£n admin (chá»‰ cáº¥u hÃ¬nh láº§n Ä‘áº§u)"""
        admin_user = normalize_admin_user(email)
        try:
            with db_cursor(commit=True) as cursor:
                cursor.execute("SELECT id FROM users WHERE role = 'admin' AND lower(email) = lower(%s);", (admin_user,))
                if cursor.fetchone():
                    return False, "User admin Ä‘Ã£ tá»“n táº¡i"

                hashed = AuthService.hash_password(password)
                cursor.execute("""
                    INSERT INTO users (email, password, role) VALUES (%s, %s, %s);
                """, (admin_user, hashed, "admin"))
            return True, "Táº¡o admin thÃ nh cÃ´ng"
        except Exception as e:
            return False, str(e)


def login_required(f):
    """Decorator: chá»‰ cho phÃ©p user Ä‘Ã£ login"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

def admin_required(f):
    """Decorator: chá»‰ cho phÃ©p admin"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user' not in session or session['user'].get('role') != 'admin':
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

def vdv_required(f):
    """Decorator: chá»‰ cho phÃ©p VÄV"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user' not in session or session['user'].get('role') != 'vdv':
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function
