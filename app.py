"""
Complete App with Database Logging
All logs stored in app_logs table
"""

from flask import Flask, render_template, request, redirect, url_for, session, jsonify, g, send_from_directory, make_response, flash
import os
import random
from models import VanDongVienModel, AdminUserModel, TournamentModel, DangKyGiaiModel, DoiBongModel, MatchModel, EntertainmentCardGameModel, EntertainmentLiengGameModel, EntertainmentBaCayGameModel
from services import FinanceService
from knockout_logic import MatchSchedulerService
from auth import AuthService, login_required, admin_required
from config import (
    FLASK_SECRET_KEY,
    FLASK_SECRET_KEY_ERROR,
    BASE_URL,
    LOG_ALL_REQUESTS,
    SLOW_REQUEST_MS,
    SUPER_ADMIN_EMAIL,
    normalize_admin_user,
)
from db import db_cursor
from logging_service import DBLogger, DBLogViewer
import traceback
import time
from datetime import date, datetime
from validators import (
    normalize_tournament_form,
    normalize_vdv_form,
    normalize_team_form,
    normalize_team_member_form,
    normalize_team_month_form,
    normalize_team_expense_form,
)
from werkzeug.exceptions import HTTPException
from werkzeug.middleware.dispatcher import DispatcherMiddleware

from schema import ensure_all_schema

app = Flask(__name__)
app.secret_key = FLASK_SECRET_KEY

with app.app_context():
    ensure_all_schema()

from travel_app import app as travel_app
from travel_app.models import TripModel as TravelTripModel


@app.context_processor
def inject_admin_user_config():
    return {"super_admin_email": SUPER_ADMIN_EMAIL}


@app.route('/service-worker.js')
def service_worker():
    response = make_response(send_from_directory(app.static_folder, 'service-worker.js'))
    response.headers['Content-Type'] = 'application/javascript'
    response.headers['Service-Worker-Allowed'] = '/'
    response.headers['Cache-Control'] = 'no-cache'
    return response


@app.route('/healthz')
def healthz():
    return "ok", 200


def _safe_request_details():
    """Return request details for logs without storing passwords/secrets."""
    details = {
        "args": request.args.to_dict(flat=False),
        "form": {},
        "json": None,
    }
    sensitive_keys = {"password", "confirm_password", "token", "secret", "db_password"}
    for key, value in request.form.items():
        details["form"][key] = "***" if key.lower() in sensitive_keys else value
    if request.is_json:
        payload = request.get_json(silent=True)
        if isinstance(payload, dict):
            details["json"] = {
                key: "***" if key.lower() in sensitive_keys else value
                for key, value in payload.items()
            }
    return details


@app.before_request
def capture_action_start():
    g.request_started_at = time.time()


@app.after_request
def log_user_action(response):
    duration_ms = int((time.time() - getattr(g, "request_started_at", time.time())) * 1000)
    skip_action_log = (
        request.endpoint == "static"
        or request.method == "HEAD"
        or request.path in ("/favicon.ico", "/healthz")
        or (
            not LOG_ALL_REQUESTS
            and request.method == "GET"
            and response.status_code < 400
            and duration_ms < SLOW_REQUEST_MS
        )
    )
    if not skip_action_log:
        user = session.get("user", {})
        details = _safe_request_details()
        details["duration_ms"] = duration_ms
        DBLogger.log_user_action(
            user_email=user.get("email") or request.form.get("email"),
            user_role=user.get("role") or request.form.get("role"),
            action=f"{request.method} {request.path}",
            route=request.path,
            endpoint=request.endpoint,
            method=request.method,
            status_code=response.status_code,
            ip_address=request.headers.get("X-Forwarded-For", request.remote_addr),
            user_agent=request.headers.get("User-Agent"),
            cf_ray=request.headers.get("CF-Ray"),
            details=details,
        )
    return response


@app.errorhandler(Exception)
def log_unhandled_exception(error):
    if isinstance(error, HTTPException):
        return error

    user = session.get("user", {})
    DBLogger.log_exception(
        f"Unhandled exception: {str(error)}",
        error,
        user_email=user.get("email") or request.form.get("email"),
        route=request.path,
        method=request.method,
        status_code=500,
        context=traceback.format_exc(),
        request_path=request.path,
        ip_address=request.headers.get("X-Forwarded-For", request.remote_addr),
        user_agent=request.headers.get("User-Agent"),
        cf_ray=request.headers.get("CF-Ray"),
    )
    return "❌ Lỗi hệ thống", 500


# ============ HELPER FUNCTION ============

def prepare_tournament_detail(giai_raw, registrations):
    """Prepare tournament details with correct data format"""
    players_for_calc = []
    for reg in registrations:
        # reg: (dkg.id, van_dong_vien_id, ten_vdv, trinh_do, email, so_tien_da_dong, trang_thai_dong_tien, ghi_chu)
        reformatted = (
            reg[0], reg[1], reg[2], reg[3], reg[5], reg[7], reg[4], reg[6]
            # id,   vdv_id, ten,    trinh,   tien,   ghi_chu, email,  trang_thai
        )
        players_for_calc.append(reformatted)

    return FinanceService.tinh_toan_dong_tien(giai_raw, players_for_calc)


def _giai_tuple_from_form(giai_id, form_data):
    return (
        giai_id,
        form_data.get('ten_giai_dau'),
        form_data.get('so_luong_san'),
        form_data.get('dia_diem'),
        form_data.get('chi_phi_san_bai'),
        form_data.get('chi_phi_nuoc_noi'),
        form_data.get('chi_phi_giai_thuong'),
        form_data.get('chi_phi_khac'),
        form_data.get('ty_le_giai_1'),
        form_data.get('ty_le_giai_2'),
        form_data.get('ty_le_giai_3'),
        form_data.get('so_nguoi_du_kien'),
        form_data.get('thoi_gian_bat_dau'),
        None,
        None,
        form_data.get('loai_dau'),
        form_data.get('diem_cham'),
        form_data.get('diem_toi_da'),
        None,
        None,
        None,
        None,
        form_data.get('the_thuc', 'vong_tron'),
        form_data.get('so_doi_moi_bang', 4),
        form_data.get('so_bang', 2),
        form_data.get('so_doi_vao_vong_trong', 2),
    )


@app.route('/doc-diem-giao-luu')
@login_required
def doc_diem_giao_luu():
    """Trang doc diem giao luu, chi luu tam tren trinh duyet."""
    user = session.get('user', {})
    DBLogger.log_request('GET', '/doc-diem-giao-luu', user.get('email'))
    return render_template('doc_diem_giao_luu.html', user=user)

# ============ ADMIN ROUTES ============

@app.route('/')
@login_required
def trang_chu():
    user = session.get('user', {})
    DBLogger.log_request('GET', '/', user.get('email'))

    if user.get('role') != 'admin':
        return redirect(url_for('vdv_dashboard'))

    return render_template('chon_cau_phan.html')


@app.route('/giai-tri')
@login_required
def giai_tri():
    user = session.get('user', {})
    DBLogger.log_request('GET', '/giai-tri', user.get('email'))
    return render_template('giai_tri.html', user=user)


@app.route('/giai-tri/ghi-diem')
@login_required
def giai_tri_ghi_diem():
    user = session.get('user', {})
    DBLogger.log_request('GET', '/giai-tri/ghi-diem', user.get('email'))
    games = EntertainmentCardGameModel.get_games()
    return render_template('giai_tri_ghi_diem.html', user=user, games=games)


@app.route('/giai-tri/nguoi-choi')
@admin_required
def giai_tri_nguoi_choi():
    user = session.get('user', {})
    players = VanDongVienModel.get_all()
    DBLogger.log_request('GET', '/giai-tri/nguoi-choi', user.get('email'))
    return render_template('giai_tri_nguoi_choi.html', user=user, players=players)


@app.route('/giai-tri/nguoi-choi/them', methods=['POST'])
@admin_required
def them_nguoi_choi_giai_tri():
    user = session.get('user', {})
    name = (request.form.get('name') or '').strip()
    email = (request.form.get('email') or '').strip().lower()
    if not name:
        flash('Tên người chơi không được để trống.', 'warning')
        return redirect(url_for('giai_tri_nguoi_choi'))
    if email and VanDongVienModel.email_exists(email):
        flash('Email này đã tồn tại trong danh sách client.', 'warning')
        return redirect(url_for('giai_tri_nguoi_choi'))
    try:
        player_id = VanDongVienModel.create(name, 'C', email, '')
        DBLogger.log_user_action(
            user_email=user.get('email'),
            user_role=user.get('role'),
            action='CREATE_ENTERTAINMENT_PLAYER',
            route='/giai-tri/nguoi-choi/them',
            method='POST',
            status_code=302,
            details={'player_id': player_id, 'name': name, 'email': email},
        )
        flash('Đã thêm người chơi.', 'success')
    except Exception as e:
        DBLogger.log_error(f"Error creating entertainment player: {str(e)}", user.get('email'), '/giai-tri/nguoi-choi/them', context=traceback.format_exc())
        flash('Không thêm được người chơi.', 'danger')
    return redirect(url_for('giai_tri_nguoi_choi'))


@app.route('/giai-tri/nguoi-choi/<int:player_id>/sua', methods=['POST'])
@admin_required
def sua_nguoi_choi_giai_tri(player_id):
    user = session.get('user', {})
    name = (request.form.get('name') or '').strip()
    email = (request.form.get('email') or '').strip().lower()
    player = VanDongVienModel.get_by_id(player_id)
    if not player:
        flash('Không tìm thấy người chơi.', 'warning')
        return redirect(url_for('giai_tri_nguoi_choi'))
    if not name:
        flash('Tên người chơi không được để trống.', 'warning')
        return redirect(url_for('giai_tri_nguoi_choi'))
    if email and VanDongVienModel.email_exists(email, exclude_id=player_id):
        flash('Email này đã tồn tại trong danh sách client.', 'warning')
        return redirect(url_for('giai_tri_nguoi_choi'))
    try:
        VanDongVienModel.update(player_id, name, player[2] or 'C', email, player[4] or '')
        DBLogger.log_user_action(
            user_email=user.get('email'),
            user_role=user.get('role'),
            action='UPDATE_ENTERTAINMENT_PLAYER',
            route=f'/giai-tri/nguoi-choi/{player_id}/sua',
            method='POST',
            status_code=302,
            details={'player_id': player_id, 'name': name, 'email': email},
        )
        flash('Đã lưu người chơi.', 'success')
    except Exception as e:
        DBLogger.log_error(f"Error updating entertainment player: {str(e)}", user.get('email'), f'/giai-tri/nguoi-choi/{player_id}/sua', context=traceback.format_exc())
        flash('Không lưu được người chơi.', 'danger')
    return redirect(url_for('giai_tri_nguoi_choi'))


@app.route('/giai-tri/nguoi-choi/<int:player_id>/xoa', methods=['POST'])
@admin_required
def xoa_nguoi_choi_giai_tri(player_id):
    user = session.get('user', {})
    player = VanDongVienModel.get_by_id(player_id)
    if not player:
        flash('Không tìm thấy người chơi.', 'warning')
        return redirect(url_for('giai_tri_nguoi_choi'))
    try:
        VanDongVienModel.delete(player_id)
        DBLogger.log_user_action(
            user_email=user.get('email'),
            user_role=user.get('role'),
            action='DELETE_ENTERTAINMENT_PLAYER',
            route=f'/giai-tri/nguoi-choi/{player_id}/xoa',
            method='POST',
            status_code=302,
            details={'player_id': player_id, 'name': player[1]},
        )
        flash('Đã xóa người chơi.', 'success')
    except Exception as e:
        DBLogger.log_error(f"Error deleting entertainment player: {str(e)}", user.get('email'), f'/giai-tri/nguoi-choi/{player_id}/xoa', context=traceback.format_exc())
        flash('Không xóa được người chơi.', 'danger')
    return redirect(url_for('giai_tri_nguoi_choi'))


@app.route('/giai-tri/ghi-diem/tao', methods=['POST'])
@login_required
def tao_van_ghi_diem():
    user = session.get('user', {})
    name = request.form.get('name') or 'Ván bài mới'
    try:
        game_id = EntertainmentCardGameModel.create_game(
            name,
            owner_admin_id=user.get('id') if user.get('role') == 'admin' else None,
            created_by_role=user.get('role'),
            created_by_client_id=user.get('id') if user.get('role') == 'vdv' else None,
        )
        DBLogger.log_user_action(
            user_email=user.get('email'),
            user_role=user.get('role'),
            action='CREATE_ENTERTAINMENT_CARD_GAME',
            route='/giai-tri/ghi-diem/tao',
            method='POST',
            status_code=302,
            details={'game_id': game_id, 'name': name},
        )
        flash('Đã tạo ván ghi điểm.', 'success')
        return redirect(url_for('chi_tiet_van_ghi_diem', game_id=game_id))
    except Exception as e:
        DBLogger.log_error(f"Error creating entertainment card game: {str(e)}", user.get('email'), '/giai-tri/ghi-diem/tao', context=traceback.format_exc())
        flash('Không tạo được ván ghi điểm.', 'danger')
        return redirect(url_for('giai_tri_ghi_diem'))


def _can_delete_entertainment_game(user, game):
    if not game:
        return False
    if user.get('role') == 'admin':
        return True
    return user.get('role') == 'vdv' and game[5] == user.get('id')


@app.route('/giai-tri/ghi-diem/<int:game_id>/xoa', methods=['POST'])
@login_required
def xoa_van_ghi_diem(game_id):
    user = session.get('user', {})
    game = EntertainmentCardGameModel.get_game(game_id)
    if not game:
        flash('Không tìm thấy ván ghi điểm.', 'warning')
        return redirect(url_for('giai_tri_ghi_diem'))
    if not _can_delete_entertainment_game(user, game):
        flash('Bạn không có quyền xóa ván này.', 'danger')
        return redirect(url_for('giai_tri_ghi_diem'))
    try:
        EntertainmentCardGameModel.delete_game(game_id)
        DBLogger.log_user_action(
            user_email=user.get('email'),
            user_role=user.get('role'),
            action='DELETE_ENTERTAINMENT_CARD_GAME',
            route=f'/giai-tri/ghi-diem/{game_id}/xoa',
            method='POST',
            status_code=302,
            details={'game_id': game_id, 'name': game[1]},
        )
        flash('Đã xóa ván ghi điểm.', 'success')
    except Exception as e:
        DBLogger.log_error(f"Error deleting entertainment card game: {str(e)}", user.get('email'), f'/giai-tri/ghi-diem/{game_id}/xoa', context=traceback.format_exc())
        flash('Không xóa được ván ghi điểm.', 'danger')
        return redirect(url_for('giai_tri_ghi_diem'))


@app.route('/giai-tri/to-lieng')
@login_required
def giai_tri_to_lieng():
    user = session.get('user', {})
    DBLogger.log_request('GET', '/giai-tri/to-lieng', user.get('email'))
    games = EntertainmentLiengGameModel.get_games()
    return render_template('giai_tri_to_lieng.html', user=user, games=games)


@app.route('/giai-tri/to-lieng/tao', methods=['POST'])
@login_required
def tao_ban_to_lieng():
    user = session.get('user', {})
    try:
        active_table = EntertainmentLiengGameModel.active_table_for_user(user) or EntertainmentBaCayGameModel.active_table_for_user(user)
        if active_table:
            raise ValueError(f"Bạn đang ở bàn {active_table[1]}. Hãy thoát bàn đó trước khi tạo bàn khác.")
        game_id = EntertainmentLiengGameModel.create_game(
            request.form.get('name'),
            request.form.get('min_bet'),
            request.form.get('max_bet'),
            owner_admin_id=user.get('id') if user.get('role') == 'admin' else None,
            created_by_role=user.get('role'),
            created_by_client_id=user.get('id') if user.get('role') == 'vdv' else None,
        )
        EntertainmentLiengGameModel.add_current_user(game_id, user)
        flash('Đã tạo bàn tố liêng.', 'success')
        return redirect(url_for('chi_tiet_ban_to_lieng', game_id=game_id))
    except Exception as e:
        DBLogger.log_error(f"Error creating lieng game: {str(e)}", user.get('email'), '/giai-tri/to-lieng/tao', context=traceback.format_exc())
        flash(str(e) if isinstance(e, ValueError) else 'Không tạo được bàn tố liêng.', 'danger')
        return redirect(url_for('giai_tri_to_lieng'))


@app.route('/giai-tri/to-lieng/<int:game_id>')
@login_required
def chi_tiet_ban_to_lieng(game_id):
    user = session.get('user', {})
    EntertainmentLiengGameModel.apply_timeout_if_needed(game_id)
    game = EntertainmentLiengGameModel.get_game(game_id)
    if not game:
        return "Không tìm thấy bàn tố liêng", 404
    participants = EntertainmentLiengGameModel.get_participants(game_id)
    scoreboard = EntertainmentLiengGameModel.get_scoreboard(game_id)
    actions = EntertainmentLiengGameModel.get_actions(game_id)
    my_participant_id = EntertainmentLiengGameModel.participant_for_user(game_id, user)
    turn_left = EntertainmentLiengGameModel.TURN_SECONDS
    if game[2] == 'playing' and game[8]:
        try:
            turn_left = max(0, EntertainmentLiengGameModel.TURN_SECONDS - int((datetime.now(game[8].tzinfo) - game[8]).total_seconds()))
        except Exception:
            turn_left = EntertainmentLiengGameModel.TURN_SECONDS
    showdown_players = [player for player in participants if not player[7]]
    can_claim_showdown_win = bool(game[2] == 'showdown' and my_participant_id and any(player[0] == my_participant_id for player in showdown_players))
    required_bet = EntertainmentLiengGameModel.required_bet_for_turn(game_id, my_participant_id) or game[3]
    final_view = request.args.get('ket_thuc') == '1' or game[2] == 'ended'
    return render_template(
        'giai_tri_to_lieng_chi_tiet.html',
        user=user,
        game=game,
        participants=participants,
        scoreboard=scoreboard,
        showdown_players=showdown_players,
        can_claim_showdown_win=can_claim_showdown_win,
        actions=actions,
        my_participant_id=my_participant_id,
        required_bet=required_bet,
        final_view=final_view,
        turn_seconds=EntertainmentLiengGameModel.TURN_SECONDS,
        turn_left=turn_left,
    )


def _lieng_state_payload(game_id, user):
    EntertainmentLiengGameModel.apply_timeout_if_needed(game_id)
    game = EntertainmentLiengGameModel.get_game(game_id)
    if not game:
        return None
    participants = EntertainmentLiengGameModel.get_participants(game_id)
    actions = EntertainmentLiengGameModel.get_actions(game_id, limit=1)
    my_participant_id = EntertainmentLiengGameModel.participant_for_user(game_id, user)
    latest_action_id = actions[0][0] if actions else 0
    turn_left = EntertainmentLiengGameModel.TURN_SECONDS
    if game[2] == 'playing' and game[8]:
        try:
            turn_left = max(0, EntertainmentLiengGameModel.TURN_SECONDS - int((datetime.now(game[8].tzinfo) - game[8]).total_seconds()))
        except Exception:
            turn_left = EntertainmentLiengGameModel.TURN_SECONDS
    return {
        'success': True,
        'game_id': game_id,
        'status': game[2],
        'pot': game[5],
        'round_no': game[6],
        'current_turn_participant_id': game[7],
        'my_participant_id': my_participant_id,
        'is_my_turn': bool(my_participant_id and my_participant_id == game[7] and game[2] == 'playing'),
        'turn_left': turn_left,
        'latest_action_id': latest_action_id,
        'participants': [
            {
                'id': p[0],
                'name': p[1],
                'seat_no': p[5],
                'folded': bool(p[7]),
                'current_bet': p[8],
                'score': p[9],
            }
            for p in participants
        ],
    }


@app.route('/giai-tri/to-lieng/<int:game_id>/state')
@login_required
def state_ban_to_lieng(game_id):
    user = session.get('user', {})
    try:
        payload = _lieng_state_payload(game_id, user)
        if not payload:
            return jsonify({'success': False, 'error': 'Không tìm thấy bàn tố liêng'}), 404
        response = make_response(jsonify(payload))
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        return response
    except Exception as e:
        DBLogger.log_error(f"Error loading lieng state: {str(e)}", user.get('email'), f'/giai-tri/to-lieng/{game_id}/state', context=traceback.format_exc())
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/giai-tri/to-lieng/<int:game_id>/xoa', methods=['POST'])
@login_required
def xoa_ban_to_lieng(game_id):
    user = session.get('user', {})
    game = EntertainmentLiengGameModel.get_game(game_id)
    if not game:
        flash('Không tìm thấy bàn tố liêng.', 'warning')
        return redirect(url_for('giai_tri_to_lieng'))
    if user.get('role') != 'admin' and not (user.get('role') == 'vdv' and game[11] == user.get('id')):
        flash('Bạn không có quyền xóa bàn này.', 'danger')
        return redirect(url_for('giai_tri_to_lieng'))
    EntertainmentLiengGameModel.delete_game(game_id)
    flash('Đã xóa bàn tố liêng.', 'success')
    return redirect(url_for('giai_tri_to_lieng'))


@app.route('/giai-tri/to-lieng/<int:game_id>/ket-thuc', methods=['POST'])
@login_required
def ket_thuc_ban_to_lieng(game_id):
    try:
        EntertainmentLiengGameModel.end_game(game_id)
        flash('Đã kết thúc bàn tố liêng.', 'success')
        return redirect(url_for('chi_tiet_ban_to_lieng', game_id=game_id, ket_thuc=1))
    except ValueError as e:
        flash(str(e), 'warning')
    return redirect(url_for('chi_tiet_ban_to_lieng', game_id=game_id))


@app.route('/giai-tri/to-lieng/<int:game_id>/them-toi', methods=['POST'])
@login_required
def them_toi_vao_to_lieng(game_id):
    user = session.get('user', {})
    try:
        active_ba_cay = EntertainmentBaCayGameModel.active_table_for_user(user)
        if active_ba_cay:
            raise ValueError(f"Bạn đang ở bàn {active_ba_cay[1]}. Hãy thoát bàn đó trước khi vào bàn khác.")
        EntertainmentLiengGameModel.add_current_user(game_id, user)
        flash('Đã thêm bạn vào bàn.', 'success')
    except ValueError as e:
        flash(str(e), 'warning')
    return redirect(url_for('chi_tiet_ban_to_lieng', game_id=game_id))


@app.route('/giai-tri/to-lieng/<int:game_id>/thoat-ban', methods=['POST'])
@login_required
def thoat_ban_to_lieng(game_id):
    user = session.get('user', {})
    try:
        display_name = EntertainmentLiengGameModel.leave_current_user(game_id, user)
        flash(f'{display_name} đã thoát bàn.', 'success')
    except ValueError as e:
        flash(str(e), 'warning')
    return redirect(url_for('chi_tiet_ban_to_lieng', game_id=game_id))


@app.route('/giai-tri/to-lieng/<int:game_id>/nguoi-choi', methods=['POST'])
@login_required
def them_nguoi_choi_to_lieng(game_id):
    flash('Bàn tố liêng chỉ cho từng người tự thêm mình vào bàn.', 'warning')
    return redirect(url_for('chi_tiet_ban_to_lieng', game_id=game_id))


@app.route('/giai-tri/to-lieng/<int:game_id>/quay-vi-tri', methods=['POST'])
@login_required
def quay_vi_tri_to_lieng(game_id):
    count = EntertainmentLiengGameModel.shuffle_seats(game_id)
    flash(f'Đã quay ngẫu nhiên vị trí cho {count} người chơi.', 'success')
    return redirect(url_for('chi_tiet_ban_to_lieng', game_id=game_id))


@app.route('/giai-tri/to-lieng/<int:game_id>/bat-dau', methods=['POST'])
@login_required
def bat_dau_to_lieng(game_id):
    try:
        round_no = EntertainmentLiengGameModel.start_round(game_id)
        flash(f'Đã bắt đầu ván {round_no}. Mỗi người bị trừ min cược vào pot.', 'success')
    except ValueError as e:
        flash(str(e), 'warning')
    return redirect(url_for('chi_tiet_ban_to_lieng', game_id=game_id))


@app.route('/giai-tri/to-lieng/<int:game_id>/hanh-dong', methods=['POST'])
@login_required
def hanh_dong_to_lieng(game_id):
    user = session.get('user', {})
    participant_id = EntertainmentLiengGameModel.participant_for_user(game_id, user)
    if not participant_id:
        flash('Bạn chưa có trong bàn này.', 'danger')
        return redirect(url_for('chi_tiet_ban_to_lieng', game_id=game_id))
    try:
        EntertainmentLiengGameModel.act(
            game_id,
            participant_id,
            request.form.get('action_type'),
            request.form.get('amount'),
        )
        flash('Đã ghi hành động.', 'success')
    except ValueError as e:
        flash(str(e), 'warning')
    return redirect(url_for('chi_tiet_ban_to_lieng', game_id=game_id))


@app.route('/giai-tri/to-lieng/<int:game_id>/toi-thang', methods=['POST'])
@login_required
def toi_thang_to_lieng(game_id):
    user = session.get('user', {})
    participant_id = EntertainmentLiengGameModel.participant_for_user(game_id, user)
    if not participant_id:
        flash('Bạn chưa có trong bàn này.', 'danger')
        return redirect(url_for('chi_tiet_ban_to_lieng', game_id=game_id))
    try:
        winner_name, pot = EntertainmentLiengGameModel.declare_winner(game_id, participant_id)
        flash(f'{winner_name} đã thắng pot {pot}.', 'success')
    except ValueError as e:
        flash(str(e), 'warning')
    return redirect(url_for('chi_tiet_ban_to_lieng', game_id=game_id))


@app.route('/giai-tri/ba-cay')
@login_required
def giai_tri_ba_cay():
    user = session.get('user', {})
    DBLogger.log_request('GET', '/giai-tri/ba-cay', user.get('email'))
    games = EntertainmentBaCayGameModel.get_games()
    return render_template('giai_tri_ba_cay.html', user=user, games=games)


@app.route('/giai-tri/ba-cay/tao', methods=['POST'])
@login_required
def tao_ban_ba_cay():
    user = session.get('user', {})
    try:
        active_table = EntertainmentBaCayGameModel.active_table_for_user(user) or EntertainmentLiengGameModel.active_table_for_user(user)
        if active_table:
            raise ValueError(f"Bạn đang ở bàn {active_table[1]}. Hãy thoát bàn đó trước khi tạo bàn khác.")
        game_id = EntertainmentBaCayGameModel.create_game(
            request.form.get('name'),
            request.form.get('min_bet'),
            request.form.get('max_bet'),
            owner_admin_id=user.get('id') if user.get('role') == 'admin' else None,
            created_by_role=user.get('role'),
            created_by_client_id=user.get('id') if user.get('role') == 'vdv' else None,
        )
        EntertainmentBaCayGameModel.add_current_user(game_id, user)
        flash('Đã tạo bàn 3 cây.', 'success')
        return redirect(url_for('chi_tiet_ban_ba_cay', game_id=game_id))
    except Exception as e:
        DBLogger.log_error(f"Error creating ba cay game: {str(e)}", user.get('email'), '/giai-tri/ba-cay/tao', context=traceback.format_exc())
        flash(str(e) if isinstance(e, ValueError) else 'Không tạo được bàn 3 cây.', 'danger')
        return redirect(url_for('giai_tri_ba_cay'))


@app.route('/giai-tri/ba-cay/<int:game_id>')
@login_required
def chi_tiet_ban_ba_cay(game_id):
    user = session.get('user', {})
    EntertainmentBaCayGameModel.apply_timeout_if_needed(game_id)
    game = EntertainmentBaCayGameModel.get_game(game_id)
    if not game:
        return "Không tìm thấy bàn 3 cây", 404
    participants = EntertainmentBaCayGameModel.get_participants(game_id)
    scoreboard = EntertainmentBaCayGameModel.get_scoreboard(game_id)
    actions = EntertainmentBaCayGameModel.get_actions(game_id)
    my_participant_id = EntertainmentBaCayGameModel.participant_for_user(game_id, user)
    bet_left = EntertainmentBaCayGameModel.BET_SECONDS
    if game[2] == 'betting' and game[7]:
        try:
            bet_left = max(0, int((game[7] - datetime.now(game[7].tzinfo)).total_seconds()))
        except Exception:
            bet_left = EntertainmentBaCayGameModel.BET_SECONDS
    final_view = request.args.get('ket_thuc') == '1' or game[2] == 'ended'
    bettors = [p for p in participants if p[0] != game[6] and p[8] and p[7] > 0]
    return render_template(
        'giai_tri_ba_cay_chi_tiet.html',
        user=user,
        game=game,
        participants=participants,
        scoreboard=scoreboard,
        actions=actions,
        my_participant_id=my_participant_id,
        bet_left=bet_left,
        bet_seconds=EntertainmentBaCayGameModel.BET_SECONDS,
        final_view=final_view,
        bettors=bettors,
    )


def _ba_cay_state_payload(game_id, user):
    EntertainmentBaCayGameModel.apply_timeout_if_needed(game_id)
    game = EntertainmentBaCayGameModel.get_game(game_id)
    if not game:
        return None
    participants = EntertainmentBaCayGameModel.get_participants(game_id)
    actions = EntertainmentBaCayGameModel.get_actions(game_id, limit=1)
    my_participant_id = EntertainmentBaCayGameModel.participant_for_user(game_id, user)
    latest_action_id = actions[0][0] if actions else 0
    bet_left = EntertainmentBaCayGameModel.BET_SECONDS
    if game[2] == 'betting' and game[7]:
        try:
            bet_left = max(0, int((game[7] - datetime.now(game[7].tzinfo)).total_seconds()))
        except Exception:
            bet_left = EntertainmentBaCayGameModel.BET_SECONDS
    return {
        'success': True,
        'game_id': game_id,
        'status': game[2],
        'round_no': game[5],
        'banker_participant_id': game[6],
        'my_participant_id': my_participant_id,
        'is_my_bet_turn': bool(my_participant_id and game[2] == 'betting' and my_participant_id != game[6]),
        'bet_left': bet_left,
        'latest_action_id': latest_action_id,
        'participants': [
            {
                'id': p[0],
                'name': p[1],
                'seat_no': p[5],
                'active': bool(p[6]),
                'current_bet': p[7],
                'bet_submitted': bool(p[8]),
                'current_multiplier': p[9],
                'score': p[10],
            }
            for p in participants
        ],
    }


@app.route('/giai-tri/ba-cay/<int:game_id>/state')
@login_required
def state_ban_ba_cay(game_id):
    user = session.get('user', {})
    try:
        payload = _ba_cay_state_payload(game_id, user)
        if not payload:
            return jsonify({'success': False, 'error': 'Không tìm thấy bàn 3 cây'}), 404
        response = make_response(jsonify(payload))
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        return response
    except Exception as e:
        DBLogger.log_error(f"Error loading ba cay state: {str(e)}", user.get('email'), f'/giai-tri/ba-cay/{game_id}/state', context=traceback.format_exc())
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/giai-tri/ba-cay/<int:game_id>/xoa', methods=['POST'])
@login_required
def xoa_ban_ba_cay(game_id):
    user = session.get('user', {})
    game = EntertainmentBaCayGameModel.get_game(game_id)
    if not game:
        flash('Không tìm thấy bàn 3 cây.', 'warning')
        return redirect(url_for('giai_tri_ba_cay'))
    if user.get('role') != 'admin' and not (user.get('role') == 'vdv' and game[10] == user.get('id')):
        flash('Bạn không có quyền xóa bàn này.', 'danger')
        return redirect(url_for('giai_tri_ba_cay'))
    EntertainmentBaCayGameModel.delete_game(game_id)
    flash('Đã xóa bàn 3 cây.', 'success')
    return redirect(url_for('giai_tri_ba_cay'))


@app.route('/giai-tri/ba-cay/<int:game_id>/ket-thuc', methods=['POST'])
@login_required
def ket_thuc_ban_ba_cay(game_id):
    try:
        EntertainmentBaCayGameModel.end_game(game_id)
        flash('Đã kết thúc bàn 3 cây.', 'success')
        return redirect(url_for('chi_tiet_ban_ba_cay', game_id=game_id, ket_thuc=1))
    except ValueError as e:
        flash(str(e), 'warning')
    return redirect(url_for('chi_tiet_ban_ba_cay', game_id=game_id))


@app.route('/giai-tri/ba-cay/<int:game_id>/them-toi', methods=['POST'])
@login_required
def them_toi_vao_ba_cay(game_id):
    user = session.get('user', {})
    try:
        active_lieng = EntertainmentLiengGameModel.active_table_for_user(user)
        if active_lieng:
            raise ValueError(f"Bạn đang ở bàn {active_lieng[1]}. Hãy thoát bàn đó trước khi vào bàn khác.")
        EntertainmentBaCayGameModel.add_current_user(game_id, user)
        flash('Đã thêm bạn vào bàn.', 'success')
    except ValueError as e:
        flash(str(e), 'warning')
    return redirect(url_for('chi_tiet_ban_ba_cay', game_id=game_id))


@app.route('/giai-tri/ba-cay/<int:game_id>/thoat-ban', methods=['POST'])
@login_required
def thoat_ban_ba_cay(game_id):
    user = session.get('user', {})
    try:
        display_name = EntertainmentBaCayGameModel.leave_current_user(game_id, user)
        flash(f'{display_name} đã thoát bàn.', 'success')
    except ValueError as e:
        flash(str(e), 'warning')
    return redirect(url_for('chi_tiet_ban_ba_cay', game_id=game_id))


@app.route('/giai-tri/ba-cay/<int:game_id>/quay-vi-tri', methods=['POST'])
@login_required
def quay_vi_tri_ba_cay(game_id):
    count = EntertainmentBaCayGameModel.shuffle_seats(game_id)
    flash(f'Đã quay ngẫu nhiên vị trí cho {count} người chơi.', 'success')
    return redirect(url_for('chi_tiet_ban_ba_cay', game_id=game_id))


@app.route('/giai-tri/ba-cay/<int:game_id>/quay-chuong', methods=['POST'])
@login_required
def quay_chuong_ba_cay(game_id):
    try:
        banker_name = EntertainmentBaCayGameModel.random_banker(game_id)
        flash(f'{banker_name} làm chương.', 'success')
    except ValueError as e:
        flash(str(e), 'warning')
    return redirect(url_for('chi_tiet_ban_ba_cay', game_id=game_id))


@app.route('/giai-tri/ba-cay/<int:game_id>/chon-chuong', methods=['POST'])
@login_required
def chon_chuong_ba_cay(game_id):
    user = session.get('user', {})
    participant_id = EntertainmentBaCayGameModel.participant_for_user(game_id, user)
    if not participant_id:
        flash('Bạn chưa có trong bàn này.', 'danger')
        return redirect(url_for('chi_tiet_ban_ba_cay', game_id=game_id))
    try:
        banker_name = EntertainmentBaCayGameModel.set_banker(game_id, participant_id, int(request.form.get('banker_participant_id')))
        flash(f'{banker_name} làm chương.', 'success')
    except (TypeError, ValueError) as e:
        flash(str(e), 'warning')
    return redirect(url_for('chi_tiet_ban_ba_cay', game_id=game_id))


@app.route('/giai-tri/ba-cay/<int:game_id>/bat-dau', methods=['POST'])
@login_required
def bat_dau_ba_cay(game_id):
    user = session.get('user', {})
    participant_id = EntertainmentBaCayGameModel.participant_for_user(game_id, user)
    if not participant_id:
        flash('Bạn chưa có trong bàn này.', 'danger')
        return redirect(url_for('chi_tiet_ban_ba_cay', game_id=game_id))
    try:
        round_no = EntertainmentBaCayGameModel.start_round(game_id, participant_id)
        flash(f'Đã bắt đầu ván {round_no}. Mọi người có 20 giây để đặt cược.', 'success')
    except ValueError as e:
        flash(str(e), 'warning')
    return redirect(url_for('chi_tiet_ban_ba_cay', game_id=game_id))


@app.route('/giai-tri/ba-cay/<int:game_id>/dat-cuoc', methods=['POST'])
@login_required
def dat_cuoc_ba_cay(game_id):
    user = session.get('user', {})
    participant_id = EntertainmentBaCayGameModel.participant_for_user(game_id, user)
    if not participant_id:
        flash('Bạn chưa có trong bàn này.', 'danger')
        return redirect(url_for('chi_tiet_ban_ba_cay', game_id=game_id))
    try:
        EntertainmentBaCayGameModel.place_bet(game_id, participant_id, request.form.get('amount'), request.form.get('multiplier'))
        flash('Đã đặt cược.', 'success')
    except ValueError as e:
        flash(str(e), 'warning')
    return redirect(url_for('chi_tiet_ban_ba_cay', game_id=game_id))


@app.route('/giai-tri/ba-cay/<int:game_id>/chot-van', methods=['POST'])
@login_required
def chot_van_ba_cay(game_id):
    user = session.get('user', {})
    participant_id = EntertainmentBaCayGameModel.participant_for_user(game_id, user)
    if not participant_id:
        flash('Bạn chưa có trong bàn này.', 'danger')
        return redirect(url_for('chi_tiet_ban_ba_cay', game_id=game_id))
    try:
        participants = EntertainmentBaCayGameModel.get_participants(game_id)
        results = {}
        banker_multipliers = {}
        for player in participants:
            if player[0] == participant_id:
                continue
            value = request.form.get(f'result_{player[0]}')
            if value in ('win', 'lose'):
                results[player[0]] = value
                banker_multipliers[player[0]] = request.form.get(f'banker_multiplier_{player[0]}')
        settled_count = EntertainmentBaCayGameModel.settle_round(game_id, participant_id, results, banker_multipliers)
        flash(f'Đã chốt {settled_count} người. Ván đã kết thúc, chờ bấm bắt đầu ván mới.', 'success')
    except ValueError as e:
        flash(str(e), 'warning')
    return redirect(url_for('chi_tiet_ban_ba_cay', game_id=game_id))


@app.route('/giai-tri/ghi-diem/<int:game_id>')
@login_required
def chi_tiet_van_ghi_diem(game_id):
    user = session.get('user', {})
    game = EntertainmentCardGameModel.get_game(game_id)
    if not game:
        return "Không tìm thấy ván ghi điểm", 404
    players = EntertainmentCardGameModel.get_players(game_id)
    available_clients = EntertainmentCardGameModel.get_available_clients(game_id)
    scoreboard = EntertainmentCardGameModel.get_scoreboard(game_id)
    rounds = EntertainmentCardGameModel.get_rounds(game_id)
    final_view = request.args.get('ket_thuc') == '1'
    return render_template(
        'giai_tri_ghi_diem_chi_tiet.html',
        user=user,
        game=game,
        players=players,
        available_clients=available_clients,
        scoreboard=scoreboard,
        rounds=rounds,
        final_view=final_view,
    )


@app.route('/giai-tri/ghi-diem/<int:game_id>/nguoi-choi', methods=['POST'])
@login_required
def them_nguoi_choi_ghi_diem(game_id):
    user = session.get('user', {})
    game = EntertainmentCardGameModel.get_game(game_id)
    if not game:
        return "Không tìm thấy ván ghi điểm", 404
    if game[2] == 'ended':
        flash('Ván đã kết thúc, không thêm người chơi mới được.', 'warning')
        return redirect(url_for('chi_tiet_van_ghi_diem', game_id=game_id))
    try:
        client_ids = [item for item in request.form.getlist('client_ids') if item]
        if not client_ids:
            flash('Chọn ít nhất một người chơi trong danh sách client.', 'warning')
            return redirect(url_for('chi_tiet_van_ghi_diem', game_id=game_id))

        added_player_ids = []
        for client_id in client_ids:
            added_player_ids.append(EntertainmentCardGameModel.add_player_from_client(game_id, int(client_id)))
        DBLogger.log_user_action(
            user_email=user.get('email'),
            user_role=user.get('role'),
            action='ADD_ENTERTAINMENT_CARD_PLAYER',
            route=f'/giai-tri/ghi-diem/{game_id}/nguoi-choi',
            method='POST',
            status_code=302,
            details={'game_id': game_id, 'client_ids': client_ids, 'player_ids': added_player_ids},
        )
        flash(f'Đã thêm {len(added_player_ids)} người chơi.', 'success')
    except ValueError as e:
        flash(str(e), 'warning')
    except Exception as e:
        DBLogger.log_error(f"Error adding entertainment player: {str(e)}", user.get('email'), f'/giai-tri/ghi-diem/{game_id}/nguoi-choi', context=traceback.format_exc())
        flash('Không thêm được người chơi.', 'danger')
    return redirect(url_for('chi_tiet_van_ghi_diem', game_id=game_id))


@app.route('/giai-tri/ghi-diem/<int:game_id>/nguoi-choi/<int:player_id>/roi-van', methods=['POST'])
@login_required
def roi_van_nguoi_choi_ghi_diem(game_id, player_id):
    user = session.get('user', {})
    game = EntertainmentCardGameModel.get_game(game_id)
    if not game:
        return "Không tìm thấy ván ghi điểm", 404
    if game[2] == 'ended':
        flash('Ván đã kết thúc, không thể thay đổi người chơi.', 'warning')
        return redirect(url_for('chi_tiet_van_ghi_diem', game_id=game_id))
    try:
        updated = EntertainmentCardGameModel.deactivate_player(game_id, player_id)
        if updated:
            DBLogger.log_user_action(
                user_email=user.get('email'),
                user_role=user.get('role'),
                action='DEACTIVATE_ENTERTAINMENT_CARD_PLAYER',
                route=f'/giai-tri/ghi-diem/{game_id}/nguoi-choi/{player_id}/roi-van',
                method='POST',
                status_code=302,
                details={'game_id': game_id, 'player_id': player_id},
            )
            flash('Đã bỏ người chơi khỏi các trận mới. Điểm cũ vẫn được giữ trong lịch sử.', 'success')
        else:
            flash('Không tìm thấy người chơi đang active trong ván.', 'warning')
    except Exception as e:
        DBLogger.log_error(f"Error deactivating entertainment player: {str(e)}", user.get('email'), f'/giai-tri/ghi-diem/{game_id}/nguoi-choi/{player_id}/roi-van', context=traceback.format_exc())
        flash('Không bỏ được người chơi khỏi ván.', 'danger')
    return redirect(url_for('chi_tiet_van_ghi_diem', game_id=game_id))


@app.route('/giai-tri/ghi-diem/<int:game_id>/tran', methods=['POST'])
@login_required
def ghi_diem_tran_bai(game_id):
    user = session.get('user', {})
    game = EntertainmentCardGameModel.get_game(game_id)
    if not game:
        return "Không tìm thấy ván ghi điểm", 404
    if game[2] == 'ended':
        flash('Ván đã kết thúc, không thể ghi thêm điểm.', 'warning')
        return redirect(url_for('chi_tiet_van_ghi_diem', game_id=game_id))

    players = EntertainmentCardGameModel.get_players(game_id)
    scores = {player[0]: request.form.get(f'score_{player[0]}', 0) for player in players}
    try:
        round_id, round_no = EntertainmentCardGameModel.add_round(
            game_id,
            scores,
            note=request.form.get('note'),
        )
        DBLogger.log_user_action(
            user_email=user.get('email'),
            user_role=user.get('role'),
            action='ADD_ENTERTAINMENT_CARD_ROUND',
            route=f'/giai-tri/ghi-diem/{game_id}/tran',
            method='POST',
            status_code=302,
            details={'game_id': game_id, 'round_id': round_id, 'round_no': round_no, 'scores': scores},
        )
        flash(f'Đã ghi điểm trận {round_no}.', 'success')
    except ValueError as e:
        flash(str(e), 'warning')
    except Exception as e:
        DBLogger.log_error(f"Error adding entertainment round: {str(e)}", user.get('email'), f'/giai-tri/ghi-diem/{game_id}/tran', context=traceback.format_exc())
        flash('Không ghi được điểm trận này.', 'danger')
    return redirect(url_for('chi_tiet_van_ghi_diem', game_id=game_id))


@app.route('/giai-tri/ghi-diem/<int:game_id>/chon-nguoi-danh-truoc', methods=['POST'])
@login_required
def chon_nguoi_danh_truoc(game_id):
    game = EntertainmentCardGameModel.get_game(game_id)
    if not game:
        return "Không tìm thấy ván ghi điểm", 404
    players = EntertainmentCardGameModel.get_players(game_id)
    if not players:
        flash('Cần thêm người chơi trước khi xúc xắc.', 'warning')
    else:
        chosen = random.choice(players)
        flash(f'Xúc xắc chọn: {chosen[1]} đánh trước.', 'success')
    return redirect(url_for('chi_tiet_van_ghi_diem', game_id=game_id))


@app.route('/giai-tri/ghi-diem/<int:game_id>/ket-thuc', methods=['POST'])
@login_required
def ket_thuc_van_ghi_diem(game_id):
    user = session.get('user', {})
    game = EntertainmentCardGameModel.get_game(game_id)
    if not game:
        return "Không tìm thấy ván ghi điểm", 404
    EntertainmentCardGameModel.end_game(game_id)
    DBLogger.log_user_action(
        user_email=user.get('email'),
        user_role=user.get('role'),
        action='END_ENTERTAINMENT_CARD_GAME',
        route=f'/giai-tri/ghi-diem/{game_id}/ket-thuc',
        method='POST',
        status_code=302,
        details={'game_id': game_id},
    )
    return redirect(url_for('chi_tiet_van_ghi_diem', game_id=game_id, ket_thuc=1))


@app.route('/giai-tri/ta-la')
@login_required
def legacy_ta_la_redirect():
    return redirect(url_for('giai_tri_to_lieng'))


@app.route('/giai-dau')
@login_required
def quan_ly_giai_dau():
    """Trang chủ admin"""
    user = session.get('user', {})
    DBLogger.log_request('GET', '/giai-dau', user.get('email'))

    if user.get('role') != 'admin':
        return redirect(url_for('vdv_dashboard'))

    try:
        scope_admin_id = _admin_scope_id(user)
        with db_cursor() as cursor:
            if scope_admin_id:
                cursor.execute("""
                    SELECT g.id, g.ten_giai_dau, g.so_luong_san, g.dia_diem,
                           g.chi_phi_san_bai, g.chi_phi_nuoc_noi, g.chi_phi_giai_thuong, g.chi_phi_khac,
                           g.ty_le_giai_1, g.ty_le_giai_2, g.ty_le_giai_3, g.so_nguoi_du_kien,
                           g.thoi_gian_bat_dau, g.banner_image, g.qr_image,
                           COUNT(dkg.id) as so_luong_nguoi
                    FROM giai_dau g
                    LEFT JOIN dang_ky_giai dkg ON g.id = dkg.giai_dau_id
                    LEFT JOIN giai_dau_admin_quyen q ON g.id = q.giai_dau_id AND q.admin_id = %s
                    WHERE g.owner_admin_id = %s OR q.admin_id IS NOT NULL
                    GROUP BY g.id
                    ORDER BY g.id DESC;
                """, (scope_admin_id, scope_admin_id))
            else:
                cursor.execute("""
                    SELECT g.id, g.ten_giai_dau, g.so_luong_san, g.dia_diem,
                           g.chi_phi_san_bai, g.chi_phi_nuoc_noi, g.chi_phi_giai_thuong, g.chi_phi_khac,
                           g.ty_le_giai_1, g.ty_le_giai_2, g.ty_le_giai_3, g.so_nguoi_du_kien,
                           g.thoi_gian_bat_dau, g.banner_image, g.qr_image,
                           COUNT(dkg.id) as so_luong_nguoi
                    FROM giai_dau g
                    LEFT JOIN dang_ky_giai dkg ON g.id = dkg.giai_dau_id
                    GROUP BY g.id
                    ORDER BY g.id DESC;
                """)
            rows = cursor.fetchall()

        danh_sach_giai = []
        registrations_by_tournament = DangKyGiaiModel.get_by_tournaments([row[0] for row in rows])
        for row in rows:
            try:
                giai_raw = tuple(row[:15])
                registrations = registrations_by_tournament.get(row[0], [])
                giai_detail = prepare_tournament_detail(giai_raw, registrations)
                danh_sach_giai.append(giai_detail)
            except Exception as e:
                error_msg = f"Error loading tournament {row[0]}: {str(e)}"
                DBLogger.log_error(error_msg, user.get('email'), '/giai-dau', context=traceback.format_exc())
                continue

        return render_template('index.html', danh_sach_giai=danh_sach_giai)
    except Exception as e:
        DBLogger.log_error(f"Error loading tournaments: {str(e)}", user.get('email'), '/giai-dau', context=traceback.format_exc())
        return f"❌ Error: {str(e)}", 500

# ============ LOGGING VIEWER (ADMIN ONLY) ============

@app.route('/logs')
@admin_required
def view_logs():
    """View application logs"""
    try:
        filter_level = request.args.get('level')  # ERROR, SUCCESS, etc
        filter_days = int(request.args.get('days', 1))

        # Get logs
        if filter_level:
            logs = DBLogViewer.get_recent_logs(limit=100, level=filter_level)
        else:
            logs = DBLogViewer.get_recent_logs(limit=100)

        # Get stats
        stats = DBLogViewer.get_log_stats()

        # Get today's errors count
        errors_today = DBLogViewer.get_errors_today()

        return render_template('logs_viewer.html',
                             logs=logs,
                             stats=stats,
                             errors_count=len(errors_today),
                             filter_level=filter_level,
                             enumerate=enumerate)
    except Exception as e:
        user = session.get('user', {})
        DBLogger.log_error(f"Error viewing logs: {str(e)}", user.get('email'), '/logs')
        return f"❌ Error: {str(e)}", 500

@app.route('/logs-api/errors-today')
@admin_required
def api_errors_today():
    """API endpoint for errors today"""
    try:
        errors = DBLogViewer.get_errors_today()
        return jsonify({
            'count': len(errors),
            'errors': [{'message': e[1], 'user': e[2], 'route': e[3], 'time': str(e[4])} for e in errors]
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/logs-api/user-actions/<email>')
@admin_required
def api_user_actions(email):
    """API endpoint for specific user actions"""
    try:
        actions = DBLogViewer.get_user_actions(email)
        return jsonify({
            'user': email,
            'actions': [{'level': a[1], 'message': a[2], 'route': a[3], 'time': str(a[4])} for a in actions]
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ============ VĐV MANAGEMENT (ADMIN) ============

def _safe_vdv_return_to(default='/'):
    return_to = (request.values.get('return_to') or default).strip()
    if return_to in ('/', '/giai-dau', '/doi-bong', '/giai-tri'):
        return return_to
    if return_to.startswith('/giai-dau/') or return_to.startswith('/doi-bong/') or return_to.startswith('/giai-tri/'):
        return return_to
    return default


def _vdv_return_context():
    return_to = _safe_vdv_return_to()
    if return_to.startswith('/giai-dau'):
        return_label = 'Giải đấu'
    elif return_to.startswith('/doi-bong'):
        return_label = 'Quản lý đội bóng'
    elif return_to.startswith('/giai-tri'):
        return_label = 'Giải trí'
    else:
        return_label = 'Trang chủ'
    return {
        'return_to': return_to,
        'return_label': return_label,
        'vdv_list_url': url_for('van_dong_vien_list', return_to=return_to),
    }


@app.route('/van-dong-vien')
@admin_required
def van_dong_vien_list():
    """Danh sách VĐV"""
    user = session.get('user', {})
    try:
        vdv_list = VanDongVienModel.get_all()
        DBLogger.log_request('GET', '/van-dong-vien', user.get('email'))
        return render_template('van_dong_vien.html', vdv_list=vdv_list, **_vdv_return_context())
    except Exception as e:
        DBLogger.log_error(f"Error loading VĐV list: {str(e)}", user.get('email'), '/van-dong-vien', context=traceback.format_exc())
        return f"❌ Error: {str(e)}", 500

@app.route('/van-dong-vien/them', methods=['GET', 'POST'])
@admin_required
def them_van_dong_vien():
    """Thêm VĐV mới"""
    user = session.get('user', {})
    try:
        return_context = _vdv_return_context()
        if request.method == 'GET':
            return render_template('them_van_dong_vien.html', form_data={}, errors=[], **return_context)

        form_data, errors = normalize_vdv_form(request.form)
        if not errors and VanDongVienModel.email_exists(form_data['email']):
            errors.append("Email đã được dùng cho VĐV khác.")
        if errors:
            return render_template('them_van_dong_vien.html', form_data=form_data, errors=errors, **return_context), 400

        ten_vdv = form_data['ten_vdv']
        trinh_do = form_data['trinh_do']
        email = form_data['email']
        ghi_chu = form_data['ghi_chu']

        VanDongVienModel.create(ten_vdv, trinh_do, email, ghi_chu)
        DBLogger.log_success(f"VĐV created: {ten_vdv}", user.get('email'), '/van-dong-vien/them')
        return redirect(return_context['vdv_list_url'])
    except Exception as e:
        DBLogger.log_error(f"Error creating VĐV: {str(e)}", user.get('email'), '/van-dong-vien/them', context=traceback.format_exc())
        return f"❌ Error: {str(e)}", 500

@app.route('/van-dong-vien/<int:vdv_id>/sua', methods=['GET', 'POST'])
@admin_required
def sua_van_dong_vien(vdv_id):
    """Sửa VĐV"""
    user = session.get('user', {})
    try:
        return_context = _vdv_return_context()
        if request.method == 'GET':
            vdv = VanDongVienModel.get_by_id(vdv_id)
            if not vdv:
                return "Không tìm thấy", 404
            return render_template('sua_van_dong_vien.html', vdv=vdv, errors=[], **return_context)

        vdv = VanDongVienModel.get_by_id(vdv_id)
        if not vdv:
            return "Không tìm thấy", 404

        form_data, errors = normalize_vdv_form(request.form)
        if not errors and VanDongVienModel.email_exists(form_data['email'], exclude_id=vdv_id):
            errors.append("Email đã được dùng cho VĐV khác.")
        if errors:
            vdv_form = (vdv_id, form_data['ten_vdv'], form_data['trinh_do'], form_data['email'], None, form_data['ghi_chu'])
            return render_template('sua_van_dong_vien.html', vdv=vdv_form, errors=errors, **return_context), 400

        ten_vdv = form_data['ten_vdv']
        trinh_do = form_data['trinh_do']
        email = form_data['email']
        ghi_chu = form_data['ghi_chu']

        VanDongVienModel.update(vdv_id, ten_vdv, trinh_do, email, ghi_chu)
        DBLogger.log_success(f"VĐV {vdv_id} updated: {ten_vdv}", user.get('email'), f'/van-dong-vien/{vdv_id}/sua')
        return redirect(return_context['vdv_list_url'])
    except Exception as e:
        DBLogger.log_error(f"Error updating VĐV: {str(e)}", user.get('email'), f'/van-dong-vien/{vdv_id}/sua', context=traceback.format_exc())
        return f"❌ Error: {str(e)}", 500

@app.route('/van-dong-vien/<int:vdv_id>/xoa')
@admin_required
def xoa_van_dong_vien(vdv_id):
    """Xóa VĐV"""
    user = session.get('user', {})
    try:
        return_context = _vdv_return_context()
        vdv = VanDongVienModel.get_by_id(vdv_id)
        ten = vdv[1] if vdv else f"ID {vdv_id}"
        VanDongVienModel.delete(vdv_id)
        DBLogger.log_success(f"VĐV deleted: {ten}", user.get('email'), f'/van-dong-vien/{vdv_id}/xoa')
        return redirect(return_context['vdv_list_url'])
    except Exception as e:
        DBLogger.log_error(f"Error deleting VĐV: {str(e)}", user.get('email'), f'/van-dong-vien/{vdv_id}/xoa', context=traceback.format_exc())
        return f"❌ Error: {str(e)}", 500

# ============ TEAM MANAGEMENT ============

def _current_month():
    return date.today().strftime('%Y-%m')


def _money_from_form(value):
    raw = str(value or '').strip()
    if raw == '':
        return 0
    cleaned = ''.join(ch for ch in raw if ch.isdigit() or ch == '-')
    try:
        return float(cleaned or 0)
    except (TypeError, ValueError):
        return 0


def _get_team_for_admin_or_403(doi_bong_id, user):
    doi_bong = DoiBongModel.get_by_id(doi_bong_id, _admin_scope_id(user))
    if not doi_bong:
        return None
    return doi_bong


def _get_tournament_for_admin_or_403(giai_id, user):
    giai = TournamentModel.get_details(giai_id, _admin_scope_id(user))
    if not giai:
        return None
    return giai


def _is_super_admin(user=None):
    user = user or session.get('user', {})
    return normalize_admin_user(user.get('email')) == SUPER_ADMIN_EMAIL


def _admin_scope_id(user=None):
    user = user or session.get('user', {})
    if _is_super_admin(user):
        return None
    return user.get('id')


def _require_super_admin():
    if not _is_super_admin():
        return "Khong co quyen quan ly tai khoan admin", 403
    return None


def _chunks_evenly(items, group_count):
    group_count = max(1, int(group_count or 1))
    groups = [[] for _ in range(group_count)]
    for index, item in enumerate(items):
        groups[index % group_count].append(item)
    return groups


def _group_label(index):
    return chr(ord('A') + index)


def _normalize_knockout_qualifiers(value):
    try:
        value = int(value or 2)
    except (TypeError, ValueError):
        value = 2
    if value >= 8:
        return 8
    if value >= 4:
        return 4
    return 2


def _calculate_group_count(team_count, qualifier_count):
    team_count = max(0, int(team_count or 0))
    qualifier_count = _normalize_knockout_qualifiers(qualifier_count)
    if team_count < 2:
        return 1
    target_groups = (team_count + 3) // 4
    max_groups = max(1, team_count // 2)
    return max(1, min(qualifier_count, target_groups, max_groups))


def _stage_label(stage):
    return {
        'tu_ket': 'TK',
        'ban_ket': 'BK',
        'chung_ket': 'CK',
    }.get(stage, stage)


def _knockout_stages(qualifier_count):
    qualifier_count = _normalize_knockout_qualifiers(qualifier_count)
    if qualifier_count >= 8:
        return [('tu_ket', 100, 8), ('ban_ket', 101, 4), ('chung_ket', 102, 2)]
    if qualifier_count >= 4:
        return [('ban_ket', 101, 4), ('chung_ket', 102, 2)]
    return [('chung_ket', 102, 2)]


def _placeholder_team(stage, index):
    return f"Chờ {_stage_label(stage)} {index}"


def _winner_placeholder(stage, index):
    return f"Thắng {_stage_label(stage)} {index}"


def _build_group_stage_matches(teams, num_courts, qualifier_count=2, teams_per_group=None, group_count=None):
    matches = []
    teams = list(teams)
    if group_count is None:
        group_count = _calculate_group_count(len(teams), qualifier_count)
    else:
        group_count = max(1, int(group_count or 1))
    group_count = max(1, min(group_count, max(1, (len(teams) + 1) // 2)))
    groups = _chunks_evenly(teams, group_count)
    grouped_rounds = []
    for group_index, group_teams in enumerate(groups):
        if len(group_teams) < 2:
            continue
        group_name = _group_label(group_index)
        group_matches = MatchSchedulerService.generate_round_robin(group_teams, num_courts, 'don')
        for match in group_matches:
            match['giai_doan'] = 'bang'
            match['bang'] = group_name
        grouped_rounds.append(group_matches)

    max_round = max([max([match.get('vong', 1) for match in group_matches] or [0]) for group_matches in grouped_rounds] or [0])
    for round_no in range(1, max_round + 1):
        court_index = 0
        for group_matches in grouped_rounds:
            for match in [item for item in group_matches if item.get('vong', 1) == round_no]:
                match['san'] = (court_index % max(1, int(num_courts or 1))) + 1
                court_index += 1
                matches.append(match)
    return matches


def _rank_teams_for_matches(matches):
    return MatchModel.get_bang_xep_hang_by_matches(matches)


def _build_group_team_list(matches):
    groups = {}
    for match in matches:
        if len(match) <= 11 or match[10] != 'bang' or not match[11]:
            continue
        group_name = match[11]
        groups.setdefault(group_name, [])
        for team_name in (match[1], match[2]):
            if team_name and team_name not in groups[group_name]:
                groups[group_name].append(team_name)
    return [
        {"ten_bang": group_name, "doi_list": teams}
        for group_name, teams in sorted(groups.items())
    ]


def _build_group_rankings(matches):
    grouped_matches = {}
    for match in matches:
        if len(match) <= 11 or match[10] != 'bang' or not match[11]:
            continue
        grouped_matches.setdefault(match[11], []).append(match)
    return [
        {
            "ten_bang": group_name,
            "xep_hang": MatchModel.get_bang_xep_hang_by_matches(group_matches),
        }
        for group_name, group_matches in sorted(grouped_matches.items())
    ]


def _seed_knockout_from_group_rankings(grouped, total_qualifiers):
    group_names = sorted(grouped)
    ranked_groups = [
        (group_name, _rank_teams_for_matches(grouped[group_name]))
        for group_name in group_names
    ]
    if total_qualifiers <= 2:
        seeds = [ranking[0]['ten'] for _, ranking in ranked_groups if ranking]
        return seeds[:2]

    selected_groups = [(group_name, ranking[:2]) for group_name, ranking in ranked_groups]
    if sum(len(ranking) for _, ranking in selected_groups) < total_qualifiers:
        selected_groups = []
        group_count = max(1, len(ranked_groups))
        base_slots = max(1, total_qualifiers // group_count)
        extra_slots = total_qualifiers % group_count
        for index, (group_name, ranking) in enumerate(ranked_groups):
            slots = base_slots + (1 if index < extra_slots else 0)
            selected_groups.append((group_name, ranking[:slots]))

    seeded = []
    for index in range(0, len(selected_groups), 2):
        if index + 1 >= len(selected_groups):
            break
        group_a, ranking_a = selected_groups[index]
        group_b, ranking_b = selected_groups[index + 1]
        max_slots = max(len(ranking_a), len(ranking_b))
        for rank_index in range(0, max_slots, 2):
            if rank_index < len(ranking_a) and rank_index + 1 < len(ranking_b):
                seeded.extend([ranking_a[rank_index]['ten'], ranking_b[rank_index + 1]['ten']])
            if rank_index < len(ranking_b) and rank_index + 1 < len(ranking_a):
                seeded.extend([ranking_b[rank_index]['ten'], ranking_a[rank_index + 1]['ten']])
            if len(seeded) >= total_qualifiers:
                return seeded[:total_qualifiers]

    if len(seeded) < total_qualifiers:
        fallback = []
        max_rank = max([len(ranking) for _, ranking in selected_groups] or [0])
        for rank_index in range(max_rank):
            for _, ranking in selected_groups:
                if rank_index < len(ranking):
                    fallback.append(ranking[rank_index]['ten'])
        for team_name in fallback:
            if team_name not in seeded:
                seeded.append(team_name)
            if len(seeded) >= total_qualifiers:
                break
    return seeded[:total_qualifiers]


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


def _normalize_match_status(status):
    if _is_done_status(status):
        return 'Đã xong'
    if _decode_legacy_text(status) == 'Chưa diễn ra':
        return 'Chưa diễn ra'
    return 'Đang đánh'


def _get_winner_from_match(match):
    diem_a = match[3] or 0
    diem_b = match[4] or 0
    if not _is_done_status(match[5]) or diem_a == diem_b:
        return None
    return match[1] if diem_a > diem_b else match[2]


def _build_knockout_matches(teams, giai_doan, vong_dau, num_courts, team_count=None):
    matches = []
    teams = list(teams)
    team_count = int(team_count or len(teams) or 2)
    for index in range(0, team_count, 2):
        doi_a = teams[index] if index < len(teams) else _placeholder_team(giai_doan, index + 1)
        doi_b = teams[index + 1] if index + 1 < len(teams) else _placeholder_team(giai_doan, index + 2)
        matches.append({
            'doi_a': doi_a,
            'doi_b': doi_b,
            'san': (len(matches) % max(1, int(num_courts or 1))) + 1,
            'vong': vong_dau,
            'giai_doan': giai_doan,
            'bang': None,
        })
    return matches


def _build_knockout_skeleton(qualifier_count, num_courts):
    matches = []
    stages = _knockout_stages(qualifier_count)
    for stage_index, (stage, vong_dau, team_count) in enumerate(stages):
        if stage_index == 0:
            teams = []
        else:
            previous_stage = stages[stage_index - 1][0]
            teams = [_winner_placeholder(previous_stage, index) for index in range(1, team_count + 1)]
        matches.extend(_build_knockout_matches(teams, stage, vong_dau, num_courts, team_count))
    return matches


def _replace_stage_teams(giai_id, stage, teams):
    matches = [
        match for match in MatchModel.get_all_by_tournament(giai_id)
        if len(match) > 10 and match[10] == stage
    ]
    if not matches:
        return
    teams = list(teams)
    updates = []
    for index, match in enumerate(matches):
        team_index = index * 2
        if team_index + 1 >= len(teams):
            break
        updates.append((match[0], teams[team_index], teams[team_index + 1]))
    if updates:
        MatchModel.update_match_teams(updates)


def _ensure_knockout_progress(giai_id):
    giai_raw = TournamentModel.get_details(giai_id)
    if not giai_raw or len(giai_raw) <= 22 or giai_raw[22] != 'bang':
        return

    matches = MatchModel.get_all_by_tournament(giai_id)
    group_matches = [match for match in matches if len(match) > 10 and match[10] == 'bang']
    if not group_matches:
        return

    existing_stages = {match[10] for match in matches if len(match) > 10}
    num_courts = giai_raw[2] or 1

    total_qualifiers = _normalize_knockout_qualifiers(giai_raw[25] if len(giai_raw) > 25 else 2)
    stages = _knockout_stages(total_qualifiers)
    if any(stage not in existing_stages for stage, _, _ in stages):
        skeleton_matches = [
            match for match in _build_knockout_skeleton(total_qualifiers, num_courts)
            if match.get('giai_doan') not in existing_stages
        ]
        if skeleton_matches:
            MatchModel.save_matches(giai_id, skeleton_matches)
        matches = MatchModel.get_all_by_tournament(giai_id)

    if any(not _is_done_status(match[5]) for match in group_matches):
        return

    grouped = {}
    for match in group_matches:
        grouped.setdefault(match[11] or 'A', []).append(match)
    qualifiers = _seed_knockout_from_group_rankings(grouped, total_qualifiers)
    if len(qualifiers) >= total_qualifiers:
        first_stage = stages[0][0]
        first_stage_matches = [match for match in matches if len(match) > 10 and match[10] == first_stage]
        if first_stage_matches and all(not _is_done_status(match[5]) for match in first_stage_matches):
            _replace_stage_teams(giai_id, first_stage, qualifiers)
            matches = MatchModel.get_all_by_tournament(giai_id)

    for stage_index, (stage, _, team_count) in enumerate(stages[:-1]):
        stage_matches = [match for match in matches if len(match) > 10 and match[10] == stage]
        if not stage_matches or any(not _is_done_status(match[5]) for match in stage_matches):
            return
        winners = [_get_winner_from_match(match) for match in stage_matches]
        winners = [winner for winner in winners if winner]
        if len(winners) < team_count // 2:
            return
        next_stage = stages[stage_index + 1][0]
        next_matches = [match for match in matches if len(match) > 10 and match[10] == next_stage]
        if next_matches and all(not _is_done_status(match[5]) for match in next_matches):
            _replace_stage_teams(giai_id, next_stage, winners[:team_count // 2])
            matches = MatchModel.get_all_by_tournament(giai_id)
    return


@app.route('/doi-bong')
@admin_required
def doi_bong_list():
    user = session.get('user', {})
    try:
        doi_bong_list = DoiBongModel.get_all(_admin_scope_id(user))
        DBLogger.log_request('GET', '/doi-bong', user.get('email'))
        return render_template('doi_bong.html', doi_bong_list=doi_bong_list)
    except Exception as e:
        DBLogger.log_error(f"Error loading teams: {str(e)}", user.get('email'), '/doi-bong', context=traceback.format_exc())
        return f"Error: {str(e)}", 500


@app.route('/doi-bong/them', methods=['POST'])
@admin_required
def them_doi_bong():
    user = session.get('user', {})
    try:
        form_data, errors = normalize_team_form(request.form)
        if errors:
            doi_bong_list = DoiBongModel.get_all(_admin_scope_id(user))
            return render_template('doi_bong.html', doi_bong_list=doi_bong_list, errors=errors, form_data=form_data), 400

        doi_bong_id = DoiBongModel.create(form_data['ten_doi'], form_data['mo_ta'], user.get('id'))
        DBLogger.log_success(f"Team created: {form_data['ten_doi']}", user.get('email'), '/doi-bong/them')
        return redirect(f'/doi-bong/{doi_bong_id}')
    except Exception as e:
        DBLogger.log_error(f"Error creating team: {str(e)}", user.get('email'), '/doi-bong/them', context=traceback.format_exc())
        return f"Error: {str(e)}", 500


@app.route('/doi-bong/<int:doi_bong_id>/sua', methods=['GET', 'POST'])
@admin_required
def sua_doi_bong(doi_bong_id):
    user = session.get('user', {})
    try:
        doi_bong = _get_team_for_admin_or_403(doi_bong_id, user)
        if not doi_bong:
            return "Không tìm thấy đội bóng", 404
        if request.method == 'GET':
            return render_template('sua_doi_bong.html', doi_bong=doi_bong, errors=[])

        form_data, errors = normalize_team_form(request.form)
        if errors:
            doi_bong_form = (doi_bong_id, form_data['ten_doi'], form_data['mo_ta'])
            return render_template('sua_doi_bong.html', doi_bong=doi_bong_form, errors=errors), 400

        DoiBongModel.update(doi_bong_id, form_data['ten_doi'], form_data['mo_ta'])
        DBLogger.log_success(f"Team updated: {form_data['ten_doi']}", user.get('email'), f'/doi-bong/{doi_bong_id}/sua')
        return redirect('/doi-bong')
    except Exception as e:
        DBLogger.log_error(f"Error updating team: {str(e)}", user.get('email'), f'/doi-bong/{doi_bong_id}/sua', context=traceback.format_exc())
        return f"Error: {str(e)}", 500


@app.route('/doi-bong/<int:doi_bong_id>/xoa')
@admin_required
def xoa_doi_bong(doi_bong_id):
    user = session.get('user', {})
    try:
        if not _get_team_for_admin_or_403(doi_bong_id, user):
            return "Không có quyền xóa đội bóng này", 403
        DoiBongModel.delete(doi_bong_id)
        DBLogger.log_success(f"Team deleted: {doi_bong_id}", user.get('email'), f'/doi-bong/{doi_bong_id}/xoa')
        return redirect('/doi-bong')
    except Exception as e:
        DBLogger.log_error(f"Error deleting team: {str(e)}", user.get('email'), f'/doi-bong/{doi_bong_id}/xoa', context=traceback.format_exc())
        return f"Error: {str(e)}", 500


@app.route('/doi-bong/<int:doi_bong_id>')
@admin_required
def chi_tiet_doi_bong(doi_bong_id):
    user = session.get('user', {})
    try:
        doi_bong = _get_team_for_admin_or_403(doi_bong_id, user)
        if not doi_bong:
            return "Không tìm thấy đội bóng", 404

        selected_month = request.args.get('thang') or _current_month()
        selected_month_date = DoiBongModel.normalize_month(selected_month)
        month_config = DoiBongModel.get_month_config(doi_bong_id, selected_month_date)
        members = DoiBongModel.get_members_with_payments(doi_bong_id, selected_month_date)
        expenses = DoiBongModel.get_expenses(doi_bong_id, selected_month_date)
        finance = FinanceService.tinh_toan_quy_doi_bong(month_config, members, expenses)
        available_months = DoiBongModel.get_available_months(doi_bong_id)
        if selected_month[:7] not in available_months:
            available_months.insert(0, selected_month[:7])
        all_vdv = VanDongVienModel.get_available_for_team(doi_bong_id)
        permissions = DoiBongModel.get_permissions(doi_bong_id)
        owner_admin_id = doi_bong[3]
        owner_admin = AdminUserModel.get_by_id(owner_admin_id) if owner_admin_id else None
        admins = AdminUserModel.get_available_for_team(doi_bong_id, owner_admin_id, user.get('id'))
        is_owner = _is_super_admin(user) or doi_bong[3] in (None, user.get('id'))

        DBLogger.log_request('GET', f'/doi-bong/{doi_bong_id}', user.get('email'))
        return render_template(
            'chi_tiet_doi_bong.html',
            doi_bong=doi_bong,
            finance=finance,
            selected_month=selected_month[:7],
            available_months=available_months,
            all_vdv=all_vdv,
            admins=admins,
            owner_admin=owner_admin,
            permissions=permissions,
            can_edit=True,
            is_owner=is_owner,
        )
    except Exception as e:
        DBLogger.log_error(f"Error loading team detail: {str(e)}", user.get('email'), f'/doi-bong/{doi_bong_id}', context=traceback.format_exc())
        return f"Error: {str(e)}", 500


@app.route('/doi-bong/<int:doi_bong_id>/cap-nhat-quy', methods=['POST'])
@admin_required
def cap_nhat_quy_doi_bong(doi_bong_id):
    user = session.get('user', {})
    selected_month = request.form.get('thang') or _current_month()
    try:
        if not _get_team_for_admin_or_403(doi_bong_id, user):
            return "Không có quyền cập nhật đội bóng này", 403
        form_data, errors = normalize_team_month_form(request.form)
        if not errors:
            DoiBongModel.upsert_month_config(
                doi_bong_id,
                selected_month,
                form_data['muc_phi_thang'],
                form_data['chi_phi_san_bai'],
                form_data['tien_san_con_lai_thang_truoc'],
                form_data['ghi_chu'],
            )
            DBLogger.log_success(f"Team month fund updated: {doi_bong_id} {selected_month}", user.get('email'), f'/doi-bong/{doi_bong_id}/cap-nhat-quy')
        return redirect(f'/doi-bong/{doi_bong_id}?thang={selected_month}')
    except Exception as e:
        DBLogger.log_error(f"Error updating team month fund: {str(e)}", user.get('email'), f'/doi-bong/{doi_bong_id}/cap-nhat-quy', context=traceback.format_exc())
        return f"Error: {str(e)}", 500


@app.route('/doi-bong/<int:doi_bong_id>/thanh-vien/them', methods=['POST'])
@admin_required
def them_thanh_vien_doi_bong(doi_bong_id):
    user = session.get('user', {})
    selected_month = request.form.get('thang') or _current_month()
    try:
        if not _get_team_for_admin_or_403(doi_bong_id, user):
            return "Không có quyền cập nhật đội bóng này", 403
        van_dong_vien_ids = request.form.getlist('van_dong_vien_ids')
        loai_thanh_vien = request.form.get('loai_thanh_vien', 'co_dinh')
        ghi_chu = (request.form.get('ghi_chu') or '').strip()
        added_count = 0
        for van_dong_vien_id in van_dong_vien_ids:
            form_data, errors = normalize_team_member_form({
                'van_dong_vien_id': van_dong_vien_id,
                'loai_thanh_vien': loai_thanh_vien,
                'ghi_chu': ghi_chu,
            })
            if not errors:
                added_id = DoiBongModel.add_member(
                    doi_bong_id,
                    form_data['van_dong_vien_id'],
                    form_data['loai_thanh_vien'],
                    form_data['ghi_chu'],
                )
                if added_id:
                    added_count += 1
        DBLogger.log_success(f"Team members added: {added_count}", user.get('email'), f'/doi-bong/{doi_bong_id}/thanh-vien/them')
        return redirect(f'/doi-bong/{doi_bong_id}?thang={selected_month}')
    except Exception as e:
        DBLogger.log_error(f"Error adding team member: {str(e)}", user.get('email'), f'/doi-bong/{doi_bong_id}/thanh-vien/them', context=traceback.format_exc())
        return f"Error: {str(e)}", 500


@app.route('/doi-bong/<int:doi_bong_id>/thanh-vien/<int:thanh_vien_id>/sua', methods=['POST'])
@admin_required
def sua_thanh_vien_doi_bong(doi_bong_id, thanh_vien_id):
    user = session.get('user', {})
    selected_month = request.form.get('thang') or _current_month()
    try:
        if not _get_team_for_admin_or_403(doi_bong_id, user):
            return "Không có quyền cập nhật đội bóng này", 403
        form_data, errors = normalize_team_member_form(request.form)
        if not errors:
            DoiBongModel.update_member(
                doi_bong_id,
                thanh_vien_id,
                form_data['loai_thanh_vien'],
                form_data['ghi_chu'],
            )
            DBLogger.log_success(f"Team member updated: {thanh_vien_id}", user.get('email'), f'/doi-bong/{doi_bong_id}/thanh-vien/{thanh_vien_id}/sua')
        return redirect(f'/doi-bong/{doi_bong_id}?thang={selected_month}')
    except Exception as e:
        DBLogger.log_error(f"Error updating team member: {str(e)}", user.get('email'), f'/doi-bong/{doi_bong_id}/thanh-vien/{thanh_vien_id}/sua', context=traceback.format_exc())
        return f"Error: {str(e)}", 500


@app.route('/doi-bong/<int:doi_bong_id>/thanh-vien/<int:thanh_vien_id>/xoa')
@admin_required
def xoa_thanh_vien_doi_bong(doi_bong_id, thanh_vien_id):
    user = session.get('user', {})
    selected_month = request.args.get('thang') or _current_month()
    try:
        if not _get_team_for_admin_or_403(doi_bong_id, user):
            return "Không có quyền cập nhật đội bóng này", 403
        DoiBongModel.delete_member(doi_bong_id, thanh_vien_id)
        DBLogger.log_success(f"Team member deleted: {thanh_vien_id}", user.get('email'), f'/doi-bong/{doi_bong_id}/thanh-vien/{thanh_vien_id}/xoa')
        return redirect(f'/doi-bong/{doi_bong_id}?thang={selected_month}')
    except Exception as e:
        DBLogger.log_error(f"Error deleting team member: {str(e)}", user.get('email'), f'/doi-bong/{doi_bong_id}/thanh-vien/{thanh_vien_id}/xoa', context=traceback.format_exc())
        return f"Error: {str(e)}", 500


@app.route('/doi-bong/<int:doi_bong_id>/khoan-chi/them', methods=['POST'])
@admin_required
def them_khoan_chi_doi_bong(doi_bong_id):
    user = session.get('user', {})
    selected_month = request.form.get('thang') or _current_month()
    try:
        if not _get_team_for_admin_or_403(doi_bong_id, user):
            return "Không có quyền cập nhật đội bóng này", 403
        form_data, errors = normalize_team_expense_form(request.form)
        if not errors:
            DoiBongModel.add_expense(
                doi_bong_id,
                selected_month,
                form_data['ngay_chi'],
                form_data['noi_dung'],
                form_data['so_tien'],
                form_data['ghi_chu'],
            )
            DBLogger.log_success(f"Team expense added: {doi_bong_id}", user.get('email'), f'/doi-bong/{doi_bong_id}/khoan-chi/them')
        return redirect(f'/doi-bong/{doi_bong_id}?thang={selected_month}')
    except Exception as e:
        DBLogger.log_error(f"Error adding team expense: {str(e)}", user.get('email'), f'/doi-bong/{doi_bong_id}/khoan-chi/them', context=traceback.format_exc())
        return f"Error: {str(e)}", 500


@app.route('/doi-bong/<int:doi_bong_id>/khoan-chi/<int:expense_id>/xoa')
@admin_required
def xoa_khoan_chi_doi_bong(doi_bong_id, expense_id):
    user = session.get('user', {})
    selected_month = request.args.get('thang') or _current_month()
    try:
        if not _get_team_for_admin_or_403(doi_bong_id, user):
            return "Không có quyền cập nhật đội bóng này", 403
        DoiBongModel.delete_expense(doi_bong_id, expense_id)
        DBLogger.log_success(f"Team expense deleted: {expense_id}", user.get('email'), f'/doi-bong/{doi_bong_id}/khoan-chi/{expense_id}/xoa')
        return redirect(f'/doi-bong/{doi_bong_id}?thang={selected_month}')
    except Exception as e:
        DBLogger.log_error(f"Error deleting team expense: {str(e)}", user.get('email'), f'/doi-bong/{doi_bong_id}/khoan-chi/{expense_id}/xoa', context=traceback.format_exc())
        return f"Error: {str(e)}", 500


@app.route('/doi-bong/<int:doi_bong_id>/phan-quyen/them', methods=['POST'])
@admin_required
def them_quyen_doi_bong(doi_bong_id):
    user = session.get('user', {})
    try:
        doi_bong = DoiBongModel.get_by_id(doi_bong_id, _admin_scope_id(user))
        if not doi_bong or (not _is_super_admin(user) and doi_bong[3] not in (None, user.get('id'))):
            return "Không có quyền phân quyền đội bóng này", 403
        admin_id = request.form.get('admin_id')
        if admin_id:
            DoiBongModel.add_permission(doi_bong_id, admin_id)
        return redirect(f'/doi-bong/{doi_bong_id}')
    except Exception as e:
        DBLogger.log_error(f"Error adding team permission: {str(e)}", user.get('email'), f'/doi-bong/{doi_bong_id}/phan-quyen/them', context=traceback.format_exc())
        return f"Error: {str(e)}", 500


@app.route('/doi-bong/<int:doi_bong_id>/phan-quyen/<int:permission_id>/xoa')
@admin_required
def xoa_quyen_doi_bong(doi_bong_id, permission_id):
    user = session.get('user', {})
    try:
        doi_bong = DoiBongModel.get_by_id(doi_bong_id, _admin_scope_id(user))
        if not doi_bong or (not _is_super_admin(user) and doi_bong[3] not in (None, user.get('id'))):
            return "Không có quyền phân quyền đội bóng này", 403
        DoiBongModel.remove_permission(doi_bong_id, permission_id)
        return redirect(f'/doi-bong/{doi_bong_id}')
    except Exception as e:
        DBLogger.log_error(f"Error removing team permission: {str(e)}", user.get('email'), f'/doi-bong/{doi_bong_id}/phan-quyen/{permission_id}/xoa', context=traceback.format_exc())
        return f"Error: {str(e)}", 500


@app.route('/doi-bong/<int:doi_bong_id>/cap-nhat-dong-phi', methods=['POST'])
@admin_required
def cap_nhat_dong_phi_doi_bong(doi_bong_id):
    user = session.get('user', {})
    selected_month = request.form.get('thang') or _current_month()
    try:
        if not _get_team_for_admin_or_403(doi_bong_id, user):
            return "Không có quyền cập nhật đội bóng này", 403
        members = DoiBongModel.get_members_with_payments(doi_bong_id, selected_month)
        updates = []
        for member in members:
            member_id = member[0]
            so_tien = _money_from_form(request.form.get(f'tien_{member_id}', 0))
            trang_thai = request.form.get(f'trang_thai_{member_id}', 'Chưa đóng')
            ghi_chu = (request.form.get(f'ghi_chu_phi_{member_id}') or '').strip()
            updates.append((member_id, so_tien, trang_thai, ghi_chu))
        updated = DoiBongModel.update_payments(selected_month, updates)
        DBLogger.log_success(f"Team fee updated: {updated} records for team {doi_bong_id}", user.get('email'), f'/doi-bong/{doi_bong_id}/cap-nhat-dong-phi')
        return redirect(f'/doi-bong/{doi_bong_id}?thang={selected_month}')
    except Exception as e:
        DBLogger.log_error(f"Error updating team fees: {str(e)}", user.get('email'), f'/doi-bong/{doi_bong_id}/cap-nhat-dong-phi', context=traceback.format_exc())
        return f"Error: {str(e)}", 500


# ============ TOURNAMENT MANAGEMENT ============

@app.route('/them-giai-dau', methods=['POST'])
@admin_required
def them_giai_dau():
    """Tạo giải mới - ENSURE loai_dau is saved"""
    user = session.get('user', {})
    try:
        form_data, errors = normalize_tournament_form(request.form)
        if errors:
            return render_template('them_giai_dau.html', form_data=form_data, errors=errors), 400

        loai_dau = form_data['loai_dau']
        DBLogger.log_info(f"Creating tournament with loai_dau={loai_dau}", user.get('email'), '/them-giai-dau')

        with db_cursor(commit=True) as cursor:
            cursor.execute("""
                INSERT INTO giai_dau
                    (ten_giai_dau, so_luong_san, dia_diem,
                     chi_phi_san_bai, chi_phi_nuoc_noi, chi_phi_giai_thuong, chi_phi_khac,
                     ty_le_giai_1, ty_le_giai_2, ty_le_giai_3, so_nguoi_du_kien, thoi_gian_bat_dau, loai_dau,
                     owner_admin_id, the_thuc, so_doi_moi_bang, so_bang, so_doi_vao_vong_trong)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);
            """, (
                form_data['ten_giai_dau'],
                form_data['so_luong_san'],
                form_data['dia_diem'],
                form_data['chi_phi_san_bai'],
                form_data['chi_phi_nuoc_noi'],
                form_data['chi_phi_giai_thuong'],
                form_data['chi_phi_khac'],
                form_data['ty_le_giai_1'],
                form_data['ty_le_giai_2'],
                form_data['ty_le_giai_3'],
                form_data['so_nguoi_du_kien'],
                form_data['thoi_gian_bat_dau'],
                loai_dau,
                user.get('id'),
                form_data['the_thuc'],
                form_data['so_doi_moi_bang'],
                form_data['so_bang'],
                form_data['so_doi_vao_vong_trong']
            ))
        DBLogger.log_success(f"Tournament created: {form_data['ten_giai_dau']} ({loai_dau})", user.get('email'), '/them-giai-dau')
        return redirect('/giai-dau')
    except Exception as e:
        DBLogger.log_error(f"Error creating tournament: {str(e)}", user.get('email'), '/them-giai-dau', context=traceback.format_exc())
        return f"❌ Error: {str(e)}", 500

@app.route('/sua-giai-dau/<int:giai_id>', methods=['GET', 'POST'])
@admin_required
def sua_giai_dau(giai_id):
    """Sửa giải đấu - ENSURE loai_dau is updated"""
    user = session.get('user', {})
    try:
        if request.method == 'GET':
            TournamentModel.ensure_score_rule_columns()
            giai_raw = _get_tournament_for_admin_or_403(giai_id, user)
            if not giai_raw:
                return "Không tìm thấy", 404
            return render_template('sua_giai.html', giai=giai_raw)

        TournamentModel.ensure_score_rule_columns()
        if not _get_tournament_for_admin_or_403(giai_id, user):
            return "Khong co quyen sua giai dau nay", 403
        form_data, errors = normalize_tournament_form(request.form)
        if errors:
            return render_template('sua_giai.html', giai=_giai_tuple_from_form(giai_id, form_data), errors=errors), 400

        loai_dau = form_data['loai_dau']
        diem_cham = form_data['diem_cham']
        diem_toi_da = form_data['diem_toi_da']
        DBLogger.log_info(f"Updating tournament {giai_id} with loai_dau={loai_dau}", user.get('email'), f'/sua-giai-dau/{giai_id}')

        with db_cursor(commit=True) as cursor:
            cursor.execute("""
                UPDATE giai_dau SET
                    ten_giai_dau=%s, so_luong_san=%s, dia_diem=%s,
                    chi_phi_san_bai=%s, chi_phi_nuoc_noi=%s,
                    chi_phi_giai_thuong=%s, chi_phi_khac=%s,
                    ty_le_giai_1=%s, ty_le_giai_2=%s, ty_le_giai_3=%s,
                    so_nguoi_du_kien=%s, thoi_gian_bat_dau=%s, loai_dau=%s,
                    diem_cham=%s, diem_toi_da=%s,
                    the_thuc=%s, so_doi_moi_bang=%s, so_bang=%s, so_doi_vao_vong_trong=%s
                WHERE id=%s;
            """, (
                form_data['ten_giai_dau'],
                form_data['so_luong_san'],
                form_data['dia_diem'],
                form_data['chi_phi_san_bai'],
                form_data['chi_phi_nuoc_noi'],
                form_data['chi_phi_giai_thuong'],
                form_data['chi_phi_khac'],
                form_data['ty_le_giai_1'],
                form_data['ty_le_giai_2'],
                form_data['ty_le_giai_3'],
                form_data['so_nguoi_du_kien'],
                form_data['thoi_gian_bat_dau'],
                loai_dau,
                diem_cham,
                diem_toi_da,
                form_data['the_thuc'],
                form_data['so_doi_moi_bang'],
                form_data['so_bang'],
                form_data['so_doi_vao_vong_trong'],
                giai_id
            ))
        DBLogger.log_success(f"Tournament {giai_id} updated ({loai_dau})", user.get('email'), f'/sua-giai-dau/{giai_id}')
        return redirect('/giai-dau')
    except Exception as e:
        DBLogger.log_error(f"Error updating tournament: {str(e)}", user.get('email'), f'/sua-giai-dau/{giai_id}', context=traceback.format_exc())
        return f"❌ Error: {str(e)}", 500

@app.route('/xoa-giai-dau/<int:giai_id>')
@admin_required
def xoa_giai_dau(giai_id):
    """Xóa giải"""
    user = session.get('user', {})
    try:
        giai_raw = _get_tournament_for_admin_or_403(giai_id, user)
        if not giai_raw:
            return "Khong co quyen xoa giai dau nay", 403
        with db_cursor(commit=True) as cursor:
            cursor.execute("DELETE FROM giai_dau WHERE id = %s;", (giai_id,))
        DBLogger.log_success(f"Tournament {giai_id} deleted", user.get('email'), f'/xoa-giai-dau/{giai_id}')
        return redirect('/giai-dau')
    except Exception as e:
        DBLogger.log_error(f"Error deleting tournament: {str(e)}", user.get('email'), f'/xoa-giai-dau/{giai_id}', context=traceback.format_exc())
        return f"❌ Error: {str(e)}", 500

@app.route('/giai-dau/<int:giai_id>/admin')
@admin_required
def chi_tiet_giai_admin(giai_id):
    """Chi tiết giải (ADMIN) - FIXED VERSION"""
    user = session.get('user', {})
    try:
        giai_raw = _get_tournament_for_admin_or_403(giai_id, user)
        if not giai_raw:
            return "Không có quyền xem giải đấu này", 403

        registrations = DangKyGiaiModel.get_by_tournament(giai_id)
        all_vdv = VanDongVienModel.get_available_for_tournament(giai_id)
        matches = MatchModel.get_all_by_tournament(giai_id)

        giai_detail = prepare_tournament_detail(giai_raw, registrations)

        top_3_donate = []
        if giai_detail.get('nguoi_choi_list'):
            sorted_players = sorted(giai_detail['nguoi_choi_list'], key=lambda x: x['tien_dong'], reverse=True)
            top_3_donate = [(p['ten'], p['tien_dong']) for p in sorted_players[:3]]
        giai_detail['top_3_donate'] = top_3_donate

        the_thuc_value = giai_raw[22] if len(giai_raw) > 22 and giai_raw[22] else 'vong_tron'
        ranking_matches = [m for m in matches if len(m) > 10 and m[10] == 'bang'] if the_thuc_value == 'bang' else matches
        xep_hang = MatchModel.get_bang_xep_hang_by_matches(ranking_matches) if ranking_matches else []
        giai_detail['bang_xep_hang'] = xep_hang
        giai_detail['bang_xep_hang_theo_bang'] = _build_group_rankings(matches) if the_thuc_value == 'bang' else []
        giai_detail['matches'] = matches
        giai_detail['registrations'] = registrations
        giai_detail['all_vdv'] = all_vdv
        giai_detail['loai_dau'] = giai_raw[15] if len(giai_raw) > 15 and giai_raw[15] else 'don'
        giai_detail['diem_cham'] = int(giai_raw[16] if len(giai_raw) > 16 and giai_raw[16] else 11)
        giai_detail['diem_toi_da'] = int(giai_raw[17] if len(giai_raw) > 17 and giai_raw[17] else 15)
        giai_detail['owner_admin_id'] = giai_raw[21] if len(giai_raw) > 21 else None
        giai_detail['the_thuc'] = the_thuc_value
        giai_detail['so_doi_moi_bang'] = int(giai_raw[23] if len(giai_raw) > 23 and giai_raw[23] else 4)
        giai_detail['so_bang'] = int(giai_raw[24] if len(giai_raw) > 24 and giai_raw[24] else 2)
        giai_detail['so_doi_vao_vong_trong'] = int(giai_raw[25] if len(giai_raw) > 25 and giai_raw[25] else 2)

        # Build vong_dict: { vong_number: [match_dict, ...] } for the template
        vong_dict = {}
        for m in matches:
            vong = m[7] or 1
            if vong not in vong_dict:
                vong_dict[vong] = []
            vong_dict[vong].append({
                "id": m[0], "doi_a": m[1], "doi_b": m[2],
                "diem_a": m[3], "diem_b": m[4],
                "trang_thai": _normalize_match_status(m[5]), "san": m[6] or 1, "vong": vong,
                "thu_tu_danh": m[8] if len(m) > 8 and m[8] else 2,
                "doi_dang_giao": m[9] if len(m) > 9 and m[9] else 'A',
                "giai_doan": m[10] if len(m) > 10 and m[10] else 'vong_tron',
                "bang": m[11] if len(m) > 11 else None
            })
        giai_detail['vong_dict'] = vong_dict
        giai_detail['bang_dau_list'] = _build_group_team_list(matches)

        canh_bao = None
        if request.args.get('error') == 'full':
            canh_bao = "⚠️ Giải đã đủ số người dự kiến, không thể thêm VĐV nữa. Hãy tăng 'Số người dự kiến' trong phần Sửa giải nếu muốn nhận thêm."
        elif request.args.get('error') == 'prize_over':
            canh_bao = "Tổng tiền thưởng nhập tay không được vượt quá quỹ thưởng thực tế."

        if request.args.get('error') == 'manual_pair':
            canh_bao = "Ghép đội thủ công không hợp lệ. Mỗi VĐV chỉ được chọn một lần và mỗi đội cần 2 VĐV."
        elif request.args.get('error') == 'manual_pair_min':
            canh_bao = "Cần ít nhất 2 đội hợp lệ để tạo lịch thi đấu."

        DBLogger.log_request('GET', f'/giai-dau/{giai_id}/admin', user.get('email'))
        permissions = TournamentModel.get_permissions(giai_id)
        owner_admin_id = giai_detail.get('owner_admin_id')
        owner_admin = AdminUserModel.get_by_id(owner_admin_id) if owner_admin_id else None
        admins = AdminUserModel.get_available_for_tournament(giai_id, owner_admin_id, user.get('id'))
        is_owner = _is_super_admin(user) or owner_admin_id in (None, user.get('id'))

        return render_template(
            'chi_tiet_giai_admin.html',
            giai=giai_detail,
            registrations=registrations,
            canh_bao=canh_bao,
            enumerate=enumerate,
            base_url=BASE_URL,
            admins=admins,
            owner_admin=owner_admin,
            permissions=permissions,
            is_owner=is_owner,
        )
    except Exception as e:
        DBLogger.log_error(f"Error loading tournament: {str(e)}", user.get('email'), f'/giai-dau/{giai_id}/admin', context=traceback.format_exc())
        return f"❌ Error: {str(e)}", 500

@app.route('/giai-dau/<int:giai_id>/dang-ky', methods=['POST'])
@admin_required
def dang_ky_vdv(giai_id):
    """Đăng ký VĐV"""
    user = session.get('user', {})
    try:
        van_dong_vien_ids = request.form.getlist('van_dong_vien_ids')
        if not van_dong_vien_ids and request.form.get('van_dong_vien_id'):
            van_dong_vien_ids = [request.form.get('van_dong_vien_id')]

        giai_raw = _get_tournament_for_admin_or_403(giai_id, user)
        if not giai_raw:
            return "Khong co quyen cap nhat giai dau nay", 403
        so_nguoi_du_kien = giai_raw[11] if giai_raw and giai_raw[11] else 0
        registrations = DangKyGiaiModel.get_by_tournament(giai_id)

        registered_ids = {str(reg[1]) for reg in registrations}
        van_dong_vien_ids = [vdv_id for vdv_id in van_dong_vien_ids if vdv_id and vdv_id not in registered_ids]

        if not van_dong_vien_ids:
            return redirect(f'/giai-dau/{giai_id}/admin')

        if so_nguoi_du_kien and len(registrations) >= so_nguoi_du_kien:
            DBLogger.log_warning(
                f"Registration rejected: tournament {giai_id} already full ({len(registrations)}/{so_nguoi_du_kien})",
                user.get('email'), f'/giai-dau/{giai_id}/dang-ky'
            )
            return redirect(f'/giai-dau/{giai_id}/admin?error=full')

        selected_count = len(van_dong_vien_ids)
        if so_nguoi_du_kien:
            slots_left = max(so_nguoi_du_kien - len(registrations), 0)
            van_dong_vien_ids = van_dong_vien_ids[:slots_left]

        if not van_dong_vien_ids:
            return redirect(f'/giai-dau/{giai_id}/admin?error=full')

        added_count = DangKyGiaiModel.register_many(van_dong_vien_ids, giai_id)

        DBLogger.log_success(f"{added_count} VĐV registered for tournament {giai_id}", user.get('email'), f'/giai-dau/{giai_id}/dang-ky')
        suffix = '?error=full' if added_count < selected_count else ''
        return redirect(f'/giai-dau/{giai_id}/admin{suffix}')
    except Exception as e:
        DBLogger.log_error(f"Error registering VĐV: {str(e)}", user.get('email'), f'/giai-dau/{giai_id}/dang-ky', context=traceback.format_exc())
        return f"❌ Error: {str(e)}", 500

@app.route('/dang-ky-giai/<int:dang_ky_id>/xoa')
@admin_required
def xoa_dang_ky(dang_ky_id):
    """Xóa đăng ký"""
    user = session.get('user', {})
    try:
        with db_cursor() as cursor:
            cursor.execute("SELECT giai_dau_id FROM dang_ky_giai WHERE id = %s;", (dang_ky_id,))
            result = cursor.fetchone()
        giai_id = result[0] if result else None
        if not giai_id or not _get_tournament_for_admin_or_403(giai_id, user):
            return "Khong co quyen cap nhat giai dau nay", 403

        DangKyGiaiModel.remove(dang_ky_id)
        DBLogger.log_success(f"Registration {dang_ky_id} removed", user.get('email'), f'/dang-ky-giai/{dang_ky_id}/xoa')
        return redirect(f'/giai-dau/{giai_id}/admin')
    except Exception as e:
        DBLogger.log_error(f"Error removing registration: {str(e)}", user.get('email'), f'/dang-ky-giai/{dang_ky_id}/xoa', context=traceback.format_exc())
        return f"❌ Error: {str(e)}", 500

@app.route('/dang-ky-giai/<int:dang_ky_id>/cap-nhat-tien', methods=['POST'])
@admin_required
def cap_nhat_tien_dang_ky(dang_ky_id):
    """Cập nhật tiền"""
    user = session.get('user', {})
    try:
        so_tien = request.form.get('so_tien', 0)
        trang_thai = request.form.get('trang_thai', 'Chưa đóng')

        with db_cursor() as cursor:
            cursor.execute("SELECT giai_dau_id FROM dang_ky_giai WHERE id = %s;", (dang_ky_id,))
            result = cursor.fetchone()
        giai_id = result[0] if result else None
        if not giai_id or not _get_tournament_for_admin_or_403(giai_id, user):
            return "Khong co quyen cap nhat giai dau nay", 403

        DangKyGiaiModel.update_payment(dang_ky_id, so_tien, trang_thai)
        DBLogger.log_success(f"Payment updated: {so_tien}đ", user.get('email'), f'/dang-ky-giai/{dang_ky_id}/cap-nhat-tien')
        return redirect(f'/giai-dau/{giai_id}/admin')
    except Exception as e:
        DBLogger.log_error(f"Error updating payment: {str(e)}", user.get('email'), f'/dang-ky-giai/{dang_ky_id}/cap-nhat-tien', context=traceback.format_exc())
        return f"❌ Error: {str(e)}", 500

@app.route('/giai-dau/<int:giai_id>/chia-lich', methods=['POST'])  # ← CRITICAL: methods=['POST']
@admin_required
def auto_chia_lich(giai_id):
    """Tự sinh lịch thi đấu - FIXED VERSION"""
    user = session.get('user', {})
    try:
        giai_raw = _get_tournament_for_admin_or_403(giai_id, user)
        if not giai_raw:
            return "Khong co quyen cap nhat giai dau nay", 403
        registrations = DangKyGiaiModel.get_by_tournament(giai_id)
        so_san = giai_raw[2] if giai_raw else 1

        loai_dau = giai_raw[15] if len(giai_raw) > 15 and giai_raw[15] else 'don'
        the_thuc = giai_raw[22] if len(giai_raw) > 22 and giai_raw[22] else 'vong_tron'

        MatchModel.delete_by_tournament(giai_id)

        if loai_dau == 'doi':
            # Doubles: truyền (tên, trình độ) để smart pairing theo level
            players = [(r[2], r[3] or 'D') for r in registrations]
        else:
            # Singles: chỉ cần tên
            players = [r[2] for r in registrations]

        if the_thuc == 'bang':
            if loai_dau == 'doi':
                teams = MatchSchedulerService._smart_pair(players)
            else:
                teams = players
            qualifier_count = _normalize_knockout_qualifiers(giai_raw[25] if len(giai_raw) > 25 else 2)
            if len(teams) < qualifier_count:
                return redirect(f'/giai-dau/{giai_id}/admin?error=manual_pair_min')
            matches = _build_group_stage_matches(
                teams,
                so_san,
                qualifier_count,
                giai_raw[23] if len(giai_raw) > 23 else 4,
                giai_raw[24] if len(giai_raw) > 24 else None,
            )
            matches.extend(_build_knockout_skeleton(qualifier_count, so_san))
        else:
            matches = MatchSchedulerService.generate_round_robin(players, so_san, loai_dau)
        MatchModel.save_matches(giai_id, matches)

        DBLogger.log_success(f"Schedule generated: {len(matches)} matches ({loai_dau})", user.get('email'), f'/giai-dau/{giai_id}/chia-lich')
        return redirect(f'/giai-dau/{giai_id}/admin')
    except Exception as e:
        DBLogger.log_error(f"Error generating schedule: {str(e)}", user.get('email'), f'/giai-dau/{giai_id}/chia-lich', context=traceback.format_exc())
        return f"❌ Error: {str(e)}", 500

@app.route('/giai-dau/<int:giai_id>/ghep-doi-thu-cong', methods=['POST'])
@admin_required
def ghep_doi_thu_cong(giai_id):
    user = session.get('user', {})
    try:
        giai_raw = _get_tournament_for_admin_or_403(giai_id, user)
        if not giai_raw:
            return "Khong co quyen cap nhat giai dau nay", 403

        loai_dau = giai_raw[15] if len(giai_raw) > 15 and giai_raw[15] else 'don'
        if loai_dau != 'doi':
            return redirect(f'/giai-dau/{giai_id}/admin?error=manual_pair')

        registrations = DangKyGiaiModel.get_by_tournament(giai_id)
        players_by_id = {str(reg[1]): reg[2] for reg in registrations}
        used_player_ids = set()
        pairs = []

        for index in range(1, int(request.form.get('pair_count', 0) or 0) + 1):
            player_a_id = (request.form.get(f'player_a_{index}') or '').strip()
            player_b_id = (request.form.get(f'player_b_{index}') or '').strip()
            if not player_a_id and not player_b_id:
                continue
            if (
                not player_a_id or not player_b_id
                or player_a_id == player_b_id
                or player_a_id not in players_by_id
                or player_b_id not in players_by_id
                or player_a_id in used_player_ids
                or player_b_id in used_player_ids
            ):
                return redirect(f'/giai-dau/{giai_id}/admin?error=manual_pair')

            used_player_ids.add(player_a_id)
            used_player_ids.add(player_b_id)
            pairs.append(f"{players_by_id[player_a_id]} + {players_by_id[player_b_id]}")

        if len(pairs) < 2:
            return redirect(f'/giai-dau/{giai_id}/admin?error=manual_pair_min')

        the_thuc = giai_raw[22] if len(giai_raw) > 22 and giai_raw[22] else 'vong_tron'
        qualifier_count = _normalize_knockout_qualifiers(giai_raw[25] if len(giai_raw) > 25 else 2)
        if the_thuc == 'bang' and len(pairs) < qualifier_count:
            return redirect(f'/giai-dau/{giai_id}/admin?error=manual_pair_min')
        if the_thuc == 'bang':
            matches = _build_group_stage_matches(
                pairs,
                giai_raw[2] if giai_raw else 1,
                qualifier_count,
                giai_raw[23] if len(giai_raw) > 23 else 4,
                giai_raw[24] if len(giai_raw) > 24 else None,
            )
            matches.extend(_build_knockout_skeleton(qualifier_count, giai_raw[2] if giai_raw else 1))
        else:
            matches = MatchSchedulerService.generate_round_robin(pairs, giai_raw[2] if giai_raw else 1, 'don')
        MatchModel.delete_by_tournament(giai_id)
        MatchModel.save_matches(giai_id, matches)

        DBLogger.log_success(f"Manual teams scheduled: {len(pairs)} teams, {len(matches)} matches", user.get('email'), f'/giai-dau/{giai_id}/ghep-doi-thu-cong')
        return redirect(f'/giai-dau/{giai_id}/admin')
    except Exception as e:
        DBLogger.log_error(f"Manual pairing schedule error: {str(e)}", user.get('email'), f'/giai-dau/{giai_id}/ghep-doi-thu-cong', context=traceback.format_exc())
        return f"Error: {str(e)}", 500


@app.route('/giai-dau/<int:giai_id>/cap-nhat-tien-hang-loat', methods=['POST'])
@admin_required
def cap_nhat_tien_hang_loat(giai_id):
    """Cập nhật phí đóng cho toàn bộ VĐV trong 1 lần submit"""
    user = session.get('user', {})
    try:
        if not _get_tournament_for_admin_or_403(giai_id, user):
            return "Khong co quyen cap nhat giai dau nay", 403
        registrations = DangKyGiaiModel.get_by_tournament(giai_id)
        updates = []
        for reg in registrations:
            reg_id = reg[0]
            so_tien = request.form.get(f'tien_{reg_id}', 0)
            trang_thai = request.form.get(f'trang_thai_{reg_id}', 'Chưa đóng')
            so_tien = _money_from_form(so_tien)
            updates.append((reg_id, so_tien, trang_thai))
        updated = DangKyGiaiModel.update_payments(updates)
        DBLogger.log_success(f"Batch payment update: {updated} records for tournament {giai_id}", user.get('email'), f'/giai-dau/{giai_id}/cap-nhat-tien-hang-loat')
        return redirect(f'/giai-dau/{giai_id}/admin')
    except Exception as e:
        DBLogger.log_error(f"Batch payment error: {str(e)}", user.get('email'), f'/giai-dau/{giai_id}/cap-nhat-tien-hang-loat', context=traceback.format_exc())
        return f"❌ Error: {str(e)}", 500
@app.route('/giai-dau/<int:giai_id>/cap-nhat-giai-thuong', methods=['POST'])
@admin_required
def cap_nhat_giai_thuong(giai_id):
    user = session.get('user', {})
    try:
        giai_raw = _get_tournament_for_admin_or_403(giai_id, user)
        if not giai_raw:
            return "Khong co quyen cap nhat giai dau nay", 403
        registrations = DangKyGiaiModel.get_by_tournament(giai_id)
        giai_detail = prepare_tournament_detail(giai_raw, registrations)
        quy_toi_da = float(giai_detail.get('quy_giai_thuong_thuc_te') or 0)

        prizes = []
        for field in ('tien_giai_1', 'tien_giai_2', 'tien_giai_3'):
            raw_value = (request.form.get(field) or '').strip()
            if raw_value == '':
                prizes.append(None)
            else:
                prizes.append(max(0, _money_from_form(raw_value)))

        if sum(value or 0 for value in prizes) > quy_toi_da:
            return redirect(f'/giai-dau/{giai_id}/admin?error=prize_over')

        TournamentModel.update_prizes(giai_id, prizes[0], prizes[1], prizes[2])
        DBLogger.log_success(f"Tournament prizes updated: {giai_id}", user.get('email'), f'/giai-dau/{giai_id}/cap-nhat-giai-thuong')
        return redirect(f'/giai-dau/{giai_id}/admin')
    except Exception as e:
        DBLogger.log_error(f"Prize update error: {str(e)}", user.get('email'), f'/giai-dau/{giai_id}/cap-nhat-giai-thuong', context=traceback.format_exc())
        return f"Error: {str(e)}", 500


@app.route('/giai-dau/<int:giai_id>/phan-quyen/them', methods=['POST'])
@admin_required
def them_quyen_giai_dau(giai_id):
    user = session.get('user', {})
    try:
        giai_raw = _get_tournament_for_admin_or_403(giai_id, user)
        if not giai_raw or (not _is_super_admin(user) and giai_raw[21] not in (None, user.get('id'))):
            return "Khong co quyen phan quyen giai dau nay", 403
        admin_id = request.form.get('admin_id')
        if admin_id:
            TournamentModel.add_permission(giai_id, admin_id)
        return redirect(f'/giai-dau/{giai_id}/admin')
    except Exception as e:
        DBLogger.log_error(f"Error adding tournament permission: {str(e)}", user.get('email'), f'/giai-dau/{giai_id}/phan-quyen/them', context=traceback.format_exc())
        return f"Error: {str(e)}", 500


@app.route('/giai-dau/<int:giai_id>/phan-quyen/<int:permission_id>/xoa')
@admin_required
def xoa_quyen_giai_dau(giai_id, permission_id):
    user = session.get('user', {})
    try:
        giai_raw = _get_tournament_for_admin_or_403(giai_id, user)
        if not giai_raw or (not _is_super_admin(user) and giai_raw[21] not in (None, user.get('id'))):
            return "Khong co quyen phan quyen giai dau nay", 403
        TournamentModel.remove_permission(giai_id, permission_id)
        return redirect(f'/giai-dau/{giai_id}/admin')
    except Exception as e:
        DBLogger.log_error(f"Error removing tournament permission: {str(e)}", user.get('email'), f'/giai-dau/{giai_id}/phan-quyen/{permission_id}/xoa', context=traceback.format_exc())
        return f"Error: {str(e)}", 500


@app.route('/tran-dau/<int:tran_id>/cap-nhat-ty-so', methods=['POST'])
@admin_required
def cap_nhat_ty_so(tran_id):
    """Cập nhật tỷ số"""
    user = session.get('user', {})
    is_fetch_score_update = request.is_json or request.headers.get('X-Requested-With') == 'fetch'
    try:
        data = request.get_json(silent=True) or request.form
        diem_a_raw = data.get('diem_a')
        diem_b_raw = data.get('diem_b')
        thu_tu_raw = data.get('thu_tu_danh', 2)
        doi_dang_giao = data.get('doi_dang_giao', 'A')

        diem_a = int(diem_a_raw) if str(diem_a_raw or '').strip() != '' else (0 if is_fetch_score_update else None)
        diem_b = int(diem_b_raw) if str(diem_b_raw or '').strip() != '' else (0 if is_fetch_score_update else None)
        thu_tu_danh = int(thu_tu_raw) if str(thu_tu_raw) in ('1', '2') else 2

        with db_cursor() as cursor:
            cursor.execute("SELECT giai_dau_id FROM tran_dau WHERE id = %s;", (tran_id,))
            giai_id = cursor.fetchone()[0]
        giai_raw = _get_tournament_for_admin_or_403(giai_id, user)
        if not giai_raw:
            return "Khong co quyen cap nhat giai dau nay", 403

        before_match_count = len(MatchModel.get_all_by_tournament(giai_id)) if is_fetch_score_update else 0
        trang_thai, diem_a, diem_b = MatchModel.update_score(tran_id, diem_a, diem_b, thu_tu_danh, doi_dang_giao)
        _ensure_knockout_progress(giai_id)
        if not is_fetch_score_update:
            DBLogger.log_success(f"Match {tran_id} score updated: {diem_a}-{diem_b}-{thu_tu_danh}-{doi_dang_giao}", user.get('email'), f'/tran-dau/{tran_id}/cap-nhat-ty-so')
        if is_fetch_score_update:
            matches = MatchModel.get_all_by_tournament(giai_id)
            return jsonify({
                'success': True,
                'reload_required': len(matches) != before_match_count or (len(giai_raw) > 22 and giai_raw[22] == 'bang' and _is_done_status(trang_thai)),
                'tran_id': tran_id,
                'giai_id': giai_id,
                'diem_a': diem_a,
                'diem_b': diem_b,
                'thu_tu_danh': thu_tu_danh,
                'doi_dang_giao': doi_dang_giao,
                'trang_thai': _normalize_match_status(trang_thai),
                'ranking': (
                    _build_group_rankings(matches)
                    if len(giai_raw) > 22 and giai_raw[22] == 'bang'
                    else MatchModel.get_bang_xep_hang_by_matches(matches)
                ),
            })
        return redirect(f'/giai-dau/{giai_id}/admin')
    except Exception as e:
        DBLogger.log_error(f"Error updating match: {str(e)}", user.get('email'), f'/tran-dau/{tran_id}/cap-nhat-ty-so', context=traceback.format_exc())
        if is_fetch_score_update:
            return jsonify({'success': False, 'error': str(e)}), 500
        return f"❌ Error: {str(e)}", 500

@app.route('/giai-dau/<int:giai_id>/live-scores')
@login_required
def live_scores_giai_dau(giai_id):
    user = session.get('user', {})
    try:
        can_view = False
        if user.get('role') == 'admin':
            can_view = bool(_get_tournament_for_admin_or_403(giai_id, user))
        elif user.get('role') == 'vdv':
            can_view = DangKyGiaiModel.is_vdv_registered(giai_id, user.get('id'))

        if not can_view:
            return jsonify({'success': False, 'error': 'Khong co quyen xem giai dau nay'}), 403

        giai_raw = TournamentModel.get_details(giai_id)
        matches = MatchModel.get_all_by_tournament(giai_id)
        return jsonify({
            'success': True,
            'giai_id': giai_id,
            'ranking': (
                _build_group_rankings(matches)
                if giai_raw and len(giai_raw) > 22 and giai_raw[22] == 'bang'
                else MatchModel.get_bang_xep_hang_by_matches(matches)
            ),
            'matches': [
                {
                    'tran_id': match[0],
                    'diem_a': match[3],
                    'diem_b': match[4],
                    'trang_thai': _normalize_match_status(match[5]),
                    'thu_tu_danh': match[8] if len(match) > 8 else 2,
                    'doi_dang_giao': match[9] if len(match) > 9 else 'A',
                }
                for match in matches
            ]
        })
    except Exception as e:
        DBLogger.log_error(f"Error loading live scores: {str(e)}", user.get('email'), f'/giai-dau/{giai_id}/live-scores', context=traceback.format_exc())
        return jsonify({'success': False, 'error': str(e)}), 500


# ============ AUTH ROUTES ============

@app.route('/login', methods=['GET', 'POST'])
def login():
    """Đăng nhập"""
    try:
        if FLASK_SECRET_KEY_ERROR:
            DBLogger.log_error(
                FLASK_SECRET_KEY_ERROR,
                user_email=request.form.get('email'),
                route='/login',
                method=request.method,
                status_code=500,
            )
            return render_template('login.html', error=FLASK_SECRET_KEY_ERROR), 500

        if request.method == 'GET':
            return render_template('login.html')

        email = request.form.get('email')
        password = request.form.get('password')
        role = request.form.get('role')
        login_name = normalize_admin_user(email) if role == 'admin' else (email or '').strip().lower()

        if role == 'admin':
            user, error = AuthService.login_admin(login_name, password)
        else:
            vdv = VanDongVienModel.get_by_email(email)
            if vdv and password == '123456789':
                user = {"id": vdv[0], "ten": vdv[1], "email": vdv[2], "role": "vdv", "display_name": vdv[1]}
                error = None
            else:
                user, error = None, "Email hoặc mật khẩu sai"

        if user:
            session['user'] = user
            DBLogger.log_success(f"User {login_name} ({role}) logged in", login_name, '/login')
            return redirect(url_for('vdv_dashboard') if user.get('role') == 'vdv' else url_for('trang_chu'))

        DBLogger.log_warning(f"Failed login attempt: {login_name}", login_name, '/login')
        return render_template('login.html', error=error)
    except Exception as e:
        DBLogger.log_exception(
            f"Login failed with system error: {str(e)}",
            e,
            user_email=request.form.get('email'),
            route='/login',
            method=request.method,
            status_code=500,
            context=traceback.format_exc(),
            request_path=request.path,
            ip_address=request.headers.get('X-Forwarded-For', request.remote_addr),
            user_agent=request.headers.get('User-Agent'),
        )
        return render_template('login.html', error="Lỗi hệ thống"), 500

@app.route('/dang-xuat')
def logout():
    """Đăng xuất"""
    user = session.get('user', {})
    DBLogger.log_success(f"User logged out", user.get('email'), '/dang-xuat')
    session.clear()
    return redirect(url_for('login'))

@app.route('/admin-settings')
@admin_required
def admin_settings():
    forbidden = _require_super_admin()
    if forbidden:
        return forbidden
    success_key = request.args.get('success')
    success_messages = {
        'created': 'Tạo admin thành công',
        'updated': 'Cập nhật admin thành công',
        'deleted': 'Xóa admin thành công',
    }
    return render_template(
        'admin_settings.html',
        admins=AdminUserModel.get_all(),
        success=success_messages.get(success_key),
        super_admin_email=SUPER_ADMIN_EMAIL,
    )

@app.route('/tao-admin', methods=['POST'])
@admin_required
def tao_admin():
    """Tạo admin"""
    user = session.get('user', {})
    try:
        forbidden = _require_super_admin()
        if forbidden:
            return forbidden
        email = normalize_admin_user(request.form.get('email'))
        display_name = (request.form.get('display_name') or '').strip() or email
        password = request.form.get('password')
        confirm = request.form.get('confirm_password')

        if not email or not password:
            return render_template('admin_settings.html', admins=AdminUserModel.get_all(), error="User admin & password required", super_admin_email=SUPER_ADMIN_EMAIL)
        if password != confirm:
            return render_template('admin_settings.html', admins=AdminUserModel.get_all(), error="Passwords don't match", super_admin_email=SUPER_ADMIN_EMAIL)
        if len(password) < 6:
            return render_template('admin_settings.html', admins=AdminUserModel.get_all(), error="Password min 6 chars", super_admin_email=SUPER_ADMIN_EMAIL)

        success, msg = AuthService.register_admin(email, password, display_name)

        if success:
            DBLogger.log_success(f"Admin created: {email}", user.get('email'), '/tao-admin')
            return redirect('/admin-settings?success=created')
        else:
            DBLogger.log_warning(f"Failed to create admin: {email}", user.get('email'), '/tao-admin')
            return render_template('admin_settings.html', admins=AdminUserModel.get_all(), error=msg, super_admin_email=SUPER_ADMIN_EMAIL)
    except Exception as e:
        DBLogger.log_error(f"Error creating admin: {str(e)}", user.get('email'), '/tao-admin', context=traceback.format_exc())
        return render_template('admin_settings.html', admins=AdminUserModel.get_all(), error=f"Error: {str(e)}", super_admin_email=SUPER_ADMIN_EMAIL)


@app.route('/admin-settings/<int:admin_id>/sua', methods=['POST'])
@admin_required
def sua_admin(admin_id):
    user = session.get('user', {})
    try:
        forbidden = _require_super_admin()
        if forbidden:
            return forbidden

        admin = AdminUserModel.get_by_id(admin_id)
        if not admin:
            return "Khong tim thay admin", 404

        email = normalize_admin_user(request.form.get('email'))
        display_name = (request.form.get('display_name') or '').strip() or email
        password = request.form.get('password') or ''
        confirm = request.form.get('confirm_password') or ''

        if not email:
            return render_template('admin_settings.html', admins=AdminUserModel.get_all(), error="User admin required", super_admin_email=SUPER_ADMIN_EMAIL), 400
        if normalize_admin_user(admin[1]) == SUPER_ADMIN_EMAIL and email != SUPER_ADMIN_EMAIL:
            return render_template('admin_settings.html', admins=AdminUserModel.get_all(), error="Khong the doi user admin goc", super_admin_email=SUPER_ADMIN_EMAIL), 400
        if AdminUserModel.email_exists(email, exclude_id=admin_id):
            return render_template('admin_settings.html', admins=AdminUserModel.get_all(), error="User admin da ton tai", super_admin_email=SUPER_ADMIN_EMAIL), 400
        if password or confirm:
            if password != confirm:
                return render_template('admin_settings.html', admins=AdminUserModel.get_all(), error="Passwords don't match", super_admin_email=SUPER_ADMIN_EMAIL), 400
            if len(password) < 6:
                return render_template('admin_settings.html', admins=AdminUserModel.get_all(), error="Password min 6 chars", super_admin_email=SUPER_ADMIN_EMAIL), 400
            AdminUserModel.update(admin_id, email, display_name, AuthService.hash_password(password))
        else:
            AdminUserModel.update(admin_id, email, display_name)

        if admin_id == user.get('id'):
            session['user']['email'] = email
            session['user']['display_name'] = display_name
        DBLogger.log_success(f"Admin updated: {email}", user.get('email'), f'/admin-settings/{admin_id}/sua')
        return redirect('/admin-settings?success=updated')
    except Exception as e:
        DBLogger.log_error(f"Error updating admin: {str(e)}", user.get('email'), f'/admin-settings/{admin_id}/sua', context=traceback.format_exc())
        return render_template('admin_settings.html', admins=AdminUserModel.get_all(), error=f"Error: {str(e)}", super_admin_email=SUPER_ADMIN_EMAIL), 500


@app.route('/admin-settings/<int:admin_id>/xoa', methods=['POST'])
@admin_required
def xoa_admin(admin_id):
    user = session.get('user', {})
    try:
        forbidden = _require_super_admin()
        if forbidden:
            return forbidden

        admin = AdminUserModel.get_by_id(admin_id)
        if not admin:
            return "Khong tim thay admin", 404
        if normalize_admin_user(admin[1]) == SUPER_ADMIN_EMAIL:
            return render_template('admin_settings.html', admins=AdminUserModel.get_all(), error="Khong the xoa admin goc", super_admin_email=SUPER_ADMIN_EMAIL), 400

        fallback = next((item for item in AdminUserModel.get_all() if normalize_admin_user(item[1]) == SUPER_ADMIN_EMAIL), None)
        if not fallback:
            return render_template('admin_settings.html', admins=AdminUserModel.get_all(), error="Khong tim thay admin goc de chuyen quyen so huu", super_admin_email=SUPER_ADMIN_EMAIL), 400

        AdminUserModel.delete(admin_id, fallback[0])
        DBLogger.log_success(f"Admin deleted: {admin[1]}", user.get('email'), f'/admin-settings/{admin_id}/xoa')
        return redirect('/admin-settings?success=deleted')
    except Exception as e:
        DBLogger.log_error(f"Error deleting admin: {str(e)}", user.get('email'), f'/admin-settings/{admin_id}/xoa', context=traceback.format_exc())
        return render_template('admin_settings.html', admins=AdminUserModel.get_all(), error=f"Error: {str(e)}", super_admin_email=SUPER_ADMIN_EMAIL), 500

# ============ VĐV ROUTES ============

@app.route('/vdv-dashboard')
@login_required
def vdv_dashboard():
    """VĐV Dashboard"""
    user = session.get('user', {})
    DBLogger.log_request('GET', '/vdv-dashboard', user.get('email'))

    if user.get('role') != 'vdv':
        return redirect(url_for('login'))

    try:
        vdv_id = user['id']
        tournaments_raw = DangKyGiaiModel.get_by_vdv(vdv_id)
        registrations_by_tournament = DangKyGiaiModel.get_by_tournaments([row[1] for row in tournaments_raw])

        vdv_giai = []
        for row in tournaments_raw:
            try:
                giai_raw = tuple(row[1:16])
                registrations = registrations_by_tournament.get(row[1], [])
                giai_detail = prepare_tournament_detail(giai_raw, registrations)
                vdv_giai.append(giai_detail)
            except Exception as e:
                DBLogger.log_error(f"Error loading tournament for VĐV: {str(e)}", user.get('email'), '/vdv-dashboard', context=traceback.format_exc())
                continue

        vdv_doi_bong = DoiBongModel.get_by_vdv(vdv_id)
        travel_trips = TravelTripModel.all_for_viewer(vdv_id, user.get('email'))
        return render_template(
            'vdv_dashboard.html',
            vdv_giai=vdv_giai,
            vdv_doi_bong=vdv_doi_bong,
            travel_trips=travel_trips,
        )
    except Exception as e:
        DBLogger.log_error(f"Error loading VĐV dashboard: {str(e)}", user.get('email'), '/vdv-dashboard', context=traceback.format_exc())
        return f"❌ Error: {str(e)}", 500


@app.route('/doi-bong/<int:doi_bong_id>/vdv')
@login_required
def chi_tiet_doi_bong_vdv(doi_bong_id):
    user = session.get('user', {})
    if user.get('role') != 'vdv':
        return redirect(url_for('login'))
    try:
        doi_bong = DoiBongModel.get_by_id_for_vdv(doi_bong_id, user['id'])
        if not doi_bong:
            return "Không có quyền xem đội bóng này", 403

        selected_month = request.args.get('thang') or _current_month()
        selected_month_date = DoiBongModel.normalize_month(selected_month)
        month_config = DoiBongModel.get_month_config(doi_bong_id, selected_month_date)
        members = DoiBongModel.get_members_with_payments(doi_bong_id, selected_month_date)
        expenses = DoiBongModel.get_expenses(doi_bong_id, selected_month_date)
        finance = FinanceService.tinh_toan_quy_doi_bong(month_config, members, expenses)
        available_months = DoiBongModel.get_available_months(doi_bong_id)
        if selected_month[:7] not in available_months:
            available_months.insert(0, selected_month[:7])

        DBLogger.log_request('GET', f'/doi-bong/{doi_bong_id}/vdv', user.get('email'))
        return render_template(
            'chi_tiet_doi_bong.html',
            doi_bong=doi_bong,
            finance=finance,
            selected_month=selected_month[:7],
            available_months=available_months,
            all_vdv=[],
            admins=[],
            permissions=[],
            can_edit=False,
            is_owner=False,
            current_vdv_id=user.get('id'),
        )
    except Exception as e:
        DBLogger.log_error(f"Error loading team for VĐV: {str(e)}", user.get('email'), f'/doi-bong/{doi_bong_id}/vdv', context=traceback.format_exc())
        return f"Error: {str(e)}", 500

@app.route('/giai-dau/<int:giai_id>/vdv')
@login_required
def chi_tiet_giai_vdv(giai_id):
    """Chi tiết giải (VĐV)"""
    user = session.get('user', {})

    if user.get('role') != 'vdv':
        return redirect(url_for('login'))

    try:
        vdv_id = user['id']
        tournaments = DangKyGiaiModel.get_by_vdv(vdv_id)
        if not any(t[1] == giai_id for t in tournaments):
            return "❌ Không có quyền", 403

        giai_raw = TournamentModel.get_details(giai_id)
        if not giai_raw:
            return "Không tìm thấy", 404

        registrations = DangKyGiaiModel.get_by_tournament(giai_id)
        giai_detail = prepare_tournament_detail(giai_raw, registrations)

        matches = MatchModel.get_all_by_tournament(giai_id)
        the_thuc_value = giai_raw[22] if len(giai_raw) > 22 and giai_raw[22] else 'vong_tron'
        ranking_matches = [m for m in matches if len(m) > 10 and m[10] == 'bang'] if the_thuc_value == 'bang' else matches
        xep_hang = MatchModel.get_bang_xep_hang_by_matches(ranking_matches) if ranking_matches else []

        top_3_donate = []
        if giai_detail.get('nguoi_choi_list'):
            sorted_players = sorted(giai_detail['nguoi_choi_list'], key=lambda x: x['tien_dong'], reverse=True)
            top_3_donate = [(p['ten'], p['tien_dong']) for p in sorted_players[:3]]
        giai_detail['top_3_donate'] = top_3_donate
        giai_detail['bang_xep_hang'] = xep_hang
        giai_detail['bang_xep_hang_theo_bang'] = _build_group_rankings(matches) if the_thuc_value == 'bang' else []
        giai_detail['matches'] = matches
        giai_detail['registrations'] = registrations
        giai_detail['user_role'] = 'vdv'

        # Build vong_dict for schedule display (same as admin route)
        vong_dict = {}
        for m in matches:
            vong = m[7] or 1
            if vong not in vong_dict:
                vong_dict[vong] = []
            vong_dict[vong].append({
                "id": m[0], "doi_a": m[1], "doi_b": m[2],
                "diem_a": m[3], "diem_b": m[4],
                "trang_thai": _normalize_match_status(m[5]), "san": m[6] or 1, "vong": vong,
                "thu_tu_danh": m[8] if len(m) > 8 and m[8] else 2,
                "doi_dang_giao": m[9] if len(m) > 9 and m[9] else 'A',
                "giai_doan": m[10] if len(m) > 10 and m[10] else 'vong_tron',
                "bang": m[11] if len(m) > 11 else None
            })
        giai_detail['vong_dict'] = vong_dict
        giai_detail['bang_dau_list'] = _build_group_team_list(matches)

        giai_detail['loai_dau'] = giai_raw[15] if len(giai_raw) > 15 and giai_raw[15] else 'don'
        giai_detail['the_thuc'] = the_thuc_value
        giai_detail['so_doi_moi_bang'] = int(giai_raw[23] if len(giai_raw) > 23 and giai_raw[23] else 4)
        giai_detail['so_bang'] = int(giai_raw[24] if len(giai_raw) > 24 and giai_raw[24] else 2)
        giai_detail['so_doi_vao_vong_trong'] = int(giai_raw[25] if len(giai_raw) > 25 and giai_raw[25] else 2)

        DBLogger.log_request('GET', f'/giai-dau/{giai_id}/vdv', user.get('email'))
        return render_template(
            'chi_tiet_giai_vdv.html',
            giai=giai_detail,
            registrations=registrations,
            enumerate=enumerate,
            current_vdv_id=vdv_id,
            current_vdv_name=user.get('ten'),
        )
    except Exception as e:
        DBLogger.log_error(f"Error loading tournament: {str(e)}", user.get('email'), f'/giai-dau/{giai_id}/vdv', context=traceback.format_exc())
        return f"❌ Error: {str(e)}", 500


def _redirect_legacy_travel_path():
    target = f"/thu-chi{request.path}"
    if request.query_string:
        target = f"{target}?{request.query_string.decode('utf-8', errors='ignore')}"
    return redirect(target, code=307 if request.method != 'GET' else 302)


@app.route('/chuyen-di', methods=['GET', 'POST'])
@app.route('/chuyen-di/<path:subpath>', methods=['GET', 'POST'])
@app.route('/thanh-vien', methods=['GET', 'POST'])
@app.route('/thanh-vien/<path:subpath>', methods=['GET', 'POST'])
@app.route('/goi-y', methods=['GET', 'POST'])
@app.route('/goi-y/<path:subpath>', methods=['GET', 'POST'])
@app.route('/nguoi-xem', methods=['GET', 'POST'])
@app.route('/nguoi-xem/<path:subpath>', methods=['GET', 'POST'])
@login_required
def legacy_travel_routes(subpath=None):
    return _redirect_legacy_travel_path()


app.wsgi_app = DispatcherMiddleware(app.wsgi_app, {
    "/thu-chi": travel_app.wsgi_app,
})


if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=False, host='0.0.0.0', port=port)
