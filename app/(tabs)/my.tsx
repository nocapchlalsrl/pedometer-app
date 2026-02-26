// app/(tabs)/my.tsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
} from 'react-native';
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
  deleteDoc,
  writeBatch,
} from 'firebase/firestore';
import { useFocusEffect } from '@react-navigation/native';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { fireLogout } from '../../lib/authEvents';

const COLORS = {
  BG: '#0F172A',
  PANEL: '#1E293B',
  TEXT: '#E5E7EB',
  SUB: '#94A3B8',
  GOLD: '#f9c526',
  BORDER: '#334155',
  DANGER: '#EF4444',
};

// ✅ 개인정보처리방침 URL (배포 후 실제 URL로 교체)
const PRIVACY_POLICY_URL = 'https://nocapchlalsrl.github.io/pedometer-app/privacy.html';

const ALL_STORAGE_KEYS = [
  'googleUser',
  'studentInfo',
  'currentUid',
  'steps_today_date',
  'steps_today_value',
  'points_value',
  'bg_consent',
];

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

async function clearLocalData() {
  await AsyncStorage.multiRemove(ALL_STORAGE_KEYS);
}

export default function MyPageTab() {
  const [uid, setUid] = useState<string | null>(null);
  const [studentInfo, setStudentInfo] = useState<StudentInfo | null>(null);

  const [points, setPoints] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<Timestamp | null>(null);

  const [totalSteps, setTotalSteps] = useState(0);
  const [loadingTotal, setLoadingTotal] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

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

  // 총 걸음수
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

  useFocusEffect(
    React.useCallback(() => {
      loadTotalSteps();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uid])
  );

  // ===== 로그아웃 =====
  const handleLogout = () => {
    Alert.alert('로그아웃', '로그아웃 하시겠습니까?', [
      { text: '취소', style: 'cancel' },
      {
        text: '로그아웃',
        onPress: async () => {
          try {
            await GoogleSignin.signOut();
          } catch {}
          await clearLocalData();
          fireLogout();
        },
      },
    ]);
  };

  // ===== 계정 삭제 =====
  const handleDeleteAccount = () => {
    Alert.alert(
      '계정 삭제',
      '계정을 삭제하면 모든 걸음 기록과 포인트가 영구적으로 삭제됩니다.\n\n정말 삭제하시겠습니까?',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: async () => {
            if (!uid) return;
            setDeletingAccount(true);
            try {
              // 서브컬렉션(dailySteps, purchases) 전체 삭제
              const batch = writeBatch(db);

              const dailySnap = await getDocs(collection(db, 'users', uid, 'dailySteps'));
              dailySnap.forEach((d) => batch.delete(d.ref));

              const purchaseSnap = await getDocs(collection(db, 'users', uid, 'purchases'));
              purchaseSnap.forEach((d) => batch.delete(d.ref));

              await batch.commit();

              // 유저 문서 삭제
              await deleteDoc(doc(db, 'users', uid));

              // 구글 로그아웃 + 로컬 데이터 삭제
              try { await GoogleSignin.signOut(); } catch {}
              await clearLocalData();
              fireLogout();
            } catch (e) {
              console.log('DELETE_ACCOUNT_ERR', e);
              Alert.alert('오류', '계정 삭제 중 오류가 발생했습니다. 다시 시도해주세요.');
            } finally {
              setDeletingAccount(false);
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
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

        {/* 로그아웃 */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutText}>로그아웃</Text>
        </TouchableOpacity>

        {/* 개인정보처리방침 */}
        <TouchableOpacity
          style={styles.linkBtn}
          onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}
        >
          <Text style={styles.linkText}>개인정보처리방침</Text>
        </TouchableOpacity>

        {/* 계정 삭제 */}
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={handleDeleteAccount}
          disabled={deletingAccount}
        >
          {deletingAccount
            ? <ActivityIndicator color={COLORS.DANGER} />
            : <Text style={styles.deleteText}>계정 삭제</Text>
          }
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.BG },
  container: { padding: 20 },
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

  logoutBtn: {
    marginTop: 24,
    backgroundColor: COLORS.PANEL,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.BORDER,
  },
  logoutText: { color: COLORS.TEXT, fontSize: 16, fontWeight: '700' },

  linkBtn: {
    marginTop: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  linkText: { color: COLORS.SUB, fontSize: 13, textDecorationLine: 'underline' },

  deleteBtn: {
    marginTop: 4,
    marginBottom: 32,
    paddingVertical: 14,
    alignItems: 'center',
  },
  deleteText: { color: COLORS.DANGER, fontSize: 13, fontWeight: '700' },
});
