/* Emma Sophia Stables: administrace webu (24. 11. 2026). Kopie administrace cib.cz (19. 10. 2026), záložka Zprávy převzata 26. 11. 2026 (formulář na stránce Kontakt),
   navíc záložka Sezóny. Kontrakt: _KONTRAKT.md (oddíl Administrace a web) a ess-admin-api/README.md.
   Bezpečnost: žádné innerHTML s daty, token jen v sessionStorage, odhlášení po 30 min nečinnosti, ochrana proti
   vložení do rámu, CSP v index.html. Do náhledu webu se zapisuje až po oživení Reactu (čeká se na událost ess:obsah). */
"use strict";
(function () {
  /* ochrana proti clickjackingu: v cizím rámu nic nevykreslit. Výjimka: obal webhunter.cz/navrhy, a to jen jako
     jediný rám přímo v horním okně (obal sám jde vložit do cizí stránky, proto i kontrola parent === top) */
  const OBAL = /^https:\/\/(www\.)?webhunter\.cz$/;
  const WEB_ODKAZ = "https://webhunter.cz/navrhy/6b060c40f62df19a5867ee41"; // odkaz návrhu webu na webhunter.cz/navrhy/… (doplnit, až vznikne; do té doby se pod obalem odkaz na web skryje)
  let vObalu = false;
  if (window.top !== window.self) {
    const pred = location.ancestorOrigins; // Chrome, Safari; Firefox nemá → referrer přímého rodiče
    const rodic = pred ? (pred.length === 1 ? pred[0] : "") : (document.referrer ? new URL(document.referrer).origin : "");
    vObalu = window.parent === window.top && OBAL.test(rodic);
    if (!vObalu) {
      try { window.top.location.replace(window.self.location.href); } catch (e) { /* cizí rám: zůstane prázdné */ }
      return;
    }
  }
  document.documentElement.classList.add("ok");

  const API = "https://ess-admin-api.prodej-bytu-3-1-70-m2-172175436.workers.dev";
  const WEB = new URL("../", location.href).pathname; // kořen webu: na náhledu podsložka úložiště, na ostré doméně „/“
  const KLIC = "ess-admin-relace";
  let NECINNOST = 30 * 60 * 1000; // server může poslat necinnost_s v /ja
  const MAX_FOTKA = 2400;
  const MAX_RADKU = 60, MAX_RADEK = 200, MAX_INFO = 1200; // sezóny, stejné meze hlídá služba
  const ROK_RE = /^20(2[3-9]|3[0-5])$/;
  const STRANKY_ZALOHA = [
    ["", "Domů", "cs"], ["emma-sophia/", "Emma Sophia", "cs"], ["sezona-2026/", "Sezóna 2026", "cs"], ["sezona-2025/", "Sezóna 2025", "cs"],
    ["sezona-2024/", "Sezóna 2024", "cs"], ["sezona-2023/", "Sezóna 2023", "cs"], ["galerie/", "Galerie", "cs"],
    ["galerie/staje/", "Galerie stájí", "cs"], ["galerie/souteze/", "Soutěžní galerie", "cs"], ["kontakt/", "Kontakt", "cs"],
    ["en/", "Home", "en"], ["en/emma-sophia/", "Emma Sophia", "en"], ["en/season-2026/", "Season 2026", "en"], ["en/season-2025/", "Season 2025", "en"],
    ["en/season-2024/", "Season 2024", "en"], ["en/season-2023/", "Season 2023", "en"], ["en/gallery/", "Gallery", "en"],
    ["en/gallery/stables/", "Stable Gallery", "en"], ["en/gallery/competition/", "Competition Gallery", "en"], ["en/contact/", "Contact", "en"],
  ].map(([u, n, j]) => ({ url: WEB + u, nazev: n, jazyk: j }));

  const S = {
    token: null, jmeno: "", platiDo: null, obsah: null, katalog: null, stranka: null, tab: "prehled", jazyk: "cs",
    historie: null, aktivita: null, ja: null, posledni: Date.now(), uprava: false, vybrany: null,
    fotka: null, novaFotka: null, zamekDo: 0, zpravy: null, zpravyKomu: "", sez: { rok: null, koncepty: {}, id: 0, tah: null },
  };

  /* ───────── pomocníci ───────── */
  const $ = (id) => document.getElementById(id);
  function h(tag, props, ...deti) {
    const el = document.createElement(tag);
    if (props) for (const k of Object.keys(props)) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.slice(0, 2) === "on" && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "dataset") Object.assign(el.dataset, v);
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, String(v));
    }
    for (const d of deti.flat(Infinity)) {
      if (d == null || d === false) continue;
      el.append(d instanceof Node ? d : document.createTextNode(String(d)));
    }
    return el;
  }
  function ik(n) {
    const t = $("i-" + n);
    return t ? t.content.firstElementChild.cloneNode(true) : document.createElement("span");
  }
  function nahrad(el, ...deti) { el.replaceChildren(...deti.flat(Infinity).filter((d) => d != null && d !== false)); } // replaceChildren by z null udělal text „null“
  function styl(el, s) { for (const k of Object.keys(s)) el.style.setProperty(k, s[k]); } // přes CSSOM, projde i přísným CSP webu
  const fmtCas = new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
  function cas(iso) { const d = new Date(iso); return isNaN(d) ? "neznámý čas" : fmtCas.format(d); }
  function pred(iso) {
    const d = new Date(iso); if (isNaN(d)) return "";
    const s = Math.round((Date.now() - d) / 1000);
    if (s < 60) return "právě teď";
    if (s < 3600) return "před " + Math.round(s / 60) + " min";
    if (s < 86400) return "před " + Math.round(s / 3600) + " h";
    const dny = Math.round(s / 86400);
    return dny === 1 ? "včera" : "před " + dny + " dny";
  }
  function vlajka(z) {
    if (!/^[A-Z]{2}$/.test(z || "")) return z || "?";
    return String.fromCodePoint(...[...z].map((c) => 0x1f1a5 + c.charCodeAt(0))) + " " + z;
  }
  function prohlizec(ua) {
    ua = String(ua || "");
    const b = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Prohlížeč";
    const o = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
    return o ? b + " · " + o : b;
  }
  function inicialy(j) {
    const c = String(j || "?").split(/[\s._-]+/).filter(Boolean);
    return ((c[0] || "?")[0] + (c[1] ? c[1][0] : (c[0] || "")[1] || "")).toUpperCase();
  }
  const sklon = (n, jeden, dva, pet) => (n === 1 ? jeden : n >= 2 && n <= 4 ? dva : pet);
  function cisloKontaktu(n) { return sklon(n, "kontakt", "kontakty", "kontaktů"); }
  const pocetRadku = (n) => n + " " + sklon(n, "řádek", "řádky", "řádků");
  const odkud = (ip, zeme) => (ip || "neznámá adresa") + " · " + vlajka(zeme);

  /* ───────── HTML textů: jen <strong>, <em>, <br> ───────── */
  const POVOLENE = { STRONG: "strong", B: "strong", EM: "em", I: "em", BR: "br" };
  function sanitizuj(html) {
    // zdroj = řetězec (rozparsuje se v inertním dokumentu, nic se nespustí ani nenačte) nebo vlastní uzel editoru
    const zdroj = html instanceof Node ? html : new DOMParser().parseFromString("<!doctype html><body>" + String(html == null ? "" : html), "text/html").body;
    const frag = document.createDocumentFragment();
    (function kopiruj(z, cil) {
      for (const n of Array.from(z.childNodes)) {
        if (n.nodeType === 3) cil.append(document.createTextNode(n.nodeValue));
        else if (n.nodeType === 1) {
          const t = POVOLENE[n.tagName];
          if (t === "br") cil.append(document.createElement("br"));
          else if (t) { const e = document.createElement(t); kopiruj(n, e); cil.append(e); }
          else if (n.tagName === "SCRIPT" || n.tagName === "STYLE" || n.tagName === "TEMPLATE") continue;
          else if (/^(DIV|P|LI)$/.test(n.tagName)) { if (cil.childNodes.length) cil.append(document.createElement("br")); kopiruj(n, cil); }
          else kopiruj(n, cil);
        }
      }
    })(zdroj, frag);
    return frag;
  }
  function serializuj(uzel) {
    let s = "";
    for (const n of Array.from(uzel.childNodes)) {
      if (n.nodeType === 3) s += n.nodeValue.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      else if (n.nodeName === "BR") s += "<br>";
      else if (n.nodeName === "STRONG" || n.nodeName === "EM") { const t = n.nodeName.toLowerCase(); const v = serializuj(n); if (v) s += "<" + t + ">" + v + "</" + t + ">"; }
      else s += serializuj(n);
    }
    return s;
  }
  const cisteHtml = (html) => serializuj(sanitizuj(html)).replace(/(<br>)+$/, "").trim();
  const jenText = (html) => (sanitizuj(html).textContent || "").replace(/\s+/g, " ").trim();

  /* ───────── API ───────── */
  class Chyba extends Error { constructor(m, status, data) { super(m); this.status = status; this.data = data; } }
  async function api(cesta, o) {
    o = o || {};
    const hl = {};
    if (!o.verejne && S.token) hl.Authorization = "Bearer " + S.token;
    let body;
    if (o.telo instanceof Blob) { body = o.telo; hl["Content-Type"] = o.typ || o.telo.type || "application/octet-stream"; }
    else if (o.telo !== undefined) { body = JSON.stringify(o.telo); hl["Content-Type"] = "application/json"; }
    let r;
    try {
      r = await fetch(API + cesta, { method: o.metoda || "GET", headers: hl, body, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", mode: "cors" });
    } catch (e) { throw new Chyba("Nepodařilo se spojit se serverem. Zkontrolujte připojení k internetu.", 0); }
    let data = null;
    try { data = await r.json(); } catch (e) { /* prázdné tělo */ }
    if (r.status === 401 && !o.verejne && S.token) {
      odhlasMistne("Přihlášení vypršelo. Přihlaste se prosím znovu.");
      throw new Chyba("Přihlášení vypršelo.", 401, data);
    }
    if (!r.ok) throw new Chyba((data && data.chyba) || "Něco se nepovedlo (chyba " + r.status + ").", r.status, data);
    return data;
  }
  const cast = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});
  function prazdnyObsah() { return { verze: 0, upraveno: null, kontakty: {}, texty: {}, fotky: {}, sezony: {} }; }
  function normalizujObsah(o) {
    o = cast(o);
    return { verze: +o.verze || 0, upraveno: o.upraveno || null, kontakty: cast(o.kontakty), texty: cast(o.texty), fotky: cast(o.fotky), sezony: cast(o.sezony) };
  }

  /* uložení změn s kontrolou souběhu (409) */
  async function uloz(zmeny, hlaska, navic) {
    try {
      const o = await api("/obsah", { metoda: "POST", telo: Object.assign({ zmeny, verze: S.obsah ? S.obsah.verze : 0 }, navic || {}) });
      S.obsah = normalizujObsah(o); S.historie = null;
      aplikujNahled();
      toast(hlaska || "Uloženo a zveřejněno.", "ok");
      vykresliStav();
      return true;
    } catch (e) {
      if (e.status === 409) {
        if (e.data && e.data.obsah) S.obsah = normalizujObsah(e.data.obsah);
        else { try { S.obsah = normalizujObsah(await api("/obsah", { verejne: true })); } catch (x) { /* nic */ } }
        aplikujNahled(); vykresli();
        toast("Mezitím uložil změny někdo jiný. Načetl jsem aktuální verzi, zkontrolujte ji a uložte znovu.", "err", 7000);
      } else if (e.status !== 401) toast(e.message, "err", 6000);
      return false;
    }
  }

  /* ───────── toasty a dialogy ───────── */
  function toast(text, druh, ms) {
    const t = h("div", { class: "toast toast--" + (druh || "info") }, ik(druh === "ok" ? "check" : druh === "err" ? "chyba" : "info"), h("span", { text }));
    $("toasty").append(t);
    setTimeout(() => { t.classList.add("pryc"); setTimeout(() => t.remove(), 400); }, ms || 3800);
  }
  function potvrd(o) {
    return new Promise((res) => {
      const d = $("dlg-potvrd");
      $("dlg-potvrd-t").textContent = o.nadpis;
      $("dlg-potvrd-p").textContent = o.text;
      const ano = $("dlg-potvrd-ano"), ne = $("dlg-potvrd-ne");
      ano.textContent = o.ok || "Potvrdit";
      ano.className = "btn " + (o.nebezpecne ? "btn--err" : "btn--ink");
      const hotovo = (v) => { ano.removeEventListener("click", a); ne.removeEventListener("click", n); d.removeEventListener("close", c); if (d.open) d.close(); res(v); };
      const a = () => hotovo(true), n = () => hotovo(false), c = () => hotovo(false);
      ano.addEventListener("click", a); ne.addEventListener("click", n); d.addEventListener("close", c);
      d.showModal(); ne.focus();
    });
  }

  /* ───────── přihlášení ───────── */
  function ukazPrihlaseni(zprava) {
    document.body.classList.remove("uprava");
    $("app").hidden = true; $("prihlaseni").hidden = false;
    $("bg-foto").hidden = false;
    const fr = $("nahled"); fr.classList.remove("nacteno"); fr.removeAttribute("src"); ramecOk = false;
    const z = $("login-zprava"); z.hidden = !zprava; z.textContent = zprava || "";
    $("l-heslo").value = ""; $("l-kod").value = "";
    setTimeout(() => ($("l-jmeno").value ? $("l-heslo") : $("l-jmeno")).focus(), 50);
  }
  function naplnDuveru() {
    const ul = $("login-trust"); ul.replaceChildren();
    [["zamek", "Šifrované spojení a hesla uložená jen jako otisk"], ["klic", "Dvoufázové ověření kódem z telefonu"], ["stit", "Zámek po opakovaných neúspěšných pokusech"]]
      .forEach(([i, t]) => ul.append(h("li", null, ik(i), t)));
    $("l-oko").append(ik("oko"));
  }
  function zamekOdpocet() {
    const btn = $("login-btn"), err = $("login-chyba");
    clearInterval(S.zamekTimer);
    const krok = () => {
      const zb = Math.max(0, Math.ceil((S.zamekDo - Date.now()) / 1000));
      if (!zb) { clearInterval(S.zamekTimer); btn.disabled = false; err.className = "login__err"; err.textContent = ""; return; }
      btn.disabled = true;
      err.className = "login__err zamek";
      const m = Math.floor(zb / 60), s = zb % 60;
      err.textContent = "Z bezpečnostních důvodů je přihlášení dočasně zamčené. Zkuste to znovu za " + (m ? m + " min " : "") + s + " s.";
    };
    krok(); S.zamekTimer = setInterval(krok, 1000);
  }
  async function prihlas(ev) {
    ev.preventDefault();
    if (Date.now() < S.zamekDo) return;
    const jmeno = $("l-jmeno").value.trim(), heslo = $("l-heslo").value, kod = $("l-kod").value.replace(/\D/g, "");
    const err = $("login-chyba"); err.className = "login__err"; err.textContent = "";
    if (!jmeno || !heslo) { err.textContent = "Vyplňte jméno i heslo."; ($("l-jmeno").value ? $("l-heslo") : $("l-jmeno")).focus(); return; }
    if (kod.length !== 6) { err.textContent = "Ověřovací kód má 6 číslic. Najdete ho v aplikaci Google Authenticator."; $("l-kod").focus(); return; }
    const btn = $("login-btn"); btn.disabled = true; btn.replaceChildren(h("span", { class: "tocka", "aria-hidden": "true" }), "Ověřuji…");
    try {
      const d = await api("/prihlaseni", { metoda: "POST", telo: { jmeno, heslo, kod }, verejne: true });
      S.token = d.token; S.jmeno = d.jmeno || jmeno; S.platiDo = d.plati_do || null;
      try { sessionStorage.setItem(KLIC, JSON.stringify({ t: S.token, j: S.jmeno, p: S.platiDo })); } catch (e) { /* jen v paměti */ }
      $("l-heslo").value = ""; $("l-kod").value = "";
      await spust();
    } catch (e) {
      $("l-kod").value = "";
      if (e.status === 429) {
        S.zamekDo = Date.now() + 1000 * Math.max(30, +((e.data && e.data.za_sekund) || 300));
        zamekOdpocet();
      } else {
        err.textContent = e.status === 401 ? "Jméno, heslo nebo ověřovací kód nesouhlasí." : e.message;
        const k = $("login-karta"); k.classList.remove("tres"); void k.offsetWidth; k.classList.add("tres");
        (e.status === 401 ? $("l-heslo") : $("l-jmeno")).focus();
      }
    } finally {
      btn.replaceChildren("Přihlásit se");
      if (Date.now() >= S.zamekDo) btn.disabled = false;
    }
  }
  function odhlasMistne(zprava) {
    try { sessionStorage.removeItem(KLIC); } catch (e) { /* nic */ }
    S.token = null; S.obsah = null; S.historie = null; S.aktivita = null; S.ja = null; S.zpravy = null;
    S.sez = { rok: null, koncepty: {}, id: 0, tah: null };
    zavriEditor(); document.body.classList.remove("uprava"); S.uprava = false;
    clearInterval(S.casovac);
    ukazPrihlaseni(zprava);
  }
  async function odhlas(zprava) {
    const t = S.token;
    odhlasMistne(zprava || "Byli jste bezpečně odhlášeni.");
    if (t) { try { await fetch(API + "/odhlaseni", { method: "POST", headers: { Authorization: "Bearer " + t }, credentials: "omit", referrerPolicy: "no-referrer" }); } catch (e) { /* relace stejně vyprší */ } }
  }

  /* ───────── nečinnost ───────── */
  function aktivita() { S.posledni = Date.now(); }
  function hlidejNecinnost() {
    clearInterval(S.casovac);
    S.posledni = Date.now();
    const krok = () => {
      if (!S.token) return;
      const zb = NECINNOST - (Date.now() - S.posledni);
      if (S.platiDo && Date.parse(S.platiDo) < Date.now()) { odhlas("Platnost přihlášení skončila. Přihlaste se prosím znovu."); return; }
      if (zb <= 0) { odhlas("Kvůli bezpečnosti jsme vás po 30 minutách nečinnosti odhlásili."); return; }
      const el = $("chip-cas"), m = Math.floor(zb / 60000), s = Math.floor((zb % 60000) / 1000);
      el.textContent = zb < 120000 ? "Odhlášení za " + m + ":" + String(s).padStart(2, "0") : "Odhlášení za " + (m + 1) + " min";
      el.classList.toggle("brzy", zb < 120000);
    };
    krok(); S.casovac = setInterval(krok, 1000);
  }

  /* ───────── start aplikace ───────── */
  /* adresa stránky z katalogu → cesta uvnitř webu (katalog smí mít cestu s kořenem webu i bez něj); cizí adresy pryč */
  function adresa(u) {
    u = String(u == null ? "" : u);
    if (/^[a-z][a-z0-9+.-]*:/i.test(u) || u.indexOf("//") === 0 || u.indexOf("..") >= 0 || u.indexOf("\\") >= 0) return null;
    return u.indexOf(WEB) === 0 ? u : WEB + u.replace(/^\/+/, "");
  }
  async function spust() {
    $("prihlaseni").hidden = true; $("app").hidden = false; $("bg-foto").hidden = true;
    $("chip-jmeno").textContent = S.jmeno; $("chip-av").textContent = inicialy(S.jmeno);
    hlidejNecinnost();
    $("panel").replaceChildren(h("div", { class: "nacitam" }, h("span", { class: "tocka", "aria-hidden": "true" }), "Načítám obsah webu…"));
    const [kat, obs, ja] = await Promise.allSettled([
      fetch("katalog.json", { cache: "no-store", credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)),
      api("/obsah", { verejne: true }),
      api("/ja"),
    ]);
    if (!S.token) return; // mezitím odhlášen (401)
    const k = kat.status === "fulfilled" && kat.value && typeof kat.value === "object" ? kat.value : {};
    let stranky = (Array.isArray(k.stranky) ? k.stranky : []).map((x) => {
      const url = x && adresa(x.url);
      return url ? { url, nazev: String(x.nazev || url), jazyk: x.jazyk === "en" || (!x.jazyk && url.indexOf(WEB + "en/") === 0) ? "en" : "cs" } : null;
    }).filter(Boolean);
    if (!stranky.length) stranky = STRANKY_ZALOHA;
    S.katalog = { stranky, kontakty: Array.isArray(k.kontakty) ? k.kontakty : [], sezony: cast(k.sezony) };
    S.obsah = obs.status === "fulfilled" ? normalizujObsah(obs.value) : prazdnyObsah();
    if (obs.status !== "fulfilled") toast("Obsah webu se nepodařilo načíst: " + obs.reason.message, "err", 6000);
    S.ja = ja.status === "fulfilled" ? ja.value : null;
    if (S.ja && S.ja.plati_do) S.platiDo = S.ja.plati_do;
    if (S.ja && +S.ja.necinnost_s >= 60 && +S.ja.necinnost_s <= 4 * 3600) { NECINNOST = +S.ja.necinnost_s * 1000; S.posledni = Date.now(); }
    vykresliStranky();
    nactiStranku(strankyJazyka()[0] || S.katalog.stranky[0]);
    vykresli();
    nactiHistorii(true);
    nactiZpravy(true);
  }

  /* ───────── náhled webu (iframe, stejný origin) ───────── */
  let ramecOk = false;   // web v rámu už je oživený a obsah si načetl (dřív se do stránky nesmí sahat)
  let posilam = false;
  function ramec() { const f = $("nahled"); try { return f.contentWindow; } catch (e) { return null; } }
  function ramecDoc() { const w = ramec(); try { return w ? w.document : null; } catch (e) { return null; } }
  function ess() { const w = ramec(); try { return w && w.ESSObsah ? w.ESSObsah : null; } catch (e) { return null; } }
  function aplikujNahled() {
    const c = ess(), w = ramec(), doc = ramecDoc();
    if (!c || !doc || !S.obsah || !ramecOk || typeof c.aplikuj !== "function") return;
    try {
      c.aplikuj(S.obsah);
      posilam = true; // sezóny kreslí web sám po události ess:obsah
      doc.dispatchEvent(new w.CustomEvent("ess:obsah", { detail: S.obsah }));
    } catch (e) { /* náhled není kritický */ } finally { posilam = false; }
  }
  function nactiStranku(st) {
    if (!st) return;
    S.stranka = st;
    const f = $("nahled");
    f.classList.remove("nacteno");
    ramecOk = false;
    f.src = st.url;
    document.querySelectorAll(".karta-s").forEach((k) => k.setAttribute("aria-pressed", String(k.dataset.url === st.url)));
    if (S.uprava) nastavListu();
  }
  function ramecPripraven(doc) {
    if (ramecDoc() !== doc) return; // mezitím se načetla jiná stránka
    const poprve = !ramecOk;
    ramecOk = true;
    // web si obsah načítá sám; nejčerstvější stav z administrace vnutíme po něm
    [0, 400, 1600].forEach((ms) => setTimeout(aplikujNahled, ms));
    if (!poprve) return;
    if (S.uprava) pripravRamecProUpravy();
    if (S.tab === "fotky" || S.tab === "prehled") setTimeout(vykresli, 60);
  }
  function poNacteniRamce() {
    const f = $("nahled");
    if (!f.getAttribute("src")) return;
    f.classList.add("nacteno");
    const w = ramec();
    let doc; try { doc = w.document; } catch (e) { return; }
    doc.addEventListener("ess:obsah", () => { if (!posilam) ramecPripraven(doc); });
    const c = ess();
    if (c && c.obsah) ramecPripraven(doc);                // web obsah načetl dřív, než doběhlo načtení rámu
    else setTimeout(() => ramecPripraven(doc), 6000);     // záloha pro stránku bez napojení nebo pomalou službu
    // zabránit odchodu z náhledu jinam a hlídat nečinnost i v rámu
    doc.addEventListener("pointerdown", aktivita, true);
    doc.addEventListener("keydown", aktivita, true);
    doc.addEventListener("click", klikVRamci, true);
    doc.addEventListener("mousemove", najetiVRamci, true);
    doc.addEventListener("scroll", () => skryjZvyrazneni(), true);
    if (S.tab === "fotky" || S.tab === "prehled") vykresli();
  }

  /* ───────── stránky (tmavé skleněné karty, bez ikon) ───────── */
  function strankyJazyka() { return S.katalog.stranky.filter((s) => s.jazyk === S.jazyk); }
  function vykresliStranky() {
    const maEn = S.katalog.stranky.some((s) => s.jazyk === "en");
    const prepni = (j) => {
      if (j === S.jazyk) return;
      const stare = strankyJazyka(), i = S.stranka ? stare.findIndex((x) => x.url === S.stranka.url) : -1;
      S.jazyk = j;
      const nove = strankyJazyka(); // katalog má obě jazykové sady ve stejném pořadí, jinak se bere úvodní stránka
      S.stranka = null; vykresliStranky(); nactiStranku((nove.length === stare.length && i >= 0 && nove[i]) || nove[0]);
      if (S.tab === "fotky" || S.tab === "sezony") vykresli();
    };
    nahrad($("stranky-h"), "Stránka v náhledu", maEn ? h("span", { class: "jaz", role: "group", "aria-label": "Jazyk stránek" },
      h("button", { type: "button", "aria-pressed": String(S.jazyk === "cs"), onclick: () => prepni("cs") }, "Česky"),
      h("button", { type: "button", "aria-pressed": String(S.jazyk === "en"), onclick: () => prepni("en") }, "Anglicky")) : null);
    const box = $("stranky"); box.replaceChildren();
    for (const st of strankyJazyka()) {
      const cesta = st.url.indexOf(WEB) === 0 ? "/" + st.url.slice(WEB.length) : st.url;
      box.append(h("button", {
        class: "karta-s", type: "button", "aria-pressed": String(!!S.stranka && S.stranka.url === st.url), dataset: { url: st.url },
        onclick: () => { nactiStranku(st); if (S.tab === "fotky") vykresli(); },
      },
        h("span", null, h("span", { class: "karta-s__n", text: st.nazev }), h("span", { class: "karta-s__u", text: cesta === "/" ? "Úvodní stránka" : cesta })),
        h("span", { class: "karta-s__ob" }, ik("sipka"))));
    }
  }
  function ukazStranku(url) { // přepne náhled na stránku (i v druhém jazyce), když ji katalog zná
    const st = S.katalog.stranky.find((x) => x.url === url);
    if (!st || (S.stranka && S.stranka.url === st.url)) return;
    if (st.jazyk !== S.jazyk) { S.jazyk = st.jazyk; S.stranka = st; vykresliStranky(); }
    nactiStranku(st);
  }

  /* ───────── vykreslení panelů ───────── */
  function prepniTab(tab, fokus) {
    if (S.uprava && tab !== "texty") ukonciUpravy();
    S.tab = tab;
    document.querySelectorAll(".pill").forEach((p) => p.setAttribute("aria-selected", String(p.dataset.tab === tab)));
    $("panel").setAttribute("aria-labelledby", "tab-" + tab);
    vykresli();
    if (fokus) $("panel").focus({ preventScroll: true });
  }
  function vykresli() {
    vykresliStav();
    const p = $("panel");
    const fn = { prehled: pPrehled, zpravy: pZpravy, kontakty: pKontakty, texty: pTexty, fotky: pFotky, sezony: pSezony, historie: pHistorie, zabezpeceni: pZabezpeceni }[S.tab];
    p.replaceChildren(h("div", { class: "panel" }, fn()));
  }
  function vykresliStav() {
    const o = S.obsah || prazdnyObsah();
    const box = $("hero-stav"); box.replaceChildren(
      h("span", { class: "stav" }, h("i"), "Web je online"),
      h("span", { class: "stav" }, ik("historie"), o.upraveno ? "Naposledy uloženo " + pred(o.upraveno) : "Zatím beze změn"),
      h("span", { class: "stav" }, ik("stit"), "Dvoufázové ověření aktivní"));
    const pocty = { kontakty: Object.keys(o.kontakty).length, texty: Object.keys(o.texty).length, fotky: Object.keys(o.fotky).length, sezony: Object.keys(o.sezony).length, zpravy: noveZpravy().length };
    document.querySelectorAll(".pill").forEach((p) => {
      const n = pocty[p.dataset.tab]; let b = p.querySelector(".pill__n");
      if (n) { if (!b) { b = h("span", { class: "pill__n" }); p.append(b); } b.textContent = n; b.setAttribute("aria-label", p.dataset.tab === "zpravy" ? n + " " + (n === 1 ? "nová" : n <= 4 ? "nové" : "nových") : n + " upraveno"); }
      else if (b) b.remove();
    });
  }
  function hlavicka(t, p, prava) {
    return h("div", { class: "panel__h" }, h("div", null, h("h2", { class: "panel__t", text: t }), p ? h("p", { class: "panel__p", text: p }) : null), prava || null);
  }

  /* PŘEHLED: skutečný obsah (kontakty, fotky stránky, sezóny, přihlášení, změny), žádné ozdobné dlaždice */
  function odkaz(text, fn) {
    return h("button", { class: "odkaz", type: "button", onclick: fn }, text, ik("sipka"));
  }
  function blok(trida, titul, pravy, ...obsah) {
    return h("section", { class: "blok " + (trida || "") }, h("header", { class: "blok__h" }, h("h3", { class: "blok__t", text: titul }), pravy || null), ...obsah);
  }
  function popisZmeny(t) {
    t = String(t || "Úprava obsahu");
    return t
      .replace(/^kontakt (\d{3})(\d{3})(\d{3})(\d{3})\b/, (m, a, b, c, d) => "Telefon +" + a + " " + b + " " + c + " " + d)
      .replace(/^kontakt ([^\s]+@[^\s]+)/, "E-mail $1")
      .replace(/^fotka ([a-z0-9-]+)$/, "Vyměněná fotka ($1)")
      .replace(/^fotka ([a-z0-9-]+) vrácen na původní$/, "Fotka $1 vrácena na původní")
      .replace(/^text ([a-z0-9]+) vrácen na původní$/, "Text vrácen na původní")
      .replace(/^text: /, "Text ")
      .replace(/^obnovena verze/, "Obnovena verze");
  }
  function ruzneFotky(seznam) {
    const videne = new Set(), out = [];
    for (const f of seznam || []) if (f && f.klic && !videne.has(f.klic)) { videne.add(f.klic); out.push(f); }
    return out;
  }
  function pPrehled() {
    const o = S.obsah || prazdnyObsah(), kat = S.katalog.kontakty;
    const nK = Object.keys(o.kontakty).length, nT = Object.keys(o.texty).length, nF = Object.keys(o.fotky).length;
    const hist = Array.isArray(S.historie) ? S.historie : [];

    /* kontakty: nejdůležitější rovnou s aktuální hodnotou */
    const radky = kat.slice(0, 5).map((k) => {
      const zm = o.kontakty[k.id] != null;
      return h("li", { class: "kr" + (zm ? " kr--zm" : "") },
        h("span", { class: "kr__l", text: (k.popisky && k.popisky[0]) || (k.typ === "tel" ? "Telefon" : "E-mail") }),
        h("span", { class: "kr__v", text: zm ? o.kontakty[k.id] : puvodniHodnota(k) }),
        h("button", { class: "kr__u", type: "button", "aria-label": "Upravit " + ((k.popisky && k.popisky[0]) || k.hodnota), onclick: () => { prepniTab("kontakty", true); setTimeout(() => zvyrazniKontakt(k.id), 60); } }, "Upravit"));
    });
    const kontakty = blok("blok--kontakty", "Kontakty", kat.length ? odkaz(sklon(kat.length, "Jeden kontakt", "Všechny " + kat.length + " kontakty", "Všech " + kat.length + " kontaktů"), () => prepniTab("kontakty", true)) : null,
      h("p", { class: "blok__p", text: nK ? "Upraveno " + nK + " z " + kat.length + ". Změna se projeví na všech stránkách najednou, česky i anglicky." : "Telefon a e-maily z celého webu. Změna se projeví na všech stránkách najednou, česky i anglicky." }),
      kat.length ? h("ul", { class: "kr-list" }, radky) : h("p", { class: "ticho", text: "Seznam kontaktů se nepodařilo načíst. Zkuste stránku obnovit." }));

    /* zabezpečení: skutečný stav relace */
    const ja = S.ja || {}, rel = ja.relace || {}, pr = ja.predchozi;
    const zab = blok("blok--zab", "Zabezpečení", odkaz("Podrobnosti", () => prepniTab("zabezpeceni", true)),
      h("dl", { class: "fakta" },
        h("div", null, h("dt", { text: "Dvoufázové ověření" }), h("dd", null, h("span", { class: "znak znak--ok", text: "Zapnuto" }))),
        h("div", null, h("dt", { text: "Toto přihlášení" }), h("dd", { text: rel.vytvoreno ? cas(rel.vytvoreno) + " · " + vlajka(rel.zeme) : "bez údaje" })),
        h("div", null, h("dt", { text: "Předchozí přihlášení" }), h("dd", { text: pr ? cas(pr.cas) + " · " + vlajka(pr.zeme) : "Žádné" })),
        h("div", null, h("dt", { text: "Zařízení" }), h("dd", { text: prohlizec(navigator.userAgent) })),
        h("div", null, h("dt", { text: "Automatické odhlášení" }), h("dd", { text: "po " + Math.round(NECINNOST / 60000) + " min nečinnosti" })),
        h("div", null, h("dt", { text: "Zámek účtu" }), h("dd", { text: "po 5 chybných pokusech" }))));

    /* fotky: skutečné fotky právě zobrazené stránky */
    const c = ess();
    let fotky = [];
    try { fotky = c ? ruzneFotky(c.fotkyNaStrance()).slice(0, 4) : []; } catch (e) { fotky = []; }
    const nazevSt = S.stranka ? S.stranka.nazev : "Domů";
    const foto = blok("blok--foto", "Fotky", odkaz("Vyměnit fotky", () => prepniTab("fotky", true)),
      h("p", { class: "blok__p", text: (nF ? "Vyměněno " + nF + ". " : "") + "Na stránce " + nazevSt + ":" }),
      fotky.length ? h("div", { class: "mini" }, fotky.map((f) => h("button", { class: "mini__f", type: "button", "aria-label": "Vyměnit fotku " + f.klic, onclick: () => { prepniTab("fotky", true); setTimeout(() => otevriFotku(f), 60); } },
        h("img", { src: f.url, alt: "", decoding: "async", referrerpolicy: "no-referrer" }))))
        : h("p", { class: "ticho", text: c ? "Na této stránce nejsou fotky k výměně." : "Náhled stránky se načítá…" }));

    /* texty */
    const upr = Object.keys(o.texty).slice(-2).map((kl) => jenText(o.texty[kl])).filter(Boolean);
    const texty = blok("blok--texty", "Texty", null,
      h("p", { class: "blok__p", text: nT ? "Upraveno " + nT + sklon(nT, " text.", " texty.", " textů.") : "Klikněte na libovolný nadpis nebo odstavec přímo v náhledu webu a přepište ho." }),
      upr.length ? h("ul", { class: "citace" }, upr.map((t) => h("li", { text: "„" + (t.length > 90 ? t.slice(0, 88) + "…" : t) + "“" }))) : null,
      upr.length ? null : h("ol", { class: "kroky" },
        h("li", null, h("b", { text: "Upravit texty na stránce" }), h("span", { text: "Náhled webu se zarámuje a texty půjdou vybrat." })),
        h("li", null, h("b", { text: "Klik na text" }), h("span", { text: "Otevře se editor s původním zněním." })),
        h("li", null, h("b", { text: "Uložit a zveřejnit" }), h("span", { text: "Na webu je změna za pár sekund a jde kdykoli vrátit." }))),
      h("button", { class: "btn btn--ink", type: "button", onclick: () => { prepniTab("texty", true); setTimeout(zacniUpravy, 60); } }, ik("kurzor"), "Upravit texty na stránce"));

    /* sezóny: počet výsledků v každém roce */
    const sezony = blok("blok--sezony", "Sezóny", odkaz("Upravit výsledky", () => prepniTab("sezony", true)),
      h("p", { class: "blok__p", text: "Výsledky a krátký text ke každé sezóně, česky i anglicky." }),
      h("ul", { class: "kr-list" }, rokySezon().map((rok) => {
        const s = platnaSezona(rok), zm = !!ulozenaSezona(rok);
        return h("li", { class: "kr" + (zm ? " kr--zm" : "") },
          h("span", { class: "kr__l", text: "Sezóna " + rok }),
          h("span", { class: "kr__v", text: s.radky.length ? s.radky.length + " " + sklon(s.radky.length, "výsledek", "výsledky", "výsledků") : "připravená" }),
          h("button", { class: "kr__u", type: "button", "aria-label": "Upravit sezónu " + rok, onclick: () => { S.sez.rok = rok; prepniTab("sezony", true); } }, "Upravit"));
      })));

    /* poslední změny */
    const zmeny = blok("blok--zmeny", "Poslední změny", hist.length ? odkaz("Celá historie", () => prepniTab("historie", true)) : null,
      S.historie == null ? h("p", { class: "ticho", text: "Načítám…" })
        : hist.length ? h("ol", { class: "zm" }, hist.slice(0, 5).map((v) => h("li", null,
            h("span", { class: "zm__t", text: popisZmeny(v.popis && v.popis[0]) }),
            h("span", { class: "zm__k", text: (v.jmeno || "neznámý") + " · " + pred(v.cas) }))))
        : h("p", { class: "ticho", text: "Zatím žádné změny. Každá uložená úprava se tu objeví i s autorem a časem a půjde vrátit." }));

    /* zprávy z formulářů: jen když nějaké jsou, ať přehled nezabírá prázdný blok */
    const zpr = (S.zpravy || []).filter((z) => !z.spam);
    const nov = noveZpravy();
    const zpravy = zpr.length ? blok("blok--zpravy", "Zprávy z webu", odkaz(nov.length ? "Nové: " + nov.length : "Všechny zprávy", () => prepniTab("zpravy", true)),
      h("ol", { class: "zm" }, zpr.slice(0, 3).map((z) => h("li", null,
        h("span", { class: "zm__t", text: z.jmeno + (z.tema ? " · " + z.tema : "") }),
        h("span", { class: "zm__k", text: (z.stav === "nova" ? "Nová · " : "") + pred(z.cas) }))))) : null;

    return [
      hlavicka("Přehled", null),
      h("div", { class: "pr" }, zpravy, kontakty, zab, foto, texty, sezony, zmeny),
    ];
  }

  /* ZPRÁVY z kontaktních formulářů (20. 10. 2026). Text zprávy jen jako textContent (h → createTextNode), nikdy HTML. */
  function noveZpravy() { return (S.zpravy || []).filter((z) => z.stav === "nova" && !z.spam); }
  async function nactiZpravy(tiche) {
    try { const d = await api("/zpravy"); S.zpravy = d && Array.isArray(d.polozky) ? d.polozky : []; S.zpravyKomu = (d && d.komu) || ""; }
    catch (e) { if (!tiche && e.status !== 401) toast(e.message, "err"); S.zpravy = S.zpravy || []; }
    if (S.tab === "zpravy" || S.tab === "prehled") vykresli(); else vykresliStav();
  }
  async function zmenZpravu(z, zmena) {
    try {
      await api("/zpravy/stav", { metoda: "POST", telo: Object.assign({ id: z.id, stav: z.stav }, zmena) });
      Object.assign(z, zmena); vykresli();
    } catch (e) { if (e.status !== 401) toast(e.message, "err"); }
  }
  async function smazZpravu(z) {
    const ok = await potvrd({ nadpis: "Smazat zprávu od " + z.jmeno + "?", text: "Zpráva zmizí z administrace natrvalo. Kopie v e-mailové schránce zůstane.", ok: "Smazat zprávu", nebezpecne: true, ikona: "kos" });
    if (!ok) return;
    try {
      await api("/zpravy/smazat", { metoda: "POST", telo: { id: z.id } });
      S.zpravy = S.zpravy.filter((x) => x.id !== z.id); toast("Zpráva smazána.", "ok"); vykresli();
    } catch (e) { if (e.status !== 401) toast(e.message, "err"); }
  }
  function kartaZpravy(z) {
    const nova = z.stav === "nova" && !z.spam;
    const predmet = "Re: " + (z.tema || "Váš dotaz z webu Emma Sophia Stables");
    return h("li", { class: "zpr" + (nova ? " zpr--nova" : "") },
      h("div", { class: "zpr__h" },
        h("b", { text: z.jmeno }),
        nova ? h("span", { class: "typ typ--b", text: "Nová" }) : null,
        z.spam ? h("span", { class: "typ typ--mut", text: "Spam" }) : null,
        z.mail === "chyba" ? h("span", { class: "typ typ--err", text: "E-mail se neodeslal" }) : null),
      h("p", { class: "zpr__m" },
        h("span", { text: cas(z.cas) }),
        z.tema ? h("span", { text: z.tema }) : null,
        z.stranka ? h("span", { text: "Stránka: " + nazevStranky(z.stranka) }) : null),
      h("p", { class: "zpr__k" },
        h("a", { href: "mailto:" + z.email + "?subject=" + encodeURIComponent(predmet) }, ik("mail"), z.email),
        z.telefon ? h("a", { href: "tel:" + z.telefon.replace(/[^\d+]/g, "") }, ik("telefon"), z.telefon) : null),
      h("p", { class: "zpr__t", text: z.zprava }),
      h("div", { class: "zpr__a" },
        h("a", { class: "btn btn--ink", href: "mailto:" + z.email + "?subject=" + encodeURIComponent(predmet), onclick: () => { if (nova) zmenZpravu(z, { stav: "prectena" }); } }, ik("mail"), "Odpovědět e-mailem"),
        z.spam ? h("button", { class: "btn btn--o", type: "button", onclick: () => zmenZpravu(z, { spam: 0, stav: "nova" }) }, ik("check"), "Není to spam")
          : h("button", { class: "btn btn--o", type: "button", onclick: () => zmenZpravu(z, { stav: nova ? "prectena" : "nova" }) }, ik("check"), nova ? "Označit jako vyřízenou" : "Označit jako novou"),
        h("button", { class: "btn btn--o", type: "button", onclick: () => smazZpravu(z) }, ik("kos"), "Smazat")));
  }
  function pZpravy() {
    const kam = S.zpravyKomu ? "Každá zpráva zároveň přišla e-mailem na " + S.zpravyKomu + ". " : "";
    const hl = hlavicka("Zprávy z webu", kam + "Po 12 měsících se zprávy samy smažou.",
      h("button", { class: "btn btn--o", type: "button", onclick: () => { S.zpravy = null; vykresli(); } }, ik("obnovit"), "Načíst znovu"));
    if (!S.zpravy) { nactiZpravy(); return [hl, h("div", { class: "nacitam" }, h("span", { class: "tocka" }), "Načítám zprávy…")]; }
    const ok = S.zpravy.filter((z) => !z.spam), spam = S.zpravy.filter((z) => z.spam);
    return [
      hl,
      ok.length ? h("ol", { class: "zpr-list" }, ok.map(kartaZpravy))
        : h("div", { class: "prazdne" }, ik("mail"), h("b", { text: "Zatím žádné zprávy" }), "Zprávy z kontaktních formulářů na webu se objeví tady."),
      spam.length ? h("details", { class: "zpr-spam" }, h("summary", { text: "Zachycený spam (" + spam.length + ")" }),
        h("p", { class: "ticho", text: "Zprávy s mnoha odkazy. E-mailem se neposílají, zkontrolujte je občas a smažte." }),
        h("ol", { class: "zpr-list" }, spam.map(kartaZpravy))) : null,
    ];
  }

  /* KONTAKTY */
  const RE_TEL = /^\+?[0-9][0-9 ]{7,22}$/;
  const RE_MAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
  function overKontakt(typ, v) {
    v = String(v || "").trim();
    if (!v) return "Vyplňte hodnotu, nebo použijte „Vrátit původní“.";
    if (typ === "tel") { const c = v.replace(/\D/g, ""); if (!RE_TEL.test(v) || c.length < 9 || c.length > 15) return "Telefon zadejte jako +420 123 456 789 (jen číslice, mezery a + na začátku)."; }
    else if (!RE_MAIL.test(v)) return "Zadejte platný e-mail, např. staje@esstables.com.";
    return "";
  }
  function nazevStranky(u) {
    const url = adresa(u);
    const st = S.katalog.stranky.find((x) => x.url === url);
    return st ? st.nazev + (st.jazyk === "en" ? " (EN)" : "") : String(u);
  }
  function pKontakty() {
    const o = S.obsah || prazdnyObsah();
    const kat = S.katalog.kontakty;
    const hledat = h("input", { type: "search", placeholder: "Hledat kontakt…", "aria-label": "Hledat kontakt", value: S.hledat || "" });
    const vysledek = h("div");
    const kresli = () => {
      const q = (S.hledat || "").toLowerCase().trim();
      const shoda = (k) => !q || [k.hodnota, o.kontakty[k.id] || "", ...(k.popisky || [])].join(" ").toLowerCase().includes(q);
      const skup = [["tel", "Telefony"], ["mail", "E-maily"]].map(([typ, n]) => [n, kat.filter((k) => k.typ === typ && shoda(k))]).filter(([, l]) => l.length);
      vysledek.replaceChildren(...(skup.length ? skup.map(([n, l]) => h("div", { class: "skupina" }, h("h3", { class: "skupina__t" }, n, h("span", { text: String(l.length) })), h("div", { class: "kontakty" }, l.map(radekKontaktu)))) :
        [h("div", { class: "prazdne" }, h("b", { text: kat.length ? "Nic nenalezeno" : "Seznam kontaktů se nepodařilo načíst" }), kat.length ? "Zkuste jiné hledání." : "Zkuste stránku obnovit.")]));
    };
    hledat.addEventListener("input", () => { S.hledat = hledat.value; kresli(); });
    kresli();
    const nK = Object.keys(o.kontakty).length;
    return [
      hlavicka("Kontakty", "Telefon a e-maily se mění na všech stránkách najednou, česky i anglicky, v textu i v odkazech pro volání a psaní.", kat.length > 4 ? h("label", { class: "hledat" }, ik("hledat"), hledat) : null),
      nK ? h("p", { class: "panel__p", text: "Upraveno " + nK + " " + cisloKontaktu(nK) + " z " + kat.length + "." }) : null,
      vysledek,
    ];
  }
  /* původní hodnota kontaktu: e-mail vždy z id (katalog může mít u odkazu přilepený text), telefon z katalogu, když sedí číslice */
  function puvodniHodnota(k) {
    if (k.typ === "mail") return String(k.id).slice(5);
    const c = String(k.id).slice(4), v = String(k.hodnota || "").trim(), d = v.replace(/\D/g, "");
    if (v && (d === c || "420" + d === c) && /^\+?[0-9 ]+$/.test(v)) return v;
    return c.length === 12 && c.indexOf("420") === 0 ? "+420 " + c.slice(3, 6) + " " + c.slice(6, 9) + " " + c.slice(9) : "+" + c;
  }
  function radekKontaktu(kat) {
    const k = Object.assign({}, kat, { hodnota: puvodniHodnota(kat) });
    const o = S.obsah || prazdnyObsah();
    const zmena = Object.prototype.hasOwnProperty.call(o.kontakty, k.id);
    const akt = zmena ? o.kontakty[k.id] : k.hodnota;
    const vstup = h("input", { class: "kontakt__in", type: k.typ === "tel" ? "tel" : "email", value: akt, "aria-label": (k.typ === "tel" ? "Telefon " : "E-mail ") + k.hodnota, autocomplete: "off", spellcheck: "false", maxlength: "120", inputmode: k.typ === "tel" ? "tel" : "email" });
    const btn = h("button", { class: "kontakt__ulozit", type: "button", disabled: true }, ik("check"), "Uložit");
    const pozn = h("span");
    const zprava = () => {
      const v = vstup.value.trim(), ch = overKontakt(k.typ, v);
      vstup.setAttribute("aria-invalid", String(!!ch && v !== akt));
      btn.disabled = !!ch || v === akt;
      pozn.replaceChildren(ch && v !== akt ? h("span", { class: "chyba", text: ch }) : zmena ? h("span", { class: "kontakt__puv" }, "Původně ", h("s", { text: k.hodnota })) : h("span", { text: "Původní hodnota" }));
    };
    vstup.addEventListener("input", zprava);
    vstup.addEventListener("keydown", (e) => { if (e.key === "Enter" && !btn.disabled) btn.click(); if (e.key === "Escape") { vstup.value = akt; zprava(); } });
    btn.addEventListener("click", async () => {
      const v = vstup.value.trim();
      if (overKontakt(k.typ, v)) return;
      btn.disabled = true;
      const ok = await uloz({ kontakty: { [k.id]: v === k.hodnota ? null : v } }, "Kontakt uložen. Na webu už platí " + v + ".");
      if (ok) vykresli(); else zprava();
    });
    zprava();
    const vratit = zmena ? h("button", { class: "btn btn--txt", type: "button", onclick: async () => {
      if (await potvrd({ nadpis: "Vrátit původní kontakt?", text: "Na webu bude znovu " + k.hodnota + ".", ok: "Vrátit původní" })) { if (await uloz({ kontakty: { [k.id]: null } }, "Vráceno na " + k.hodnota + ".")) vykresli(); }
    } }, ik("zpet"), "Vrátit původní") : null;
    const popis = (k.popisky && k.popisky.filter(Boolean)) || [];
    const stranky = [...new Set((k.stranky || []).map(nazevStranky))];
    return h("article", { class: "kontakt" + (zmena ? " zmeneno" : ""), id: "k-" + k.id.replace(/[^a-z0-9]/gi, "-") },
      h("div", { class: "kontakt__h" },
        h("div", { class: "kontakt__l" }, h("b", { text: popis[0] || (k.typ === "tel" ? "Telefon" : "E-mail") }), h("small", { text: popis.slice(1).join(" · ") || (stranky.length ? "Na " + stranky.length + (stranky.length === 1 ? " stránce" : " stránkách") : "") })),
        zmena ? h("span", { class: "stitek stitek--z", text: "Upraveno" }) : null),
      h("div", { class: "kontakt__r" }, vstup, btn),
      h("div", { class: "kontakt__pozn" }, pozn, vratit),
      stranky.length ? h("div", { class: "stitky", "aria-label": "Stránky s tímto kontaktem" }, stranky.slice(0, 10).map((n) => h("span", { class: "stitek", text: n })), stranky.length > 10 ? h("span", { class: "stitek", text: "a další " + (stranky.length - 10) }) : null) : null);
  }
  function zvyrazniKontakt(id) {
    prepniTab("kontakty");
    requestAnimationFrame(() => {
      const el = document.getElementById("k-" + String(id).replace(/[^a-z0-9]/gi, "-"));
      if (!el) return;
      el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
      el.classList.add("zvyrazni"); const i = el.querySelector("input"); if (i) i.focus({ preventScroll: true });
      setTimeout(() => el.classList.remove("zvyrazni"), 3200);
    });
  }

  /* TEXTY */
  function pTexty() {
    const o = S.obsah || prazdnyObsah();
    const klice = Object.keys(o.texty);
    return [
      hlavicka("Texty", "Upravujte nadpisy a odstavce přímo na stránce. Kliknete na text, napíšete nový a uložíte."),
      h("div", { class: "vyzva" },
        h("div", null, h("h3", { text: "Upravit texty přímo na webu" }), h("p", { text: "Otevře se stránka „" + (S.stranka ? S.stranka.nazev : "Domů") + "“. Najeďte myší na text, klikněte a upravte ho. Stránku a jazyk přepnete v kartách nahoře. Výsledky sezón se upravují v záložce Sezóny." })),
        h("button", { class: "btn btn--z", type: "button", onclick: zacniUpravy }, ik("kurzor"), "Začít upravovat")),
      h("h3", { class: "skupina__t" }, "Upravené texty", h("span", { text: String(klice.length) })),
      klice.length ? h("ul", { class: "seznam" }, klice.map((kl) => h("li", null,
        h("span", { class: "seznam__t" }, h("b", { text: jenText(o.texty[kl]) || "(prázdný text)" })),
        h("button", { class: "btn btn--txt", type: "button", onclick: async () => {
          if (await potvrd({ nadpis: "Vrátit původní text?", text: "Na webu se znovu zobrazí původní znění tohoto textu.", ok: "Vrátit původní" })) { if (await uloz({ texty: { [kl]: null } }, "Text vrácen do původní podoby.")) vykresli(); }
        } }, ik("zpet"), "Vrátit")))) :
        h("div", { class: "prazdne" }, h("b", { text: "Zatím žádné upravené texty" }), "Klikněte na „Začít upravovat“ a vyberte text na stránce."),
    ];
  }

  /* režim úprav v náhledu */
  let zvyr = null;
  function nastavListu() {
    const t = $("edit-bar-t"); t.replaceChildren(h("b", { text: S.stranka ? S.stranka.nazev : "Web" }), " · Klikněte na text nebo fotku, kterou chcete změnit.");
  }
  function zacniUpravy() {
    if (!ess() || !ramecOk) { toast("Náhled stránky se ještě načítá. Zkuste to za okamžik.", "info"); return; }
    S.uprava = true; document.body.classList.add("uprava"); nastavListu();
    window.scrollTo({ top: 0 });
    pripravRamecProUpravy();
    toast("Režim úprav: klikněte na text nebo fotku na stránce.", "info");
  }
  function ukonciUpravy() {
    S.uprava = false; zavriEditor(); document.body.classList.remove("uprava"); skryjZvyrazneni();
    const doc = ramecDoc(); if (doc) doc.documentElement.classList.remove("ess-admin-uprava");
  }
  function pripravRamecProUpravy() {
    const doc = ramecDoc(); if (!doc || !doc.body) return;
    doc.documentElement.classList.add("ess-admin-uprava");
    let z = doc.getElementById("ess-admin-zvyr");
    if (!z) { // rámeček kolem prvku pod kurzorem; styly přes CSSOM, do stránky se nevkládá žádný <style>
      z = doc.createElement("div"); z.id = "ess-admin-zvyr"; z.setAttribute("aria-hidden", "true"); z.setAttribute("data-bez-uprav", "");
      styl(z, { position: "fixed", "z-index": "2147483646", "pointer-events": "none", border: "2px solid #C9A662", "border-radius": "8px", background: "rgba(201,166,98,.14)", "box-shadow": "0 0 0 1px rgba(42,37,32,.45)", transition: "all .12s ease", display: "none" });
      const s = doc.createElement("span");
      styl(s, { position: "absolute", left: "-2px", bottom: "100%", "margin-bottom": "6px", background: "#2A2520", color: "#FAF6EE", font: "500 12px/1 system-ui,sans-serif", "letter-spacing": ".04em", padding: "6px 10px", "border-radius": "8px", "white-space": "nowrap" });
      z.append(s); doc.body.append(z);
    }
    zvyr = z;
  }
  function cilVRamci(t) {
    const c = ess(); if (!c || !t) return null;
    let a = t.closest ? t.closest('a[href^="tel:"],a[href^="mailto:"]') : null;
    if (a) {
      let id = null;
      try { const k = (c.kontaktyNaStrance() || []).find((x) => x.el === a || (x.el && x.el.contains && x.el.contains(t))); if (k) id = k.id; } catch (e) { /* nic */ }
      if (id) return { druh: "kontakt", el: a, id };
    }
    try {
      const el = c.editovatelny(t);
      if (el) return { druh: "text", el };
      const fot = fotkyRamce().filter((f) => f.el && (f.el === t || (f.el.contains && f.el.contains(t))));
      if (fot.length) {
        fot.sort((x, y) => (x.el.contains(y.el) ? 1 : y.el.contains(x.el) ? -1 : 0)); // nejhlubší prvek první
        return { druh: "fotka", el: fot[0].el, f: fot[0] };
      }
    } catch (e) { /* nic */ }
    return null;
  }
  let fotkyCache = { doc: null, t: 0, l: [] };
  function fotkyRamce() {
    const c = ess(), doc = ramecDoc(); if (!c || !doc) return [];
    if (fotkyCache.doc !== doc || Date.now() - fotkyCache.t > 2000) {
      let l = []; try { l = c.fotkyNaStrance() || []; } catch (e) { l = []; }
      fotkyCache = { doc, t: Date.now(), l };
    }
    return fotkyCache.l;
  }
  function najetiVRamci(e) {
    if (!S.uprava || !zvyr) return;
    const c = cilVRamci(e.target);
    if (!c) { skryjZvyrazneni(); return; }
    const r = c.el.getBoundingClientRect();
    styl(zvyr, { display: "block", left: (r.left - 6) + "px", top: (r.top - 6) + "px", width: (r.width + 12) + "px", height: (r.height + 12) + "px" });
    zvyr.firstChild.textContent = c.druh === "kontakt" ? "Upravit kontakt" : c.druh === "fotka" ? "Vyměnit fotku" : "Upravit text";
  }
  function skryjZvyrazneni() { if (zvyr) zvyr.style.setProperty("display", "none"); }
  function klikVRamci(e) {
    aktivita();
    if (!S.uprava) return;
    e.preventDefault(); e.stopPropagation();
    const c = cilVRamci(e.target);
    if (!c) return;
    if (c.druh === "kontakt") { ukonciUpravy(); zvyrazniKontakt(c.id); return; }
    if (c.druh === "fotka") { otevriFotku(c.f); return; }
    otevriEditor(c.el);
  }

  /* editor textu */
  function otevriEditor(el) {
    const c = ess(); if (!c) return;
    const klic = c.klicTextu(el); if (!klic) { toast("Tento text upravit nejde.", "info"); return; }
    S.vybrany = { el, klic, puvodni: cisteHtml(c.puvodniHtml(el)) };
    $("editor-puv").replaceChildren(sanitizuj(S.vybrany.puvodni));
    const pole = $("editor-pole"); pole.replaceChildren(sanitizuj(c.aktualniHtml ? c.aktualniHtml(el) : S.vybrany.puvodni));
    $("editor-vratit").hidden = !Object.prototype.hasOwnProperty.call((S.obsah || {}).texty || {}, klic);
    pocitejZnaky();
    const ed = $("editor"); ed.classList.add("open"); ed.setAttribute("aria-hidden", "false");
    setTimeout(() => { pole.focus(); const r = document.createRange(); r.selectNodeContents(pole); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }, 300);
  }
  function zavriEditor() { const ed = $("editor"); ed.classList.remove("open"); ed.setAttribute("aria-hidden", "true"); S.vybrany = null; }
  function pocitejZnaky() { const n = ($("editor-pole").textContent || "").length; $("editor-pocet").textContent = n + " " + sklon(n, "znak", "znaky", "znaků"); }
  async function ulozText() {
    if (!S.vybrany) return;
    const html = serializuj(sanitizuj($("editor-pole"))).replace(/(<br>)+$/, "").trim();
    if (!jenText(html)) { toast("Text nemůže být prázdný. Pro vrácení použijte „Vrátit původní text“.", "err"); return; }
    if (html.length > 5000) { toast("Text je příliš dlouhý (nejvýš 5 000 znaků).", "err"); return; }
    const hodnota = html === S.vybrany.puvodni ? null : html;
    const b = $("editor-ulozit"); b.disabled = true;
    if (await uloz({ texty: { [S.vybrany.klic]: hodnota } }, hodnota ? "Text uložen a zveřejněn." : "Text je zase původní.")) { zavriEditor(); if (!S.uprava) vykresli(); }
    b.disabled = false;
  }
  async function vratText() {
    if (!S.vybrany) return;
    if (await uloz({ texty: { [S.vybrany.klic]: null } }, "Text vrácen do původní podoby.")) zavriEditor();
  }

  /* FOTKY */
  function pFotky() {
    const c = ess(), o = S.obsah || prazdnyObsah();
    let fotky = null;
    if (c && typeof c.fotkyNaStrance === "function") { try { fotky = c.fotkyNaStrance() || []; } catch (e) { fotky = []; } }
    const unik = ruzneFotky(fotky);
    const mrizka = fotky === null
      ? h("div", { class: "fotky" }, Array.from({ length: 8 }, () => h("div", { class: "fotka skeleton" })))
      : unik.length ? h("div", { class: "fotky" }, unik.map((f) => {
        const zm = Object.prototype.hasOwnProperty.call(o.fotky, f.klic);
        const src = zm && c.urlSouboru ? c.urlSouboru(o.fotky[f.klic]) : f.puvodni || f.url;
        return h("button", { class: "fotka", type: "button", "aria-label": "Vyměnit fotku " + f.klic, onclick: () => otevriFotku(f) },
          h("img", { src, alt: "", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" }),
          zm ? h("span", { class: "fotka__zn", text: "Vyměněno" }) : null,
          h("span", { class: "fotka__pas" }, h("span", { text: f.klic }), h("i", null, ik("nahrat"))));
      })) : h("div", { class: "prazdne" }, h("b", { text: "Na této stránce nejsou žádné fotky k výměně" }), "Vyberte jinou stránku v kartách nahoře.");
    return [
      hlavicka("Fotky", "Fotky stránky „" + (S.stranka ? S.stranka.nazev : "") + "“. Klikněte na fotku a nahrajte novou. Vymění se na všech místech webu, kde je použitá.",
        h("button", { class: "btn btn--o", type: "button", onclick: () => { prepniTab("texty"); zacniUpravy(); } }, ik("kurzor"), "Vybrat přímo na stránce")),
      mrizka,
    ];
  }
  function otevriFotku(f) {
    const c = ess(), o = S.obsah || prazdnyObsah();
    S.fotka = f; S.novaFotka = null;
    const zm = Object.prototype.hasOwnProperty.call(o.fotky, f.klic);
    const src = zm && c && c.urlSouboru ? c.urlSouboru(o.fotky[f.klic]) : f.puvodni || f.url;
    $("dlg-fotka-t").textContent = "Vyměnit fotku";
    $("dlg-fotka-p").textContent = "Vyberte novou fotku (JPG, PNG nebo WebP). Před nahráním ji zmenšíme na 2 400 px.";
    $("dlg-fotka-ted").replaceChildren(h("img", { src, alt: "Současná fotka", referrerpolicy: "no-referrer" }));
    const nova = $("dlg-fotka-nova"); nova.className = "ram ram--prazdny"; nova.replaceChildren("Zatím nevybráno. Klikněte na „Vybrat fotku“.");
    $("dlg-fotka-ulozit").disabled = true;
    $("dlg-fotka-vratit").hidden = !zm;
    $("dlg-fotka-prubeh").hidden = true;
    $("dlg-fotka-soubor").value = "";
    $("dlg-fotka").showModal();
    $("dlg-fotka-vybrat").focus();
  }
  async function zmensi(soubor) {
    if (!/^image\/(jpeg|png|webp)$/.test(soubor.type)) throw new Error("Podporované jsou jen fotky JPG, PNG a WebP.");
    if (soubor.size > 40 * 1024 * 1024) throw new Error("Soubor je příliš velký (nejvýš 40 MB).");
    let bmp;
    try { bmp = await createImageBitmap(soubor); } catch (e) { throw new Error("Soubor se nepodařilo přečíst jako fotku."); }
    const k = Math.min(1, MAX_FOTKA / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * k), v = Math.round(bmp.height * k);
    const cv = document.createElement("canvas"); cv.width = w; cv.height = v;
    const ctx = cv.getContext("2d"); ctx.imageSmoothingQuality = "high"; ctx.drawImage(bmp, 0, 0, w, v);
    if (bmp.close) bmp.close();
    const blob = await new Promise((r) => cv.toBlob(r, "image/jpeg", 0.86));
    if (!blob) throw new Error("Fotku se nepodařilo zpracovat.");
    if (blob.size > 8 * 1024 * 1024) throw new Error("Ani po zmenšení se fotka nevešla do 8 MB.");
    return { blob, w, v };
  }
  async function vybranaFotka() {
    const s = $("dlg-fotka-soubor").files[0]; if (!s) return;
    const nova = $("dlg-fotka-nova"); nova.className = "ram"; nova.replaceChildren(h("span", { class: "tocka", "aria-hidden": "true" }));
    try {
      const z = await zmensi(s);
      S.novaFotka = z;
      if (S.novaUrl) URL.revokeObjectURL(S.novaUrl);
      S.novaUrl = URL.createObjectURL(z.blob);
      nova.replaceChildren(h("img", { src: S.novaUrl, alt: "Nová fotka" }));
      $("dlg-fotka-p").textContent = "Nová fotka " + z.w + " × " + z.v + " px, " + Math.round(z.blob.size / 1024) + " kB. Po nahrání se na webu vymění na všech místech.";
      $("dlg-fotka-ulozit").disabled = false; $("dlg-fotka-ulozit").focus();
    } catch (e) {
      S.novaFotka = null; nova.className = "ram ram--prazdny"; nova.replaceChildren(e.message || "Fotku se nepodařilo načíst.");
      $("dlg-fotka-ulozit").disabled = true;
    }
  }
  async function nahrajFotku() {
    if (!S.novaFotka || !S.fotka) return;
    const b = $("dlg-fotka-ulozit"); b.disabled = true;
    const pr = $("dlg-fotka-prubeh"), pi = $("dlg-fotka-prubeh-i"); pr.hidden = false; pi.style.width = "35%";
    try {
      const r = await api("/soubor", { metoda: "POST", telo: S.novaFotka.blob, typ: "image/jpeg" });
      pi.style.width = "80%";
      if (!r || !/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(r.id || "")) throw new Error("Server vrátil neplatnou odpověď.");
      if (await uloz({ fotky: { [S.fotka.klic]: r.id } }, "Fotka vyměněna a zveřejněna.")) {
        pi.style.width = "100%";
        fotkyCache.t = 0;
        $("dlg-fotka").close();
        if (S.tab === "fotky" && !S.uprava) vykresli();
      }
    } catch (e) { if (e.status !== 401) toast(e.message, "err", 6000); }
    finally { b.disabled = !S.novaFotka; setTimeout(() => { pr.hidden = true; pi.style.width = "0"; }, 500); }
  }
  async function vratFotku() {
    if (!S.fotka) return;
    if (await uloz({ fotky: { [S.fotka.klic]: null } }, "Fotka vrácena na původní.")) { fotkyCache.t = 0; $("dlg-fotka").close(); if (S.tab === "fotky" && !S.uprava) vykresli(); }
  }
  function ukazFotkuNaStrance() {
    if (!S.fotka || !S.fotka.el) return;
    $("dlg-fotka").close();
    try { S.fotka.el.scrollIntoView({ block: "center" }); } catch (e) { /* nic */ }
    if (!S.uprava) { prepniTab("texty"); zacniUpravy(); }
  }

  /* SEZÓNY: výsledky (řádky česky a anglicky) a krátké info ke každé sezóně. Výchozí stav je v katalog.json (klíč
     sezony), uložený stav v obsahu služby; rozpracované úpravy se drží v paměti po rocích, dokud se neuloží. */
  const naRadek = (s) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/ {2,}/g, " ").trim();
  const naOdstavce = (s) => String(s == null ? "" : s).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").replace(/ {2,}/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  function cistaSezona(s) {
    s = cast(s);
    const info = cast(s.info), radky = Array.isArray(s.radky) ? s.radky : [];
    return { info: { cs: naOdstavce(info.cs), en: naOdstavce(info.en) }, radky: radky.map((r) => ({ cs: naRadek(r && r.cs), en: naRadek(r && r.en) })).filter((r) => r.cs || r.en) };
  }
  const otisk = (s) => JSON.stringify(cistaSezona(s));
  function vychoziSezona(rok) { return cistaSezona(S.katalog && S.katalog.sezony ? S.katalog.sezony[rok] : null); }
  function ulozenaSezona(rok) { const o = S.obsah || prazdnyObsah(); return Object.prototype.hasOwnProperty.call(o.sezony, rok) ? cistaSezona(o.sezony[rok]) : null; }
  function platnaSezona(rok) { return ulozenaSezona(rok) || vychoziSezona(rok); }
  function rokySezon() {
    const r = new Set(["2027", "2026", "2025", "2024", "2023"]);
    Object.keys((S.katalog && S.katalog.sezony) || {}).concat(Object.keys((S.obsah && S.obsah.sezony) || {})).forEach((k) => { if (ROK_RE.test(k)) r.add(k); });
    return [...r].sort().reverse();
  }
  function koncept(rok) {
    let k = S.sez.koncepty[rok];
    if (k && otisk(k) === k.zaklad && k.zaklad !== otisk(platnaSezona(rok))) k = null; // nic rozpracovaného a na webu je mezitím jiný stav
    if (!k) {
      const p = platnaSezona(rok);
      k = S.sez.koncepty[rok] = { info: { cs: p.info.cs, en: p.info.en }, radky: p.radky.map((r) => ({ cs: r.cs, en: r.en, id: ++S.sez.id })), zaklad: JSON.stringify(p) };
    }
    return k;
  }
  function jeZmena(rok) { const k = S.sez.koncepty[rok]; return !!k && otisk(k) !== otisk(platnaSezona(rok)); }
  function strankaSezony(rok) {
    const re = new RegExp("/(sezona|season)-" + rok + "/$");
    const st = S.katalog.stranky.find((s) => s.jazyk === S.jazyk && re.test(s.url)) || S.katalog.stranky.find((s) => re.test(s.url));
    if (st || !Object.prototype.hasOwnProperty.call(S.katalog.sezony, rok)) return st;
    // připravená sezóna: sestavení její stránku má, ale katalog ji mezi stránkami neuvádí (je skrytá, dokud nemá
    // výsledek). Adresa se odvodí ze sousední sezóny, ať náhled při úpravách neukazuje jiný rok.
    const jeSezona = (s) => /\/(sezona|season)-20\d\d\/$/.test(s.url);
    const vzor = S.katalog.stranky.find((s) => s.jazyk === S.jazyk && jeSezona(s)) || S.katalog.stranky.find(jeSezona);
    return vzor ? { url: vzor.url.replace(/-20\d\d\/$/, "-" + rok + "/"), nazev: vzor.nazev.replace(/20\d\d/, rok), jazyk: vzor.jazyk, mimoKatalog: true } : undefined;
  }
  function chybySezony(k) { // → {radky: Map(id → hláška), info: {cs, en}, pocet}
    const radky = new Map(), info = {};
    const znacky = (t) => /[<>]/.test(t);
    k.radky.forEach((r) => {
      const cs = naRadek(r.cs), en = naRadek(r.en);
      if (!cs && en) radky.set(r.id, { text: "Doplňte český text. Řádek jen anglicky uložit nejde.", cs: true, en: false });
      else if (znacky(cs) || znacky(en)) radky.set(r.id, { text: "Řádek smí obsahovat jen čistý text, bez znaků < a >.", cs: znacky(cs), en: znacky(en) });
      else if (cs.length > MAX_RADEK || en.length > MAX_RADEK) radky.set(r.id, { text: "Řádek může mít nejvýš " + MAX_RADEK + " znaků.", cs: cs.length > MAX_RADEK, en: en.length > MAX_RADEK });
    });
    ["cs", "en"].forEach((j) => {
      const t = naOdstavce(k.info[j]);
      if (znacky(t)) info[j] = "Jen čistý text, bez znaků < a >.";
      else if (t.length > MAX_INFO) info[j] = "Nejvýš " + MAX_INFO + " znaků.";
    });
    return { radky, info, pocet: radky.size + Object.keys(info).length };
  }
  function pSezony() {
    const roky = rokySezon();
    if (roky.indexOf(S.sez.rok) < 0) S.sez.rok = roky.find((r) => platnaSezona(r).radky.length) || roky[0];
    const stSez = strankaSezony(S.sez.rok);
    if (stSez && stSez.mimoKatalog) { if (!S.stranka || S.stranka.url !== stSez.url) nactiStranku(stSez); }
    else if (stSez) ukazStranku(stSez.url);
    const rokyEl = h("div", { class: "sez-roky", role: "group", "aria-label": "Sezóna" });
    const box = h("section", { class: "sez" });
    const kresliRoky = () => rokyEl.replaceChildren(...roky.map((rok) => {
      const p = platnaSezona(rok), zm = jeZmena(rok);
      const pozn = zm ? "neuloženo" : !p.radky.length ? "připravená" : "";
      return h("button", { class: "sez-rok", type: "button", "aria-pressed": String(rok === S.sez.rok), dataset: { rok }, onclick: () => { S.sez.rok = rok; vykresli(); } },
        rok, pozn ? h("small", { text: pozn }) : null, ulozenaSezona(rok) && !zm ? h("i", { title: "Upraveno v administraci" }) : null);
    }));
    kresliSezonu(box, kresliRoky);
    kresliRoky();
    return [
      hlavicka("Sezóny", "Výsledky a krátký text ke každé sezóně. Po uložení jsou hned na české i anglické stránce sezóny."),
      rokyEl, box,
    ];
  }
  function kresliSezonu(box, kresliRoky, fokus) {
    const rok = S.sez.rok, k = koncept(rok);
    const vych = vychoziSezona(rok), ulozena = ulozenaSezona(rok), platna = platnaSezona(rok);
    const stavEl = h("span", { class: "sez__stav" }), poznEl = h("div"), pocetEl = h("span"), chybiEl = h("p", { class: "sez__p" });
    const ulozBtn = h("button", { class: "btn btn--ink", type: "button", onclick: () => ulozSezonu(box, kresliRoky) }, ik("check"), "Uložit a zveřejnit");
    const zahodBtn = h("button", { class: "btn btn--o", type: "button", onclick: () => { delete S.sez.koncepty[rok]; kresliSezonu(box, kresliRoky); kresliRoky(); } }, "Zahodit úpravy");
    const pridatBtn = h("button", { class: "btn btn--o", type: "button", onclick: () => pridej() }, ik("plus"), "Přidat řádek");
    const mezEl = h("span", { class: "ticho" });
    const poleChyb = {};
    const obnovStav = () => {
      const zm = jeZmena(rok), ch = chybySezony(k), n = cistaSezona(k).radky.length, bezEn = cistaSezona(k).radky.filter((r) => !r.en).length;
      stavEl.className = "sez__stav" + (zm ? " zmena" : "");
      stavEl.textContent = zm ? "Neuložené změny" : ulozena ? "Upraveno v administraci" : "Podle původního webu";
      ulozBtn.disabled = !zm || ch.pocet > 0;
      zahodBtn.hidden = !zm;
      pocetEl.textContent = n ? pocetRadku(n) : "zatím žádný řádek";
      chybiEl.hidden = !bezEn;
      chybiEl.textContent = bezEn ? "U " + sklon(bezEn, "jednoho řádku", bezEn + " řádků", bezEn + " řádků") + " chybí anglické znění. Na anglické stránce se tam ukáže český text." : "";
      pridatBtn.disabled = k.radky.length >= MAX_RADKU;
      mezEl.textContent = k.radky.length >= MAX_RADKU ? "Sezóna může mít nejvýš " + MAX_RADKU + " řádků." : "";
      const cizi = zm && k.zaklad !== otisk(platna);
      nahrad(poznEl,
        !platna.radky.length && !vych.radky.length ? h("p", { class: "sez__pozn", text: "Sezóna " + rok + " je připravená. Její stránka se na webu objeví v nabídce i v přehledu sezón, jakmile uložíte první výsledek." }) : null,
        cizi ? h("p", { class: "sez__pozn sez__pozn--err", text: "Tuto sezónu mezitím uložil někdo jiný. Vaše rozpracované úpravy zůstaly ve formuláři. Uložením jeho verzi přepíšete, tlačítkem „Zahodit úpravy“ načtete tu uloženou." }) : null);
      for (const id of Object.keys(poleChyb)) {
        const p = poleChyb[id], r = k.radky.find((x) => String(x.id) === id);
        if (!r) continue;
        const chyba = ch.radky.get(r.id);
        p.cs.setAttribute("aria-invalid", String(!!chyba && chyba.cs)); p.en.setAttribute("aria-invalid", String(!!chyba && chyba.en));
        p.pozn.className = "sez-radek__pozn" + (chyba ? " chyba" : "");
        p.pozn.textContent = chyba ? chyba.text : (!naRadek(r.en) && naRadek(r.cs) ? "Bez angličtiny se na anglické stránce ukáže český text." : "");
        p.pozn.hidden = !p.pozn.textContent;
      }
      kresliRoky();
    };
    const prekresli = (f) => kresliSezonu(box, kresliRoky, f);
    const presun = (z, na) => {
      if (na < 0 || na >= k.radky.length || z === na) return;
      const r = k.radky.splice(z, 1)[0]; k.radky.splice(na, 0, r);
      return r;
    };
    function pridej() {
      if (k.radky.length >= MAX_RADKU) return;
      const r = { cs: "", en: "", id: ++S.sez.id, novy: true };
      k.radky.push(r);
      prekresli({ id: r.id, co: "cs" });
    }
    /* info o sezóně */
    const infoPole = (j, popisek) => {
      const pocet = h("small"), chyba = h("small", { class: "chyba" });
      const ta = h("textarea", { id: "sez-info-" + j, maxlength: String(MAX_INFO), rows: "4", spellcheck: "true", lang: j });
      ta.value = k.info[j];
      const pocitej = () => { const n = ta.value.length; pocet.textContent = n + " / " + MAX_INFO; const ch = chybySezony(k).info[j]; ta.setAttribute("aria-invalid", String(!!ch)); chyba.textContent = ch || ""; chyba.hidden = !ch; };
      ta.addEventListener("input", () => { k.info[j] = ta.value; pocitej(); obnovStav(); });
      pocitej();
      return h("div", { class: "sez-pole" }, h("label", { for: "sez-info-" + j, text: popisek }), ta, chyba, pocet);
    };
    /* řádky výsledků */
    const seznam = h("ol", { class: "sez-radky" });
    k.radky.forEach((r, i) => {
      const cs = h("input", { type: "text", id: "sez-cs-" + r.id, maxlength: String(MAX_RADEK), autocomplete: "off", lang: "cs", placeholder: r.novy ? "1. místo – CSI2* 1,45 m, Praha" : null, "aria-label": "Řádek " + (i + 1) + " česky" });
      const en = h("input", { type: "text", id: "sez-en-" + r.id, maxlength: String(MAX_RADEK), autocomplete: "off", lang: "en", placeholder: r.novy ? "1st – CSI2* 1m45, Prague" : null, "aria-label": "Řádek " + (i + 1) + " anglicky" });
      cs.value = r.cs; en.value = r.en;
      const pozn = h("small", { class: "sez-radek__pozn" });
      poleChyb[r.id] = { cs, en, pozn };
      cs.addEventListener("input", () => { r.cs = cs.value; obnovStav(); });
      en.addEventListener("input", () => { r.en = en.value; obnovStav(); });
      [cs, en].forEach((pole) => pole.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); if (i === k.radky.length - 1) pridej(); else { const dalsi = $("sez-" + (pole === cs ? "cs" : "en") + "-" + k.radky[i + 1].id); if (dalsi) dalsi.focus(); } }
      }));
      const tah = h("span", { class: "sez-tah", draggable: "true", title: "Přetáhnout na jiné místo", "aria-hidden": "true" }, ik("tahni"));
      const li = h("li", { class: "sez-radek" + (r.novy ? " novy" : ""), dataset: { i: String(i) } },
        h("div", { class: "sez-radek__c" }, tah, h("span", { class: "sez-radek__n", text: (i + 1) + "." })),
        h("div", { class: "sez-radek__cs" }, h("label", { class: "sez-radek__l", for: "sez-cs-" + r.id, text: "Česky" }), cs),
        h("div", { class: "sez-radek__en" }, h("label", { class: "sez-radek__l", for: "sez-en-" + r.id, text: "Anglicky" }), en, pozn),
        h("div", { class: "sez-radek__a" },
          h("button", { class: "sez-ib", type: "button", id: "sez-nahoru-" + r.id, disabled: i === 0, "aria-label": "Posunout řádek " + (i + 1) + " nahoru", title: "Nahoru", onclick: () => { presun(i, i - 1); prekresli({ id: r.id, co: i - 1 === 0 ? "dolu" : "nahoru" }); } }, ik("nahoru")),
          h("button", { class: "sez-ib", type: "button", id: "sez-dolu-" + r.id, disabled: i === k.radky.length - 1, "aria-label": "Posunout řádek " + (i + 1) + " dolů", title: "Dolů", onclick: () => { presun(i, i + 1); prekresli({ id: r.id, co: i + 1 === k.radky.length - 1 ? "nahoru" : "dolu" }); } }, ik("dolu")),
          h("button", { class: "sez-ib sez-ib--err", type: "button", "aria-label": "Smazat řádek " + (i + 1), title: "Smazat řádek", onclick: () => { k.radky.splice(i, 1); const soused = k.radky[Math.min(i, k.radky.length - 1)]; prekresli(soused ? { id: soused.id, co: "cs" } : null); } }, ik("kos"))));
      /* tažení řádku za úchyt (myší); na dotykových zařízeních slouží šipky */
      tah.addEventListener("dragstart", (e) => {
        S.sez.tah = i; li.classList.add("tah");
        try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); e.dataTransfer.setDragImage(li, 24, 24); } catch (x) { /* nic */ }
      });
      tah.addEventListener("dragend", () => { S.sez.tah = null; seznam.querySelectorAll(".sez-radek").forEach((x) => x.classList.remove("tah", "nad", "pod")); });
      li.addEventListener("dragover", (e) => {
        if (S.sez.tah == null) return;
        e.preventDefault();
        const b = li.getBoundingClientRect(), nad = e.clientY < b.top + b.height / 2;
        seznam.querySelectorAll(".sez-radek").forEach((x) => x.classList.remove("nad", "pod"));
        if (S.sez.tah !== i) li.classList.add(nad ? "nad" : "pod");
      });
      li.addEventListener("drop", (e) => {
        if (S.sez.tah == null) return;
        e.preventDefault();
        const z = S.sez.tah, b = li.getBoundingClientRect(), nad = e.clientY < b.top + b.height / 2;
        let na = nad ? i : i + 1;
        if (z < na) na--;
        S.sez.tah = null;
        const presunuty = presun(z, na);
        prekresli(presunuty ? { id: presunuty.id, co: "cs" } : null);
      });
      seznam.append(li);
    });
    const vratit = ulozena ? h("button", { class: "btn btn--txt", type: "button", onclick: async () => {
      if (!(await potvrd({ nadpis: "Vrátit sezónu " + rok + " do původního stavu?", text: "Na webu budou znovu výsledky převzaté z původního webu (" + (vych.radky.length ? pocetRadku(vych.radky.length) : "bez výsledků") + "). Současný stav zůstane v historii.", ok: "Vrátit původní" }))) return;
      if (await uloz({ sezony: { [rok]: null } }, "Sezóna " + rok + " je zpět v původním stavu.")) { delete S.sez.koncepty[rok]; vykresli(); }
    } }, ik("zpet"), "Vrátit původní") : null;

    box.replaceChildren(
      h("header", { class: "sez__h" }, h("h3", { class: "sez__t" }, "Sezóna ", h("em", { text: rok })), stavEl),
      poznEl,
      h("div", { class: "sez__cast" },
        h("p", { class: "sez__lbl" }, "Info o sezóně"),
        h("p", { class: "sez__p", text: "Krátký text nad výsledky. Když pole necháte prázdné, na webu se nezobrazí nic." }),
        h("div", { class: "sez-info" }, infoPole("cs", "Česky"), infoPole("en", "Anglicky"))),
      h("div", { class: "sez__cast" },
        h("p", { class: "sez__lbl" }, "Výsledky", pocetEl),
        chybiEl,
        k.radky.length ? h("div", { class: "sez-hlava", "aria-hidden": "true" }, h("span"), h("span", { text: "Česky" }), h("span", { text: "Anglicky" }), h("span")) : null,
        seznam,
        h("div", { class: "sez__pridat" }, pridatBtn, mezEl)),
      h("div", { class: "sez__pata" }, ulozBtn, zahodBtn, vratit));
    obnovStav();
    if (fokus) {
      const el = $("sez-" + fokus.co + "-" + fokus.id);
      if (el) { el.focus({ preventScroll: false }); if (el.scrollIntoView) el.scrollIntoView({ block: "nearest" }); }
    }
  }
  async function ulozSezonu(box, kresliRoky) {
    const rok = S.sez.rok, k = S.sez.koncepty[rok];
    if (!k) return;
    if (chybySezony(k).pocet) { toast("Opravte prosím označená pole.", "err"); return; }
    const nova = cistaSezona(k), vych = vychoziSezona(rok);
    const tlacitka = box.querySelectorAll(".sez__pata .btn"); tlacitka.forEach((b) => { b.disabled = true; });
    const jakoVychozi = JSON.stringify(nova) === JSON.stringify(vych);
    const ok = await uloz({ sezony: { [rok]: jakoVychozi ? null : nova } },
      jakoVychozi ? "Sezóna " + rok + " je zpět v původním stavu." : "Sezóna " + rok + " uložena a zveřejněna.", { vychozi: { sezony: { [rok]: vych } } });
    if (ok) { delete S.sez.koncepty[rok]; vykresli(); }
    else if (S.tab === "sezony" && S.token) kresliSezonu(box, kresliRoky);
  }

  /* HISTORIE */
  async function nactiHistorii(tiche) {
    try { const d = await api("/historie"); S.historie = (d && Array.isArray(d.polozky)) ? d.polozky : []; }
    catch (e) { if (!tiche && e.status !== 401) toast(e.message, "err"); S.historie = S.historie || []; }
    if (S.tab === "prehled" || S.tab === "historie") vykresli();
  }
  function pHistorie() {
    const uvod = "Každá uložená změna: kdo, kdy a odkud. Kteroukoli verzi můžete obnovit, nic se neztratí.";
    if (!S.historie) { nactiHistorii(); return [hlavicka("Historie", uvod), h("div", { class: "nacitam" }, h("span", { class: "tocka" }), "Načítám historii…")]; }
    const akt = S.obsah ? S.obsah.verze : null;
    return [
      hlavicka("Historie", uvod,
        h("button", { class: "btn btn--o", type: "button", onclick: () => { S.historie = null; vykresli(); } }, ik("obnovit"), "Načíst znovu")),
      S.historie.length ? h("ol", { class: "osa" }, S.historie.map((v) => h("li", { class: v.verze === akt ? "akt" : "" },
        h("div", { class: "verze" },
          h("div", null,
            h("div", { class: "verze__h" }, h("b", { text: "Verze " + v.verze }), v.verze === akt ? h("span", { class: "typ typ--ok", text: "Právě na webu" }) : null),
            h("p", { class: "verze__m" }, h("span", null, ik("historie"), cas(v.cas)), h("span", null, ik("klic"), v.jmeno || "neznámý"), h("span", null, ik("mista"), odkud(v.ip, v.zeme))),
            Array.isArray(v.popis) && v.popis.length ? h("ul", null, v.popis.slice(0, 8).map((p) => h("li", { text: popisZmeny(p) }))) : null),
          v.verze !== akt ? h("button", { class: "btn btn--o", type: "button", onclick: () => obnov(v) }, ik("zpet"), "Obnovit tuto verzi") : null)))) :
        h("div", { class: "prazdne" }, h("b", { text: "Zatím žádné změny" }), "Po prvním uložení se tu objeví záznam."),
    ];
  }
  async function obnov(v) {
    const ok = await potvrd({ nadpis: "Obnovit verzi " + v.verze + "?", text: "Web se vrátí do stavu z " + cas(v.cas) + ". Současný stav zůstane v historii, takže se k němu můžete kdykoli vrátit.", ok: "Obnovit verzi" });
    if (!ok) return;
    try {
      const o = await api("/obnovit", { metoda: "POST", telo: { verze: v.verze } });
      S.obsah = normalizujObsah(o); aplikujNahled(); toast("Verze " + v.verze + " obnovena a zveřejněna.", "ok");
      S.historie = null; vykresli();
    } catch (e) { if (e.status !== 401) toast(e.message, "err", 6000); }
  }

  /* ZABEZPEČENÍ */
  async function nactiBezpecnost() {
    const [ja, ak] = await Promise.allSettled([api("/ja"), api("/aktivita")]);
    if (ja.status === "fulfilled") S.ja = ja.value;
    S.aktivita = ak.status === "fulfilled" && ak.value && Array.isArray(ak.value.polozky) ? ak.value.polozky : [];
    if (S.tab === "zabezpeceni") vykresli();
  }
  function pZabezpeceni() {
    if (!S.aktivita) { nactiBezpecnost(); }
    const ja = S.ja || {}, rel = ja.relace || {}, pr = ja.predchozi;
    const udaje = (radky) => h("dl", { class: "udaje" }, radky.map(([a, b]) => h("div", null, h("dt", { text: a }), h("dd", { text: b }))));
    const OCHRANY = [
      ["Dvoufázové ověření", "Kromě hesla je potřeba kód z aplikace v telefonu."],
      ["Hesla jen jako otisk", "Heslo se nikde neukládá, server zná jen jeho otisk."],
      ["Zámek proti hádání", "Po 5 chybných pokusech se účet na 15 minut zamkne."],
      ["Šifrované spojení", "Vše jde přes HTTPS, administrace nepoužívá cookies."],
      ["Automatické odhlášení", "Po 30 minutách nečinnosti nebo zavření okna."],
      ["Historie všech změn", "Každá úprava je dohledatelná a jde vrátit."],
      ["Ochrana stránky", "Administraci nejde vložit do cizí stránky, vyhledávače ji nevidí."],
    ];
    const TYPY = { prihlaseni: ["Přihlášení", "typ--ok"], neuspech: ["Neúspěšný pokus", "typ--err"], zamceno: ["Zamčeno", "typ--err"], odhlaseni: ["Odhlášení", "typ--mut"], smazani_zpravy: ["Smazaná zpráva", "typ--mut"], zmena: ["Změna obsahu", "typ--z"], obnoveni: ["Obnovení verze", "typ--z"] };
    return [
      hlavicka("Zabezpečení", "Kdo a odkud se přihlašuje a jak je administrace chráněná.",
        h("button", { class: "btn btn--err", type: "button", onclick: odhlasVsude }, ik("odhlasit"), "Odhlásit všude")),
      h("div", { class: "g3" },
        h("div", { class: "karta" }, h("h3", { class: "karta__t", text: "Toto přihlášení" }), h("p", { class: "karta__s", text: prohlizec(navigator.userAgent) }),
          udaje([["Uživatel", ja.jmeno || S.jmeno || "neznámý"], ["Přihlášen", rel.vytvoreno ? cas(rel.vytvoreno) : "bez údaje"], ["Odkud", odkud(rel.ip, rel.zeme)], ["Platí nejdéle do", (ja.plati_do || S.platiDo) ? cas(ja.plati_do || S.platiDo) : "bez údaje"]])),
        h("div", { class: "karta" }, h("h3", { class: "karta__t", text: "Předchozí přihlášení" }), h("p", { class: "karta__s", text: "Nepoznáváte ho? Odhlaste všude a dejte vědět správci." }),
          pr ? udaje([["Kdy", cas(pr.cas)], ["Odkud", odkud(pr.ip, pr.zeme)]]) : h("p", { class: "ticho", text: "Toto je první přihlášení." })),
        h("div", { class: "karta" }, h("h3", { class: "karta__t", text: "Ochrany" }), h("p", { class: "karta__s", text: "Vše aktivní" }),
          h("ul", { class: "ochrany" }, OCHRANY.map(([t, s]) => h("li", null, ik("check"), h("span", null, t, h("small", { text: s }))))))),
      h("h3", { class: "skupina__t" }, "Záznam aktivity", h("span", { text: S.aktivita ? String(S.aktivita.length) : "…" })),
      !S.aktivita ? h("div", { class: "nacitam" }, h("span", { class: "tocka" }), "Načítám záznam…") :
        S.aktivita.length ? h("div", { class: "tab-wrap" }, h("table", { class: "log" },
          h("thead", null, h("tr", null, ["Kdy", "Událost", "Uživatel", "Odkud", "Zařízení"].map((t) => h("th", { scope: "col", text: t })))),
          h("tbody", null, S.aktivita.map((a) => { const t = TYPY[a.typ] || [a.typ, "typ--mut"]; return h("tr", null, h("td", { text: cas(a.cas) }), h("td", null, h("span", { class: "typ " + t[1], text: t[0] })), h("td", { text: a.jmeno || "neznámý" }), h("td", { text: odkud(a.ip, a.zeme) }), h("td", { text: prohlizec(a.ua) })); })))) :
          h("div", { class: "prazdne" }, h("b", { text: "Záznam je prázdný" }), "Přihlášení a změny se tu budou zapisovat."),
    ];
  }
  async function odhlasVsude() {
    const ok = await potvrd({ nadpis: "Odhlásit všechna zařízení?", text: "Ukončíme všechna přihlášení k administraci, včetně tohoto. Potom se znovu přihlásíte heslem a kódem.", ok: "Odhlásit všude", nebezpecne: true });
    if (!ok) return;
    try { const r = await api("/odhlasit-vsude", { metoda: "POST" }); odhlasMistne("Odhlášeno ze všech zařízení (" + ((r && r.zruseno) || 0) + "). Přihlaste se znovu."); }
    catch (e) { if (e.status !== 401) toast(e.message, "err"); }
  }

  /* ───────── navázání událostí ───────── */
  function init() {
    try { document.execCommand("styleWithCSS", false, false); } catch (e) { /* nic */ }
    naplnDuveru();
    if (vObalu) { // klient nemá vidět adresu github.io
      if (WEB_ODKAZ) { $("logo-odkaz").href = WEB_ODKAZ; $("btn-web").href = WEB_ODKAZ; }
      else { $("btn-web").hidden = true; $("logo-odkaz").removeAttribute("href"); $("logo-odkaz").removeAttribute("target"); }
    }
    $("btn-web").append(ik("web"));
    $("btn-odhlasit").append(ik("odhlasit"));
    $("editor-x").append(ik("x"));
    $("login-form").addEventListener("submit", prihlas);
    $("l-kod").addEventListener("input", (e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 6); if (v !== e.target.value) e.target.value = v; if (v.length === 6 && $("l-jmeno").value && $("l-heslo").value) $("login-form").requestSubmit(); });
    $("l-oko").addEventListener("click", () => {
      const i = $("l-heslo"), vid = i.type === "password";
      i.type = vid ? "text" : "password";
      $("l-oko").setAttribute("aria-pressed", String(vid)); $("l-oko").setAttribute("aria-label", vid ? "Skrýt heslo" : "Zobrazit heslo");
      $("l-oko").replaceChildren(ik(vid ? "oko-ne" : "oko"));
    });
    $("pills").addEventListener("click", (e) => { const b = e.target.closest(".pill"); if (b) prepniTab(b.dataset.tab, true); });
    $("pills").addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const p = [...document.querySelectorAll(".pill")], i = p.findIndex((x) => x.getAttribute("aria-selected") === "true");
      const n = p[(i + (e.key === "ArrowRight" ? 1 : p.length - 1)) % p.length]; n.focus(); prepniTab(n.dataset.tab);
    });
    $("btn-odhlasit").addEventListener("click", () => odhlas());
    $("edit-hotovo").addEventListener("click", () => { ukonciUpravy(); vykresli(); });
    $("editor-x").addEventListener("click", zavriEditor);
    $("editor-ulozit").addEventListener("click", ulozText);
    $("editor-vratit").addEventListener("click", vratText);
    const pole = $("editor-pole");
    pole.addEventListener("input", pocitejZnaky);
    pole.addEventListener("paste", (e) => { e.preventDefault(); const t = (e.clipboardData || window.clipboardData).getData("text/plain"); document.execCommand("insertText", false, t); });
    pole.addEventListener("drop", (e) => e.preventDefault());
    pole.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && (e.metaKey || e.ctrlKey)) { e.preventDefault(); ulozText(); return; }
      if (e.key === "Enter") { e.preventDefault(); document.execCommand("insertLineBreak"); }
      if (e.key === "Escape") { e.stopPropagation(); zavriEditor(); } // jedno Esc zavře jen editor, režim úprav zůstane
    });
    document.querySelectorAll(".nastroje button").forEach((b) => b.addEventListener("mousedown", (e) => e.preventDefault()));
    document.querySelectorAll(".nastroje button").forEach((b) => b.addEventListener("click", () => {
      pole.focus();
      if (b.dataset.cmd === "br") document.execCommand("insertLineBreak"); else document.execCommand(b.dataset.cmd);
    }));
    $("dlg-fotka-vybrat").addEventListener("click", () => $("dlg-fotka-soubor").click());
    $("dlg-fotka-soubor").addEventListener("change", vybranaFotka);
    $("dlg-fotka-ulozit").addEventListener("click", nahrajFotku);
    $("dlg-fotka-vratit").addEventListener("click", vratFotku);
    $("dlg-fotka-zavrit").addEventListener("click", () => $("dlg-fotka").close());
    $("dlg-fotka-ukaz").addEventListener("click", ukazFotkuNaStrance);
    $("nahled").addEventListener("load", poNacteniRamce);
    ["pointerdown", "keydown", "wheel", "touchstart"].forEach((t) => document.addEventListener(t, aktivita, { passive: true, capture: true }));
    window.addEventListener("scroll", () => $("app").classList.toggle("scrolled", window.scrollY > 40), { passive: true });
    window.addEventListener("beforeunload", (e) => { if (S.token && Object.keys(S.sez.koncepty).some(jeZmena)) { e.preventDefault(); e.returnValue = ""; } });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.uprava && !$("editor").classList.contains("open") && !document.querySelector("dialog[open]")) { ukonciUpravy(); vykresli(); } });
    // obnova relace v rámci karty prohlížeče
    let ul = null;
    try { ul = JSON.parse(sessionStorage.getItem(KLIC) || "null"); } catch (e) { ul = null; }
    if (ul && ul.t && (!ul.p || Date.parse(ul.p) > Date.now())) {
      S.token = ul.t; S.jmeno = ul.j || ""; S.platiDo = ul.p || null;
      spust().catch(() => odhlasMistne("Přihlaste se prosím znovu."));
    } else {
      try { sessionStorage.removeItem(KLIC); } catch (e) { /* nic */ }
      ukazPrihlaseni();
    }
  }
  init();
})();
