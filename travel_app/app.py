from datetime import date
from secrets import token_urlsafe

from flask import Flask, flash, redirect, render_template, request, send_from_directory, session, url_for

from .auth import AuthService, admin_required, login_required
from .config import APP_NAME, FLASK_SECRET_KEY, SUPER_ADMIN_EMAIL, normalize_admin_user
from .models import FinanceModel, PeopleModel, TripModel, UserModel, admin_scope_id, build_summary, is_super_admin, money
from .schema import init_schema

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
    if user["role"] != "admin":
        return redirect(url_for("viewer_dashboard"))
    return redirect(url_for("trips"))


@app.route("/module")
@login_required
def module_home():
    return redirect(url_for("index"))


@app.route("/login", methods=["GET", "POST"])
def login():
    return redirect("/login")


@app.route("/dang-xuat")
def logout():
    return redirect("/dang-xuat")


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


@app.route("/thanh-vien")
@admin_required
def people_list():
    user = session["user"]
    return render_template("people.html", people=PeopleModel.all_for_admin(admin_scope_id(user)), user=user)


@app.route("/thanh-vien/them", methods=["POST"])
@admin_required
def add_person():
    name = (request.form.get("name") or "").strip()
    if not name:
        flash("Tên thành viên là bắt buộc.", "danger")
        return redirect(url_for("people_list"))
    PeopleModel.create(name, request.form.get("email", ""), session["user"]["id"])
    flash("Đã thêm thành viên.", "success")
    return redirect(url_for("people_list"))


@app.route("/thanh-vien/<int:person_id>/sua", methods=["POST"])
@admin_required
def edit_person(person_id):
    person = PeopleModel.get_for_admin(person_id, admin_scope_id(session["user"]))
    if not person:
        return "Không có quyền sửa thành viên này", 403
    name = (request.form.get("name") or "").strip()
    if not name:
        flash("Tên thành viên là bắt buộc.", "danger")
        return redirect(url_for("people_list"))
    PeopleModel.update(person_id, name, request.form.get("email", ""))
    flash("Đã cập nhật thành viên.", "success")
    return redirect(url_for("people_list"))


@app.route("/thanh-vien/<int:person_id>/xoa", methods=["POST"])
@admin_required
def delete_person(person_id):
    person = PeopleModel.get_for_admin(person_id, admin_scope_id(session["user"]))
    if not person:
        return "Không có quyền xóa thành viên này", 403
    PeopleModel.delete(person_id)
    flash("Đã xóa thành viên khỏi danh bạ.", "success")
    return redirect(url_for("people_list"))


@app.route("/admin-settings")
@admin_required
def admin_settings():
    return redirect("/admin-settings")


@app.route("/admin-settings/them", methods=["POST"])
@admin_required
def add_admin():
    if not is_super_admin(session["user"]):
        return "Chi admin goc duoc quan ly admin", 403
    email = normalize_admin_user(request.form.get("email"))
    password = request.form.get("password") or ""
    display_name = request.form.get("display_name") or "Admin"
    if not email or len(password) < 6:
        flash("User admin và mật khẩu tối thiểu 6 ký tự là bắt buộc.", "danger")
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
    email = normalize_admin_user(request.form.get("email"))
    display_name = request.form.get("display_name") or "Admin"
    password = request.form.get("password") or None
    if normalize_admin_user(admin[1]) == SUPER_ADMIN_EMAIL and email != SUPER_ADMIN_EMAIL:
        flash("Không được đổi user admin gốc.", "danger")
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
    if normalize_admin_user(admin[1]) == SUPER_ADMIN_EMAIL:
        flash("Không được xóa admin gốc.", "danger")
        return redirect(url_for("admin_settings"))
    fallback = next((item for item in UserModel.get_admins() if normalize_admin_user(item[1]) == SUPER_ADMIN_EMAIL), None)
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
        available_people=PeopleModel.available_for_trip(trip_id, admin_scope_id(user)),
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
    person_id = request.form.get("person_id")
    if not person_id:
        flash("Bạn cần chọn thành viên.", "danger")
        return redirect(url_for("trip_detail", trip_id=trip_id))
    person = PeopleModel.get_for_admin(person_id, admin_scope_id(session["user"]))
    if not person:
        return "Không có quyền chọn thành viên này", 403
    FinanceModel.add_member_from_person(trip_id, person_id)
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


@app.route("/chuyen-di/<int:trip_id>/thanh-vien/<int:member_id>/sua", methods=["POST"])
@admin_required
def update_member(trip_id, member_id):
    if not TripModel.get_for_admin(trip_id, admin_scope_id(session["user"])):
        return "Không có quyền", 403
    member = FinanceModel.get_member_for_admin(member_id, admin_scope_id(session["user"]))
    if not member or member[1] != trip_id:
        return "Không tìm thấy thành viên", 404
    name = (request.form.get("name") or "").strip()
    if not name:
        flash("Tên thành viên là bắt buộc.", "danger")
        return redirect(url_for("trip_detail", trip_id=trip_id))
    FinanceModel.update_member(member_id, name, request.form.get("email", ""))
    if request.form.get("create_viewer") and request.form.get("email"):
        UserModel.create_viewer_for_member(member_id, request.form.get("email"), request.form.get("password") or "123456789")
    flash("Đã cập nhật thông tin thành viên.", "success")
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
    if session["user"]["role"] == "admin":
        return redirect(url_for("trips"))
    user = session["user"]
    return render_template("viewer_dashboard.html", trips=TripModel.all_for_viewer(user["id"], user.get("email")))


@app.route("/nguoi-xem/chuyen-di/<int:trip_id>")
@login_required
def viewer_trip(trip_id):
    user = session["user"]
    if user["role"] == "admin":
        return redirect(url_for("trips"))
    trip = TripModel.get_for_viewer(trip_id, user["id"], user.get("email"))
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
