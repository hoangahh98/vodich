import * as session from 'express-session';

export const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'vodich-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 12 * 60 * 60 * 1000 },
});
