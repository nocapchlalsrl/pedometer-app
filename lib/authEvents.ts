// lib/authEvents.ts
// 로그아웃/로그인 시 _layout.tsx 에서 Stack 렌더를 제어하기 위한 모듈 이벤트

type Handler = () => void;
let logoutHandler: Handler | null = null;
let loginHandler: Handler | null = null;

export function registerLogoutHandler(fn: Handler) {
  logoutHandler = fn;
}

export function fireLogout() {
  logoutHandler?.();
}

export function registerLoginHandler(fn: Handler) {
  loginHandler = fn;
}

export function fireLogin() {
  loginHandler?.();
}
