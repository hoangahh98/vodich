from auth import AuthService
from config import DEFAULT_ADMIN_PASSWORD, SUPER_ADMIN_EMAIL
from db import db_cursor


def init_schema():
    with db_cursor(commit=True) as cursor:
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS travel_users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) NOT NULL UNIQUE,
                password_hash VARCHAR(255) NOT NULL,
                role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'viewer')),
                display_name VARCHAR(255) NOT NULL DEFAULT '',
                active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS trips (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                owner_admin_id INTEGER REFERENCES travel_users(id) ON DELETE SET NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS trip_admin_permissions (
                id SERIAL PRIMARY KEY,
                trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                admin_id INTEGER NOT NULL REFERENCES travel_users(id) ON DELETE CASCADE,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (trip_id, admin_id)
            );

            CREATE TABLE IF NOT EXISTS trip_members (
                id SERIAL PRIMARY KEY,
                trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES travel_users(id) ON DELETE SET NULL,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) NOT NULL DEFAULT '',
                active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS trip_collections (
                id SERIAL PRIMARY KEY,
                trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                member_id INTEGER NOT NULL REFERENCES trip_members(id) ON DELETE CASCADE,
                amount NUMERIC(14, 0) NOT NULL DEFAULT 0,
                note TEXT NOT NULL DEFAULT '',
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (trip_id, member_id)
            );

            CREATE TABLE IF NOT EXISTS trip_expenses (
                id SERIAL PRIMARY KEY,
                trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                spent_date DATE NOT NULL DEFAULT CURRENT_DATE,
                title VARCHAR(255) NOT NULL,
                amount NUMERIC(14, 0) NOT NULL CHECK (amount >= 0),
                note TEXT NOT NULL DEFAULT '',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS trip_expense_splits (
                id SERIAL PRIMARY KEY,
                expense_id INTEGER NOT NULL REFERENCES trip_expenses(id) ON DELETE CASCADE,
                member_id INTEGER NOT NULL REFERENCES trip_members(id) ON DELETE CASCADE,
                amount NUMERIC(14, 0) NOT NULL DEFAULT 0 CHECK (amount >= 0),
                UNIQUE (expense_id, member_id)
            );
            """
        )
        cursor.execute(
            """
            INSERT INTO travel_users (email, password_hash, role, display_name)
            VALUES (%s, %s, 'admin', 'Admin')
            ON CONFLICT (email) DO NOTHING;
            """,
            (SUPER_ADMIN_EMAIL, AuthService.hash_password(DEFAULT_ADMIN_PASSWORD)),
        )
