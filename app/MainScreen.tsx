// app/MainScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Alert,
  AppState,
  AppStateStatus,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pedometer } from 'expo-sensors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import { useFocusEffect } from '@react-navigation/native';

// ✅ Firebase
import { db, auth } from '../lib/firebase';
import { doc, getDoc, setDoc, serverTimestamp, increment } from 'firebase/firestore';

// ✅ 공통 유틸
import { extractUidFromGoogleUser, ymd } from '../lib/utils';

// ✅ 실험 모듈
import {
  ExperimentWeek,
  canEarnPoints,
  getExperimentWeek,
  getInExperiment,
  weekLabel,
} from '../lib/experiment';

// ✅ 플랫폼별 절대 걸음수 (Android: Health Connect, iOS: Pedometer)
import { getTodayStepsAbsolute } from '../lib/healthSteps';
// ✅ Android 백그라운드 포그라운드 서비스 (iOS는 no-op 스텁)
import { startForegroundSync, stopForegroundSync, isForegroundSyncRunning } from '../lib/foregroundSync';
// ✅ Android 배터리 최적화 예외 요청
import { requestIgnoreBatteryOptimization } from '../lib/batteryOptimization';


const COLORS = {
  NAVY: '#0F172A',
  DARK_BG: '#1E293B',
  GOLD: '#f9c526',
  YELLOW: '#FFD600',
  TEXT_LIGHT: 'white',
  TEXT_GRAY: '#cfd6e4',
  DANGER: '#EF4444',
  OK: '#22C55E',
};

const STORAGE_KEYS = {
  stepsDate: 'steps_today_date',
  stepsValue: 'steps_today_value',
  pointsValue: 'points_value',
};

type StudentInfo = {
  grade: string;
  classNo: string;
  number: string;
  name: string;
};

async function openAppSettings() {
  try {
    await Linking.openSettings();
  } catch (e) {
    console.log('OPEN_SETTINGS_ERR', e);
  }
}

const BATTERY_OPT_PROMPT_KEY = 'battery_opt_prompt_shown_v1';

// ✅ 최초 1회, 배터리 최적화 예외를 요청하는 안내 팝업 (Android)
// 제조사 절전 관리로 포그라운드 서비스가 꺼져서 백그라운드 걸음 기록이 안 되는 걸 방지
async function maybePromptBatteryOptimization() {
  try {
    const shown = await AsyncStorage.getItem(BATTERY_OPT_PROMPT_KEY);
    if (shown) return;
    await AsyncStorage.setItem(BATTERY_OPT_PROMPT_KEY, '1');

    Alert.alert(
      '백그라운드 걸음 기록 설정',
      '화면을 끄거나 앱을 백그라운드로 보내도 걸음수가 계속 기록되려면, 이 앱을 배터리 최적화 대상에서 제외해야 합니다.\n\n"설정하기"를 눌러 허용해주세요.',
      [
        { text: '나중에', style: 'cancel' },
        { text: '설정하기', onPress: () => requestIgnoreBatteryOptimization() },
      ]
    );
  } catch (e) {
    console.log('BATTERY_OPT_PROMPT_ERR', e);
  }
}

// ✅ 날씨 코드 → Ionicons 아이콘 이름 매핑 (Open-Meteo WMO 코드)
function weatherCodeToIcon(code: number): string {
  if (code === 0) return 'sunny-outline';
  if (code <= 2) return 'partly-sunny-outline';
  if (code <= 48) return 'cloudy-outline';
  if (code <= 67) return 'rainy-outline';
  if (code <= 77) return 'snow-outline';
  if (code <= 82) return 'rainy-outline';
  return 'thunderstorm-outline';
}

export default function MainScreen() {
  const [stepCount, setStepCount] = useState<number>(0);
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');

  const [currentPoints, setCurrentPoints] = useState<number>(0);
  const [weatherTemp, setWeatherTemp] = useState<number>(13);
  const [weatherCode, setWeatherCode] = useState<number>(0);

  const [studentInfo, setStudentInfo] = useState<StudentInfo | null>(null);

  // ✅ 실험 상태
  const [inExperiment, setInExperiment] = useState<boolean>(false);
  const [experimentWeek, setExperimentWeek] = useState<ExperimentWeek>(0);
  const inExperimentRef = useRef<boolean>(false);
  const experimentWeekRef = useRef<ExperimentWeek>(0);

  // ✅ 최신값 refs
  const baseStepsRef = useRef<number>(0);
  const lastWatchStepsRef = useRef<number>(0);

  const pointsRef = useRef<number>(0);
  // ✅ 마지막으로 클라우드에 반영(flush)한 포인트 기준점.
  // flushToCloud는 이 값과 pointsRef.current의 "차이"만 원자적으로 더해서 보내므로,
  // 백그라운드 서비스(foregroundSync.ts)와 동시에 써도 서로 덮어쓰지 않음.
  const lastFlushedPointsRef = useRef<number>(0);
  const pendingStepsRef = useRef<number>(0);

  const subRef = useRef<any>(null);

  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const isAvailableRef = useRef<boolean | null>(null);
  const uidRef = useRef<string | null>(null);

  const lastCloudWriteAtRef = useRef<number>(0);

  // ✅ 걸음수 부드러운 애니메이션 refs
  const displayRef = useRef<number>(0);          // 현재 화면에 표시 중인 걸음수
  const animTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ✅ stale closure 방지: studentInfo를 ref로도 관리
  const studentInfoRef = useRef<StudentInfo | null>(null);

  // ✅ 세션 slack: HealthKit이 Firebase보다 앞선 걸음 (앱 실행 전 걸음 제외용)
  // 신규 유저가 앱 처음 켤 때 오늘 쌓인 걸음이 한번에 추가되는 것 방지
  const sessionSlackRef = useRef<number>(-1);

  // ✅ 포인트 규칙
  const POINT_UNIT_STEPS = 100;
  const MAX_DAILY_STEPS = 10_000;
  const stepsToPoints = (steps: number) => Math.floor(steps / POINT_UNIT_STEPS);

  // ✅ 초기화/리셋 및 백그라운드 따라잡기 시 즉시 표시 (애니메이션 없이)
  const snapStepCount = (v: number) => {
    if (animTimerRef.current) {
      clearTimeout(animTimerRef.current);
      animTimerRef.current = null;
    }
    displayRef.current = v;
    setStepCount(v);
  };

  // ✅ 실시간으로 걷는 중 걸음수 1씩 올라가는 애니메이션 (CashWalk-like)
  // 차이에 따라 속도 자동 조절: 항상 ~1.5초 안에 완료
  const animateStepCount = (target: number) => {
    if (animTimerRef.current) {
      clearTimeout(animTimerRef.current);
      animTimerRef.current = null;
    }
    const diff = target - displayRef.current;
    if (diff <= 0) return;

    const interval = Math.min(300, Math.max(10, Math.floor(1500 / diff)));

    const tick = () => {
      if (displayRef.current >= target) return;
      displayRef.current += 1;
      setStepCount(displayRef.current);
      if (displayRef.current < target) {
        animTimerRef.current = setTimeout(tick, interval);
      }
    };
    animTimerRef.current = setTimeout(tick, interval);
  };

  // ===== Firebase refs =====
  const userDocRef = (uid: string) => doc(db, 'users', uid);
  const dailyStepsDocRef = (uid: string, date: string) => doc(db, 'users', uid, 'dailySteps', date);

  // ===== Local load/save =====
  const loadLocalPoints = async () => {
    try {
      const v = Number(await AsyncStorage.getItem(STORAGE_KEYS.pointsValue));
      const safe = Number.isFinite(v) && v >= 0 ? v : 0;
      setCurrentPoints(safe);
      pointsRef.current = safe;
      lastFlushedPointsRef.current = safe;
      return safe;
    } catch {
      setCurrentPoints(0);
      pointsRef.current = 0;
      lastFlushedPointsRef.current = 0;
      return 0;
    }
  };

  const saveLocalPoints = async (v: number) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.pointsValue, String(v));
    } catch {}
  };

  const loadTodaySteps = async () => {
    const today = ymd(new Date());
    try {
      const savedDate = await AsyncStorage.getItem(STORAGE_KEYS.stepsDate);
      const savedValue = await AsyncStorage.getItem(STORAGE_KEYS.stepsValue);

      if (savedDate !== today) {
        await AsyncStorage.setItem(STORAGE_KEYS.stepsDate, today);
        await AsyncStorage.setItem(STORAGE_KEYS.stepsValue, '0');
        baseStepsRef.current = 0;
        snapStepCount(0);
        pendingStepsRef.current = 0;
        // 새 날: slack = 0 (오늘 HealthKit 걸음 전부 반영)
        // slack을 -1로 두면 abs - 0 = abs 전부 slack이 되어 걸음이 추가 안 됨
        sessionSlackRef.current = 0;
        return;
      }

      const v = Number(savedValue ?? '0');
      const safe = Number.isFinite(v) && v >= 0 ? v : 0;
      baseStepsRef.current = safe;
      snapStepCount(safe);
      pendingStepsRef.current = safe % POINT_UNIT_STEPS;
    } catch (e) {
      console.log('LOAD_STEPS_ERR', e);
      baseStepsRef.current = 0;
      setStepCount(0);
      pendingStepsRef.current = 0;
    }
  };

  const saveTodaySteps = async (value: number) => {
    const today = ymd(new Date());
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.stepsDate, today);
      await AsyncStorage.setItem(STORAGE_KEYS.stepsValue, String(value));
    } catch (e) {
      console.log('SAVE_STEPS_ERR', e);
    }
  };

  // ===== Cloud sync =====
  const flushToCloud = async () => {
    const uid = uidRef.current;
    if (!uid) return;

    const now = Date.now();
    if (now - lastCloudWriteAtRef.current < 5000) return;
    lastCloudWriteAtRef.current = now;

    const date = ymd(new Date());
    const steps = baseStepsRef.current;
    const info = studentInfoRef.current;

    // ✅ 절대값이 아니라 마지막 flush 이후 "증가분"만 원자적으로 반영.
    // 백그라운드 서비스(foregroundSync.ts)도 동시에 points를 increment하므로,
    // 절대값을 그대로 쓰면 둘 중 나중에 쓴 쪽이 상대방의 증가분을 지워버리는
    // (포인트가 씹히는) 문제가 생김.
    const pointsSnapshot = pointsRef.current;
    const pointsDelta = pointsSnapshot - lastFlushedPointsRef.current;

    try {
      await setDoc(
        userDocRef(uid),
        {
          updatedAt: serverTimestamp(),
          ...(pointsDelta > 0 ? { points: increment(pointsDelta) } : {}),
          ...(info
            ? {
                name: info.name,
                grade: info.grade,
                classNo: info.classNo,
                number: info.number,
                studentLabel: `${info.grade}학년${info.classNo}반${info.number}번 ${info.name}`,
              }
            : {}),
        },
        { merge: true }
      );

      if (steps > 0) {
        await setDoc(
          dailyStepsDocRef(uid, date),
          { steps, updatedAt: serverTimestamp() },
          { merge: true }
        );
      }

      lastFlushedPointsRef.current = pointsSnapshot;
    } catch (e) {
      console.log('CLOUD_FLUSH_ERR', e);
    }
  };

  const loadFromCloud = async (uid: string) => {
    const date = ymd(new Date());
    try {
      const uSnap = await getDoc(userDocRef(uid));
      if (uSnap.exists()) {
        const data = uSnap.data() as any;
        const p = Number(data?.points ?? 0);

        if (Number.isFinite(p) && p >= 0) {
          setCurrentPoints(p);
          pointsRef.current = p;
          lastFlushedPointsRef.current = p;
          await saveLocalPoints(p);
        }
      }

      const dSnap = await getDoc(dailyStepsDocRef(uid, date));
      if (dSnap.exists()) {
        const data = dSnap.data() as any;
        const s = Number(data?.steps ?? 0);
        const safe = Number.isFinite(s) && s >= 0 ? s : 0;
        baseStepsRef.current = safe;
        snapStepCount(safe);
        pendingStepsRef.current = safe % POINT_UNIT_STEPS;
        await AsyncStorage.setItem(STORAGE_KEYS.stepsDate, date);
        await AsyncStorage.setItem(STORAGE_KEYS.stepsValue, String(safe));
      }
    } catch (e) {
      console.log('CLOUD_LOAD_ERR', e);
    }
  };

  // ✅ 플랫폼별 절대값 보정 (Android: Health Connect, iOS: Pedometer)
  const syncAbsoluteTodaySteps = async () => {
    try {
      const abs = await getTodayStepsAbsolute();
      if (!Number.isFinite(abs) || abs < 0) return;
      if (baseStepsRef.current >= MAX_DAILY_STEPS) return;

      // ✅ 세션 첫 호출: HealthKit이 Firebase보다 앞선 걸음수를 slack으로 기록
      // 신규 유저가 앱 실행 전에 쌓은 걸음이 한번에 추가되는 것 방지
      if (sessionSlackRef.current < 0) {
        sessionSlackRef.current = Math.max(0, abs - baseStepsRef.current);
        // 백그라운드 Task가 동일 slack을 참조할 수 있도록 AsyncStorage에 저장
        const date = ymd(new Date());
        AsyncStorage.setItem(`hk_slack_${date}`, String(sessionSlackRef.current)).catch(() => {});
      }

      // slack 제거 후 실제 앱이 카운트해야 할 HealthKit 값
      const effectiveAbs = Math.max(baseStepsRef.current, abs - sessionSlackRef.current);
      const diff = effectiveAbs - baseStepsRef.current;
      if (diff <= 0) return;

      const available = MAX_DAILY_STEPS - baseStepsRef.current;
      const safeDiff = Math.min(diff > 5000 ? 5000 : diff, available);

      const newSteps = baseStepsRef.current + safeDiff;
      baseStepsRef.current = newSteps;
      snapStepCount(newSteps);
      saveTodaySteps(newSteps).catch(() => {});

      pendingStepsRef.current += safeDiff;
      const addP = stepsToPoints(pendingStepsRef.current);
      if (addP > 0) {
        pendingStepsRef.current -= addP * POINT_UNIT_STEPS;

        if (canEarnPoints(inExperimentRef.current, experimentWeekRef.current)) {
          setCurrentPoints((prev) => {
            const next = prev + addP;
            pointsRef.current = next;
            saveLocalPoints(next).catch(() => {});
            return next;
          });
        }
      }

      flushToCloud().catch(() => {});
    } catch (e) {
      console.log('SYNC_ABS_STEPS_ERR', e);
    }
  };

  // ===== Watch =====
  const stopWatch = () => {
    try {
      if (subRef.current && typeof subRef.current.remove === 'function') {
        subRef.current.remove();
      }
    } catch {}
    subRef.current = null;
  };

  const startWatch = async () => {
    // ✅ Android: 포그라운드 서비스가 실행 중이면 직접 감시(watch)를 중단하여 중복 카운팅 방지
    // 서비스가 AsyncStorage를 업데이트하면 3초 주기의 syncAbsoluteTodaySteps가 UI를 갱신함
    if (Platform.OS === 'android') {
      const running = await isForegroundSyncRunning();
      if (running) {
        console.log('[Main] Foreground Service is running, skipping local watch.');
        stopWatch();
        return;
      }
    }

    stopWatch();
    lastWatchStepsRef.current = -1; // -1 = 아직 첫 값 미수신

    try {
      subRef.current = Pedometer.watchStepCount((result) => {
        const current = result?.steps ?? 0;

        // 첫 콜백: 기준점만 설정하고 증분 적용 안 함 (초기 큰 delta 방지)
        if (lastWatchStepsRef.current < 0) {
          lastWatchStepsRef.current = current;
          return;
        }

        const delta = current - lastWatchStepsRef.current;
        lastWatchStepsRef.current = current;

        if (delta <= 0) return;
        // delta > 50 필터 제거: Android는 배치로 60~100걸음씩 전달할 수 있음
        // 3초마다 syncAbsoluteTodaySteps가 절대값으로 보정하므로 과도한 증분은 자동 수정됨
        if (baseStepsRef.current >= MAX_DAILY_STEPS) return;

        const available = MAX_DAILY_STEPS - baseStepsRef.current;
        const actualDelta = Math.min(delta, available);

        const newSteps = baseStepsRef.current + actualDelta;
        baseStepsRef.current = newSteps;
        animateStepCount(newSteps);
        saveTodaySteps(newSteps).catch(() => {});

        pendingStepsRef.current += actualDelta;
        const addP = stepsToPoints(pendingStepsRef.current);
        if (addP > 0) {
          pendingStepsRef.current -= addP * POINT_UNIT_STEPS;

          if (canEarnPoints(inExperimentRef.current, experimentWeekRef.current)) {
            setCurrentPoints((prev) => {
              const next = prev + addP;
              pointsRef.current = next;
              saveLocalPoints(next).catch(() => {});
              return next;
            });
          }
        }

        flushToCloud().catch(() => {});
      });
    } catch (e) {
      console.log('PEDO_WATCH_ERR', e);
    }
  };

  // ✅ 탭 이탈 시 즉시 Firebase 동기화 (shop 트랜잭션이 항상 최신값 읽도록)
  useFocusEffect(
    useCallback(() => {
      return () => {
        lastCloudWriteAtRef.current = 0;
        flushToCloud().catch(() => {});
      };
    }, [])
  );

  // ===== guard (로그인/학생정보/uid) =====
  useFocusEffect(
    useCallback(() => {
      let alive = true;

      const guard = async () => {
        // Firebase Auth 세션 복원 완료까지 대기 (앱 재시작 시 null 타이밍 방지)
        await auth.authStateReady();

        const firebaseUid = auth.currentUser?.uid ?? null;

        // Firebase UID가 없으면 -> googleUser AsyncStorage로 최후 확인
        if (!firebaseUid) {
          const googleUser = await AsyncStorage.getItem('googleUser');
          if (!googleUser) {
            // 진짜 아무 정보도 없을 때만 로그인으로 보냄
            if (!alive) return;
            router.replace('/login');
            return;
          }
          
          // googleUser는 있는데 Firebase 세션이 아직 안 올라온 경우
          // 절대 로그인 페이지로 보내지 않고, 로컬 UID로 최대한 버팀
          const localUid = extractUidFromGoogleUser(googleUser);
          if (localUid) {
            uidRef.current = localUid;
            // currentUid 자가 치유
            AsyncStorage.getItem('currentUid').then(stored => {
              if (!stored) AsyncStorage.setItem('currentUid', localUid);
            });
          } else {
            // 파싱 실패 시에만 로그인으로
            if (!alive) return;
            router.replace('/login');
            return;
          }
        } else {
          uidRef.current = firebaseUid;
        }

        const student = await AsyncStorage.getItem('studentInfo');
        if (!student) {
          if (!alive) return;
          router.replace('/signup');
          return;
        }

        try {
          const info = JSON.parse(student) as StudentInfo;
          if (!alive) return;
          setStudentInfo(info);
          studentInfoRef.current = info;
          if (uidRef.current) await loadFromCloud(uidRef.current);
        } catch {
          if (!alive) return;
          router.replace('/signup');
        }
      };

      guard();
      return () => {
        alive = false;
      };
    }, [])
  );

  // ===== 날씨 fetch (Open-Meteo, 무료/무키) =====
  useEffect(() => {
    const fetchWeather = async () => {
      try {
        const res = await fetch(
          'https://api.open-meteo.com/v1/forecast?latitude=36.57&longitude=128.51&current=temperature_2m,weather_code'
        );
        const json = await res.json();
        setWeatherTemp(Math.round(json?.current?.temperature_2m ?? 13));
        setWeatherCode(Number(json?.current?.weather_code ?? 0));
      } catch (e) {
        console.log('WEATHER_ERR', e);
      }
    };
    fetchWeather();
  }, []);



  // ===== init =====
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      await loadTodaySteps();
      await loadLocalPoints();

      const googleRaw = await AsyncStorage.getItem('googleUser');
      const initUid = googleRaw ? extractUidFromGoogleUser(googleRaw) : null;
      if (initUid) {
        const [expStatus, isInExp] = await Promise.all([
          getExperimentWeek(),
          getInExperiment(initUid),
        ]);
        setExperimentWeek(expStatus.week);
        setInExperiment(isInExp);
        experimentWeekRef.current = expStatus.week;
        inExperimentRef.current = isInExp;

        await loadFromCloud(initUid);
        uidRef.current = initUid;
      }
      if (!mounted) return;

      try {
        const available = await Pedometer.isAvailableAsync();
        if (!mounted) return;
        setIsAvailable(available);
        isAvailableRef.current = available;

        if (!available) return;

        try {
          const perm = await Pedometer.requestPermissionsAsync();
          if (!mounted) return;

          if (perm.granted) {
            setPermission('granted');
            if (Platform.OS === 'android') {
              maybePromptBatteryOptimization();
            }
          } else {
            setPermission('denied');
            Alert.alert(
              '활동 인식 권한 필요',
              '걸음 수를 측정하려면 "신체 활동(활동 인식)" 권한을 허용해야 합니다.',
              [
                { text: '취소', style: 'cancel' },
                { text: '설정 열기', onPress: openAppSettings },
              ]
            );
            return;
          }
        } catch (e) {
          console.log('PEDO_PERMISSION_ERR', e);
          if (!mounted) return;
          setPermission('unknown');
        }

        await syncAbsoluteTodaySteps();
        await startWatch();

        // ✅ 3초마다 HealthKit 절대값 재동기화 (포그라운드 실시간성 향상)
        if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = setInterval(() => {
          if (appStateRef.current === 'active') {
            syncAbsoluteTodaySteps().catch(() => {});
          }
        }, 3000);

      } catch (e) {
        console.log('PEDO_INIT_ERR', e);
        if (!mounted) return;
        setIsAvailable(false);
        isAvailableRef.current = false;
      }
    };

    init();

    const subAppState = AppState.addEventListener('change', async (nextState) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;

      if (prev.match(/inactive|background/) && nextState === 'active') {
        await loadTodaySteps();
        await loadLocalPoints();
        if (uidRef.current) await loadFromCloud(uidRef.current);
        // ✅ 백그라운드 복귀 시 slack 리셋 (Firebase 최신값 기준으로 재계산)
        // AsyncStorage slack key도 삭제 → 다음 syncAbsoluteTodaySteps에서 재계산 후 재저장
        sessionSlackRef.current = -1;
        AsyncStorage.removeItem(`hk_slack_${ymd(new Date())}`).catch(() => {});
        // ✅ 포그라운드로 복귀 → 백그라운드 서비스는 멈추고 화면 내 watch로 전환
        if (Platform.OS === 'android') {
          await stopForegroundSync();
        }
        await syncAbsoluteTodaySteps();
        if (isAvailableRef.current) await startWatch();
        // 3초 주기 동기화 재시작
        if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = setInterval(() => {
          if (appStateRef.current === 'active') {
            syncAbsoluteTodaySteps().catch(() => {});
          }
        }, 3000);
      }

      if (prev === 'active' && nextState.match(/inactive|background/)) {
        lastCloudWriteAtRef.current = 0; // throttle 무시하고 강제 저장
        await flushToCloud();

        // ✅ 백그라운드로 전환 → 화면 내 watch는 멈추고 포그라운드 서비스가 이어받음
        // (이게 빠져 있으면 앱을 끄거나 화면을 꺼도 걸음수가 전혀 기록되지 않음)
        if (Platform.OS === 'android') {
          stopWatch();
          if (syncIntervalRef.current) {
            clearInterval(syncIntervalRef.current);
            syncIntervalRef.current = null;
          }
          startForegroundSync().catch((e) => console.log('FG_SYNC_START_ERR', e));
        }
      }
    });

    return () => {
      mounted = false;
      try {
        subAppState.remove();
      } catch {}
      stopWatch();
      if (animTimerRef.current) {
        clearTimeout(animTimerRef.current);
        animTimerRef.current = null;
      }
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const studentLabel = studentInfo
    ? `${studentInfo.grade}${studentInfo.classNo}${String(studentInfo.number).padStart(2, '0')} ${studentInfo.name}`
    : '';

  const statusText = useMemo(() => {
    if (isAvailable === false) return '이 기기는 만보기 센서를 지원하지 않음';
    if (permission === 'denied') return '권한 거부됨 (설정에서 활동 인식 권한 허용 필요)';
    if (permission === 'granted') return '만보기 활성화됨 (앱 실행 중 실시간 측정)';
    if (isAvailable === null) return '센서 확인 중...';
    return '권한 확인 중...';
  }, [isAvailable, permission]);

  const statusColor = useMemo(() => {
    if (isAvailable === false || permission === 'denied') return COLORS.DANGER;
    if (permission === 'granted') return COLORS.OK;
    return COLORS.TEXT_GRAY;
  }, [isAvailable, permission]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.topInfoBar}>
          <View style={styles.weather}>
            <Ionicons name={weatherCodeToIcon(weatherCode) as any} size={32} color={COLORS.TEXT_GRAY} />
            <Text style={styles.temp}>{weatherTemp}°C</Text>
          </View>

          <View style={{ alignItems: 'flex-end' }}>
            {studentLabel ? <Text style={styles.studentText}>{studentLabel}</Text> : null}
            <View style={styles.points}>
              <Text style={styles.pBadgeText}>P</Text>
              <Text style={styles.pCount}>{currentPoints.toLocaleString()}</Text>
            </View>
          </View>
        </View>

        <Text style={[styles.status, { color: statusColor }]}>{statusText}</Text>

        {inExperiment && experimentWeek > 0 && (
          <Text style={styles.experimentBadge}>
            [실험 참여중] {weekLabel(experimentWeek)}
          </Text>
        )}

        {permission === 'denied' && (
          <TouchableOpacity style={styles.settingsBtn} onPress={openAppSettings}>
            <Text style={styles.settingsBtnText}>설정에서 권한 켜기</Text>
          </TouchableOpacity>
        )}

        <View style={styles.pedometerDisplay}>
          <View style={styles.pFace}>
            <Text style={styles.label}>오늘의 걸음</Text>
            <View style={styles.lcd}>
              <Text style={styles.digits}>{String(stepCount).padStart(5, '0')}</Text>
            </View>
            <Text style={styles.stepUnit}>
              걸음 / 10,000
            </Text>
            <Text style={styles.smallInfo}>
              {stepCount >= MAX_DAILY_STEPS
                ? '오늘 목표를 달성했습니다! (최대 100P 획득)'
                : `남은 획득 가능 포인트: ${100 - Math.floor(stepCount / POINT_UNIT_STEPS)}P`}
            </Text>
            {Platform.OS === 'android' && (
              <Text style={styles.healthKitNote}>하루에 한 번씩 앱에 접속해야 점수가 올라갑니다</Text>
            )}
          </View>
        </View>

        <View style={{ height: 12 }} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.NAVY },
  container: { flex: 1, backgroundColor: COLORS.DARK_BG, paddingHorizontal: 20 },

  topInfoBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    paddingVertical: 10,
  },
  weather: { flexDirection: 'row', alignItems: 'center' },
  temp: { fontSize: 20, color: COLORS.TEXT_GRAY, marginLeft: 10 },
  studentText: { color: COLORS.TEXT_GRAY, fontSize: 14, marginBottom: 4 },
  points: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.GOLD,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  pBadgeText: { fontSize: 18, fontWeight: '900', color: COLORS.DARK_BG, marginRight: 4 },
  pCount: { fontSize: 18, fontWeight: 'bold', color: COLORS.DARK_BG },

  status: { marginTop: 6, fontSize: 13, fontWeight: '800' },
  experimentBadge: { marginTop: 4, fontSize: 11, color: '#94A3B8', fontWeight: '700' },

  settingsBtn: {
    marginTop: 10,
    alignSelf: 'flex-start',
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#334155',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  settingsBtnText: { color: COLORS.TEXT_LIGHT, fontWeight: '800' },

  pedometerDisplay: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pFace: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.NAVY,
    padding: 26,
    borderRadius: 200,
    width: 320,
    height: 320,
    borderColor: COLORS.GOLD,
    borderWidth: 4,
  },
  label: { color: COLORS.TEXT_GRAY, fontSize: 16, marginBottom: 8 },
  lcd: { backgroundColor: COLORS.YELLOW, paddingVertical: 18, paddingHorizontal: 22, borderRadius: 10 },
  digits: { fontSize: 52, fontWeight: 'bold', color: COLORS.DARK_BG },
  stepUnit: { color: COLORS.TEXT_GRAY, fontSize: 16, marginTop: 8 },
  smallInfo: { marginTop: 10, color: COLORS.TEXT_GRAY, fontSize: 11, textAlign: 'center' },
  healthKitNote: { marginTop: 8, color: '#9CA3AF', fontSize: 13, textAlign: 'center', fontWeight: '500' },
});
