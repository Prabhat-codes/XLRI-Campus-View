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
  'buy eat drink having available go going hey hi hello s t d ll re ve m right').split(' '));
const TIME_WORDS = new Set('open opened opening close closes closed closing now right currently timing timings time times hours hour when till until still today tonight morning evening'.split(' '));
const stem = (t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t);

let PLACES = [];
const byName = new Map();

function scorePlace(p, qn, tokens) {
  let s = 0;
  const nn = norm(p.name);
  if (nn === qn) s += 120; else if (nn.startsWith(qn)) s += 80; else if (qn.length > 2 && nn.includes(qn)) s += 55;
  for (const a of p._aliases) { if (a === qn) s += 100; else if (qn.length > 2 && a.startsWith(qn)) s += 50; }
  const padded = ' ' + qn + ' ';
  for (const t of p._tags) {
    if (t.includes(' ') && padded.includes(' ' + t + ' ')) s += 35;
    for (const tok of tokens) {
      const st = stem(tok);
      if (t === tok || t === st || stem(t) === st) s += 24;
      else if (tok.length >= 3 && t.startsWith(st)) s += 10;
      else if (tok.length >= 4 && t.includes(st)) s += 5;
    }
  }
  for (const tok of tokens) if (tok.length >= 4 && p._desc.includes(stem(tok))) s += 3;
  return s;
}
export function search(q, limit = 8) {
  const qn = norm(q);
  if (!qn) return [];
  const tokens = qn.split(' ').filter((t) => !STOP.has(t) && !TIME_WORDS.has(t));
  return PLACES.map((p) => ({ p, s: scorePlace(p, qn, tokens) })).filter((r) => r.s > 0)
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
  const wantsPhone = /\b(number|numbers|phone|call|contact|mobile|whatsapp|delivery|deliver|order)\b/.test(qn);
  const wantsTime = [...words].some((w) => TIME_WORDS.has(w)) || /\bwhat s open\b/.test(qn);
  const topic = qn.split(' ').filter((t) => t && !STOP.has(t) && !TIME_WORDS.has(t) && !/^(number|numbers|phone|call|contact|mobile)$/.test(t));
  const clock = `It's ${fmtTime(now)} on campus.`;
  const NOT_SURE = "I'm not entirely sure about the timings.";
  const item = (p, st, opts = {}) => ({ place: p, line: st.text || (wantsTime && !p.hours ? NOT_SURE : ''), phone: (opts.phone || !wantsTime) ? p.phone : null, phoneLabel: p.phoneLabel });

  // 1. a specific place was named
  const named = mentioned(qn);
  if (named.length && named.length <= 4) {
    const items = named.map((p) => {
      const st = status(p, now);
      if (wantsPhone) return { place: p, line: p.phone ? '' : `I don't have a number for ${p.name} yet.`, phone: p.phone, phoneLabel: p.phoneLabel };
      const line = [st.text || (wantsTime ? NOT_SURE : ''), p.hours ? `(${hoursText(p)})` : ''].filter(Boolean).join(' ');
      return { place: p, line: wantsTime ? line : [p.desc, line].filter(Boolean).join(' '), phone: wantsTime ? null : p.phone, phoneLabel: p.phoneLabel };
    });
    return { intro: wantsTime ? clock : '', items, outro: '' };
  }

  // 2. "phone numbers" with no place
  if (wantsPhone && !topic.length) {
    const items = PLACES.filter((p) => p.phone).map((p) => ({ place: p, line: '', phone: p.phone, phoneLabel: p.phoneLabel }));
    return { intro: 'Numbers I have:', items, outro: '' };
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

  // 4. looking for something: food, printouts, juice...
  const hits = search(q, 6);
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
      items: list.map((r) => item(r.p, r.st, { phone: wantsPhone || !!r.p.phone })),
      outro: rest.length ? 'Also: ' + rest.map((r) => `${r.p.name}${r.st.text ? ` (${r.st.text.replace('Closed now · ', '')})` : ''}`).join(', ') + '.' : '',
    };
  }

  return {
    intro: "I don't know that one yet. Try asking about food, printouts, juice, stationery, the library, the gym, a phone number, or what's open right now. If something's missing, tap \"Want to improve this map?\" below and tell us.",
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
export function setupPlaces(data, { goTo }) {
  PLACES = (data.places || []).map((p) => ({ ...p, _aliases: (p.aliases || []).map(norm), _tags: (p.tags || []).map(norm), _desc: norm(p.desc || '') }));
  for (const p of PLACES) byName.set(p.name, p);

  // --- info card: hover previews, click pins
  const card = $('info');
  let pinned = null, hideTimer = 0;
  function render(l) {
    const p = byName.get(l.n);
    card.replaceChildren();
    card.append(el('strong', null, l.n));
    const st = statusPill(status(p));
    if (st) card.append(st);
    const d = (p && p.desc) || l.d;
    if (d) card.append(el('p', null, d));
    if (p && p.hours) card.append(el('p', 'hours', 'Hours: ' + hoursText(p) + (p.note ? ` · ${p.note}` : '')));
    if (p && p.phone) card.append(phoneLink(p.phone, p.phoneLabel));
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
  const SUGGEST = ['South Indian', 'Printouts', 'Juice', 'Late night food', 'Stationery', 'Gym', 'Coffee', 'Hostels', 'Parties'];
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
      const st = statusPill(status(p));
      if (st) top.append(st);
      b.append(top);
      const qn = norm(q);
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
  const PRESETS = ["What's open right now?", 'Where can I get printouts?', 'Best South Indian?', 'Late night food', "Jampot's number",
    'Is the library open?', 'Where do I get juice?', 'Where is the gym?', 'Stationery shop', 'Where are the parties?', 'All phone numbers'];
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
        const li = el('li');
        const go = el('button', 'go', it.place.name);
        go.title = 'Show on map';
        go.addEventListener('click', () => goTo(it.place.name));
        li.append(go);
        if (it.line) li.append(el('span', null, ' ' + it.line));
        if (it.phone) { li.append(' '); li.append(phoneLink(it.phone, it.phoneLabel)); }
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
    if (!log.childElementCount) say('bot', `Hi! Ask me where to eat, get printouts or juice, what's open right now (it's ${fmtTime(nowIST())} on campus), or for a phone number.`);
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

  return { get: (n) => byName.get(n), showCard, hideCard, openSearch };
}
