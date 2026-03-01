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
  InteractionManager,
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
import { db } from '../lib/firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

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

// ✅ Android 포그라운드 서비스
import { startForegroundSync, stopForegroundSync } from '../lib/foregroundSync';

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
  bgConsent: 'bg_consent',
  watchGuide: 'watch_guide_shown',
};

type StudentInfo = {
  grade: string;
  classNo: string;
  number: string;
  name: string;
};

function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function openAppSettings() {
  try {
    await Linking.openSettings();
  } catch (e) {
    console.log('OPEN_SETTINGS_ERR', e);
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
  const pendingStepsRef = useRef<number>(0);

  const subRef = useRef<any>(null);

  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const isAvailableRef = useRef<boolean | null>(null);
  const uidRef = useRef<string | null>(null);

  const lastCloudWriteAtRef = useRef<number>(0);

  // ✅ stale closure 방지: studentInfo를 ref로도 관리
  const studentInfoRef = useRef<StudentInfo | null>(null);

  // ✅ 포인트 규칙
  const POINT_UNIT_STEPS = 100;
  const MAX_DAILY_STEPS = 10_000; // 하루 최대 걸음 (= 최대 100P)
  const stepsToPoints = (steps: number) => Math.floor(steps / POINT_UNIT_STEPS);

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
      return safe;
    } catch {
      setCurrentPoints(0);
      pointsRef.current = 0;
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
        setStepCount(0);
        pendingStepsRef.current = 0;
        return;
      }

      const v = Number(savedValue ?? '0');
      const safe = Number.isFinite(v) && v >= 0 ? v : 0;
      baseStepsRef.current = safe;
      setStepCount(safe);
      // ✅ 로컬 캐시 기준으로 pendingSteps 복원
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
    const points = pointsRef.current;
    const info = studentInfoRef.current; // ✅ ref 사용 (stale closure 방지)

    try {
      await setDoc(
        userDocRef(uid),
        {
          points,
          updatedAt: serverTimestamp(),
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

      // ✅ steps > 0 일 때만 저장: 세션 시작 직후 baseStepsRef=0 상태에서
      // Firebase를 덮어쓰는 것을 방지 (탭 전환 시 0으로 덮어써지는 버그 수정)
      if (steps > 0) {
        await setDoc(
          dailyStepsDocRef(uid, date),
          { steps, updatedAt: serverTimestamp() },
          { merge: true }
        );
      }
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
          await saveLocalPoints(p);
        }
      }

      const dSnap = await getDoc(dailyStepsDocRef(uid, date));
      if (dSnap.exists()) {
        const data = dSnap.data() as any;
        const s = Number(data?.steps ?? 0);
        const safe = Number.isFinite(s) && s >= 0 ? s : 0;
        baseStepsRef.current = safe;
        setStepCount(safe);
        // ✅ 로드된 걸음 기준으로 pendingSteps 복원 (다음 포인트까지 남은 걸음 수)
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
      if (baseStepsRef.current >= MAX_DAILY_STEPS) return; // ✅ 일일 최대 도달

      const diff = abs - baseStepsRef.current;
      if (diff <= 0) return;

      const available = MAX_DAILY_STEPS - baseStepsRef.current;
      const safeDiff = Math.min(diff > 5000 ? 5000 : diff, available); // ✅ 초과분 잘라내기

      const newSteps = baseStepsRef.current + safeDiff;
      baseStepsRef.current = newSteps;
      setStepCount(newSteps);
      saveTodaySteps(newSteps).catch(() => {});

      pendingStepsRef.current += safeDiff;
      const addP = stepsToPoints(pendingStepsRef.current);
      if (addP > 0) {
        pendingStepsRef.current -= addP * POINT_UNIT_STEPS;

        // ✅ 실험: 포인트 지급 가능 여부 확인
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
    stopWatch();
    lastWatchStepsRef.current = 0;

    try {
      subRef.current = Pedometer.watchStepCount((result) => {
        const current = result?.steps ?? 0;
        const delta = current - lastWatchStepsRef.current;
        lastWatchStepsRef.current = current;

        if (delta <= 0) return;
        if (delta > 50) return;
        if (baseStepsRef.current >= MAX_DAILY_STEPS) return; // ✅ 일일 최대 도달

        const available = MAX_DAILY_STEPS - baseStepsRef.current;
        const actualDelta = Math.min(delta, available); // ✅ 초과분 잘라내기

        const newSteps = baseStepsRef.current + actualDelta;
        baseStepsRef.current = newSteps;
        setStepCount(newSteps);
        saveTodaySteps(newSteps).catch(() => {});

        pendingStepsRef.current += actualDelta;
        const addP = stepsToPoints(pendingStepsRef.current);
        if (addP > 0) {
          pendingStepsRef.current -= addP * POINT_UNIT_STEPS;

          // ✅ 실험: 포인트 지급 가능 여부 확인
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
        lastCloudWriteAtRef.current = 0; // throttle 우회
        flushToCloud().catch(() => {});
      };
    }, [])
  );

  // ===== guard (로그인/학생정보/uid) =====
  useFocusEffect(
    useCallback(() => {
      let alive = true;

      const guard = async () => {
        const googleUser = await AsyncStorage.getItem('googleUser');
        if (!googleUser) {
          if (!alive) return;
          router.replace('/login');
          return;
        }

        const uid = extractUidFromGoogleUser(googleUser);
        if (!uid) {
          if (!alive) return;
          router.replace('/login');
          return;
        }
        uidRef.current = uid;

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
          studentInfoRef.current = info; // ✅ ref 동기화 (flushToCloud stale closure 방지)
          await loadFromCloud(uid);
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

  // ✅ 최초 1회 백그라운드 동기화 동의 팝업 (Android만 서비스 시작)
  useEffect(() => {
    let mounted = true;

    const showBgConsentOnce = async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEYS.bgConsent);
        if (!mounted) return;
        if (saved !== null) return; // 이미 답변함 → init에서 처리됨

        Alert.alert(
          '백그라운드 걸음 동기화',
          '화면이 꺼지거나 앱이 백그라운드 상태일 때도\n걸음 수를 실시간으로 동기화합니다.\n\n허용하면 상태바에 만보기 알림이 상주합니다.\n(알림을 눌러 앱으로 돌아올 수 있습니다)\n\n허용하시겠습니까?',
          [
            {
              text: '거부',
              style: 'cancel',
              onPress: async () => {
                try {
                  await AsyncStorage.setItem(STORAGE_KEYS.bgConsent, 'denied');
                } catch {}
              },
            },
            {
              text: '허용',
              onPress: async () => {
                try {
                  await AsyncStorage.setItem(STORAGE_KEYS.bgConsent, 'granted');
                  // ✅ 동의 후 서비스 시작 (애니메이션 완료 후 시작으로 keep awake 에러 방지)
                  if (Platform.OS === 'android') {
                    InteractionManager.runAfterInteractions(() => {
                      setTimeout(() => { startForegroundSync(); }, 500);
                    });
                  }
                } catch {}
              },
            },
          ]
        );
      } catch (e) {
        console.log('BG_CONSENT_ERR', e);
      }
    };

    showBgConsentOnce();
    return () => {
      mounted = false;
    };
  }, []);

  // ✅ 최초 1회 갤럭시 워치 연동 안내 팝업 (Android만)
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let mounted = true;

    const showWatchGuideOnce = async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEYS.watchGuide);
        if (!mounted) return;
        if (saved !== null) return;

        // bgConsent 팝업과 겹치지 않도록 1초 지연
        await new Promise<void>(res => setTimeout(res, 1000));
        if (!mounted) return;

        Alert.alert(
          '갤럭시 워치 연동 안내',
          '갤럭시 워치를 사용 중이라면,\nSamsung Health 앱에서\nHealth Connect 연동을 켜주세요.\n\n워치에서 측정한 걸음 수가\n자동으로 반영됩니다.\n\nSamsung Health → 설정 →\nHealth Connect 연결',
          [
            {
              text: '확인했어요',
              onPress: async () => {
                try {
                  await AsyncStorage.setItem(STORAGE_KEYS.watchGuide, 'shown');
                } catch {}
              },
            },
          ]
        );
      } catch (e) {
        console.log('WATCH_GUIDE_ERR', e);
      }
    };

    showWatchGuideOnce();
    return () => {
      mounted = false;
    };
  }, []);

  // ===== init =====
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      await loadTodaySteps();
      await loadLocalPoints();

      // ✅ 재로그인/앱 데이터 초기화 후 Firebase에서 최신값 복구
      // guard(useFocusEffect)와 동시에 실행되면 race condition 발생 가능하므로
      // init 안에서 먼저 Firebase를 읽어 pedometer 시작 전에 올바른 값을 확보
      const googleRaw = await AsyncStorage.getItem('googleUser');
      const initUid = googleRaw ? extractUidFromGoogleUser(googleRaw) : null;
      if (initUid) {
        // ✅ 실험 주차/참여 여부 로드 (loadFromCloud 전에 ref 세팅해야 3주차 리셋 작동)
        const [expStatus, isInExp] = await Promise.all([
          getExperimentWeek(),
          getInExperiment(initUid),
        ]);
        setExperimentWeek(expStatus.week);
        setInExperiment(isInExp);
        experimentWeekRef.current = expStatus.week;
        inExperimentRef.current = isInExp;

        await loadFromCloud(initUid);
        uidRef.current = initUid; // ✅ pedometer 시작 전에 uid 확보 (flushToCloud가 null 아닌 uid 사용)
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

        // ✅ Android: 이전에 동의한 경우에만 포그라운드 서비스 시작
        // InteractionManager로 애니메이션이 완전히 끝난 후 시작 (keep awake 에러 방지)
        if (Platform.OS === 'android') {
          const consent = await AsyncStorage.getItem(STORAGE_KEYS.bgConsent);
          if (consent === 'granted') {
            InteractionManager.runAfterInteractions(() => {
              setTimeout(() => { startForegroundSync(); }, 500);
            });
          }
        }
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
        await syncAbsoluteTodaySteps();
        if (isAvailableRef.current) await startWatch();
      }

      if (prev === 'active' && nextState.match(/inactive|background/)) {
        await flushToCloud();
      }
    });

    return () => {
      mounted = false;
      try {
        subAppState.remove();
      } catch {}
      stopWatch();
      // ✅ Android: 앱 종료 시 포그라운드 서비스 중지
      if (Platform.OS === 'android') {
        stopForegroundSync().catch(() => {});
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
                : `남은 획득 가능 포인트: ${100 - Math.floor(stepCount / POINT_UNIT_STEPS)}P\n앱을 다시 열면 누락분을 자동 동기화합니다.`}
            </Text>
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
});
