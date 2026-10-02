// Checks that both languages have the same keys and that every literal t("…") key used in the code exists.
import fs from "node:fs";
import path from "node:path";

const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (typeof v === "object" ? flat(v, `${p}${k}.`) : [`${p}${k}`]));
const ar = new Set(flat(JSON.parse(fs.readFileSync("messages/ar.json", "utf8"))));
const en = new Set(flat(JSON.parse(fs.readFileSync("messages/en.json", "utf8"))));
let bad = 0;
for (const k of ar) if (!en.has(k)) console.log("missing in en:", k), bad++;
for (const k of en) if (!ar.has(k)) console.log("missing in ar:", k), bad++;

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
for (const file of walk("src").filter((f) => /\.tsx?$/.test(f))) {
  const src = fs.readFileSync(file, "utf8");
  for (const m of src.matchAll(/\bt\(\s*"([a-zA-Z0-9_.]+)"/g)) {
    if (!ar.has(m[1])) console.log(`${file}: unknown key ${m[1]}`), bad++;
  }
  // template keys such as t(`types.${x}`): the static prefix must exist
  for (const m of src.matchAll(/\bt\(\s*`([a-zA-Z0-9_.]+)\$\{/g)) {
    if (![...ar].some((k) => k.startsWith(m[1]))) console.log(`${file}: unknown key prefix ${m[1]}`), bad++;
  }
}
console.log(bad ? `${bad} problem(s)` : "i18n ok");
process.exit(bad ? 1 : 0);
