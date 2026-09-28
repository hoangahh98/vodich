import { Injectable } from '@nestjs/common';
import { CurrentUser } from '../types';
import { TeamCrudService } from './team-crud.service';
import { TeamDetailService } from './team-detail.service';
import { addMonths, monthDate } from './team-utils';

/**
 * Báo cáo tháng GỘP mọi đội mà admin đang quản lý (chủ app 28/9/2026): một admin lo 3 đội, có người
 * chơi ở 2–3 đội, trước đây phải mở từng đội cộng tay. Báo cáo trả lời ba câu: ai chơi ở những đội
 * nào, mỗi đội đóng bao nhiêu / còn thiếu bao nhiêu, và cộng lại theo người lẫn theo đội.
 *
 * Số của từng đội lấy ĐÚNG ảnh chụp tháng của trang chi tiết (`TeamDetailService.monthSnapshot` →
 * `TeamMonthReportBuilder`), nên báo cáo khớp từng đồng với "Khoản thu" của mỗi đội. Phần gộp là hàm
 * thuần `aggregateTeamReports` để test được không cần DB.
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
  guestReceipts: Array<{ playerId: bigint | null; guestName: string | null; amount: unknown; player?: { displayName: string } | null }>;
}

export interface PersonTeamEntry {
  teamId: string;
  teamName: string;
  memberType: string;
  typeLabel: string;
  expectedAmount: number;
  /** Tiền PHÍ đã đóng (dòng phí tháng) — đây mới là số so với mức phí, y như trang đội. */
  paidAmount: number;
  paymentStatus: string;
  /** Số buổi vãng lai ghi theo buổi (bảng team_guest_receipt) trong tháng. */
  sessions: number;
  /** Tiền vãng lai theo buổi. Tách riêng, KHÔNG trừ vào phần thiếu phí — trang đội cũng không trừ. */
  guestAmount: number;
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
  previousMonth: string;
  nextMonth: string;
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

const monthKey = (date: Date) => date.toISOString().slice(0, 7);

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
  const entryFor = (row: PersonReportRow, team: TeamSnapshotForReport['team']) => {
    const teamId = String(team.id);
    let entry = row.teams.find((item) => item.teamId === teamId);
    if (!entry) {
      entry = { teamId, teamName: team.name, memberType: 'GUEST', typeLabel: 'Vãng lai', expectedAmount: 0, paidAmount: 0, paymentStatus: 'UNPAID', sessions: 0, guestAmount: 0 };
      row.teams.push(entry);
    }
    return entry;
  };

  const teams: TeamReportRow[] = snapshots.map((snapshot) => {
    for (const member of snapshot.members) {
      const row = personFor(`player:${member.playerId}`, member.player.displayName, member.player.email || '');
      const entry = entryFor(row, snapshot.team);
      entry.memberType = member.memberType;
      entry.typeLabel = member.typeLabel;
      entry.expectedAmount = member.expectedAmount;
      entry.paidAmount += member.paidAmount;
      entry.paymentStatus = member.paymentStatus;
    }
    // Vãng lai ghi theo buổi: có hồ sơ VĐV thì gộp vào đúng người (kể cả khi họ là cố định ở đội khác),
    // không có thì đứng riêng theo tên khách.
    for (const receipt of snapshot.guestReceipts) {
      const amount = Number(receipt.amount || 0);
      const key = receipt.playerId ? `player:${receipt.playerId}` : `guest:${(receipt.guestName || 'Khách').trim().toLowerCase()}`;
      const name = receipt.player?.displayName || receipt.guestName || 'Khách';
      const row = personFor(key, name, '');
      const entry = entryFor(row, snapshot.team);
      entry.sessions += 1;
      entry.guestAmount += amount;
      if (entry.memberType === 'GUEST' && entry.paidAmount + entry.guestAmount > 0) entry.paymentStatus = 'PAID';
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
    // Đã đóng = phí + tiền buổi; còn thiếu chỉ so PHÍ với mức phí (tiền buổi không bù), khớp trang đội.
    row.totalPaid = row.teams.reduce((sum, item) => sum + item.paidAmount + item.guestAmount, 0);
    row.totalMissing = row.teams.reduce((sum, item) => sum + Math.max(0, item.expectedAmount - item.paidAmount), 0);
    row.multi = row.teamCount >= 2;
    return row;
  });
  // Người chơi nhiều đội lên đầu (đúng thứ chủ app cần soi), rồi tới còn thiếu, rồi tên.
  rows.sort((a, b) => b.teamCount - a.teamCount || b.totalMissing - a.totalMissing || a.name.localeCompare(b.name, 'vi'));

  const sum = (pick: (team: TeamReportRow) => number) => teams.reduce((total, team) => total + pick(team), 0);
  const base = monthDate(month);
  return {
    month,
    previousMonth: monthKey(addMonths(base, -1)),
    nextMonth: monthKey(addMonths(base, 1)),
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
