// lib/foregroundSync.ts
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

const task = async (taskDataArguments: any) => {
  const { intervalMs } = taskDataArguments;

  while (BackgroundService.isRunning()) {
    try {
      const uid = await getUid();
      if (!uid) {
        await sleep(intervalMs);
        continue;
      }

      await ensureTodayReset();

      const abs = await getTodayStepsAbsolute();
      if (!Number.isFinite(abs) || abs < 0) {
        await sleep(intervalMs);
        continue;
      }

      const localSteps = await readLocalNumber(STORAGE_KEYS.stepsValue);
      if (localSteps >= MAX_DAILY_STEPS) { // ✅ 일일 최대 도달
        await sleep(intervalMs);
        continue;
      }
      const diff = abs - localSteps;
      if (diff > 0) {
        const available = MAX_DAILY_STEPS - localSteps;
        const safeDiff = Math.min(diff > 8000 ? 8000 : diff, available); // ✅ 초과분 잘라내기
        const nextSteps = localSteps + safeDiff;
        await writeLocalNumber(STORAGE_KEYS.stepsValue, nextSteps);

        // 포인트는 "누적 steps 기반"으로 단순 계산
        const prevPoints = await readLocalNumber(STORAGE_KEYS.pointsValue);
        const target = stepsToPoints(nextSteps);
        // 상점 구매로 points가 내려갈 수 있으니, 여기서는 "증가분만" 반영하게 하려면 max 쓰면 안 됨.
        // 대신: "걸음으로 벌어들인 포인트"를 별도 필드로 관리해야 완벽함.
        // 일단 지금 구조 유지: 걸음 포인트가 기존보다 클 때만 올림.
        const nextPoints = target > prevPoints ? target : prevPoints;

        if (nextPoints !== prevPoints) {
          await writeLocalNumber(STORAGE_KEYS.pointsValue, nextPoints);
        }

        await flushToCloud(uid, nextSteps, nextPoints);

        // ✅ 알림 내용 업데이트
        await BackgroundService.updateNotification({
          taskDesc: `오늘 ${nextSteps.toLocaleString()}걸음 · ${nextPoints.toLocaleString()}P`,
        });
      }
    } catch (e) {
      console.log('FG_SERVICE_LOOP_ERR', e);
    }

    await sleep(intervalMs);
  }
};

const options = {
  taskName: '만보기',
  taskTitle: '만보기 실행 중',
  taskDesc: '백그라운드에서 걸음수를 동기화합니다.',
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
  if (BackgroundService.isRunning()) return;
  // ✅ 라이브러리 내부 expo-keep-awake 실패 포함 모든 에러 삼킴
  try {
    await BackgroundService.start(task, options as any);
  } catch (e) {
    console.log('FG_SYNC_START_ERR', e);
  }
}

export async function stopForegroundSync() {
  if (!BackgroundService.isRunning()) return;
  await BackgroundService.stop();
}

export async function isForegroundSyncRunning() {
  return BackgroundService.isRunning();
}
