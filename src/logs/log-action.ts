import { Request } from 'express';

const UUID_RE = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi;
const NUMERIC_ID_RE = /\/\d+(?=\/|$)/g;

export function httpAction(req: Request) {
  return `${req.method} ${normalizedPath(req.path)}`;
}

export function normalizedPath(path: string) {
  return path.replace(UUID_RE, '/:id').replace(NUMERIC_ID_RE, '/:id');
}
