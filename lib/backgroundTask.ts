// lib/backgroundTask.ts
// iOS HealthKit 백그라운드 동기화 Task (expo-background-fetch + expo-task-manager)
// HKObserverQuery → iOS wakes app → this task reads steps → saves to Firebase
// Android는 react-native-background-actions 포그라운드 서비스로 처리하므로 여기서는 iOS only

import { Platform } from 'react-native';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { getTodayStepsAbsolute } from './healthSteps';
import { db } from './firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { extractUidFromGoogleUser, ymd } from './utils';

export const PEDOMETER_BG_TASK = 'com.seoma.pedmeter.bg-sync';

const MAX_DAILY_STEPS = 10_000;
const POINT_UNIT_STEPS = 100;

// ─── Task Definition ──────────────────────────────────────────────────────────
// defineTask must be called at module-level (outside components) and before registerTaskAsync
TaskManager.defineTask(PEDOMETER_BG_TASK, async () => {
  try {
    if (Platform.OS !== 'ios') {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    const abs = await getTodayStepsAbsolute();
    if (!Number.isFinite(abs) || abs < 0) {
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }

    // Get user uid from AsyncStorage
    const googleRaw = await AsyncStorage.getItem('googleUser');
    if (!googleRaw) return BackgroundFetch.BackgroundFetchResult.NoData;

    const uid = extractUidFromGoogleUser(googleRaw);
    if (!uid) return BackgroundFetch.BackgroundFetchResult.NoData;

    const date = ymd(new Date());

    // Read locally cached steps for today
    const localDateRaw = await AsyncStorage.getItem('steps_today_date');
    const localStepsRaw = await AsyncStorage.getItem('steps_today_value');
    const localSteps =
      localDateRaw === date && localStepsRaw !== null ? Math.max(0, Number(localStepsRaw)) : 0;

    if (localSteps >= MAX_DAILY_STEPS) {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    // Session slack: offsets HealthKit steps that existed before the user started using the app today
    // Set by MainScreen.tsx when it first computes the slack, background task reads it
    const slackKey = `hk_slack_${date}`;
    const slackRaw = await AsyncStorage.getItem(slackKey);
    const slack = slackRaw !== null ? Number(slackRaw) : -1;

    // If MainScreen hasn't run yet today (e.g., background task fires at midnight)
    // compute and store the slack ourselves
    const effectiveSlack = slack >= 0 ? slack : Math.max(0, abs - localSteps);
    if (slack < 0) {
      await AsyncStorage.setItem(slackKey, String(effectiveSlack));
    }

    // Effective HealthKit value after removing pre-app steps
    const effectiveAbs = Math.max(localSteps, abs - effectiveSlack);
    const rawDiff = effectiveAbs - localSteps;
    const safeMax = MAX_DAILY_STEPS - localSteps;
    const diff = Math.min(rawDiff, safeMax);

    if (diff <= 0) {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    const newSteps = localSteps + diff;

    // Update local cache
    await AsyncStorage.setItem('steps_today_date', date);
    await AsyncStorage.setItem('steps_today_value', String(newSteps));

    // Calculate points delta
    const localPointsRaw = await AsyncStorage.getItem('points_value');
    const localPoints = localPointsRaw !== null ? Math.max(0, Number(localPointsRaw)) : 0;
    const prevUnits = Math.floor(localSteps / POINT_UNIT_STEPS);
    const newUnits = Math.floor(newSteps / POINT_UNIT_STEPS);
    const addP = Math.max(0, newUnits - prevUnits);
    const newPoints = localPoints + addP;

    if (addP > 0) {
      await AsyncStorage.setItem('points_value', String(newPoints));
    }

    // Save to Firebase
    const stepsRef = doc(db, 'users', uid, 'dailySteps', date);
    await setDoc(stepsRef, { steps: newSteps, updatedAt: serverTimestamp() }, { merge: true });

    if (addP > 0) {
      const userRef = doc(db, 'users', uid);
      await setDoc(userRef, { points: newPoints, updatedAt: serverTimestamp() }, { merge: true });
    }

    console.log(`[BG_TASK] +${diff} steps → ${newSteps}, +${addP}P → ${newPoints}P`);
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (e) {
    console.log('[BG_TASK_ERR]', e);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// ─── Register / Unregister ────────────────────────────────────────────────────
export async function registerBackgroundSync(): Promise<void> {
  if (Platform.OS !== 'ios') return;

  try {
    const status = await BackgroundFetch.getStatusAsync();
    if (
      status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
      status === BackgroundFetch.BackgroundFetchStatus.Denied
    ) {
      console.log('[BG_TASK] Background fetch restricted/denied');
      return;
    }

    const tasks = await TaskManager.getRegisteredTasksAsync();
    const alreadyRegistered = tasks.some((t) => t.taskName === PEDOMETER_BG_TASK);
    if (alreadyRegistered) return;

    await BackgroundFetch.registerTaskAsync(PEDOMETER_BG_TASK, {
      minimumInterval: 15 * 60, // iOS 최소 15분 (실제는 HKObserver가 앞당김)
      stopOnTerminate: false,   // 앱 종료 후에도 유지
      startOnBoot: false,
    });

    console.log('[BG_TASK] Registered');
  } catch (e) {
    console.log('[BG_TASK_REGISTER_ERR]', e);
  }
}
