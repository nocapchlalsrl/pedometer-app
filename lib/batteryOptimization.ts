// lib/batteryOptimization.ts
// Android: 배터리 최적화(절전 관리) 예외 요청
// 삼성/샤오미 등 제조사 커스텀 절전 기능은 포그라운드 서비스(알림 표시 중이어도)를
// 강제로 죽일 수 있음 → 사용자가 직접 "제외"로 설정해야 백그라운드 걸음 기록이 안정적으로 유지됨
import { Platform } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';

const PACKAGE_NAME = 'com.seoma.pedmeter';

export async function requestIgnoreBatteryOptimization(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
      { data: `package:${PACKAGE_NAME}` }
    );
  } catch (e) {
    console.log('BATTERY_OPT_REQUEST_ERR', e);
    // 일부 제조사 커스텀 ROM은 위 인텐트를 지원하지 않을 수 있음 → 목록 화면으로 대체
    try {
      await IntentLauncher.startActivityAsync(
        IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS
      );
    } catch (e2) {
      console.log('BATTERY_OPT_SETTINGS_FALLBACK_ERR', e2);
    }
  }
}
