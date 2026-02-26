// app/(tabs)/my.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { extractUidFromGoogleUser } from '../../lib/utils';
import { db } from '../../lib/firebase';
import {
  doc,
  onSnapshot,
  collection,
  getDocs,
  Timestamp,
} from 'firebase/firestore';
import { useFocusEffect } from '@react-navigation/native';

const COLORS = {
  BG: '#0F172A',
  PANEL: '#1E293B',
  TEXT: '#E5E7EB',
  SUB: '#94A3B8',
  GOLD: '#f9c526',
  BORDER: '#334155',
};

type StudentInfo = {
  grade: string;
  classNo: string;
  number: string;
  name: string;
};

function fmtTS(ts?: Timestamp | null) {
  if (!ts) return '';
  const d = ts.toDate();
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yy}-${mm}-${dd} ${hh}:${mi}`;
}

export default function MyPageTab() {
  const [uid, setUid] = useState<string | null>(null);
  const [studentInfo, setStudentInfo] = useState<StudentInfo | null>(null);

  const [points, setPoints] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<Timestamp | null>(null);

  const [totalSteps, setTotalSteps] = useState(0);
  const [loadingTotal, setLoadingTotal] = useState(false);

  const studentLabel = useMemo(() => {
    if (!studentInfo) return '';
    return `${studentInfo.grade}${studentInfo.classNo}${studentInfo.number} ${studentInfo.name}`;
  }, [studentInfo]);

  // uid / studentInfo 로드
  useEffect(() => {
    const init = async () => {
      const googleUser = await AsyncStorage.getItem('googleUser');
      if (!googleUser) return;
      const u = extractUidFromGoogleUser(googleUser);
      if (!u) return;
      setUid(u);

      const s = await AsyncStorage.getItem('studentInfo');
      if (s) {
        try {
          setStudentInfo(JSON.parse(s));
        } catch {}
      }
    };
    init();
  }, []);

  // 포인트는 실시간 구독
  useEffect(() => {
    if (!uid) return;

    const unsub = onSnapshot(doc(db, 'users', uid), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() as any;
      const p = Number(data?.points ?? 0);
      setPoints(Number.isFinite(p) && p >= 0 ? p : 0);
      setUpdatedAt((data?.updatedAt as Timestamp) ?? null);
    });

    return () => unsub();
  }, [uid]);

  // 총 걸음수 = dailySteps 전부 합(가장 단순/안전)
  const loadTotalSteps = async () => {
    if (!uid) return;
    setLoadingTotal(true);
    try {
      const snap = await getDocs(collection(db, 'users', uid, 'dailySteps'));
      let sum = 0;
      snap.forEach((d) => {
        const steps = Number((d.data() as any)?.steps ?? 0);
        if (Number.isFinite(steps) && steps > 0) sum += steps;
      });
      setTotalSteps(sum);
    } catch (e) {
      console.log('TOTAL_STEPS_ERR', e);
      setTotalSteps(0);
    } finally {
      setLoadingTotal(false);
    }
  };

  // 탭 들어올 때마다 총합 새로고침
  useFocusEffect(
    React.useCallback(() => {
      loadTotalSteps();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uid])
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>마이페이지</Text>
        <Text style={styles.subtitle}>내 정보 / 포인트 / 총 걸음수</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>학생 정보</Text>
          <Text style={styles.cardSub}>{studentLabel || '불러오는 중...'}</Text>
        </View>

        <View style={styles.row2}>
          <View style={[styles.card, { flex: 1, marginRight: 10 }]}>
            <Text style={styles.cardTitle}>포인트</Text>
            <Text style={styles.big}>{points.toLocaleString()} P</Text>
            <Text style={styles.cardSub}>최근 갱신: {updatedAt ? fmtTS(updatedAt) : '-'}</Text>
          </View>

          <View style={[styles.card, { flex: 1 }]}>
            <Text style={styles.cardTitle}>총 걸음수</Text>
            <Text style={styles.big}>{totalSteps.toLocaleString()} 걸음</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
              <TouchableOpacity style={styles.refreshBtn} onPress={loadTotalSteps} disabled={loadingTotal}>
                <Text style={styles.refreshText}>새로고침</Text>
              </TouchableOpacity>
              {loadingTotal ? <ActivityIndicator style={{ marginLeft: 10 }} /> : null}
            </View>
          </View>
        </View>

        <View style={styles.hintCard}>
          <Text style={styles.hintTitle}>참고</Text>
          <Text style={styles.hintText}>
            총 걸음수는 Firebase에 저장된 날짜별(dailySteps) 합계로 계산합니다.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.BG },
  container: { flex: 1, padding: 20 },
  title: { color: COLORS.TEXT, fontSize: 26, fontWeight: '900' },
  subtitle: { color: COLORS.SUB, marginTop: 6, marginBottom: 18 },

  row2: { flexDirection: 'row' },

  card: {
    backgroundColor: COLORS.PANEL,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    marginBottom: 12,
  },
  cardTitle: { color: COLORS.TEXT, fontSize: 14, fontWeight: '900' },
  cardSub: { color: COLORS.SUB, marginTop: 6, lineHeight: 18 },
  big: { color: COLORS.TEXT, fontSize: 22, fontWeight: '900', marginTop: 10 },

  refreshBtn: {
    backgroundColor: COLORS.GOLD,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  refreshText: { color: COLORS.BG, fontWeight: '900' },

  hintCard: {
    backgroundColor: '#0B1220',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    marginTop: 10,
  },
  hintTitle: { color: COLORS.TEXT, fontWeight: '900' },
  hintText: { color: COLORS.SUB, marginTop: 6, lineHeight: 18 },
});
