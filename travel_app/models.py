from decimal import Decimal, InvalidOperation

from .auth import AuthService
from .config import SUPER_ADMIN_EMAIL, normalize_admin_user
from .db import db_cursor


def money(value):
    try:
        return Decimal(str(value or "0")).quantize(Decimal("1"))
    except (InvalidOperation, ValueError):
        return Decimal("0")


def is_super_admin(user):
    return normalize_admin_user(user.get("email")) == SUPER_ADMIN_EMAIL


def admin_scope_id(user):
    return None if is_super_admin(user) else user.get("id")


class UserModel:
    @staticmethod
    def get_admins():
        with db_cursor() as cursor:
            cursor.execute(
                "SELECT id, email, email AS display_name FROM users WHERE role = 'admin' ORDER BY email ASC;"
            )
            return cursor.fetchall()

    @staticmethod
    def get_available_admins_for_trip(trip_id, owner_admin_id=None, current_admin_id=None):
        with db_cursor() as cursor:
            cursor.execute(
                """
                SELECT u.id, u.email, u.display_name
                FROM users u
                WHERE u.role = 'admin'
                  AND lower(u.email) <> lower(%s)
                  AND (%s IS NULL OR u.id <> %s)
                  AND (%s IS NULL OR u.id <> %s)
                  AND NOT EXISTS (
                      SELECT 1
                      FROM trip_admin_permissions p
                      WHERE p.trip_id = %s AND p.admin_id = u.id
                  )
                ORDER BY u.email ASC;
                """,
                (SUPER_ADMIN_EMAIL, owner_admin_id, owner_admin_id, current_admin_id, current_admin_id, trip_id),
            )
            return cursor.fetchall()

    @staticmethod
    def get_admin(admin_id):
        with db_cursor() as cursor:
            cursor.execute(
                "SELECT id, email, email AS display_name FROM users WHERE id = %s AND role = 'admin';",
                (admin_id,),
            )
            return cursor.fetchone()

    @staticmethod
    def get_admin_by_id(admin_id):
        return UserModel.get_admin(admin_id)

    @staticmethod
    def create_admin(email, password, display_name):
        email = normalize_admin_user(email)
        with db_cursor(commit=True) as cursor:
            cursor.execute(
                """
                INSERT INTO users (email, password, role)
                VALUES (%s, %s, 'admin');
                """,
                (email, AuthService.hash_password(password)),
            )

    @staticmethod
    def update_admin(admin_id, email, display_name, password=None):
        email = normalize_admin_user(email)
        with db_cursor(commit=True) as cursor:
            if password:
                cursor.execute(
                    """
                    UPDATE users
                    SET email = %s, password = %s
                    WHERE id = %s AND role = 'admin';
                    """,
                    (email, AuthService.hash_password(password), admin_id),
                )
            else:
                cursor.execute(
                    """
                    UPDATE users
                    SET email = %s
                    WHERE id = %s AND role = 'admin';
                    """,
                    (email, admin_id),
                )

    @staticmethod
    def delete_admin(admin_id, fallback_admin_id):
        with db_cursor(commit=True) as cursor:
            cursor.execute("UPDATE trips SET owner_admin_id = %s WHERE owner_admin_id = %s;", (fallback_admin_id, admin_id))
            cursor.execute("DELETE FROM trip_admin_permissions WHERE admin_id = %s;", (admin_id,))
            cursor.execute("DELETE FROM users WHERE id = %s AND role = 'admin';", (admin_id,))

    @staticmethod
    def create_viewer_for_member(member_id, email, password):
        email = (email or "").strip().lower()
        if not email:
            return None
        with db_cursor(commit=True) as cursor:
            cursor.execute("SELECT name FROM trip_members WHERE id = %s;", (member_id,))
            member = cursor.fetchone()
            if not member:
                raise ValueError("Không tìm thấy thành viên")
            cursor.execute("SELECT id FROM user_clients WHERE lower(email) = lower(%s) LIMIT 1;", (email,))
            existing_vdv = cursor.fetchone()
            if existing_vdv:
                client_id = existing_vdv[0]
                cursor.execute("UPDATE user_clients SET display_name = %s WHERE id = %s;", (member[0], client_id))
            else:
                cursor.execute(
                    """
                    INSERT INTO user_clients (display_name, skill_level, email, notes)
                    VALUES (%s, 'C', %s, '')
                    RETURNING id;
                    """,
                    (member[0], email),
                )
                client_id = cursor.fetchone()[0]
            cursor.execute(
                "UPDATE trip_members SET client_id = %s, email = %s WHERE id = %s;",
                (client_id, email, member_id),
            )
            cursor.execute(
                """
                UPDATE travel_people p
                SET client_id = %s, email = %s, updated_at = CURRENT_TIMESTAMP
                FROM trip_members tm
                WHERE tm.person_id = p.id AND tm.id = %s;
                """,
                (client_id, email, member_id),
            )
            return client_id


class PeopleModel:
    @staticmethod
    def all_for_admin(admin_id=None):
        with db_cursor() as cursor:
            cursor.execute(
                """
                SELECT id, name, email, client_id, owner_admin_id
                FROM travel_people
                WHERE active = TRUE
                ORDER BY name ASC, id ASC;
                """
            )
            return cursor.fetchall()

    @staticmethod
    def available_for_trip(trip_id, admin_id=None):
        with db_cursor() as cursor:
            cursor.execute(
                """
                SELECT p.id, p.name, p.email
                FROM travel_people p
                WHERE p.active = TRUE
                  AND NOT EXISTS (
                      SELECT 1
                      FROM trip_members tm
                      WHERE tm.trip_id = %s AND tm.person_id = p.id AND tm.active = TRUE
                  )
                ORDER BY p.name ASC, p.id ASC;
                """,
                (trip_id,),
            )
            return cursor.fetchall()

    @staticmethod
    def get_for_admin(person_id, admin_id=None):
        with db_cursor() as cursor:
            cursor.execute(
                """
                SELECT id, name, email, client_id, owner_admin_id
                FROM travel_people
                WHERE id = %s AND active = TRUE;
                """,
                (person_id,),
            )
            return cursor.fetchone()

    @staticmethod
    def create(name, email, owner_admin_id):
        email = (email or "").strip().lower()
        with db_cursor(commit=True) as cursor:
            cursor.execute("SELECT id FROM user_clients WHERE lower(email) = lower(%s) LIMIT 1;", (email,))
            existing_vdv = cursor.fetchone() if email else None
            if existing_vdv:
                client_id = existing_vdv[0]
                cursor.execute("UPDATE user_clients SET display_name = %s WHERE id = %s;", (name, client_id))
            elif email:
                cursor.execute(
                    """
                    INSERT INTO user_clients (display_name, skill_level, email, notes)
                    VALUES (%s, 'C', %s, '')
                    RETURNING id;
                    """,
                    (name, email),
                )
                client_id = cursor.fetchone()[0]
            else:
                client_id = None
            cursor.execute(
                """
                INSERT INTO travel_people (name, email, owner_admin_id, client_id)
                VALUES (%s, %s, %s, %s)
                RETURNING id;
                """,
                (name, email, owner_admin_id, client_id),
            )
            return cursor.fetchone()[0]

    @staticmethod
    def update(person_id, name, email):
        email = (email or "").strip().lower()
        with db_cursor(commit=True) as cursor:
            cursor.execute("SELECT id FROM user_clients WHERE lower(email) = lower(%s) LIMIT 1;", (email,))
            existing_vdv = cursor.fetchone() if email else None
            if existing_vdv:
                client_id = existing_vdv[0]
                cursor.execute("UPDATE user_clients SET display_name = %s WHERE id = %s;", (name, client_id))
            elif email:
                cursor.execute(
                    """
                    INSERT INTO user_clients (display_name, skill_level, email, notes)
                    VALUES (%s, 'C', %s, '')
                    RETURNING id;
                    """,
                    (name, email),
                )
                client_id = cursor.fetchone()[0]
            else:
                client_id = None
            cursor.execute(
                """
                UPDATE travel_people
                SET name = %s,
                    email = %s,
                    client_id = %s,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = %s;
                """,
                (name, email, client_id, person_id),
            )
            cursor.execute(
                """
                UPDATE trip_members
                SET name = %s,
                    email = %s,
                    client_id = %s
                WHERE person_id = %s AND active = TRUE;
                """,
                (name, email, client_id, person_id),
            )

    @staticmethod
    def delete(person_id):
        with db_cursor(commit=True) as cursor:
            cursor.execute("UPDATE travel_people SET active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = %s;", (person_id,))


class TripModel:
    @staticmethod
    def all_for_admin(admin_id=None):
        with db_cursor() as cursor:
            if admin_id:
                cursor.execute(
                    """
                    SELECT t.id, t.name, t.description, COUNT(tm.id), t.owner_admin_id
                    FROM trips t
                    LEFT JOIN trip_members tm ON t.id = tm.trip_id AND tm.active = TRUE
                    LEFT JOIN trip_admin_permissions p ON t.id = p.trip_id AND p.admin_id = %s
                    WHERE t.owner_admin_id = %s OR p.admin_id IS NOT NULL
                    GROUP BY t.id
                    ORDER BY t.id DESC;
                    """,
                    (admin_id, admin_id),
                )
            else:
                cursor.execute(
                    """
                    SELECT t.id, t.name, t.description, COUNT(tm.id), t.owner_admin_id
                    FROM trips t
                    LEFT JOIN trip_members tm ON t.id = tm.trip_id AND tm.active = TRUE
                    GROUP BY t.id
                    ORDER BY t.id DESC;
                    """
                )
            return cursor.fetchall()

    @staticmethod
    def all_for_viewer(client_id, email=None):
        with db_cursor() as cursor:
            cursor.execute(
                """
                SELECT t.id, t.name, t.description, tm.name
                FROM trips t
                INNER JOIN trip_members tm ON t.id = tm.trip_id
                WHERE tm.active = TRUE
                  AND (tm.client_id = %s OR (%s IS NOT NULL AND lower(tm.email) = lower(%s)))
                ORDER BY t.id DESC;
                """,
                (client_id, email, email),
            )
            return cursor.fetchall()

    @staticmethod
    def get_for_admin(trip_id, admin_id=None):
        with db_cursor() as cursor:
            if admin_id:
                cursor.execute(
                    """
                    SELECT t.id, t.name, t.description, t.owner_admin_id
                    FROM trips t
                    LEFT JOIN trip_admin_permissions p ON t.id = p.trip_id AND p.admin_id = %s
                    WHERE t.id = %s AND (t.owner_admin_id = %s OR p.admin_id IS NOT NULL);
                    """,
                    (admin_id, trip_id, admin_id),
                )
            else:
                cursor.execute("SELECT id, name, description, owner_admin_id FROM trips WHERE id = %s;", (trip_id,))
            return cursor.fetchone()

    @staticmethod
    def get_for_viewer(trip_id, client_id, email=None):
        with db_cursor() as cursor:
            cursor.execute(
                """
                SELECT t.id, t.name, t.description, tm.id, tm.name
                FROM trips t
                INNER JOIN trip_members tm ON t.id = tm.trip_id
                WHERE t.id = %s
                  AND tm.active = TRUE
                  AND (tm.client_id = %s OR (%s IS NOT NULL AND lower(tm.email) = lower(%s)));
                """,
                (trip_id, client_id, email, email),
            )
            return cursor.fetchone()

    @staticmethod
    def create(name, description, owner_admin_id):
        with db_cursor(commit=True) as cursor:
            cursor.execute(
                "INSERT INTO trips (name, description, owner_admin_id) VALUES (%s, %s, %s) RETURNING id;",
                (name, description, owner_admin_id),
            )
            return cursor.fetchone()[0]

    @staticmethod
    def delete(trip_id):
        with db_cursor(commit=True) as cursor:
            cursor.execute("DELETE FROM trips WHERE id = %s;", (trip_id,))

    @staticmethod
    def permissions(trip_id):
        with db_cursor() as cursor:
            cursor.execute(
                """
                SELECT p.id, p.admin_id, u.email
                FROM trip_admin_permissions p
                INNER JOIN users u ON p.admin_id = u.id
                WHERE p.trip_id = %s
                  AND lower(u.email) <> lower(%s)
                ORDER BY u.email ASC;
                """,
                (trip_id, SUPER_ADMIN_EMAIL),
            )
            return cursor.fetchall()

    @staticmethod
    def add_permission(trip_id, admin_id):
        if not admin_id:
            return
        with db_cursor(commit=True) as cursor:
            cursor.execute(
                """
                INSERT INTO trip_admin_permissions (trip_id, admin_id)
                SELECT %s, u.id
                FROM users u
                WHERE u.id = %s
                  AND u.role = 'admin'
                  AND lower(u.email) <> lower(%s)
                ON CONFLICT DO NOTHING;
                """,
                (trip_id, admin_id, SUPER_ADMIN_EMAIL),
            )

    @staticmethod
    def remove_permission(trip_id, permission_id):
        with db_cursor(commit=True) as cursor:
            cursor.execute("DELETE FROM trip_admin_permissions WHERE trip_id = %s AND id = %s;", (trip_id, permission_id))


class FinanceModel:
    @staticmethod
    def members(trip_id):
        with db_cursor() as cursor:
            cursor.execute(
                """
                SELECT tm.id, tm.name, tm.email, tm.client_id, COALESCE(tc.amount, 0), COALESCE(tc.note, '')
                FROM trip_members tm
                LEFT JOIN trip_collections tc ON tm.id = tc.member_id AND tc.trip_id = tm.trip_id
                WHERE tm.trip_id = %s AND tm.active = TRUE
                ORDER BY tm.id ASC;
                """,
                (trip_id,),
            )
            return cursor.fetchall()

    @staticmethod
    def all_members_for_admin(admin_id=None):
        with db_cursor() as cursor:
            if admin_id:
                cursor.execute(
                    """
                    SELECT tm.id, tm.name, tm.email, tm.client_id, t.id, t.name,
                           COALESCE(tc.amount, 0), tm.active
                    FROM trip_members tm
                    INNER JOIN trips t ON tm.trip_id = t.id
                    LEFT JOIN trip_collections tc ON tm.id = tc.member_id AND tm.trip_id = tc.trip_id
                    LEFT JOIN trip_admin_permissions p ON t.id = p.trip_id AND p.admin_id = %s
                    WHERE tm.active = TRUE
                      AND (t.owner_admin_id = %s OR p.admin_id IS NOT NULL)
                    ORDER BY t.id DESC, tm.name ASC;
                    """,
                    (admin_id, admin_id),
                )
            else:
                cursor.execute(
                    """
                    SELECT tm.id, tm.name, tm.email, tm.client_id, t.id, t.name,
                           COALESCE(tc.amount, 0), tm.active
                    FROM trip_members tm
                    INNER JOIN trips t ON tm.trip_id = t.id
                    LEFT JOIN trip_collections tc ON tm.id = tc.member_id AND tm.trip_id = tc.trip_id
                    WHERE tm.active = TRUE
                    ORDER BY t.id DESC, tm.name ASC;
                    """
                )
            return cursor.fetchall()

    @staticmethod
    def get_member_for_admin(member_id, admin_id=None):
        with db_cursor() as cursor:
            if admin_id:
                cursor.execute(
                    """
                    SELECT tm.id, tm.trip_id, tm.name, tm.email, tm.client_id, t.name
                    FROM trip_members tm
                    INNER JOIN trips t ON tm.trip_id = t.id
                    LEFT JOIN trip_admin_permissions p ON t.id = p.trip_id AND p.admin_id = %s
                    WHERE tm.id = %s AND tm.active = TRUE
                      AND (t.owner_admin_id = %s OR p.admin_id IS NOT NULL);
                    """,
                    (admin_id, member_id, admin_id),
                )
            else:
                cursor.execute(
                    """
                    SELECT tm.id, tm.trip_id, tm.name, tm.email, tm.client_id, t.name
                    FROM trip_members tm
                    INNER JOIN trips t ON tm.trip_id = t.id
                    WHERE tm.id = %s AND tm.active = TRUE;
                    """,
                    (member_id,),
                )
            return cursor.fetchone()

    @staticmethod
    def add_member(trip_id, name, email=""):
        with db_cursor(commit=True) as cursor:
            cursor.execute(
                "INSERT INTO trip_members (trip_id, name, email) VALUES (%s, %s, %s) RETURNING id;",
                (trip_id, name, (email or "").strip().lower()),
            )
            member_id = cursor.fetchone()[0]
            cursor.execute(
                "INSERT INTO trip_collections (trip_id, member_id, amount) VALUES (%s, %s, 0) ON CONFLICT DO NOTHING;",
                (trip_id, member_id),
            )
            return member_id

    @staticmethod
    def add_member_from_person(trip_id, person_id):
        with db_cursor(commit=True) as cursor:
            cursor.execute(
                """
                SELECT id, name, email, client_id
                FROM travel_people
                WHERE id = %s AND active = TRUE;
                """,
                (person_id,),
            )
            person = cursor.fetchone()
            if not person:
                raise ValueError("Không tìm thấy thành viên")
            cursor.execute(
                """
                INSERT INTO trip_members (trip_id, person_id, client_id, name, email)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id;
                """,
                (trip_id, person[0], person[3], person[1], person[2] or ""),
            )
            member_id = cursor.fetchone()[0]
            cursor.execute(
                "INSERT INTO trip_collections (trip_id, member_id, amount) VALUES (%s, %s, 0) ON CONFLICT DO NOTHING;",
                (trip_id, member_id),
            )
            return member_id

    @staticmethod
    def delete_member(trip_id, member_id):
        with db_cursor(commit=True) as cursor:
            cursor.execute("UPDATE trip_members SET active = FALSE WHERE trip_id = %s AND id = %s;", (trip_id, member_id))

    @staticmethod
    def update_member(member_id, name, email):
        with db_cursor(commit=True) as cursor:
            cursor.execute(
                """
                UPDATE trip_members
                SET name = %s, email = %s
                WHERE id = %s;
                """,
                (name, (email or "").strip().lower(), member_id),
            )
            cursor.execute(
                """
                UPDATE user_clients v
                SET display_name = %s
                FROM trip_members tm
                WHERE tm.client_id = v.id AND tm.id = %s;
                """,
                (name, member_id),
            )

    @staticmethod
    def rebalance_expenses_equal(trip_id):
        members = FinanceModel.members(trip_id)
        member_ids = [member[0] for member in members]
        if not member_ids:
            return
        with db_cursor(commit=True) as cursor:
            cursor.execute(
                """
                SELECT id, amount
                FROM trip_expenses
                WHERE trip_id = %s
                ORDER BY id ASC;
                """,
                (trip_id,),
            )
            expenses = cursor.fetchall()
            for expense_id, amount in expenses:
                amount = money(amount)
                base = amount // len(member_ids)
                remainder = int(amount - (base * len(member_ids)))
                splits = []
                for index, member_id in enumerate(member_ids):
                    splits.append((expense_id, member_id, base + (1 if index < remainder else 0)))
                cursor.execute("DELETE FROM trip_expense_splits WHERE expense_id = %s;", (expense_id,))
                cursor.executemany(
                    "INSERT INTO trip_expense_splits (expense_id, member_id, amount) VALUES (%s, %s, %s);",
                    splits,
                )

    @staticmethod
    def update_collections(trip_id, updates):
        with db_cursor(commit=True) as cursor:
            cursor.executemany(
                """
                INSERT INTO trip_collections (trip_id, member_id, amount, note)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (trip_id, member_id) DO UPDATE SET
                    amount = EXCLUDED.amount,
                    note = EXCLUDED.note,
                    updated_at = CURRENT_TIMESTAMP;
                """,
                [(trip_id, item["member_id"], item["amount"], item["note"]) for item in updates],
            )

    @staticmethod
    def expenses(trip_id):
        with db_cursor() as cursor:
            cursor.execute(
                """
                SELECT e.id, e.spent_date, e.title, e.amount, e.note
                FROM trip_expenses e
                WHERE e.trip_id = %s
                ORDER BY e.spent_date ASC, e.id ASC;
                """,
                (trip_id,),
            )
            expenses = cursor.fetchall()
            cursor.execute(
                """
                SELECT s.expense_id, s.member_id, s.amount
                FROM trip_expense_splits s
                INNER JOIN trip_expenses e ON s.expense_id = e.id
                WHERE e.trip_id = %s
                ORDER BY s.expense_id ASC, s.member_id ASC;
                """,
                (trip_id,),
            )
            split_rows = cursor.fetchall()
        splits = {}
        for expense_id, member_id, amount in split_rows:
            splits.setdefault(expense_id, {})[member_id] = amount
        return [{"row": expense, "splits": splits.get(expense[0], {})} for expense in expenses]

    @staticmethod
    def add_expense(trip_id, spent_date, title, amount, note, member_ids):
        amount = money(amount)
        if amount < 0:
            raise ValueError("Số tiền chi không hợp lệ")
        if not member_ids:
            raise ValueError("Cần có thành viên để chia tiền")
        base = amount // len(member_ids)
        remainder = int(amount - (base * len(member_ids)))
        splits = []
        for index, member_id in enumerate(member_ids):
            splits.append((member_id, base + (1 if index < remainder else 0)))
        with db_cursor(commit=True) as cursor:
            cursor.execute(
                """
                INSERT INTO trip_expenses (trip_id, spent_date, title, amount, note)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id;
                """,
                (trip_id, spent_date, title, amount, note),
            )
            expense_id = cursor.fetchone()[0]
            cursor.executemany(
                "INSERT INTO trip_expense_splits (expense_id, member_id, amount) VALUES (%s, %s, %s);",
                [(expense_id, member_id, split_amount) for member_id, split_amount in splits],
            )
            return expense_id

    @staticmethod
    def update_expense_splits(expense_id, title, spent_date, amount, note, split_updates):
        amount = money(amount)
        total_split = sum(money(item["amount"]) for item in split_updates)
        if total_split != amount:
            raise ValueError(f"Tổng tiền chia ({total_split:,.0f}) phải bằng tiền khoản chi ({amount:,.0f})")
        with db_cursor(commit=True) as cursor:
            cursor.execute(
                """
                UPDATE trip_expenses
                SET title = %s, spent_date = %s, amount = %s, note = %s, updated_at = CURRENT_TIMESTAMP
                WHERE id = %s;
                """,
                (title, spent_date, amount, note, expense_id),
            )
            cursor.executemany(
                """
                INSERT INTO trip_expense_splits (expense_id, member_id, amount)
                VALUES (%s, %s, %s)
                ON CONFLICT (expense_id, member_id) DO UPDATE SET amount = EXCLUDED.amount;
                """,
                [(expense_id, item["member_id"], money(item["amount"])) for item in split_updates],
            )

    @staticmethod
    def delete_expense(trip_id, expense_id):
        with db_cursor(commit=True) as cursor:
            cursor.execute("DELETE FROM trip_expenses WHERE trip_id = %s AND id = %s;", (trip_id, expense_id))


def build_summary(members, expenses):
    member_spent = {member[0]: Decimal("0") for member in members}
    total_collected = Decimal("0")
    for member in members:
        total_collected += money(member[4])
    total_spent = Decimal("0")
    for expense in expenses:
        total_spent += money(expense["row"][3])
        for member_id, amount in expense["splits"].items():
            member_spent[member_id] = member_spent.get(member_id, Decimal("0")) + money(amount)
    balances = {}
    for member in members:
        balances[member[0]] = money(member[4]) - member_spent.get(member[0], Decimal("0"))
    return {
        "total_collected": total_collected,
        "total_spent": total_spent,
        "balance": total_collected - total_spent,
        "average_spent": total_spent / len(members) if members else Decimal("0"),
        "member_spent": member_spent,
        "balances": balances,
    }
