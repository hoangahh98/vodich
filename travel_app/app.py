from datetime import date
from functools import lru_cache
from secrets import token_urlsafe
from time import monotonic, sleep
from urllib.parse import quote_plus
import unicodedata

import requests
from flask import Flask, flash, redirect, render_template, request, send_from_directory, session, url_for

from .auth import AuthService, admin_required, login_required
from .config import APP_NAME, FLASK_SECRET_KEY, SUPER_ADMIN_EMAIL, normalize_admin_user
from .models import DestinationSuggestionModel, FinanceModel, PeopleModel, TripModel, UserModel, admin_scope_id, build_summary, is_super_admin, money
from .schema import init_schema

app = Flask(__name__)
app.secret_key = FLASK_SECRET_KEY

EXPENSE_CATEGORIES = ("Khách sạn", "Ẩm thực", "Vui chơi", "Thể thao", "Khám phá", "Khác")
SUGGESTIONS_PER_CATEGORY_LIMIT = 10
SUGGESTION_REFRESH_SECONDS_LIMIT = 20
OSM_TERMS_PER_CATEGORY_REFRESH = 2
OSM_SEARCH_URL = "https://nominatim.openstreetmap.org/search"
OSM_USER_AGENT = "duhy-travel-suggestions/1.0"
OSM_DESTINATION_HINTS = {
    "Hạ Long": "Hạ Long, Quảng Ninh, Việt Nam",
    "Đà Nẵng": "Đà Nẵng, Việt Nam",
    "Cát Bà": "Cát Bà, Hải Phòng, Việt Nam",
    "Phú Quốc": "Phú Quốc, Kiên Giang, Việt Nam",
    "Hội An": "Hội An, Quảng Nam, Việt Nam",
    "Đà Lạt": "Đà Lạt, Lâm Đồng, Việt Nam",
    "Nha Trang": "Nha Trang, Khánh Hòa, Việt Nam",
    "Sa Pa": "Sa Pa, Lào Cai, Việt Nam",
    "Huế": "Huế, Việt Nam",
    "Ninh Bình": "Ninh Bình, Việt Nam",
    "Hà Giang": "Hà Giang, Việt Nam",
    "Quy Nhơn": "Quy Nhơn, Bình Định, Việt Nam",
    "Cần Thơ": "Cần Thơ, Việt Nam",
}
OSM_DESTINATION_KEYWORDS = {
    "Hạ Long": ["Hạ Long", "Ha Long", "Quảng Ninh", "Quang Ninh"],
    "Đà Nẵng": ["Đà Nẵng", "Da Nang"],
    "Cát Bà": ["Cát Bà", "Cat Ba", "Hải Phòng", "Hai Phong"],
    "Phú Quốc": ["Phú Quốc", "Phu Quoc", "Kiên Giang", "Kien Giang"],
    "Hội An": ["Hội An", "Hoi An", "Quảng Nam", "Quang Nam"],
    "Đà Lạt": ["Đà Lạt", "Da Lat", "Lâm Đồng", "Lam Dong"],
    "Nha Trang": ["Nha Trang", "Khánh Hòa", "Khanh Hoa"],
    "Sa Pa": ["Sa Pa", "Sapa", "Lào Cai", "Lao Cai"],
    "Huế": ["Huế", "Hue", "Thừa Thiên Huế", "Thua Thien Hue"],
    "Ninh Bình": ["Ninh Bình", "Ninh Binh"],
    "Hà Giang": ["Hà Giang", "Ha Giang"],
    "Quy Nhơn": ["Quy Nhơn", "Quy Nhon", "Bình Định", "Binh Dinh"],
    "Cần Thơ": ["Cần Thơ", "Can Tho"],
}
OSM_CATEGORY_TERMS = {
    "Quán ăn ngon": ["restaurant", "seafood restaurant", "food", "local food"],
    "Cà phê đẹp": ["cafe", "coffee shop", "tea house"],
    "Vui chơi": ["amusement park", "theme park", "water park", "playground", "entertainment"],
    "Khám phá": ["tourist attraction", "viewpoint", "museum", "temple", "beach", "park"],
    "Thể thao": ["sports centre", "stadium", "gym", "swimming pool", "sports"],
    "Khác": ["travel attraction", "attraction", "landmark"],
}


def _ascii_fold(value):
    normalized = unicodedata.normalize("NFKD", value or "")
    return "".join(char for char in normalized if not unicodedata.combining(char)).lower()


def _osm_destination_query(destination_name):
    return OSM_DESTINATION_HINTS.get(destination_name, f"{destination_name}, Việt Nam")


def _destination_keywords(destination_name):
    return OSM_DESTINATION_KEYWORDS.get(destination_name, [destination_name])


def _osm_result_matches_destination(destination_name, result):
    haystack = _ascii_fold(result.get("display_name") or "")
    return any(_ascii_fold(keyword) in haystack for keyword in _destination_keywords(destination_name))


def _osm_country_is_vietnam(result):
    address = result.get("address") or {}
    country_code = (address.get("country_code") or "").lower()
    display_name = (result.get("display_name") or "").lower()
    return country_code == "vn" or "việt nam" in display_name or "vietnam" in display_name


def _osm_viewbox_from_bounds(bounds):
    if not bounds or len(bounds) != 4:
        return None
    south, north, west, east = bounds
    return f"{west},{north},{east},{south}"


@lru_cache(maxsize=128)
def _get_osm_destination_viewbox(destination_name):
    response = requests.get(
        OSM_SEARCH_URL,
        params={
            "format": "jsonv2",
            "q": _osm_destination_query(destination_name),
            "limit": 1,
            "addressdetails": 1,
            "accept-language": "vi",
            "countrycodes": "vn",
        },
        headers={"User-Agent": OSM_USER_AGENT},
        timeout=15,
    )
    response.raise_for_status()
    for result in response.json():
        if not _osm_country_is_vietnam(result):
            continue
        return _osm_viewbox_from_bounds(result.get("boundingbox"))
    return None


def _osm_source_url(result):
    osm_type = (result.get("osm_type") or "").lower()
    osm_id = result.get("osm_id")
    if osm_type in {"node", "way", "relation"} and osm_id:
        return f"https://www.openstreetmap.org/{osm_type}/{osm_id}"
    return ""


def _limit_text(value, limit):
    return (value or "").strip()[:limit]


def _normalize_osm_result(result):
    extratags = result.get("extratags") or {}
    namedetails = result.get("namedetails") or {}
    display_name = result.get("display_name") or ""
    name = (
        result.get("name")
        or namedetails.get("name:vi")
        or namedetails.get("name")
        or display_name.split(",", 1)[0].strip()
    )
    if not name:
        return None
    phone = extratags.get("phone") or extratags.get("contact:phone") or ""
    opening_hours = extratags.get("opening_hours") or ""
    source_url = _osm_source_url(result)
    return {
        "name": _limit_text(name, 255),
        "address": display_name,
        "phone": _limit_text(phone, 80),
        "opening_hours": opening_hours,
        "description": "Dữ liệu cộng đồng từ OpenStreetMap, có thể thiếu hoặc cũ. Nên kiểm tra lại trước khi dùng.",
        "map_url": source_url or f"https://www.openstreetmap.org/search?query={quote_plus(display_name or name)}",
        "source_url": source_url,
    }


def _search_osm_suggestions(destination_name, category, max_terms=OSM_TERMS_PER_CATEGORY_REFRESH):
    places = []
    seen = set()
    terms = OSM_CATEGORY_TERMS.get(category, [category])[:max_terms]
    viewbox = _get_osm_destination_viewbox(destination_name)
    for index, term in enumerate(terms):
        params = {
            "format": "jsonv2",
            "q": f"{term}, {_osm_destination_query(destination_name)}",
            "limit": SUGGESTIONS_PER_CATEGORY_LIMIT,
            "addressdetails": 1,
            "extratags": 1,
            "namedetails": 1,
            "accept-language": "vi",
            "countrycodes": "vn",
        }
        if viewbox:
            params["viewbox"] = viewbox
            params["bounded"] = 1
        response = requests.get(
            OSM_SEARCH_URL,
            params=params,
            headers={"User-Agent": OSM_USER_AGENT},
            timeout=15,
        )
        response.raise_for_status()
        for result in response.json():
            if not _osm_country_is_vietnam(result):
                continue
            if not _osm_result_matches_destination(destination_name, result):
                continue
            place = _normalize_osm_result(result)
            if not place:
                continue
            dedupe_key = place["name"].strip().lower()
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            places.append(place)
            if len(places) >= SUGGESTIONS_PER_CATEGORY_LIMIT:
                return places
        if index < len(terms) - 1:
            sleep(1.1)
    return places

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
        destinations=DestinationSuggestionModel.destinations(),
        user=user,
        super_admin_email=SUPER_ADMIN_EMAIL,
    )


@app.route("/thanh-vien")
@admin_required
def people_list():
    user = session["user"]
    return render_template("people.html", people=PeopleModel.all_for_admin(admin_scope_id(user)), user=user)


@app.route("/goi-y")
@admin_required
def suggestions():
    try:
        destination_id = int(request.args.get("destination_id") or 0) or None
    except ValueError:
        destination_id = None
    category = request.args.get("category") or None
    if category not in DestinationSuggestionModel.categories():
        category = None
    return render_template(
        "suggestions.html",
        destinations=DestinationSuggestionModel.destinations(),
        categories=DestinationSuggestionModel.categories(),
        suggestions=DestinationSuggestionModel.suggestions(destination_id=destination_id, category=category),
        selected_destination_id=destination_id,
        selected_category=category,
    )


@app.route("/goi-y/dia-danh", methods=["POST"])
@admin_required
def add_destination():
    try:
        DestinationSuggestionModel.create_destination(request.form.get("name"))
        flash("Đã thêm địa danh.", "success")
    except ValueError as exc:
        flash(str(exc), "danger")
    return redirect(url_for("suggestions"))


@app.route("/goi-y/them", methods=["POST"])
@admin_required
def add_suggestion():
    try:
        DestinationSuggestionModel.create_suggestion(
            request.form.get("destination_id"),
            request.form.get("category"),
            request.form.get("name"),
            request.form.get("address", ""),
            request.form.get("phone", ""),
            request.form.get("opening_hours", ""),
            request.form.get("description", ""),
            request.form.get("map_url", ""),
            request.form.get("source_url", ""),
        )
        flash("Đã thêm gợi ý.", "success")
    except Exception as exc:
        flash(f"Không thêm được gợi ý: {exc}", "danger")
    return redirect(url_for("suggestions"))


@app.route("/goi-y/lay-them", methods=["POST"])
@admin_required
def refresh_suggestions():
    destinations = DestinationSuggestionModel.destinations_used_by_trips(admin_scope_id(session["user"]))
    if not destinations:
        flash("Chưa có chuyến đi nào chọn địa danh để lấy thêm gợi ý.", "warning")
        return redirect(url_for("suggestions"))

    inserted = 0
    updated = 0
    skipped_new = 0
    skipped_full = 0
    timed_out = False
    started_at = monotonic()
    errors = []
    try:
        removed_osm = DestinationSuggestionModel.deactivate_osm_suggestions()
    except Exception as exc:
        removed_osm = 0
        errors.append(f"Dọn dữ liệu OSM cũ: {exc}")
    for destination_id, destination_name in destinations:
        for category in DestinationSuggestionModel.categories():
            if monotonic() - started_at > SUGGESTION_REFRESH_SECONDS_LIMIT:
                timed_out = True
                break
            current_count = DestinationSuggestionModel.suggestion_count(destination_id, category)
            remaining = max(0, SUGGESTIONS_PER_CATEGORY_LIMIT - current_count)
            if remaining <= 0:
                skipped_full += 1
                continue
            try:
                places = _search_osm_suggestions(destination_name, category)
                sleep(1.1)
            except Exception as exc:
                errors.append(f"{destination_name} / {category}: {exc}")
                continue
            for place in places:
                if remaining <= 0:
                    if not DestinationSuggestionModel.suggestion_exists(destination_id, category, place["name"]):
                        skipped_new += 1
                        continue
                try:
                    was_inserted = DestinationSuggestionModel.upsert_suggestion(
                        destination_id,
                        category,
                        place["name"],
                        place["address"],
                        place["phone"],
                        place["opening_hours"],
                        place["description"],
                        place["map_url"],
                        place["source_url"],
                    )
                except Exception as exc:
                    errors.append(f"{destination_name} / {category} / {place['name']}: {exc}")
                    continue
                if was_inserted:
                    inserted += 1
                    remaining -= 1
                else:
                    updated += 1
        if timed_out:
            break

    message = f"Đã lấy thêm gợi ý từ OSM: thêm {inserted}, cập nhật {updated}."
    if removed_osm:
        message += f" Đã ẩn {removed_osm} gợi ý OSM cũ."
    if skipped_full:
        message += f" Bỏ qua {skipped_full} nhóm đã đủ {SUGGESTIONS_PER_CATEGORY_LIMIT} bản ghi."
    if skipped_new:
        message += f" Bỏ qua {skipped_new} gợi ý mới vì nhóm đã đủ {SUGGESTIONS_PER_CATEGORY_LIMIT} bản ghi."
    if timed_out:
        message += " Đã tạm dừng sớm để tránh quá tải, bấm lại để lấy tiếp."
    if errors:
        flash(message, "warning")
        flash("Một số nhóm chưa lấy được: " + "; ".join(errors[:3]), "danger")
    else:
        flash(message, "success")
    return redirect(url_for("suggestions"))


@app.route("/goi-y/<int:suggestion_id>/sua", methods=["POST"])
@admin_required
def edit_suggestion(suggestion_id):
    try:
        DestinationSuggestionModel.update_suggestion(
            suggestion_id,
            request.form.get("destination_id"),
            request.form.get("category"),
            request.form.get("name"),
            request.form.get("address", ""),
            request.form.get("phone", ""),
            request.form.get("opening_hours", ""),
            request.form.get("description", ""),
            request.form.get("map_url", ""),
            request.form.get("source_url", ""),
        )
        flash("Đã cập nhật gợi ý.", "success")
    except Exception as exc:
        flash(f"Không cập nhật được gợi ý: {exc}", "danger")
    return redirect(url_for("suggestions"))


@app.route("/goi-y/<int:suggestion_id>/xoa", methods=["POST"])
@admin_required
def delete_suggestion(suggestion_id):
    DestinationSuggestionModel.delete_suggestion(suggestion_id)
    flash("Đã xóa gợi ý.", "success")
    return redirect(url_for("suggestions"))


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
    TripModel.create(name, request.form.get("description", ""), session["user"]["id"], request.form.get("destination_id"))
    return redirect(url_for("trips"))


@app.route("/chuyen-di/<int:trip_id>/sua", methods=["POST"])
@admin_required
def edit_trip(trip_id):
    if not TripModel.get_for_admin(trip_id, admin_scope_id(session["user"])):
        return "Không có quyền", 403
    name = (request.form.get("name") or "").strip()
    if not name:
        flash("Tên chuyến đi là bắt buộc.", "danger")
        return redirect(url_for("trips"))
    TripModel.update(trip_id, name, request.form.get("description", ""), request.form.get("destination_id"))
    flash("Đã cập nhật chuyến đi.", "success")
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
        expense_categories=EXPENSE_CATEGORIES,
        destination=DestinationSuggestionModel.destination(trip[4]) if len(trip) > 4 else None,
        destination_suggestions=DestinationSuggestionModel.suggestions_for_destination(trip[4]) if len(trip) > 4 else {},
        suggestion_categories=DestinationSuggestionModel.categories(),
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
    flash("Đã thêm thành viên và chia đều lại các khoản chi chung.", "success")
    return redirect(url_for("trip_detail", trip_id=trip_id))


@app.route("/chuyen-di/<int:trip_id>/thanh-vien/<int:member_id>/xoa", methods=["POST"])
@admin_required
def delete_member(trip_id, member_id):
    if not TripModel.get_for_admin(trip_id, admin_scope_id(session["user"])):
        return "Không có quyền", 403
    FinanceModel.delete_member(trip_id, member_id)
    FinanceModel.rebalance_expenses_equal(trip_id)
    flash("Đã xóa thành viên và chia đều lại các khoản chi chung.", "success")
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
    title = request.form.get("title", "").strip()
    if title not in EXPENSE_CATEGORIES:
        flash("Nội dung khoản chi không hợp lệ.", "danger")
        return redirect(url_for("trip_detail", trip_id=trip_id))
    note = (request.form.get("note") or "").strip()
    split_mode = request.form.get("split_mode") or "shared"
    private_member_id = request.form.get("private_member_id")
    private_splits = [
        {"member_id": member[0], "amount": request.form.get(f"private_split_{member[0]}")}
        for member in members
    ]
    try:
        FinanceModel.add_expense(
            trip_id,
            request.form.get("spent_date") or date.today().isoformat(),
            title,
            request.form.get("amount"),
            note,
            [member[0] for member in members],
            split_mode,
            private_member_id,
            private_splits,
        )
        if split_mode == "private":
            flash("Đã thêm khoản chi riêng cho các thành viên có nhập số tiền.", "success")
        else:
            flash("Đã thêm khoản chi chung và chia đều cho mọi người.", "success")
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
    title = request.form.get("title", "").strip()
    if title not in EXPENSE_CATEGORIES:
        flash("Nội dung khoản chi không hợp lệ.", "danger")
        return redirect(url_for("trip_detail", trip_id=trip_id))
    try:
        FinanceModel.update_expense_splits(
            expense_id,
            title,
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
