import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useFrame } from '@react-three/fiber/native';
import * as THREE from 'three';
import {
  PAGE_W as W,
  PAGE_H as H,
  EMPTY_TEXTURE,
  buildPageGeometry,
  createPageMaterial,
  curlParams,
  shadowForAngle,
} from './PageCurlShader';
import {
  makeLeatherNormalMap,
  makePageEdgeTexture,
  makeContactShadowTexture,
  makeCoverGeometry,
  makeInlayGeometry,
} from './Environment3D';

const GAP = 0.0075; // thickness of one sheet in the stack
const BASE = 0.008; // height of the lowest page above the cover

// ---------------------------------------------------------------------------
// Texture loading hook. Uses R3F-native's patched TextureLoader, so it accepts
// both require('./img.jpg') and 'https://...' strings.
// Textures are only kept in GPU memory while `enabled` is true.
// ---------------------------------------------------------------------------
function usePageTexture(source, enabled) {
  const [tex, setTex] = useState(null);
  useEffect(() => {
    if (!enabled || source == null) {
      setTex(null);
      return undefined;
    }
    let cancelled = false;
    let created = null;
    const loader = new THREE.TextureLoader();
    loader.load(
      source,
      (t) => {
        if (cancelled) {
          t.dispose();
          return;
        }
        t.minFilter = THREE.LinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.generateMipmaps = false;
        created = t;
        setTex(t);
      },
      undefined,
      (err) => console.warn('Page texture failed:', String(source), err && err.message)
    );
    return () => {
      cancelled = true;
      if (created) created.dispose();
      setTex(null);
    };
  }, [source, enabled]);
  return tex;
}

// ---------------------------------------------------------------------------
// One paper sheet (front + back) with the curl material
// ---------------------------------------------------------------------------
function Sheet({ pos, N, frontSrc, backSrc, active, geometry, register }) {
  const yR = BASE + (N - pos) * GAP;
  const yL = BASE + (pos + 1) * GAP;
  const material = useMemo(() => createPageMaterial({ yRight: yR, yLeft: yL }), [yR, yL]);
  const front = usePageTexture(frontSrc, active);
  const back = usePageTexture(backSrc, active);

  useEffect(() => {
    material.uniforms.uFront.value = front || EMPTY_TEXTURE;
    material.uniforms.uHasFront.value = front ? 1 : 0;
  }, [front, material]);

  useEffect(() => {
    material.uniforms.uBack.value = back || EMPTY_TEXTURE;
    material.uniforms.uHasBack.value = back ? 1 : 0;
  }, [back, material]);

  useEffect(() => {
    register(pos, material);
    return () => register(pos, null);
  }, [pos, material, register]);

  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}

// ---------------------------------------------------------------------------
// The Book
//
// pages: array of image sources, even length >= 4.
//   pages[0]            = inside of the front cover (left page of spread 0)
//   pages[1 + 2k]       = front of sheet k      (right side)
//   pages[2 + 2k]       = back of sheet k       (left side after turning)
//   pages[last]         = inside of the back cover
// Sheets N = (pages.length - 2) / 2, spreads = N + 1.
//
// Imperative API (via ref): next, prev, goTo(k), dragStart(dir), dragMove(p),
// dragEnd(velocity), getSpread, getTotal
// ---------------------------------------------------------------------------
const Book = forwardRef(function Book({ pages, onSpreadChange }, ref) {
  if (!pages || pages.length < 4 || pages.length % 2 !== 0) {
    throw new Error('PAGES must have an even number of images (minimum 4).');
  }
  const M = pages.length;
  const N = (M - 2) / 2;

  const [spreadState, setSpreadState] = useState(0);
  const cbRef = useRef(onSpreadChange);
  cbRef.current = onSpreadChange;

  const S = useRef(null);
  if (!S.current) {
    S.current = {
      t: new Float32Array(N),
      v: new Float32Array(N),
      target: new Float32Array(N),
      dirS: new Float32Array(N).fill(1),
      spread: 0,
      pending: null,
      stepTimer: 0,
      drag: { active: false, leaf: -1, dir: 1, t: 0 },
    };
  }

  const matsRef = useRef({});
  const register = useCallback((pos, mat) => {
    if (mat) matsRef.current[pos] = mat;
    else delete matsRef.current[pos];
  }, []);

  const geometry = useMemo(() => buildPageGeometry(), []);
  const coverGeo = useMemo(() => makeCoverGeometry(2 * W + 0.2, H + 0.2), []);
  const inlayGeo = useMemo(() => makeInlayGeometry(2 * W + 0.1, H + 0.1), []);
  const blockGeo = useMemo(() => new THREE.BoxGeometry(W - 0.03, 1, H - 0.02), []);

  const coverMat = useMemo(() => {
    const n = makeLeatherNormalMap();
    n.repeat.set(1 / 0.6, 1 / 0.6);
    return new THREE.MeshStandardMaterial({
      color: '#241812',
      roughness: 0.5,
      metalness: 0.08,
      normalMap: n,
      normalScale: new THREE.Vector2(0.9, 0.9),
      envMapIntensity: 0.6,
    });
  }, []);
  const goldMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#c9a45c',
        roughness: 0.32,
        metalness: 0.7,
        envMapIntensity: 0.8,
        emissive: '#3a2a0c',
      }),
    []
  );
  const blockMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#ffffff',
        map: makePageEdgeTexture(),
        roughness: 0.95,
        metalness: 0,
        envMapIntensity: 0.1,
      }),
    []
  );
  const shadowMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: makeContactShadowTexture(),
        transparent: true,
        depthWrite: false,
      }),
    []
  );

  const rBlock = useRef();
  const lBlock = useRef();

  // --- state changes ------------------------------------------------------
  const commit = useCallback(
    (k) => {
      const st = S.current;
      const kk = Math.max(0, Math.min(N, k));
      st.spread = kk;
      for (let i = 0; i < N; i++) st.target[i] = i < kk ? 1 : 0;
      setSpreadState(kk);
      if (cbRef.current) cbRef.current(kk, N + 1);
    },
    [N]
  );

  useImperativeHandle(
    ref,
    () => ({
      getSpread: () => S.current.spread,
      getTotal: () => N + 1,
      next: () => {
        const st = S.current;
        const base = st.pending !== null ? st.pending : st.spread;
        st.pending = Math.min(N, base + 1);
      },
      prev: () => {
        const st = S.current;
        const base = st.pending !== null ? st.pending : st.spread;
        st.pending = Math.max(0, base - 1);
      },
      goTo: (k) => {
        S.current.pending = Math.max(0, Math.min(N, k));
      },
      dragStart: (dir) => {
        const st = S.current;
        if (st.drag.active) return false;
        st.pending = null;
        const leaf = dir > 0 ? st.spread : st.spread - 1;
        if (leaf < 0 || leaf >= N) return false;
        st.drag = { active: true, leaf, dir, t: st.t[leaf] };
        return true;
      },
      dragMove: (p) => {
        const d = S.current.drag;
        if (!d.active) return;
        const pp = Math.max(0, Math.min(1, p));
        d.t = d.dir > 0 ? pp : 1 - pp;
      },
      // velocity: progress units per second in the drag direction
      dragEnd: (velocity) => {
        const st = S.current;
        const d = st.drag;
        if (!d.active) return;
        const p = d.dir > 0 ? d.t : 1 - d.t;
        const go = (p > 0.5 && velocity > -0.9) || (p > 0.06 && velocity > 0.9);
        st.drag = { ...d, active: false };
        if (go) commit(st.spread + d.dir);
      },
    }),
    [N, commit]
  );

  // --- per-frame simulation + uniforms -----------------------------------
  useFrame((_, dtRaw) => {
    const dt = Math.min(Math.max(dtRaw, 1e-3), 0.05);
    const st = S.current;

    // queued page steps (next / prev / goTo / autoplay)
    if (!st.drag.active && st.pending !== null) {
      if (st.pending === st.spread) {
        st.pending = null;
      } else {
        st.stepTimer -= dt;
        if (st.stepTimer <= 0) {
          const diff = st.pending - st.spread;
          commit(st.spread + Math.sign(diff));
          st.stepTimer = Math.abs(diff) > 1 ? 0.13 : 0;
        }
      }
    }

    // spring simulation for every sheet
    let frac = 0;
    let best = -1;
    let bestVal = 0;
    const K = 62;
    const C = 2 * Math.sqrt(K) * 0.85;
    for (let i = 0; i < N; i++) {
      let t = st.t[i];
      if (st.drag.active && st.drag.leaf === i) {
        const nt = t + (st.drag.t - t) * (1 - Math.exp(-dt * 28));
        st.v[i] = (nt - t) / dt;
        t = nt;
      } else {
        const acc = K * (st.target[i] - t) - C * st.v[i];
        st.v[i] += acc * dt;
        t += st.v[i] * dt;
        if (t > 1) {
          t = 1;
          st.v[i] = 0;
        } else if (t < 0) {
          t = 0;
          st.v[i] = 0;
        }
        if (Math.abs(t - st.target[i]) < 0.0004 && Math.abs(st.v[i]) < 0.003) {
          t = st.target[i];
          st.v[i] = 0;
        }
      }
      st.t[i] = t;
      frac += t;

      const speed = st.v[i];
      if (Math.abs(speed) > 0.06) {
        const dirT = speed > 0 ? 1 : -1;
        st.dirS[i] += (dirT - st.dirS[i]) * (1 - Math.exp(-dt * 10));
      }
      if (t > 0.01 && t < 0.99) {
        const m = Math.sin(Math.PI * t);
        if (m > bestVal) {
          bestVal = m;
          best = i;
        }
      }
    }

    const sh =
      best >= 0
        ? shadowForAngle(Math.PI * st.t[best])
        : { rReach: 0, rAmt: 0, lReach: 0, lAmt: 0 };

    for (let pos = -1; pos <= N; pos++) {
      const mat = matsRef.current[pos];
      if (!mat) continue;
      const u = mat.uniforms;
      if (pos === -1) {
        u.uA.value = Math.PI;
        u.uBend.value = 0;
        u.uT.value = 1;
        u.uRipple.value = 0;
      } else if (pos === N) {
        u.uA.value = 0;
        u.uBend.value = 0;
        u.uT.value = 0;
        u.uRipple.value = 0;
      } else {
        const t = st.t[pos];
        const { a, bend } = curlParams(t, st.v[pos], st.dirS[pos]);
        u.uA.value = a;
        u.uBend.value = bend;
        u.uT.value = t;
        u.uRipple.value = 0.016 * Math.sin(Math.PI * t);
      }
      const own = pos === best;
      u.uShadowR.value.set(own ? 0 : sh.rReach, own ? 0 : sh.rAmt);
      u.uShadowL.value.set(own ? 0 : sh.lReach, own ? 0 : sh.lAmt);
    }

    // paper blocks shrink / grow as sheets move from right to left
    const hR = Math.max(0.004, BASE + (N - frac) * GAP - 0.003);
    const hL = Math.max(0.004, BASE + frac * GAP - 0.003);
    if (rBlock.current) {
      rBlock.current.scale.y = hR;
      rBlock.current.position.y = hR / 2;
    }
    if (lBlock.current) {
      lBlock.current.scale.y = hL;
      lBlock.current.position.y = hL / 2;
    }
  });

  // --- sheet list --------------------------------------------------------
  const sheets = useMemo(() => {
    const list = [{ pos: -1, front: null, back: pages[0] }];
    for (let i = 0; i < N; i++) {
      list.push({ pos: i, front: pages[1 + 2 * i], back: pages[2 + 2 * i] });
    }
    list.push({ pos: N, front: pages[M - 1], back: null });
    return list;
  }, [pages, N, M]);

  return (
    <group>
      {/* hardcover */}
      <mesh geometry={coverGeo} material={coverMat} position={[0, -0.082, 0]} castShadow receiveShadow />
      <mesh geometry={inlayGeo} material={goldMat} position={[0, 0, 0]} />

      {/* paper block sides */}
      <mesh ref={rBlock} geometry={blockGeo} material={blockMat} position={[W / 2, 0.05, 0]} />
      <mesh ref={lBlock} geometry={blockGeo} material={blockMat} position={[-W / 2, 0.05, 0]} />

      {/* turning sheets */}
      {sheets.map((s) => (
        <Sheet
          key={s.pos}
          pos={s.pos}
          N={N}
          frontSrc={s.front}
          backSrc={s.back}
          active={Math.abs(s.pos - spreadState) <= 3}
          geometry={geometry}
          register={register}
        />
      ))}

      {/* soft contact shadow on the table */}
      <mesh
        rotation-x={-Math.PI / 2}
        position={[0, -0.0925, 0]}
        scale={[2 * W + 1.7, H + 1.7, 1]}
        material={shadowMat}
      >
        <planeGeometry args={[1, 1]} />
      </mesh>
    </group>
  );
});

export default Book;
