// lib/authEvents.ts
// 로그아웃/계정삭제 시 _layout.tsx 에서 네비게이션을 처리하기 위한 모듈 이벤트

type Handler = () => void;
let handler: Handler | null = null;

export function registerLogoutHandler(fn: Handler) {
  handler = fn;
}

export function fireLogout() {
  handler?.();
}
