/* Defaults, presets, and the address bar.
 *
 * Every setting that changes the picture is a plain number or string here, so a look can travel:
 * the panel writes the ones that differ from the defaults into the URL hash, and opening that link
 * reproduces the hill exactly. Short keys keep the link readable. */

export const DEFAULTS = {
    count: 380000,
    area: 11,
    detail: 7,
    length: 1,
    width: 0.075,
    clump: 0.2,
    lean: 1,
    dry: 0.28,

    wind: 1,
    windAngle: 24,
    gustScale: 1,
    flutter: 1,
    speed: 1,
    push: 0.7,

    sunElevation: 5,
    sunAzimuth: 172,
    sunColor: "#ffc48a",
    sunPower: 1.7,
    skyColor: "#c4d8f2",
    bounceColor: "#4a5230",
    ambient: 1.5,
    backLight: 1.3,
    fogColor: "#f2c89a",
    zenithColor: "#aab7c4",
    haze: 0.4,
    exposure: 1,

    rootColor: "#16220f",
    midColor: "#3c6b20",
    tipColor: "#6c9c38",
    dryColor: "#958d5f",

    minPixels: 0.9,
    coverage: 3.2,
    a2c: true,

    autoRotate: true,
    rotateSpeed: 0.25,
    paused: false,
};

/* Looks the hill can take without touching the code. They are not modes: each one is a handful of
   the same sliders in a different place. */
export const PRESETS = {
    sunset: {},
    midday: {
        sunElevation: 52, sunAzimuth: 150, sunColor: "#fff3df", sunPower: 2.8, skyColor: "#a9c6ee", ambient: 1.05,
        backLight: 0.2, fogColor: "#cfe0f0", zenithColor: "#5f8fd0", haze: 0.55, dry: 0.16, wind: 0.7,
    },
    gale: {
        wind: 2.4, gustScale: 1.5, flutter: 1.6, speed: 1.5, windAngle: 60, sunElevation: 14, sunColor: "#e8e2d6", sunPower: 1.5,
        skyColor: "#93a0ad", ambient: 1.1, backLight: 0.35, fogColor: "#b9c0c4", zenithColor: "#6d7a86", haze: 1.35, length: 1.15,
    },
    august: {
        dry: 0.7, rootColor: "#2a2412", midColor: "#6e6a2a", tipColor: "#a89a48", dryColor: "#c9b26a", sunElevation: 24,
        sunColor: "#ffdca8", skyColor: "#b9c7d8", fogColor: "#f0dcae", zenithColor: "#93b0cf", wind: 0.55, haze: 0.8, length: 1.2,
    },
    moonlit: {
        sunElevation: 5.5, sunAzimuth: 170, sunColor: "#b9ceff", sunPower: 0.55, skyColor: "#34466b", bounceColor: "#10160f",
        ambient: 1.15, backLight: 1.6, fogColor: "#1a2436", zenithColor: "#070c18", haze: 0.9, exposure: 1.6, wind: 0.8,
    },
};

const KEYS = {
    count: "n", area: "ar", detail: "dt", length: "l", width: "w", clump: "cl", lean: "ln", dry: "d",
    wind: "wi", windAngle: "wa", gustScale: "gs", flutter: "fl", speed: "s", push: "pu",
    sunElevation: "se", sunAzimuth: "sa", sunColor: "sc", sunPower: "sp", skyColor: "sk", bounceColor: "bo",
    ambient: "am", backLight: "bl", fogColor: "fg", zenithColor: "ze", haze: "hz", exposure: "ex",
    rootColor: "c0", midColor: "c1", tipColor: "c2", dryColor: "c3",
    minPixels: "mp", coverage: "cv", a2c: "a2", autoRotate: "or", rotateSpeed: "rs", paused: "pa",
};

const FROM_KEY = Object.fromEntries(Object.entries(KEYS).map(([name, key]) => [key, name]));

export function readUrl()
{
    const out = {};
    const params = new URLSearchParams(location.hash.replace(/^#/, ""));

    for(const [key, raw] of params)
    {
        const name = FROM_KEY[key];
        if(name === undefined) continue;

        const fallback = DEFAULTS[name];

        if(typeof fallback === "number") { const value = Number(raw); if(Number.isFinite(value)) out[name] = value; }
        else if(typeof fallback === "boolean") out[name] = raw === "1";
        else if(/^#?[0-9a-f]{3,8}$/i.test(raw)) out[name] = raw.startsWith("#") ? raw : `#${raw}`;
    }

    return out;
}

export function writeUrl(settings)
{
    const params = new URLSearchParams();

    for(const [name, key] of Object.entries(KEYS))
    {
        const value = settings[name];
        if(value === DEFAULTS[name]) continue;

        if(typeof value === "boolean") params.set(key, value ? "1" : "0");
        else if(typeof value === "number") params.set(key, String(Math.round(value * 1000) / 1000));
        else params.set(key, String(value).replace(/^#/, ""));
    }

    const hash = params.toString();
    history.replaceState(null, "", hash ? `#${hash}` : location.pathname + location.search);
}
