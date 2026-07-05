// app/index.tsx
import React, { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth } from '../lib/firebase';

/**
 * 메인 엔트리 포인트: 
 * RootLayout의 자동 로그인 로직이 결정될 때까지 대기하거나,
 * 직접 체크하여 적절한 화면으로 분기합니다.
 */
export default function Index() {
  useEffect(() => {
    const checkSession = async () => {
      await auth.authStateReady();
      const googleUser = await AsyncStorage.getItem('googleUser');
      const studentInfo = await AsyncStorage.getItem('studentInfo');

      if (auth.currentUser || (googleUser && studentInfo)) {
        router.replace('/(tabs)');
      } else {
        router.replace('/login');
      }
    };
    checkSession();
  }, []);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#071427' }}>
      <ActivityIndicator size="large" color="#FFD600" />
    </View>
  );
}
