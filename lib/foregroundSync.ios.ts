// lib/foregroundSync.ios.ts
// iOS에서는 HealthKit이 백그라운드를 자동 처리하므로 foreground service 불필요

export async function startForegroundSync(): Promise<void> {}
export async function stopForegroundSync(): Promise<void> {}
export async function isForegroundSyncRunning(): Promise<boolean> {
  return false;
}
