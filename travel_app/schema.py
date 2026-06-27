from .auth import AuthService
from .config import DEFAULT_ADMIN_PASSWORD, SUPER_ADMIN_EMAIL
from .db import db_cursor


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
                owner_admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS trip_admin_permissions (
                id SERIAL PRIMARY KEY,
                trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (trip_id, admin_id)
            );

            CREATE TABLE IF NOT EXISTS travel_people (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) NOT NULL DEFAULT '',
                client_id INTEGER REFERENCES user_clients(id) ON DELETE SET NULL,
                owner_admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS trip_members (
                id SERIAL PRIMARY KEY,
                trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                person_id INTEGER REFERENCES travel_people(id) ON DELETE SET NULL,
                client_id INTEGER REFERENCES user_clients(id) ON DELETE SET NULL,
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

            DO $$
            BEGIN
                IF to_regclass('public.user_clients') IS NULL AND to_regclass('public.van_dong_vien') IS NOT NULL THEN
                    ALTER TABLE van_dong_vien RENAME TO user_clients;
                END IF;
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_clients' AND column_name = 'ten_vdv') THEN
                    ALTER TABLE user_clients RENAME COLUMN ten_vdv TO display_name;
                END IF;
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_clients' AND column_name = 'trinh_do') THEN
                    ALTER TABLE user_clients RENAME COLUMN trinh_do TO skill_level;
                END IF;
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_clients' AND column_name = 'ghi_chu') THEN
                    ALTER TABLE user_clients RENAME COLUMN ghi_chu TO notes;
                END IF;
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'travel_people' AND column_name = 'user_id') THEN
                    ALTER TABLE travel_people RENAME COLUMN user_id TO client_id;
                END IF;
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trip_members' AND column_name = 'user_id') THEN
                    ALTER TABLE trip_members RENAME COLUMN user_id TO client_id;
                END IF;
            END $$;

            CREATE TABLE IF NOT EXISTS user_clients (
                id SERIAL PRIMARY KEY,
                display_name VARCHAR(255) NOT NULL,
                skill_level VARCHAR(10) DEFAULT 'C',
                email VARCHAR(255) NOT NULL DEFAULT '',
                notes TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        cursor.execute("ALTER TABLE trip_members ADD COLUMN IF NOT EXISTS person_id INTEGER REFERENCES travel_people(id) ON DELETE SET NULL;")
        cursor.execute(
            """
            DO $$
            DECLARE
                fk record;
            BEGIN
                FOR fk IN
                    SELECT tc.table_name, tc.constraint_name
                    FROM information_schema.table_constraints tc
                    JOIN information_schema.key_column_usage kcu
                      ON tc.constraint_name = kcu.constraint_name
                     AND tc.table_schema = kcu.table_schema
                    WHERE tc.constraint_type = 'FOREIGN KEY'
                      AND tc.table_schema = 'public'
                      AND tc.table_name IN ('trips', 'trip_admin_permissions', 'travel_people', 'trip_members')
                      AND kcu.column_name IN ('owner_admin_id', 'admin_id', 'user_id', 'client_id')
                LOOP
                    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', fk.table_name, fk.constraint_name);
                END LOOP;
            END $$;

            INSERT INTO users (id, email, password, role)
            SELECT tu.id, split_part(lower(tu.email), '@', 1), tu.password_hash, 'admin'
            FROM travel_users tu
            WHERE tu.role = 'admin'
              AND NOT EXISTS (
                  SELECT 1
                  FROM users u
                  WHERE lower(u.email) = split_part(lower(tu.email), '@', 1)
                     OR u.id = tu.id
              );

            SELECT setval(
                pg_get_serial_sequence('users', 'id'),
                GREATEST(COALESCE((SELECT MAX(id) FROM users), 1), 1),
                true
            );

            UPDATE trips t
            SET owner_admin_id = u.id
            FROM travel_users tu
            INNER JOIN users u ON lower(u.email) = split_part(lower(tu.email), '@', 1)
            WHERE t.owner_admin_id = tu.id
              AND tu.role = 'admin';

            UPDATE trip_admin_permissions p
            SET admin_id = u.id
            FROM travel_users tu
            INNER JOIN users u ON lower(u.email) = split_part(lower(tu.email), '@', 1)
            WHERE p.admin_id = tu.id
              AND tu.role = 'admin';

            UPDATE travel_people p
            SET owner_admin_id = u.id
            FROM travel_users tu
            INNER JOIN users u ON lower(u.email) = split_part(lower(tu.email), '@', 1)
            WHERE p.owner_admin_id = tu.id
              AND tu.role = 'admin';

            INSERT INTO user_clients (display_name, skill_level, email, notes)
            SELECT p.name, 'C', p.email, ''
            FROM travel_people p
            WHERE p.active = TRUE
              AND p.email <> ''
              AND NOT EXISTS (
                  SELECT 1 FROM user_clients v WHERE lower(v.email) = lower(p.email)
              );

            INSERT INTO travel_people (name, email, client_id, owner_admin_id)
            SELECT v.display_name, v.email, v.id,
                   (SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1)
            FROM user_clients v
            WHERE NOT EXISTS (
                SELECT 1
                FROM travel_people p
                WHERE p.active = TRUE
                  AND (
                    (p.email <> '' AND lower(p.email) = lower(v.email))
                    OR (p.email = '' AND lower(p.name) = lower(v.display_name))
                  )
            );

            UPDATE travel_people p
            SET client_id = v.id
            FROM user_clients v
            WHERE p.email <> ''
              AND lower(p.email) = lower(v.email);

            UPDATE trip_members tm
            SET client_id = v.id
            FROM user_clients v
            WHERE tm.email <> ''
              AND lower(tm.email) = lower(v.email);

            INSERT INTO travel_people (name, email, client_id, owner_admin_id)
            SELECT DISTINCT ON (lower(trim(tm.name)), lower(trim(tm.email)))
                   tm.name, COALESCE(tm.email, ''), tm.client_id, t.owner_admin_id
            FROM trip_members tm
            INNER JOIN trips t ON tm.trip_id = t.id
            WHERE tm.active = TRUE
              AND tm.person_id IS NULL
              AND NOT EXISTS (
                  SELECT 1
                  FROM travel_people p
                  WHERE lower(trim(p.name)) = lower(trim(tm.name))
                    AND lower(trim(p.email)) = lower(trim(COALESCE(tm.email, '')))
                    AND p.active = TRUE
              )
            ORDER BY lower(trim(tm.name)), lower(trim(tm.email)), tm.id;
            """
        )
        cursor.execute(
            """
            UPDATE trip_members tm
            SET person_id = p.id
            FROM travel_people p
            WHERE tm.person_id IS NULL
              AND lower(trim(p.name)) = lower(trim(tm.name))
              AND lower(trim(p.email)) = lower(trim(COALESCE(tm.email, '')))
              AND p.active = TRUE;
            """
        )
        cursor.execute(
            """
            UPDATE trip_members tm
            SET client_id = v.id
            FROM user_clients v
            WHERE tm.client_id IS NULL
              AND tm.email <> ''
              AND lower(tm.email) = lower(v.email)
              AND tm.active = TRUE;
            """
        )
        cursor.execute(
            """
            UPDATE travel_people p
            SET client_id = v.id
            FROM user_clients v
            WHERE p.client_id IS NULL
              AND p.email <> ''
              AND lower(p.email) = lower(v.email)
              AND p.active = TRUE;
            """
        )
        cursor.execute(
            """
            UPDATE travel_users u
            SET email = split_part(lower(u.email), '@', 1)
            WHERE u.role = 'admin'
              AND position('@' IN u.email) > 0
              AND NOT EXISTS (
                  SELECT 1
                  FROM travel_users other
                  WHERE other.id <> u.id
                    AND lower(other.email) = split_part(lower(u.email), '@', 1)
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
