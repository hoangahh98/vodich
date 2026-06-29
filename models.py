import random

from db import db_cursor
from config import SUPER_ADMIN_EMAIL, normalize_admin_user


def _decode_legacy_text(value):
    if not isinstance(value, str):
        return value
    text = value
    for _ in range(3):
        changed = False
        for encoding in ("latin1", "cp1252"):
            try:
                decoded = text.encode(encoding).decode("utf-8")
            except (UnicodeEncodeError, UnicodeDecodeError):
                continue
            if decoded != text:
                text = decoded
                changed = True
                break
        if not changed:
            break
    return text


def _is_done_status(status):
    return _decode_legacy_text(status) == 'Đã xong'


class UserClientModel:
    """Vận động viên (Players)"""

    @staticmethod
    def get_all():
        """Get all VĐV"""
        with db_cursor() as cursor:
            cursor.execute("SELECT id, display_name, skill_level, email, notes FROM user_clients ORDER BY display_name ASC;")
            return cursor.fetchall()

    @staticmethod
    def get_available_for_tournament(giai_id):
        """Get players not yet registered for a tournament."""
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT v.id, v.display_name, v.skill_level, v.email, v.notes
                FROM user_clients v
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM dang_ky_giai dkg
                    WHERE dkg.giai_dau_id = %s
                      AND dkg.user_client_id = v.id
                )
                ORDER BY v.display_name ASC;
            """, (giai_id,))
            return cursor.fetchall()

    @staticmethod
    def get_available_for_team(doi_bong_id):
        """Get players not currently active in a team."""
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT v.id, v.display_name, v.skill_level, v.email, v.notes
                FROM user_clients v
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM doi_bong_thanh_vien tv
                    WHERE tv.doi_bong_id = %s
                      AND tv.user_client_id = v.id
                      AND tv.active = TRUE
                )
                ORDER BY v.display_name ASC;
            """, (doi_bong_id,))
            return cursor.fetchall()

    @staticmethod
    def get_by_id(vdv_id):
        """Get VĐV by ID"""
        with db_cursor() as cursor:
            cursor.execute("SELECT * FROM user_clients WHERE id = %s;", (vdv_id,))
            return cursor.fetchone()

    @staticmethod
    def get_by_email(email):
        """Get VĐV by email"""
        with db_cursor() as cursor:
            cursor.execute("SELECT id, display_name, email, skill_level FROM user_clients WHERE lower(email) = lower(%s);", (email,))
            return cursor.fetchone()

    @staticmethod
    def email_exists(email, exclude_id=None):
        """Check whether an email is already used by another VĐV."""
        with db_cursor() as cursor:
            if exclude_id:
                cursor.execute(
                    "SELECT 1 FROM user_clients WHERE lower(email) = lower(%s) AND id <> %s LIMIT 1;",
                    (email, exclude_id),
                )
            else:
                cursor.execute("SELECT 1 FROM user_clients WHERE lower(email) = lower(%s) LIMIT 1;", (email,))
            return cursor.fetchone() is not None

    @staticmethod
    def create(display_name, skill_level, email, notes=''):
        """Create new VĐV"""
        with db_cursor(commit=True) as cursor:
            cursor.execute("""
                INSERT INTO user_clients (display_name, skill_level, email, notes)
                VALUES (%s, %s, %s, %s)
                RETURNING id;
            """, (display_name, skill_level, email, notes))
            return cursor.fetchone()[0]

    @staticmethod
    def update(vdv_id, display_name, skill_level, email, notes=''):
        """Update VĐV"""
        with db_cursor(commit=True) as cursor:
            cursor.execute("""
                UPDATE user_clients
                SET display_name=%s, skill_level=%s, email=%s, notes=%s
                WHERE id=%s;
            """, (display_name, skill_level, email, notes, vdv_id))

    @staticmethod
    def delete(vdv_id):
        """Delete VĐV"""
        with db_cursor(commit=True) as cursor:
            cursor.execute("DELETE FROM user_clients WHERE id = %s;", (vdv_id,))

class AdminUserModel:
    @staticmethod
    def get_all():
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT id, email, COALESCE(NULLIF(display_name, ''), email) AS display_name
                FROM users
                WHERE role = 'admin'
                ORDER BY display_name ASC, email ASC;
            """)
            return cursor.fetchall()

    @staticmethod
    def get_by_id(admin_id):
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT id, email, COALESCE(NULLIF(display_name, ''), email) AS display_name
                FROM users
                WHERE id = %s AND role = 'admin';
            """, (admin_id,))
            return cursor.fetchone()

    @staticmethod
    def get_available_for_tournament(giai_id, owner_admin_id=None, current_admin_id=None):
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT u.id, u.email, COALESCE(NULLIF(u.display_name, ''), u.email) AS display_name
                FROM users u
                WHERE u.role = 'admin'
                  AND lower(u.email) <> lower(%s)
                  AND (%s IS NULL OR u.id <> %s)
                  AND (%s IS NULL OR u.id <> %s)
                  AND NOT EXISTS (
                      SELECT 1
                      FROM giai_dau_admin_quyen q
                      WHERE q.giai_dau_id = %s
                        AND q.admin_id = u.id
                  )
                ORDER BY display_name ASC, u.email ASC;
            """, (SUPER_ADMIN_EMAIL, owner_admin_id, owner_admin_id, current_admin_id, current_admin_id, giai_id))
            return cursor.fetchall()

    @staticmethod
    def get_available_for_team(doi_bong_id, owner_admin_id=None, current_admin_id=None):
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT u.id, u.email, COALESCE(NULLIF(u.display_name, ''), u.email) AS display_name
                FROM users u
                WHERE u.role = 'admin'
                  AND lower(u.email) <> lower(%s)
                  AND (%s IS NULL OR u.id <> %s)
                  AND (%s IS NULL OR u.id <> %s)
                  AND NOT EXISTS (
                      SELECT 1
                      FROM doi_bong_admin_quyen q
                      WHERE q.doi_bong_id = %s
                        AND q.admin_id = u.id
                  )
                ORDER BY display_name ASC, u.email ASC;
            """, (SUPER_ADMIN_EMAIL, owner_admin_id, owner_admin_id, current_admin_id, current_admin_id, doi_bong_id))
            return cursor.fetchall()

    @staticmethod
    def email_exists(email, exclude_id=None):
        email = normalize_admin_user(email)
        with db_cursor() as cursor:
            if exclude_id:
                cursor.execute("""
                    SELECT 1
                    FROM users
                    WHERE lower(email) = lower(%s) AND id <> %s
                    LIMIT 1;
                """, (email, exclude_id))
            else:
                cursor.execute("SELECT 1 FROM users WHERE lower(email) = lower(%s) LIMIT 1;", (email,))
            return cursor.fetchone() is not None

    @staticmethod
    def update(admin_id, email, display_name, password_hash=None):
        email = normalize_admin_user(email)
        display_name = (display_name or email).strip()
        with db_cursor(commit=True) as cursor:
            if password_hash:
                cursor.execute("""
                    UPDATE users
                    SET email = %s, display_name = %s, password = %s
                    WHERE id = %s AND role = 'admin';
                """, (email.strip().lower(), display_name, password_hash, admin_id))
            else:
                cursor.execute("""
                    UPDATE users
                    SET email = %s, display_name = %s
                    WHERE id = %s AND role = 'admin';
                """, (email.strip().lower(), display_name, admin_id))

    @staticmethod
    def delete(admin_id, fallback_admin_id):
        with db_cursor(commit=True) as cursor:
            cursor.execute("""
                UPDATE giai_dau
                SET owner_admin_id = %s
                WHERE owner_admin_id = %s;
            """, (fallback_admin_id, admin_id))
            cursor.execute("""
                UPDATE doi_bong
                SET owner_admin_id = %s
                WHERE owner_admin_id = %s;
            """, (fallback_admin_id, admin_id))
            cursor.execute("DELETE FROM users WHERE id = %s AND role = 'admin';", (admin_id,))


class TournamentModel:
    """Giải đấu"""

    @staticmethod
    def ensure_score_rule_columns():
        """Schema is maintained by init_db.py; kept for backward-compatible callers."""
        return None

    @staticmethod
    def get_details(giai_id, admin_id=None):
        """Get tournament details"""
        with db_cursor() as cursor:
            if admin_id:
                cursor.execute("""
                    SELECT g.id, g.ten_giai_dau, g.so_luong_san, g.dia_diem,
                           g.chi_phi_san_bai, g.chi_phi_nuoc_noi, g.chi_phi_giai_thuong, g.chi_phi_khac,
                           g.ty_le_giai_1, g.ty_le_giai_2, g.ty_le_giai_3, g.so_nguoi_du_kien,
                           g.thoi_gian_bat_dau, g.banner_image, g.qr_image,
                           COALESCE(g.loai_dau, 'don'), COALESCE(g.diem_cham, 11), COALESCE(g.diem_toi_da, 15),
                           g.tien_giai_1, g.tien_giai_2, g.tien_giai_3, g.owner_admin_id,
                           COALESCE(g.the_thuc, 'vong_tron'), COALESCE(g.so_doi_moi_bang, 4),
                           COALESCE(g.so_bang, 2), COALESCE(g.so_doi_vao_vong_trong, 8)
                    FROM giai_dau g
                    LEFT JOIN giai_dau_admin_quyen q ON g.id = q.giai_dau_id AND q.admin_id = %s
                    WHERE g.id = %s AND (g.owner_admin_id = %s OR q.admin_id IS NOT NULL);
                """, (admin_id, giai_id, admin_id))
            else:
                cursor.execute("""
                    SELECT id, ten_giai_dau, so_luong_san, dia_diem,
                           chi_phi_san_bai, chi_phi_nuoc_noi, chi_phi_giai_thuong, chi_phi_khac,
                           ty_le_giai_1, ty_le_giai_2, ty_le_giai_3, so_nguoi_du_kien,
                           thoi_gian_bat_dau, banner_image, qr_image,
                           COALESCE(loai_dau, 'don'), COALESCE(diem_cham, 11), COALESCE(diem_toi_da, 15),
                           tien_giai_1, tien_giai_2, tien_giai_3, owner_admin_id,
                           COALESCE(the_thuc, 'vong_tron'), COALESCE(so_doi_moi_bang, 4),
                           COALESCE(so_bang, 2), COALESCE(so_doi_vao_vong_trong, 8)
                    FROM giai_dau WHERE id = %s;
                """, (giai_id,))
            return cursor.fetchone()

    @staticmethod
    def get_all():
        """Get all tournaments"""
        with db_cursor() as cursor:
            cursor.execute("SELECT id, ten_giai_dau, so_luong_san, dia_diem, thoi_gian_bat_dau, ngay_tao FROM giai_dau ORDER BY id DESC;")
            return cursor.fetchall()

    @staticmethod
    def get_score_rules(giai_id):
        """Get scoring rules for tournament."""
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT COALESCE(diem_cham, 11), COALESCE(diem_toi_da, 15)
                FROM giai_dau
                WHERE id = %s;
            """, (giai_id,))
            return cursor.fetchone() or (11, 15)

    @staticmethod
    def update_prizes(giai_id, tien_giai_1, tien_giai_2, tien_giai_3):
        with db_cursor(commit=True) as cursor:
            cursor.execute("""
                UPDATE giai_dau
                SET tien_giai_1=%s, tien_giai_2=%s, tien_giai_3=%s
                WHERE id=%s;
            """, (tien_giai_1, tien_giai_2, tien_giai_3, giai_id))

    @staticmethod
    def get_permissions(giai_id):
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT q.id, q.admin_id, u.email
                FROM giai_dau_admin_quyen q
                INNER JOIN users u ON q.admin_id = u.id
                WHERE q.giai_dau_id = %s
                ORDER BY u.email ASC;
            """, (giai_id,))
            return cursor.fetchall()

    @staticmethod
    def add_permission(giai_id, admin_id):
        with db_cursor(commit=True) as cursor:
            cursor.execute("""
                INSERT INTO giai_dau_admin_quyen (giai_dau_id, admin_id)
                VALUES (%s, %s)
                ON CONFLICT (giai_dau_id, admin_id) DO NOTHING;
            """, (giai_id, admin_id))

    @staticmethod
    def remove_permission(giai_id, permission_id):
        with db_cursor(commit=True) as cursor:
            cursor.execute("DELETE FROM giai_dau_admin_quyen WHERE giai_dau_id = %s AND id = %s;", (giai_id, permission_id))

class DangKyGiaiModel:
    """Đăng ký giải (Registration)"""

    @staticmethod
    def get_by_tournament(giai_id):
        """Get all registrations for tournament"""
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT dkg.id, dkg.user_client_id, vdv.display_name, vdv.skill_level, vdv.email,
                       dkg.so_tien_da_dong, dkg.trang_thai_dong_tien, dkg.notes
                FROM dang_ky_giai dkg
                INNER JOIN user_clients vdv ON dkg.user_client_id = vdv.id
                WHERE dkg.giai_dau_id = %s
                ORDER BY vdv.display_name ASC;
            """, (giai_id,))
            return cursor.fetchall()

    @staticmethod
    def get_by_vdv(vdv_id):
        """Get all tournaments VĐV registered in"""
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT dkg.id, dkg.giai_dau_id, g.ten_giai_dau, g.so_luong_san, g.dia_diem,
                       g.chi_phi_san_bai, g.chi_phi_nuoc_noi, g.chi_phi_giai_thuong, g.chi_phi_khac,
                       g.ty_le_giai_1, g.ty_le_giai_2, g.ty_le_giai_3, g.so_nguoi_du_kien,
                       g.thoi_gian_bat_dau, g.banner_image, g.qr_image,
                       dkg.so_tien_da_dong, dkg.trang_thai_dong_tien
                FROM dang_ky_giai dkg
                INNER JOIN giai_dau g ON dkg.giai_dau_id = g.id
                WHERE dkg.user_client_id = %s
                ORDER BY g.id DESC;
            """, (vdv_id,))
            return cursor.fetchall()

    @staticmethod
    def is_vdv_registered(giai_id, vdv_id):
        if not vdv_id:
            return False
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT 1
                FROM dang_ky_giai
                WHERE giai_dau_id = %s AND user_client_id = %s
                LIMIT 1;
            """, (giai_id, vdv_id))
            return cursor.fetchone() is not None

    @staticmethod
    def get_by_tournaments(giai_ids):
        """Get registrations for many tournaments in one query, grouped by tournament ID."""
        ids = [int(giai_id) for giai_id in giai_ids if giai_id]
        if not ids:
            return {}

        with db_cursor() as cursor:
            cursor.execute("""
                SELECT dkg.giai_dau_id, dkg.id, dkg.user_client_id, vdv.display_name, vdv.skill_level, vdv.email,
                       dkg.so_tien_da_dong, dkg.trang_thai_dong_tien, dkg.notes
                FROM dang_ky_giai dkg
                INNER JOIN user_clients vdv ON dkg.user_client_id = vdv.id
                WHERE dkg.giai_dau_id = ANY(%s)
                ORDER BY dkg.giai_dau_id DESC, vdv.display_name ASC;
            """, (ids,))
            grouped = {giai_id: [] for giai_id in ids}
            for row in cursor.fetchall():
                grouped.setdefault(row[0], []).append(row[1:])
            return grouped

    @staticmethod
    def register(user_client_id, giai_dau_id):
        """Register VĐV for tournament"""
        with db_cursor(commit=True) as cursor:
            cursor.execute("""
                INSERT INTO dang_ky_giai (user_client_id, giai_dau_id)
                VALUES (%s, %s);
            """, (user_client_id, giai_dau_id))

    @staticmethod
    def register_many(user_client_ids, giai_dau_id):
        """Register many players for one tournament using one transaction."""
        rows = [(vdv_id, giai_dau_id) for vdv_id in user_client_ids]
        if not rows:
            return 0
        with db_cursor(commit=True) as cursor:
            cursor.executemany("""
                INSERT INTO dang_ky_giai (user_client_id, giai_dau_id)
                VALUES (%s, %s);
            """, rows)
        return len(rows)

    @staticmethod
    def update_payment(dang_ky_id, so_tien, trang_thai):
        """Update payment info"""
        with db_cursor(commit=True) as cursor:
            cursor.execute("""
                UPDATE dang_ky_giai
                SET so_tien_da_dong=%s, trang_thai_dong_tien=%s
                WHERE id=%s;
            """, (so_tien, trang_thai, dang_ky_id))

    @staticmethod
    def update_payments(updates):
        """Update many registration payments in one transaction."""
        rows = [(so_tien, trang_thai, dang_ky_id) for dang_ky_id, so_tien, trang_thai in updates]
        if not rows:
            return 0
        with db_cursor(commit=True) as cursor:
            cursor.executemany("""
                UPDATE dang_ky_giai
                SET so_tien_da_dong=%s, trang_thai_dong_tien=%s
                WHERE id=%s;
            """, rows)
        return len(rows)

    @staticmethod
    def remove(dang_ky_id):
        """Remove VĐV from tournament"""
        with db_cursor(commit=True) as cursor:
            cursor.execute("DELETE FROM dang_ky_giai WHERE id = %s;", (dang_ky_id,))

class DoiBongModel:
    """Team management and monthly fee tracking."""

    @staticmethod
    def normalize_month(month_value):
        month_value = (month_value or "").strip()
        if len(month_value) == 7:
            return f"{month_value}-01"
        return month_value

    @staticmethod
    def get_all(admin_id=None):
        with db_cursor() as cursor:
            if admin_id:
                cursor.execute("""
                    SELECT d.id, d.ten_doi, d.mo_ta, COUNT(tv.id) AS so_thanh_vien, d.owner_admin_id
                    FROM doi_bong d
                    LEFT JOIN doi_bong_thanh_vien tv ON d.id = tv.doi_bong_id AND tv.active = TRUE
                    LEFT JOIN doi_bong_admin_quyen q ON d.id = q.doi_bong_id AND q.admin_id = %s
                    WHERE d.owner_admin_id = %s OR q.admin_id IS NOT NULL
                    GROUP BY d.id
                    ORDER BY d.id DESC;
                """, (admin_id, admin_id))
            else:
                cursor.execute("""
                    SELECT d.id, d.ten_doi, d.mo_ta, COUNT(tv.id) AS so_thanh_vien, d.owner_admin_id
                    FROM doi_bong d
                    LEFT JOIN doi_bong_thanh_vien tv ON d.id = tv.doi_bong_id AND tv.active = TRUE
                    GROUP BY d.id
                    ORDER BY d.id DESC;
                """)
            return cursor.fetchall()

    @staticmethod
    def get_by_id(doi_bong_id, admin_id=None):
        with db_cursor() as cursor:
            if admin_id:
                cursor.execute("""
                    SELECT d.id, d.ten_doi, d.mo_ta, d.owner_admin_id
                    FROM doi_bong d
                    LEFT JOIN doi_bong_admin_quyen q ON d.id = q.doi_bong_id AND q.admin_id = %s
                    WHERE d.id = %s AND (d.owner_admin_id = %s OR q.admin_id IS NOT NULL);
                """, (admin_id, doi_bong_id, admin_id))
            else:
                cursor.execute("SELECT id, ten_doi, mo_ta, owner_admin_id FROM doi_bong WHERE id = %s;", (doi_bong_id,))
            return cursor.fetchone()

    @staticmethod
    def get_by_id_for_vdv(doi_bong_id, vdv_id):
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT d.id, d.ten_doi, d.mo_ta, d.owner_admin_id
                FROM doi_bong d
                INNER JOIN doi_bong_thanh_vien tv ON d.id = tv.doi_bong_id
                WHERE d.id = %s AND tv.user_client_id = %s AND tv.active = TRUE;
            """, (doi_bong_id, vdv_id))
            return cursor.fetchone()

    @staticmethod
    def get_by_vdv(vdv_id):
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT d.id, d.ten_doi, d.mo_ta, tv.loai_thanh_vien
                FROM doi_bong d
                INNER JOIN doi_bong_thanh_vien tv ON d.id = tv.doi_bong_id
                WHERE tv.user_client_id = %s AND tv.active = TRUE
                ORDER BY d.ten_doi ASC;
            """, (vdv_id,))
            return cursor.fetchall()

    @staticmethod
    def create(ten_doi, mo_ta="", owner_admin_id=None):
        with db_cursor(commit=True) as cursor:
            cursor.execute("""
                INSERT INTO doi_bong (ten_doi, mo_ta, owner_admin_id)
                VALUES (%s, %s, %s)
                RETURNING id;
            """, (ten_doi, mo_ta, owner_admin_id))
            return cursor.fetchone()[0]

    @staticmethod
    def update(doi_bong_id, ten_doi, mo_ta=""):
        with db_cursor(commit=True) as cursor:
            cursor.execute("""
                UPDATE doi_bong
                SET ten_doi=%s, mo_ta=%s, updated_at=CURRENT_TIMESTAMP
                WHERE id=%s;
            """, (ten_doi, mo_ta, doi_bong_id))

    @staticmethod
    def delete(doi_bong_id):
        with db_cursor(commit=True) as cursor:
            cursor.execute("DELETE FROM doi_bong WHERE id = %s;", (doi_bong_id,))

    @staticmethod
    def get_members_with_payments(doi_bong_id, thang):
        thang = DoiBongModel.normalize_month(thang)
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT tv.id, tv.user_client_id, COALESCE(vdv.display_name, tv.ten_thanh_vien),
                       COALESCE(vdv.skill_level, tv.skill_level), vdv.email,
                       tv.loai_thanh_vien, tv.notes,
                       COALESCE(dp.so_tien_da_dong, 0), COALESCE(dp.trang_thai_dong_tien, 'Chưa đóng'),
                       COALESCE(dp.notes, ''), dp.id
                FROM doi_bong_thanh_vien tv
                LEFT JOIN user_clients vdv ON tv.user_client_id = vdv.id
                LEFT JOIN doi_bong_dong_phi dp ON tv.id = dp.thanh_vien_id AND dp.thang = %s
                WHERE tv.doi_bong_id = %s AND tv.active = TRUE
                ORDER BY COALESCE(vdv.display_name, tv.ten_thanh_vien) ASC;
            """, (thang, doi_bong_id))
            return cursor.fetchall()

    @staticmethod
    def add_member(doi_bong_id, user_client_id, loai_thanh_vien, notes=""):
        with db_cursor(commit=True) as cursor:
            cursor.execute("""
                SELECT display_name, skill_level FROM user_clients WHERE id = %s;
            """, (user_client_id,))
            vdv = cursor.fetchone()
            if not vdv:
                raise ValueError("Không tìm thấy vận động viên.")
            cursor.execute("""
                INSERT INTO doi_bong_thanh_vien
                    (doi_bong_id, user_client_id, ten_thanh_vien, skill_level, loai_thanh_vien, notes)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT DO NOTHING
                RETURNING id;
            """, (doi_bong_id, user_client_id, vdv[0], vdv[1], loai_thanh_vien, notes))
            row = cursor.fetchone()
            return row[0] if row else None

    @staticmethod
    def update_member(doi_bong_id, thanh_vien_id, loai_thanh_vien, notes=""):
        with db_cursor(commit=True) as cursor:
            cursor.execute("""
                UPDATE doi_bong_thanh_vien
                SET loai_thanh_vien=%s, notes=%s, updated_at=CURRENT_TIMESTAMP
                WHERE doi_bong_id=%s AND id=%s;
            """, (loai_thanh_vien, notes, doi_bong_id, thanh_vien_id))

    @staticmethod
    def delete_member(doi_bong_id, thanh_vien_id):
        with db_cursor(commit=True) as cursor:
            cursor.execute("""
                UPDATE doi_bong_thanh_vien
                SET active=FALSE, updated_at=CURRENT_TIMESTAMP
                WHERE doi_bong_id=%s AND id=%s;
            """, (doi_bong_id, thanh_vien_id))

    @staticmethod
    def get_month_config(doi_bong_id, thang):
        thang = DoiBongModel.normalize_month(thang)
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT doi_bong_id, thang, COALESCE(muc_phi_thang, 0),
                       COALESCE(chi_phi_san_bai, 0),
                       COALESCE(tien_san_con_lai_thang_truoc, 0), COALESCE(notes, '')
                FROM doi_bong_quy_thang
                WHERE doi_bong_id = %s AND thang = %s;
            """, (doi_bong_id, thang))
            row = cursor.fetchone()
        if row:
            return row
        return (doi_bong_id, thang, 0, 0, 0, "")

    @staticmethod
    def upsert_month_config(doi_bong_id, thang, muc_phi_thang, chi_phi_san_bai, tien_san_con_lai_thang_truoc, notes=""):
        thang = DoiBongModel.normalize_month(thang)
        with db_cursor(commit=True) as cursor:
            cursor.execute("""
                INSERT INTO doi_bong_quy_thang
                    (doi_bong_id, thang, muc_phi_thang, chi_phi_san_bai, tien_san_con_lai_thang_truoc, notes)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (doi_bong_id, thang)
                DO UPDATE SET
                    muc_phi_thang=EXCLUDED.muc_phi_thang,
                    chi_phi_san_bai=EXCLUDED.chi_phi_san_bai,
                    tien_san_con_lai_thang_truoc=EXCLUDED.tien_san_con_lai_thang_truoc,
                    notes=EXCLUDED.notes,
                    updated_at=CURRENT_TIMESTAMP;
            """, (doi_bong_id, thang, muc_phi_thang, chi_phi_san_bai, tien_san_con_lai_thang_truoc, notes))

    @staticmethod
    def update_payments(thang, updates):
        thang = DoiBongModel.normalize_month(thang)
        rows = [
            (thanh_vien_id, thang, so_tien, trang_thai, notes)
            for thanh_vien_id, so_tien, trang_thai, notes in updates
        ]
        if not rows:
            return 0
        with db_cursor(commit=True) as cursor:
            cursor.executemany("""
                INSERT INTO doi_bong_dong_phi
                    (thanh_vien_id, thang, so_tien_da_dong, trang_thai_dong_tien, notes)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (thanh_vien_id, thang)
                DO UPDATE SET
                    so_tien_da_dong=EXCLUDED.so_tien_da_dong,
                    trang_thai_dong_tien=EXCLUDED.trang_thai_dong_tien,
                    notes=EXCLUDED.notes,
                    updated_at=CURRENT_TIMESTAMP;
            """, rows)
        return len(rows)

    @staticmethod
    def get_available_months(doi_bong_id):
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT DISTINCT to_char(thang, 'YYYY-MM') AS ym
                FROM (
                    SELECT thang FROM doi_bong_quy_thang WHERE doi_bong_id = %s
                    UNION
                    SELECT dp.thang
                    FROM doi_bong_dong_phi dp
                    INNER JOIN doi_bong_thanh_vien tv ON dp.thanh_vien_id = tv.id
                    WHERE tv.doi_bong_id = %s
                ) months
                ORDER BY ym DESC;
            """, (doi_bong_id, doi_bong_id))
            return [row[0] for row in cursor.fetchall()]

    @staticmethod
    def get_expenses(doi_bong_id, thang):
        thang = DoiBongModel.normalize_month(thang)
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT id, ngay_chi, noi_dung, COALESCE(so_tien, 0), COALESCE(notes, '')
                FROM doi_bong_khoan_chi
                WHERE doi_bong_id = %s AND thang = %s
                ORDER BY ngay_chi DESC, id DESC;
            """, (doi_bong_id, thang))
            return cursor.fetchall()

    @staticmethod
    def add_expense(doi_bong_id, thang, ngay_chi, noi_dung, so_tien, notes=""):
        thang = DoiBongModel.normalize_month(thang)
        with db_cursor(commit=True) as cursor:
            cursor.execute("""
                INSERT INTO doi_bong_khoan_chi (doi_bong_id, thang, ngay_chi, noi_dung, so_tien, notes)
                VALUES (%s, %s, %s, %s, %s, %s);
            """, (doi_bong_id, thang, ngay_chi, noi_dung, so_tien, notes))

    @staticmethod
    def delete_expense(doi_bong_id, expense_id):
        with db_cursor(commit=True) as cursor:
            cursor.execute("DELETE FROM doi_bong_khoan_chi WHERE doi_bong_id = %s AND id = %s;", (doi_bong_id, expense_id))

    @staticmethod
    def get_permissions(doi_bong_id):
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT q.id, q.admin_id, u.email
                FROM doi_bong_admin_quyen q
                INNER JOIN users u ON q.admin_id = u.id
                WHERE q.doi_bong_id = %s
                ORDER BY u.email ASC;
            """, (doi_bong_id,))
            return cursor.fetchall()

    @staticmethod
    def add_permission(doi_bong_id, admin_id):
        with db_cursor(commit=True) as cursor:
            cursor.execute("""
                INSERT INTO doi_bong_admin_quyen (doi_bong_id, admin_id)
                VALUES (%s, %s)
                ON CONFLICT (doi_bong_id, admin_id) DO NOTHING;
            """, (doi_bong_id, admin_id))

    @staticmethod
    def remove_permission(doi_bong_id, permission_id):
        with db_cursor(commit=True) as cursor:
            cursor.execute("DELETE FROM doi_bong_admin_quyen WHERE doi_bong_id = %s AND id = %s;", (doi_bong_id, permission_id))


class MatchModel:
    """Trận đấu"""

    @staticmethod
    def ensure_score_order_column():
        """Schema is maintained by init_db.py; kept for backward-compatible callers."""
        return None

    @staticmethod
    def get_all_by_tournament(giai_id):
        """Get all matches for tournament"""
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT id, doi_a, doi_b, diem_doi_a, diem_doi_b, trang_thai, san_so_may, vong_dau,
                       COALESCE(thu_tu_danh, 2), COALESCE(doi_dang_giao, 'A'),
                       COALESCE(giai_doan, 'vong_tron'), bang_dau
                FROM tran_dau WHERE giai_dau_id = %s
                ORDER BY vong_dau ASC, bang_dau ASC NULLS LAST, san_so_may ASC, id ASC;
            """, (giai_id,))
            return cursor.fetchall()

    @staticmethod
    def delete_by_tournament(giai_id):
        """Delete all matches for tournament"""
        with db_cursor(commit=True) as cursor:
            cursor.execute("DELETE FROM tran_dau WHERE giai_dau_id = %s;", (giai_id,))

    @staticmethod
    def save_matches(giai_id, matches):
        """Save matches"""
        with db_cursor(commit=True) as cursor:
            for m in matches:
                cursor.execute("""
                    INSERT INTO tran_dau (giai_dau_id, doi_a, doi_b, trang_thai, san_so_may, vong_dau, giai_doan, bang_dau)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s);
                """, (giai_id, m['doi_a'], m['doi_b'], 'Chưa diễn ra',
                      m.get('san', 1), m.get('vong', 1), m.get('giai_doan', 'vong_tron'), m.get('bang')))

    @staticmethod
    def update_match_teams(updates):
        """Update seeded teams for existing knockout placeholder matches."""
        with db_cursor(commit=True) as cursor:
            for tran_id, doi_a, doi_b in updates:
                cursor.execute("""
                    UPDATE tran_dau
                    SET doi_a=%s, doi_b=%s, diem_doi_a=NULL, diem_doi_b=NULL,
                        thu_tu_danh=2, doi_dang_giao='A', trang_thai=%s
                    WHERE id=%s;
                """, (doi_a, doi_b, 'Chưa diễn ra', tran_id))

    @staticmethod
    def update_score(tran_id, diem_a, diem_b, thu_tu_danh=2, doi_dang_giao='A'):
        """Update match score"""
        with db_cursor(commit=True) as cursor:
            cursor.execute("""
                SELECT COALESCE(g.diem_cham, 11), COALESCE(g.diem_toi_da, 15)
                FROM tran_dau td
                INNER JOIN giai_dau g ON td.giai_dau_id = g.id
                WHERE td.id = %s;
            """, (tran_id,))
            rules = cursor.fetchone() or (11, 15)
            diem_cham, diem_toi_da = int(rules[0]), int(rules[1])

            def max_allowed(opponent_score):
                opponent_score = opponent_score or 0
                if opponent_score >= diem_cham - 1:
                    return min(opponent_score + 2, diem_toi_da)
                return min(diem_cham, diem_toi_da)

            if diem_a is not None and diem_b is not None:
                diem_a = min(diem_a, max_allowed(diem_b))
                diem_b = min(diem_b, max_allowed(diem_a))

            trang_thai = 'Chưa diễn ra'
            if diem_a is not None and diem_b is not None:
                trang_thai = 'Đang đánh'
                diem_cao = max(diem_a, diem_b)
                chen_lech = abs(diem_a - diem_b)
                if diem_cao >= diem_toi_da or (diem_cao >= diem_cham and chen_lech >= 2):
                    trang_thai = 'Đã xong'

            thu_tu_danh = int(thu_tu_danh) if thu_tu_danh in (1, 2, '1', '2') else 2
            doi_dang_giao = doi_dang_giao if doi_dang_giao in ('A', 'B') else 'A'
            cursor.execute("""
                UPDATE tran_dau
                SET diem_doi_a=%s, diem_doi_b=%s, thu_tu_danh=%s, doi_dang_giao=%s, trang_thai=%s
                WHERE id=%s;
            """, (diem_a, diem_b, thu_tu_danh, doi_dang_giao, trang_thai, tran_id))
            return trang_thai, diem_a, diem_b

    @staticmethod
    def get_bang_xep_hang_by_matches(matches):
        """Calculate ranking from matches"""
        bang = {}
        for m in matches:
            doi_a, doi_b, d_a, d_b = m[1], m[2], m[3], m[4]
            for doi in [doi_a, doi_b]:
                if doi not in bang:
                    bang[doi] = {"ten": doi, "thang": 0, "thua": 0, "hieu_so": 0, "diem": 0, "so_tran": 0}
            if len(m) > 5 and not _is_done_status(m[5]):
                continue
            d_a = d_a or 0
            d_b = d_b or 0
            bang[doi_a]["so_tran"] += 1
            bang[doi_b]["so_tran"] += 1
            bang[doi_a]["hieu_so"] += d_a - d_b
            bang[doi_b]["hieu_so"] += d_b - d_a
            if d_a > d_b:
                bang[doi_a]["thang"] += 1
                bang[doi_a]["diem"] += 1
                bang[doi_b]["thua"] += 1
            elif d_b > d_a:
                bang[doi_b]["thang"] += 1
                bang[doi_b]["diem"] += 1
                bang[doi_a]["thua"] += 1
        return sorted(bang.values(), key=lambda x: (-x["diem"], -x["hieu_so"]))


class EntertainmentCardGameModel:
    @staticmethod
    def create_game(name, owner_admin_id=None, created_by_role=None, created_by_client_id=None):
        game_name = (name or "").strip() or "Ghi điểm đánh bài"
        with db_cursor(commit=True) as cursor:
            cursor.execute("""
                INSERT INTO entertainment_card_games (
                    name, owner_admin_id, created_by_role, created_by_client_id
                )
                VALUES (%s, %s, %s, %s)
                RETURNING id;
            """, (game_name, owner_admin_id, created_by_role, created_by_client_id))
            return cursor.fetchone()[0]

    @staticmethod
    def get_games(limit=50):
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT g.id, g.name, g.status, g.created_at, g.ended_at,
                       COUNT(DISTINCT p.id) AS player_count,
                       COUNT(DISTINCT r.id) AS round_count,
                       COALESCE(admin.display_name, client.display_name, g.created_by_role, 'Không rõ') AS creator_name,
                       g.created_by_role,
                       g.owner_admin_id,
                       g.created_by_client_id
                FROM entertainment_card_games g
                LEFT JOIN users admin ON admin.id = g.owner_admin_id
                LEFT JOIN user_clients client ON client.id = g.created_by_client_id
                LEFT JOIN entertainment_card_players p ON p.game_id = g.id AND p.active = TRUE
                LEFT JOIN entertainment_card_rounds r ON r.game_id = g.id
                GROUP BY g.id, admin.display_name, client.display_name
                ORDER BY
                    CASE WHEN g.status = 'active' THEN 0 ELSE 1 END,
                    g.created_at DESC
                LIMIT %s;
            """, (limit,))
            return cursor.fetchall()

    @staticmethod
    def get_game(game_id):
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT id, name, status, owner_admin_id, created_by_role,
                       created_by_client_id, created_at, ended_at
                FROM entertainment_card_games
                WHERE id = %s;
            """, (game_id,))
            return cursor.fetchone()

    @staticmethod
    def delete_game(game_id):
        with db_cursor(commit=True) as cursor:
            cursor.execute("""
                DELETE FROM entertainment_card_games
                WHERE id = %s;
            """, (game_id,))
            return cursor.rowcount

    @staticmethod
    def get_players(game_id):
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT id, name, user_client_id, active, created_at
                FROM entertainment_card_players
                WHERE game_id = %s AND active = TRUE
                ORDER BY id ASC;
            """, (game_id,))
            return cursor.fetchall()

    @staticmethod
    def deactivate_player(game_id, player_id):
        with db_cursor(commit=True) as cursor:
            cursor.execute("""
                UPDATE entertainment_card_players
                SET active = FALSE
                WHERE game_id = %s AND id = %s AND active = TRUE;
            """, (game_id, player_id))
            return cursor.rowcount

    @staticmethod
    def get_available_clients(game_id):
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT c.id, c.display_name, c.skill_level, c.email
                FROM user_clients c
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM entertainment_card_players p
                    WHERE p.game_id = %s
                      AND p.user_client_id = c.id
                      AND p.active = TRUE
                )
                ORDER BY c.display_name ASC;
            """, (game_id,))
            return cursor.fetchall()

    @staticmethod
    def add_player_from_client(game_id, user_client_id):
        with db_cursor(commit=True) as cursor:
            cursor.execute("""
                SELECT display_name
                FROM user_clients
                WHERE id = %s;
            """, (user_client_id,))
            client = cursor.fetchone()
            if not client:
                raise ValueError("Không tìm thấy người chơi trong danh sách client.")

            cursor.execute("""
                UPDATE entertainment_card_players
                SET active = TRUE, name = %s
                WHERE game_id = %s AND user_client_id = %s AND active = FALSE
                RETURNING id;
            """, (client[0], game_id, user_client_id))
            row = cursor.fetchone()
            if row:
                return row[0]

            cursor.execute("""
                INSERT INTO entertainment_card_players (game_id, name, user_client_id)
                VALUES (%s, %s, %s)
                ON CONFLICT (game_id, user_client_id) WHERE active = TRUE AND user_client_id IS NOT NULL
                DO UPDATE SET name = EXCLUDED.name
                RETURNING id;
            """, (game_id, client[0], user_client_id))
            return cursor.fetchone()[0]

    @staticmethod
    def add_round(game_id, scores, starter_player_id=None, note=""):
        clean_scores = []
        for player_id, score in scores.items():
            try:
                clean_scores.append((int(player_id), int(score or 0)))
            except (TypeError, ValueError):
                raise ValueError("Điểm từng người phải là số nguyên.")
        if not clean_scores:
            raise ValueError("Cần ít nhất 1 người chơi để ghi điểm.")
        if sum(score for _, score in clean_scores) != 0:
            raise ValueError("Tổng điểm của trận phải bằng 0.")

        with db_cursor(commit=True) as cursor:
            cursor.execute("""
                SELECT COALESCE(MAX(round_no), 0) + 1
                FROM entertainment_card_rounds
                WHERE game_id = %s;
            """, (game_id,))
            round_no = cursor.fetchone()[0]

            cursor.execute("""
                INSERT INTO entertainment_card_rounds (game_id, round_no, starter_player_id, note)
                VALUES (%s, %s, %s, %s)
                RETURNING id;
            """, (game_id, round_no, starter_player_id, (note or "").strip()))
            round_id = cursor.fetchone()[0]

            for player_id, score in clean_scores:
                cursor.execute("""
                    INSERT INTO entertainment_card_scores (round_id, player_id, score)
                    VALUES (%s, %s, %s);
                """, (round_id, player_id, score))
            return round_id, round_no

    @staticmethod
    def get_scoreboard(game_id):
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT p.id, p.name,
                       COALESCE(SUM(s.score), 0) AS total_score,
                       COUNT(s.id) AS scored_rounds,
                       p.active
                FROM entertainment_card_players p
                LEFT JOIN entertainment_card_scores s ON s.player_id = p.id
                LEFT JOIN entertainment_card_rounds r ON r.id = s.round_id AND r.game_id = p.game_id
                WHERE p.game_id = %s
                GROUP BY p.id, p.name, p.active
                ORDER BY total_score DESC, p.active DESC, p.name ASC;
            """, (game_id,))
            return cursor.fetchall()

    @staticmethod
    def get_rounds(game_id):
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT r.id, r.round_no, r.note, r.created_at,
                       sp.name AS starter_name,
                       p.name AS player_name,
                       s.score
                FROM entertainment_card_rounds r
                LEFT JOIN entertainment_card_players sp ON sp.id = r.starter_player_id
                LEFT JOIN entertainment_card_scores s ON s.round_id = r.id
                LEFT JOIN entertainment_card_players p ON p.id = s.player_id
                WHERE r.game_id = %s
                ORDER BY r.round_no DESC, p.id ASC;
            """, (game_id,))
            rows = cursor.fetchall()

        rounds = []
        by_round = {}
        for row in rows:
            round_id = row[0]
            if round_id not in by_round:
                by_round[round_id] = {
                    "id": round_id,
                    "round_no": row[1],
                    "note": row[2],
                    "created_at": row[3],
                    "starter_name": row[4],
                    "scores": [],
                }
                rounds.append(by_round[round_id])
            if row[5] is not None:
                by_round[round_id]["scores"].append({"player_name": row[5], "score": row[6]})
        return rounds

    @staticmethod
    def end_game(game_id):
        with db_cursor(commit=True) as cursor:
            cursor.execute("""
                UPDATE entertainment_card_games
                SET status = 'ended', ended_at = CURRENT_TIMESTAMP
                WHERE id = %s;
            """, (game_id,))


class EntertainmentLiengGameModel:
    TURN_SECONDS = 60

    @staticmethod
    def create_game(name, min_bet, max_bet=None, owner_admin_id=None, created_by_role=None, created_by_client_id=None):
        game_name = (name or "").strip() or "Ghi điểm tố liêng"
        min_bet = max(1, int(min_bet or 1))
        max_bet = int(max_bet) if str(max_bet or "").strip() else None
        with db_cursor(commit=True) as cursor:
            cursor.execute("""
                INSERT INTO entertainment_lieng_games (
                    name, min_bet, max_bet, owner_admin_id, created_by_role, created_by_client_id
                )
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id;
            """, (game_name, min_bet, max_bet, owner_admin_id, created_by_role, created_by_client_id))
            return cursor.fetchone()[0]

    @staticmethod
    def get_games(limit=50):
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT g.id, g.name, g.status, g.min_bet, g.max_bet, g.pot, g.round_no,
                       COALESCE(admin.display_name, client.display_name, g.created_by_role, 'Không rõ') AS creator_name,
                       COUNT(p.id) AS player_count,
                       g.created_at
                FROM entertainment_lieng_games g
                LEFT JOIN users admin ON admin.id = g.owner_admin_id
                LEFT JOIN user_clients client ON client.id = g.created_by_client_id
                LEFT JOIN entertainment_lieng_participants p ON p.game_id = g.id AND p.active = TRUE
                GROUP BY g.id, admin.display_name, client.display_name
                ORDER BY CASE WHEN g.status IN ('setup', 'playing', 'showdown') THEN 0 ELSE 1 END, g.created_at DESC
                LIMIT %s;
            """, (limit,))
            return cursor.fetchall()

    @staticmethod
    def get_game(game_id):
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT id, name, status, min_bet, max_bet, pot, round_no,
                       current_turn_participant_id, turn_started_at,
                       owner_admin_id, created_by_role, created_by_client_id, created_at, ended_at
                FROM entertainment_lieng_games
                WHERE id = %s;
            """, (game_id,))
            return cursor.fetchone()

    @staticmethod
    def delete_game(game_id):
        with db_cursor(commit=True) as cursor:
            cursor.execute("DELETE FROM entertainment_lieng_games WHERE id = %s;", (game_id,))
            return cursor.rowcount

    @staticmethod
    def end_game(game_id):
        with db_cursor(commit=True) as cursor:
            cursor.execute("SELECT status FROM entertainment_lieng_games WHERE id = %s;", (game_id,))
            row = cursor.fetchone()
            if not row:
                raise ValueError("Không tìm thấy bàn.")
            if row[0] != 'setup':
                raise ValueError("Chỉ kết thúc bàn khi đang chờ ván, không còn pot/lượt đang xử lý.")
            cursor.execute("""
                UPDATE entertainment_lieng_games
                SET status = 'ended', ended_at = CURRENT_TIMESTAMP,
                    current_turn_participant_id = NULL, turn_started_at = NULL
                WHERE id = %s;
            """, (game_id,))
            cursor.execute("""
                INSERT INTO entertainment_lieng_actions (game_id, round_no, action_type, note)
                SELECT id, round_no, 'end_game', 'Kết thúc bàn'
                FROM entertainment_lieng_games WHERE id = %s;
            """, (game_id,))

    @staticmethod
    def get_participants(game_id):
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT id, display_name, user_role, admin_id, user_client_id, seat_no,
                       active, folded, current_bet, score, last_action_at
                FROM entertainment_lieng_participants
                WHERE game_id = %s AND active = TRUE
                ORDER BY COALESCE(seat_no, 9999), id;
            """, (game_id,))
            return cursor.fetchall()

    @staticmethod
    def get_scoreboard(game_id):
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT id, display_name, score, active, seat_no
                FROM entertainment_lieng_participants
                WHERE game_id = %s
                ORDER BY score DESC, active DESC, display_name ASC;
            """, (game_id,))
            return cursor.fetchall()

    @staticmethod
    def get_actions(game_id, limit=40):
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT a.id, a.round_no, a.action_type, a.amount, a.note, a.created_at,
                       p.display_name
                FROM entertainment_lieng_actions a
                LEFT JOIN entertainment_lieng_participants p ON p.id = a.participant_id
                WHERE a.game_id = %s
                ORDER BY a.id DESC
                LIMIT %s;
            """, (game_id, limit))
            return cursor.fetchall()

    @staticmethod
    def get_available_clients(game_id):
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT c.id, c.display_name, c.email
                FROM user_clients c
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM entertainment_lieng_participants p
                    WHERE p.game_id = %s AND p.user_client_id = c.id AND p.active = TRUE
                )
                ORDER BY c.display_name ASC;
            """, (game_id,))
            return cursor.fetchall()

    @staticmethod
    def add_client(game_id, user_client_id):
        with db_cursor(commit=True) as cursor:
            cursor.execute("SELECT display_name FROM user_clients WHERE id = %s;", (user_client_id,))
            client = cursor.fetchone()
            if not client:
                raise ValueError("Không tìm thấy client.")
            cursor.execute("""
                INSERT INTO entertainment_lieng_participants (game_id, display_name, user_role, user_client_id)
                VALUES (%s, %s, 'vdv', %s)
                ON CONFLICT (game_id, user_client_id) WHERE user_client_id IS NOT NULL
                DO UPDATE SET active = TRUE, display_name = EXCLUDED.display_name,
                              folded = FALSE, current_bet = 0, seat_no = NULL
                RETURNING id;
            """, (game_id, client[0], user_client_id))
            return cursor.fetchone()[0]

    @staticmethod
    def active_table_for_user(user):
        with db_cursor() as cursor:
            if user.get("role") == "admin":
                cursor.execute("""
                    SELECT p.game_id, g.name
                    FROM entertainment_lieng_participants p
                    JOIN entertainment_lieng_games g ON g.id = p.game_id
                    WHERE p.admin_id = %s AND p.active = TRUE AND g.status <> 'ended'
                    LIMIT 1;
                """, (user.get("id"),))
            else:
                cursor.execute("""
                    SELECT p.game_id, g.name
                    FROM entertainment_lieng_participants p
                    JOIN entertainment_lieng_games g ON g.id = p.game_id
                    WHERE p.user_client_id = %s AND p.active = TRUE AND g.status <> 'ended'
                    LIMIT 1;
                """, (user.get("id"),))
            return cursor.fetchone()

    @staticmethod
    def add_current_user(game_id, user):
        with db_cursor(commit=True) as cursor:
            cursor.execute("SELECT status FROM entertainment_lieng_games WHERE id = %s;", (game_id,))
            game = cursor.fetchone()
            if not game:
                raise ValueError("Không tìm thấy bàn.")
            if game[0] != 'setup':
                raise ValueError("Bàn đang có ván chưa kết thúc, chưa thể thêm người chơi.")
            if user.get("role") == "admin":
                cursor.execute("""
                    SELECT p.game_id, g.name
                    FROM entertainment_lieng_participants p
                    JOIN entertainment_lieng_games g ON g.id = p.game_id
                    WHERE p.admin_id = %s AND p.active = TRUE AND g.status <> 'ended'
                    LIMIT 1;
                """, (user.get("id"),))
                active_table = cursor.fetchone()
                if active_table and active_table[0] == game_id:
                    raise ValueError("Bạn đã ở trong bàn.")
                if active_table:
                    raise ValueError(f"Bạn đang ở bàn {active_table[1]}. Hãy thoát bàn đó trước khi vào bàn khác.")
                cursor.execute("""
                    INSERT INTO entertainment_lieng_participants (game_id, display_name, user_role, admin_id)
                    VALUES (%s, %s, 'admin', %s)
                    ON CONFLICT (game_id, admin_id) WHERE admin_id IS NOT NULL
                    DO UPDATE SET active = TRUE, display_name = EXCLUDED.display_name,
                                  folded = FALSE, current_bet = 0, seat_no = NULL
                    RETURNING id;
                """, (game_id, user.get("display_name") or user.get("email") or "Admin", user.get("id")))
            else:
                cursor.execute("""
                    SELECT p.game_id, g.name
                    FROM entertainment_lieng_participants p
                    JOIN entertainment_lieng_games g ON g.id = p.game_id
                    WHERE p.user_client_id = %s AND p.active = TRUE AND g.status <> 'ended'
                    LIMIT 1;
                """, (user.get("id"),))
                active_table = cursor.fetchone()
                if active_table and active_table[0] == game_id:
                    raise ValueError("Bạn đã ở trong bàn.")
                if active_table:
                    raise ValueError(f"Bạn đang ở bàn {active_table[1]}. Hãy thoát bàn đó trước khi vào bàn khác.")
                cursor.execute("""
                    INSERT INTO entertainment_lieng_participants (game_id, display_name, user_role, user_client_id)
                    VALUES (%s, %s, 'vdv', %s)
                    ON CONFLICT (game_id, user_client_id) WHERE user_client_id IS NOT NULL
                    DO UPDATE SET active = TRUE, display_name = EXCLUDED.display_name,
                                  folded = FALSE, current_bet = 0, seat_no = NULL
                    RETURNING id;
                """, (game_id, user.get("display_name") or user.get("ten") or user.get("email") or "Client", user.get("id")))
            return cursor.fetchone()[0]

    @staticmethod
    def leave_current_user(game_id, user):
        with db_cursor(commit=True) as cursor:
            cursor.execute("SELECT status FROM entertainment_lieng_games WHERE id = %s;", (game_id,))
            game = cursor.fetchone()
            if not game:
                raise ValueError("Không tìm thấy bàn.")
            if game[0] != 'setup':
                raise ValueError("Chỉ có thể thoát bàn khi đang chờ ván.")
            if user.get("role") == "admin":
                cursor.execute("""
                    SELECT id, display_name
                    FROM entertainment_lieng_participants
                    WHERE game_id = %s AND admin_id = %s AND active = TRUE LIMIT 1;
                """, (game_id, user.get("id")))
            else:
                cursor.execute("""
                    SELECT id, display_name
                    FROM entertainment_lieng_participants
                    WHERE game_id = %s AND user_client_id = %s AND active = TRUE LIMIT 1;
                """, (game_id, user.get("id")))
            participant = cursor.fetchone()
            if not participant:
                raise ValueError("Bạn chưa ở trong bàn này.")
            participant_id, display_name = participant
            cursor.execute("""
                UPDATE entertainment_lieng_participants
                SET active = FALSE, folded = FALSE, current_bet = 0, seat_no = NULL
                WHERE id = %s;
            """, (participant_id,))
            cursor.execute("""
                INSERT INTO entertainment_lieng_actions (game_id, participant_id, round_no, action_type, note)
                SELECT id, %s, round_no, 'leave', %s
                FROM entertainment_lieng_games WHERE id = %s;
            """, (participant_id, f"{display_name} thoát bàn", game_id))
            return display_name

    @staticmethod
    def shuffle_seats(game_id):
        participants = EntertainmentLiengGameModel.get_participants(game_id)
        shuffled = list(participants)
        random.shuffle(shuffled)
        with db_cursor(commit=True) as cursor:
            for seat_no, participant in enumerate(shuffled, start=1):
                cursor.execute("UPDATE entertainment_lieng_participants SET seat_no = %s WHERE id = %s;", (seat_no, participant[0]))
        return len(shuffled)

    @staticmethod
    def participant_for_user(game_id, user):
        with db_cursor() as cursor:
            if user.get("role") == "admin":
                cursor.execute("""
                    SELECT id FROM entertainment_lieng_participants
                    WHERE game_id = %s AND admin_id = %s AND active = TRUE LIMIT 1;
                """, (game_id, user.get("id")))
            else:
                cursor.execute("""
                    SELECT id FROM entertainment_lieng_participants
                    WHERE game_id = %s AND user_client_id = %s AND active = TRUE LIMIT 1;
                """, (game_id, user.get("id")))
            row = cursor.fetchone()
            return row[0] if row else None

    @staticmethod
    def _next_turn(cursor, game_id, current_id=None):
        cursor.execute("""
            SELECT id
            FROM entertainment_lieng_participants
            WHERE game_id = %s AND active = TRUE AND folded = FALSE
            ORDER BY COALESCE(seat_no, 9999), id;
        """, (game_id,))
        ids = [row[0] for row in cursor.fetchall()]
        if len(ids) <= 1:
            return None
        if current_id not in ids:
            return ids[0]
        return ids[(ids.index(current_id) + 1) % len(ids)]

    @staticmethod
    def _required_bet_for_turn(cursor, game_id, participant_id, min_bet):
        cursor.execute("""
            SELECT id, current_bet
            FROM entertainment_lieng_participants
            WHERE game_id = %s AND active = TRUE AND folded = FALSE
            ORDER BY COALESCE(seat_no, 9999), id;
        """, (game_id,))
        rows = cursor.fetchall()
        if not rows:
            return int(min_bet)
        ids = [row[0] for row in rows]
        if participant_id not in ids:
            return int(min_bet)
        current_index = ids.index(participant_id)
        current_bet = int(rows[current_index][1] or 0)
        previous_bet = int(rows[current_index - 1][1] or 0)
        return max(int(min_bet), previous_bet - current_bet)

    @staticmethod
    def required_bet_for_turn(game_id, participant_id):
        if not participant_id:
            return None
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT status, min_bet, current_turn_participant_id
                FROM entertainment_lieng_games
                WHERE id = %s;
            """, (game_id,))
            game = cursor.fetchone()
            if not game:
                return None
            status, min_bet, current_turn_id = game
            if status != 'playing' or current_turn_id != participant_id:
                return None
            return EntertainmentLiengGameModel._required_bet_for_turn(cursor, game_id, participant_id, min_bet)

    @staticmethod
    def _finish_if_one_left(cursor, game_id):
        cursor.execute("""
            SELECT id, display_name
            FROM entertainment_lieng_participants
            WHERE game_id = %s AND active = TRUE AND folded = FALSE;
        """, (game_id,))
        rows = cursor.fetchall()
        if len(rows) != 1:
            return False
        winner_id, winner_name = rows[0]
        cursor.execute("SELECT pot, round_no FROM entertainment_lieng_games WHERE id = %s;", (game_id,))
        pot, round_no = cursor.fetchone()
        cursor.execute("UPDATE entertainment_lieng_participants SET score = score + %s WHERE id = %s;", (pot, winner_id))
        cursor.execute("""
            INSERT INTO entertainment_lieng_actions (game_id, participant_id, round_no, action_type, amount, note)
            VALUES (%s, %s, %s, 'win', %s, %s);
        """, (game_id, winner_id, round_no, pot, f"{winner_name} thắng pot"))
        cursor.execute("""
            UPDATE entertainment_lieng_games
            SET status = 'setup', pot = 0, current_turn_participant_id = NULL, turn_started_at = NULL
            WHERE id = %s;
        """, (game_id,))
        cursor.execute("""
            UPDATE entertainment_lieng_participants
            SET current_bet = 0, folded = FALSE
            WHERE game_id = %s AND active = TRUE;
        """, (game_id,))
        return True

    @staticmethod
    def _move_to_showdown_if_balanced(cursor, game_id, participant_id, previous_bet):
        cursor.execute("""
            SELECT id, current_bet
            FROM entertainment_lieng_participants
            WHERE game_id = %s AND active = TRUE AND folded = FALSE
            ORDER BY COALESCE(seat_no, 9999), id;
        """, (game_id,))
        rows = cursor.fetchall()
        if len(rows) <= 1:
            return False
        current_bets = [int(row[1] or 0) for row in rows]
        highest_bet = max(current_bets)
        if any(bet != highest_bet for bet in current_bets):
            return False
        if int(previous_bet or 0) >= highest_bet:
            return False
        return EntertainmentLiengGameModel._move_to_showdown(
            cursor,
            game_id,
            participant_id,
            'Đã cân điểm, chờ người thắng xác nhận'
        )

    @staticmethod
    def _move_to_showdown_if_remaining_balanced(cursor, game_id, participant_id, note):
        cursor.execute("""
            SELECT id, current_bet
            FROM entertainment_lieng_participants
            WHERE game_id = %s AND active = TRUE AND folded = FALSE
            ORDER BY COALESCE(seat_no, 9999), id;
        """, (game_id,))
        rows = cursor.fetchall()
        if len(rows) <= 1:
            return False
        current_bets = [int(row[1] or 0) for row in rows]
        if any(bet != current_bets[0] for bet in current_bets):
            return False
        return EntertainmentLiengGameModel._move_to_showdown(cursor, game_id, participant_id, note)

    @staticmethod
    def _move_to_showdown(cursor, game_id, participant_id, note):
        cursor.execute("""
            UPDATE entertainment_lieng_games
            SET status = 'showdown', current_turn_participant_id = NULL, turn_started_at = NULL
            WHERE id = %s;
        """, (game_id,))
        cursor.execute("""
            INSERT INTO entertainment_lieng_actions (game_id, participant_id, round_no, action_type, note)
            SELECT id, %s, round_no, 'showdown', %s
            FROM entertainment_lieng_games WHERE id = %s;
        """, (participant_id, note, game_id))
        return True

    @staticmethod
    def declare_winner(game_id, winner_id):
        with db_cursor(commit=True) as cursor:
            cursor.execute("""
                SELECT status, pot, round_no
                FROM entertainment_lieng_games
                WHERE id = %s;
            """, (game_id,))
            game = cursor.fetchone()
            if not game:
                raise ValueError("Không tìm thấy bàn.")
            status, pot, round_no = game
            if status != 'showdown':
                raise ValueError("Chỉ xác nhận người thắng khi ván đã cân điểm.")
            cursor.execute("""
                SELECT display_name
                FROM entertainment_lieng_participants
                WHERE id = %s AND game_id = %s AND active = TRUE AND folded = FALSE;
            """, (winner_id, game_id))
            winner = cursor.fetchone()
            if not winner:
                raise ValueError("Người thắng không hợp lệ.")
            winner_name = winner[0]
            cursor.execute("UPDATE entertainment_lieng_participants SET score = score + %s WHERE id = %s;", (pot, winner_id))
            cursor.execute("""
                INSERT INTO entertainment_lieng_actions (game_id, participant_id, round_no, action_type, amount, note)
                VALUES (%s, %s, %s, 'win', %s, %s);
            """, (game_id, winner_id, round_no, pot, f"{winner_name} xác nhận thắng sau khi cân điểm"))
            cursor.execute("""
                UPDATE entertainment_lieng_games
                SET status = 'setup', pot = 0, current_turn_participant_id = NULL, turn_started_at = NULL
                WHERE id = %s;
            """, (game_id,))
            cursor.execute("""
                UPDATE entertainment_lieng_participants
                SET current_bet = 0, folded = FALSE
                WHERE game_id = %s AND active = TRUE;
            """, (game_id,))
            return winner_name, pot

    @staticmethod
    def apply_timeout_if_needed(game_id):
        with db_cursor(commit=True) as cursor:
            cursor.execute("""
                SELECT g.current_turn_participant_id, p.display_name
                FROM entertainment_lieng_games g
                JOIN entertainment_lieng_participants p ON p.id = g.current_turn_participant_id
                WHERE g.id = %s AND g.status = 'playing'
                  AND g.current_turn_participant_id IS NOT NULL
                  AND g.turn_started_at < NOW() - INTERVAL '60 seconds';
            """, (game_id,))
            row = cursor.fetchone()
            if not row:
                return False
            participant_id, display_name = row
            cursor.execute("""
                UPDATE entertainment_lieng_participants
                SET active = FALSE, folded = TRUE, seat_no = NULL, last_action_at = CURRENT_TIMESTAMP
                WHERE id = %s;
            """, (participant_id,))
            cursor.execute("""
                INSERT INTO entertainment_lieng_actions (game_id, participant_id, round_no, action_type, note)
                SELECT id, %s, round_no, 'timeout_leave', %s
                FROM entertainment_lieng_games WHERE id = %s;
            """, (participant_id, f"{display_name} quá 60 giây, tự bỏ và rời bàn", game_id))
            if not EntertainmentLiengGameModel._finish_if_one_left(cursor, game_id):
                if EntertainmentLiengGameModel._move_to_showdown_if_remaining_balanced(
                    cursor,
                    game_id,
                    participant_id,
                    f"{display_name} rời bàn do quá 60 giây. Những người còn lại đã cân điểm."
                ):
                    return True
                next_id = EntertainmentLiengGameModel._next_turn(cursor, game_id, participant_id)
                cursor.execute("""
                    UPDATE entertainment_lieng_games
                    SET current_turn_participant_id = %s, turn_started_at = CURRENT_TIMESTAMP
                    WHERE id = %s;
                """, (next_id, game_id))
            return True

    @staticmethod
    def start_round(game_id):
        with db_cursor(commit=True) as cursor:
            cursor.execute("SELECT status, min_bet FROM entertainment_lieng_games WHERE id = %s;", (game_id,))
            row = cursor.fetchone()
            if not row:
                raise ValueError("Không tìm thấy bàn.")
            status, min_bet = row
            if status != 'setup':
                raise ValueError("Bàn đang có ván chưa kết thúc.")
            min_bet = int(min_bet)
            cursor.execute("""
                SELECT id FROM entertainment_lieng_participants
                WHERE game_id = %s AND active = TRUE
                ORDER BY COALESCE(seat_no, 9999), id;
            """, (game_id,))
            ids = [item[0] for item in cursor.fetchall()]
            if len(ids) < 2:
                raise ValueError("Cần ít nhất 2 người chơi để bắt đầu.")
            pot = min_bet * len(ids)
            cursor.execute("""
                UPDATE entertainment_lieng_participants
                SET folded = FALSE, current_bet = %s, score = score - %s
                WHERE game_id = %s AND active = TRUE;
            """, (min_bet, min_bet, game_id))
            cursor.execute("""
                UPDATE entertainment_lieng_games
                SET status = 'playing', pot = %s, round_no = round_no + 1,
                    current_turn_participant_id = %s, turn_started_at = CURRENT_TIMESTAMP
                WHERE id = %s
                RETURNING round_no;
            """, (pot, ids[0], game_id))
            round_no = cursor.fetchone()[0]
            for participant_id in ids:
                cursor.execute("""
                    INSERT INTO entertainment_lieng_actions (game_id, participant_id, round_no, action_type, amount, note)
                    VALUES (%s, %s, %s, 'ante', %s, 'Trừ min cược');
                """, (game_id, participant_id, round_no, min_bet))
            return round_no

    @staticmethod
    def act(game_id, participant_id, action_type, amount=0):
        amount = int(amount or 0)
        with db_cursor(commit=True) as cursor:
            cursor.execute("""
                SELECT status, min_bet, max_bet, current_turn_participant_id, round_no
                FROM entertainment_lieng_games WHERE id = %s;
            """, (game_id,))
            game = cursor.fetchone()
            if not game:
                raise ValueError("Không tìm thấy bàn.")
            status, min_bet, max_bet, current_turn_id, round_no = game
            if status != 'playing':
                raise ValueError("Ván chưa bắt đầu.")
            if current_turn_id != participant_id:
                raise ValueError("Chưa đến lượt của bạn.")
            if action_type == 'bet':
                required_bet = EntertainmentLiengGameModel._required_bet_for_turn(cursor, game_id, participant_id, min_bet)
                if amount < required_bet:
                    raise ValueError(f"Điểm tố lượt này phải từ {required_bet} trở lên để bằng người trước.")
                if max_bet is not None and amount > int(max_bet):
                    raise ValueError("Điểm tố vượt max cược 1 vòng.")
                cursor.execute("SELECT current_bet FROM entertainment_lieng_participants WHERE id = %s;", (participant_id,))
                previous_bet = cursor.fetchone()[0]
                cursor.execute("""
                    UPDATE entertainment_lieng_participants
                    SET current_bet = current_bet + %s, score = score - %s, last_action_at = CURRENT_TIMESTAMP
                    WHERE id = %s;
                """, (amount, amount, participant_id))
                cursor.execute("UPDATE entertainment_lieng_games SET pot = pot + %s WHERE id = %s;", (amount, game_id))
                cursor.execute("""
                    INSERT INTO entertainment_lieng_actions (game_id, participant_id, round_no, action_type, amount)
                    VALUES (%s, %s, %s, 'bet', %s);
                """, (game_id, participant_id, round_no, amount))
            elif action_type == 'fold':
                cursor.execute("""
                    UPDATE entertainment_lieng_participants
                    SET folded = TRUE, last_action_at = CURRENT_TIMESTAMP
                    WHERE id = %s;
                """, (participant_id,))
                cursor.execute("""
                    INSERT INTO entertainment_lieng_actions (game_id, participant_id, round_no, action_type, note)
                    VALUES (%s, %s, %s, 'fold', 'Bỏ bài');
                """, (game_id, participant_id, round_no))
            else:
                raise ValueError("Hành động không hợp lệ.")

            if not EntertainmentLiengGameModel._finish_if_one_left(cursor, game_id):
                if action_type == 'bet' and EntertainmentLiengGameModel._move_to_showdown_if_balanced(cursor, game_id, participant_id, previous_bet):
                    return
                next_id = EntertainmentLiengGameModel._next_turn(cursor, game_id, participant_id)
                cursor.execute("""
                    UPDATE entertainment_lieng_games
                    SET current_turn_participant_id = %s, turn_started_at = CURRENT_TIMESTAMP
                    WHERE id = %s;
                """, (next_id, game_id))


class EntertainmentBaCayGameModel:
    BET_SECONDS = 20

    @staticmethod
    def create_game(name, min_bet, max_bet=None, owner_admin_id=None, created_by_role=None, created_by_client_id=None):
        game_name = (name or "").strip() or "Ghi điểm 3 cây"
        min_bet = max(1, int(min_bet or 1))
        max_bet = int(max_bet) if str(max_bet or "").strip() else None
        if max_bet is not None and max_bet < min_bet:
            raise ValueError("Max cược phải lớn hơn hoặc bằng min cược.")
        with db_cursor(commit=True) as cursor:
            cursor.execute("""
                INSERT INTO entertainment_ba_cay_games (
                    name, min_bet, max_bet, owner_admin_id, created_by_role, created_by_client_id
                )
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id;
            """, (game_name, min_bet, max_bet, owner_admin_id, created_by_role, created_by_client_id))
            return cursor.fetchone()[0]

    @staticmethod
    def get_games(limit=50):
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT g.id, g.name, g.status, g.min_bet, g.max_bet, g.round_no,
                       COALESCE(banker.display_name, '') AS banker_name,
                       COALESCE(admin.display_name, client.display_name, g.created_by_role, 'Không rõ') AS creator_name,
                       COUNT(p.id) AS player_count,
                       g.created_at
                FROM entertainment_ba_cay_games g
                LEFT JOIN entertainment_ba_cay_participants banker ON banker.id = g.banker_participant_id
                LEFT JOIN users admin ON admin.id = g.owner_admin_id
                LEFT JOIN user_clients client ON client.id = g.created_by_client_id
                LEFT JOIN entertainment_ba_cay_participants p ON p.game_id = g.id AND p.active = TRUE
                GROUP BY g.id, banker.display_name, admin.display_name, client.display_name
                ORDER BY CASE WHEN g.status IN ('setup', 'betting', 'settling') THEN 0 ELSE 1 END, g.created_at DESC
                LIMIT %s;
            """, (limit,))
            return cursor.fetchall()

    @staticmethod
    def get_game(game_id):
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT id, name, status, min_bet, max_bet, round_no,
                       banker_participant_id, bet_deadline_at,
                       owner_admin_id, created_by_role, created_by_client_id, created_at, ended_at
                FROM entertainment_ba_cay_games
                WHERE id = %s;
            """, (game_id,))
            return cursor.fetchone()

    @staticmethod
    def delete_game(game_id):
        with db_cursor(commit=True) as cursor:
            cursor.execute("DELETE FROM entertainment_ba_cay_games WHERE id = %s;", (game_id,))
            return cursor.rowcount

    @staticmethod
    def end_game(game_id):
        with db_cursor(commit=True) as cursor:
            cursor.execute("SELECT status FROM entertainment_ba_cay_games WHERE id = %s;", (game_id,))
            row = cursor.fetchone()
            if not row:
                raise ValueError("Không tìm thấy bàn.")
            if row[0] not in ('setup', 'settling'):
                raise ValueError("Chỉ kết thúc bàn khi không còn thời gian cược đang chạy.")
            cursor.execute("""
                UPDATE entertainment_ba_cay_games
                SET status = 'ended', ended_at = CURRENT_TIMESTAMP, bet_deadline_at = NULL
                WHERE id = %s;
            """, (game_id,))
            cursor.execute("""
                INSERT INTO entertainment_ba_cay_actions (game_id, round_no, action_type, note)
                SELECT id, round_no, 'end_game', 'Kết thúc bàn'
                FROM entertainment_ba_cay_games WHERE id = %s;
            """, (game_id,))

    @staticmethod
    def get_participants(game_id, active_only=True):
        with db_cursor() as cursor:
            where_active = "AND active = TRUE" if active_only else ""
            cursor.execute(f"""
                SELECT id, display_name, user_role, admin_id, user_client_id, seat_no,
                       active, current_bet, bet_submitted, current_multiplier, score, last_action_at
                FROM entertainment_ba_cay_participants
                WHERE game_id = %s {where_active}
                ORDER BY COALESCE(seat_no, 9999), id;
            """, (game_id,))
            return cursor.fetchall()

    @staticmethod
    def get_scoreboard(game_id):
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT id, display_name, score, active, seat_no
                FROM entertainment_ba_cay_participants
                WHERE game_id = %s
                ORDER BY score DESC, active DESC, display_name ASC;
            """, (game_id,))
            return cursor.fetchall()

    @staticmethod
    def get_actions(game_id, limit=50):
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT a.id, a.round_no, a.action_type, a.amount, a.note, a.created_at,
                       p.display_name, target.display_name
                FROM entertainment_ba_cay_actions a
                LEFT JOIN entertainment_ba_cay_participants p ON p.id = a.participant_id
                LEFT JOIN entertainment_ba_cay_participants target ON target.id = a.target_participant_id
                WHERE a.game_id = %s
                ORDER BY a.id DESC
                LIMIT %s;
            """, (game_id, limit))
            return cursor.fetchall()

    @staticmethod
    def active_table_for_user(user):
        with db_cursor() as cursor:
            if user.get("role") == "admin":
                cursor.execute("""
                    SELECT p.game_id, g.name
                    FROM entertainment_ba_cay_participants p
                    JOIN entertainment_ba_cay_games g ON g.id = p.game_id
                    WHERE p.admin_id = %s AND p.active = TRUE AND g.status <> 'ended'
                    LIMIT 1;
                """, (user.get("id"),))
            else:
                cursor.execute("""
                    SELECT p.game_id, g.name
                    FROM entertainment_ba_cay_participants p
                    JOIN entertainment_ba_cay_games g ON g.id = p.game_id
                    WHERE p.user_client_id = %s AND p.active = TRUE AND g.status <> 'ended'
                    LIMIT 1;
                """, (user.get("id"),))
            return cursor.fetchone()

    @staticmethod
    def add_current_user(game_id, user):
        with db_cursor(commit=True) as cursor:
            cursor.execute("SELECT status FROM entertainment_ba_cay_games WHERE id = %s;", (game_id,))
            game = cursor.fetchone()
            if not game:
                raise ValueError("Không tìm thấy bàn.")
            if game[0] != 'setup':
                raise ValueError("Bàn đang có ván chưa kết thúc, chưa thể thêm người chơi.")
            id_col = "admin_id" if user.get("role") == "admin" else "user_client_id"
            cursor.execute(f"""
                SELECT p.game_id, g.name
                FROM entertainment_ba_cay_participants p
                JOIN entertainment_ba_cay_games g ON g.id = p.game_id
                WHERE p.{id_col} = %s AND p.active = TRUE AND g.status <> 'ended'
                LIMIT 1;
            """, (user.get("id"),))
            active_table = cursor.fetchone()
            if active_table and active_table[0] == game_id:
                raise ValueError("Bạn đã ở trong bàn.")
            if active_table:
                raise ValueError(f"Bạn đang ở bàn {active_table[1]}. Hãy thoát bàn đó trước khi vào bàn khác.")
            display_name = user.get("display_name") or user.get("ten") or user.get("email") or ("Admin" if user.get("role") == "admin" else "Client")
            if user.get("role") == "admin":
                cursor.execute("""
                    INSERT INTO entertainment_ba_cay_participants (game_id, display_name, user_role, admin_id)
                    VALUES (%s, %s, 'admin', %s)
                    ON CONFLICT (game_id, admin_id) WHERE admin_id IS NOT NULL
                    DO UPDATE SET active = TRUE, display_name = EXCLUDED.display_name,
                                  current_bet = 0, bet_submitted = FALSE, current_multiplier = 1, seat_no = NULL
                    RETURNING id;
                """, (game_id, display_name, user.get("id")))
            else:
                cursor.execute("""
                    INSERT INTO entertainment_ba_cay_participants (game_id, display_name, user_role, user_client_id)
                    VALUES (%s, %s, 'vdv', %s)
                    ON CONFLICT (game_id, user_client_id) WHERE user_client_id IS NOT NULL
                    DO UPDATE SET active = TRUE, display_name = EXCLUDED.display_name,
                                  current_bet = 0, bet_submitted = FALSE, current_multiplier = 1, seat_no = NULL
                    RETURNING id;
                """, (game_id, display_name, user.get("id")))
            participant_id = cursor.fetchone()[0]
            cursor.execute("""
                UPDATE entertainment_ba_cay_games
                SET banker_participant_id = COALESCE(banker_participant_id, %s)
                WHERE id = %s;
            """, (participant_id, game_id))
            return participant_id

    @staticmethod
    def leave_current_user(game_id, user):
        with db_cursor(commit=True) as cursor:
            cursor.execute("SELECT status, banker_participant_id FROM entertainment_ba_cay_games WHERE id = %s;", (game_id,))
            game = cursor.fetchone()
            if not game:
                raise ValueError("Không tìm thấy bàn.")
            if game[0] != 'setup':
                raise ValueError("Chỉ có thể thoát bàn khi đang chờ ván.")
            id_col = "admin_id" if user.get("role") == "admin" else "user_client_id"
            cursor.execute(f"""
                SELECT id, display_name
                FROM entertainment_ba_cay_participants
                WHERE game_id = %s AND {id_col} = %s AND active = TRUE LIMIT 1;
            """, (game_id, user.get("id")))
            participant = cursor.fetchone()
            if not participant:
                raise ValueError("Bạn chưa ở trong bàn này.")
            participant_id, display_name = participant
            cursor.execute("""
                UPDATE entertainment_ba_cay_participants
                SET active = FALSE, current_bet = 0, bet_submitted = FALSE, current_multiplier = 1, seat_no = NULL
                WHERE id = %s;
            """, (participant_id,))
            if game[1] == participant_id:
                cursor.execute("""
                    SELECT id FROM entertainment_ba_cay_participants
                    WHERE game_id = %s AND active = TRUE AND id <> %s
                    ORDER BY COALESCE(seat_no, 9999), id LIMIT 1;
                """, (game_id, participant_id))
                next_banker = cursor.fetchone()
                cursor.execute("UPDATE entertainment_ba_cay_games SET banker_participant_id = %s WHERE id = %s;", (next_banker[0] if next_banker else None, game_id))
            cursor.execute("""
                INSERT INTO entertainment_ba_cay_actions (game_id, participant_id, round_no, action_type, note)
                SELECT id, %s, round_no, 'leave', %s
                FROM entertainment_ba_cay_games WHERE id = %s;
            """, (participant_id, f"{display_name} thoát bàn", game_id))
            return display_name

    @staticmethod
    def participant_for_user(game_id, user):
        with db_cursor() as cursor:
            id_col = "admin_id" if user.get("role") == "admin" else "user_client_id"
            cursor.execute(f"""
                SELECT id FROM entertainment_ba_cay_participants
                WHERE game_id = %s AND {id_col} = %s AND active = TRUE LIMIT 1;
            """, (game_id, user.get("id")))
            row = cursor.fetchone()
            return row[0] if row else None

    @staticmethod
    def shuffle_seats(game_id):
        participants = EntertainmentBaCayGameModel.get_participants(game_id)
        shuffled = list(participants)
        random.shuffle(shuffled)
        with db_cursor(commit=True) as cursor:
            for seat_no, participant in enumerate(shuffled, start=1):
                cursor.execute("UPDATE entertainment_ba_cay_participants SET seat_no = %s WHERE id = %s;", (seat_no, participant[0]))
        return len(shuffled)

    @staticmethod
    def random_banker(game_id):
        participants = EntertainmentBaCayGameModel.get_participants(game_id)
        if not participants:
            raise ValueError("Cần có người chơi để quay chương.")
        banker = random.choice(participants)
        with db_cursor(commit=True) as cursor:
            cursor.execute("UPDATE entertainment_ba_cay_games SET banker_participant_id = %s WHERE id = %s;", (banker[0], game_id))
            cursor.execute("""
                INSERT INTO entertainment_ba_cay_actions (game_id, participant_id, round_no, action_type, note)
                SELECT id, %s, round_no, 'banker', %s
                FROM entertainment_ba_cay_games WHERE id = %s;
            """, (banker[0], f"{banker[1]} làm chương", game_id))
        return banker[1]

    @staticmethod
    def set_banker(game_id, current_banker_id, new_banker_id):
        with db_cursor(commit=True) as cursor:
            cursor.execute("SELECT status, banker_participant_id FROM entertainment_ba_cay_games WHERE id = %s;", (game_id,))
            game = cursor.fetchone()
            if not game:
                raise ValueError("Không tìm thấy bàn.")
            if game[0] != 'setup':
                raise ValueError("Chỉ đổi chương khi đang chờ ván.")
            if game[1] != current_banker_id:
                raise ValueError("Chỉ người đang làm chương mới được chọn chương.")
            cursor.execute("""
                SELECT display_name FROM entertainment_ba_cay_participants
                WHERE id = %s AND game_id = %s AND active = TRUE;
            """, (new_banker_id, game_id))
            row = cursor.fetchone()
            if not row:
                raise ValueError("Người làm chương không hợp lệ.")
            cursor.execute("UPDATE entertainment_ba_cay_games SET banker_participant_id = %s WHERE id = %s;", (new_banker_id, game_id))
            cursor.execute("""
                INSERT INTO entertainment_ba_cay_actions (game_id, participant_id, round_no, action_type, note)
                SELECT id, %s, round_no, 'banker', %s
                FROM entertainment_ba_cay_games WHERE id = %s;
            """, (new_banker_id, f"{row[0]} làm chương", game_id))
            return row[0]

    @staticmethod
    def start_round(game_id, starter_participant_id=None):
        with db_cursor(commit=True) as cursor:
            cursor.execute("SELECT status, banker_participant_id FROM entertainment_ba_cay_games WHERE id = %s;", (game_id,))
            game = cursor.fetchone()
            if not game:
                raise ValueError("Không tìm thấy bàn.")
            if game[0] != 'setup':
                raise ValueError("Bàn đang có ván chưa kết thúc.")
            cursor.execute("""
                SELECT id FROM entertainment_ba_cay_participants
                WHERE game_id = %s AND active = TRUE
                ORDER BY COALESCE(seat_no, 9999), id;
            """, (game_id,))
            ids = [row[0] for row in cursor.fetchall()]
            if len(ids) < 2:
                raise ValueError("Cần ít nhất 2 người chơi để bắt đầu.")
            banker_id = game[1] if game[1] in ids else ids[0]
            if starter_participant_id is not None and starter_participant_id != banker_id:
                raise ValueError("Chỉ chương mới được bắt đầu ván.")
            cursor.execute("""
                UPDATE entertainment_ba_cay_participants
                SET current_bet = 0, bet_submitted = FALSE, current_multiplier = 1, last_action_at = NULL
                WHERE game_id = %s AND active = TRUE;
            """, (game_id,))
            cursor.execute("""
                UPDATE entertainment_ba_cay_participants
                SET current_bet = 0, bet_submitted = TRUE, current_multiplier = 1, last_action_at = CURRENT_TIMESTAMP
                WHERE id = %s;
            """, (banker_id,))
            cursor.execute("""
                UPDATE entertainment_ba_cay_games
                SET status = 'betting', round_no = round_no + 1, banker_participant_id = %s,
                    bet_deadline_at = CURRENT_TIMESTAMP + INTERVAL '20 seconds'
                WHERE id = %s
                RETURNING round_no;
            """, (banker_id, game_id))
            round_no = cursor.fetchone()[0]
            cursor.execute("""
                INSERT INTO entertainment_ba_cay_actions (game_id, participant_id, round_no, action_type, note)
                VALUES (%s, %s, %s, 'start_round', 'Bắt đầu ván, chờ đặt cược 20 giây');
            """, (game_id, banker_id, round_no))
            return round_no

    @staticmethod
    def apply_timeout_if_needed(game_id):
        with db_cursor(commit=True) as cursor:
            cursor.execute("""
                SELECT status, round_no, banker_participant_id
                FROM entertainment_ba_cay_games
                WHERE id = %s AND status = 'betting' AND bet_deadline_at < CURRENT_TIMESTAMP;
            """, (game_id,))
            game = cursor.fetchone()
            if not game:
                return False
            _, round_no, banker_id = game
            cursor.execute("""
                SELECT id, display_name
                FROM entertainment_ba_cay_participants
                WHERE game_id = %s AND active = TRUE AND id <> %s AND bet_submitted = FALSE;
            """, (game_id, banker_id))
            kicked = cursor.fetchall()
            for participant_id, display_name in kicked:
                cursor.execute("""
                    UPDATE entertainment_ba_cay_participants
                    SET active = FALSE, current_bet = 0, bet_submitted = FALSE, current_multiplier = 1, seat_no = NULL, last_action_at = CURRENT_TIMESTAMP
                    WHERE id = %s;
                """, (participant_id,))
                cursor.execute("""
                    INSERT INTO entertainment_ba_cay_actions (game_id, participant_id, round_no, action_type, note)
                    VALUES (%s, %s, %s, 'timeout_leave', %s);
                """, (game_id, participant_id, round_no, f"{display_name} quá 20 giây chưa đặt cược, bị rời bàn"))
            cursor.execute("""
                SELECT COUNT(1)
                FROM entertainment_ba_cay_participants
                WHERE game_id = %s AND active = TRUE AND id <> %s AND bet_submitted = TRUE;
            """, (game_id, banker_id))
            bettor_count = cursor.fetchone()[0]
            if bettor_count <= 0:
                cursor.execute("""
                    UPDATE entertainment_ba_cay_participants
                    SET current_bet = 0, bet_submitted = FALSE, current_multiplier = 1
                    WHERE game_id = %s AND active = TRUE;
                """, (game_id,))
                cursor.execute("""
                    UPDATE entertainment_ba_cay_games
                    SET status = 'setup', bet_deadline_at = NULL
                    WHERE id = %s;
                """, (game_id,))
                cursor.execute("""
                    INSERT INTO entertainment_ba_cay_actions (game_id, participant_id, round_no, action_type, note)
                    VALUES (%s, %s, %s, 'round_reset', 'Không còn người cược, ván tự kết thúc');
                """, (game_id, banker_id, round_no))
            else:
                cursor.execute("""
                    UPDATE entertainment_ba_cay_games
                    SET status = 'settling', bet_deadline_at = NULL
                    WHERE id = %s;
                """, (game_id,))
            return True

    @staticmethod
    def place_bet(game_id, participant_id, amount, multiplier=1):
        amount = int(amount or 0)
        try:
            multiplier = int(multiplier or 1)
        except (TypeError, ValueError):
            multiplier = 1
        if multiplier not in (1, 2, 3, 4):
            raise ValueError("Hệ số cược không hợp lệ.")
        with db_cursor(commit=True) as cursor:
            cursor.execute("""
                SELECT status, min_bet, max_bet, banker_participant_id, round_no
                FROM entertainment_ba_cay_games
                WHERE id = %s;
            """, (game_id,))
            game = cursor.fetchone()
            if not game:
                raise ValueError("Không tìm thấy bàn.")
            status, min_bet, max_bet, banker_id, round_no = game
            if status != 'betting':
                raise ValueError("Chưa đến thời gian đặt cược.")
            if participant_id == banker_id:
                raise ValueError("Chương không cần đặt cược.")
            if amount < int(min_bet):
                raise ValueError(f"Điểm cược phải từ {min_bet} trở lên.")
            if max_bet is not None and amount > int(max_bet):
                raise ValueError("Điểm cược vượt max.")
            cursor.execute("""
                UPDATE entertainment_ba_cay_participants
                SET current_bet = %s, bet_submitted = TRUE, current_multiplier = %s, last_action_at = CURRENT_TIMESTAMP
                WHERE id = %s AND game_id = %s AND active = TRUE;
            """, (amount, multiplier, participant_id, game_id))
            if cursor.rowcount <= 0:
                raise ValueError("Bạn chưa có trong bàn này.")
            cursor.execute("""
                INSERT INTO entertainment_ba_cay_actions (game_id, participant_id, round_no, action_type, amount, note)
                VALUES (%s, %s, %s, 'bet', %s, %s);
            """, (game_id, participant_id, round_no, amount, f"Chọn x{multiplier}"))

    @staticmethod
    def settle_round(game_id, banker_id, results, banker_multipliers=None):
        banker_multipliers = banker_multipliers or {}
        with db_cursor(commit=True) as cursor:
            cursor.execute("""
                SELECT status, banker_participant_id, round_no
                FROM entertainment_ba_cay_games
                WHERE id = %s;
            """, (game_id,))
            game = cursor.fetchone()
            if not game:
                raise ValueError("Không tìm thấy bàn.")
            status, real_banker_id, round_no = game
            if status not in ('betting', 'settling'):
                raise ValueError("Chưa có ván cần chốt.")
            if real_banker_id != banker_id:
                raise ValueError("Chỉ chương được chốt thắng thua.")
            EntertainmentBaCayGameModel.apply_timeout_if_needed(game_id)
            cursor.execute("""
                SELECT status
                FROM entertainment_ba_cay_games
                WHERE id = %s;
            """, (game_id,))
            status = cursor.fetchone()[0]
            if status == 'betting':
                cursor.execute("""
                    SELECT COUNT(1)
                    FROM entertainment_ba_cay_participants
                    WHERE game_id = %s AND active = TRUE AND id <> %s AND bet_submitted = FALSE;
                """, (game_id, banker_id))
                if cursor.fetchone()[0] > 0:
                    raise ValueError("Chưa hết thời gian cược hoặc còn người chưa đặt cược.")
            cursor.execute("""
                SELECT id, display_name, current_bet, current_multiplier
                FROM entertainment_ba_cay_participants
                WHERE game_id = %s AND active = TRUE AND id <> %s AND bet_submitted = TRUE AND current_bet > 0;
            """, (game_id, banker_id))
            players = cursor.fetchall()
            if not players:
                cursor.execute("""
                    UPDATE entertainment_ba_cay_games
                    SET status = 'setup', bet_deadline_at = NULL
                    WHERE id = %s;
                """, (game_id,))
                return 0
            valid_ids = {row[0] for row in players}
            settled_count = 0
            for player_id, display_name, bet, player_multiplier in players:
                result = results.get(player_id)
                if result not in ('win', 'lose'):
                    raise ValueError(f"Cần chọn thắng/thua cho {display_name}.")
                try:
                    banker_multiplier = int(banker_multipliers.get(player_id, 1) or 1)
                except (TypeError, ValueError):
                    banker_multiplier = 1
                if banker_multiplier not in (1, 2, 3, 4):
                    raise ValueError(f"Hệ số chương chọn cho {display_name} không hợp lệ.")
                multiplier = max(int(player_multiplier or 1), banker_multiplier)
                delta = int(bet) * multiplier
                if result == 'win':
                    cursor.execute("UPDATE entertainment_ba_cay_participants SET score = score + %s WHERE id = %s;", (delta, player_id))
                    cursor.execute("UPDATE entertainment_ba_cay_participants SET score = score - %s WHERE id = %s;", (delta, banker_id))
                    note = f"{display_name} thắng chương x{multiplier}"
                    action_type = 'player_win'
                else:
                    cursor.execute("UPDATE entertainment_ba_cay_participants SET score = score - %s WHERE id = %s;", (delta, player_id))
                    cursor.execute("UPDATE entertainment_ba_cay_participants SET score = score + %s WHERE id = %s;", (delta, banker_id))
                    note = f"{display_name} thua chương x{multiplier}"
                    action_type = 'player_lose'
                cursor.execute("""
                    INSERT INTO entertainment_ba_cay_actions (
                        game_id, participant_id, target_participant_id, round_no, action_type, amount, note
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s);
                """, (game_id, banker_id, player_id, round_no, action_type, delta, note))
                settled_count += 1
            unknown_ids = set(results.keys()) - valid_ids
            if unknown_ids:
                raise ValueError("Có người chơi không hợp lệ trong kết quả.")
            cursor.execute("""
                UPDATE entertainment_ba_cay_participants
                SET current_bet = 0, bet_submitted = FALSE, current_multiplier = 1
                WHERE game_id = %s AND active = TRUE;
            """, (game_id,))
            cursor.execute("""
                UPDATE entertainment_ba_cay_participants
                SET bet_submitted = TRUE, current_multiplier = 1
                WHERE id = %s;
            """, (banker_id,))
            cursor.execute("""
                UPDATE entertainment_ba_cay_games
                SET status = 'setup', bet_deadline_at = NULL
                WHERE id = %s;
            """, (game_id,))
            return settled_count


VanDongVienModel = UserClientModel
