// app/_layout.tsx
import React, { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { LogBox } from 'react-native';
import 'react-native-reanimated';

LogBox.ignoreLogs(['unable to activate keep awake', 'Unable to activate keep awake']);

// ✅ anchor = login (고유 경로 /login = app/login.tsx)
export const unstable_settings = {
  anchor: 'login',
};

export default function RootLayout() {
  const [bootChecked, setBootChecked] = useState(false);

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
        await AsyncStorage.getItem('googleUser');
        await AsyncStorage.getItem('studentInfo');


      } catch (e) {
        console.log('BOOT_ERR', e);
      } finally {
        if (alive) setBootChecked(true);
      }
    };
    boot();
    return () => { alive = false; };
  }, []);

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
