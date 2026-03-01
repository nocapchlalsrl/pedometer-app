// app/(tabs)/stats.tsx
// 실험 결과 통계: 대응표본 설계 - 주차 간 비교
import { useFocusEffect } from '@react-navigation/native';
import { collection, doc, getDoc, getDocs, Timestamp } from 'firebase/firestore';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from '../../lib/firebase';
import {
  calcFullStats,
  FullStats,
  getWeekDates,
  interpretR,
  UserRecord,
  WeekNumber
} from '../../lib/statsCalc';

const C = {
  BG: '#0F172A',
  PANEL: '#1E293B',
  TEXT: '#E5E7EB',
  SUB: '#94A3B8',
  GOLD: '#f9c526',
  BORDER: '#334155',
  W1: '#94A3B8',  // 1주차 (회색 = 보상 없음)
  W2: '#34D399',  // 2주차 (초록 = 보상 있음)
  W3: '#F87171',  // 3주차 (빨강 = 보상 없음)
  OK: '#22C55E',
  DANGER: '#EF4444',
};

function pct(rate: number) { return `${(rate * 100).toFixed(1)}%`; }
function fmt(n: number) { return n.toLocaleString(); }
function changeStr(rate: number) {
  const sign = rate >= 0 ? '+' : '';
  return `${sign}${(rate * 100).toFixed(1)}%`;
}

function SectionTitle({ children }: { children: string }) {
  return <Text style={s.sectionTitle}>{children}</Text>;
}

function StatCard({ week, stat, color }: {
  week: WeekNumber;
  stat: { mean: number; variance: number; stdDev: number; count: number; goalRate: number; halfGoalRate: number };
  color: string;
}) {
  const weekName = week === 1 ? '1주차 (보상 X)' : week === 2 ? '2주차 (보상 O)' : '3주차 (보상 X)';
  return (
    <View style={[s.statCard, { borderColor: color }]}>
      <Text style={[s.statCardWeek, { color }]}>{weekName}</Text>
      <Text style={s.statCardBig}>{fmt(stat.mean)}</Text>
      <Text style={s.statCardUnit}>걸음 (일평균)</Text>
      <View style={s.statDivider} />
      <Row label="분산" value={fmt(stat.variance)} />
      <Row label="표준편차" value={`${fmt(stat.stdDev)} 보`} />
      <Row label="만보 달성" value={pct(stat.goalRate)} />
      <Row label="5천보 달성" value={pct(stat.halfGoalRate)} />
      <Row label="참여자" value={`${stat.count}명`} />
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value}</Text>
    </View>
  );
}

// ─── Firebase 데이터 조회 ─────────────────────────────────

async function fetchExperimentData(): Promise<{
  users: UserRecord[];
  availableWeeks: WeekNumber[];
  startDate: Date;
} | null> {
  const cfgSnap = await getDoc(doc(db, 'experiments', 'config'));
  console.log('CFG_EXISTS:', cfgSnap.exists());
  if (!cfgSnap.exists()) return null;

  const cfg = cfgSnap.data() as any;
  console.log('CFG_DATA:', JSON.stringify({ active: cfg?.active, hasStartDate: !!cfg?.startDate }));
  if (!cfg?.active || !cfg?.startDate) return null;

  const startDate: Date = (cfg.startDate as Timestamp).toDate();
  const daysDiff = Math.floor(
    (new Date().getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  const currentWeek: WeekNumber =
    daysDiff < 0 ? 1 :
    daysDiff < 7 ? 1 :
    daysDiff < 14 ? 2 : 3;

  const availableWeeks: WeekNumber[] = [];
  for (let w = 1; w <= currentWeek; w++) availableWeeks.push(w as WeekNumber);

  const weekDateSets: Record<WeekNumber, Set<string>> = {
    1: new Set(getWeekDates(startDate, 1)),
    2: new Set(getWeekDates(startDate, 2)),
    3: new Set(getWeekDates(startDate, 3)),
  };

  // inExperiment: true 유저만 조회
  const usersSnap = await getDocs(collection(db, 'users'));
  console.log('USERS_COUNT:', usersSnap.size);
  const participantDocs = usersSnap.docs.filter(
    (d) => Boolean((d.data() as any)?.inExperiment)
  );
  console.log('PARTICIPANTS:', participantDocs.length);

  const tasks = participantDocs.map(async (userDoc) => {
    const data = userDoc.data() as any;
    const dailySnap = await getDocs(
      collection(db, 'users', userDoc.id, 'dailySteps')
    );

    const weeklySteps: UserRecord['weeklySteps'] = { 1: [], 2: [], 3: [] };
    dailySnap.forEach((d) => {
      const date = d.id;
      const steps = Number((d.data() as any)?.steps ?? 0);
      if (!Number.isFinite(steps) || steps < 0) return;
      for (const w of ([1, 2, 3] as WeekNumber[])) {
        if (weekDateSets[w].has(date)) { weeklySteps[w].push(steps); break; }
      }
    });

    return {
      uid: userDoc.id,
      name: String(data?.name ?? ''),
      studentLabel: String(data?.studentLabel ?? data?.name ?? ''),
      weeklySteps,
    } as UserRecord;
  });

  const users = await Promise.all(tasks);
  return { users, availableWeeks, startDate };
}

// ─── 메인 화면 ────────────────────────────────────────────

export default function StatsTab() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<FullStats | null>(null);
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [isParticipant, setIsParticipant] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { extractUidFromGoogleUser } = await import('../../lib/utils');
      const raw = await AsyncStorage.getItem('googleUser');
      const uid = raw ? extractUidFromGoogleUser(raw) : null;

      if (uid) {
        const userSnap = await getDoc(doc(db, 'users', uid));
        const userData = userSnap.exists() ? (userSnap.data() as any) : {};
        setIsAdmin(Boolean(userData?.isAdmin));
        setIsParticipant(Boolean(userData?.inExperiment));

        // 관리자가 아니면 통계 데이터 로드 안 함
        if (!userData?.isAdmin) {
          setLoading(false);
          return;
        }
      } else {
        setIsAdmin(false);
        setIsParticipant(false);
        setLoading(false);
        return;
      }

      const result = await fetchExperimentData();
      if (!result) {
        setError('실험이 시작되지 않았습니다.\nFirebase 콘솔 → experiments/config 문서를 생성해주세요.');
        setStats(null);
        return;
      }
      setStartDate(result.startDate);
      setStats(calcFullStats(result.users, result.availableWeeks));
    } catch (e: any) {
      console.log('STATS_FETCH_ERR', e);
      setError('Firestore 권한 오류.\nFirestore 규칙에서 users 컬렉션 읽기를 허용해주세요.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const dateStr = startDate
    ? `${startDate.getMonth() + 1}/${startDate.getDate()} 시작`
    : '';

  const WEEK_COLORS: Record<WeekNumber, string> = { 1: C.W1, 2: C.W2, 3: C.W3 };

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        contentContainerStyle={s.container}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={C.GOLD} />}
      >
        <Text style={s.title}>실험 통계</Text>
        <Text style={s.subtitle}>
          보상이 걸음수에 미치는 영향 실험{dateStr ? ` · ${dateStr}` : ''}
        </Text>

        {/* 비참여자 안내 */}
        {isParticipant === false && !loading && (
          <View style={s.noticeCard}>
            <Text style={s.noticeText}>
              실험 대상자가 아닙니다.{'\n'}실험 신청은 디버깅 동아리에 문의주세요.
            </Text>
          </View>
        )}

        {/* 비관리자: 통계 비공개 */}
        {isAdmin === false && !loading && (
          <View style={s.lockedCard}>
            <Text style={s.lockedTitle}>통계는 관리자만 열람 가능합니다</Text>
          </View>
        )}

        {loading && !stats && (
          <ActivityIndicator color={C.GOLD} style={{ marginTop: 40 }} size="large" />
        )}

        {!!error && !loading && (
          <View style={s.errorCard}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        {!!stats && isAdmin && (
          <>
            {/* ── 요약 ── */}
            <View style={s.summaryRow}>
              <View style={s.summaryCard}>
                <Text style={s.summaryLabel}>실험 참여자</Text>
                <Text style={s.summaryBig}>{stats.totalParticipants}명</Text>
              </View>
              <View style={s.summaryCard}>
                <Text style={s.summaryLabel}>진행 주차</Text>
                <Text style={s.summaryBig}>{stats.availableWeeks.length}주차</Text>
              </View>
              <View style={s.summaryCard}>
                <Text style={s.summaryLabel}>상관계수 r</Text>
                <Text style={[s.summaryBig, { color: C.GOLD }]}>
                  {stats.pearsonR.toFixed(3)}
                </Text>
              </View>
            </View>

            {/* ── 주차별 통계 카드 ── */}
            <SectionTitle>주차별 평균 · 분산 · 달성률</SectionTitle>
            <Text style={s.hint}>
              같은 참여자의 주차별 변화를 비교합니다.{'\n'}
              1주차(보상 O) → 2주차(보상 X) 감소폭이 클수록 보상 의존도가 높습니다.
            </Text>
            {stats.availableWeeks.map((w) => (
              <StatCard key={w} week={w} stat={stats.weekStats[w]} color={WEEK_COLORS[w]} />
            ))}

            {/* ── 주차 간 변화율 ── */}
            {stats.availableWeeks.length >= 2 && (
              <>
                <SectionTitle>주차 간 변화율</SectionTitle>
                <View style={s.panel}>
                  {stats.weekStats[1].mean > 0 && stats.availableWeeks.includes(2) && (
                    <View style={s.changeRow}>
                      <Text style={s.changeLabel}>1주차 → 2주차</Text>
                      <Text style={[
                        s.changeVal,
                        {
                          color: stats.weekStats[2].mean > stats.weekStats[1].mean
                            ? C.OK : C.DANGER
                        }
                      ]}>
                        {changeStr(
                          (stats.weekStats[2].mean - stats.weekStats[1].mean) /
                          stats.weekStats[1].mean
                        )}
                      </Text>
                      <Text style={s.changeSub}>
                        {fmt(stats.weekStats[1].mean)} → {fmt(stats.weekStats[2].mean)} 보
                      </Text>
                    </View>
                  )}
                  {stats.weekStats[2].mean > 0 && stats.availableWeeks.includes(3) && (
                    <View style={[s.changeRow, { marginTop: 12 }]}>
                      <Text style={s.changeLabel}>2주차 → 3주차</Text>
                      <Text style={[
                        s.changeVal,
                        {
                          color: stats.weekStats[3].mean < stats.weekStats[2].mean
                            ? C.DANGER : C.OK
                        }
                      ]}>
                        {changeStr(
                          (stats.weekStats[3].mean - stats.weekStats[2].mean) /
                          stats.weekStats[2].mean
                        )}
                      </Text>
                      <Text style={s.changeSub}>
                        {fmt(stats.weekStats[2].mean)} → {fmt(stats.weekStats[3].mean)} 보
                      </Text>
                    </View>
                  )}
                </View>
              </>
            )}

            {/* ── 상관계수 ── */}
            <SectionTitle>보상 ↔ 걸음수 상관계수</SectionTitle>
            <View style={s.panel}>
              <Text style={s.bigR}>{stats.pearsonR.toFixed(3)}</Text>
              <Text style={s.rInterpret}>{interpretR(stats.pearsonR)}</Text>
              <View style={s.divider} />
              <Text style={s.hint}>
                각 참여자의 (보상 여부 1/0, 그 주차 평균 걸음수) 쌍으로{'\n'}
                피어슨 상관계수를 계산합니다.{'\n'}
                r이 양수일수록 보상이 있을 때 더 많이 걷는 경향을 의미합니다.
              </Text>
            </View>

            {/* ── 집단 분류 ── */}
            {stats.availableWeeks.includes(2) && (
              <>
                <SectionTitle>집단 분류 분석</SectionTitle>
                <Text style={s.hint}>
                  보상 없는 1주차 대비 보상 있는 2주차 변화율로 분류합니다.{'\n'}
                  보상을 받고 많이 걸었으면 보상 의존형, 변화 없으면 자기동기형입니다.
                </Text>
                <View style={s.classRow}>
                  <View style={[s.classBadge, { borderColor: C.DANGER, backgroundColor: C.DANGER + '22' }]}>
                    <Text style={[s.classBadgeEmoji]}>📉</Text>
                    <Text style={[s.classBadgeTitle, { color: C.DANGER }]}>보상 의존형</Text>
                    <Text style={[s.classBadgeCount, { color: C.DANGER }]}>
                      {stats.classification.rewardDependent}명
                    </Text>
                    <Text style={[s.classBadgePct, { color: C.DANGER }]}>
                      {pct(stats.classification.rewardDependentRate)}
                    </Text>
                    <Text style={s.classBadgeSub}>2주차 15% 이상 증가</Text>
                  </View>
                  <View style={[s.classBadge, { borderColor: C.OK, backgroundColor: C.OK + '22' }]}>
                    <Text style={s.classBadgeEmoji}>💪</Text>
                    <Text style={[s.classBadgeTitle, { color: C.OK }]}>자기동기형</Text>
                    <Text style={[s.classBadgeCount, { color: C.OK }]}>
                      {stats.classification.selfMotivated}명
                    </Text>
                    <Text style={[s.classBadgePct, { color: C.OK }]}>
                      {stats.classification.total > 0
                        ? pct(stats.classification.selfMotivated / stats.classification.total)
                        : '0%'}
                    </Text>
                    <Text style={s.classBadgeSub}>변화 없음 / 증가</Text>
                  </View>
                </View>

                {/* 개인별 변화율 목록 */}
                {stats.classification.changes.length > 0 && (
                  <View style={[s.panel, { marginTop: 12 }]}>
                    <Text style={s.tableTitle}>참여자별 1→2주차 변화율</Text>
                    {stats.classification.changes
                      .sort((a, b) => a.changeRate - b.changeRate)
                      .map((c, i) => (
                        <View key={i} style={s.personRow}>
                          <Text style={s.personLabel} numberOfLines={1}>{c.label}</Text>
                          <Text style={[
                            s.personChange,
                            { color: c.changeRate <= -0.15 ? C.DANGER : C.OK }
                          ]}>
                            {changeStr(c.changeRate)}
                          </Text>
                        </View>
                      ))}
                  </View>
                )}

                {stats.classification.inconsistent > 0 && (
                  <Text style={[s.hint, { marginTop: 8 }]}>
                    * 데이터 부족으로 분류 불가: {stats.classification.inconsistent}명
                  </Text>
                )}
              </>
            )}

            <View style={{ height: 32 }} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.BG },
  container: { padding: 20 },
  title: { color: C.TEXT, fontSize: 26, fontWeight: '900' },
  subtitle: { color: C.SUB, marginTop: 6, marginBottom: 18, fontSize: 13 },

  sectionTitle: {
    color: C.GOLD, fontSize: 13, fontWeight: '900',
    letterSpacing: 0.5, marginTop: 20, marginBottom: 10,
    textTransform: 'uppercase',
  },

  summaryRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  summaryCard: {
    flex: 1, backgroundColor: C.PANEL, borderRadius: 14,
    padding: 12, borderWidth: 1, borderColor: C.BORDER, alignItems: 'center',
  },
  summaryLabel: { color: C.SUB, fontSize: 11, fontWeight: '700' },
  summaryBig: { color: C.TEXT, fontSize: 22, fontWeight: '900', marginTop: 4 },

  statCard: {
    backgroundColor: C.PANEL, borderRadius: 16,
    padding: 16, borderWidth: 2, marginBottom: 12,
  },
  statCardWeek: { fontSize: 13, fontWeight: '900' },
  statCardBig: { color: C.TEXT, fontSize: 36, fontWeight: '900', marginTop: 4 },
  statCardUnit: { color: C.SUB, fontSize: 13 },
  statDivider: { height: 1, backgroundColor: C.BORDER, marginVertical: 10 },

  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  rowLabel: { color: C.SUB, fontSize: 13 },
  rowValue: { color: C.TEXT, fontSize: 13, fontWeight: '800' },

  panel: {
    backgroundColor: C.PANEL, borderRadius: 16,
    padding: 16, borderWidth: 1, borderColor: C.BORDER,
  },

  changeRow: { alignItems: 'center' },
  changeLabel: { color: C.SUB, fontSize: 13, marginBottom: 4 },
  changeVal: { fontSize: 36, fontWeight: '900' },
  changeSub: { color: C.SUB, fontSize: 12, marginTop: 4 },

  bigR: { color: C.GOLD, fontSize: 52, fontWeight: '900', textAlign: 'center', marginVertical: 8 },
  rInterpret: { color: C.TEXT, fontSize: 15, fontWeight: '800', textAlign: 'center' },

  divider: { height: 1, backgroundColor: C.BORDER, marginVertical: 10 },
  hint: { color: C.SUB, fontSize: 12, lineHeight: 18 },

  classRow: { flexDirection: 'row', gap: 12, marginTop: 10 },
  classBadge: {
    flex: 1, borderRadius: 14, padding: 14,
    alignItems: 'center', borderWidth: 1.5,
  },
  classBadgeEmoji: { fontSize: 24, marginBottom: 4 },
  classBadgeTitle: { fontSize: 13, fontWeight: '900' },
  classBadgeCount: { fontSize: 28, fontWeight: '900', marginTop: 4 },
  classBadgePct: { fontSize: 16, fontWeight: '800' },
  classBadgeSub: { color: C.SUB, fontSize: 11, marginTop: 4, textAlign: 'center' },

  tableTitle: { color: C.SUB, fontSize: 12, fontWeight: '700', marginBottom: 8 },
  personRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: C.BORDER,
  },
  personLabel: { color: C.TEXT, fontSize: 13, flex: 1 },
  personChange: { fontSize: 14, fontWeight: '900', marginLeft: 8 },

  noticeCard: {
    backgroundColor: '#1C1A2E',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#4B5563',
    marginBottom: 16,
  },
  noticeText: { color: C.SUB, fontSize: 13, lineHeight: 20 },

  lockedCard: {
    marginTop: 60,
    alignItems: 'center',
    padding: 24,
  },
  lockedText: { fontSize: 48, marginBottom: 12 },
  lockedTitle: { color: C.SUB, fontSize: 15, fontWeight: '700', textAlign: 'center' },

  errorCard: {
    backgroundColor: C.PANEL, borderRadius: 16,
    padding: 20, borderWidth: 1, borderColor: C.DANGER, marginTop: 20,
  },
  errorText: { color: C.DANGER, fontSize: 14, lineHeight: 22, fontWeight: '700' },
});
