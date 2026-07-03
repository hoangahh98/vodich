export function isTravelSchemaMissing(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String(error.code) : '';
  const message = 'message' in error ? String(error.message) : '';
  return (code === 'P2021' || code === 'P2022') && /travel_/i.test(message);
}
