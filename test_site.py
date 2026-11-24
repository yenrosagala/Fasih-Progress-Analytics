"""Self-check for build_site.py output. Run: python test_site.py

Fails if: a data payload isn't strict JSON (the NaN bug), the manifest and
data/ files disagree, or status bucketing stops matching the raw aliases.
"""
import json
import os
import re

import build_site

SITE = build_site.SITE_DIR


def strict_json(path):
    with open(path, encoding="utf-8") as f:
        return json.loads(f.read())  # json.loads rejects NaN/Infinity


def canon(v, status_map):
    s = str(v if v is not None else "").strip().upper()
    if not s:
        return "other"
    for d in status_map:
        if any(a in s for a in d["aliases"]):
            return d["key"]
    return "other"


def counts(rows, status_map):
    o = {}
    for r in rows:
        k = canon(r.get("status"), status_map)
        o[k] = o.get(k, 0) + 1
    return o


def check_js():
    """Parse the inline scripts with node when available.

    A JS syntax error (e.g. a duplicate `const`) silently kills every handler,
    so the page renders but never fetches anything. Node is optional: without
    it this check is skipped.
    """
    import re
    import shutil
    import subprocess
    import tempfile

    node = shutil.which("node")
    if not node:
        print("  js: node not found, skipped")
        return
    with open(os.path.join(SITE, "index.html"), encoding="utf-8") as f:
        blocks = re.findall(r"<script>(.*?)</script>", f.read(), re.S)
    assert blocks, "no inline script in index.html"
    for i, js in enumerate(blocks):
        fd, path = tempfile.mkstemp(suffix=".js")
        os.close(fd)
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write(js)
            r = subprocess.run([node, "--check", path], capture_output=True, text=True)
            assert r.returncode == 0, f"inline script {i} syntax error:\n{r.stderr}"
        finally:
            os.remove(path)
    print(f"  js: {len(blocks)} inline script(s) parse")


def check_ids():
    """Every getElementById("x") in the inline JS must have id="x" in the HTML.

    Catches the class of bug node --check cannot: the script parses but dies at
    runtime because an element was renamed or never emitted.
    """
    import re
    with open(os.path.join(SITE, "index.html"), encoding="utf-8") as f:
        html = f.read()
    defined = set(re.findall(r'id="([^"]+)"', html))
    refs = set(re.findall(r'getElementById\("([^"]+)"\)', html))
    missing = sorted(refs - defined)
    assert not missing, f"getElementById refs with no element: {missing}"
    print(f"  dom: {len(refs)} id refs resolve")


def main():
    build_site.build_site()

    manifest = strict_json(os.path.join(SITE, "surveys.json"))
    assert manifest["surveys"], "manifest empty"
    for s in manifest["surveys"]:
        path = os.path.join(SITE, "data", f'{s["id"]}.json')
        assert os.path.exists(path), f"missing payload {path}"
        payload = strict_json(path)
        assert payload["columns"], f'{s["id"]}: no columns'
        assert len(payload["rows"]) == s["rows"], f'{s["id"]}: row count drift'
        assert payload["statusMap"], f'{s["id"]}: no statusMap'

    # SITASI: target = Status Sampel "1. Utama"; hasil = Utama + Cadangan with
    # Hasil Pendataan "1. Berhasil diwawancarai" (FASIH monitoring ignores
    # assignment status). Status buckets must stay inside the declared statusMap
    # (a fresh scrape carries submitted/approved/final/rejected too).
    sitasi = next(x for x in manifest["surveys"] if not x["demo"])
    p = strict_json(os.path.join(SITE, "data", f'{sitasi["id"]}.json'))
    c = counts(p["rows"], p["statusMap"])
    assert set(c) <= {d["key"] for d in p["statusMap"]}, f"sitasi buckets: {sorted(c)}"
    assert sum(c.values()) == len(p["rows"]), "sitasi bucket sum mismatch"

    labels = {col["key"]: col["label"] for col in p["columns"]}

    def find_col(label_re, value_re):
        k = next((k for k, v in labels.items() if re.search(label_re, v, re.I)), None)
        if k:
            return k
        # ponytail: a refresh can ship a generic "Data N" title; fall back to
        # the value scan build_site.progOf() uses. Upgrade = stable FASIH keys.
        for k in labels:
            if re.fullmatch(r"data\d+", k) and any(
                re.search(value_re, str(r.get(k) or ""), re.I) for r in p["rows"]
            ):
                return k
        return None

    skey = find_col(r"(?:kategori|status)\s*sampel", r"^\s*(?:1\.?\s*)?utama\b")
    hkey = find_col(r"hasil pendataan", r"^1\.?\s*berhasil diwawancarai?")
    assert skey and hkey, f"sitasi progress columns missing: s={skey} h={hkey}"

    kat = lambda r: str(r.get(skey) if r.get(skey) is not None else "")
    is_utama = lambda r: bool(re.match(r"^\s*(?:1\.?\s*)?utama\b", kat(r), re.I))
    is_cadangan = lambda r: bool(re.match(r"^\s*(?:2\.?\s*)?cadangan\b", kat(r), re.I))
    has_value = lambda r: bool(re.match(r"^1\.?\s*berhasil diwawancarai?",
                                        str(r.get(hkey) if r.get(hkey) is not None else ""), re.I))
    is_hasil = lambda r: (is_utama(r) or is_cadangan(r)) and has_value(r)

    target = sum(1 for r in p["rows"] if is_utama(r))
    done = sum(1 for r in p["rows"] if is_hasil(r))
    utama_done = sum(1 for r in p["rows"] if is_utama(r) and is_hasil(r))
    cadangan_done = sum(1 for r in p["rows"] if is_cadangan(r) and has_value(r))
    assert target and done, f"sitasi target/hasil empty: {target}/{done}"
    assert done == utama_done + cadangan_done, "sitasi hasil must include cadangan"
    assert done > utama_done, "sitasi hasil ignores cadangan samples"
    print(f"  sitasi: {c} target={target} hasil={done} (utama={utama_done}, cadangan={cadangan_done})")

    # Demo: spreads across all six buckets, no 'other'.
    demo = next(x for x in manifest["surveys"] if x["demo"])
    d = strict_json(os.path.join(SITE, "data", f'{demo["id"]}.json'))
    dc = counts(d["rows"], d["statusMap"])
    assert "other" not in dc, f"demo leaked to other: {dc.get('other')}"
    assert len(dc) == 6, f"demo buckets: {sorted(dc)}"
    print(f"  demo: {dc}")

    check_js()
    check_ids()

    print("test_site OK")


if __name__ == "__main__":
    main()
