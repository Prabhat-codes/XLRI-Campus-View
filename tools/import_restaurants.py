"""Turn the restaurant research file into site/data/restaurants.json.

Keeps only venues with pin_enabled=true. recommended_dishes become picks, not_recommended
becomes 'skip', unresolved_dishes are dropped. Coordinates are used exactly as given.
Run:  python tools/import_restaurants.py raw/restaurants_source.json
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHORT = {  # tidier display names; the full listing name stays searchable
    "Little Italy Restaurant, Jamshedpur": "Little Italy",
    "LION'S PRIDE RESTRO": "Lion's Pride",
    "MASHQvankanpaleam": "Mashq",
    "Chai Break Cafe & Bar - Jamshedpur": "Chai Break",
    "Moti Mahal, Bistupur": "Moti Mahal",
    "Tonik - Brewery & Kitchen": "Tonik Brewery & Kitchen",
    "Aami Bangali Restaurant Jamshedpur": "Aami Bangali",
    "Pumpkkin A Vegetarian Restaurant": "Pumpkkin",
    "The Sukh Sagar Veg Restaurant": "Sukh Sagar",
    "Hana (Asian Eating House)": "Hana",
}
EXTRA_ALIASES = {
    "Brown Town Roastery Café": ["brown town", "browntown"],
    "Mocha Cafe & Bar": ["mocha"],
    "Guild 45": ["guild"],
    "Mint Kitchen": ["mint"],
    "Lion's Pride": ["lions pride", "lion pride"],
    "Pind Balluchi": ["pind"],
    "The Madrasi Hotel": ["madrasi", "madrasi hotel"],
    "The Chocolate Room": ["chocolate room"],
    "Aaoka Café": ["aaoka"],
    "Aurous Restro Lounge": ["aurous"],
    "Novelty Restaurant": ["novelty"],
    "Tonik Brewery & Kitchen": ["tonik"],
}
# cuisine words worked out from the dish names, so "italian" or "dessert" finds the right places
CUISINE = [
    (r"pasta|spaghetti|lasagna|pizza|ravioli|bruschetta|risotto", ["italian", "pasta"]),
    (r"momo|thukpa|manchurian|noodle|dumpling|gyoza|manchow|hot and sour|chilli garlic|dimsum|khao suey", ["chinese", "asian"]),
    (r"dosa|idli|vada|uttapam", ["south indian"]),
    (r"naan|dal makhani|butter chicken|paneer butter|paneer tikka|kulch|biryani|tikka|kebab|chaap|rogan josh|nihari|tandoor|chole|bhature|rara", ["north indian", "indian"]),
    (r"cocktail|\bbeer\b|\bgin\b|mojito|margherita", ["bar", "drinks", "cocktails"]),
    (r"cheesecake|tiramisu|pastry|lava|tres leches|panna cotta|affogato|custard|pudding|phirni|shahi tukda|khunafah|cookie|hot chocolate", ["dessert", "desserts", "sweet"]),
    (r"coffee|\blatte\b|affogato|hot chocolate", ["coffee", "cafe"]),
    (r"prawn|fish|seafood", ["seafood"]),
    (r"chicken|mutton|pork|lamb|prawn|fish|meat|nihari|rogan josh", ["non veg", "non-veg"]),
    (r"burger", ["burger", "burgers"]),
    (r"shish|taouk|tawook|lebanese|hummus|falafel|shawarma|shakshouka", ["middle eastern", "lebanese"]),
    (r"sushi|tempura", ["sushi", "japanese"]),
    (r"avocado|toast|bowl|salad", ["brunch", "healthy"]),
]


def area_of(address):
    for a in ("Bistupur", "Sonari", "Sakchi", "Kadma", "Circuit House", "Asan Bani"):
        if a.lower() in address.lower():
            return a
    return "Jamshedpur"


def main(src):
    data = json.load(open(src, encoding="utf8"))
    out = []
    for v in data["venues"]:
        if not v.get("pin_enabled"):
            continue
        name = v.get("display_name") or SHORT.get(v["name"], v["name"])
        # recommended = backed by a Jamshedpur cue in the chat; tentative = possible, unconfirmed (v13 split)
        dishes = [{"d": d["dish"], "c": d.get("confidence", "medium"), **({"mixed": True} if d.get("mixed_opinion") else {})}
                  for d in v.get("recommended_dishes", [])]
        dishes.sort(key=lambda d: (d["c"] != "high", bool(d.get("mixed"))))
        maybe = [{"d": d["dish"], "c": d.get("confidence", "medium"), "t": True, **({"mixed": True} if d.get("mixed_opinion") else {})}
                 for d in v.get("tentative_dishes", [])]
        maybe.sort(key=lambda d: (d["c"] != "high", bool(d.get("mixed"))))
        text = " ".join(d["d"] for d in dishes + maybe).lower()                      # cuisine comes from dishes only
        notes = " ".join(v.get("chat_notes", [])).lower() + " " + (v.get("pin_note") or "").lower()
        tags = set(["restaurant", "restaurants", "eat out", "jamshedpur", "town", area_of(v["address"]).lower()])
        for pat, words in CUISINE:
            if re.search(pat, text):
                tags.update(words)
        if "south indian" in notes: tags.update(["south indian", "breakfast"])
        if "vrat" in notes: tags.update(["vrat", "no onion no garlic"])
        if "bar for beer" in notes: tags.update(["bar", "beer"])
        if "budget" in notes: tags.add("budget")
        if re.search(r"\bbar\b|lounge|brewery", v["name"].lower()): tags.update(["bar", "drinks"])
        if "brewery" in v["name"].lower(): tags.add("beer")
        if "vegetarian" in v["name"].lower(): tags.add("pure veg")
        maps = v.get("google_maps_url") or f"https://www.google.com/maps/search/?api=1&query={v['lat']},{v['lng']}"
        aliases = sorted(set([v["name"].lower(), (v.get("chat_name") or "").split("/")[0].strip().lower()] + EXTRA_ALIASES.get(name, [])) - {"", name.lower()})
        out.append({
            "name": name, "fullName": v["name"], "aliases": aliases, "area": area_of(v["address"]),
            "address": v["address"].replace(", Jamshedpur, Jharkhand", "").replace(", India", ""),
            "lat": v["lat"], "lng": v["lng"], "rating": v.get("google_rating"), "reviews": v.get("google_review_count"),
            "mapsUrl": maps, "dishes": dishes + maybe, "confirmed": len(dishes),
            "closed": {"no_closed_banner_seen": ""}.get(v.get("closure_status", ""), "Temporarily closed, per Google Maps" if "temporarily" in v.get("closure_status", "") else "Open status unknown"),
            "skip": [{"d": d["dish"], "why": d.get("reason", "")} if isinstance(d, dict) else {"d": d, "why": ""} for d in v.get("not_recommended", [])],
            "notes": [],
            "tags": sorted(tags),
        })
    doc = {"_note": "Restaurants around Jamshedpur. Picks come from a student group chat (first pass, " + data.get("verified_at", "") +
                    "); names, addresses, coordinates and ratings from Google Maps. Opening hours were not checked. Regenerate with tools/import_restaurants.py.",
           "restaurants": out}
    p = os.path.join(ROOT, "site", "data", "restaurants.json")
    json.dump(doc, open(p, "w", encoding="utf8"), ensure_ascii=False, indent=1)
    print(len(out), "restaurants ->", p)
    for r in out:
        print(f"  {r['name']:<28} {r['area']:<10} {len(r['dishes']):>2} picks  {', '.join(t for t in r['tags'] if t not in ('restaurant','eat out','jamshedpur','town','food'))[:90]}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "raw", "restaurants_source.json"))
