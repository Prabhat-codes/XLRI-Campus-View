// Campus directory: info cards, search, and a small offline assistant that answers from
// data/places.json (tags, opening hours in IST, phone numbers). No server, no API key.

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// ---------------------------------------------------------------- time (always campus time, IST)
const istFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function nowIST() {
  const [h, m] = istFmt.format(new Date()).split(':').map(Number);
  return h * 60 + m;
}
const toMin = (s) => +s.slice(0, 2) * 60 + +s.slice(3, 5);
export function fmtTime(m) {
  m = ((m % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60), mm = m % 60;
  return (h % 12 || 12) + (mm ? ':' + String(mm).padStart(2, '0') : '') + (h < 12 ? ' am' : ' pm');
}
const inRange = (now, [a, b]) => { const s = toMin(a), e = toMin(b); return s < e ? now >= s && now < e : now >= s || now < e; };

// state: open | likely | closed | unknown
export function status(p, now = nowIST()) {
  if (!p) return { state: 'unknown', text: '' };
  if (p.hours) {
    for (const r of p.hours) if (inRange(now, r)) return { state: 'open', text: `Open now · closes ${fmtTime(toMin(r[1]))}` };
    let next = null;
    for (const [a] of p.hours) { const d = (toMin(a) - now + 1440) % 1440; if (!next || d < next.d) next = { d, s: toMin(a) }; }
    return { state: 'closed', text: `Closed now · opens ${fmtTime(next.s)}` };
  }
  if (p.usually && p.usually.some((r) => inRange(now, r))) return { state: 'likely', text: 'Usually open around now' };
  return { state: 'unknown', text: p.note || '' };
}
const hoursText = (p) => p.hours ? p.hours.map(([a, b]) => `${fmtTime(toMin(a))} – ${fmtTime(toMin(b))}`).join(', ') : '';

// ---------------------------------------------------------------- text matching
export const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const STOP = new Set(('a an the is are am was be to of in on at for from by with and or i im me my we you u can could would should do does did ' +
  'get got find where wheres what whats which who how any anything some something please pls plz there here near nearby around good best nice ' +
  'place places spot campus xlri want need have has it its this that tell show give know about one ones serve serves serving sell sells selling ' +
  'buy eat drink having available go going hey hi hello s t d ll re ve m right order try dish dishes must menu recommend recommended famous known special eating').split(' '));
// words that just mean "somewhere to eat in town", not a particular dish
const GENERIC_FOOD = new Set('food foods restaurant restaurants jamshedpur town city outside dinner lunch dine dining out outing treat cuisine options option suggest suggestion suggestions'.split(' '));
const TOWN_RE = /\b(jamshedpur|town|city|outside|bistupur|sonari|sakchi|restaurant|restaurants|eat out|dine|dining|date)\b/;
const TIME_WORDS = new Set('open opened opening close closes closed closing now right currently timing timings time times hours hour when till until still today tonight morning evening'.split(' '));
const stem = (t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t);

let PLACES = [];
let CONTACTS = [];
// questions about a service rather than a place: these always look in the contacts list
const SERVICE_RE = /\b(help|helpdesk|helpline|emergency|ambulance|doctor|medical|electric\w*|maintenance|repair|plumb\w*|security|guard|housekeeping|cleaning|kfms|ac|aircon|wifi|internet|network|projector|audio|av|mic|tent|shamiana|printing|flex|banner\w*|posters?|stores?|adsa|reception|head|staff|contacts?|in charge|incharge)\b/;
function searchContacts(qn) {
  const want = qn.split(' ').filter((t) => t && !STOP.has(t) && !TIME_WORDS.has(t) && !/^(number|numbers|phone|call|contact|contacts|mobile|whatsapp|xlri)$/.test(t)).map(stem);
  const padded = ' ' + qn + ' ';
  const places = PLACES.filter((p) => p.kind !== 'restaurant' && [norm(p.name), ...p._aliases].some((k) => k.length > 1 && padded.includes(' ' + k + ' '))).map((p) => p.name);
  return CONTACTS.map((c) => {
    let sc = 0;
    for (const t of want) { if (c._tags.includes(t)) sc += 10; else if (c._words.includes(t)) sc += 6; }
    if (c.place && places.includes(c.place)) sc += 9;
    return { c, sc };
  }).filter((r) => r.sc >= 9).sort((a, b) => b.sc - a.sc).map((r) => r.c);
}
const contactItem = (c) => ({ contact: c });
const byName = new Map();

// two-word phrases that mean one thing: "south indian" should not also match plain "indian" places
const COMPOUNDS = ['south indian', 'north indian', 'non veg', 'late night', 'pure veg', 'table tennis', 'eat out', 'middle eastern'];
// words for a kind of food, and the dish names that belong to it
const CATEGORY = [
  [/\b(dessert|desserts|sweet|sweets|cake)\b/, /cheesecake|tiramisu|pastry|lava|tres leches|panna cotta|affogato|custard|pudding|phirni|shahi tukda|khunafah|cookie|hot chocolate|cake/],
  [/\b(beer|bar|bars|drinks|cocktail|cocktails|booze|alcohol)\b/, /\bbeer\b|cocktail|\bgin\b|mojito|margherita/],
  [/\bsouth indian\b/, /dosa|idli|vada|uttapam|curd rice/],
  [/\bnorth indian\b/, /naan|dal makhani|butter chicken|paneer|kulch|biryani|tikka|kebab|chaap|rogan josh|nihari/],
  [/\b(italian)\b/, /pasta|pizza|lasagna|spaghetti|ravioli|bruschetta/],
  [/\b(chinese|asian)\b/, /momo|noodle|manchurian|manchow|thukpa|dumpling|gyoza|khao suey/],
  [/\b(coffee|cafe)\b/, /coffee|\blatte\b|affogato/],
  [/\b(seafood)\b/, /prawn|fish/],
  [/\b(sushi|japanese)\b/, /sushi|tempura/],
  [/\b(lebanese|middle eastern|arabic)\b/, /shish|taouk|tawook|lebanese|hummus|falafel|shawarma|khunafah/],
];
const words = (s) => s.split(' ').map(stem);
function queryTokens(qn) {
  let rest = qn;
  for (const c of COMPOUNDS) rest = rest.replace(new RegExp('\\b' + c + '\\b', 'g'), ' ');
  return rest.split(' ').filter((t) => t && !STOP.has(t) && !TIME_WORDS.has(t));
}
function scorePlace(p, qn, tokens) {
  let s = 0;
  const nn = norm(p.name);
  if (nn === qn) s += 120; else if (nn.startsWith(qn)) s += 80; else if (qn.length > 2 && nn.includes(qn)) s += 55;
  for (const a of p._aliases) { if (a === qn) s += 100; else if (qn.length > 2 && a.startsWith(qn)) s += 50; }
  const padded = ' ' + qn + ' ';
  for (const t of p._tags) {
    if (t.includes(' ') && padded.includes(' ' + t + ' ')) s += 35;      // a whole phrase like "south indian"
    const tw = words(t);
    for (const tok of tokens) {
      const st = stem(tok);
      if (tw.includes(st)) s += t.includes(' ') ? 12 : 24;                // whole word, plurals folded
      else if (st.length >= 4 && tw.some((w) => w.startsWith(st))) s += 6; // "stationer" -> "stationery"
    }
  }
  for (const tok of tokens) if (tok.length >= 4 && words(p._desc).includes(stem(tok))) s += 3;
  if (p._dishes) s += matchDishes(p, qn, tokens).length * 14;
  return s;
}
// restaurant dishes that fit the question: every query word in the dish name if possible
// ("butter chicken"), otherwise any of them, plus dishes of a named kind ("dessert")
function matchDishes(p, qn, tokens) {
  if (!p._dishes) return [];
  const want = tokens.filter((t) => t.length >= 3 && !GENERIC_FOOD.has(t)).map(stem);
  const has = (i, t) => words(p._dishes[i]).includes(t);
  let hit = want.length ? p.dishes.filter((d, i) => want.every((t) => has(i, t))) : [];
  if (!hit.length && want.length > 1) hit = p.dishes.filter((d, i) => want.some((t) => has(i, t)) && !want.every((t) => /^(chicken|mutton|veg|paneer|fish)$/.test(t) || !has(i, t)));
  for (const [q, dish] of CATEGORY) if (q.test(qn)) for (const d of p.dishes) if (dish.test(d.d.toLowerCase()) && !hit.includes(d)) hit.push(d);
  return hit;
}
const dishText = (d) => d.d + (d.t ? ' (unconfirmed)' : '') + (d.mixed ? ' (mixed reviews)' : '');
const ratingText = (r) => (r.rating ? `\u2605 ${r.rating}` : '');
export function search(q, limit = 8) {
  const qn = norm(q);
  if (!qn) return [];
  const tokens = queryTokens(qn);
  // campus places get a head start so a dish search still shows what's on campus first
  return PLACES.map((p) => { const sc = scorePlace(p, qn, tokens); return { p, s: sc > 0 && p.kind !== 'restaurant' ? sc + 20 : sc }; }).filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s).slice(0, limit).map((r) => r.p);
}
function mentioned(qn) {
  const padded = ' ' + qn + ' ';
  return PLACES.filter((p) => [norm(p.name), ...p._aliases].some((k) => k.length > 1 && padded.includes(' ' + k + ' ')));
}
const rank = { open: 0, likely: 1, unknown: 2, closed: 3 };
const byOpen = (list, now) => list.map((p) => ({ p, st: status(p, now) })).sort((a, b) => rank[a.st.state] - rank[b.st.state]);

// ---------------------------------------------------------------- the assistant
// Returns { intro, items: [{ place, line, phone }], outro }
export function answer(q, now = nowIST()) {
  const qn = norm(q);
  const words = new Set(qn.split(' '));
  const wantsPhone = /\b(number|numbers|phone|call|contact|contacts|mobile|whatsapp|delivery|deliver)\b/.test(qn);
  const wantsPeople = wantsPhone || SERVICE_RE.test(qn);
  const town = TOWN_RE.test(qn);
  const wantsTime = [...words].some((w) => TIME_WORDS.has(w)) || /\bwhat s open\b/.test(qn);
  const topic = qn.split(' ').filter((t) => t && !STOP.has(t) && !TIME_WORDS.has(t) && !/^(number|numbers|phone|call|contact|mobile)$/.test(t));
  const clock = `It's ${fmtTime(now)} on campus.`;
  const NOT_SURE = "I'm not entirely sure about the timings.";
  const item = (p, st, opts = {}) => ({ place: p, line: st.text || (wantsTime && !p.hours ? NOT_SURE : ''), phone: (opts.phone || !wantsTime) ? p.phone : null, phoneLabel: p.phoneLabel });

  // 1. a specific place was named
  const named = mentioned(qn);
  if (named.length && named.length <= 4) {
    const items = named.map((p) => {
      if (p.kind === 'restaurant') {
        if (wantsPhone) return { place: p, line: "I don't have their number. Google Maps has it:", link: p.mapsUrl };
        if (wantsTime) return { place: p, line: "I haven't checked their opening hours. Google Maps has them:", link: p.mapsUrl };
        const sure = p.dishes.filter((d) => !d.t).slice(0, 6).map(dishText), maybe = p.dishes.filter((d) => d.t).slice(0, 5).map((d) => d.d);
        return { place: p, line: `${p.closed ? p.closed + '. ' : ''}${ratingText(p)} · ${p.area}. ${sure.length ? 'Recommended: ' + sure.join(', ') + '. ' : ''}${maybe.length ? 'Possible, unconfirmed: ' + maybe.join(', ') + '.' : ''}${p.skip.length ? ' Skip: ' + p.skip.map((d) => d.d).join(', ') + '.' : ''}`, link: p.mapsUrl };
      }
      const st = status(p, now);
      const people = CONTACTS.filter((c) => c.place === p.name && !(c.phones.length === 1 && c.phones[0] === p.phone));   // skip a repeat of the place's own number
      if (wantsPeople && (people.length || wantsPhone)) {
        if (people.length) return [...(p.phone ? [{ place: p, line: '', phone: p.phone, phoneLabel: p.phoneLabel }] : [{ place: p, line: '' }]), ...people.map(contactItem)];
        return { place: p, line: p.phone ? '' : `I don't have a number for ${p.name} yet.`, phone: p.phone, phoneLabel: p.phoneLabel };
      }
      const line = [st.text || (wantsTime ? NOT_SURE : ''), p.hours ? `(${hoursText(p)})` : ''].filter(Boolean).join(' ');
      return { place: p, line: wantsTime ? line : [p.desc, line].filter(Boolean).join(' '), phone: wantsTime ? null : p.phone, phoneLabel: p.phoneLabel };
    });
    return { intro: wantsTime ? clock : '', items: items.flat(), outro: '' };
  }

  // 1b. a service or department: ambulance, electrician, IT helpdesk, security...
  if (wantsPhone || SERVICE_RE.test(qn)) {
    const people = searchContacts(qn).slice(0, 6);
    if (people.length) return { intro: 'Here\u2019s who to call:', items: people.map(contactItem), outro: '' };
  }

  // 2. "phone numbers" with no place
  if (wantsPhone && !topic.length) {
    const items = PLACES.filter((p) => p.phone).map((p) => ({ place: p, line: '', phone: p.phone, phoneLabel: p.phoneLabel }));
    return { intro: 'Numbers I have:', items, outro: 'I also have campus support contacts: ask for the ambulance, security, IT helpdesk, electrical, maintenance, housekeeping, LC1, LC2 or the International Center.' };
  }

  // 3. "what's open right now?"
  if (wantsTime && !topic.length) {
    const ranked = byOpen(PLACES.filter((p) => p.hours || p.usually), now);
    const open = ranked.filter((r) => r.st.state === 'open' || r.st.state === 'likely');
    const closed = ranked.filter((r) => r.st.state === 'closed');
    return {
      intro: `${clock} ${open.length ? 'Open right now:' : 'Nothing I have timings for is open right now.'}`,
      items: open.map((r) => item(r.p, r.st, { phone: true })),
      outro: closed.length ? 'Closed now: ' + closed.map((r) => `${r.p.name} (${r.st.text.replace('Closed now · ', '')})`).join(', ') + '.' : '',
    };
  }

  // 4a. "where should I eat in Jamshedpur?" with no particular dish
  if (town && topic.every((t) => GENERIC_FOOD.has(t))) {
    const top = PLACES.filter((p) => p.kind === 'restaurant').sort((a, b) => (b.rating || 0) - (a.rating || 0) || (b.reviews || 0) - (a.reviews || 0)).slice(0, 8);
    return {
      intro: 'Good places to eat around Jamshedpur, best rated first:',
      items: top.map((p) => ({ place: p, line: `${ratingText(p)} · ${p.area}. Known for ${p.dishes.slice(0, 2).map((d) => d.d).join(', ') || 'South Indian and breakfast'}.`, link: p.mapsUrl })),
      outro: 'Ask "what\u2019s good at Mocha?" for the full picks at any of them.',
    };
  }

  // 4b. looking for something: a dish, printouts, juice...
  const all = search(q, 14);
  const tokens = queryTokens(qn);
  const inTown = all.filter((p) => p.kind === 'restaurant').slice(0, 5);
  const hits = town ? [] : all.filter((p) => p.kind !== 'restaurant').slice(0, 6);
  const townItems = inTown.map((p) => {
    const m = matchDishes(p, qn, tokens);
    return { place: p, line: `${m.length ? m.slice(0, 3).map(dishText).join(', ') : 'Known for ' + (p.dishes.slice(0, 2).map((d) => d.d).join(', ') || 'South Indian and breakfast')} · ${ratingText(p)}, ${p.area}`, link: p.mapsUrl };
  });
  if (!hits.length && townItems.length) {
    return { intro: 'Around Jamshedpur:', items: townItems, outro: wantsTime ? "I haven't checked restaurant opening hours." : '' };
  }
  if (hits.length) {
    const ranked = byOpen(hits, now);
    const open = ranked.filter((r) => r.st.state === 'open' || r.st.state === 'likely');
    let intro = '';
    if (wantsTime) intro = open.length ? `${clock} Open right now:` : `${clock} None of these are open right now:`;
    else if (open.length && ranked.some((r) => r.st.state !== 'open' && r.st.state !== 'likely')) intro = 'Here you go. Open ones first:';
    else intro = 'Here you go:';
    const list = wantsTime && open.length ? open : ranked;
    const rest = wantsTime && open.length ? ranked.filter((r) => !open.includes(r)) : [];
    return {
      intro,
      items: list.map((r) => item(r.p, r.st, { phone: wantsPhone || !!r.p.phone })).concat(townItems.length ? [{ heading: 'In Jamshedpur' }, ...townItems] : []),
      outro: rest.length ? 'Also: ' + rest.map((r) => `${r.p.name}${r.st.text ? ` (${r.st.text.replace('Closed now · ', '')})` : ''}`).join(', ') + '.' : '',
    };
  }

  return {
    intro: "I don't know that one yet. Try asking about food on campus or in town, a dish, printouts, juice, stationery, the library, the gym, a phone number, or what's open right now. If something's missing, tap \"Want to improve this map?\" below and tell us.",
    items: [], outro: '',
  };
}

// ---------------------------------------------------------------- shared bits of UI
const telHref = (p) => 'tel:' + p.replace(/[^\d+]/g, '');
function phoneLink(phone, label) {
  const a = el('a', 'phone', (label ? label + ' ' : 'Call ') + phone);
  a.href = telHref(phone);
  return a;
}
function statusPill(st) { return st.text ? el('span', 'pill ' + st.state, st.text) : null; }

// ---------------------------------------------------------------- setup
export function setupPlaces(data, { goTo }, food = {}, people = {}) {
  CONTACTS = (people.contacts || []).map((c) => ({ ...c, _tags: c.tags.map((t) => stem(norm(t))), _words: norm(c.name + ' ' + c.role).split(' ').map(stem) }));
  const restaurants = food.restaurants || [];
  PLACES = (data.places || []).map((p) => ({ ...p, _aliases: (p.aliases || []).map(norm), _tags: (p.tags || []).map(norm), _desc: norm(p.desc || '') }))
    .concat(restaurants.map((r) => ({
      ...r, kind: 'restaurant', hours: null, phone: null,
      desc: `Restaurant in ${r.area}. ${r.dishes.length ? 'Known for ' + r.dishes.slice(0, 2).map((d) => d.d).join(', ') + '.' : ''}`,
      _aliases: (r.aliases || []).map(norm), _tags: (r.tags || []).map(norm), _desc: norm(r.address || ''), _dishes: r.dishes.map((d) => norm(d.d)),
    })));
  for (const p of PLACES) byName.set(p.name, p);

  // --- info card: hover previews, click pins
  const card = $('info');
  let pinned = null, hideTimer = 0;
  function renderRestaurant(p) {
    card.append(el('strong', null, p.name));
    if (p.rating) card.append(el('span', 'pill rating', `\u2605 ${p.rating} \u00b7 ${(p.reviews || 0).toLocaleString('en-IN')} Google reviews`));
    if (p.closed) card.append(el('span', 'pill closed', p.closed));
    card.append(el('p', 'hours', p.address));
    const list = (title, items) => {
      if (!items.length) return;
      card.append(el('div', 'sub', title));
      const ul = el('ul', 'dishes');
      for (const d of items) {
        const li = el('li', d.c === 'high' && !d.t ? 'hi' : null, d.d);
        if (d.mixed) li.append(el('span', 'mixed', ' mixed reviews'));
        ul.append(li);
      }
      card.append(ul);
    };
    list('Recommended', p.dishes.filter((d) => !d.t));
    list('Possible, unconfirmed', p.dishes.filter((d) => d.t));
    if (p.skip.length) card.append(el('p', 'skip', 'Skip: ' + p.skip.map((d) => d.d + (d.why ? ` (${d.why})` : '')).join('; ')));
    for (const n of p.notes.slice(0, 2)) card.append(el('p', 'note', n));
    const a = el('a', 'phone', 'Open in Google Maps \u2197');
    a.href = p.mapsUrl; a.target = '_blank'; a.rel = 'noopener';
    card.append(a);
    card.hidden = false;
  }
  function render(l) {
    const p = byName.get(l.n);
    card.replaceChildren();
    if (p && p.kind === 'restaurant') return renderRestaurant(p);
    card.append(el('strong', null, l.n));
    const st = statusPill(status(p));
    if (st) card.append(st);
    const d = (p && p.desc) || l.d;
    if (d) card.append(el('p', null, d));
    if (p && p.hours) card.append(el('p', 'hours', 'Hours: ' + hoursText(p) + (p.note ? ` · ${p.note}` : '')));
    if (p && p.phone) card.append(phoneLink(p.phone, p.phoneLabel));
    const people = CONTACTS.filter((c) => c.place === l.n);
    if (people.length) {
      card.append(el('div', 'sub', 'Contacts'));
      const ul = el('ul', 'contacts');
      for (const c of people) {
        const li = el('li');
        li.append(el('b', null, c.name), el('span', null, ' \u00b7 ' + c.role));
        for (const ph of c.phones) li.append(' ', phoneLink(ph, ''));
        ul.append(li);
      }
      card.append(ul);
    }
    if (p && p.tags && p.tags.length) {
      const t = el('div', 'tags');
      for (const tag of p.tags.slice(0, 8)) {
        const b = el('button', null, tag);
        b.addEventListener('click', () => openSearch(tag));
        t.append(b);
      }
      card.append(t);
    }
    card.hidden = false;
  }
  function showCard(l, pin) {
    clearTimeout(hideTimer);
    if (!l || (!byName.get(l.n) && !l.d)) { if (pin) { pinned = null; card.hidden = true; } return; }
    if (pin) pinned = l;
    render(l);
  }
  function hideCard(force) {
    clearTimeout(hideTimer);
    if (force) { pinned = null; card.hidden = true; return; }
    hideTimer = setTimeout(() => { if (pinned) render(pinned); else card.hidden = true; }, 350);
  }
  card.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  card.addEventListener('mouseleave', () => { if (!pinned) hideCard(false); });

  // --- search
  const sBox = $('search'), sIn = $('search-input'), sRes = $('search-results');
  const SUGGEST = ['South Indian', 'Printouts', 'Juice', 'Late night food', 'Pasta', 'Momos', 'Dessert', 'Stationery', 'Gym', 'Hostels', 'Parties'];
  function drawResults() {
    sRes.replaceChildren();
    const q = sIn.value.trim();
    if (!q) {
      const row = el('div', 'suggest');
      for (const s of SUGGEST) { const b = el('button', null, s); b.addEventListener('click', () => { sIn.value = s; drawResults(); sIn.focus(); }); row.append(b); }
      sRes.append(el('div', 'hint', 'Try'), row);
      return;
    }
    const hits = search(q);
    if (!hits.length) { sRes.append(el('div', 'hint', `Nothing for "${q}" yet. Try "food" or "printouts", or ask the assistant.`)); return; }
    hits.forEach((p, i) => {
      const b = el('button', 'result' + (i === 0 ? ' first' : ''));
      b.setAttribute('role', 'option');
      const top = el('div', 'r-top');
      top.append(el('span', 'r-name', p.name));
      const st = p.kind === 'restaurant' ? (p.rating ? el('span', 'pill rating', `\u2605 ${p.rating}`) : null) : statusPill(status(p));
      if (st) top.append(st);
      b.append(top);
      const qn = norm(q);
      if (p.kind === 'restaurant') {
        const m = matchDishes(p, qn, queryTokens(qn));
        b.append(el('div', 'r-sub', `${m.length ? m.slice(0, 2).map((d) => d.d).join(', ') + ' \u00b7 ' : ''}${p.area}`));
        b.addEventListener('click', () => { closeSearch(); goTo(p.name); });
        sRes.append(b);
        return;
      }
      const tag = (p.tags || []).find((t) => norm(t).includes(stem(qn)) || qn.includes(norm(t)));
      b.append(el('div', 'r-sub', tag && norm(p.name).indexOf(qn) < 0 ? `${tag} · ${p.desc}` : p.desc || ''));
      b.addEventListener('click', () => { closeSearch(); goTo(p.name); });
      sRes.append(b);
    });
  }
  function openSearch(prefill) {
    sBox.hidden = false;
    $('search-btn').setAttribute('aria-expanded', 'true');
    if (typeof prefill === 'string') sIn.value = prefill;
    drawResults();
    sIn.focus();
    sIn.select();
  }
  function closeSearch() { sBox.hidden = true; $('search-btn').setAttribute('aria-expanded', 'false'); }
  $('search-btn').addEventListener('click', () => (sBox.hidden ? openSearch() : closeSearch()));
  sIn.addEventListener('input', drawResults);
  sIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const f = sRes.querySelector('.result'); if (f) f.click(); }
    if (e.key === 'Escape') closeSearch();
    if (e.key === 'ArrowDown') { const f = sRes.querySelector('.result'); if (f) { e.preventDefault(); f.focus(); } }
  });
  sRes.addEventListener('keydown', (e) => {
    const items = [...sRes.querySelectorAll('.result')], i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' && i < items.length - 1) { e.preventDefault(); items[i + 1].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); (i > 0 ? items[i - 1] : sIn).focus(); }
    if (e.key === 'Escape') closeSearch();
  });
  addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
    if (!typing && (e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'))) { e.preventDefault(); openSearch(); }
  });

  // --- assistant
  const chat = $('chat'), log = $('chat-log'), form = $('chat-form'), input = $('chat-input'), chips = $('chat-chips');
  const PRESETS = ["What's open right now?", 'Ambulance number', 'Wifi not working', 'LC2 contacts', 'Where to eat in Jamshedpur?', "What's good at Mocha?", 'Best pasta in town', 'Where can I get printouts?',
    'Best South Indian?', 'Late night food', 'Best momos', 'Dessert in town', 'Bar for beer', "Jampot's number", 'Is the library open?',
    'Where do I get juice?', 'Where is the gym?', 'Stationery shop', 'Where are the parties?', 'All phone numbers'];
  function say(who, content) {
    const m = el('div', 'msg ' + who);
    if (typeof content === 'string') m.textContent = content; else m.append(content);
    log.append(m);
    log.scrollTop = log.scrollHeight;
  }
  function reply(q) {
    say('me', q);
    const a = answer(q);
    const box = document.createDocumentFragment();
    if (a.intro) box.append(el('p', null, a.intro));
    if (a.items.length) {
      const ul = el('ul');
      for (const it of a.items) {
        if (it.heading) { ul.append(el('li', 'heading', it.heading)); continue; }
        if (it.contact) {
          const c = it.contact, li = el('li');
          li.append(el('b', null, c.name), el('span', null, ' \u00b7 ' + c.role + (c.place ? ` (${c.place})` : '')));
          for (const ph of c.phones) li.append(' ', phoneLink(ph, ''));
          if (c.email) { const m = el('a', 'maplink', c.email); m.href = 'mailto:' + c.email; li.append(' ', m); }
          ul.append(li);
          continue;
        }
        const li = el('li');
        const go = el('button', 'go', it.place.name);
        go.title = 'Show on map';
        go.addEventListener('click', () => goTo(it.place.name));
        li.append(go);
        if (it.line) li.append(el('span', null, ' ' + it.line));
        if (it.phone) { li.append(' '); li.append(phoneLink(it.phone, it.phoneLabel)); }
        if (it.link) { const m = el('a', 'maplink', 'Maps \u2197'); m.href = it.link; m.target = '_blank'; m.rel = 'noopener'; li.append(' ', m); }
        ul.append(li);
      }
      box.append(ul);
    }
    if (a.outro) box.append(el('p', 'outro', a.outro));
    say('bot', box);
    if (a.items.length === 1) goTo(a.items[0].place.name, true);
  }
  for (const q of PRESETS) { const b = el('button', null, q); b.addEventListener('click', () => reply(q)); chips.append(b); }
  form.addEventListener('submit', (e) => { e.preventDefault(); const q = input.value.trim(); if (!q) return; input.value = ''; reply(q); });
  function openChat() {
    chat.hidden = false; $('chat-btn').hidden = true;
    if (!log.childElementCount) say('bot', `Hi! Ask me anything about campus or food around Jamshedpur: what's open right now (it's ${fmtTime(nowIST())}), where to get printouts, what's good at Mocha, the best pasta in town, or a phone number.`);
    input.focus();
  }
  $('chat-btn').addEventListener('click', openChat);

  // --- feedback: appended to the Google Sheet by an Apps Script web app (tools/feedback_sheet.gs)
  const fb = $('fb'), fbStatus = $('fb-status'), fbSend = $('fb-send'), main = $('chat-main');
  const showFb = (on) => { fb.hidden = !on; main.hidden = on; fbStatus.textContent = ''; fbStatus.className = 'fb-status'; if (on) fb.message.focus(); };
  $('fb-open').addEventListener('click', () => showFb(true));
  $('fb-back').addEventListener('click', () => showFb(false));
  fb.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = fb.message.value.trim();
    if (!msg) { fb.message.focus(); return; }
    if (fb.website.value) { showFb(false); return; }            // filled only by bots
    if (!data.feedbackUrl) { fbStatus.textContent = "Feedback isn't connected yet. Please try again later."; fbStatus.className = 'fb-status err'; return; }
    fbSend.disabled = true; fbStatus.textContent = 'Sending…'; fbStatus.className = 'fb-status';
    try {
      const body = new URLSearchParams({ type: fb.type.value, message: msg, name: fb.name.value.trim(), contact: fb.contact.value.trim(), where: ($('where-name') || {}).textContent || '' });
      // Apps Script does not send CORS headers, so the reply cannot be read; a network failure still throws
      await fetch(data.feedbackUrl, { method: 'POST', mode: 'no-cors', body });
      fb.reset();
      fbStatus.textContent = 'Thank you! Your feedback was sent.'; fbStatus.className = 'fb-status ok';
      setTimeout(() => { if (!fb.hidden) showFb(false); }, 2200);
    } catch {
      fbStatus.textContent = "Couldn't send that. Check your connection and try again."; fbStatus.className = 'fb-status err';
    } finally { fbSend.disabled = false; }
  });
  $('chat-close').addEventListener('click', () => { chat.hidden = true; $('chat-btn').hidden = false; });

  return { get: (n) => byName.get(n), showCard, hideCard, openSearch, restaurants };
}
