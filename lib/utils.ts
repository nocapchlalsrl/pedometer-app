// lib/utils.ts

export function extractUidFromGoogleUser(raw: string): string | null {
  try {
    const u = JSON.parse(raw);
    const uid =
      u?.uid ||
      u?.user?.uid ||
      u?.sub ||
      u?.id ||
      u?.user?.id ||
      u?.email;
    return typeof uid === 'string' && uid.length > 0 ? uid : null;
  } catch {
    return null;
  }
}

export function ymd(date: Date) {
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}
