import re
from decimal import Decimal, InvalidOperation


VALID_TRINH_DO = {"A", "B", "C", "D"}
VALID_LOAI_DAU = {"don", "doi"}
VALID_THE_THUC = {"vong_tron", "bang"}
KNOCKOUT_STAGE_REQUIREMENTS = {2: 4, 4: 8, 8: 16}
VALID_LOAI_THANH_VIEN = {"co_dinh", "vang_lai"}
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _normalize_numeric_text(value):
    raw = (str(value).strip() if value is not None else "")
    if raw == "":
        return ""
    raw = raw.replace(" ", "")
    if "," in raw and "." in raw:
        raw = raw.replace(",", "")
    elif "," in raw:
        raw = raw.replace(",", ".")
    return raw


def normalize_vdv_form(form):
    ten_vdv = (form.get("ten_vdv") or "").strip()
    email = (form.get("email") or "").strip().lower()
    trinh_do = (form.get("trinh_do") or "C").strip().upper()
    ghi_chu = (form.get("ghi_chu") or "").strip()

    errors = []
    if not ten_vdv:
        errors.append("Tên VĐV không được để trống.")
    if not email:
        errors.append("Email không được để trống.")
    elif not EMAIL_RE.match(email):
        errors.append("Email không đúng định dạng.")
    if trinh_do not in VALID_TRINH_DO:
        errors.append("Trình độ chỉ được chọn A, B, C hoặc D.")

    data = {
        "ten_vdv": ten_vdv,
        "email": email,
        "trinh_do": trinh_do if trinh_do in VALID_TRINH_DO else "C",
        "ghi_chu": ghi_chu,
    }
    return data, errors


def _parse_int_field(value, default, minimum=None, maximum=None):
    raw = _normalize_numeric_text(value)
    if raw == "":
        number = default
    else:
        decimal_value = Decimal(raw)
        if decimal_value != decimal_value.to_integral_value():
            raise ValueError("number must be an integer")
        number = int(decimal_value)
    if minimum is not None and number < minimum:
        number = minimum
    if maximum is not None and number > maximum:
        number = maximum
    return number


def _estimated_team_count(loai_dau, so_nguoi_du_kien):
    if not isinstance(so_nguoi_du_kien, int):
        return 0
    if loai_dau == "doi":
        return so_nguoi_du_kien // 2
    return so_nguoi_du_kien


def _parse_money_field(value):
    raw = str(value or "").strip()
    if raw == "":
        return 0
    cleaned = re.sub(r"[^\d-]", "", raw)
    if cleaned in {"", "-"}:
        return 0
    number = int(cleaned)
    return max(0, number)


def _normalize_tournament_form_legacy(form):
    errors = []
    ten_giai_dau = (form.get("ten_giai_dau") or "").strip()
    dia_diem = (form.get("dia_diem") or "").strip()
    thoi_gian_bat_dau = (form.get("thoi_gian_bat_dau") or "").strip() or None
    loai_dau = (form.get("loai_dau") or "don").strip()
    the_thuc = (form.get("the_thuc") or "vong_tron").strip()

    if not ten_giai_dau:
        errors.append("Tên giải không được để trống.")
    if loai_dau not in VALID_LOAI_DAU:
        errors.append("Hình thức thi đấu không hợp lệ.")
        loai_dau = "don"
    if the_thuc not in VALID_THE_THUC:
        errors.append("Thể thức thi đấu không hợp lệ.")
        the_thuc = "vong_tron"

    numeric_fields = {}
    try:
        numeric_fields["so_luong_san"] = _parse_int_field(form.get("so_luong_san"), 1, minimum=1)
        numeric_fields["so_nguoi_du_kien"] = _parse_int_field(form.get("so_nguoi_du_kien"), 10, minimum=1)
        numeric_fields["diem_cham"] = _parse_int_field(form.get("diem_cham"), 11, minimum=1, maximum=99)
        numeric_fields["diem_toi_da"] = _parse_int_field(form.get("diem_toi_da"), 15, minimum=1, maximum=99)
        numeric_fields["chi_phi_san_bai"] = _parse_money_field(form.get("chi_phi_san_bai"))
        numeric_fields["chi_phi_nuoc_noi"] = _parse_money_field(form.get("chi_phi_nuoc_noi"))
        numeric_fields["chi_phi_giai_thuong"] = _parse_money_field(form.get("chi_phi_giai_thuong"))
        numeric_fields["chi_phi_khac"] = _parse_money_field(form.get("chi_phi_khac"))
        numeric_fields["ty_le_giai_1"] = _parse_int_field(form.get("ty_le_giai_1"), 0, minimum=0)
        numeric_fields["ty_le_giai_2"] = _parse_int_field(form.get("ty_le_giai_2"), 0, minimum=0)
        numeric_fields["ty_le_giai_3"] = _parse_int_field(form.get("ty_le_giai_3"), 0, minimum=0)
    except ValueError:
        errors.append("Các trường số chỉ được nhập số hợp lệ.")
        numeric_fields = {
            "so_luong_san": 1,
            "so_nguoi_du_kien": 10,
            "diem_cham": 11,
            "diem_toi_da": 15,
            "chi_phi_san_bai": 0,
            "chi_phi_nuoc_noi": 0,
            "chi_phi_giai_thuong": 0,
            "chi_phi_khac": 0,
            "ty_le_giai_1": 0,
            "ty_le_giai_2": 0,
            "ty_le_giai_3": 0,
        }

    if numeric_fields["diem_toi_da"] < numeric_fields["diem_cham"]:
        errors.append("Max điểm phải lớn hơn hoặc bằng điểm chạm.")
        numeric_fields["diem_toi_da"] = numeric_fields["diem_cham"]

    data = {
        "ten_giai_dau": ten_giai_dau,
        "dia_diem": dia_diem,
        "thoi_gian_bat_dau": thoi_gian_bat_dau,
        "loai_dau": loai_dau,
        "the_thuc": the_thuc,
        **numeric_fields,
    }
    return data, errors


def normalize_tournament_form_v2(form):
    errors = []
    ten_giai_dau = (form.get("ten_giai_dau") or "").strip()
    dia_diem = (form.get("dia_diem") or "").strip()
    thoi_gian_bat_dau = (form.get("thoi_gian_bat_dau") or "").strip() or None
    loai_dau = (form.get("loai_dau") or "don").strip()

    if not ten_giai_dau:
        errors.append("Tên giải không được để trống.")
    if loai_dau not in VALID_LOAI_DAU:
        errors.append("Hình thức thi đấu không hợp lệ.")
        loai_dau = "don"

    the_thuc = (form.get("the_thuc") or "vong_tron").strip()
    if the_thuc not in VALID_THE_THUC:
        errors.append("Thể thức thi đấu không hợp lệ.")
        the_thuc = "vong_tron"

    if form.get("knockout_tu_ket"):
        knockout_qualifiers = 8
    elif form.get("knockout_ban_ket"):
        knockout_qualifiers = 4
    elif form.get("knockout_chung_ket"):
        knockout_qualifiers = 2
    else:
        knockout_qualifiers = None

    numeric_specs = {
        "so_luong_san": (form.get("so_luong_san"), 1, 1, None),
        "so_nguoi_du_kien": (form.get("so_nguoi_du_kien"), 10, 1, None),
        "diem_cham": (form.get("diem_cham"), 11, 1, 99),
        "diem_toi_da": (form.get("diem_toi_da"), 15, 1, 99),
        "chi_phi_san_bai": (form.get("chi_phi_san_bai"), 0, 0, None),
        "chi_phi_nuoc_noi": (form.get("chi_phi_nuoc_noi"), 0, 0, None),
        "chi_phi_giai_thuong": (form.get("chi_phi_giai_thuong"), 0, 0, None),
        "chi_phi_khac": (form.get("chi_phi_khac"), 0, 0, None),
        "ty_le_giai_1": (form.get("ty_le_giai_1"), 0, 0, None),
        "ty_le_giai_2": (form.get("ty_le_giai_2"), 0, 0, None),
        "ty_le_giai_3": (form.get("ty_le_giai_3"), 0, 0, None),
        "so_doi_moi_bang": (form.get("so_doi_moi_bang"), 4, 2, None),
        "so_bang": (form.get("so_bang"), 2, 1, None),
        "so_doi_vao_vong_trong": (form.get("so_doi_vao_vong_trong"), 2, 2, None),
    }
    numeric_fields = {}
    has_bad_number = False
    for field_name, (raw_value, default, minimum, maximum) in numeric_specs.items():
        try:
            numeric_fields[field_name] = _parse_int_field(raw_value, default, minimum=minimum, maximum=maximum)
        except (InvalidOperation, ValueError):
            has_bad_number = True
            numeric_fields[field_name] = raw_value if raw_value not in (None, "") else default

    if has_bad_number:
        errors.append("Các trường số chỉ được nhập số hợp lệ.")

    if (
        isinstance(numeric_fields["diem_toi_da"], int)
        and isinstance(numeric_fields["diem_cham"], int)
        and numeric_fields["diem_toi_da"] < numeric_fields["diem_cham"]
    ):
        errors.append("Max điểm phải lớn hơn hoặc bằng điểm chạm.")
        numeric_fields["diem_toi_da"] = numeric_fields["diem_cham"]

    if knockout_qualifiers:
        numeric_fields["so_doi_vao_vong_trong"] = knockout_qualifiers
    elif isinstance(numeric_fields["so_doi_vao_vong_trong"], int):
        if numeric_fields["so_doi_vao_vong_trong"] >= 8:
            numeric_fields["so_doi_vao_vong_trong"] = 8
        elif numeric_fields["so_doi_vao_vong_trong"] >= 4:
            numeric_fields["so_doi_vao_vong_trong"] = 4
        else:
            numeric_fields["so_doi_vao_vong_trong"] = 2

    if the_thuc == "bang" and isinstance(numeric_fields["so_doi_vao_vong_trong"], int):
        estimated_teams = _estimated_team_count(loai_dau, numeric_fields["so_nguoi_du_kien"])
        required_teams = KNOCKOUT_STAGE_REQUIREMENTS.get(numeric_fields["so_doi_vao_vong_trong"], 4)
        if estimated_teams < required_teams:
            errors.append(
                f"Vòng trong đã chọn cần ít nhất {required_teams} đội. "
                f"Hiện số người dự kiến chỉ tương đương {estimated_teams} đội."
            )

    return {
        "ten_giai_dau": ten_giai_dau,
        "dia_diem": dia_diem,
        "thoi_gian_bat_dau": thoi_gian_bat_dau,
        "loai_dau": loai_dau,
        "the_thuc": the_thuc,
        "cho_phep_dang_ky_ngoai": bool(form.get("cho_phep_dang_ky_ngoai")),
        **numeric_fields,
    }, errors


normalize_tournament_form = normalize_tournament_form_v2


def normalize_team_form(form):
    ten_doi = (form.get("ten_doi") or "").strip()
    mo_ta = (form.get("mo_ta") or "").strip()

    errors = []
    if not ten_doi:
        errors.append("Tên đội bóng không được để trống.")

    return {"ten_doi": ten_doi, "mo_ta": mo_ta}, errors


def normalize_team_member_form(form):
    van_dong_vien_id = (form.get("van_dong_vien_id") or "").strip()
    trinh_do = (form.get("trinh_do") or "C").strip().upper()
    loai_thanh_vien = (form.get("loai_thanh_vien") or "co_dinh").strip()
    ghi_chu = (form.get("ghi_chu") or "").strip()

    errors = []
    try:
        van_dong_vien_id = int(van_dong_vien_id)
    except (TypeError, ValueError):
        van_dong_vien_id = None
        errors.append("Vui lòng chọn vận động viên.")
    if trinh_do and trinh_do not in VALID_TRINH_DO:
        errors.append("Trình độ chỉ được chọn A, B, C hoặc D.")
        trinh_do = "C"
    if loai_thanh_vien not in VALID_LOAI_THANH_VIEN:
        errors.append("Loại thành viên không hợp lệ.")
        loai_thanh_vien = "co_dinh"

    return {
        "van_dong_vien_id": van_dong_vien_id,
        "trinh_do": trinh_do,
        "loai_thanh_vien": loai_thanh_vien,
        "ghi_chu": ghi_chu,
    }, errors


def normalize_team_month_form(form):
    errors = []
    try:
        data = {
            "muc_phi_thang": _parse_money_field(form.get("muc_phi_thang")),
            "chi_phi_san_bai": _parse_money_field(form.get("chi_phi_san_bai")),
            "tien_san_con_lai_thang_truoc": _parse_money_field(form.get("tien_san_con_lai_thang_truoc")),
            "ghi_chu": (form.get("ghi_chu") or "").strip(),
        }
    except ValueError:
        errors.append("Các trường tiền chỉ được nhập số hợp lệ.")
        data = {
            "muc_phi_thang": 0,
            "chi_phi_san_bai": 0,
            "tien_san_con_lai_thang_truoc": 0,
            "ghi_chu": (form.get("ghi_chu") or "").strip(),
        }
    return data, errors


def normalize_team_expense_form(form):
    errors = []
    ngay_chi = (form.get("ngay_chi") or "").strip()
    noi_dung = (form.get("noi_dung") or "").strip()
    ghi_chu = (form.get("ghi_chu") or "").strip()

    if not ngay_chi:
        errors.append("Ngày chi không được để trống.")
    if not noi_dung:
        errors.append("Nội dung khoản chi không được để trống.")
    try:
        so_tien = _parse_money_field(form.get("so_tien"))
    except ValueError:
        so_tien = 0
        errors.append("Số tiền chi chỉ được nhập số hợp lệ.")

    return {
        "ngay_chi": ngay_chi,
        "noi_dung": noi_dung,
        "so_tien": so_tien,
        "ghi_chu": ghi_chu,
    }, errors
