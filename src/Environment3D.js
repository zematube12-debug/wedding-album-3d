import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber/native';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { PAGE_W, PAGE_H, LIGHT_POS } from './PageCurlShader';

// Set to false if the cover looks black/odd on your phone (disables the
// image-based reflections generated at start-up).
export const USE_ROOM_ENV = true;

// ---------------------------------------------------------------------------
// Tiny procedural noise (no canvas / no image files needed)
// ---------------------------------------------------------------------------
const lin = (v) => Math.pow(v, 2.2);
const smooth = (t) => t * t * (3 - 2 * t);

function hash2(x, y) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function vnoise(x, y, period) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const x0 = ((ix % period) + period) % period;
  const y0 = ((iy % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const a = hash2(x0, y0);
  const b = hash2(x1, y0);
  const c = hash2(x0, y1);
  const d = hash2(x1, y1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

// Tileable fbm; u,v in [0,1)
function fbm(u, v, basePeriod, octaves) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const per = basePeriod * (1 << o);
    sum += amp * vnoise(u * per, v * per, per);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

function dataTexture(data, w, h) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------------------
// Leather normal map (pebbled grain)
// ---------------------------------------------------------------------------
export function makeLeatherNormalMap(size = 256) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      h[y * size + x] = fbm(u, v, 8, 3) * 0.5 + fbm(u, v, 40, 2) * 0.9;
    }
  }
  const data = new Uint8Array(size * size * 4);
  const strength = 2.4;
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = at(x + 1, y) - at(x - 1, y);
      const dy = at(x, y + 1) - at(x, y - 1);
      let nx = -dx * strength;
      let ny = -dy * strength;
      let nz = 1;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * size + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  return dataTexture(data, size, size);
}

// ---------------------------------------------------------------------------
// Dark polished wood
// ---------------------------------------------------------------------------
export function makeWoodTexture(size = 512) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const warp = fbm(u, v, 3, 3);
      const rings = 0.5 + 0.5 * Math.sin(v * 70 + warp * 9);
      const streak = fbm(u, v, 2, 2) * 0.5 + fbm(u * 1, v * 1, 64, 2) * 0.5;
      const k = 0.25 + 0.55 * rings * 0.6 + 0.35 * streak;
      const r = 0.1 + 0.34 * k;
      const g = 0.05 + 0.17 * k;
      const b = 0.03 + 0.09 * k;
      const i = (y * size + x) * 4;
      data[i] = lin(r) * 255;
      data[i + 1] = lin(g) * 255;
      data[i + 2] = lin(b) * 255;
      data[i + 3] = 255;
    }
  }
  return dataTexture(data, size, size);
}

// ---------------------------------------------------------------------------
// Side-of-the-page-block texture (thin paper layers)
// ---------------------------------------------------------------------------
export function makePageEdgeTexture() {
  const w = 4;
  const h = 64;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const line = y % 4 === 0 ? 0.78 : 1.0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = lin(0.95 * line) * 255;
      data[i + 1] = lin(0.91 * line) * 255;
      data[i + 2] = lin(0.82 * line) * 255;
      data[i + 3] = 255;
    }
  }
  return dataTexture(data, w, h);
}

// ---------------------------------------------------------------------------
// Soft rectangular contact shadow (alpha only)
// ---------------------------------------------------------------------------
export function makeContactShadowTexture(size = 128) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x / (size - 1) - 0.5) * 2;
      const ny = (y / (size - 1) - 0.5) * 2;
      const d = Math.max(Math.abs(nx), Math.abs(ny));
      const k = 1 - smooth(Math.min(1, Math.max(0, (d - 0.45) / 0.55)));
      const i = (y * size + x) * 4;
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = Math.pow(k, 1.4) * 0.75 * 255;
    }
  }
  const t = dataTexture(data, size, size);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ---------------------------------------------------------------------------
// Rounded rectangle helpers for the cover and the gold inlay
// ---------------------------------------------------------------------------
export function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - r);
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h);
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r);
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

export function makeCoverGeometry(w, h, depth = 0.07) {
  const shape = roundedRectShape(w, h, 0.07);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.012,
    bevelSegments: 3,
    curveSegments: 10,
  });
  g.rotateX(-Math.PI / 2);
  return g;
}

export function makeInlayGeometry(w, h, line = 0.012) {
  const outer = roundedRectShape(w, h, 0.05);
  const inner = roundedRectShape(w - line * 2, h - line * 2, 0.04);
  outer.holes.push(new THREE.Path(inner.getPoints(16).reverse()));
  const g = new THREE.ExtrudeGeometry(outer, { depth: 0.004, bevelEnabled: false, curveSegments: 10 });
  g.rotateX(-Math.PI / 2);
  return g;
}

// ---------------------------------------------------------------------------
// React components used inside <Canvas>
// ---------------------------------------------------------------------------
export function Lights() {
  return (
    <>
      <hemisphereLight args={['#fff4e6', '#2a1a10', 0.55]} />
      <directionalLight
        position={LIGHT_POS.toArray()}
        intensity={2.4}
        color="#ffe9cf"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-5}
        shadow-camera-right={5}
        shadow-camera-top={5}
        shadow-camera-bottom={-5}
        shadow-camera-near={1}
        shadow-camera-far={25}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      {/* warm candle glow from the right */}
      <pointLight position={[5.5, 1.6, -1.5]} intensity={6} distance={9} decay={2} color="#ffb061" />
    </>
  );
}

export function EnvironmentRoom() {
  const { gl, scene } = useThree();
  useEffect(() => {
    if (!USE_ROOM_ENV) return undefined;
    let env = null;
    try {
      const pmrem = new THREE.PMREMGenerator(gl);
      env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = env;
      pmrem.dispose();
    } catch (e) {
      console.warn('Room environment skipped:', e && e.message);
    }
    return () => {
      if (env) {
        scene.environment = null;
        env.dispose();
      }
    };
  }, [gl, scene]);
  return null;
}

export function Table() {
  const map = useMemo(() => {
    const t = makeWoodTexture();
    t.wrapS = THREE.MirroredRepeatWrapping;
    t.wrapT = THREE.MirroredRepeatWrapping;
    t.repeat.set(8, 8);
    return t;
  }, []);
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, -0.094, 0]} receiveShadow>
      <planeGeometry args={[40, 40]} />
      <meshStandardMaterial map={map} roughness={0.55} metalness={0} envMapIntensity={0.35} />
    </mesh>
  );
}

// Fits the open book to the screen and handles the zoom buttons.
export function CameraRig({ zoomRef }) {
  const { camera, size } = useThree();
  const cur = useRef(1);
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const target = zoomRef && zoomRef.current ? zoomRef.current : 1;
    cur.current += (target - cur.current) * (1 - Math.exp(-dt * 6));

    const aspect = size.width / Math.max(size.height, 1);
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    const elev = THREE.MathUtils.degToRad(64);
    const tanV = Math.tan(vfov / 2);
    const tanH = tanV * aspect;
    const halfW = PAGE_W + 0.55;
    const halfD = PAGE_H / 2 + 0.45;
    const dW = halfW / tanH;
    const dH = (halfD * Math.sin(elev) + 0.15) / tanV;
    const d = Math.max(dW, dH) / cur.current;

    camera.position.set(0, d * Math.sin(elev), d * Math.cos(elev) + 0.25);
    camera.lookAt(0, 0, 0.25);
  });
  return null;
}
