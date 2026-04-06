// lib/healthSteps.android.ts
import {
  initialize,
  getSdkStatus,
  requestPermission,
  readRecords,
} from 'react-native-health-connect';

function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function getTodayStepsAbsolute(): Promise<number> {
  const now = new Date();
  const start = startOfDay(now);
  try {
    const status = await getSdkStatus();
    if (status !== 3) return 0;

    await initialize();

    await requestPermission([
      { accessType: 'read', recordType: 'Steps' },
    ]);

    const res = await readRecords('Steps', {
      timeRangeFilter: {
        operator: 'between',
        startTime: start.toISOString(),
        endTime: now.toISOString(),
      },
    });

    const total = (res.records ?? []).reduce((sum: number, r: any) => {
      const c = Number(r?.count ?? 0);
      return sum + (Number.isFinite(c) ? c : 0);
    }, 0);

    return total > 0 ? total : 0;
  } catch (e) {
    console.log('ANDROID_ABS_STEPS_ERR', e);
    return 0;
  }
}
