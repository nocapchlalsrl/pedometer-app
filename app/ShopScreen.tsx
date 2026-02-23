// app/ShopScreen.tsx
import React, { useState } from 'react';
import { FlatList, SafeAreaView, StyleSheet, Text, TouchableOpacity, View, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const COLORS = {
  PANEL: '#0f223b',
  GOLD: '#f9c526',
  TEXT_LIGHT: 'white',
  DARK_BG: '#1E293B',
};

const MOCK_PRODUCTS = [
  { id: 1, name: '마법소녀 돈키호테', imageUri: 'https://i.imgur.com/example-1.jpg', price: 400, description: '관리자 나리!' },
  { id: 2, name: '아르카나 플레이버', imageUri: 'https://i.imgur.com/example-2.jpg', price: 400, description: '아르카나 플레이버' },
];

const ShopScreen = () => {
  const [currentPoints, setCurrentPoints] = useState(12345);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>상점</Text>
        <View style={styles.headerPoints}>
          <Text style={styles.headerP}>P</Text>
          <Text style={styles.headerBalance}>{currentPoints}</Text>
        </View>
      </View>

      <FlatList
        data={MOCK_PRODUCTS}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card}>
            <Image source={{ uri: item.imageUri }} style={styles.cardImage} />
            <View style={styles.cardContent}>
              <Text style={styles.cardName}>{item.name}</Text>
              <Text style={styles.cardPrice}>X {item.price} P</Text>
            </View>
          </TouchableOpacity>
        )}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.listContainer}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.PANEL,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 20,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.TEXT_LIGHT,
  },
  headerPoints: {
    flexDirection: 'row',
    backgroundColor: COLORS.GOLD,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  headerP: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.DARK_BG,
  },
  headerBalance: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.DARK_BG,
  },
  listContainer: {
    padding: 20,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: COLORS.DARK_BG,
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 15,
  },
  cardImage: {
    width: 100,
    height: 150,
  },
  cardContent: {
    flex: 1,
    padding: 10,
    justifyContent: 'center',
  },
  cardName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.TEXT_LIGHT,
  },
  cardPrice: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.GOLD,
  },
});

export default ShopScreen;
