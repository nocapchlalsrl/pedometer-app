// lib/healthSteps.android.ts
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Android에서는 시스템(Health Connect) 동기화 지연을 피하기 위해
 * AsyncStorage에 저장된 오늘의 누적 걸음수를 '절대값'으로 반환합니다.
 * 실제 실시간 측정은 MainScreen과 foregroundSync의 Pedometer.watchStepCount가 담당합니다.
 */
export async function getTodayStepsAbsolute(): Promise<number> {
  try {
    const savedValue = await AsyncStorage.getItem('steps_today_value');
    const abs = Number(savedValue ?? '0');
    return Number.isFinite(abs) && abs > 0 ? abs : 0;
  } catch (e) {
    console.log('ANDROID_ABS_STEPS_ERR', e);
    return 0;
  }
}
