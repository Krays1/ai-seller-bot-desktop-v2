export function normalizeUser(name) {
  return (name || '').trim().toLowerCase().replace(/\s+/g, '_');
}
