#!/usr/bin/env python3
"""Build a seed batch's import CSV + review CSV from screened venue records (Greater San Diego Batches 2-4 workflow).

Usage (run with python3 -I; inputs are JSON files produced by screening + QA):
  python3 -I operator-admin/scripts/seeding/buildSeedBatch.py \
      --env operator-admin/.env.local \
      --market greater-san-diego --region CA --country US \
      --roster operator-admin/src/lib/geo/rosters/greaterSanDiego.ts \
      --existing <work>/existing.json --used-photos <work>/used_photos.txt \
      --out <dir> --batch <name, e.g. gsd-batch5> \
      <work>/worker-A.json <work>/worker-B.json ... [<work>/qa-*.json ...]

Inputs (later files win for the same venue name):
  worker-*.json  full venue records (schema in docs/operations/MARKET_SEEDING_SCREENING_BRIEF.md); status QUALIFIES/HOLD
  qa-*.json      field-level patches merged onto an already-loaded venue (never a new venue); "qa_check" accumulates.
                 Reviewed overrides a patch may set: photo_override (+photo_override_reason), place_id_override
                 (+place_id_override_reason), places_query_name, shared_address_with, shared_address_evidence.
  existing.json / used_photos.txt  from scripts/seeding/exportSeedState.ts (read-only DB export).

Outputs: <out>/<batch>.csv (importer columns, qualifying rows only) and <out>/<batch>-review.csv (every venue).
Network: Google Places API (New) text search / place details (read) and the US Census Geocoder (read). No database.
"""
import argparse, collections, csv, json, os, re, sys, unicodedata, urllib.parse, urllib.request
from datetime import datetime, timezone

ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument("--env", required=True, help="env file holding GOOGLE_PLACES_API_KEY or GOOGLE_MAPS_API_KEY")
ap.add_argument("--market", required=True, help="market slug written to every row")
ap.add_argument("--region", required=True, help="region/province code written to every row, e.g. CA")
ap.add_argument("--country", required=True, help="country code written to every row, e.g. US")
ap.add_argument("--roster", required=True, help="roster .ts file: cities ({ slug, name }) + *_CITY_ALIASES")
ap.add_argument("--existing", required=True)
ap.add_argument("--used-photos", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--batch", required=True, help="output basename, e.g. gsd-batch5")
ap.add_argument("--today", default=datetime.now().strftime("%Y-%m-%d"), help="verified_on date for the review CSV")
ap.add_argument("--public-dir", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "public"))
ap.add_argument("--bias", default=None, help="optional Places location bias 'lat,lng,radius_m'")
ap.add_argument("--last-resort", action="append", default=None,
                help="photo path tried last in its category (repeatable; default: the library's known weaker shots)")
ap.add_argument("--exclude-photo", action="append", default=None,
                help="photo path never auto-assigned (repeatable; default: library photos with brand signage)")
ap.add_argument("inputs", nargs="+")
A = ap.parse_args()

DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
PUBLIC = os.path.abspath(A.public_dir) + "/"

KEY = None
for line in open(A.env):
    m = re.match(r'\s*(GOOGLE_PLACES_API_KEY|GOOGLE_MAPS_API_KEY)\s*=\s*"?([^"\n]+)"?', line)
    if m and not KEY:
        KEY = m.group(2).strip()
if not KEY:
    sys.exit("no GOOGLE_PLACES_API_KEY / GOOGLE_MAPS_API_KEY in the env file")

# ── Roster: canonical cities + aliases (lowercase city text → (name, slug)) ──────────────────────
ts = open(A.roster).read()
ROSTER = {}
for slug, name in re.findall(r'\{\s*slug:\s*"([^"]+)",\s*name:\s*"([^"]+)"', ts):
    ROSTER[name.lower()] = (name, slug)
names_by_slug = {s: n for n, s in ROSTER.values()}
m = re.search(r"export const [A-Z_]+_CITY_ALIASES[^{]*\{(.*?)\};", ts, re.S)
for alias, slug in (re.findall(r'"([^"]+)":\s*"([^"]+)"', m.group(1)) if m else []):
    if alias.lower() not in ROSTER and slug in names_by_slug:
        ROSTER[alias.lower()] = (names_by_slug[slug], slug)
if not ROSTER:
    sys.exit(f"no cities found in roster {A.roster}")

PHOTO_CAT = {"Bar": "bar", "Pub": "pub", "Brewery": "brewery", "Taproom": "taproom", "Winery": "winery", "Cocktail Bar": "cocktail-bar",
             "Lounge": "cocktail-bar", "Wine Bar": "wine-bar", "Sports Bar": "sports-bar", "Fine Dining": "fine-dining",
             "Restaurant and Bar": "casual-dining", "Casual Dining": "casual-dining", "Family Dining": "casual-dining",
             "Fast Casual": "casual-dining", "Bistro": "casual-dining", "Cafe": "casual-dining", "Other": "bar"}


def http_json(req):
    return json.load(urllib.request.urlopen(req, timeout=30))


def place_result(p, comps):
    return {"place_id": p["id"], "g_name": p["displayName"]["text"], "g_address": p["formattedAddress"],
            "locality": comps.get("locality", {}).get("longText") or comps.get("neighborhood", {}).get("longText"),
            "status": p.get("businessStatus"), "rating": p.get("rating"), "count": p.get("userRatingCount"),
            "retrieved_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}


def places_lookup(name, address, city, zip_):
    body = {"textQuery": f"{name}, {address}, {city}, {A.region} {zip_}", "maxResultCount": 3}
    if A.bias:
        lat, lng, rad = (float(x) for x in A.bias.split(","))
        body["locationBias"] = {"circle": {"center": {"latitude": lat, "longitude": lng}, "radius": rad}}
    req = urllib.request.Request("https://places.googleapis.com/v1/places:searchText", data=json.dumps(body).encode(), method="POST", headers={
        "Content-Type": "application/json", "X-Goog-Api-Key": KEY,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.addressComponents,places.businessStatus,places.rating,places.userRatingCount"})
    j = http_json(req)
    num = (re.match(r"\s*(\d+)", address or "") or [None, None])[1]
    for p in j.get("places", []):
        comps = {t: c for c in p.get("addressComponents", []) for t in c["types"]}
        pnum = (re.match(r"\s*(\d+)", comps.get("street_number", {}).get("longText") or "") or [None, None])[1]  # "880 B" -> "880"
        pzip = comps.get("postal_code", {}).get("longText")
        a = set(re.findall(r"[a-z0-9]+", name.lower())) - {"the", "and", "bar", "grill", "co", "restaurant"}
        b = set(re.findall(r"[a-z0-9]+", p["displayName"]["text"].lower()))
        if pnum == num and pzip == zip_ and (bool(a & b) or not a):
            return place_result(p, comps)
    return {"error": "no Places result matching street number + ZIP + name",
            "candidates": [(p["displayName"]["text"], p["formattedAddress"]) for p in j.get("places", [])]}


def get_place(pid, reason):
    """Reviewed override: fetch the named Place directly (same venue, different listed address)."""
    req = urllib.request.Request(f"https://places.googleapis.com/v1/places/{pid}", headers={
        "X-Goog-Api-Key": KEY, "X-Goog-FieldMask": "id,displayName,formattedAddress,addressComponents,businessStatus,rating,userRatingCount"})
    p = http_json(req)
    r = place_result(p, {t: c for c in p.get("addressComponents", []) for t in c["types"]})
    r["g_address"] += f" [reviewed override: {reason}]"
    return r


def census(address, city, zip_):
    stripped = re.sub(r"[\s,]*(#|ste\.?|suite|unit)\s*\S+.*$", "", address, flags=re.I).rstrip(" ,")
    for a in dict.fromkeys([address, stripped]):
        u = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?" + urllib.parse.urlencode(
            {"address": f"{a}, {city}, {A.region} {zip_}", "benchmark": "Public_AR_Current", "format": "json"})
        hits = http_json(urllib.request.Request(u))["result"]["addressMatches"]
        if hits:
            c = hits[0]["coordinates"]
            return {"lat": round(c["y"], 6), "lng": round(c["x"], 6), "matched": hits[0]["matchedAddress"]}
    return None


# ── Photos ────────────────────────────────────────────────────────────────────────────────────
used = set(open(A.used_photos).read().split())
existing = json.load(open(A.existing))
market_photos = set(existing.get("market_photos", existing.get("gsd_photos", [])))
market_zips = collections.defaultdict(list, {k: list(v) for k, v in existing.get("market_photo_zips", existing.get("gsd_photo_zips", {})).items()})
# Library-wide facts (not market-specific): weaker shots at listing-card size, and photos with brand signage.
LAST_RESORT = set(A.last_resort or ["images/venues/casual-dining/venue-pic-casual-dining-27.jpg",
                                    "images/venues/casual-dining/venue-pic-casual-dining-31.jpg", "images/venues/bar/venue-pic-bar-14.jpg"])
EXCLUDED_PHOTOS = set(A.exclude_photo or ["images/venues/pub/venue-pic-pub-2.jpg"])


def num_key(p):
    return (p in LAST_RESORT, int(re.search(r"-(\d+)\.jpg$", p).group(1)))


inventory = {cat: sorted((f"images/venues/{cat}/{f}" for f in os.listdir(PUBLIC + f"images/venues/{cat}")
                          if f.endswith(".jpg") and f"images/venues/{cat}/{f}" not in EXCLUDED_PHOTOS), key=num_key)
             for cat in os.listdir(PUBLIC + "images/venues")}
assigned = set()
FALLBACK = {"casual-dining": ["casual-dining", "bar", "cocktail-bar"]}
REPEAT = {"casual-dining": ["casual-dining", "bar"]}


def pick_photo(cat, zip_):
    """Automatic pick (prefer reviewed photo_override chosen by fit): unused anywhere → unused in this market →
    least-used repeat within the market, never in the same ZIP."""
    cats = FALLBACK.get(cat, [cat])

    def take(p, note):
        assigned.add(p); market_zips[p].append(zip_)
        return p, note + (" (last-resort shot)" if p in LAST_RESORT else "")
    for c in cats:
        for p in inventory.get(c, []):
            if p not in used and p not in assigned:
                return take(p, "unused" + ("" if c == cat else f" (fallback category {c})"))
    for c in cats:
        for p in inventory.get(c, []):
            if p not in market_photos and p not in assigned:
                return take(p, "reused from another market" + ("" if c == cat else f" (fallback category {c})"))
    cands = [p for c in REPEAT.get(cat, [cat]) for p in inventory.get(c, []) if zip_ not in market_zips[p]]
    if not cands:
        return None, "category exhausted"
    p = min(cands, key=lambda x: (x in LAST_RESORT, len(market_zips[x])))
    return take(p, f"repeat within the market (least-used; also used in ZIP {', '.join(sorted(set(market_zips[p])))})")


# ── Formatting ────────────────────────────────────────────────────────────────────────────────
def slugify(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower().replace("'", "").replace("’", "")
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", s)).strip("-")


def t12(hm):
    h, mnt = map(int, hm.split(":"))
    ap_ = "AM" if h < 12 or h == 24 else "PM"
    h12 = h % 12 or 12
    return f"{h12}:{mnt:02d} {ap_}" if mnt else f"{h12} {ap_}"


def hh_text(windows):
    groups = collections.OrderedDict()
    for w in windows:
        groups.setdefault((w["start"], w["end"]), set()).update(d.lower() for d in w["days"])
    lines = []
    for (s, e), ds in groups.items():
        idx = sorted(DAYS.index(d) for d in ds)
        if len(idx) == 7:
            lines.append(f"Daily: {t12(s)} – {t12(e)}"); continue
        runs, run = [], [idx[0]]
        for i in idx[1:]:
            if i == run[-1] + 1: run.append(i)
            else: runs.append(run); run = [i]
        runs.append(run)
        for r in runs:
            d = DAYS[r[0]].title() if len(r) == 1 else f"{DAYS[r[0]].title()} – {DAYS[r[-1]].title()}"
            lines.append(f"{d}: {t12(s)} – {t12(e)}")
    return "\n".join(lines)


def specials(items):
    out = []
    for x in (items or [])[:3]:
        o = {"name": x["name"]}
        if str(x.get("price") or "").strip(): o["price"] = str(x["price"]).strip()
        if str(x.get("notes") or "").strip(): o["notes"] = str(x["notes"]).strip()
        out.append(o)
    return json.dumps(out, ensure_ascii=False) if out else ""


# ── Load workers + QA patches ─────────────────────────────────────────────────────────────────
latest = collections.OrderedDict()
for wf in A.inputs:
    base = os.path.basename(wf)
    if base.startswith("qa-"):
        for p in json.load(open(wf)):
            if p["name"] not in latest:
                sys.exit(f"QA patch for unknown venue: {p['name']}")
            wname, v = latest[p["name"]]
            merged = {**v, **{k: val for k, val in p.items() if k != "qa_check"}}
            merged["qa_check"] = " || ".join(x for x in (v.get("qa_check"), p.get("qa_check")) if x)
            latest[p["name"]] = (wname, merged)
        continue
    wm = re.search(r"worker-([A-Za-z0-9]+)", base)
    wname = wm.group(1) if wm else os.path.splitext(base)[0]
    for v in json.load(open(wf)):
        latest[v["name"]] = (wname, v)

COLS = ["slug", "name", "establishment_type", "address_line1", "city", "region", "postal_code", "country", "market_slug", "city_slug",
        "lat", "lng", "phone", "website_url", "menu_url", "business_hours", "hh_times", "hh_tagline", "hh_food_details", "hh_drink_details",
        "hh_times_needs_review", "place_id", "placeholder_image_path", "source", "is_published", "google_rating", "google_review_count",
        "business_hours_verified", "business_hours_source", "coordinates_source", "google_rating_retrieved_at",
        "shared_address_with", "shared_address_evidence"]
RCOLS = ["name", "worker", "batch_status", "hold_code", "hold_reason", "roster_city", "area", "address", "place_id", "google_match",
         "rating", "pin_source", "photo", "photo_note", "establishment_type", "self_description", "business_hours_quote",
         "business_hours_urls", "hh_quote", "hh_urls", "offers_urls", "restrictions", "date_evidence", "discovery_source", "notes", "qa_check", "verified_on"]
ex_pids, ex_slugs = set(existing["place_ids"]), set(existing["slugs"])
rows, review, seen_pids, seen_slugs = [], [], set(), set()

for wname, v in latest.values():
    rv = {k: "" for k in RCOLS}
    rv.update(name=v.get("name"), worker=wname, area=v.get("area") or "", restrictions=v.get("restrictions") or "",
              date_evidence=v.get("date_evidence") or "", discovery_source=v.get("discovery_source") or "", notes=v.get("notes") or "",
              qa_check=v.get("qa_check") or "", business_hours_quote=v.get("business_hours_quote") or "",
              business_hours_urls=" ; ".join(v.get("business_hours_urls") or []), hh_quote=v.get("hh_quote") or "",
              hh_urls=" ; ".join(v.get("hh_urls") or []), offers_urls=" ; ".join(v.get("offers_urls") or []),
              establishment_type=v.get("establishment_type") or "", self_description=v.get("self_description_quote") or "",
              address=f"{v.get('address_line1') or ''}, {v.get('city_on_site') or ''} {v.get('postal_code') or ''}", verified_on=A.today)

    def hold(code, reason):
        rv.update(batch_status="HOLD", hold_code=code, hold_reason=reason); review.append(rv)

    if v.get("status") != "QUALIFIES":
        hold(v.get("hold_code") or "unspecified", v.get("hold_detail") or ""); continue
    bh = v.get("business_hours") or {}
    if set(bh) != set(DAYS):
        hold("hours_incomplete", "business_hours missing days in worker output"); continue
    if not v.get("hh_windows"):
        hold("not_found", "no hh_windows in worker output"); continue
    try:
        if v.get("place_id_override"):
            g = get_place(v["place_id_override"], v.get("place_id_override_reason") or "")
        else:
            g = places_lookup(v.get("places_query_name") or v["name"].split(" – ")[0], v["address_line1"], v["city_on_site"], v["postal_code"])
    except Exception as e:  # noqa
        hold("places_error", str(e)[:200]); continue
    if "error" in g:
        hold("place_not_verified", f"{g['error']}: {g['candidates']}"); continue
    rv.update(place_id=g["place_id"], google_match=f"{g['g_name']} — {g['g_address']} ({g['status']})")
    if g["status"] != "OPERATIONAL":
        hold("not_operational", f"Google business status {g['status']}"); continue
    if g["place_id"] in ex_pids or g["place_id"] in seen_pids:
        hold("existing_place", "Place ID already used by an HHC venue or earlier in this batch"); continue
    loc = (g.get("locality") or "").lower()
    if loc not in ROSTER:
        hold("not_in_roster", f"Google locality '{g.get('locality')}' is not a roster city/alias"); continue
    city_name, city_slug = ROSTER[loc]
    rv.update(roster_city=city_name, rating=f"{g['rating']} ({g['count']})")
    if g["rating"] is None or g["count"] is None:
        hold("no_rating", "Google returned no rating/review count"); continue
    try:
        pin = census(v["address_line1"], v["city_on_site"], v["postal_code"])
    except Exception as e:  # noqa
        hold("census_error", str(e)[:200]); continue
    if not pin:
        hold("no_pin", "US Census Geocoder found no address match (Google coordinates are not stored)"); continue
    rv.update(pin_source=f"US Census Geocoder: {pin['matched']}")
    etype = v.get("establishment_type") or "Restaurant and Bar"
    if v.get("photo_override"):
        po = v["photo_override"]
        if not os.path.isfile(PUBLIC + po) or po in EXCLUDED_PHOTOS or po in assigned:
            hold("bad_photo_override", f"photo_override {po} missing, excluded or already assigned"); continue
        assigned.add(po); market_zips[po].append(v.get("postal_code"))
        where = "unused" if po not in used else ("reused from another market" if po not in market_photos else "REPEAT within the market")
        photo, pnote = po, f"reviewed choice ({where}): {v.get('photo_override_reason', '')}"
    else:
        photo, pnote = pick_photo(PHOTO_CAT.get(etype, "bar"), v.get("postal_code"))
    if not photo:
        hold("no_photo", f"no stock photo available for {etype}"); continue
    rv.update(photo=photo, photo_note=pnote)
    body = re.sub(rf"(^|-){re.escape(city_slug)}(-|$)", "-", slugify(v["name"])).strip("-")
    slug = f"{city_slug}-{body}"
    if slug in ex_slugs or slug in seen_slugs:
        hold("existing_slug", f"slug {slug} already exists"); continue
    seen_pids.add(g["place_id"]); seen_slugs.add(slug)
    restr = (v.get("restrictions") or "").strip().rstrip(".")
    rows.append({
        "slug": slug, "name": v["name"], "establishment_type": etype, "address_line1": v["address_line1"], "city": city_name,
        "region": A.region, "postal_code": v["postal_code"], "country": A.country, "market_slug": A.market, "city_slug": city_slug,
        "lat": pin["lat"], "lng": pin["lng"], "phone": v.get("phone") or "", "website_url": v.get("website_url") or "",
        "menu_url": v.get("menu_url") or ((v.get("offers_urls") or [""])[0]),
        "business_hours": json.dumps({d: (None if bh[d] in ("closed", None) else {"open": bh[d]["open"], "close": bh[d]["close"]}) for d in DAYS}),
        "hh_times": hh_text(v["hh_windows"]),
        "hh_tagline": f"Happy hour: {restr[0].lower() + restr[1:]}." if restr else "",
        "hh_food_details": specials(v.get("food")), "hh_drink_details": specials(v.get("drink")),
        "hh_times_needs_review": "false", "place_id": g["place_id"], "placeholder_image_path": photo, "source": "seed", "is_published": "false",
        "google_rating": g["rating"], "google_review_count": g["count"], "business_hours_verified": "true",
        "business_hours_source": (v.get("business_hours_urls") or [""])[0],
        "coordinates_source": f"US Census Geocoder (Public_AR_Current) address-range match: {pin['matched']}",
        "google_rating_retrieved_at": g["retrieved_at"],
        "shared_address_with": v.get("shared_address_with") or "", "shared_address_evidence": v.get("shared_address_evidence") or ""})
    rv.update(batch_status="IN BATCH"); review.append(rv)

os.makedirs(A.out, exist_ok=True)
with open(f"{A.out}/{A.batch}.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=COLS, lineterminator="\n"); w.writeheader(); w.writerows(rows)
with open(f"{A.out}/{A.batch}-review.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=RCOLS, lineterminator="\n"); w.writeheader(); w.writerows(review)
print(json.dumps({"in_batch": len(rows), "held": len(review) - len(rows), "import_csv": f"{A.out}/{A.batch}.csv"}))
for r in review:
    print(f"  {r['batch_status']:8} {r['worker']:4} {r['name'][:40]:40} {r['roster_city']:14} {r['hold_code']}")
