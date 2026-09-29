/* The hill is one analytic height function. The grass layout, the ground mesh and the cursor ray all
 * read it, so blades always stand exactly on the surface you see. */

export const HILL = { height: 2.3, spreadX: 6.8, spreadZ: 4.4 };

// Hash Kit (our own hash, see shelf/items/hash-kit)
const SALT = 0xb31c96c9; // keeps cell (0, 0) away from the mixer's fixed point hashU(0) = 0

function hashU(x)
{
    x ^= x >>> 16; x = Math.imul(x, 0x3f9c86cb);
    x ^= x >>> 14; x = Math.imul(x, 0x1ae9dacf);
    x ^= x >>> 15;
    return x >>> 0;
}
const hash2U = (x, y) => hashU((x + hashU((y + SALT) >>> 0)) >>> 0);
const hashUnit = (h) => (h >>> 8) / 16777216;
const hash2 = (x, y) => hashUnit(hash2U(Math.floor(x), Math.floor(y)));

/* Seeded random numbers, a Weyl sequence through the hash: the same meadow on every reload, a new one
   on "new seeds". */
export function makeRng(seed = 0x3f9a1c7b)
{
    let s = seed >>> 0;
    return () =>
    {
        s = (s + SALT) >>> 0;
        return hashU(s) / 4294967296;
    };
}

function vnoise(x, y)
{
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
    const t = a + (b - a) * ux;
    return t + (c + (d - c) * ux - t) * uy;
}

/* Octaves are rotated as well as scaled, so the noise lattice never shows through. */
export function fbm(x, y, octaves = 4)
{
    let s = 0, amp = 0.5, norm = 0;
    for(let i = 0; i < octaves; i++)
    {
        s += amp * vnoise(x, y);
        norm += amp;
        const nx = 0.8 * x + 0.6 * y, ny = -0.6 * x + 0.8 * y;
        x = nx * 2.07 + 3.1;
        y = ny * 2.07 - 1.7;
        amp *= 0.5;
    }
    return s / norm;
}

export function heightAt(x, z)
{
    const r2 = (x * x) / (HILL.spreadX * HILL.spreadX) + (z * z) / (HILL.spreadZ * HILL.spreadZ);
    const dome = HILL.height * Math.exp(-r2);
    /* Bumps: large ones so the silhouette is not drawn with a compass, small ones under the grass. */
    const bumps = (fbm(x * 0.35 + 11.0, z * 0.35 - 4.0, 3) - 0.5) * 0.34 + (fbm(x * 1.6, z * 1.6, 2) - 0.5) * 0.06;
    return dome + bumps;
}

const E = 0.02;
export function normalAt(x, z, out)
{
    const dx = heightAt(x + E, z) - heightAt(x - E, z);
    const dz = heightAt(x, z + E) - heightAt(x, z - E);
    const nx = -dx, ny = 2 * E, nz = -dz;
    const l = Math.hypot(nx, ny, nz);
    out.x = nx / l; out.y = ny / l; out.z = nz / l;
    return out;
}

/* Voronoi cell on a jittered grid: nearest centre, its id and the distance to it. Blades know their
   cell, lean towards its centre and share its height and tone, so the meadow grows in tufts with
   gaps between them instead of lying flat like a carpet. */
export function voronoiCell(x, z, size, out)
{
    const gx = Math.floor(x / size), gz = Math.floor(z / size);
    let best = Infinity;
    for(let dz = -1; dz <= 1; dz++)
    {
        for(let dx = -1; dx <= 1; dx++)
        {
            const ix = gx + dx, iz = gz + dz;
            const id = hash2U(ix, iz);
            const cx = (ix + hash01(id, 7)) * size;
            const cz = (iz + hash01(id, 8)) * size;
            const d = (cx - x) * (cx - x) + (cz - z) * (cz - z);
            if(d < best) { best = d; out.cx = cx; out.cz = cz; out.id = id; }
        }
    }
    out.dist = Math.sqrt(best);
}

export function hash01(id, salt)
{
    return hashUnit(hash2U(id, salt));
}

export function smooth(a, b, x)
{
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}
