import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Page dimensions (world units). One page = PAGE_W x PAGE_H.
// The spine runs along the Z axis at x = 0. Right page spans x 0..W,
// left page spans x -W..0.
// ---------------------------------------------------------------------------
export const PAGE_W = 2.2;
export const PAGE_H = 2.6;
export const LIGHT_POS = new THREE.Vector3(-4.5, 8.0, 4.5);

const EMPTY = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
EMPTY.needsUpdate = true;
export const EMPTY_TEXTURE = EMPTY;

// ---------------------------------------------------------------------------
// Geometry: a flat grid in the XZ plane, front face looks UP (+Y).
// position.x = distance from the spine (s), position.z = depth.
// uv: u = s / W (0 at spine), v = 1 at far edge (top of the image).
// ---------------------------------------------------------------------------
export function buildPageGeometry(W = PAGE_W, H = PAGE_H, nx = 40, nz = 24) {
  const verts = (nx + 1) * (nz + 1);
  const position = new Float32Array(verts * 3);
  const uv = new Float32Array(verts * 2);
  let p = 0;
  let q = 0;
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const u = i / nx;
      const v = j / nz;
      position[p++] = u * W;
      position[p++] = 0;
      position[p++] = (v - 0.5) * H;
      uv[q++] = u;
      uv[q++] = 1 - v;
    }
  }
  const idx = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const b = a + 1;
      const c = a + (nx + 1);
      const d = c + 1;
      // counter-clockwise when seen from +Y
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// ---------------------------------------------------------------------------
// VERTEX SHADER
//
// The page is a stiff-ish sheet hinged at the spine. The tangent angle along
// the sheet is   phi(s) = A + Bend * cf(z) * (s/W)^P
//   A     : hinge angle, 0 = lying on the right, PI = lying on the left
//   Bend  : total extra rotation at the free edge (negative = edge lags)
//   P>1   : paper stays stiff near the spine and bends mostly near the edge
//   cf(z) : varies across the depth so one corner lags more than the other
//           (this gives the diagonal "corner lifting" look)
// The position is the integral of the tangent (numerical, 24 steps) and we
// integrate the derivative w.r.t. z at the same time to get an exact normal.
// ---------------------------------------------------------------------------
export const vertexShader = /* glsl */ `
uniform float uW;
uniform float uH;
uniform float uA;
uniform float uBend;
uniform float uCorner;
uniform float uT;
uniform float uYR;
uniform float uYL;
uniform float uRipple;

varying vec2 vUv;
varying vec3 vPosW;
varying vec3 vNormalW;

const int STEPS = 24;
const float P = 1.7;

void main() {
  float s = position.x;
  float z = position.z;
  float sn = s / uW;
  float zn = z / uH;
  float cf = 1.0 + uCorner * zn;

  float ds = s / float(STEPS);
  float x = 0.0;
  float y = 0.0;
  float dxdz = 0.0;
  float dydz = 0.0;

  for (int i = 0; i < STEPS; i++) {
    float u = (float(i) + 0.5) / float(STEPS);
    float g = pow(max(u * sn, 1e-5), P);
    float phi = uA + uBend * cf * g;
    float c = cos(phi);
    float sI = sin(phi);
    x += c * ds;
    y += sI * ds;
    float dphidz = uBend * (uCorner / uH) * g;
    dxdz -= sI * dphidz * ds;
    dydz += c * dphidz * ds;
  }

  float phiEnd = uA + uBend * cf * pow(max(sn, 1e-5), P);

  // gentle paper ripple while in motion
  float fade = smoothstep(0.0, 0.35, sn);
  float rArg = z * 2.6 + s * 1.7;
  float rip = uRipple * sin(rArg) * fade;
  float ripZ = uRipple * 2.6 * cos(rArg) * fade;
  float ripS = uRipple * 1.7 * cos(rArg) * fade;

  float yOff = mix(uYR, uYL, uT);
  vec3 pos = vec3(x, y + yOff + rip, z);

  vec3 Ts = normalize(vec3(cos(phiEnd), sin(phiEnd) + ripS, 0.0));
  vec3 Tz = vec3(dxdz, dydz + ripZ, 1.0);
  vec3 N = normalize(cross(Tz, Ts));

  vec4 wp = modelMatrix * vec4(pos, 1.0);
  vPosW = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * N);
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

// ---------------------------------------------------------------------------
// FRAGMENT SHADER
// Front face and back face use different textures. Lighting is done by hand
// (wrapped lambert + paper translucency + soft sheen + gutter occlusion +
// shadow cast by the page that is currently turning).
// Output is gamma-encoded manually, because ShaderMaterial skips three's
// colour-space chunks.
// ---------------------------------------------------------------------------
export const fragmentShader = /* glsl */ `
uniform sampler2D uFront;
uniform sampler2D uBack;
uniform float uHasFront;
uniform float uHasBack;
uniform vec3 uLightDir;
uniform vec3 uLightCol;
uniform vec3 uPaper;
uniform vec2 uShadowR;
uniform vec2 uShadowL;

varying vec2 vUv;
varying vec3 vPosW;
varying vec3 vNormalW;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  bool front = gl_FrontFacing;
  vec3 N = normalize(vNormalW);
  if (!front) N = -N;

  vec2 uv = vUv;
  vec3 albedo;
  if (front) {
    albedo = (uHasFront > 0.5) ? texture2D(uFront, uv).rgb : uPaper;
  } else {
    uv.x = 1.0 - uv.x;
    albedo = (uHasBack > 0.5) ? texture2D(uBack, uv).rgb : uPaper;
  }
  albedo = pow(albedo, vec3(2.2));

  // paper grain
  float grain = hash21(floor(vUv * vec2(1100.0, 1300.0)));
  albedo *= 0.97 + 0.05 * grain;

  vec3 L = normalize(uLightDir);
  vec3 V = normalize(cameraPosition - vPosW);
  float ndl = dot(N, L);
  float diff = clamp((ndl + 0.2) / 1.2, 0.0, 1.0);
  float trans = clamp(dot(-N, L), 0.0, 1.0) * 0.22;
  float hemi = 0.5 + 0.5 * N.y;
  vec3 amb = mix(vec3(0.10, 0.08, 0.07), vec3(0.32, 0.30, 0.28), hemi);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 60.0) * 0.10 * step(0.0, ndl);

  // gutter (spine) ambient occlusion on pages that lie flat
  float flatness = smoothstep(0.7, 0.98, abs(N.y));
  float gut = 1.0 - 0.55 * exp(-abs(vPosW.x) * 4.5) * flatness;

  // soft shadow from the page that is currently turning
  float sh = 0.0;
  if (vPosW.x > 0.0) {
    sh = uShadowR.y * (1.0 - smoothstep(uShadowR.x - 0.25, uShadowR.x + 0.55, vPosW.x));
  } else {
    sh = uShadowL.y * (1.0 - smoothstep(uShadowL.x - 0.25, uShadowL.x + 0.55, -vPosW.x));
  }
  sh *= flatness;

  vec3 lit = amb + uLightCol * (diff + trans);
  vec3 col = albedo * lit + uLightCol * spec;
  col *= gut * (1.0 - sh * 0.9);

  col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Material factory
// ---------------------------------------------------------------------------
export function createPageMaterial({ yRight, yLeft }) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    vertexShader,
    fragmentShader,
    uniforms: {
      uW: { value: PAGE_W },
      uH: { value: PAGE_H },
      uA: { value: 0 },
      uBend: { value: 0 },
      uCorner: { value: 0.5 },
      uT: { value: 0 },
      uYR: { value: yRight },
      uYL: { value: yLeft },
      uRipple: { value: 0 },
      uFront: { value: EMPTY },
      uBack: { value: EMPTY },
      uHasFront: { value: 0 },
      uHasBack: { value: 0 },
      uLightDir: { value: LIGHT_POS.clone().normalize() },
      uLightCol: { value: new THREE.Vector3(0.78, 0.74, 0.68) },
      uPaper: { value: new THREE.Vector3(0.93, 0.89, 0.82) },
      uShadowR: { value: new THREE.Vector2(0, 0) },
      uShadowL: { value: new THREE.Vector2(0, 0) },
    },
  });
}

// ---------------------------------------------------------------------------
// JS-side curl math
//   t     : 0 (page on right) .. 1 (page on left)
//   speed : dt/dt of t (signed)
//   dir   : smoothed direction, +1 turning forward, -1 turning back
// Forward turn: the free edge lags behind (negative bend).
// Backward turn: the free edge leads (positive bend).
// The bend is clamped so the free edge never dips into the table/cover.
// ---------------------------------------------------------------------------
export function curlParams(t, speed, dir) {
  const a = Math.PI * t;
  const amp = 0.42 + 0.28 * Math.min(Math.abs(speed) / 2.2, 1);
  let bend = -dir * amp * Math.sin(Math.PI * t);
  const lo = -a / 1.3;
  const hi = (Math.PI - a) / 1.3;
  bend = Math.min(hi, Math.max(lo, bend));
  return { a, bend };
}

const ss = (e0, e1, x) => {
  const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return k * k * (3 - 2 * k);
};

// Shadow thrown by a turning page (hinge angle a) onto the pages beneath it.
export function shadowForAngle(a) {
  const b = Math.PI - a;
  return {
    rReach: Math.max(PAGE_W * Math.cos(a), 0) + 0.3,
    rAmt: 0.5 * ss(0.0, 0.4, a) * (1 - ss(1.2, 1.6, a)),
    lReach: Math.max(-PAGE_W * Math.cos(a), 0) + 0.3,
    lAmt: 0.5 * ss(0.0, 0.4, b) * (1 - ss(1.2, 1.6, b)),
  };
}
