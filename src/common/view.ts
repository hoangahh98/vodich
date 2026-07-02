import { Response } from 'express';
import { CurrentUser } from '../types';
import { formatMoney } from './money';

export interface ViewLocals {
  currentUser?: CurrentUser;
  featureSet: Set<string>;
  flash?: string;
  formatMoney: (value: unknown) => string;
  path?: string;
}

export function render(res: Response, view: string, data: Record<string, unknown> = {}) {
  const locals = res.locals as ViewLocals;
  return res.render(view, {
    ...data,
    currentUser: locals.currentUser,
    featureSet: locals.featureSet ?? new Set<string>(),
    flash: locals.flash,
    formatMoney,
    path: locals.path,
  });
}

export function redirectBack(res: Response, fallback: string) {
  const target = res.req.get('referer') || fallback;
  return res.redirect(target);
}
