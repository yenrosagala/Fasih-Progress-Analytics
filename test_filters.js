/* Self-check for the dashboard's multi-select filter logic and the kabupaten
   progress-bar logic. Run: node test_filters.js
   Loads the real inline script from the built site and exercises computeFilterKeys /
   matches / renderProgress's utama+done aggregation, so it fails if the enumerated-
   option detection, the multi-value predicate, the progress math, or kab_code
   ordering regresses. No dependencies: a Proxy stands in for the DOM. */
const fs = require("fs");
const vm = require("vm");

const html = fs.readFileSync("outputs/site/index.html", "utf8");
const js = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join("\n");
if (!js.trim()) throw new Error("no inline script in outputs/site/index.html");

const P = new Proxy(function () {}, {
  get: (t, p) => (p === Symbol.toPrimitive ? () => "" : p === "then" ? undefined : P),
  set: () => true, apply: () => P, construct: () => P,
});
globalThis.document = P; globalThis.window = globalThis;
globalThis.localStorage = P; globalThis.navigator = P;
globalThis.fetch = () => new Promise(() => {});
try { vm.runInThisContext(js); } catch (e) { if (e instanceof SyntaxError) throw e; /* init touches DOM only; functions are defined above it */ }

COLUMNS = [{ key: "name", label: "Survei" }, { key: "data9", label: "Hasil Pendataan" }];
DATA = [
  { name: "A", data9: "1. Berhasil diwawancarai" },
  { name: "A", data9: "5. Bukan usaha pertanian" },
  { name: "A", data9: "6. Pindah keluar SLS" },
  { name: "B", data9: "1. Berhasil diwawancarai" },
];

const fk = computeFilterKeys();
if (!fk.keys.includes("data9")) throw new Error("enumerated column dropped from filters");
if (!fk.multi.includes("data9")) throw new Error("enumerated column not marked multi-select");

FILTER_KEYS = fk.keys;
state.filters = { data9: ["5. Bukan usaha pertanian", "6. Pindah keluar SLS"] };
if (!matches({ data9: "5. Bukan usaha pertanian" }, null)) throw new Error("selected value rejected");
if (!matches({ data9: "6. Pindah keluar SLS" }, null)) throw new Error("second selected value rejected");
if (matches({ data9: "1. Berhasil diwawancarai" }, null)) throw new Error("unselected value leaked through");

state.filters = { data9: [] };
if (!matches({ data9: "1. Berhasil diwawancarai" }, null)) throw new Error("empty filter must pass all");
if (val({ data10: "None" }, "data10") !== "" || val({ data10: "undefined" }, "data10") !== "" || val({ data10: "1. Berhasil diwawancarai" }, "data10") !== "1. Berhasil diwawancarai") throw new Error("val() must blank serializer junk and keep real values");

/* Per-survey schema: a survey's table shows only columns it actually fills,
   while the Dashboard/Progress CORE keys stay. Filter options must follow the
   active survey's rows, not a previous survey's values. */
const vc = visibleColumns(
  [{ key: "name" }, { key: "kab" }, { key: "data1" }, { key: "data2" }, { key: "kab_code" }],
  [{ name: "S", kab: "K", data1: "x" }]);
if (vc.map(c => c.key).join(",") !== "name,kab,data1,kab_code") throw new Error("visibleColumns must drop this survey's empty columns but keep CORE keys");
COLUMNS = [{ key: "name" }, { key: "mode" }];
FILTER_KEYS = ["name", "mode"]; MULTI_KEYS = [];
state = { q: "", page: 0, pageSize: 100, sort: { key: null, dir: 1 }, filters: { name: [], mode: [] }, graphKey: null };
DATA = [{ name: "SITASI", mode: "CAPI" }, { name: "SITASI", mode: "CAPI" }];
if (distinctOptions("mode").join(",") !== "CAPI") throw new Error("filter values must come from the active survey");
DATA = [{ name: "SKP", mode: "PAPI" }, { name: "SKP", mode: "Kertas" }];
const dynModes = distinctOptions("mode").join(",");
if (dynModes !== "Kertas,PAPI") throw new Error("filter values must change when survey changes: " + dynModes);
console.log("test_filters OK");

/* --- Progress per Kabupaten: target = sampel utama, hasil = utama+cadangan
   dengan hasil pendataan "1. Berhasil diwawancarai" (status diabaikan) --- */
const els = {};
globalThis.document = { getElementById: id => els[id] || (els[id] = { innerHTML: "", style: {}, onchange: null }) };
STATUS_DEF = [
  { key: "submitted", aliases: ["SUBMIT"] },
  { key: "approved",  aliases: ["APPROVED"] },
  { key: "rejected",  aliases: ["REJECTED"] },
  { key: "draft",     aliases: ["DRAFT"] },
  { key: "open",      aliases: ["OPEN"] },
  { key: "final",     aliases: ["ADMIN"] },
];
STATUS_ORDER = ["submitted", "approved", "final", "rejected", "draft", "open", "other"];
STATUS = {}; STATUS_ORDER.forEach(k => STATUS[k] = { label: k, color: "#000" });
SUBMIT_KEYS = ["submitted", "approved", "final"];
FINAL_KEYS = ["final"];
META = { name: "T", generated: "" };
LABEL = {};
MULTI_KEYS = ["data4", "data10"];
BACKEND = false; AI_ON = false;
COLUMNS = [
  { key: "prov", label: "Prov" }, { key: "kab", label: "Kab" },
  { key: "data4", label: "Kategori Sampel" }, { key: "data10", label: "Data 10" },
];
DATA = [
  { kab: "Kab X", status: "SUBMITTED BY Pencacah", data4: "1. Utama",   data10: "1. Berhasil diwawancarai" },
  { kab: "Kab X", status: "OPEN",                  data4: "1. Utama",   data10: "1. Berhasil diwawancarai" },
  { kab: "Kab X", status: "SUBMITTED BY Pencacah", data4: "2. Cadangan", data10: "1. Berhasil diwawancarai" },
  { kab: "Kab Y", status: "APPROVED BY Pengawas",  data4: "1. Utama",   data10: "" },
  { kab: "Kab Y", status: "REJECTED BY Pengawas",  data4: "1. Utama",   data10: "1. Berhasil diwawancarai" },
];
filtered = DATA; state = { q: "", page: 0, pageSize: 100, sort: { key: null, dir: 1 }, filters: {}, graphKey: null };
renderProgress();
let pg = els.progressgrid.innerHTML;
if (!pg.includes('title="Kab X: 3/2"') || !pg.includes("4 hasil dari target 4 sampel utama")) throw new Error("utama-target/cadangan-hasil logic wrong:\n" + String(pg).slice(0, 400));
if (!pg.includes('title="Kab Y: 1/2"')) throw new Error("Kab Y should be 1/2 (empty hasil is not hasil; open/rejected statuses still count)");
if (!pg.includes("4/4")) throw new Error("prov row should be done/target progress (4/4):\n" + String(pg).slice(0, 400));
if (!pg.includes("<span>progress</span>")) throw new Error("donut hole should show progress, not submit+");
if (pg.includes("Komposisi Status")) throw new Error("status-composition donut title should be gone");
/* Tabel tab div[3]: semua hasil pendataan tampil, tapi Progress tetap pakai
   utama+cadangan berhasil diwawancarai / target utama. */
DATA[4].data10 = "3. Tidak berhasil";
DATA.push({ kab: "Kab Y", status: "OPEN", data4: "1. Utama", data10: "4. Lain-lain" });
filtered = DATA;
renderPTable();
const pt = els.ptable.innerHTML;
const ix = pt.indexOf("semua hasil pendataan ditampilkan");
if (ix < 0) throw new Error("enum table caption missing");
const en = pt.slice(ix);
if (!en.includes("<th>Target</th>") || !en.includes("<th>Progress</th>")) throw new Error("div[3] should show Target and Progress columns");
if (en.includes("(kosong)")) throw new Error("empty hasil must not appear as hasil column");
for (const v of ["1. Berhasil diwawancarai", "3. Tidak berhasil", "4. Lain-lain"])
  if (!en.includes("<th>" + v + "</th>")) throw new Error("all hasil values must appear, missing: " + v);
if (!en.includes("<td>2</td>")) throw new Error("Kab X target should be 2 utama rows, got:\n" + en.slice(0, 300));
if (!en.includes("<td>3</td>")) throw new Error("Kab Y target should be 3 utama rows, got:\n" + en.slice(0, 300));
if (!en.includes("<td>150.0%</td>")) throw new Error("enum progress must stay berhasil/target: Kab X 150.0%");
if (!en.includes("<td>0.0%</td>")) throw new Error("non-berhasil hasil must not count as progress: Kab Y 0.0%");
/* div[2] Progress table: Target = utama, Progress = done/target */
const t1ix = pt.indexOf("<th>Target</th>");
if (t1ix < 0 || t1ix > ix) throw new Error("div[2] should show Target column before the div[3] note");
const t1 = pt.slice(t1ix, ix);
if (!t1.includes("<th>Progress</th>")) throw new Error("div[2] should show Progress column, not %Submit+");
if (!t1.includes("<td>150.0%</td>")) throw new Error("Kab X progress should be 150.0% (3/2, cadangan adds to hasil):\n" + t1.slice(0, 400));
/* Degraded: no Kategori Sampel column -> target = all rows (X = 3/3) */
COLUMNS = COLUMNS.filter(c => c.key !== "data4");
renderProgress();
pg = els.progressgrid.innerHTML;
if (!pg.includes("3/3")) throw new Error("degraded target should count all rows:\n" + String(pg).slice(0, 400));
/* One name, two kab_code (JAYAPURA = 9403 + 9471 in FASIH): must stay two
   rows keyed by kab_code, each labeled with the name from the data. */
DATA.push({ kab: "JAYAPURA", kab_code: "9403", status: "SUBMITTED BY Pencacah", data4: "1. Utama", data10: "1. Berhasil diwawancarai" });
DATA.push({ kab: "JAYAPURA", kab_code: "9471", status: "OPEN", data4: "1. Utama", data10: "1. Berhasil diwawancarai" });
filtered = DATA;
renderProgress();
pg = els.progressgrid.innerHTML;
/* progRow titles are "NAME: done/total"; enumRow titles are "NAME: n=..." - only count the former. */
const jrow = (pg.match(/title="JAYAPURA: \d/g) || []).length;
if (jrow !== 2) throw new Error("progress must group by kab_code, not name: " + jrow + " JAYAPURA rows:\n" + String(pg).slice(0, 400));
renderPTable();
const pth = els.ptable.innerHTML;
const t1a = pth.indexOf("<th>Target</th>"), t1b = pth.indexOf("semua hasil pendataan ditampilkan");
const jtab = ((pth.slice(t1a, t1b).match(/>JAYAPURA</g)) || []).length;
if (jtab !== 2) throw new Error("PTable must show 2 rows labeled by name, got " + jtab);

/* Ordering: code order wins over name order (ZZZ=9403 must precede AAA=9471)
   in filter options, progress bars, enum bars, and both progress tables. */
COLUMNS = [
  { key: "prov", label: "Prov" }, { key: "kab", label: "Kab" },
  { key: "data4", label: "Kategori Sampel" }, { key: "data10", label: "Hasil Pendataan" },
];
FILTER_KEYS = ["prov", "kab", "data4", "data10"];
MULTI_KEYS = ["data4", "data10"];
DATA = [
  { prov: "P", kab: "AAA", kab_code: "9471", data4: "1. Utama", data10: "1. Berhasil diwawancarai" },
  { prov: "P", kab: "ZZZ", kab_code: "9403", data4: "1. Utama", data10: "1. Berhasil diwawancarai" },
];
state = { q: "", page: 0, pageSize: 100, sort: { key: null, dir: 1 }, filters: {}, graphKey: "data10" };
filtered = DATA;
const kabOpts = distinctOptions("kab").join(",");
if (kabOpts !== "ZZZ,AAA") throw new Error("kab filter must sort by kab_code: " + kabOpts);

renderProgress();
const bars = els.progressgrid.innerHTML;
const barA = bars.indexOf('title="AAA: '), barZ = bars.indexOf('title="ZZZ: ');
if (barA < 0 || barZ < 0 || barZ > barA) throw new Error("progress bars must follow kab_code order:\n" + bars.slice(0, 500));
const enumA = bars.indexOf('title="AAA: n='), enumZ = bars.indexOf('title="ZZZ: n=');
if (enumA < 0 || enumZ < 0 || enumZ > enumA) throw new Error("enum bars must follow kab_code order:\n" + bars.slice(0, 500));
if (!bars.includes("Urut berdasarkan kode kabupaten/kota")) throw new Error("progress caption must state kab_code order");

renderPTable();
const pt2 = els.ptable.innerHTML;
const rowPos = name => [...pt2.matchAll(new RegExp(">" + name + "</td>", "g"))].map(m => m.index);
const posA = rowPos("AAA"), posZ = rowPos("ZZZ");
if (posA.length !== 2 || posZ.length !== 2 || posZ[0] > posA[0] || posZ[1] > posA[1])
  throw new Error("both progress tables must follow kab_code order:\n" + JSON.stringify({ posA, posZ }));
if (!pt2.includes("urut kode kabupaten/kota")) throw new Error("table caption must state kab_code order");
console.log("kab_progress OK");
process.exit(0);
