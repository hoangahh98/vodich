import 'express-session';

export type UserRole = 'ADMIN' | 'CLIENT';
export type AppFeature = 'TOURNAMENTS' | 'TEAMS' | 'TRAVEL' | 'MEDICAL' | 'HOUSEHOLD' | 'PERMISSIONS';

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
}

declare module 'express-session' {
  interface SessionData {
    user?: CurrentUser;
    flash?: string;
  }
}
