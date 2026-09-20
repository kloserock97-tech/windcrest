/* The hill is one analytic height function. The grass layout, the ground mesh and the cursor ray all
 * read it, so blades always stand exactly on the surface you see. */

export const HILL = { height: 2.3, spreadX: 6.8, spreadZ: 4.4 };

/* Deterministic PRNG (mulberry32): the same meadow on every reload, a new one on "new seeds". */
export function makeRng(seed = 0x3f9a1c7b)
{
    let a = seed;
    return () =>
    {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function hash2(x, y)
{
    let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
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
            const id = (Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663)) >>> 0;
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
    let n = Math.imul(id ^ Math.imul(salt, 0x9e3779b1), 1274126177);
    n = Math.imul(n ^ (n >>> 15), 0x85ebca6b);
    return ((n ^ (n >>> 13)) >>> 0) / 4294967296;
}

export function smooth(a, b, x)
{
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}
