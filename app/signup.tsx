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

    try {
      await AsyncStorage.setItem('studentInfo', JSON.stringify(info));
      (global as any).__studentInfo = info;
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
            placeholder="예: 2"
            placeholderTextColor="#6B7280"
            keyboardType="numeric"
            value={grade}
            onChangeText={setGrade}
          />

          <Text style={styles.label}>반</Text>
          <TextInput
            style={styles.input}
            placeholder="예: 7"
            placeholderTextColor="#6B7280"
            keyboardType="numeric"
            value={classNo}
            onChangeText={setClassNo}
          />

          <Text style={styles.label}>번호</Text>
          <TextInput
            style={styles.input}
            placeholder="예: 19"
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
