// lib/experiment.ts
// 3주간 보상 실험: Firebase 콘솔에서 inExperiment: true 로 참여자 직접 지정
import { db } from './firebase';
import { doc, getDoc, Timestamp } from 'firebase/firestore';

export type ExperimentWeek = 0 | 1 | 2 | 3;
// 0 = 실험 미진행, 1 = 1주차(보상O), 2 = 2주차(보상X), 3 = 3주차(포인트삭제)

/**
 * Firestore experiments/config 문서에서 현재 주차를 계산.
 * 관리자가 Firebase 콘솔에서 직접 생성:
 * {
 *   active: true,
 *   startDate: <Timestamp>
 * }
 */
export async function getExperimentWeek(): Promise<{ week: ExperimentWeek; active: boolean }> {
  try {
    const snap = await getDoc(doc(db, 'experiments', 'config'));
    if (!snap.exists()) return { week: 0, active: false };

    const data = snap.data() as any;
    if (!data?.active || !data?.startDate) return { week: 0, active: false };

    const startDate: Date = (data.startDate as Timestamp).toDate();
    const now = new Date();
    const daysDiff = Math.floor(
      (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysDiff < 0)  return { week: 0, active: true };
    if (daysDiff < 7)  return { week: 1, active: true };
    if (daysDiff < 14) return { week: 2, active: true };
    if (daysDiff < 21) return { week: 3, active: true };
    return { week: 0, active: false }; // 실험 종료
  } catch {
    return { week: 0, active: false };
  }
}

/**
 * 해당 유저가 실험 참여자인지 확인.
 * Firebase 콘솔에서 users/{uid}.inExperiment = true 로 직접 지정.
 */
export async function getInExperiment(uid: string): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return false;
    return Boolean((snap.data() as any)?.inExperiment);
  } catch {
    return false;
  }
}

/**
 * 포인트를 지급해도 되는지 여부.
 * - 실험 비참여자: 항상 true
 * - 실험 참여자: 2주차만 true (1주차 기저선 → 2주차 보상 → 3주차 제거)
 */
export function canEarnPoints(inExperiment: boolean, week: ExperimentWeek): boolean {
  if (!inExperiment) return true;
  if (week === 0) return true;
  return week === 2;
}

/** 주차 레이블 (UI 표시용) */
export function weekLabel(week: ExperimentWeek): string {
  switch (week) {
    case 1: return '실험 1주차 (보상 X)';
    case 2: return '실험 2주차 (보상 O)';
    case 3: return '실험 3주차 (보상 X)';
    default: return '';
  }
}
