import { Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { AppFeature, CurrentUser } from '../types';

export function requireUser(req: Express.Request, res: Response): CurrentUser | undefined {
  if (!req.session.user) {
    res.redirect('/login');
    return undefined;
  }
  return req.session.user;
}

export function requireFeature(req: Express.Request, res: Response, auth: AuthService, feature: AppFeature, adminOnly = false): CurrentUser | undefined {
  const user = requireUser(req, res);
  if (!user) return undefined;
  const featureSet = res.locals.featureSet as Set<string>;
  if ((adminOnly && user.role !== 'ADMIN') || !auth.can(user, feature, featureSet)) {
    res.status(403).render('error', { message: 'Không có quyền' });
    return undefined;
  }
  return user;
}

export function forbidden(res: Response, message = 'Không có quyền') {
  return res.status(403).render('error', { message });
}

export function notFound(res: Response, message = 'Không tìm thấy') {
  return res.status(404).render('error', { message });
}

/** Parse an toàn một id dạng chuỗi sang BigInt; trả về null nếu không hợp lệ (tránh 500). */
export function parseBigId(value: unknown): bigint | null {
  const raw = String(value ?? '').trim();
  if (!/^\d+$/.test(raw)) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

export function blankToNull(value?: string) {
  return value && value.trim() ? value.trim() : null;
}

export function safeNext(value?: string) {
  const next = String(value || '');
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('://')) return '';
  return next;
}

export function safeTournamentSection(value: unknown) {
  const section = String(value || 'settings');
  return ['players', 'fund', 'ranking', 'schedule', 'fees', 'settings'].includes(section) ? section : 'settings';
}

export function safeTeamSection(value: unknown) {
  const section = String(value || 'overview');
  return ['overview', 'members', 'settings'].includes(section) ? section : 'overview';
}
