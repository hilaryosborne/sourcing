// Sync the canonical consumer skills (docs/skills/<name>/SKILL.md) into the site's public dir so
// they are HOSTED and downloadable at /skills/<name>.md — one source of truth, no hand-copied
// drift. Runs before every `vitepress dev`/`build`. The output (website/public/skills/) is
// generated and git-ignored.
import { readdir, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)); // website/scripts
const skillsSrc = join(here, "..", "..", "docs", "skills"); // repo/docs/skills
const out = join(here, "..", "public", "skills"); // website/public/skills

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const dirs = (await readdir(skillsSrc, { withFileTypes: true })).filter((entry) => entry.isDirectory());
for (const dir of dirs) {
  const body = await readFile(join(skillsSrc, dir.name, "SKILL.md"), "utf8");
  await writeFile(join(out, `${dir.name}.md`), body);
}

console.log(`synced ${dirs.length} skill(s) → website/public/skills/`);
