import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import GUI from "lil-gui";
import { TRAIL_SLOTS, grassVertex, grassFragment, groundVertex, groundFragment, skyVertex, skyFragment } from "./grass.glsl.js";
import { DEFAULTS, PRESETS, readUrl, writeUrl } from "./settings.js";
import { heightAt, normalAt, voronoiCell, hash01, fbm, smooth, makeRng } from "./terrain.js";

/* Windcrest — a hill of real grass.
 *
 * Every blade is geometry: seven vertices, instanced, the whole meadow in one draw call. Nothing is
 * animated on the CPU. A blade carries where it stands, which way it faces, how long it is and which
 * tuft it belongs to; the vertex shader decides each frame where its tip is, given the wind, the
 * cursor and the camera. That is why the blade count, the wind and the light are all sliders. */

const settings = { ...DEFAULTS, ...readUrl() };

const canvas = document.getElementById("stage");
let renderer;

try
{
    /* antialias: the canvas itself is multisampled, which is what alpha-to-coverage needs */
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
}
catch(error)
{
    document.getElementById("fallback").hidden = false;
    throw error;
}

renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.NeutralToneMapping;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 400);
camera.position.set(1.2, 3.4, 16.5);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1.7, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 2.5;
controls.maxDistance = 30;
/* the camera stays above the turf */
controls.maxPolarAngle = 1.56;
controls.minPolarAngle = 0.35;

const light = {
    uSunDir: { value: new THREE.Vector3() },
    uSunCol: { value: new THREE.Color() },
    uSkyCol: { value: new THREE.Color() },
    uGroundCol: { value: new THREE.Color() },
    uAmbient: { value: 1 },
    uFogCol: { value: new THREE.Color() },
    uHaze: { value: 1 },
    uRootCol: { value: new THREE.Color() },
    uMidCol: { value: new THREE.Color() },
    uTipCol: { value: new THREE.Color() },
    uDryCol: { value: new THREE.Color() },
};

const uniforms = {
    ...light,
    uTime: { value: 0 },
    uWind: { value: 1 },
    uWindDir: { value: new THREE.Vector2(1, 0) },
    uGustScale: { value: 1 },
    uFlutter: { value: 1 },
    uTrail: { value: Array.from({ length: TRAIL_SLOTS }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uPushR: { value: 0.7 },
    uPixelWorld: { value: 0.001 },
    uCoverageMax: { value: 3.2 },
    uMinPixels: { value: 0.9 },
    uLength: { value: 1 },
    uWidth: { value: 0.075 },
    uBackLight: { value: 1 },
    uDry: { value: 0.28 },
    uA2C: { value: 1 },
};

const grassMaterial = new THREE.ShaderMaterial({
    vertexShader: grassVertex,
    fragmentShader: grassFragment,
    uniforms,
    side: THREE.DoubleSide,
    alphaToCoverage: settings.a2c,
});

/* ── ground and sky ─────────────────────────────────────────────────────── */

{
    const size = 90, segments = 220;
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    geometry.rotateX(-Math.PI / 2);
    const position = geometry.attributes.position;
    for(let i = 0; i < position.count; i++) position.setY(i, heightAt(position.getX(i), position.getZ(i)));
    geometry.computeVertexNormals();

    scene.add(new THREE.Mesh(geometry, new THREE.ShaderMaterial({ vertexShader: groundVertex, fragmentShader: groundFragment, uniforms: light })));
}

const skyUniforms = { uFogCol: light.uFogCol, uZenithCol: { value: new THREE.Color() }, uSunDir: light.uSunDir, uSunCol: light.uSunCol };
{
    const sky = new THREE.Mesh(
        new THREE.BoxGeometry(2, 2, 2),
        new THREE.ShaderMaterial({ vertexShader: skyVertex, fragmentShader: skyFragment, uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false, depthFunc: THREE.LessEqualDepth }),
    );
    sky.frustumCulled = false;
    sky.renderOrder = -1;
    scene.add(sky);
}

/* ── the meadow ─────────────────────────────────────────────────────────── */

/* One blade: three steps and a shared tip, 7 vertices and 5 triangles. The vertex shader is the most
   expensive thing on the page, so every vertex here is paid for a few hundred thousand times. */
function bladeGeometry(detail)
{
    const geometry = new THREE.InstancedBufferGeometry();

    if(detail <= 3)
    {
        geometry.setAttribute("position", new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0, 1, 0], 3));
        geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
        geometry.setIndex([0, 1, 2]);
        return geometry;
    }

    const steps = 3;
    const vertices = [], uvs = [], index = [];
    for(let i = 0; i < steps; i++)
    {
        const t = i / steps;
        const w = 0.5 * (1 - Math.pow(t, 1.6));
        vertices.push(-w, t, 0, w, t, 0);
        uvs.push(0, t, 1, t);
    }
    const tip = steps * 2;
    vertices.push(0, 1, 0);
    uvs.push(0.5, 1);
    for(let i = 0; i < steps - 1; i++)
    {
        const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
        index.push(a, b, c, b, d, c);
    }
    index.push(tip - 2, tip - 1, tip);

    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(index);
    return geometry;
}

let meadow = null;
let seed = 0x3f9a1c7b;

/* Blades are planted by rejection: a random spot on the disc survives with the density the meadow
   should have there. Thin patches come from slow noise; near the rim the grass fades out instead of
   stopping on a line. Each blade then finds its Voronoi cell, steps a little towards the centre and
   remembers how far to lean. */
function plant()
{
    if(meadow)
    {
        meadow.geometry.dispose();
        scene.remove(meadow);
    }

    const rng = makeRng(seed);
    const count = Math.round(settings.count);
    const radius = settings.area;
    const offset = new Float32Array(count * 3);
    const normal = new Float32Array(count * 3);
    const rnd = new Float32Array(count * 4);
    const clumpTone = new Float32Array(count);
    const lean = new Float32Array(count * 2);
    const n = { x: 0, y: 1, z: 0 };
    const cell = { cx: 0, cz: 0, id: 0, dist: 0 };

    let k = 0, guard = 0;
    while(k < count && guard < count * 30)
    {
        guard++;
        let x = (rng() * 2 - 1) * radius;
        let z = (rng() * 2 - 1) * radius;
        const r = Math.hypot(x, z) / radius;
        if(r > 1) continue;

        const rim = 1 - smooth(0.72, 1, r);
        if(rng() > rim) continue;
        const bare = 0.72 + 0.28 * smooth(0.28, 0.52, fbm(x * 0.55 + 7.3, z * 0.55 - 2.1, 3));
        if(rng() > bare) continue;

        voronoiCell(x, z, settings.clump, cell);
        const pull = 0.07 * hash01(cell.id, 3);
        x += (cell.cx - x) * pull;
        z += (cell.cz - z) * pull;
        const y = heightAt(x, z);
        normalAt(x, z, n);

        offset.set([x, y, z], k * 3);
        normal.set([n.x, n.y, n.z], k * 3);

        /* 9 to 18 cm. Shorter grass is detail smaller than a pixel: the screen cannot show it, it only shimmers. */
        let length = (0.09 + 0.09 * rng()) * (0.75 + 0.5 * fbm(x * 1.2 - 5, z * 1.2 + 9, 2)) * (0.88 + 0.26 * hash01(cell.id, 1));
        if(rng() < 0.06) length *= 1.6; // a few long blades break the lawn
        rnd.set([rng() * Math.PI * 2, length, 0, rng()], k * 4);

        const tone = fbm(x * 0.9 + 17, z * 0.9 - 3, 3) * 0.6 + fbm(x * 5.5 - 3.3, z * 5.5 + 2.1, 2) * 0.4;
        clumpTone[k] = Math.min(1, tone * 0.88 + hash01(cell.id, 2) * 0.14);

        /* lean towards the tuft centre, stronger at the edge of the cell, plus a little scatter */
        const toCentre = Math.hypot(cell.cx - x, cell.cz - z) || 1;
        const amount = (0.05 + 0.16 * smooth(0.02, 0.14, cell.dist)) * (0.5 + 0.5 * hash01(cell.id, 4)) * settings.lean;
        lean.set([((cell.cx - x) / toCentre) * amount + (rng() - 0.5) * 0.36, ((cell.cz - z) / toCentre) * amount + (rng() - 0.5) * 0.36], k * 2);
        k++;
    }

    const geometry = bladeGeometry(settings.detail);
    geometry.setAttribute("aOffset", new THREE.InstancedBufferAttribute(offset, 3));
    geometry.setAttribute("aNormal", new THREE.InstancedBufferAttribute(normal, 3));
    geometry.setAttribute("aRnd", new THREE.InstancedBufferAttribute(rnd, 4));
    geometry.setAttribute("aClump", new THREE.InstancedBufferAttribute(clumpTone, 1));
    geometry.setAttribute("aLean", new THREE.InstancedBufferAttribute(lean, 2));
    geometry.instanceCount = k;

    meadow = new THREE.Mesh(geometry, grassMaterial);
    meadow.frustumCulled = false;
    scene.add(meadow);
    planted = k;
}

let planted = 0;

function resize()
{
    const width = innerWidth;
    const height = innerHeight;

    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    uniforms.uPixelWorld.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / (height * renderer.getPixelRatio());
}

addEventListener("resize", resize);

/* ── the cursor ─────────────────────────────────────────────────────────── */

/* The pointer ray is marched against the same height function the grass stands on, then refined by
   bisection. No mesh raycast, no picking buffer. */
const pointer = new THREE.Vector2(2, 2);
const ray = new THREE.Raycaster();
const hit = new THREE.Vector3();
const lastDrop = new THREE.Vector3(1e6, 0, 0);
let dragging = false;
let slot = 0;

canvas.addEventListener("pointermove", (event) => pointer.set((event.clientX / innerWidth) * 2 - 1, -(event.clientY / innerHeight) * 2 + 1));
canvas.addEventListener("pointerdown", () => (dragging = true));
addEventListener("pointerup", () => (dragging = false));
canvas.addEventListener("pointerleave", () => pointer.set(2, 2));

function pickHill()
{
    if(pointer.x > 1.5) return false;
    ray.setFromCamera(pointer, camera);
    const { origin, direction } = ray.ray;

    let previous = 0;
    for(let t = 0.5; t < 60; t += 0.35)
    {
        hit.copy(origin).addScaledVector(direction, t);
        if(hit.y < heightAt(hit.x, hit.z))
        {
            let a = previous, b = t;
            for(let i = 0; i < 12; i++)
            {
                const m = (a + b) / 2;
                hit.copy(origin).addScaledVector(direction, m);
                if(hit.y < heightAt(hit.x, hit.z)) b = m; else a = m;
            }
            return Math.hypot(hit.x, hit.z) < settings.area;
        }
        previous = t;
    }
    return false;
}

function updateTrail(delta)
{
    const fade = Math.exp(-delta * 1.3);
    for(const entry of uniforms.uTrail.value) entry.w *= fade;

    if(dragging || settings.push <= 0 || !pickHill()) return;
    if(hit.distanceTo(lastDrop) < settings.push * 0.45) return;

    lastDrop.copy(hit);
    uniforms.uTrail.value[slot].set(hit.x, hit.y, hit.z, 1);
    slot = (slot + 1) % TRAIL_SLOTS;
}

/* ── the panel ──────────────────────────────────────────────────────────────
   In the order you would reach for it: how much grass there is and how it grows, what the wind does
   to it, how it is lit, what colour it is, and the two tricks that keep it from shimmering. */

const gui = new GUI({ title: "Windcrest", width: 300 });
const apply = () => { sync(); writeUrl(settings); };
const replant = () => { plant(); apply(); };

const field = gui.addFolder("Meadow");
field.add(settings, "count", 20000, 600000, 5000).name("blades").onFinishChange(replant);
field.add(settings, "area", 5, 24, 0.5).name("radius, m").onFinishChange(replant);
field.add(settings, "clump", 0.08, 0.6, 0.01).name("tuft size, m").onFinishChange(replant);
field.add(settings, "lean", 0, 2.5, 0.05).name("lean into tufts").onFinishChange(replant);
field.add(settings, "length", 0.4, 2.5, 0.01).name("blade length").onChange(apply);
field.add(settings, "width", 0.03, 0.16, 0.001).name("blade width").onChange(apply);
field.add(settings, "detail", { "7 vertices": 7, "3 vertices (far LOD)": 3 }).name("blade shape").onChange(replant);

const air = gui.addFolder("Wind");
air.add(settings, "wind", 0, 3, 0.01).name("strength").onChange(apply);
air.add(settings, "windAngle", 0, 360, 1).name("direction, °").onChange(apply);
air.add(settings, "gustScale", 0.3, 3, 0.01).name("gust size").onChange(apply);
air.add(settings, "flutter", 0, 3, 0.01).name("flutter").onChange(apply);
air.add(settings, "speed", 0, 3, 0.01).name("time speed").onChange(apply);
air.add(settings, "push", 0, 1.6, 0.01).name("cursor radius, m").onChange(apply);

const sun = gui.addFolder("Light");
sun.add(settings, "sunElevation", 0, 85, 0.5).name("sun height, °").onChange(apply);
sun.add(settings, "sunAzimuth", 0, 360, 1).name("sun direction, °").onChange(apply);
sun.add(settings, "sunPower", 0, 6, 0.05).name("sun power").onChange(apply);
sun.addColor(settings, "sunColor").name("sun").onChange(apply);
sun.add(settings, "backLight", 0, 2, 0.01).name("light through tips").onChange(apply);
sun.add(settings, "ambient", 0, 2.5, 0.01).name("sky light").onChange(apply);
sun.addColor(settings, "skyColor").name("from above").onChange(apply);
sun.addColor(settings, "bounceColor").name("from below").onChange(apply);
sun.add(settings, "haze", 0, 2, 0.01).name("haze").onChange(apply);
sun.addColor(settings, "fogColor").name("horizon").onChange(apply);
sun.addColor(settings, "zenithColor").name("zenith").onChange(apply);
sun.add(settings, "exposure", 0.3, 2.5, 0.01).name("exposure").onChange(apply);
sun.close();

const colour = gui.addFolder("Grass colour");
colour.addColor(settings, "rootColor").name("root").onChange(apply);
colour.addColor(settings, "midColor").name("middle").onChange(apply);
colour.addColor(settings, "tipColor").name("tip").onChange(apply);
colour.addColor(settings, "dryColor").name("dry tips").onChange(apply);
colour.add(settings, "dry", 0, 1, 0.01).name("share of dry blades").onChange(apply);
colour.close();

const quality = gui.addFolder("Anti-shimmer");
quality.add(settings, "minPixels", 0, 2.5, 0.05).name("min width, px").onChange(apply);
quality.add(settings, "coverage", 1, 6, 0.1).name("widen with distance").onChange(apply);
quality.add(settings, "a2c").name("alpha to coverage").onChange(() => { grassMaterial.alphaToCoverage = settings.a2c; grassMaterial.needsUpdate = true; apply(); });
quality.close();

const view = gui.addFolder("View");
view.add(settings, "autoRotate").name("orbit by itself").onChange(apply);
view.add(settings, "rotateSpeed", -2, 2, 0.05).name("orbit speed").onChange(apply);
view.add(settings, "paused").name("freeze time").onChange(apply).listen();
view.close();

const actions = {
    preset: "sunset",
    reseed: () => { seed = (Math.random() * 0xffffffff) >>> 0; plant(); },
    copyLink: async () =>
    {
        writeUrl(settings);
        try { await navigator.clipboard.writeText(location.href); toast("Link copied"); }
        catch { toast("Copy failed, the address bar has it"); }
    },
    copySettings: async () =>
    {
        try { await navigator.clipboard.writeText(JSON.stringify(settings, null, 2)); toast("Settings copied"); }
        catch { toast("Copy failed"); }
    },
    reset: () => load(DEFAULTS),
};

gui.add(actions, "preset", Object.keys(PRESETS)).name("preset").onChange((key) => load({ ...DEFAULTS, ...PRESETS[key] }));
gui.add(actions, "reseed").name("new seeds");
gui.add(actions, "copyLink").name("copy link to this look");
gui.add(actions, "copySettings").name("copy settings as JSON");
gui.add(actions, "reset").name("reset");

function sync()
{
    const elevation = THREE.MathUtils.degToRad(settings.sunElevation);
    const azimuth = THREE.MathUtils.degToRad(settings.sunAzimuth);
    light.uSunDir.value.set(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation)).normalize();
    light.uSunCol.value.set(settings.sunColor).multiplyScalar(settings.sunPower);
    light.uSkyCol.value.set(settings.skyColor);
    light.uGroundCol.value.set(settings.bounceColor);
    light.uAmbient.value = settings.ambient;
    light.uFogCol.value.set(settings.fogColor);
    light.uHaze.value = settings.haze;
    light.uRootCol.value.set(settings.rootColor);
    light.uMidCol.value.set(settings.midColor);
    light.uTipCol.value.set(settings.tipColor);
    light.uDryCol.value.set(settings.dryColor);
    skyUniforms.uZenithCol.value.set(settings.zenithColor);

    const wind = THREE.MathUtils.degToRad(settings.windAngle);
    uniforms.uWind.value = settings.wind;
    uniforms.uWindDir.value.set(Math.cos(wind), Math.sin(wind));
    uniforms.uGustScale.value = settings.gustScale;
    uniforms.uFlutter.value = settings.flutter;
    uniforms.uPushR.value = Math.max(0.05, settings.push);
    uniforms.uLength.value = settings.length;
    uniforms.uWidth.value = settings.width;
    uniforms.uBackLight.value = settings.backLight;
    uniforms.uDry.value = settings.dry;
    uniforms.uMinPixels.value = settings.minPixels;
    uniforms.uCoverageMax.value = settings.coverage;
    uniforms.uA2C.value = settings.a2c ? 1 : 0;

    renderer.toneMappingExposure = settings.exposure;
    document.body.style.background = settings.fogColor;
    controls.autoRotate = settings.autoRotate;
    controls.autoRotateSpeed = settings.rotateSpeed;
}

function load(next)
{
    const needsPlanting = ["count", "area", "clump", "lean", "detail"].some((name) => next[name] !== settings[name]);

    Object.assign(settings, next);
    gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
    grassMaterial.alphaToCoverage = settings.a2c;
    grassMaterial.needsUpdate = true;

    if(needsPlanting) plant();
    apply();
}

/* ── toast, stats, keys ─────────────────────────────────────────────────── */

const note = document.createElement("p");
note.className = "toast";
document.body.appendChild(note);
let noteTimer = 0;

function toast(text)
{
    note.textContent = text;
    note.classList.add("is-on");
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => note.classList.remove("is-on"), 1600);
}

const stats = document.createElement("p");
stats.className = "stats";
document.body.appendChild(stats);

addEventListener("keydown", (event) =>
{
    if(event.key === "h" || event.key === "H") gui.show(gui._hidden);
    if(event.code === "Space")
    {
        event.preventDefault();
        settings.paused = !settings.paused;
        writeUrl(settings);
    }
});

/* ── the loop ───────────────────────────────────────────────────────────── */

const clock = new THREE.Clock();
let frames = 0;
let fpsAt = performance.now();

function tick()
{
    requestAnimationFrame(tick);

    const delta = Math.min(clock.getDelta(), 0.1);
    if(!settings.paused) uniforms.uTime.value += delta * settings.speed;

    updateTrail(delta);
    controls.update();
    renderer.render(scene, camera);

    frames++;
    const now = performance.now();
    if(now - fpsAt > 500)
    {
        stats.textContent = `${Math.round((frames * 1000) / (now - fpsAt))} fps · ${Math.round(planted / 1000)}k blades`;
        frames = 0;
        fpsAt = now;
    }
}

/* A handle for the console: poke at the hill without digging through the bundle. */
globalThis.windcrest = { settings, uniforms, grassMaterial, renderer, scene, camera, controls, gui, plant, load, DEFAULTS, PRESETS };

plant();
resize();
sync();
tick();
