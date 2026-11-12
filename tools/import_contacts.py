"""Turn the XLRI support contacts .vcf into site/data/contacts.json.

Each contact gets a plain role, the map place it belongs to (so it shows on that place's card)
and search tags (so "ambulance", "electrician" or "LC2 IT" find it in the assistant).
Run:  python tools/import_contacts.py raw/contacts.vcf
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# FN -> (display name, role, map place or None, tags)
META = {
    "Ad Empire S K Ishtiyaque": ("S K Ishtiyaque", "Ad Empire, Bistupur (owner)", None, "ad empire printing print flex banner banners posters standee branding bistupur"),
    "XLRI ADSA Office Santosh Andrews": ("Santosh Andrews", "ADSA Office", "Admin Building", "adsa student affairs office admin"),
    "XLRI Ambulance John Murmu": ("John Murmu", "Ambulance", None, "ambulance emergency medical hospital doctor sick injury"),
    "XLRI Audio-Visual Govind": ("Govind", "Audio-visual", None, "audio visual av projector mic microphone sound speaker"),
    "XLRI Bharat Tent Anoop": ("Anoop", "Bharat Tent House (owner)", None, "tent tent house shamiana chairs tables decoration events party setup"),
    "XLRI Bishu Da": ("Bishu Da", "Bishu's Canteen", "Bishu Da", "bishu canteen food paratha delivery"),
    "XLRI Bishuda": ("Bishu Da", "Bishu's Canteen (owner)", "Bishu Da", "bishu canteen food paratha delivery"),
    "XLRI Electrical General": ("Electrical (general)", "Electrical maintenance", None, "electrical electrician electricity power light fan socket"),
    "XLRI Electrical Head Anil": ("Anil", "Electrical head", None, "electrical electrician electricity power light fan socket"),
    "XLRI IC Corporate Lounge Clarence": ("Clarence", "IC Corporate Lounge, corporate programme head", "International Center", "ic international center corporate lounge"),
    "XLRI IC Food Ranjeet": ("Ranjeet", "IC food", "International Center", "ic international center food catering"),
    "XLRI IC Food Vendor Anil": ("Anil", "IC food vendor", "International Center", "ic international center food catering vendor"),
    "XLRI IC Head Mark": ("Mark", "IC head", "International Center", "ic international center head guest rooms"),
    "XLRI IC NH Rare Hospitality Harsh": ("Harsh", "IC / NH hospitality (Rare Hospitality)", "International Center", "ic international center nh new hostel hospitality housekeeping"),
    "XLRI IC Pravin Bhengra": ("Pravin Bhengra", "IC sub-head", "International Center", "ic international center"),
    "XLRI IC Reception": ("IC Reception", "IC reception (landline)", "International Center", "ic international center reception front desk guest rooms booking"),
    "XLRI IC Reception Vishnu": ("Vishnu", "IC reception", "International Center", "ic international center reception front desk guest rooms booking"),
    "XLRI IC Staff Vinay": ("Vinay", "IC staff", "International Center", "ic international center"),
    "XLRI IT (LC1) Helpdesk": ("IT Helpdesk (LC1)", "IT helpdesk, main (landline)", "Learning Center 1", "it helpdesk wifi internet network laptop email lc1 computer"),
    "XLRI IT (LC2) Helpdesk": ("IT Helpdesk (LC2)", "IT helpdesk, LC2 (landline)", "Learning Center 2", "it helpdesk wifi internet network laptop email lc2 computer"),
    "XLRI LC1 CC Prosenjit": ("Prosenjit", "LC1 computer centre", "Learning Center 1", "lc1 cc computer centre printout print it"),
    "XLRI LC1 Head Amit Tigga": ("Amit Tigga", "LC1 head", "Learning Center 1", "lc1 head classroom booking"),
    "XLRI LC1 IT Setup Raju": ("Raju", "LC1 IT setup", "Learning Center 1", "lc1 it setup projector classroom av"),
    "XLRI LC2 CC Goutam": ("Goutam", "LC2 computer centre", "Learning Center 2", "lc2 cc computer centre printout print it"),
    "XLRI LC2 Head Felix": ("Felix", "LC2 head", "Learning Center 2", "lc2 head classroom booking"),
    "XLRI LC2 Helpdesk Mukesh": ("Mukesh", "LC2 helpdesk", "Learning Center 2", "lc2 helpdesk"),
    "XLRI LC2 Staff Praveen": ("Praveen", "LC2 staff", "Learning Center 2", "lc2"),
    "XLRI Maintenance Harry": ("Harry", "Maintenance head", None, "maintenance repair plumber plumbing carpenter room hostel broken"),
    "XLRI OH Main Security": ("OH Main Security", "Old Hostel security (landline)", "Nilima Hostel", "security old hostel oh guard"),
    "XLRI OH&LC2 KFMS Head Gautam": ("Gautam", "KFMS supervisor, Old Hostel & LC2 (housekeeping)", None, "kfms housekeeping cleaning old hostel oh lc2 room"),
    "XLRI OH&LC2 KFMS Prince": ("Prince", "KFMS supervisor, Old Hostel & LC2 (housekeeping)", None, "kfms housekeeping cleaning old hostel oh lc2 room"),
    "XLRI Security Head Boma": ("Boma", "Security head", "Main Gate", "security guard gate emergency head"),
    "XLRI Stores Amit Kujur": ("Amit Kujur", "Central stores head", None, "stores central stores supplies furniture items"),
    "XLRI Tata Audi AC Aftab": ("Aftab", "AC technician, Tata Auditorium", "Tata Auditorium", "ac air conditioner aircon cooling technician auditorium tata audi"),
}


def fmt(raw):
    d = re.sub(r"\D", "", raw)
    if d.startswith("0657") and len(d) == 11: return f"0657 {d[4:7]} {d[7:]}"       # Jamshedpur landline
    if d.startswith("91657") and len(d) == 12: return f"0657 {d[5:8]} {d[8:]}"
    if d.startswith("0") and len(d) == 11: d = d[1:]
    if d.startswith("91") and len(d) == 12: d = d[2:]
    return f"+91 {d[:5]} {d[5:]}" if len(d) == 10 else raw.strip()


def main(src):
    out, missing = [], []
    for card in open(src, encoding="utf8").read().split("BEGIN:VCARD")[1:]:
        fn = re.search(r"^FN:(.*)$", card, re.M).group(1).strip()
        phones = [fmt(m) for m in re.findall(r"^(?:item\d+\.)?TEL[^:]*:(.*)$", card, re.M) if m.strip()]
        email = re.search(r"EMAIL[^:]*:(.*)$", card, re.M)
        if fn not in META: missing.append(fn); continue
        name, role, place, tags = META[fn]
        out.append({"name": name, "role": role, "place": place, "phones": phones, **({"email": email.group(1).strip()} if email else {}), "tags": tags.split()})
    p = os.path.join(ROOT, "site", "data", "contacts.json")
    json.dump({"_note": "XLRI support contacts, imported from a student's contact list with tools/import_contacts.py.", "contacts": out},
              open(p, "w", encoding="utf8"), ensure_ascii=False, indent=1)
    print(len(out), "contacts; unmapped:", missing)
    for c in out: print(f"  {c['name']:<22} {c['role'][:40]:<40} {', '.join(c['phones'])}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "raw", "contacts.vcf"))
