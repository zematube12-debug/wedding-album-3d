import React, { useEffect, useRef } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';

const THUMB_W = 104;
const THUMB_GAP = 8;

const toSource = (s) => (typeof s === 'number' ? s : { uri: s });

function Btn({ label, onPress, big }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.btn, big && styles.btnBig, pressed && styles.btnPressed]}
    >
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

export default function AlbumUI({
  title,
  subtitle,
  pages,
  spread,
  total,
  playing,
  uiVisible,
  galleryOpen,
  onSelect,
  onPrev,
  onNext,
  onTogglePlay,
  onZoomIn,
  onZoomOut,
  onToggleGallery,
  onToggleFull,
}) {
  const listRef = useRef(null);
  const data = Array.from({ length: total }, (_, k) => k);

  useEffect(() => {
    if (listRef.current && galleryOpen && uiVisible) {
      try {
        listRef.current.scrollToIndex({ index: spread, animated: true, viewPosition: 0.5 });
      } catch (e) {
        // list not measured yet
      }
    }
  }, [spread, galleryOpen, uiVisible]);

  if (!uiVisible) {
    return (
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        <View style={styles.topRight}>
          <Btn label="⤢" onPress={onToggleFull} />
        </View>
      </View>
    );
  }

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {/* title */}
      <View pointerEvents="none" style={styles.titleBox}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>

      {/* top right */}
      <View style={styles.topRight}>
        <Btn label="☰" onPress={onToggleGallery} />
        <Btn label="⤢" onPress={onToggleFull} />
      </View>

      {/* side arrows */}
      <View style={[styles.arrow, { left: 14 }]}>
        <Btn label="‹" big onPress={onPrev} />
      </View>
      <View style={[styles.arrow, { right: 14 }]}>
        <Btn label="›" big onPress={onNext} />
      </View>

      {/* bottom bar */}
      <View style={styles.bar}>
        <Text style={styles.counter}>
          {spread + 1} / {total}
        </Text>

        <View style={styles.listWrap}>
          {galleryOpen && (
            <FlatList
              ref={listRef}
              horizontal
              data={data}
              keyExtractor={(k) => String(k)}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 8, alignItems: 'center' }}
              getItemLayout={(_, index) => ({
                length: THUMB_W + THUMB_GAP,
                offset: (THUMB_W + THUMB_GAP) * index,
                index,
              })}
              renderItem={({ item: k }) => (
                <Pressable
                  onPress={() => onSelect(k)}
                  style={[styles.thumb, k === spread && styles.thumbActive]}
                >
                  <Image source={toSource(pages[2 * k])} style={styles.thumbImg} resizeMode="cover" />
                  <Image source={toSource(pages[2 * k + 1])} style={styles.thumbImg} resizeMode="cover" />
                </Pressable>
              )}
            />
          )}
        </View>

        <View style={styles.controls}>
          <Btn label="+" onPress={onZoomIn} />
          <Btn label="−" onPress={onZoomOut} />
          <Btn label={playing ? '❚❚' : '▶'} onPress={onTogglePlay} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  titleBox: { position: 'absolute', top: 14, left: 22 },
  title: { color: '#e9cf94', fontSize: 28, fontStyle: 'italic', fontWeight: '600' },
  subtitle: { color: '#f4ede0', fontSize: 12, marginTop: 2, letterSpacing: 0.6 },
  topRight: { position: 'absolute', top: 14, right: 14, flexDirection: 'row', gap: 10 },
  arrow: { position: 'absolute', top: '45%' },
  btn: {
    minWidth: 42,
    height: 42,
    paddingHorizontal: 10,
    borderRadius: 21,
    backgroundColor: 'rgba(20,12,8,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(233,207,148,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnBig: { width: 50, height: 50, borderRadius: 25 },
  btnPressed: { backgroundColor: 'rgba(80,50,20,0.9)' },
  btnText: { color: '#f4ede0', fontSize: 20, fontWeight: '600' },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 84,
    backgroundColor: 'rgba(14,9,6,0.88)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  counter: { color: '#f4ede0', fontSize: 16, width: 72 },
  listWrap: { flex: 1, height: 70 },
  controls: { flexDirection: 'row', gap: 8, marginLeft: 8 },
  thumb: {
    width: THUMB_W,
    height: 58,
    marginRight: THUMB_GAP,
    flexDirection: 'row',
    borderRadius: 4,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: '#2a1d14',
  },
  thumbActive: { borderColor: '#e9cf94' },
  thumbImg: { flex: 1, height: '100%' },
});
