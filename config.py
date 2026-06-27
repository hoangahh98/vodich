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


DATABASE_URL = os.environ.get("DATABASE_URL")

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

DB_CONFIG_ERROR = None
for key in ("user", "password", "host", "port"):
    if not DB_CONFIG.get(key):
        DB_CONFIG_ERROR = "Missing database config. Set DATABASE_URL or DB_* environment variables."
        break

FLASK_SECRET_KEY = os.environ.get("FLASK_SECRET_KEY") or os.environ.get("SECRET_KEY") or "dev-change-me"
DB_POOL_MIN = max(1, _env_int("DB_POOL_MIN", 1))
DB_POOL_MAX = max(DB_POOL_MIN, _env_int("DB_POOL_MAX", 5))
SUPER_ADMIN_EMAIL = os.environ.get("SUPER_ADMIN_EMAIL", "admin@dulich").strip().lower()
DEFAULT_ADMIN_PASSWORD = os.environ.get("DEFAULT_ADMIN_PASSWORD", "123456789")
APP_NAME = "Quan ly thu chi du lich"
