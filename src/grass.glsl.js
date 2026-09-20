/* The grass, the ground under it and the sky behind it, as shader source.
 *
 * One blade is seven vertices. Everything that makes it look alive happens in the vertex shader:
 * where the tip goes (clump lean, wind, flutter, the cursor), how wide the blade is at this distance,
 * and how it is lit. Lighting is per vertex on purpose. There are a few hundred thousand blades and
 * their fragments overlap several layers deep, so anything done per fragment is paid many times over.
 *
 * All colours are linear; the renderer converts to sRGB on output. */

export const TRAIL_SLOTS = 6;

const COMMON = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uSkyCol;
uniform vec3 uGroundCol;
uniform float uAmbient;
uniform vec3 uFogCol;
uniform float uHaze;

/* A sky you can describe with two colours: what comes from above and what bounces from below.
   A normal pointing up takes the first, a normal pointing down takes the second. */
vec3 skyLight(vec3 n){
  return mix(uGroundCol, uSkyCol, n.y * 0.5 + 0.5) * uAmbient;
}

/* Air: haze with distance, plus a low fog that pools at the foot of the hill. */
float airFog(vec3 w, float dist){
  float distant = smoothstep(9.0, 30.0, dist) * 0.55;
  float low = (1.0 - exp(-dist * 0.035)) * exp(-max(w.y - 0.2, 0.0) * 1.15) * 0.55;
  return clamp((distant + low) * uHaze, 0.0, 0.85);
}
`;

const FIELD = /* glsl */ `
uniform float uTime;
uniform float uWind;
uniform vec2 uWindDir;
uniform float uGustScale;
uniform float uFlutter;
uniform vec4 uTrail[${TRAIL_SLOTS}];
uniform float uPushR;
/* size of one framebuffer pixel in metres at a distance of one metre: 2·tan(fov/2) / height in px */
uniform float uPixelWorld;
uniform float uCoverageMax;
uniform float uMinPixels;

/* Integer hash. A sine-based hash loses precision at the coordinates blades live at and the wind
   starts to band; integer arithmetic does not care how far from the origin it is. */
float hash12(vec2 p){
  uvec2 q = uvec2(ivec2(floor(p))) * uvec2(1597334673u, 3812015801u);
  uint n = (q.x ^ q.y) * 1597334673u;
  return float(n) * (1.0 / 4294967295.0);
}
float vnoise(vec2 p){
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(p), hash12(p + vec2(1.0, 0.0)), u.x),
             mix(hash12(p + vec2(0.0, 1.0)), hash12(p + vec2(1.0, 1.0)), u.x), u.y);
}

/* Wind is not a sine wave rolling over the field. It is patches: two layers of noise scrolling
   downwind at different speeds, thresholded so there are calm areas between the gusts. A weak
   travelling wave stays underneath so the slope still reads as one surface. */
float gustAt(vec2 p){
  vec2 scroll = uWindDir * uTime;
  float n = vnoise(p * 0.16 * uGustScale - scroll * 0.42) * 0.62
          + vnoise(p * 0.52 * uGustScale - scroll * 1.1) * 0.38;
  float wave = sin(dot(p, uWindDir) * 0.85 - uTime * 1.55) * 0.5 + 0.5;
  float g = smoothstep(0.28, 0.82, n) * 0.8 + wave * 0.2;
  return g * g;
}

/* The cursor leaves a short trail. Each slot is a point on the hill with a strength that fades;
   blades near it lean away and flatten. */
vec3 trailPush(vec2 p, vec2 fallbackDir){
  float press = 0.0;
  vec2 push = vec2(0.0);
  for (int i = 0; i < ${TRAIL_SLOTS}; i++){
    vec4 tr = uTrail[i];
    if (tr.w < 0.002) continue;
    vec2 d = p - tr.xz;
    float dl = length(d);
    float f = smoothstep(uPushR, 0.0, dl) * tr.w;
    push += (dl > 1e-4 ? d / dl : fallbackDir) * f * f;
    press = max(press, f);
  }
  return vec3(push, press);
}
`;

export const grassVertex = /* glsl */ `
${COMMON}
${FIELD}

attribute vec3 aOffset;
attribute vec3 aNormal;
attribute vec4 aRnd;     /* yaw, length, -, tone */
attribute float aClump;  /* tone of the clump this blade belongs to */
attribute vec2 aLean;    /* how far the tip leans towards the clump centre, in blade lengths */

uniform float uLength;
uniform float uWidth;
uniform float uBackLight;

varying float vT;
varying float vTone;
varying float vClump;
varying float vPress;
varying float vGust;
varying vec3 vSky;
varying vec3 vSun;
varying float vSpec;
varying float vBack;
varying float vFog;
varying float vEdge;

void main(){
  float t = uv.y;
  vT = t;
  vEdge = uv.x;
  float len = aRnd.y * uLength;

  /* grass grows up rather than along the slope normal */
  vec3 up = normalize(mix(vec3(0.0, 1.0, 0.0), aNormal, 0.3));
  vec3 widthDir = vec3(cos(aRnd.x), 0.0, sin(aRnd.x));
  vec3 faceDir = normalize(cross(widthDir, up));
  float bend = t * t;

  vec2 p = aOffset.xz;
  float gust = gustAt(p);
  vGust = gust;
  float flutter = (sin(uTime * 5.1 + aRnd.x * 9.0 + p.x * 3.3) * 0.07
                +  sin(uTime * 3.3 + aRnd.w * 11.0) * 0.04) * uFlutter;

  /* the tip: lean towards the clump centre, then wind, then a shiver across the blade */
  vec2 tip = aLean;
  tip += uWindDir * (0.08 + gust * 0.66) * uWind;
  tip += vec2(widthDir.x, widthDir.z) * flutter * min(uWind, 1.6);

  vec3 tp = trailPush(p, widthDir.xz);
  tip += tp.xy * 1.25;
  float press = tp.z;
  vPress = press;

  /* a blade keeps its length: the further the tip goes sideways, the lower it sits */
  float tl = length(tip);
  if (tl > 0.94) tip *= 0.94 / tl;
  float lift = sqrt(max(0.0, 1.0 - dot(tip, tip)));
  lift *= 1.0 - press * 0.35;

  /* A blade seen edge-on is half a pixel wide: it flickers and leaves holes in the turf.
     Blades turned away from the camera get wider. */
  vec3 toCamBase = cameraPosition - aOffset;
  vec2 vxz = normalize(toCamBase.xz + 1e-5);
  float edgeOn = 1.0 - abs(dot(normalize(faceDir.xz + 1e-5), vxz));
  float baseDist = length(toCamBase);
  /* Coverage: fewer blades land on a pixel as distance grows, so the ones that remain get wider
     and the turf does not thin out into speckle. */
  float coverage = clamp(baseDist / 4.5, 1.0, uCoverageMax);
  float width = len * uWidth * (1.0 + edgeOn * 1.1) * coverage;
  /* Never thinner than about a pixel. A sub-pixel blade hits a pixel centre on one frame and
     misses it on the next: that is the shimmer no amount of antialiasing removes. */
  width = max(width, baseDist * uPixelWorld * uMinPixels);

  vec3 world = aOffset
             + widthDir * position.x * width * (1.0 - press * 0.3)
             + up * (t * len * lift)
             + vec3(tip.x, 0.0, tip.y) * len * bend;

  vTone = aRnd.w;
  vClump = aClump;

  vec3 bladeN = normalize(faceDir + vec3(tip.x, 0.0, tip.y) * 0.8);
  vec3 N = normalize(mix(up, bladeN, 0.45));

  vec4 wp = modelMatrix * vec4(world, 1.0);
  vec3 toCam = cameraPosition - wp.xyz;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  /* the blade has two sides: face the normal towards the camera */
  if (dot(N.xz, V.xz) < 0.0) N = normalize(vec3(-N.x, N.y, -N.z));
  /* Rounded normal: the edges of the ribbon look sideways, the middle looks forward, and a flat
     strip shades like a round stem. No extra geometry. */
  N = normalize(N + widthDir * (position.x * 2.0) * 0.6);
  /* Far away the normal settles onto the slope normal, so light stops jumping pixel to pixel. */
  N = normalize(mix(N, aNormal, smoothstep(5.0, 15.0, dist) * 0.75));

  vSky = skyLight(N);
  vSun = uSunCol * max(dot(N, uSunDir), 0.0);
  /* A glint along the middle of the blade, not on the very tip: the tip is smaller than a pixel
     and light collected there turns into a line of bright dots. It fades with distance. */
  vec3 H = normalize(uSunDir + V);
  vSpec = pow(max(dot(N, H), 0.0), 28.0) * smoothstep(0.25, 0.65, t) * (1.0 - 0.7 * smoothstep(0.8, 1.0, t)) * smoothstep(14.0, 5.0, dist);
  /* sun behind the hill shines through the upper third of the blade, only against the light */
  vBack = pow(max(dot(-V, uSunDir), 0.0), 6.0) * smoothstep(0.35, 0.75, t) * (1.0 - 0.55 * smoothstep(0.8, 1.0, t)) * uBackLight;
  vFog = airFog(wp.xyz, dist);

  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const grassFragment = /* glsl */ `
${COMMON}
uniform vec3 uRootCol;
uniform vec3 uMidCol;
uniform vec3 uTipCol;
uniform vec3 uDryCol;
uniform float uDry;
uniform float uA2C;

varying float vT;
varying float vTone;
varying float vClump;
varying float vPress;
varying float vGust;
varying vec3 vSky;
varying vec3 vSun;
varying float vSpec;
varying float vBack;
varying float vFog;
varying float vEdge;

void main(){
  vec3 col = mix(uRootCol, uMidCol, smoothstep(0.0, 0.55, vT));
  col = mix(col, uTipCol, smoothstep(0.45, 1.0, vT) * (0.35 + 0.65 * vClump));
  /* dry, sun-bleached tips on some of the blades: the main sign of a living meadow */
  col = mix(col, uDryCol, smoothstep(1.0 - uDry, 1.0, vTone) * 0.5 * smoothstep(0.35, 1.0, vT));
  col *= 0.62 + 0.62 * vClump * vClump;

  /* self-shadowing inside the turf: almost no sky reaches the roots */
  float ao = mix(0.14, 1.0, smoothstep(0.0, 0.85, vT));

  vec3 c = col * (vSky + vSun) * ao;
  c += col * uSunCol * vBack * 1.1;
  c += vec3(0.55, 0.52, 0.30) * uSunCol * vSpec * 0.08;
  /* Wind you can see: blades flattened by a gust turn their pale underside up, and silver
     patches run across the hill. */
  c += vec3(0.075, 0.085, 0.05) * vGust * vGust * vT * uAmbient;
  c *= 1.0 - vPress * 0.15;
  c = mix(c, uFogCol, vFog);

  /* Alpha to coverage along the blade edge: distance to the edge in pixels through fwidth, and the
     GPU turns alpha into a share of MSAA samples. A slanted thin blade stops being a staircase. */
  float coverage = 1.0;
  if (uA2C > 0.5) {
    float e = min(vEdge, 1.0 - vEdge);
    coverage = clamp(e / max(fwidth(vEdge), 1e-4) + 0.25, 0.0, 1.0);
  }
  gl_FragColor = vec4(c, coverage);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const groundVertex = /* glsl */ `
varying vec3 vW;
varying vec3 vN;
varying float vDist;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vDist = distance(cameraPosition, wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/* The ground is painted the colour of the lowest layer of grass. In the gaps between blades you
   should see the depth of the turf, not soil. */
export const groundFragment = /* glsl */ `
${COMMON}
uniform vec3 uRootCol;
uniform vec3 uMidCol;
varying vec3 vW;
varying vec3 vN;
varying float vDist;

float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}

void main(){
  float n = n2(vW.xz * 1.7) * 0.6 + n2(vW.xz * 6.0) * 0.4;
  float streak = n2(vec2(vW.x * 38.0, vW.z * 9.0)) * 0.5 + n2(vec2(vW.x * 9.0, vW.z * 38.0)) * 0.5;
  vec3 soil = mix(uRootCol * 1.6, uMidCol * 0.8, n * 0.6 + streak * 0.4);
  vec3 N = normalize(vN);
  vec3 light = skyLight(N) * 0.6 + uSunCol * max(dot(N, uSunDir), 0.0);
  vec3 c = mix(soil * light, uFogCol, airFog(vW, vDist));
  /* past the meadow the plain dissolves into the horizon colour, whatever the haze is set to:
     a hard brown line under the sky is the first thing the eye finds */
  float far = smoothstep(9.0, 26.0, vDist);
  /* fully dissolved ground is not drawn at all: the sky behind it carries the sun glow, and a plane
     painted in the flat horizon colour would cut a straight line through that glow */
  if (far > 0.995) discard;
  c = mix(c, uFogCol, far);
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const skyVertex = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

/* A gradient from the horizon colour (which is also the fog colour, so the hill dissolves into it)
   to the zenith, with a soft sun disc and its glow. */
export const skyFragment = /* glsl */ `
uniform vec3 uFogCol;
uniform vec3 uZenithCol;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.2, 1.0);
  vec3 c = mix(uFogCol, uZenithCol, smoothstep(0.02, 0.42, h));
  float s = max(dot(d, normalize(uSunDir)), 0.0);
  c += uSunCol * (pow(s, 700.0) * 1.6 + pow(s, 40.0) * 0.32 + pow(s, 6.0) * 0.12);
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
