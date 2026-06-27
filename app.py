from datetime import date
from secrets import token_urlsafe

from flask import Flask, flash, redirect, render_template, request, send_from_directory, session, url_for

from auth import AuthService, admin_required, login_required
from config import APP_NAME, FLASK_SECRET_KEY, SUPER_ADMIN_EMAIL
from models import FinanceModel, TripModel, UserModel, admin_scope_id, build_summary, is_super_admin, money
from schema import init_schema

app = Flask(__name__)
app.secret_key = FLASK_SECRET_KEY

with app.app_context():
    init_schema()


@app.context_processor
def inject_template_globals():
    return {"super_admin_email": SUPER_ADMIN_EMAIL}


@app.template_filter("vnd")
def vnd(value):
    return f"{money(value):,.0f}".replace(",", ".")


@app.route("/")
@login_required
def index():
    user = session["user"]
    if user["role"] == "viewer":
        return redirect(url_for("viewer_dashboard"))
    return redirect(url_for("trips"))


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        user, error = AuthService.login(
            request.form.get("email", ""),
            request.form.get("password", ""),
            request.form.get("role", "viewer"),
        )
        if error:
            return render_template("login.html", error=error)
        session["user"] = user
        return redirect(url_for("index"))
    return render_template("login.html")


@app.route("/dang-xuat")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/chuyen-di")
@admin_required
def trips():
    user = session["user"]
    return render_template(
        "trips.html",
        trips=TripModel.all_for_admin(admin_scope_id(user)),
        user=user,
        super_admin_email=SUPER_ADMIN_EMAIL,
    )


@app.route("/admin-settings")
@admin_required
def admin_settings():
    if not is_super_admin(session["user"]):
        return "Chỉ admin gốc được quản lý admin", 403
    return render_template("admin_settings.html", admins=UserModel.get_admins(), super_admin_email=SUPER_ADMIN_EMAIL)


@app.route("/admin-settings/them", methods=["POST"])
@admin_required
def add_admin():
    if not is_super_admin(session["user"]):
        return "Chi admin goc duoc quan ly admin", 403
    email = (request.form.get("email") or "").strip().lower()
    password = request.form.get("password") or ""
    display_name = request.form.get("display_name") or "Admin"
    if not email or len(password) < 6:
        flash("Email và mật khẩu tối thiểu 6 ký tự là bắt buộc.", "danger")
        return redirect(url_for("admin_settings"))
    try:
        UserModel.create_admin(email, password, display_name)
        flash("Đã tạo admin.", "success")
    except Exception as exc:
        flash(f"Không tạo được admin: {exc}", "danger")
    return redirect(url_for("admin_settings"))


@app.route("/admin-settings/<int:admin_id>/sua", methods=["POST"])
@admin_required
def edit_admin(admin_id):
    if not is_super_admin(session["user"]):
        return "Chỉ admin gốc được quản lý admin", 403
    admin = UserModel.get_admin(admin_id)
    if not admin:
        return "Không tìm thấy admin", 404
    email = (request.form.get("email") or "").strip().lower()
    display_name = request.form.get("display_name") or "Admin"
    password = request.form.get("password") or None
    if (admin[1] or "").strip().lower() == SUPER_ADMIN_EMAIL and email != SUPER_ADMIN_EMAIL:
        flash("Không được đổi email admin gốc.", "danger")
        return redirect(url_for("admin_settings"))
    try:
        UserModel.update_admin(admin_id, email, display_name, password)
        if admin_id == session["user"]["id"]:
            session["user"]["email"] = email
            session["user"]["display_name"] = display_name
        flash("Đã cập nhật admin.", "success")
    except Exception as exc:
        flash(f"Không cập nhật được admin: {exc}", "danger")
    return redirect(url_for("admin_settings"))


@app.route("/admin-settings/<int:admin_id>/xoa", methods=["POST"])
@admin_required
def delete_admin(admin_id):
    if not is_super_admin(session["user"]):
        return "Chỉ admin gốc được quản lý admin", 403
    admin = UserModel.get_admin(admin_id)
    if not admin:
        return "Không tìm thấy admin", 404
    if (admin[1] or "").strip().lower() == SUPER_ADMIN_EMAIL:
        flash("Không được xóa admin gốc.", "danger")
        return redirect(url_for("admin_settings"))
    fallback = next((item for item in UserModel.get_admins() if (item[1] or "").strip().lower() == SUPER_ADMIN_EMAIL), None)
    if not fallback:
        flash("Không tìm thấy admin gốc để chuyển quyền sở hữu.", "danger")
        return redirect(url_for("admin_settings"))
    UserModel.delete_admin(admin_id, fallback[0])
    flash("Đã xóa admin.", "success")
    return redirect(url_for("admin_settings"))


@app.route("/chuyen-di/them", methods=["POST"])
@admin_required
def add_trip():
    name = (request.form.get("name") or "").strip()
    if not name:
        flash("Tên chuyến đi là bắt buộc.", "danger")
        return redirect(url_for("trips"))
    TripModel.create(name, request.form.get("description", ""), session["user"]["id"])
    return redirect(url_for("trips"))


@app.route("/chuyen-di/<int:trip_id>/xoa", methods=["POST"])
@admin_required
def delete_trip(trip_id):
    if not TripModel.get_for_admin(trip_id, admin_scope_id(session["user"])):
        return "Không có quyền", 403
    TripModel.delete(trip_id)
    return redirect(url_for("trips"))


@app.route("/chuyen-di/<int:trip_id>")
@admin_required
def trip_detail(trip_id):
    user = session["user"]
    trip = TripModel.get_for_admin(trip_id, admin_scope_id(user))
    if not trip:
        return "Không có quyền xem chuyến đi này", 403
    members = FinanceModel.members(trip_id)
    expenses = FinanceModel.expenses(trip_id)
    return render_template(
        "trip_detail.html",
        user=user,
        trip=trip,
        members=members,
        expenses=expenses,
        summary=build_summary(members, expenses),
        today=date.today().isoformat(),
        admins=UserModel.get_available_admins_for_trip(trip_id, trip[3], user["id"]),
        owner_admin=UserModel.get_admin_by_id(trip[3]) if trip[3] else None,
        permissions=TripModel.permissions(trip_id),
        can_manage_permissions=is_super_admin(user) or trip[3] == user["id"],
    )


@app.route("/chuyen-di/<int:trip_id>/thanh-vien", methods=["POST"])
@admin_required
def add_member(trip_id):
    if not TripModel.get_for_admin(trip_id, admin_scope_id(session["user"])):
        return "Không có quyền", 403
    name = (request.form.get("name") or "").strip()
    if not name:
        flash("Tên thành viên là bắt buộc.", "danger")
        return redirect(url_for("trip_detail", trip_id=trip_id))
    FinanceModel.add_member(trip_id, name, request.form.get("email", ""))
    FinanceModel.rebalance_expenses_equal(trip_id)
    flash("Đã thêm thành viên và chia đều lại toàn bộ khoản chi.", "success")
    return redirect(url_for("trip_detail", trip_id=trip_id))


@app.route("/chuyen-di/<int:trip_id>/thanh-vien/<int:member_id>/xoa", methods=["POST"])
@admin_required
def delete_member(trip_id, member_id):
    if not TripModel.get_for_admin(trip_id, admin_scope_id(session["user"])):
        return "Không có quyền", 403
    FinanceModel.delete_member(trip_id, member_id)
    FinanceModel.rebalance_expenses_equal(trip_id)
    flash("Đã xóa thành viên và chia đều lại toàn bộ khoản chi.", "success")
    return redirect(url_for("trip_detail", trip_id=trip_id))


@app.route("/chuyen-di/<int:trip_id>/thu", methods=["POST"])
@admin_required
def update_collections(trip_id):
    if not TripModel.get_for_admin(trip_id, admin_scope_id(session["user"])):
        return "Không có quyền", 403
    updates = []
    for member in FinanceModel.members(trip_id):
        member_id = member[0]
        updates.append({
            "member_id": member_id,
            "amount": money(request.form.get(f"collection_{member_id}")),
            "note": request.form.get(f"collection_note_{member_id}", ""),
        })
    FinanceModel.update_collections(trip_id, updates)
    flash("Đã cập nhật tiền thu.", "success")
    return redirect(url_for("trip_detail", trip_id=trip_id))


@app.route("/chuyen-di/<int:trip_id>/chi", methods=["POST"])
@admin_required
def add_expense(trip_id):
    if not TripModel.get_for_admin(trip_id, admin_scope_id(session["user"])):
        return "Không có quyền", 403
    members = FinanceModel.members(trip_id)
    try:
        FinanceModel.add_expense(
            trip_id,
            request.form.get("spent_date") or date.today().isoformat(),
            request.form.get("title", "").strip(),
            request.form.get("amount"),
            request.form.get("note", ""),
            [member[0] for member in members],
        )
        flash("Đã thêm khoản chi và chia đều cho mọi người.", "success")
    except ValueError as exc:
        flash(str(exc), "danger")
    return redirect(url_for("trip_detail", trip_id=trip_id))


@app.route("/chuyen-di/<int:trip_id>/chi/<int:expense_id>", methods=["POST"])
@admin_required
def update_expense(trip_id, expense_id):
    if not TripModel.get_for_admin(trip_id, admin_scope_id(session["user"])):
        return "Không có quyền", 403
    members = FinanceModel.members(trip_id)
    split_updates = [
        {"member_id": member[0], "amount": request.form.get(f"split_{expense_id}_{member[0]}")}
        for member in members
    ]
    try:
        FinanceModel.update_expense_splits(
            expense_id,
            request.form.get("title", "").strip(),
            request.form.get("spent_date") or date.today().isoformat(),
            request.form.get("amount"),
            request.form.get("note", ""),
            split_updates,
        )
        flash("Đã cập nhật khoản chi.", "success")
    except ValueError as exc:
        flash(str(exc), "danger")
    return redirect(url_for("trip_detail", trip_id=trip_id))


@app.route("/chuyen-di/<int:trip_id>/chi/<int:expense_id>/xoa", methods=["POST"])
@admin_required
def delete_expense(trip_id, expense_id):
    if not TripModel.get_for_admin(trip_id, admin_scope_id(session["user"])):
        return "Không có quyền", 403
    FinanceModel.delete_expense(trip_id, expense_id)
    return redirect(url_for("trip_detail", trip_id=trip_id))


@app.route("/chuyen-di/<int:trip_id>/viewer/<int:member_id>", methods=["POST"])
@admin_required
def create_viewer(trip_id, member_id):
    if not TripModel.get_for_admin(trip_id, admin_scope_id(session["user"])):
        return "Không có quyền", 403
    email = request.form.get("email", "")
    password = request.form.get("password", "") or "123456789"
    UserModel.create_viewer_for_member(member_id, email, password)
    flash("Đã tạo/cập nhật tài khoản người xem.", "success")
    return redirect(url_for("trip_detail", trip_id=trip_id))


@app.route("/chuyen-di/<int:trip_id>/quyen", methods=["POST"])
@admin_required
def add_permission(trip_id):
    user = session["user"]
    trip = TripModel.get_for_admin(trip_id, admin_scope_id(user))
    if not trip or not (is_super_admin(user) or trip[3] == user["id"]):
        return "Không có quyền chia sẻ admin", 403
    TripModel.add_permission(trip_id, request.form.get("admin_id"))
    return redirect(url_for("trip_detail", trip_id=trip_id))


@app.route("/chuyen-di/<int:trip_id>/quyen/<int:permission_id>/xoa", methods=["POST"])
@admin_required
def remove_permission(trip_id, permission_id):
    user = session["user"]
    trip = TripModel.get_for_admin(trip_id, admin_scope_id(user))
    if not trip or not (is_super_admin(user) or trip[3] == user["id"]):
        return "Không có quyền chia sẻ admin", 403
    TripModel.remove_permission(trip_id, permission_id)
    return redirect(url_for("trip_detail", trip_id=trip_id))


@app.route("/nguoi-xem")
@login_required
def viewer_dashboard():
    if session["user"]["role"] != "viewer":
        return redirect(url_for("trips"))
    return render_template("viewer_dashboard.html", trips=TripModel.all_for_viewer(session["user"]["id"]))


@app.route("/nguoi-xem/chuyen-di/<int:trip_id>")
@login_required
def viewer_trip(trip_id):
    user = session["user"]
    if user["role"] != "viewer":
        return redirect(url_for("trips"))
    trip = TripModel.get_for_viewer(trip_id, user["id"])
    if not trip:
        return "Không có quyền xem", 403
    members = FinanceModel.members(trip_id)
    expenses = FinanceModel.expenses(trip_id)
    return render_template(
        "viewer_trip.html",
        trip=trip,
        members=members,
        expenses=expenses,
        summary=build_summary(members, expenses),
        viewer_member_id=trip[3],
    )


@app.route("/healthz")
def healthz():
    return "ok"


@app.route("/service-worker.js")
def service_worker():
    return send_from_directory("static", "service-worker.js")


@app.cli.command("secret-key")
def secret_key_command():
    print(token_urlsafe(48))


if __name__ == "__main__":
    app.run(debug=True)
