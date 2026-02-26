// app/login.tsx  →  고유 경로 /login (tabs 안에 없으므로 어디서든 replace('/login') 가능)
import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Alert,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  GoogleSignin,
  statusCodes,
  isErrorWithCode,
} from '@react-native-google-signin/google-signin';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, getDoc } from 'firebase/firestore';
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { db, auth } from '../lib/firebase';
import { extractUidFromGoogleUser } from '../lib/utils';

const SCHOOL_NAME = '경북일고';

const COLORS = {
  BG: '#071427',
  YELLOW: '#FFD600',
  TEXT_MAIN: '#FFD600',
  TEXT_SUB: '#FFFFFF',
};

export default function LoginScreen() {
  const [loading, setLoading] = useState(false);
  const [signingUp, setSigningUp] = useState(false);

  const doGoogleLoginFresh = async () => {
    try { await GoogleSignin.signOut(); } catch {}
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const res = await GoogleSignin.signIn();

    const user =
      (res as any)?.user ??
      ((res as any)?.type === 'success' ? (res as any)?.data?.user : null);

    const email = user?.email ?? '';
    if (!email.endsWith('@sc.gyo6.net')) {
      await GoogleSignin.signOut();
      throw new Error('경북일고 학교 계정(@sc.gyo6.net)으로만 로그인할 수 있습니다.');
    }

    // ✅ Firebase Auth 로그인 (보안 규칙 적용을 위해 필수)
    const idToken = (res as any)?.idToken ?? (res as any)?.data?.idToken ?? null;
    if (idToken) {
      try {
        const credential = GoogleAuthProvider.credential(idToken);
        await signInWithCredential(auth, credential);
      } catch (e) {
        console.log('FIREBASE_AUTH_ERR', e);
      }
    }

    try {
      const uid = (user as any)?.id || (user as any)?.uid || (user as any)?.sub || email || '-';
      const name = user?.name ?? '-';
      await AsyncStorage.setItem('googleUser', JSON.stringify({ uid, email, name }));
    } catch {}

    return res;
  };

  const goAfterLogin = async () => {
    try {
      const googleUser = await AsyncStorage.getItem('googleUser');
      const currentUid = googleUser ? extractUidFromGoogleUser(googleUser) : null;

      const storedUid = await AsyncStorage.getItem('currentUid');
      if (currentUid && storedUid !== currentUid) {
        await AsyncStorage.removeItem('studentInfo');
        await AsyncStorage.removeItem('steps_today_date');
        await AsyncStorage.removeItem('steps_today_value');
        await AsyncStorage.removeItem('points_value');
        await AsyncStorage.setItem('currentUid', currentUid);
      }

      const raw = await AsyncStorage.getItem('studentInfo');
      if (raw) {
        router.replace('/(tabs)');
        return;
      }

      if (currentUid) {
        const snap = await getDoc(doc(db, 'users', currentUid));
        if (snap.exists()) {
          const data = snap.data() as any;
          if (data?.name && data?.grade && data?.classNo && data?.number) {
            const info = {
              grade: String(data.grade),
              classNo: String(data.classNo),
              number: String(data.number),
              name: String(data.name),
            };
            await AsyncStorage.setItem('studentInfo', JSON.stringify(info));
            router.replace('/(tabs)');
            return;
          }
        }
      }

      router.replace('/signup');
    } catch (e) {
      console.log('AFTER_LOGIN_ERR', e);
      router.replace('/signup');
    }
  };

  const handleLogin = async () => {
    try {
      setLoading(true);
      await doGoogleLoginFresh();
      await goAfterLogin();
    } catch (e: any) {
      console.log('LOGIN_ERR', JSON.stringify(e));
      if (isErrorWithCode(e) && e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        Alert.alert('Google Play 서비스를 업데이트하세요.');
        return;
      }
      Alert.alert('로그인 실패', String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async () => {
    try {
      setSigningUp(true);
      await doGoogleLoginFresh();
      router.replace('/signup');
    } catch (e: any) {
      console.log('SIGNUP_ERR', JSON.stringify(e));
      if (isErrorWithCode(e) && e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        Alert.alert('Google Play 서비스를 업데이트하세요.');
        return;
      }
      Alert.alert('회원가입 실패', String(e?.message ?? e));
    } finally {
      setSigningUp(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Image
            source={require('../assets/images/school-logo.png')}
            style={styles.schoolLogo}
            resizeMode="contain"
          />
          <View style={styles.stepIconCircle}>
            <Ionicons name="footsteps" size={26} color={COLORS.BG} />
          </View>
        </View>

        <View style={styles.titleBox}>
          <Text style={styles.title}>{SCHOOL_NAME}</Text>
          <Text style={styles.title}>만보기</Text>
          <Text style={styles.subtitle}>로그인하여 시작</Text>
        </View>

        <View style={styles.buttonBox}>
          <TouchableOpacity
            style={styles.loginButton}
            onPress={handleLogin}
            disabled={loading || signingUp}
          >
            <Text style={styles.loginText}>
              {loading ? '로그인 중...' : '로그인'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.signupButton}
            onPress={handleSignup}
            disabled={loading || signingUp}
          >
            <Text style={styles.signupText}>
              {signingUp ? '진행 중...' : '회원 가입'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.BG },
  container: { flex: 1, backgroundColor: COLORS.BG, paddingHorizontal: 32, paddingTop: 40 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  schoolLogo: { width: 85, height: 85 },
  stepIconCircle: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: COLORS.YELLOW, alignItems: 'center', justifyContent: 'center',
  },
  titleBox: { marginTop: 80, marginBottom: 40 },
  title: { color: COLORS.TEXT_MAIN, fontSize: 52, fontWeight: '900', lineHeight: 60 },
  subtitle: { marginTop: 14, color: COLORS.TEXT_SUB, fontSize: 22 },
  buttonBox: { flex: 1, justifyContent: 'center' },
  loginButton: {
    width: '100%', backgroundColor: COLORS.YELLOW,
    borderRadius: 28, paddingVertical: 18, alignItems: 'center',
  },
  loginText: { color: COLORS.BG, fontSize: 20, fontWeight: '700' },
  signupButton: {
    marginTop: 16, width: '100%', borderRadius: 28, paddingVertical: 16,
    alignItems: 'center', borderWidth: 2, borderColor: COLORS.TEXT_SUB, backgroundColor: COLORS.BG,
  },
  signupText: { color: COLORS.TEXT_SUB, fontSize: 18, fontWeight: '600' },
});
