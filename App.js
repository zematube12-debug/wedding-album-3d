import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, PanResponder, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Canvas } from '@react-three/fiber/native';

import Book from './src/Book';
import AlbumUI from './src/AlbumUI';
import { CameraRig, EnvironmentRoom, Lights, Table } from './src/Environment3D';
import { PAGES, SUBTITLE, TITLE } from './src/pages';

const TOTAL = (PAGES.length - 2) / 2 + 1; // number of spreads
const AUTOPLAY_MS = 3200;
const DRAG_SPAN = 0.55; // fraction of the screen width for a full page turn

export default function App() {
  const bookRef = useRef(null);
  const zoomRef = useRef(1);
  const widthRef = useRef(Dimensions.get('window').width);
  const spreadRef = useRef(0);

  const [spread, setSpread] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(true);
  const [uiVisible, setUiVisible] = useState(true);

  const handleSpread = useCallback((k) => {
    spreadRef.current = k;
    setSpread(k);
  }, []);

  // --- swipe to turn pages -------------------------------------------------
  const gesture = useRef({ dir: 0, x0: 0, moved: false });

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: () => {
        gesture.current = { dir: 0, x0: 0, moved: false };
      },
      onPanResponderMove: (_, gs) => {
        const g = gesture.current;
        const book = bookRef.current;
        if (!book) return;
        if (g.dir === 0) {
          if (Math.abs(gs.dx) > 10) {
            const dir = gs.dx < 0 ? 1 : -1; // swipe left = next page
            g.moved = true;
            g.x0 = gs.dx;
            g.dir = book.dragStart(dir) ? dir : 99; // 99 = nothing to turn
          }
        } else if (g.dir !== 99) {
          const p = (-g.dir * (gs.dx - g.x0)) / (widthRef.current * DRAG_SPAN);
          book.dragMove(p);
        }
      },
      onPanResponderRelease: (e, gs) => {
        const g = gesture.current;
        const book = bookRef.current;
        if (!book) return;
        if (g.dir === 0 && !g.moved && Math.abs(gs.dx) < 10 && Math.abs(gs.dy) < 10) {
          // simple tap: right half = next, left half = previous
          if (e.nativeEvent.locationX > widthRef.current / 2) book.next();
          else book.prev();
        } else if (g.dir !== 0 && g.dir !== 99) {
          const v = (-g.dir * gs.vx * 1000) / (widthRef.current * DRAG_SPAN); // progress / s
          book.dragEnd(v);
        }
        gesture.current = { dir: 0, x0: 0, moved: false };
      },
      onPanResponderTerminate: () => {
        const g = gesture.current;
        const book = bookRef.current;
        if (book && g.dir !== 0 && g.dir !== 99) book.dragEnd(0);
        gesture.current = { dir: 0, x0: 0, moved: false };
      },
    })
  ).current;

  // --- autoplay ------------------------------------------------------------
  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(() => {
      const book = bookRef.current;
      if (!book) return;
      if (spreadRef.current >= TOTAL - 1) book.goTo(0);
      else book.next();
    }, AUTOPLAY_MS);
    return () => clearInterval(id);
  }, [playing]);

  // --- UI callbacks --------------------------------------------------------
  const onZoomIn = () => {
    zoomRef.current = Math.min(2.6, zoomRef.current * 1.25);
  };
  const onZoomOut = () => {
    zoomRef.current = Math.max(0.8, zoomRef.current / 1.25);
  };

  return (
    <View
      style={styles.root}
      onLayout={(e) => {
        widthRef.current = e.nativeEvent.layout.width;
      }}
    >
      <StatusBar hidden />

      <View style={StyleSheet.absoluteFill} {...pan.panHandlers}>
        <Canvas
          flat
          shadows
          camera={{ fov: 32, near: 0.5, far: 80, position: [0, 9, 4] }}
          gl={{ antialias: true }}
          style={StyleSheet.absoluteFill}
        >
          <color attach="background" args={['#0b0706']} />
          <Lights />
          <EnvironmentRoom />
          <CameraRig zoomRef={zoomRef} />
          <Table />
          <Book ref={bookRef} pages={PAGES} onSpreadChange={handleSpread} />
        </Canvas>
      </View>

      <AlbumUI
        title={TITLE}
        subtitle={SUBTITLE}
        pages={PAGES}
        spread={spread}
        total={TOTAL}
        playing={playing}
        uiVisible={uiVisible}
        galleryOpen={galleryOpen}
        onSelect={(k) => bookRef.current && bookRef.current.goTo(k)}
        onPrev={() => bookRef.current && bookRef.current.prev()}
        onNext={() => bookRef.current && bookRef.current.next()}
        onTogglePlay={() => setPlaying((p) => !p)}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onToggleGallery={() => setGalleryOpen((g) => !g)}
        onToggleFull={() => setUiVisible((v) => !v)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0706' },
});
