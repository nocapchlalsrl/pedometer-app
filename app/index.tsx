// app/index.tsx
import React, { useState } from 'react';
import {
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Alert,
} from 'react-native';
import {
  GoogleSignin,
  statusCodes,
  isErrorWithCode,
} from '@react-native-google-signin/google-signin';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SCHOOL_NAME = '경북일고';

const COLORS = {
  BG: '#071427',
  YELLOW: '#FFD600',
  TEXT_MAIN: '#FFD600',
  TEXT_SUB: '#FFFFFF',
};

export default function Index() {
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [signingUp, setSigningUp] = useState(false);

  const doGoogleLoginFresh = async () => {
    // 계정 선택 화면 유도
    try {
      await GoogleSignin.signOut();
    } catch {}

    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

    const res = await GoogleSignin.signIn();

    // ✅ 버전별 반환 형태 호환
    const user =
      (res as any)?.user ??
      ((res as any)?.type === 'success' ? (res as any)?.data : null);

    // ✅ 앱 로그인 기준 저장
    try {
      const email = user?.email ?? '-';
      const name = user?.name ?? '-';
      await AsyncStorage.setItem('googleUser', JSON.stringify({ email, name }));
    } catch {}

    return res;
  };

  const goAfterLogin = async () => {
    try {
      const raw = await AsyncStorage.getItem('studentInfo');
      if (raw) {
        const info = JSON.parse(raw);
        (global as any).__studentInfo = info;
        router.replace('/(tabs)');
      } else {
        router.replace('/signup');
      }
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
      // ✅ 가입은 무조건 signup으로
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
          <View style={styles.schoolBadge}>
            <Text style={styles.schoolBadgeText}>경북</Text>
          </View>
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
  container: {
    flex: 1,
    backgroundColor: COLORS.BG,
    paddingHorizontal: 32,
    paddingTop: 40,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  schoolBadge: {
    width: 72,
    height: 72,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: COLORS.YELLOW,
    alignItems: 'center',
    justifyContent: 'center',
  },
  schoolBadgeText: {
    color: COLORS.YELLOW,
    fontSize: 20,
    fontWeight: '800',
  },
  stepIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.YELLOW,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBox: { marginTop: 80, marginBottom: 40 },
  title: {
    color: COLORS.TEXT_MAIN,
    fontSize: 40,
    fontWeight: '900',
    lineHeight: 46,
  },
  subtitle: { marginTop: 14, color: COLORS.TEXT_SUB, fontSize: 17 },
  buttonBox: { flex: 1, justifyContent: 'center' },
  loginButton: {
    width: '100%',
    backgroundColor: COLORS.YELLOW,
    borderRadius: 28,
    paddingVertical: 18,
    alignItems: 'center',
  },
  loginText: { color: COLORS.BG, fontSize: 20, fontWeight: '700' },
  signupButton: {
    marginTop: 16,
    width: '100%',
    borderRadius: 28,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.TEXT_SUB,
    backgroundColor: COLORS.BG,
  },
  signupText: { color: COLORS.TEXT_SUB, fontSize: 18, fontWeight: '600' },
});
