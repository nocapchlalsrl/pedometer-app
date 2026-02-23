// app/MainScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Alert,
  AppState,
  AppStateStatus,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pedometer } from 'expo-sensors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import { useFocusEffect } from '@react-navigation/native';

// ✅ Firebase
import { db } from './lib/firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

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
  bgConsent: 'bg_consent', // ✅ 최초 1회 안내
};

type StudentInfo = {
  grade: string;
  classNo: string;
  number: string;
  name: string;
};

function ymd(date: Date) {
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

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

function extractUidFromGoogleUser(raw: string): string | null {
  try {
    const u = JSON.parse(raw);
    const uid =
      u?.uid ||
      u?.user?.uid ||
      u?.sub ||
      u?.id ||
      u?.user?.id ||
      u?.email; // 최후 수단
    return typeof uid === 'string' && uid.length > 0 ? uid : null;
  } catch {
    return null;
  }
}

export default function MainScreen() {
  const [stepCount, setStepCount] = useState<number>(0);
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');

  const [currentPoints, setCurrentPoints] = useState<number>(0);
  const [weatherTemp, setWeatherTemp] = useState<number>(13);

  const [studentInfo, setStudentInfo] = useState<StudentInfo | null>(null);

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

  // ✅ 포인트 규칙
  const POINT_UNIT_STEPS = 100; // 100걸음 = 1포인트
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
    if (now - lastCloudWriteAtRef.current < 5000) return; // 5초 스로틀
    lastCloudWriteAtRef.current = now;

    const date = ymd(new Date());
    const steps = baseStepsRef.current;
    const points = pointsRef.current;

    try {
      await setDoc(
        userDocRef(uid),
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

      await setDoc(
        dailyStepsDocRef(uid, date),
        { steps, updatedAt: serverTimestamp() },
        { merge: true }
      );
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
        await AsyncStorage.setItem(STORAGE_KEYS.stepsDate, date);
        await AsyncStorage.setItem(STORAGE_KEYS.stepsValue, String(safe));
      }
    } catch (e) {
      console.log('CLOUD_LOAD_ERR', e);
    }
  };

  // ✅ 백그라운드/화면꺼짐 누락 보정(절대값)
  const syncAbsoluteTodaySteps = async () => {
    try {
      const res = await Pedometer.getStepCountAsync(startOfDay(new Date()), new Date());
      const abs = res?.steps ?? 0;
      if (!Number.isFinite(abs) || abs < 0) return;

      const diff = abs - baseStepsRef.current;
      if (diff <= 0) return;

      // 안전장치
      const safeDiff = diff > 5000 ? 5000 : diff;

      const newSteps = baseStepsRef.current + safeDiff;
      baseStepsRef.current = newSteps;
      setStepCount(newSteps);
      saveTodaySteps(newSteps).catch(() => {});

      pendingStepsRef.current += safeDiff;
      const addP = stepsToPoints(pendingStepsRef.current);
      if (addP > 0) {
        pendingStepsRef.current -= addP * POINT_UNIT_STEPS;

        setCurrentPoints((prev) => {
          const next = prev + addP;
          pointsRef.current = next;
          saveLocalPoints(next).catch(() => {});
          return next;
        });
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

        // ✅ 너무 큰 튐 방지 (필요하면 조정)
        if (delta > 50) return;

        const newSteps = baseStepsRef.current + delta;
        baseStepsRef.current = newSteps;
        setStepCount(newSteps);
        saveTodaySteps(newSteps).catch(() => {});

        pendingStepsRef.current += delta;
        const addP = stepsToPoints(pendingStepsRef.current);
        if (addP > 0) {
          pendingStepsRef.current -= addP * POINT_UNIT_STEPS;

          setCurrentPoints((prev) => {
            const next = prev + addP;
            pointsRef.current = next;
            saveLocalPoints(next).catch(() => {});
            return next;
          });
        }

        flushToCloud().catch(() => {});
      });
    } catch (e) {
      console.log('PEDO_WATCH_ERR', e);
    }
  };

  // ===== guard (로그인/학생정보/uid) =====
  useFocusEffect(
    useCallback(() => {
      let alive = true;

      const guard = async () => {
        const googleUser = await AsyncStorage.getItem('googleUser');
        if (!googleUser) {
          if (!alive) return;
          router.replace('/');
          return;
        }

        const uid = extractUidFromGoogleUser(googleUser);
        if (!uid) {
          if (!alive) return;
          router.replace('/');
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

          // ✅ 서버값 우선 로드(재설치 복구)
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

  const studentLabel = studentInfo
    ? `${studentInfo.grade}${studentInfo.classNo}${studentInfo.number} ${studentInfo.name}`
    : '';

  // ✅ 최초 1회 “백그라운드 동기화” 안내 팝업
  useEffect(() => {
    let mounted = true;

    const showBgConsentOnce = async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEYS.bgConsent);
        if (!mounted) return;
        if (saved !== null) return;

        Alert.alert(
          '백그라운드 동기화',
          '앱을 사용하지 않는 동안(화면 꺼짐/백그라운드 포함)\n기기(OS)가 걸음 수를 누적합니다.\n\n앱을 다시 열면 누적된 걸음 수를 자동으로 동기화하여 반영합니다.\n\n허용하시겠습니까?',
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

  // ===== init =====
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      await loadTodaySteps();
      await loadLocalPoints();

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
              '걸음 수를 측정하려면 “신체 활동(활동 인식)” 권한을 허용해야 합니다.',
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

        // ✅ 시작 시 1회 보정
        await syncAbsoluteTodaySteps();

        await startWatch();
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

        // ✅ 앱 다시 켰을 때 누락분 보정(핵심)
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            <Ionicons name="cloudy-night-outline" size={32} color={COLORS.TEXT_GRAY} />
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
            <Text style={styles.stepUnit}>걸음</Text>
            <Text style={styles.smallInfo}>
              화면이 꺼져도 기기(OS)는 걸음 수를 누적합니다.
              {'\n'}
              앱을 다시 열면 누락분을 자동으로 동기화(보정)합니다.
            </Text>
          </View>
        </View>

        {/* ✅ 하단 탭이 이미 있으니, 여기엔 버튼 추가 안 함 */}
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
