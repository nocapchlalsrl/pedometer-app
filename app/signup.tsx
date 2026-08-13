// app/signup.tsx
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { extractUidFromGoogleUser } from '../lib/utils';

const COLORS = {
  BG: '#071427',
  YELLOW: '#FFD600',
  TEXT: '#FFFFFF',
  INPUT_BG: '#111827',
  BORDER: '#4B5563',
};

export default function SignupScreen() {
  const [grade, setGrade] = useState('');
  const [classNo, setClassNo] = useState('');
  const [number, setNumber] = useState('');
  const [name, setName] = useState('');

  const handleSubmit = async () => {
    if (!grade || !classNo || !number || !name) {
      Alert.alert('입력 오류', '모든 항목을 입력하세요.');
      return;
    }

    const info = { grade, classNo, number, name };
    const studentLabel = `${grade}학년${classNo}반${number}번 ${name}`;
    // 문서 ID: "학년반번_이름" 순수 숫자 → Firebase 콘솔에서 학년→반→번호→이름 순 정렬
    // 예: "20719_홍길동" (2학년 07반 19번 홍길동)
    const rosterId = `${grade}${classNo.padStart(2, '0')}${number.padStart(2, '0')}_${name}`;

    try {
      await AsyncStorage.setItem('studentInfo', JSON.stringify(info));

      // ✅ roster 컬렉션: 관리자가 학년/반/번호로 학생을 찾기 위한 인덱스
      const raw = await AsyncStorage.getItem('googleUser');
      const asyncUid = raw ? extractUidFromGoogleUser(raw) : null;
      const firebaseUid = auth.currentUser?.uid ?? null;
      const uid = firebaseUid ?? asyncUid;

      console.log('SIGNUP uid check:', { firebaseUid, asyncUid });

      if (uid) {
        await AsyncStorage.setItem('currentUid', uid);
        await setDoc(doc(db, 'roster', rosterId), {
          uid,
          name,
          grade,
          classNo,
          number,
          studentLabel,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }

      if (firebaseUid) {
        await setDoc(doc(db, 'users', firebaseUid), {
          name,
          grade,
          classNo,
          number,
          studentLabel,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      } else {
        console.log('SIGNUP_WARN: Firebase Auth uid 없음, users 저장 스킵');
      }

      router.replace('/(tabs)');
    } catch (e) {
      console.log('STORAGE_SAVE_ERR', e);
      Alert.alert('저장 실패', '학생 정보 저장 중 오류가 발생했습니다.');
    }
  };

  return (
    <View style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>회원 정보 입력</Text>
        <Text style={styles.subtitle}>학년 / 반 / 번호 / 이름을 입력하세요.</Text>

        <View style={styles.form}>
          <Text style={styles.label}>학년</Text>
          <TextInput
            style={styles.input}
            placeholder="예: 3"
            placeholderTextColor="#6B7280"
            keyboardType="numeric"
            value={grade}
            onChangeText={setGrade}
          />

          <Text style={styles.label}>반</Text>
          <TextInput
            style={styles.input}
            placeholder="예: 2"
            placeholderTextColor="#6B7280"
            keyboardType="numeric"
            value={classNo}
            onChangeText={setClassNo}
          />

          <Text style={styles.label}>번호</Text>
          <TextInput
            style={styles.input}
            placeholder="예: 1"
            placeholderTextColor="#6B7280"
            keyboardType="numeric"
            value={number}
            onChangeText={setNumber}
          />

          <Text style={styles.label}>이름</Text>
          <TextInput
            style={styles.input}
            placeholder="예: 홍길동"
            placeholderTextColor="#6B7280"
            value={name}
            onChangeText={setName}
          />
        </View>

        <TouchableOpacity style={styles.submitButton} onPress={handleSubmit}>
          <Text style={styles.submitText}>완료</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.BG },
  container: { flex: 1, paddingHorizontal: 24, paddingTop: 32 },
  title: { color: COLORS.TEXT, fontSize: 24, fontWeight: '800', marginBottom: 4 },
  subtitle: { color: '#9CA3AF', marginBottom: 24 },
  form: { marginBottom: 24 },
  label: { color: COLORS.TEXT, fontSize: 15, marginTop: 12, marginBottom: 4 },
  input: {
    backgroundColor: COLORS.INPUT_BG,
    color: COLORS.TEXT,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
  },
  submitButton: {
    marginTop: 8,
    backgroundColor: COLORS.YELLOW,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitText: { color: COLORS.BG, fontSize: 17, fontWeight: '700' },
});
