// app/_layout.tsx
import React, { useEffect, useState } from 'react';
import { Stack, router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { LogBox, Platform } from 'react-native';
import 'react-native-reanimated';
// ✅ Firebase
import { auth } from '../lib/firebase';
// iOS HealthKit 백그라운드 동기화 task 등록 (defineTask도 이 import로 실행됨)
import { registerBackgroundSync } from '../lib/backgroundTask';

LogBox.ignoreLogs(['unable to activate keep awake', 'Unable to activate keep awake']);

// ✅ anchor = login (고유 경로 /login = app/login.tsx)
export const unstable_settings = {
  anchor: 'login',
};

export default function RootLayout() {
  const [bootChecked, setBootChecked] = useState(false);
  const [autoLogin, setAutoLogin] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'ios') {
      registerBackgroundSync().catch(() => {});
    }
  }, []);

  useEffect(() => {
    GoogleSignin.configure({
      webClientId:
        '455472798685-dptue3qqoaeuqbjvs0srds235vc5hs6o.apps.googleusercontent.com',
      iosClientId:
        '455472798685-9psh6i0sg7f53u4esab7d2koubm70583.apps.googleusercontent.com',
    });
  }, []);

  useEffect(() => {
    let alive = true;
    const boot = async () => {
      try {
        // Firebase 인증 세션 복구 대기
        await auth.authStateReady();
        
        const googleUser = await AsyncStorage.getItem('googleUser');
        const studentInfo = await AsyncStorage.getItem('studentInfo');
        
        // Firebase 세션이 있거나, 로컬 정보가 확실히 있을 때만 자동 로그인
        if (alive && (auth.currentUser || (googleUser && studentInfo))) {
          setAutoLogin(true);
        }
      } catch (e) {
        console.log('BOOT_ERR', e);
      } finally {
        if (alive) setBootChecked(true);
      }
    };
    boot();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (bootChecked && autoLogin) {
      router.replace('/(tabs)');
    }
  }, [bootChecked, autoLogin]);

  if (!bootChecked) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="index" />
      <Stack.Screen name="signup" options={{ headerShown: true, title: '회원 가입' }} />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
