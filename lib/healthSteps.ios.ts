// lib/healthSteps.ios.ts
import { Pedometer } from 'expo-sensors';

function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function getTodayStepsAbsolute(): Promise<number> {
  const now = new Date();
  const start = startOfDay(now);
  try {
    const res = await Pedometer.getStepCountAsync(start, now);
    const abs = Number(res?.steps ?? 0);
    return Number.isFinite(abs) && abs > 0 ? abs : 0;
  } catch (e) {
    console.log('IOS_ABS_STEPS_ERR', e);
    return 0;
  }
}
