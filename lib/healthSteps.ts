// lib/healthSteps.ts
// 이 파일은 플랫폼별 파일(healthSteps.ios.ts, healthSteps.android.ts)이 없을 때 fallback
// Metro 번들러는 .ios.ts / .android.ts를 우선 사용함

export async function getTodayStepsAbsolute(): Promise<number> {
  return 0;
}
