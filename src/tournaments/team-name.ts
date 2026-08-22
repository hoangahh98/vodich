/**
 * Tên đội đôi được lưu thành MỘT chuỗi `"An / Bình"` trong `match_game.team_a/team_b`, nên
 * cách nối và cách tách phải nằm chung một chỗ.
 *
 * File riêng (không nhét vào tournament-schedule) vì bảng xếp hạng cũng cần tách tên, mà
 * tournament-schedule đã import tournament-ranking — để chung là thành vòng lặp import.
 */

/** Dấu nối hai người trong tên một đội đôi. */
export const TEAM_NAME_SEPARATOR = ' / ';

/** Chỗ trống khi cả giải lẻ đúng một người: vẫn phải hiện tên người đó chứ không được rơi mất. */
export const WAITING_PARTNER = 'Chờ thành viên';

export function formatTeamName(first: string, second: string): string {
  return `${first}${TEAM_NAME_SEPARATOR}${second}`;
}

/**
 * Tách tên đội thành từng người. Đội đơn trả về đúng một tên.
 *
 * Nhận cả `"An/Bình"` lẫn `"An / Bình"` vì tên đội có thể do người dùng gõ tay ở màn ghép cặp
 * thủ công, không phải lúc nào cũng đi qua `formatTeamName`.
 */
export function splitTeamName(teamName: string): string[] {
  return String(teamName || '')
    .split(/\s*\/\s*/)
    .map((name) => name.trim())
    .filter(Boolean);
}
