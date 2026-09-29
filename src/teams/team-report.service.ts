import { Injectable } from '@nestjs/common';
import { CurrentUser } from '../types';
import { TeamCrudService } from './team-crud.service';
import { TeamDetailService } from './team-detail.service';

/**
 * Báo cáo tháng GỘP mọi đội mà admin đang quản lý (chủ app 28/9/2026): một admin lo 3 đội, có người
 * chơi ở 2–3 đội, trước đây phải mở từng đội cộng tay. Báo cáo trả lời ba câu: ai chơi ở những đội
 * nào, mỗi đội đóng bao nhiêu / còn thiếu bao nhiêu, và cộng lại theo người lẫn theo đội.
 *
 * Số của từng đội lấy ĐÚNG ảnh chụp tháng của trang chi tiết (`TeamDetailService.monthSnapshot` →
 * `TeamMonthReportBuilder`), nên báo cáo khớp từng đồng với "Khoản thu" của mỗi đội. Phần gộp là hàm
 * thuần `aggregateTeamReports` để test được không cần DB.
 *
 * Chỉ tính THÀNH VIÊN CỐ ĐỊNH (chủ app chốt 28/9/2026): bảng này để check tổng tiền phải đóng của cố
 * định, vãng lai không ghi vào đây — bản đầu có gộp cả khoản thu theo buổi, đã bỏ.
 */

export interface TeamSnapshotForReport {
  team: { id: bigint; name: string };
  members: Array<{
    playerId: bigint;
    memberType: string;
    typeLabel: string;
    expectedAmount: number;
    paidAmount: number;
    paymentStatus: string;
    player: { displayName: string; email: string | null };
  }>;
  finance: {
    memberCount: number;
    fixedCount: number;
    monthlyFee: number;
    totalDue: number;
    totalPaid: number;
    totalMissing: number;
    guestPaid: number;
    totalSpent: number;
    balance: number;
  };
  fundPreview: boolean;
}

/** Một dòng "người X ở đội Y" — CHỈ thành viên cố định (chủ app 28/9/2026: báo cáo là tiền phải đóng của cố định, vãng lai không ghi vào đây). */
export interface PersonTeamEntry {
  teamId: string;
  teamName: string;
  /** Mức phí cố định của đội đó trong tháng. */
  expectedAmount: number;
  /** Tiền phí đã đóng (dòng phí tháng), y như trang đội. */
  paidAmount: number;
  paymentStatus: string;
}

export interface PersonReportRow {
  key: string;
  name: string;
  email: string;
  teams: PersonTeamEntry[];
  teamCount: number;
  totalExpected: number;
  totalPaid: number;
  totalMissing: number;
  /** Chơi từ 2 đội trở lên — đúng ca chủ app khó theo dõi. */
  multi: boolean;
}

export interface TeamReportRow {
  teamId: string;
  name: string;
  fundPreview: boolean;
  memberCount: number;
  fixedCount: number;
  monthlyFee: number;
  totalDue: number;
  totalPaid: number;
  totalMissing: number;
  guestPaid: number;
  totalSpent: number;
  balance: number;
}

export interface TeamsMonthlyReport {
  month: string;
  teams: TeamReportRow[];
  people: PersonReportRow[];
  totals: {
    teamCount: number;
    peopleCount: number;
    multiTeamCount: number;
    totalDue: number;
    totalPaid: number;
    totalMissing: number;
    guestPaid: number;
    totalSpent: number;
    balance: number;
  };
}

/** Chuỗi tháng `YYYY-MM` hợp lệ, không thì tháng hiện tại. */
export function normalizeReportMonth(value: unknown): string {
  const raw = String(value || '').trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : new Date().toISOString().slice(0, 7);
}


/** Gộp ảnh chụp tháng của nhiều đội thành báo cáo theo người và theo đội. Thuần, không đụng DB. */
export function aggregateTeamReports(month: string, snapshots: TeamSnapshotForReport[]): TeamsMonthlyReport {
  const people = new Map<string, PersonReportRow>();
  const personFor = (key: string, name: string, email: string) => {
    let row = people.get(key);
    if (!row) {
      row = { key, name, email, teams: [], teamCount: 0, totalExpected: 0, totalPaid: 0, totalMissing: 0, multi: false };
      people.set(key, row);
    }
    return row;
  };
  const teams: TeamReportRow[] = snapshots.map((snapshot) => {
    // Chỉ cố định. Vãng lai (dòng GUEST cũ lẫn khoản thu theo buổi) không vào báo cáo này — chủ app
    // 28/9/2026: đây là bảng check tổng tiền phải đóng của cố định, vãng lai xem ở Khoản thu từng đội.
    for (const member of snapshot.members) {
      if (member.memberType !== 'FIXED') continue;
      const row = personFor(`player:${member.playerId}`, member.player.displayName, member.player.email || '');
      row.teams.push({
        teamId: String(snapshot.team.id),
        teamName: snapshot.team.name,
        expectedAmount: member.expectedAmount,
        paidAmount: member.paidAmount,
        paymentStatus: member.paymentStatus,
      });
    }
    const { finance } = snapshot;
    return {
      teamId: String(snapshot.team.id),
      name: snapshot.team.name,
      fundPreview: snapshot.fundPreview,
      memberCount: finance.memberCount,
      fixedCount: finance.fixedCount,
      monthlyFee: finance.monthlyFee,
      totalDue: finance.totalDue,
      totalPaid: finance.totalPaid,
      totalMissing: finance.totalMissing,
      guestPaid: finance.guestPaid,
      totalSpent: finance.totalSpent,
      balance: finance.balance,
    };
  });

  const rows = [...people.values()].map((row) => {
    row.teams.sort((a, b) => a.teamName.localeCompare(b.teamName, 'vi'));
    row.teamCount = row.teams.length;
    row.totalExpected = row.teams.reduce((sum, item) => sum + item.expectedAmount, 0);
    row.totalPaid = row.teams.reduce((sum, item) => sum + item.paidAmount, 0);
    row.totalMissing = row.teams.reduce((sum, item) => sum + Math.max(0, item.expectedAmount - item.paidAmount), 0);
    row.multi = row.teamCount >= 2;
    return row;
  });
  // Người chơi nhiều đội lên đầu (đúng thứ chủ app cần soi), rồi tới còn thiếu, rồi tên.
  rows.sort((a, b) => b.teamCount - a.teamCount || b.totalMissing - a.totalMissing || a.name.localeCompare(b.name, 'vi'));

  const sum = (pick: (team: TeamReportRow) => number) => teams.reduce((total, team) => total + pick(team), 0);
  return {
    month,
    teams,
    people: rows,
    totals: {
      teamCount: teams.length,
      peopleCount: rows.length,
      multiTeamCount: rows.filter((row) => row.multi).length,
      totalDue: sum((team) => team.totalDue),
      totalPaid: sum((team) => team.totalPaid),
      totalMissing: sum((team) => team.totalMissing),
      guestPaid: sum((team) => team.guestPaid),
      totalSpent: sum((team) => team.totalSpent),
      balance: sum((team) => team.balance),
    },
  };
}

@Injectable()
export class TeamReportService {
  constructor(
    private readonly crud: TeamCrudService,
    private readonly detail: TeamDetailService,
  ) {}

  /** Đội lấy theo đúng phạm vi `list(user)` — admin phụ chỉ thấy đội mình tạo hoặc được chia sẻ. */
  async monthlyReport(user: CurrentUser, rawMonth: unknown): Promise<TeamsMonthlyReport> {
    const month = normalizeReportMonth(rawMonth);
    const teams = await this.crud.list(user);
    const snapshots = await Promise.all(teams.map((team) => this.detail.monthSnapshot(team.id, month)));
    return aggregateTeamReports(month, snapshots);
  }
}
