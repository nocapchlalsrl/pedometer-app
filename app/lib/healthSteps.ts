// app/lib/healthSteps.ts
import { Platform } from 'react-native';
import { Pedometer } from 'expo-sensors';

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

/**
 * 오늘 걸음수 "절대값" 가져오기
 * - Android: Health Connect(Steps record 합산)
 * - iOS: expo-sensors Pedometer.getStepCountAsync(startOfDay, now)
 *
 * 이 함수는 "앱이 다시 켜졌을 때 누락분 보정" 용도로 쓰면 안정적임.
 */
export async function getTodayStepsAbsolute(): Promise<number> {
  const now = new Date();
  const start = startOfDay(now);

  // iOS: HealthKit 없이도 Pedometer 절대값은 대부분 동작함(기기/권한에 따라 0일 수 있음)
  if (Platform.OS === 'ios') {
    try {
      const res = await Pedometer.getStepCountAsync(start, now);
      const abs = Number(res?.steps ?? 0);
      return Number.isFinite(abs) && abs > 0 ? abs : 0;
    } catch (e) {
      console.log('IOS_ABS_STEPS_ERR', e);
      return 0;
    }
  }

  // Android: Health Connect
  try {
    const status = await getSdkStatus();
    if (String(status) !== 'available') return 0;

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
