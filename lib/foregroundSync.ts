// lib/foregroundSync.ts
import { Platform } from 'react-native';
import BackgroundService from 'react-native-background-actions';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Pedometer } from 'expo-sensors';
import { db } from './firebase';
import { doc, setDoc, serverTimestamp, increment } from 'firebase/firestore';
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

async function flushToCloud(uid: string, steps: number, pointsDelta: number) {
  const date = ymd(new Date());
  const studentInfo = await getStudentInfo();

  await setDoc(
    doc(db, 'users', uid),
    {
      updatedAt: serverTimestamp(),
      // ✅ 절대값 대신 증가분만 원자적으로 반영 (MainScreen과 동시에 써도 서로 덮어쓰지 않음)
      ...(pointsDelta > 0 ? { points: increment(pointsDelta) } : {}),
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

// ✅ watchStepCount 이벤트 기반으로 실시간 반영. sleep은 날짜 롤오버 체크용 유지 루프에만 사용
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
    // ✅ 이벤트가 겹쳐 들어와도 이전 처리(read-modify-write)가 끝난 뒤 순차 실행되도록 체이닝
    // (겹쳐서 실행되면 서로의 AsyncStorage 쓰기를 덮어써 포인트가 씹히는 원인이 됨)
    let chain: Promise<void> = Promise.resolve();

    // ✅ Pedometer 실시간 감시 시작
    subscription = Pedometer.watchStepCount((result) => {
      chain = chain.then(async () => {
        try {
          const current = result.steps;
          const delta = current - lastStepsRead;
          lastStepsRead = current;

          if (delta <= 0) return;

          await ensureTodayReset();

          const localSteps = await readLocalNumber(STORAGE_KEYS.stepsValue);
          if (localSteps >= MAX_DAILY_STEPS) return;

          const available = MAX_DAILY_STEPS - localSteps;
          const safeDiff = Math.min(delta, available);
          const nextSteps = localSteps + safeDiff;

          await writeLocalNumber(STORAGE_KEYS.stepsValue, nextSteps);

          // 포인트 계산 (이번 이벤트에서 새로 벌어들인 만큼만)
          const prevPoints = await readLocalNumber(STORAGE_KEYS.pointsValue);
          const earned = Math.max(0, stepsToPoints(nextSteps) - stepsToPoints(localSteps));
          const nextPoints = prevPoints + earned;

          if (earned > 0) {
            await writeLocalNumber(STORAGE_KEYS.pointsValue, nextPoints);
          }

          // 알림 업데이트 및 클라우드 동기화
          await BackgroundService.updateNotification({
            taskTitle: '걸음수 측정 중 (실시간)',
            taskDesc: `현재 ${nextSteps.toLocaleString()}걸음 (${nextPoints}P)`,
          });

          await flushToCloud(uid, nextSteps, earned);
        } catch (e) {
          console.log('FG_STEP_EVENT_ERR', e);
        }
      });
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
