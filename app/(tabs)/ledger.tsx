// app/(tabs)/ledger.tsx
import React, { useEffect, useState } from 'react';
import {
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from '../lib/firebase';
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
} from 'firebase/firestore';

const COLORS = {
  BG: '#0F172A',
  PANEL: '#1E293B',
  TEXT: '#E5E7EB',
  SUB: '#94A3B8',
  YELLOW: '#FFD600',
  DANGER: '#EF4444',
};

type LedgerItem = {
  id: string;
  name: string;
  price: number;
  qty: number;
  createdAt?: Timestamp | null;
};

function extractUidFromGoogleUser(raw: string): string | null {
  try {
    const u = JSON.parse(raw);
    const uid =
      u?.uid ||
      u?.user?.uid ||
      u?.sub ||
      u?.id ||
      u?.user?.id ||
      u?.email;
    return typeof uid === 'string' && uid.length > 0 ? uid : null;
  } catch {
    return null;
  }
}

function fmt(ts?: Timestamp | null) {
  if (!ts) return '';
  const d = ts.toDate();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}.${dd} ${hh}:${mi}`;
}

export default function LedgerTab() {
  const [uid, setUid] = useState<string | null>(null);
  const [list, setList] = useState<LedgerItem[]>([]);
  const [loading, setLoading] = useState(true);

  // 1) uid 먼저 확보
  useEffect(() => {
    const init = async () => {
      const raw = await AsyncStorage.getItem('googleUser');
      if (!raw) {
        setLoading(false);
        return;
      }
      const u = extractUidFromGoogleUser(raw);
      setUid(u);
    };
    init();
  }, []);

  // 2) purchases 실시간 구독 (핵심)
  useEffect(() => {
    if (!uid) return;

    setLoading(true);

    const qy = query(
      collection(db, 'users', uid, 'purchases'),
      orderBy('createdAt', 'desc')
    );

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const rows: LedgerItem[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            name: String(data?.name ?? ''),
            price: Number(data?.price ?? 0),
            qty: Number(data?.qty ?? 1),
            createdAt: (data?.createdAt as Timestamp) ?? null,
          };
        });
        setList(rows);
        setLoading(false);
      },
      (err) => {
        console.log('LEDGER_SUB_ERR', err);
        setList([]);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [uid]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>사용내역</Text>
        <Text style={styles.subtitle}>포인트 변동(현재는 구매 사용만) 내역</Text>

        {loading ? (
          <ActivityIndicator color={COLORS.YELLOW} style={{ marginTop: 30 }} />
        ) : list.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>아직 내역이 없어요</Text>
            <Text style={styles.cardSub}>상점에서 구매하면 자동으로 여기에 쌓임</Text>
          </View>
        ) : (
          <FlatList
            data={list}
            keyExtractor={(x) => x.id}
            renderItem={({ item }) => (
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{item.name}</Text>
                  <Text style={styles.rowSub}>
                    {fmt(item.createdAt)} · {item.qty}개
                  </Text>
                </View>
                <Text style={styles.minus}>-{item.price}P</Text>
              </View>
            )}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.BG },
  container: { flex: 1, padding: 20 },

  title: { color: COLORS.TEXT, fontSize: 26, fontWeight: '900' },
  subtitle: { color: COLORS.SUB, marginTop: 6, marginBottom: 18 },

  card: {
    backgroundColor: COLORS.PANEL,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardTitle: { color: COLORS.TEXT, fontSize: 16, fontWeight: '800' },
  cardSub: { color: COLORS.SUB, marginTop: 6, lineHeight: 18 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.PANEL,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  rowTitle: { color: COLORS.TEXT, fontWeight: '900', fontSize: 15 },
  rowSub: { color: COLORS.SUB, marginTop: 4, fontSize: 12 },
  minus: { color: COLORS.DANGER, fontWeight: '900', fontSize: 15 },
});
