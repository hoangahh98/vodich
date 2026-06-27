import os
from urllib.parse import parse_qs, unquote, urlparse

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:
    def load_dotenv(path=".env"):
        if not os.path.exists(path):
            return
        with open(path, encoding="utf-8") as env_file:
            for line in env_file:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

load_dotenv()

DATABASE_URL = os.environ.get("DATABASE_URL")


def _env_bool(name, default=False):
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name, default):
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _db_config_from_url(database_url):
    parsed = urlparse(database_url)
    query = parse_qs(parsed.query)
    config = {
        "dbname": parsed.path.lstrip("/") or "postgres",
        "user": unquote(parsed.username) if parsed.username else None,
        "password": unquote(parsed.password) if parsed.password else None,
        "host": parsed.hostname,
        "port": str(parsed.port or 5432),
    }
    if query.get("sslmode"):
        config["sslmode"] = query["sslmode"][0]
    return config


if DATABASE_URL:
    DB_CONFIG = _db_config_from_url(DATABASE_URL)
else:
    DB_CONFIG = {
        "dbname": os.environ.get("DB_NAME", "postgres"),
        "user": os.environ.get("DB_USER"),
        "password": os.environ.get("DB_PASSWORD"),
        "host": os.environ.get("DB_HOST"),
        "port": os.environ.get("DB_PORT", "5432"),
    }

_DB_ENV_NAMES = {
    "user": "DB_USER",
    "password": "DB_PASSWORD",
    "host": "DB_HOST",
    "port": "DB_PORT",
}

DB_CONFIG_MISSING = [
    _DB_ENV_NAMES[key]
    for key in ("user", "password", "host", "port")
    if not DB_CONFIG.get(key)
]

DB_CONFIG_PLACEHOLDERS = [
    _DB_ENV_NAMES[key]
    for key in ("user", "password", "host")
    if str(DB_CONFIG.get(key, "")).upper() in {"USER", "PASSWORD", "HOST"}
]

if DB_CONFIG_MISSING or DB_CONFIG_PLACEHOLDERS:
    error_parts = []
    if DB_CONFIG_MISSING:
        error_parts.append(f"Missing database environment variables: {', '.join(DB_CONFIG_MISSING)}")
    if DB_CONFIG_PLACEHOLDERS:
        error_parts.append(f"DATABASE_URL still contains placeholder values for: {', '.join(DB_CONFIG_PLACEHOLDERS)}")
    DB_CONFIG_ERROR = "; ".join(error_parts)
    DB_CONFIG = {
        "dbname": DB_CONFIG.get("dbname") or "postgres",
        "user": DB_CONFIG.get("user") or "__missing_db_user__",
        "password": DB_CONFIG.get("password") or "__missing_db_password__",
        "host": DB_CONFIG.get("host") or "__missing_db_host__.invalid",
        "port": DB_CONFIG.get("port") or "5432",
    }
else:
    DB_CONFIG_ERROR = None

# ============ FLASK CONFIG ============
FLASK_SECRET_KEY = os.environ.get("FLASK_SECRET_KEY") or os.environ.get("SECRET_KEY")
FLASK_SECRET_KEY_ERROR = None if FLASK_SECRET_KEY else "Missing Flask secret environment variable: FLASK_SECRET_KEY"
DEBUG = False  # Set True only when developing locally

# ============ FILE UPLOAD CONFIG ============
UPLOAD_FOLDER = "static/uploads"
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}

# ============ APP SETTINGS ============
APP_NAME = "Pickleball Tournament Manager"
APP_VERSION = "1.0.0"
BASE_URL = os.environ.get("BASE_URL", "https://pickleball-1-hsk7.onrender.com")


def normalize_admin_user(value):
    return (value or "").strip().lower().split("@", 1)[0]


SUPER_ADMIN_EMAIL = normalize_admin_user(os.environ.get("SUPER_ADMIN_EMAIL", "admin"))

# ============ PERFORMANCE SETTINGS ============
DB_POOL_MIN = max(1, _env_int("DB_POOL_MIN", 1))
DB_POOL_MAX = max(DB_POOL_MIN, _env_int("DB_POOL_MAX", 5))
LOG_ALL_REQUESTS = _env_bool("LOG_ALL_REQUESTS", False)
LOG_GET_REQUESTS = _env_bool("LOG_GET_REQUESTS", False)
SLOW_REQUEST_MS = max(0, _env_int("SLOW_REQUEST_MS", 1200))
