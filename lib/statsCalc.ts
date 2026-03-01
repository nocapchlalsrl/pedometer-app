// lib/statsCalc.ts
// 실험 데이터 통계 계산 - 대응표본 설계 (같은 참여자의 주차 간 비교)
import { ymd } from './utils';

export type WeekNumber = 1 | 2 | 3;

/** 특정 주차의 날짜 문자열 배열 (YYYY-MM-DD) 반환 */
export function getWeekDates(startDate: Date, week: WeekNumber): string[] {
  const offset = (week - 1) * 7;
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + offset + i);
    dates.push(ymd(d));
  }
  return dates;
}

// ─── 기초 통계 ───────────────────────────────────────────

export function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const mu = mean(values);
  return values.reduce((acc, v) => acc + Math.pow(v - mu, 2), 0) / values.length;
}

export function stdDev(values: number[]): number {
  return Math.sqrt(variance(values));
}

/**
 * 피어슨 상관계수
 * xs: 독립변수 (예: 보상 여부 1/0)
 * ys: 종속변수 (예: 걸음수)
 */
export function pearsonR(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2 || xs.length !== ys.length) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0, sdx = 0, sdy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    sdx += Math.pow(xs[i] - mx, 2);
    sdy += Math.pow(ys[i] - my, 2);
  }
  const denom = Math.sqrt(sdx * sdy);
  return denom === 0 ? 0 : num / denom;
}

/** 상관계수 해석 문자열 */
export function interpretR(r: number): string {
  const abs = Math.abs(r);
  const dir = r >= 0 ? '양' : '음';
  if (abs >= 0.7) return `강한 ${dir}의 상관 (r=${r.toFixed(3)})`;
  if (abs >= 0.4) return `중간 ${dir}의 상관 (r=${r.toFixed(3)})`;
  if (abs >= 0.2) return `약한 ${dir}의 상관 (r=${r.toFixed(3)})`;
  return `상관 없음 (r=${r.toFixed(3)})`;
}

// ─── 데이터 타입 ──────────────────────────────────────────

/** 실험 참여자 1명의 주차별 걸음수 데이터 */
export type UserRecord = {
  uid: string;
  name: string;         // 이름 (표시용)
  studentLabel: string; // 학년반번호 이름
  weeklySteps: {
    1: number[]; // 1주차 각 날의 걸음수
    2: number[];
    3: number[];
  };
};

export type WeekStat = {
  mean: number;
  variance: number;
  stdDev: number;
  count: number;        // 데이터 있는 참여자 수
  goalRate: number;     // 만보(10,000) 달성 일 비율
  halfGoalRate: number; // 5,000걸음 달성 일 비율
};

// ─── 집계 함수 ────────────────────────────────────────────

/** 특정 주차의 참여자별 일평균 걸음수 목록 */
export function weekDailyMeans(users: UserRecord[], week: WeekNumber): number[] {
  return users
    .map((u) => u.weeklySteps[week])
    .filter((arr) => arr.length > 0)
    .map((arr) => mean(arr));
}

/** 특정 주차 전체 통계 */
export function calcWeekStat(users: UserRecord[], week: WeekNumber): WeekStat {
  const dailyMeans = weekDailyMeans(users, week);
  const allDays = users.flatMap((u) => u.weeklySteps[week]);
  const goalRate = allDays.length ? allDays.filter((s) => s >= 10000).length / allDays.length : 0;
  const halfGoalRate = allDays.length ? allDays.filter((s) => s >= 5000).length / allDays.length : 0;
  const mu = mean(dailyMeans);

  return {
    mean: Math.round(mu),
    variance: Math.round(variance(dailyMeans)),
    stdDev: Math.round(stdDev(dailyMeans)),
    count: users.filter((u) => u.weeklySteps[week].length > 0).length,
    goalRate,
    halfGoalRate,
  };
}

/**
 * 보상 여부 ↔ 걸음수 피어슨 상관계수 (대응표본)
 * 각 참여자의 (주차, 그 주차 평균 걸음수) 쌍 사용
 * 1주차 = 보상(1), 2·3주차 = 미보상(0)
 */
export function calcRewardCorrelation(users: UserRecord[], availableWeeks: WeekNumber[]): number {
  const xs: number[] = [];
  const ys: number[] = [];

  for (const u of users) {
    for (const w of availableWeeks) {
      const steps = u.weeklySteps[w];
      if (!steps.length) continue;
      xs.push(w === 2 ? 1 : 0); // 2주차만 보상(1), 나머지는 미보상(0)
      ys.push(mean(steps));
    }
  }

  return pearsonR(xs, ys);
}

// ─── 집단 분류 분석 ──────────────────────────────────────

export type ClassificationResult = {
  rewardDependent: number;     // 보상 의존형: 2주차에 15% 이상 감소
  selfMotivated: number;       // 자기동기형: 변화 없음 / 증가
  inconsistent: number;        // 데이터 부족
  total: number;
  rewardDependentRate: number;
  /** 개인별 변화율 목록 (scatter 표시용) */
  changes: Array<{ label: string; changeRate: number }>;
};

/** 참여자별 1주차→2주차 걸음수 변화로 분류 */
export function classifyUsers(users: UserRecord[]): ClassificationResult {
  let rewardDependent = 0;
  let selfMotivated = 0;
  let inconsistent = 0;
  const changes: ClassificationResult['changes'] = [];

  for (const u of users) {
    const w1 = u.weeklySteps[1];
    const w2 = u.weeklySteps[2];
    if (w1.length < 3 || w2.length < 3) {
      inconsistent++;
      continue;
    }
    const avg1 = mean(w1);
    const avg2 = mean(w2);
    if (avg1 === 0) { inconsistent++; continue; }

    const changeRate = (avg2 - avg1) / avg1; // 양수 = 보상받고 증가
    changes.push({ label: u.studentLabel || u.name, changeRate });

    if (changeRate >= 0.15) rewardDependent++;  // 보상받고 15% 이상 증가 = 보상 의존형
    else selfMotivated++;                        // 변화 없음 / 감소 = 자기동기형
  }

  const total = users.length;
  return {
    rewardDependent,
    selfMotivated,
    inconsistent,
    total,
    rewardDependentRate: total > 0 ? rewardDependent / total : 0,
    changes,
  };
}

// ─── 전체 요약 ────────────────────────────────────────────

export type FullStats = {
  availableWeeks: WeekNumber[];
  weekStats: Record<WeekNumber, WeekStat>;
  pearsonR: number;
  classification: ClassificationResult;
  totalParticipants: number;
};

export function calcFullStats(users: UserRecord[], availableWeeks: WeekNumber[]): FullStats {
  const weekStats = {} as Record<WeekNumber, WeekStat>;
  for (const w of ([1, 2, 3] as WeekNumber[])) {
    weekStats[w] = calcWeekStat(users, w);
  }

  return {
    availableWeeks,
    weekStats,
    pearsonR: calcRewardCorrelation(users, availableWeeks),
    classification: classifyUsers(users),
    totalParticipants: users.length,
  };
}
