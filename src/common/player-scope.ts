import { CurrentUser } from '../types';

/**
 * Điều kiện "vận động viên (vai CLIENT) này được XEM tài nguyên nào".
 *
 * Từ 9/2026 quyền xem của thành viên là bảng riêng (`player_tournament_access`,
 * `player_team_access`), do admin cấp ở màn hình Thành viên. Đang có tên trong giải KHÔNG còn
 * tự động đồng nghĩa với được xem giải — trừ một ngoại lệ có chủ ý:
 *
 * - Người đăng ký ngoài (qua link chia sẻ) chưa có hồ sơ `player`, nên không có chỗ để cấp
 *   quyền. Họ vẫn thấy đúng giải mình vừa đăng ký, khớp với trang "Đăng ký thành công" đã hứa
 *   với họ một tài khoản xem giải.
 *
 * So khớp bằng EMAIL, không bằng `user.id`: với người đăng ký ngoài, `user.id` là id của dòng
 * đăng ký chứ không phải id vận động viên — dùng nó làm playerId là mở nhầm dữ liệu của người
 * có id trùng (lỗi từng tồn tại ở bộ lọc đội bóng cũ).
 */
export function clientTournamentWhere(user: Pick<CurrentUser, 'email'>) {
  const email = { equals: user.email, mode: 'insensitive' as const };
  return {
    OR: [
      { playerAccess: { some: { player: { email } } } },
      { registrations: { some: { playerId: null, externalEmail: email, status: { in: ['ACTIVE', 'RESERVE'] } } } },
    ],
  };
}

export function clientTeamWhere(user: Pick<CurrentUser, 'email'>) {
  return { playerAccess: { some: { player: { email: { equals: user.email, mode: 'insensitive' as const } } } } };
}
