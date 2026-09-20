// Builds THIRD_PARTY_NOTICES.md and public/THIRD_PARTY_NOTICES.txt: every production dependency (walked
// through node_modules) with its full license text, plus the assets listed in tools/assets.json.
// The .txt copy ships with the site, because the bundler strips license comments from the build.
//   node tools/notices.mjs
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const own = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const assets = existsSync(join(root, "tools/assets.json")) ? JSON.parse(readFileSync(join(root, "tools/assets.json"), "utf8")) : [];

const seen = new Map();

function walk(name)
{
    if(seen.has(name)) return;

    const dir = join(root, "node_modules", name);
    const manifestPath = join(dir, "package.json");
    if(!existsSync(manifestPath)) return;

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const file = readdirSync(dir).find((entry) => /^(licen[sc]e|copying)(\.|$)/i.test(entry));
    const repository = typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url ?? "";

    seen.set(name, {
        version: manifest.version,
        license: typeof manifest.license === "string" ? manifest.license : manifest.license?.type ?? "see text",
        repository: repository.replace(/^git\+/, "").replace(/\.git$/, ""),
        text: file ? readFileSync(join(dir, file), "utf8").trim() : "(no license file in the package)",
    });

    for(const dependency of Object.keys(manifest.dependencies ?? {})) walk(dependency);
}

for(const dependency of Object.keys(own.dependencies ?? {})) walk(dependency);

const packages = [...seen.entries()].sort(([a], [b]) => a.localeCompare(b));
const out = [];

out.push("# Third-party notices", "");
out.push(`${own.name} is released under the PolyForm Noncommercial License 1.0.0 (see LICENSE); commercial use needs a separate license (see COMMERCIAL.md).`);
out.push("The components below are not covered by that license. Each keeps its own license, and nothing here restricts what those licenses allow.", "");

if(assets.length)
{
    out.push("## Assets", "", "| What | Where | Author / source | License |", "| --- | --- | --- | --- |");
    for(const asset of assets) out.push(`| ${asset.what} | ${asset.where} | ${asset.source} | ${asset.license} |`);
    out.push("");
}

out.push("## Packages", "", "| Package | License | Repository |", "| --- | --- | --- |");
for(const [name, info] of packages) out.push(`| ${name}@${info.version} | ${info.license} | ${info.repository} |`);
out.push("", "## License texts");
for(const [name, info] of packages) out.push("", `### ${name}@${info.version}`, "", "```", info.text, "```");
out.push("");

const text = out.join("\n");
writeFileSync(join(root, "THIRD_PARTY_NOTICES.md"), text);
writeFileSync(join(root, "public/THIRD_PARTY_NOTICES.txt"), text);
console.log(`notices: ${packages.length} packages, ${assets.length} assets`);
