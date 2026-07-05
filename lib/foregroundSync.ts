// lib/foregroundSync.ts
import { Platform } from 'react-native';
import BackgroundService from 'react-native-background-actions';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from './firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { getTodayStepsAbsolute } from './healthSteps';
import { extractUidFromGoogleUser, ymd } from './utils';

const STORAGE_KEYS = {
  stepsDate: 'steps_today_date',
  stepsValue: 'steps_today_value',
  pointsValue: 'points_value',
};

const POINT_UNIT_STEPS = 100;
const MAX_DAILY_STEPS = 10_000; // 하루 최대 걸음 (= 최대 100P)

async function ensureTodayReset() {
  const today = ymd(new Date());
  const savedDate = await AsyncStorage.getItem(STORAGE_KEYS.stepsDate);
  if (savedDate !== today) {
    await AsyncStorage.setItem(STORAGE_KEYS.stepsDate, today);
    await AsyncStorage.setItem(STORAGE_KEYS.stepsValue, '0');
  }
}

async function readLocalNumber(key: string) {
  const v = Number(await AsyncStorage.getItem(key));
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

async function writeLocalNumber(key: string, value: number) {
  try {
    await AsyncStorage.setItem(key, String(value));
  } catch {}
}

function stepsToPoints(steps: number) {
  return Math.floor(steps / POINT_UNIT_STEPS);
}

async function getUid(): Promise<string | null> {
  const raw = await AsyncStorage.getItem('googleUser');
  if (!raw) return null;
  return extractUidFromGoogleUser(raw);
}

async function getStudentInfo(): Promise<any | null> {
  const raw = await AsyncStorage.getItem('studentInfo');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function flushToCloud(uid: string, steps: number, points: number) {
  const date = ymd(new Date());
  const studentInfo = await getStudentInfo();

  await setDoc(
    doc(db, 'users', uid),
    {
      points,
      updatedAt: serverTimestamp(),
      ...(studentInfo
        ? {
            name: studentInfo.name,
            grade: studentInfo.grade,
            classNo: studentInfo.classNo,
            number: studentInfo.number,
            studentLabel: `${studentInfo.grade}학년${studentInfo.classNo}반${studentInfo.number}번 ${studentInfo.name}`,
          }
        : {}),
    },
    { merge: true }
  );

  if (steps > 0) {
    await setDoc(
      doc(db, 'users', uid, 'dailySteps', date),
      { steps, updatedAt: serverTimestamp() },
      { merge: true }
    );
  }
}

// ✅ 서비스 루프: 10~30초 간격으로 절대값 읽어서 보정
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ✅ 서비스 태스크: 실시간 센서 감시 모드
const task = async (taskDataArguments: any) => {
  const { intervalMs } = taskDataArguments;
  let subscription: any = null;

  try {
    const uid = await getUid();
    if (!uid) return;

    await ensureTodayReset();

    let lastStepsRead = 0;

    // ✅ Pedometer 실시간 감시 시작
    subscription = Pedometer.watchStepCount(async (result) => {
      const current = result.steps;
      const delta = current - lastStepsRead;
      lastStepsRead = current;

      if (delta <= 0) return;

      const localSteps = await readLocalNumber(STORAGE_KEYS.stepsValue);
      if (localSteps >= MAX_DAILY_STEPS) return;

      const available = MAX_DAILY_STEPS - localSteps;
      const safeDiff = Math.min(delta, available);
      const nextSteps = localSteps + safeDiff;

      await writeLocalNumber(STORAGE_KEYS.stepsValue, nextSteps);

      // 포인트 계산
      const prevPoints = await readLocalNumber(STORAGE_KEYS.pointsValue);
      const earnedIncrement = stepsToPoints(nextSteps) - stepsToPoints(localSteps);
      const nextPoints = earnedIncrement > 0 ? prevPoints + earnedIncrement : prevPoints;

      if (nextPoints !== prevPoints) {
        await writeLocalNumber(STORAGE_KEYS.pointsValue, nextPoints);
      }

      // 알림 업데이트 및 클라우드 동기화
      await BackgroundService.updateNotification({
        taskTitle: '걸음수 측정 중 (실시간)',
        taskDesc: `현재 ${nextSteps.toLocaleString()}걸음 (${nextPoints}P)`,
      });

      await flushToCloud(uid, nextSteps, nextPoints);
    });

    // 서비스 유지 (구독이 살아있는 동안 무한 대기)
    while (BackgroundService.isRunning()) {
      await sleep(intervalMs);
      // 날짜가 바뀌었는지 체크
      await ensureTodayReset();
    }
  } catch (e) {
    console.log('FG_SERVICE_ERR', e);
  } finally {
    if (subscription) subscription.remove();
  }
};

const options = {
  taskName: '만보기',
  taskTitle: '걸음수 저장중',
  taskDesc: '현재 걸음수를 불러오는 중...',
  taskIcon: {
    name: 'ic_launcher',
    type: 'mipmap',
  },
  color: '#f9c526',
  parameters: {
    intervalMs: 15000, // 15초 (원하면 10초/30초로 조절)
  },
};

export async function startForegroundSync() {
  if (Platform.OS !== 'android') return;
  if (BackgroundService.isRunning()) return;
  // ✅ 라이브러리 내부 expo-keep-awake 실패 포함 모든 에러 삼킴
  try {
    await BackgroundService.start(task, options as any);
  } catch (e) {
    console.log('FG_SYNC_START_ERR', e);
  }
}

export async function stopForegroundSync() {
  if (Platform.OS !== 'android') return;
  if (!BackgroundService.isRunning()) return;
  await BackgroundService.stop();
}

export async function isForegroundSyncRunning() {
  if (Platform.OS !== 'android') return false;
  return BackgroundService.isRunning();
}
