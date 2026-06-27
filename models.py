from decimal import Decimal, InvalidOperation

from auth import AuthService
from config import SUPER_ADMIN_EMAIL
from db import db_cursor


def money(value):
    try:
        return Decimal(str(value or "0")).quantize(Decimal("1"))
    except (InvalidOperation, ValueError):
        return Decimal("0")


def is_super_admin(user):
    return (user.get("email") or "").strip().lower() == SUPER_ADMIN_EMAIL


def admin_scope_id(user):
    return None if is_super_admin(user) else user.get("id")


class UserModel:
    @staticmethod
    def get_admins():
        with db_cursor() as cursor:
            cursor.execute(
                "SELECT id, email, display_name FROM travel_users WHERE role = 'admin' ORDER BY email ASC;"
            )
            return cursor.fetchall()

    @staticmethod
    def get_admin(admin_id):
        with db_cursor() as cursor:
            cursor.execute(
                "SELECT id, email, display_name FROM travel_users WHERE id = %s AND role = 'admin';",
                (admin_id,),
            )
            return cursor.fetchone()

    @staticmethod
    def create_admin(email, password, display_name):
        with db_cursor(commit=True) as cursor:
            cursor.execute(
                """
                INSERT INTO travel_users (email, password_hash, role, display_name)
                VALUES (%s, %s, 'admin', %s);
                """,
                ((email or "").strip().lower(), AuthService.hash_password(password), display_name or "Admin"),
            )

    @staticmethod
    def update_admin(admin_id, email, display_name, password=None):
        with db_cursor(commit=True) as cursor:
            if password:
                cursor.execute(
                    """
                    UPDATE travel_users
                    SET email = %s, display_name = %s, password_hash = %s
                    WHERE id = %s AND role = 'admin';
                    """,
                    ((email or "").strip().lower(), display_name or "Admin", AuthService.hash_password(password), admin_id),
                )
            else:
                cursor.execute(
                    """
                    UPDATE travel_users
                    SET email = %s, display_name = %s
                    WHERE id = %s AND role = 'admin';
                    """,
                    ((email or "").strip().lower(), display_name or "Admin", admin_id),
                )

    @staticmethod
    def delete_admin(admin_id, fallback_admin_id):
        with db_cursor(commit=True) as cursor:
            cursor.execute("UPDATE trips SET owner_admin_id = %s WHERE owner_admin_id = %s;", (fallback_admin_id, admin_id))
            cursor.execute("DELETE FROM trip_admin_permissions WHERE admin_id = %s;", (admin_id,))
            cursor.execute("DELETE FROM travel_users WHERE id = %s AND role = 'admin';", (admin_id,))

    @staticmethod
    def create_viewer_for_member(member_id, email, password):
        email = (email or "").strip().lower()
        if not email:
            return None
        with db_cursor(commit=True) as cursor:
            cursor.execute("SELECT name FROM trip_members WHERE id = %s;", (member_id,))
            member = cursor.fetchone()
            if not member:
                raise ValueError("Khong tim thay thanh vien")
            cursor.execute(
                """
                INSERT INTO travel_users (email, password_hash, role, display_name)
                VALUES (%s, %s, 'viewer', %s)
                ON CONFLICT (email) DO UPDATE SET
                    password_hash = EXCLUDED.password_hash,
                    role = 'viewer',
                    display_name = EXCLUDED.display_name,
                    active = TRUE
                RETURNING id;
                """,
                (email, AuthService.hash_password(password), member[0]),
            )
            user_id = cursor.fetchone()[0]
            cursor.execute(
                "UPDATE trip_members SET user_id = %s, email = %s WHERE id = %s;",
                (user_id, email, member_id),
            )
            return user_id


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
    def all_for_viewer(user_id):
        with db_cursor() as cursor:
            cursor.execute(
                """
                SELECT t.id, t.name, t.description, tm.name
                FROM trips t
                INNER JOIN trip_members tm ON t.id = tm.trip_id
                WHERE tm.user_id = %s AND tm.active = TRUE
                ORDER BY t.id DESC;
                """,
                (user_id,),
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
    def get_for_viewer(trip_id, user_id):
        with db_cursor() as cursor:
            cursor.execute(
                """
                SELECT t.id, t.name, t.description, tm.id, tm.name
                FROM trips t
                INNER JOIN trip_members tm ON t.id = tm.trip_id
                WHERE t.id = %s AND tm.user_id = %s AND tm.active = TRUE;
                """,
                (trip_id, user_id),
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
                INNER JOIN travel_users u ON p.admin_id = u.id
                WHERE p.trip_id = %s
                ORDER BY u.email ASC;
                """,
                (trip_id,),
            )
            return cursor.fetchall()

    @staticmethod
    def add_permission(trip_id, admin_id):
        with db_cursor(commit=True) as cursor:
            cursor.execute(
                """
                INSERT INTO trip_admin_permissions (trip_id, admin_id)
                VALUES (%s, %s) ON CONFLICT DO NOTHING;
                """,
                (trip_id, admin_id),
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
                SELECT tm.id, tm.name, tm.email, tm.user_id, COALESCE(tc.amount, 0), COALESCE(tc.note, '')
                FROM trip_members tm
                LEFT JOIN trip_collections tc ON tm.id = tc.member_id AND tc.trip_id = tm.trip_id
                WHERE tm.trip_id = %s AND tm.active = TRUE
                ORDER BY tm.id ASC;
                """,
                (trip_id,),
            )
            return cursor.fetchall()

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
    def delete_member(trip_id, member_id):
        with db_cursor(commit=True) as cursor:
            cursor.execute("UPDATE trip_members SET active = FALSE WHERE trip_id = %s AND id = %s;", (trip_id, member_id))

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
            raise ValueError("So tien chi khong hop le")
        if not member_ids:
            raise ValueError("Can co thanh vien de chia tien")
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
            raise ValueError(f"Tong tien chia ({total_split:,.0f}) phai bang tien khoan chi ({amount:,.0f})")
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
        "member_spent": member_spent,
        "balances": balances,
    }
