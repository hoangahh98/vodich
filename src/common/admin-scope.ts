import { CurrentUser } from '../types';

export function isRootAdmin(user: CurrentUser | undefined): boolean {
  return !!user && user.role === 'ADMIN' && user.email.toLowerCase() === rootAdminUsername();
}

export function rootAdminUsername(): string {
  return (process.env.APP_ADMIN_USERNAME || 'admin').toLowerCase();
}
