// app/_layout.tsx
import React, { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import 'react-native-reanimated';

export const unstable_settings = {
  anchor: 'index',
};

export default function RootLayout() {
  const [bootChecked, setBootChecked] = useState(false);

  // ✅ 전역 configure는 여기서 1번만
  useEffect(() => {
    GoogleSignin.configure({
      webClientId:
        '705515267078-haj4n0h3n9ubef79st2uiltj5u0vg5oh.apps.googleusercontent.com',
    });
  }, []);

  // ✅ 앱 시작 시 저장 상태 확인 (중요: 절대 "return"로 중간 탈출하지 말 것)
  useEffect(() => {
    let alive = true;

    const boot = async () => {
      try {
        const googleUser = await AsyncStorage.getItem('googleUser');
        const student = await AsyncStorage.getItem('studentInfo');

        // 여기서 라우팅을 강제로 해도 되지만,
        // 지금은 "흰화면 방지"가 우선이라 bootChecked만 확실히 true로 만든다.
        // (index.tsx에서 로그인 흐름 처리해도 됨)
        // 필요하면 여기서 router.replace(...)를 추가할 수 있음.
      } catch (e) {
        console.log('BOOT_ERR', e);
      } finally {
        if (alive) setBootChecked(true);
      }
    };

    boot();
    return () => {
      alive = false;
    };
  }, []);

  // ✅ 부팅 체크 전에는 아무것도 안 띄움 (근데 반드시 bootChecked가 true로 바뀌어야 함)
  if (!bootChecked) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="signup" options={{ headerShown: true, title: '회원 가입' }} />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
