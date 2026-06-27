import os
import sys
from urllib.parse import urlparse

import psycopg2
from psycopg2 import sql
from psycopg2.extras import Json, execute_values

from config import _db_config_from_url
from schema import ensure_all_schema


TABLES = [
    ("users", "users"),
    ("van_dong_vien", "user_clients"),
    ("giai_dau", "giai_dau"),
    ("dang_ky_giai", "dang_ky_giai"),
    ("tran_dau", "tran_dau"),
    ("giai_dau_admin_quyen", "giai_dau_admin_quyen"),
    ("doi_bong", "doi_bong"),
    ("doi_bong_thanh_vien", "doi_bong_thanh_vien"),
    ("doi_bong_quy_thang", "doi_bong_quy_thang"),
    ("doi_bong_khoan_chi", "doi_bong_khoan_chi"),
    ("doi_bong_admin_quyen", "doi_bong_admin_quyen"),
    ("doi_bong_dong_phi", "doi_bong_dong_phi"),
    ("app_logs", "app_logs"),
    ("user_actions", "user_actions"),
]

COLUMN_MAPS = {
    ("van_dong_vien", "user_clients"): {
        "ten_vdv": "display_name",
        "trinh_do": "skill_level",
        "ghi_chu": "notes",
    },
    ("dang_ky_giai", "dang_ky_giai"): {
        "van_dong_vien_id": "user_client_id",
        "ghi_chu": "notes",
    },
    ("doi_bong_thanh_vien", "doi_bong_thanh_vien"): {
        "van_dong_vien_id": "user_client_id",
        "trinh_do": "skill_level",
        "ghi_chu": "notes",
    },
    ("doi_bong_quy_thang", "doi_bong_quy_thang"): {"ghi_chu": "notes"},
    ("doi_bong_khoan_chi", "doi_bong_khoan_chi"): {"ghi_chu": "notes"},
    ("doi_bong_dong_phi", "doi_bong_dong_phi"): {"ghi_chu": "notes"},
}


def _connect(database_url):
    return psycopg2.connect(**_db_config_from_url(database_url))


def _same_database(source_url, target_url):
    source = urlparse(source_url)
    target = urlparse(target_url)
    return (
        source.hostname,
        source.port or 5432,
        source.path,
        source.username,
    ) == (
        target.hostname,
        target.port or 5432,
        target.path,
        target.username,
    )


def _columns(conn, table):
    with conn.cursor() as cursor:
        cursor.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = %s
            ORDER BY ordinal_position;
            """,
            (table,),
        )
        return [row[0] for row in cursor.fetchall()]


def _copy_table(source, target, source_table, target_table):
    source_columns = _columns(source, source_table)
    target_columns = _columns(target, target_table)
    column_map = COLUMN_MAPS.get((source_table, target_table), {})
    pairs = [
        (source_column, column_map.get(source_column, source_column))
        for source_column in source_columns
        if column_map.get(source_column, source_column) in target_columns
    ]
    if not pairs:
        print(f"skip {source_table} -> {target_table}: no common columns")
        return

    with source.cursor() as source_cursor, target.cursor() as target_cursor:
        source_cursor.execute(
            sql.SQL("SELECT {} FROM {} ORDER BY id").format(
                sql.SQL(", ").join(sql.Identifier(source_column) for source_column, _ in pairs),
                sql.Identifier(source_table),
            )
        )
        rows = [
            tuple(Json(value) if isinstance(value, (dict, list)) else value for value in row)
            for row in source_cursor.fetchall()
        ]
        if rows:
            execute_values(
                target_cursor,
                sql.SQL("INSERT INTO {} ({}) VALUES %s").format(
                    sql.Identifier(target_table),
                    sql.SQL(", ").join(sql.Identifier(target_column) for _, target_column in pairs),
                ).as_string(target),
                rows,
            )
        print(f"copied {source_table} -> {target_table}: {len(rows)} rows")


def _reset_sequence(conn, table):
    with conn.cursor() as cursor:
        cursor.execute("SELECT pg_get_serial_sequence(%s, 'id');", (table,))
        sequence = cursor.fetchone()[0]
        if not sequence:
            return
        cursor.execute(
            sql.SQL("SELECT setval(%s, COALESCE((SELECT MAX(id) FROM {}), 1), true);").format(
                sql.Identifier(table)
            ),
            (sequence,),
        )


def main():
    source_url = os.environ.get("PICKLEBALL_DATABASE_URL")
    target_url = os.environ.get("DATABASE_URL")
    if not source_url or not target_url:
        print("Set PICKLEBALL_DATABASE_URL for the old DB and DATABASE_URL for the target DB.", file=sys.stderr)
        return 2
    if _same_database(source_url, target_url):
        print("Source and target database look identical; refusing to migrate onto itself.", file=sys.stderr)
        return 2

    ensure_all_schema()
    with _connect(source_url) as source, _connect(target_url) as target:
        with target.cursor() as cursor:
            cursor.execute(
                "TRUNCATE TABLE {} RESTART IDENTITY CASCADE;".format(
                    ", ".join(f'"{target_table}"' for _, target_table in reversed(TABLES))
                )
            )
        for source_table, target_table in TABLES:
            _copy_table(source, target, source_table, target_table)
        for _, target_table in TABLES:
            _reset_sequence(target, target_table)
        target.commit()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
