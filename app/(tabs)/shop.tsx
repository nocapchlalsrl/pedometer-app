// app/(tabs)/shop.tsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  StyleSheet,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { extractUidFromGoogleUser } from '../../lib/utils';
import { db } from '../../lib/firebase';
import {
  doc,
  getDoc,
  runTransaction,
  collection,
  serverTimestamp,
  onSnapshot,
} from 'firebase/firestore';

const COLORS = {
  NAVY: '#0F172A',
  DARK_BG: '#1E293B',
  GOLD: '#f9c526',
  TEXT_LIGHT: 'white',
  TEXT_GRAY: '#cfd6e4',
  CARD: '#0B1220',
  BORDER: '#334155',
  DANGER: '#EF4444',
};

const STORAGE_KEYS = {
  pointsValue: 'points_value',
};

type ShopItem = {
  id: string;
  name: string;
  price: number;
};

export default function ShopScreen() {
  const [uid, setUid] = useState<string | null>(null);
  const [points, setPoints] = useState<number>(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [studentLabel, setStudentLabel] = useState('');

  // ✅ 상점 아이템(하드코딩)
  const items: ShopItem[] = useMemo(
    () => [
      { id: 'item_speed', name: '메가커피 쿠폰 3.000원', price: 1400 },
      { id: 'item_skin', name: '맘스터치 싸이버거 쿠폰', price: 300 },
      { id: 'item_ticket', name: '테스트용 최민기', price: 1 },
      { id: 'item_badge', name: '컴포즈 쿠폰 4000원', price: 1600 },
    ],
    []
  );

  const userRef = (u: string) => doc(db, 'users', u);

  // 초기 uid + 로컬 포인트 로드
  useEffect(() => {
    const init = async () => {
      const googleUser = await AsyncStorage.getItem('googleUser');
      if (!googleUser) return;

      const u = extractUidFromGoogleUser(googleUser);
      if (!u) return;

      setUid(u);

      // 학생 정보 (구매 기록에 저장)
      try {
        const s = await AsyncStorage.getItem('studentInfo');
        if (s) {
          const info = JSON.parse(s);
          setStudentLabel(`${info.grade}학년${info.classNo}반${info.number}번 ${info.name}`);
        }
      } catch {}

      // 로컬 포인트 먼저
      try {
        const local = Number(await AsyncStorage.getItem(STORAGE_KEYS.pointsValue));
        if (Number.isFinite(local) && local >= 0) setPoints(local);
      } catch {}

      // 서버 포인트로 보정
      try {
        const snap = await getDoc(userRef(u));
        if (snap.exists()) {
          const p = Number((snap.data() as any)?.points ?? 0);
          const safe = Number.isFinite(p) && p >= 0 ? p : 0;
          setPoints(safe);
        }
      } catch {}
    };
    init();
  }, []);

  // ✅ 핵심: 포인트 실시간 동기화 (메인 ↔ 상점 항상 동일)
  useEffect(() => {
    if (!uid) return;

    const unsub = onSnapshot(
      userRef(uid),
      (snap) => {
        if (!snap.exists()) return;
        const p = Number((snap.data() as any)?.points ?? 0);
        const safe = Number.isFinite(p) && p >= 0 ? p : 0;
        setPoints(safe);
      },
      (err) => console.log('POINTS_SUB_ERR', err)
    );

    return () => unsub();
  }, [uid]);

  // 구매 처리
  const buy = async (item: ShopItem) => {
    if (!uid) {
      Alert.alert('로그인 필요', '로그인이 필요합니다.');
      return;
    }

    setBusyId(item.id);
    try {
      const result = await runTransaction(db, async (tx) => {
        const uRef = userRef(uid);
        const uSnap = await tx.get(uRef);

        const current = Number((uSnap.data() as any)?.points ?? 0);
        const curSafe = Number.isFinite(current) && current >= 0 ? current : 0;

        if (curSafe < item.price) {
          return { ok: false as const, reason: 'NOT_ENOUGH' as const, current: curSafe };
        }

        const next = curSafe - item.price;
        tx.set(uRef, { points: next, updatedAt: serverTimestamp() }, { merge: true });

        // 역타임스탬프 ID → Firebase 콘솔에서 최신 항목이 맨 위에 표시됨
        const reverseTs = String(9007199254740991 - Date.now()).padStart(16, '0');

        // 개인 구매 기록 (users/{uid}/purchases)
        const pDoc = doc(db, 'users', uid, 'purchases', reverseTs);
        tx.set(pDoc, {
          itemId: item.id,
          name: item.name,
          price: item.price,
          qty: 1,
          createdAt: serverTimestamp(),
          studentLabel,
        });

        // ✅ 관리자용 전체 사용내역 (ledger 최상위 컬렉션) — Firebase 콘솔에서 한눈에 확인
        const lDoc = doc(db, 'ledger', `${reverseTs}_${uid.slice(0, 8)}`);
        tx.set(lDoc, {
          uid,
          studentLabel,
          itemId: item.id,
          name: item.name,
          price: item.price,
          pointsBefore: curSafe,
          pointsAfter: next,
          createdAt: serverTimestamp(),
        });

        return { ok: true as const, next };
      });

      if (!result.ok) {
        if (result.reason === 'NOT_ENOUGH') {
          Alert.alert('포인트 부족', `현재 포인트: ${result.current}`);
        } else {
          Alert.alert('실패', '구매에 실패했습니다.');
        }
        return;
      }

      // UI 체감용 즉시 반영 (실시간 구독도 곧 반영됨)
      setPoints(result.next);
      await AsyncStorage.setItem(STORAGE_KEYS.pointsValue, String(result.next));

      Alert.alert('구매 완료', `${item.name} 구매됨!`);
    } catch (e) {
      console.log('BUY_ERR', e);
      Alert.alert('오류', '구매 처리 중 오류가 발생했습니다.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>상점</Text>
        <View style={styles.pointsPill}>
          <Text style={styles.pBadge}>P</Text>
          <Text style={styles.pText}>{points.toLocaleString()}</Text>
        </View>
      </View>

      <FlatList
        data={items}
        keyExtractor={(x) => x.id}
        contentContainerStyle={{ padding: 16 }}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemName}>{item.name}</Text>
              <Text style={styles.itemPrice}>가격: {item.price} P</Text>
            </View>

            <TouchableOpacity
              disabled={busyId === item.id}
              style={[styles.buyBtn, busyId === item.id ? styles.buyBtnDisabled : null]}
              onPress={() => buy(item)}
            >
              <Text style={styles.buyText}>{busyId === item.id ? '처리중...' : '구매'}</Text>
            </TouchableOpacity>
          </View>
        )}
        ListFooterComponent={
          <Text style={styles.footer}>포인트로 상점에 있는 물품들을 구매할 수 있습니다!</Text>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.DARK_BG },

  header: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.BORDER,
  },
  title: { color: COLORS.TEXT_LIGHT, fontSize: 20, fontWeight: '900' },

  pointsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.GOLD,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pBadge: { fontWeight: '900', color: COLORS.NAVY, marginRight: 6 },
  pText: { fontWeight: '900', color: COLORS.NAVY },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.CARD,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    padding: 14,
    marginBottom: 12,
  },
  itemName: { color: COLORS.TEXT_LIGHT, fontSize: 16, fontWeight: '800' },
  itemPrice: { color: COLORS.TEXT_GRAY, marginTop: 6, fontWeight: '700' },

  buyBtn: {
    backgroundColor: COLORS.GOLD,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    marginLeft: 12,
  },
  buyBtnDisabled: { opacity: 0.6 },
  buyText: { color: COLORS.NAVY, fontWeight: '900' },

  footer: { color: COLORS.TEXT_GRAY, textAlign: 'center', marginTop: 8, fontSize: 12 },
});
