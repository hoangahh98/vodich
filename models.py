from db import db_cursor
from config import SUPER_ADMIN_EMAIL, normalize_admin_user

class UserClientModel:
    """Váº­n Ä‘á»™ng viÃªn (Players)"""

    @staticmethod
    def get_all():
        """Get all VÄV"""
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
        """Get VÄV by ID"""
        with db_cursor() as cursor:
            cursor.execute("SELECT * FROM user_clients WHERE id = %s;", (vdv_id,))
            return cursor.fetchone()

    @staticmethod
    def get_by_email(email):
        """Get VÄV by email"""
        with db_cursor() as cursor:
            cursor.execute("SELECT id, display_name, email, skill_level FROM user_clients WHERE lower(email) = lower(%s);", (email,))
            return cursor.fetchone()

    @staticmethod
    def email_exists(email, exclude_id=None):
        """Check whether an email is already used by another VÄV."""
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
        """Create new VÄV"""
        with db_cursor(commit=True) as cursor:
            cursor.execute("""
                INSERT INTO user_clients (display_name, skill_level, email, notes)
                VALUES (%s, %s, %s, %s)
                RETURNING id;
            """, (display_name, skill_level, email, notes))
            return cursor.fetchone()[0]

    @staticmethod
    def update(vdv_id, display_name, skill_level, email, notes=''):
        """Update VÄV"""
        with db_cursor(commit=True) as cursor:
            cursor.execute("""
                UPDATE user_clients
                SET display_name=%s, skill_level=%s, email=%s, notes=%s
                WHERE id=%s;
            """, (display_name, skill_level, email, notes, vdv_id))

    @staticmethod
    def delete(vdv_id):
        """Delete VÄV"""
        with db_cursor(commit=True) as cursor:
            cursor.execute("DELETE FROM user_clients WHERE id = %s;", (vdv_id,))

class AdminUserModel:
    @staticmethod
    def get_all():
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT id, email
                FROM users
                WHERE role = 'admin'
                ORDER BY email ASC;
            """)
            return cursor.fetchall()

    @staticmethod
    def get_by_id(admin_id):
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT id, email
                FROM users
                WHERE id = %s AND role = 'admin';
            """, (admin_id,))
            return cursor.fetchone()

    @staticmethod
    def get_available_for_tournament(giai_id, owner_admin_id=None, current_admin_id=None):
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT u.id, u.email
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
                ORDER BY u.email ASC;
            """, (SUPER_ADMIN_EMAIL, owner_admin_id, owner_admin_id, current_admin_id, current_admin_id, giai_id))
            return cursor.fetchall()

    @staticmethod
    def get_available_for_team(doi_bong_id, owner_admin_id=None, current_admin_id=None):
        with db_cursor() as cursor:
            cursor.execute("""
                SELECT u.id, u.email
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
                ORDER BY u.email ASC;
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
    def update(admin_id, email, password_hash=None):
        email = normalize_admin_user(email)
        with db_cursor(commit=True) as cursor:
            if password_hash:
                cursor.execute("""
                    UPDATE users
                    SET email = %s, password = %s
                    WHERE id = %s AND role = 'admin';
                """, (email.strip().lower(), password_hash, admin_id))
            else:
                cursor.execute("""
                    UPDATE users
                    SET email = %s
                    WHERE id = %s AND role = 'admin';
                """, (email.strip().lower(), admin_id))

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
    """Giáº£i Ä‘áº¥u"""

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
    """ÄÄƒng kÃ½ giáº£i (Registration)"""

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
        """Get all tournaments VÄV registered in"""
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
        """Register VÄV for tournament"""
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
        """Remove VÄV from tournament"""
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
                       COALESCE(dp.so_tien_da_dong, 0), COALESCE(dp.trang_thai_dong_tien, 'ChÆ°a Ä‘Ã³ng'),
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
                raise ValueError("KhÃ´ng tÃ¬m tháº¥y váº­n Ä‘á»™ng viÃªn.")
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
    """Tráº­n Ä‘áº¥u"""

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
                """, (giai_id, m['doi_a'], m['doi_b'], 'ChÆ°a diá»…n ra',
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
                """, (doi_a, doi_b, 'ChÆ°a diá»…n ra', tran_id))

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

            trang_thai = 'ChÆ°a diá»…n ra'
            if diem_a is not None and diem_b is not None:
                diem_cao = max(diem_a, diem_b)
                chen_lech = abs(diem_a - diem_b)
                if diem_cao >= diem_toi_da or (diem_cao >= diem_cham and chen_lech >= 2):
                    trang_thai = 'ÄÃ£ xong'

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
            if len(m) > 5 and m[5] != 'ÄÃ£ xong':
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


VanDongVienModel = UserClientModel
