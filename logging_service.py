import json
from flask import has_request_context, request
from config import DB_CONFIG_ERROR, LOG_GET_REQUESTS
from db import db_cursor
from schema import ensure_log_schema


class DBLogger:
    """Database logger. Logging failures must never crash the app."""

    _schema_ready = False

    @staticmethod
    def ensure_log_schema():
        if DBLogger._schema_ready:
            return
        if DB_CONFIG_ERROR:
            raise RuntimeError(DB_CONFIG_ERROR)

        try:
            ensure_log_schema()
            DBLogger._schema_ready = True
        except Exception:
            raise

    @staticmethod
    def log_error(message, user_email=None, route=None, method=None, status_code=None, context=None):
        DBLogger._insert_log("ERROR", message, user_email, route, method, status_code, context)

    @staticmethod
    def log_warning(message, user_email=None, route=None, context=None):
        DBLogger._insert_log("WARNING", message, user_email, route, context=context)

    @staticmethod
    def log_success(message, user_email=None, route=None, context=None):
        DBLogger._insert_log("SUCCESS", message, user_email, route, context=context)

    @staticmethod
    def log_info(message, user_email=None, route=None, context=None):
        DBLogger._insert_log("INFO", message, user_email, route, context=context)

    @staticmethod
    def log_request(method, route, user_email=None):
        if method == "GET" and not LOG_GET_REQUESTS:
            return
        DBLogger._insert_log("REQUEST", f"{method} {route}", user_email, route, method)

    @staticmethod
    def _insert_log(level, message, user_email=None, route=None, method=None, status_code=None, context=None):
        try:
            if DB_CONFIG_ERROR:
                DBLogger._safe_console_log(RuntimeError(DB_CONFIG_ERROR), level, message)
                return

            request_path = route
            request_method = method
            ip_address = None
            user_agent = None
            cf_ray = None
            if has_request_context():
                request_path = request.path
                request_method = request.method
                ip_address = request.headers.get("X-Forwarded-For", request.remote_addr)
                user_agent = request.headers.get("User-Agent")
                cf_ray = request.headers.get("CF-Ray")

            with db_cursor(commit=True) as cursor:
                cursor.execute("""
                    INSERT INTO app_logs (
                        log_level, message, context, user_email, route, method, status_code,
                        exception_type, request_path, request_method, ip_address, user_agent, cf_ray
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);
                """, (
                    level, message, context, user_email, route, method, status_code,
                    None, request_path, request_method, ip_address, user_agent, cf_ray
                ))
        except Exception as e:
            DBLogger._safe_console_log(e, level, message)

    @staticmethod
    def log_exception(message, exc, user_email=None, route=None, method=None, status_code=500, context=None,
                      request_path=None, ip_address=None, user_agent=None, cf_ray=None):
        try:
            if DB_CONFIG_ERROR:
                DBLogger._safe_console_log(RuntimeError(DB_CONFIG_ERROR), "ERROR", message)
                return

            if cf_ray is None and has_request_context():
                cf_ray = request.headers.get("CF-Ray")

            with db_cursor(commit=True) as cursor:
                cursor.execute("""
                    INSERT INTO app_logs (
                        log_level, message, context, user_email, route, method, status_code,
                        exception_type, request_path, request_method, ip_address, user_agent, cf_ray
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);
                """, (
                    "ERROR", message, context, user_email, route, method, status_code,
                    exc.__class__.__name__ if exc else None,
                    request_path, method, ip_address, user_agent, cf_ray
                ))
        except Exception as e:
            DBLogger._safe_console_log(e, "ERROR", message)

    @staticmethod
    def log_user_action(user_email=None, user_role=None, action=None, route=None, endpoint=None, method=None,
                        status_code=None, ip_address=None, user_agent=None, details=None, cf_ray=None):
        try:
            if DB_CONFIG_ERROR:
                DBLogger._safe_console_log(RuntimeError(DB_CONFIG_ERROR), "ACTION", action or route or "unknown")
                return

            if cf_ray is None and has_request_context():
                cf_ray = request.headers.get("CF-Ray")

            with db_cursor(commit=True) as cursor:
                cursor.execute("""
                    INSERT INTO user_actions (
                        user_email, user_role, action, route, endpoint, method, status_code,
                        ip_address, user_agent, cf_ray, details
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb);
                """, (
                    user_email, user_role, action, route, endpoint, method, status_code,
                    ip_address, user_agent, cf_ray, json.dumps(details or {}, ensure_ascii=False)
                ))
        except Exception as e:
            DBLogger._safe_console_log(e, "ACTION", action or route or "unknown")

    @staticmethod
    def _safe_console_log(error, level, message):
        try:
            if DB_CONFIG_ERROR:
                print(f"DB Config Error: {ascii(DB_CONFIG_ERROR)}")
            print(f"DB Log Error: {ascii(str(error))}")
            print(f"Original log: [{level}] {ascii(str(message))}")
        except Exception:
            pass


class DBLogViewer:
    """Query and view logs from database."""

    @staticmethod
    def get_recent_logs(limit=50, level=None, user_email=None, route=None):
        try:
            with db_cursor() as cursor:
                query = """
                    SELECT id, log_level, message, user_email, route, method, status_code, created_at
                    FROM app_logs
                    WHERE 1=1
                """
                params = []
                if level:
                    query += " AND log_level = %s"
                    params.append(level)
                if user_email:
                    query += " AND user_email = %s"
                    params.append(user_email)
                if route:
                    query += " AND route = %s"
                    params.append(route)
                query += " ORDER BY created_at DESC LIMIT %s;"
                params.append(limit)
                cursor.execute(query, params)
                return cursor.fetchall()
        except Exception:
            return []

    @staticmethod
    def get_errors_today():
        try:
            with db_cursor() as cursor:
                cursor.execute("""
                    SELECT id, message, user_email, route, created_at
                    FROM app_logs
                    WHERE log_level = 'ERROR' AND DATE(created_at) = CURRENT_DATE
                    ORDER BY created_at DESC;
                """)
                return cursor.fetchall()
        except Exception:
            return []

    @staticmethod
    def get_errors_last_hours(hours=24):
        try:
            with db_cursor() as cursor:
                cursor.execute("""
                    SELECT id, log_level, message, user_email, route, created_at
                    FROM app_logs
                    WHERE log_level = 'ERROR' AND created_at > NOW() - (%s * INTERVAL '1 hour')
                    ORDER BY created_at DESC;
                """, (hours,))
                return cursor.fetchall()
        except Exception:
            return []

    @staticmethod
    def get_user_actions(user_email):
        try:
            with db_cursor() as cursor:
                cursor.execute("""
                    SELECT id, action, route, method, status_code, created_at
                    FROM user_actions
                    WHERE user_email = %s
                    ORDER BY created_at DESC
                    LIMIT 100;
                """, (user_email,))
                return cursor.fetchall()
        except Exception:
            return []

    @staticmethod
    def get_log_stats():
        try:
            with db_cursor() as cursor:
                cursor.execute("""
                    SELECT log_level, COUNT(*) as count, DATE(created_at) as date
                    FROM app_logs
                    WHERE created_at > NOW() - INTERVAL '7 days'
                    GROUP BY log_level, DATE(created_at)
                    ORDER BY date DESC, log_level;
                """)
                return cursor.fetchall()
        except Exception:
            return []
