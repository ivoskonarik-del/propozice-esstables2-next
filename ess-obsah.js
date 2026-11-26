/* Obsah z administrace Emma Sophia Stables (24. 11. 2026): kontakty, texty a fotky upravené v /admin/ se propíšou
   do stránky, sezóny se jen předávají webu. Vychází z cib-obsah.js (19. 10. 2026).
   Kontrakt: _KONTRAKT.md, oddíl „Administrace a web (DOM)“.

   Co je jinak než u CIB:
   - NESPOUŠTÍ SE SÁM. Web volá ESSObsah.nacti().then(ESSObsah.aplikuj) po oživení Reactu a po každém přechodu.
   - texty jen v <main>, <header> a <footer>; vše uvnitř [data-bez-uprav] se přeskakuje
   - fotky podle atributu data-foto="<klic>" na <picture> (source srcset + img src) nebo na <a> (href)
   - po každém nacti() událost „ess:obsah“ na document (detail = obsah); část „sezony“ se jen předává, DOM sezón se nemění
   - nacti() nikdy neodmítne: když služba neodpoví, vrátí poslední známý obsah, jinak null (ne prázdný obsah:
     prázdné „sezony“ by web bral jako „žádné úpravy“ a zahodil by sezóny zapečené při sestavení). ESSObsah.obsah
     pak zůstane null a web jede beze změn, přesně jak je sestavený
   - počítá s Reactem: nedrží odkazy na staré prvky (jen WeakMap), uzly Reactu nechává ve stránce (text mění
     v nich, při změně stavby je jen vyprázdní nebo skryje) a pozná, když React prvek mezitím přepsal

   Bezpečnost: texty jen přes vlastní parser (strong/em/br, nic jiného), odkazy jen tel:/mailto: z ověřeného tvaru,
   fotky jen ze serveru administrace. */
(function () {
  "use strict";
  var API = "https://ess-admin-api.prodej-bytu-3-1-70-m2-172175436.workers.dev";
  var INLINE = { STRONG: 1, B: 1, EM: 1, BR: 1 };
  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, SVG: 1, VIDEO: 1, SELECT: 1, OPTION: 1, TEXTAREA: 1, INPUT: 1, IFRAME: 1, CANVAS: 1, TEMPLATE: 1, HEAD: 1 };
  var ZONY = "main,header,footer";
  var BEZ = "[data-bez-uprav]";
  var SKRYTO = "data-ess-skryto";    // původní uzel Reactu, který jsme schovali
  var VLOZENO = "data-ess-vlozeno";  // náš uzel vložený místo něj
  var SOUBOR_RE = /^[a-f0-9]{32}\.(jpg|png|webp)$/;
  var FOTKA_RE = /^[a-z0-9][a-z0-9-]{1,90}$/;
  var TEL_RE = /^\+?[0-9 ]{6,22}$/;
  var MAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}$/;

  var zaznamy = new WeakMap();      // prvek textu → {klic, html, cil, plati, uzly, skryte, nase}
  var kontaktUzly = new WeakMap();  // textový uzel → {v: původní hodnota, w: naše hodnota}
  var kontaktAttr = new WeakMap();  // odkaz → {v: původní href, w: náš href}
  var fotoAttr = new WeakMap();     // prvek → {atribut: {v, w}}
  var zasah = false;                // už jsme do nějaké stránky něco zapsali
  var pracuji = false;
  var pozor = null;

  function norm(s) { return String(s || "").replace(/\s+/g, " ").trim(); }
  function fnv(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }
  function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function filtr(seznam, fn) { return Array.prototype.filter.call(seznam, fn); }
  function cast(x) { return x && typeof x === "object" && !Array.isArray(x) ? x : {}; }
  function normalizuj(o) {
    o = cast(o);
    return { verze: +o.verze || 0, upraveno: o.upraveno || null, kontakty: cast(o.kontakty), texty: cast(o.texty), fotky: cast(o.fotky), sezony: cast(o.sezony) };
  }

  /* ---------- texty ---------- */
  /* hodnota textového uzlu bez našeho zásahu do kontaktů (klíč a porovnání se počítají z původního znění) */
  function hodnota(n) { var k = kontaktUzly.get(n); return k && n.nodeValue === k.w ? k.v : n.nodeValue; }
  function jeObsah(n) { return n.nodeType === 3 || (n.nodeType === 1 && !!INLINE[n.tagName]); }
  function obsahoveUzly(el) { return filtr(el.childNodes, function (n) { return jeObsah(n) && !(n.nodeType === 1 && n.hasAttribute(SKRYTO)); }); }
  function textUzlu(nodes) { return nodes.map(function (n) { return n.nodeType === 3 ? hodnota(n) : textUzlu(filtr(n.childNodes, jeObsah)); }).join(""); }
  function serializuj(nodes) {
    var out = "";
    nodes.forEach(function (n) {
      if (n.nodeType === 3) out += esc(hodnota(n).replace(/\s+/g, " "));
      else if (n.tagName === "BR") out += "<br>";
      else {
        var t = n.tagName === "EM" ? "em" : "strong";
        out += "<" + t + ">" + serializuj(filtr(n.childNodes, jeObsah)) + "</" + t + ">";
      }
    });
    return out;
  }
  function aktualni(el) { return serializuj(obsahoveUzly(el)).trim(); }
  /* bezpečný převod HTML z administrace na uzly: jen text, strong, em, br */
  function naUzly(html, doc) {
    var frag = doc.createDocumentFragment(), zas = [frag];
    String(html).split(/(<\/?(?:strong|em)>|<br>)/).forEach(function (c) {
      var top = zas[zas.length - 1];
      if (c === "<strong>" || c === "<em>") { var e = doc.createElement(c.slice(1, -1)); top.appendChild(e); zas.push(e); }
      else if (c === "</strong>" || c === "</em>") { if (zas.length > 1) zas.pop(); }
      else if (c === "<br>") top.appendChild(doc.createElement("br"));
      else if (c) {
        var t = doc.createElement("textarea"); t.innerHTML = c.replace(/</g, "&lt;"); // jen dekódování entit, textarea nic nespouští
        top.appendChild(doc.createTextNode(t.value));
      }
    });
    return frag;
  }
  function jeKontaktniOdkaz(el) { return el.tagName === "A" && /^(tel|mailto):/i.test(el.getAttribute("href") || ""); }
  function vZone(el) { return !!el.closest(ZONY) && !el.closest(BEZ) && !el.closest("svg,[" + VLOZENO + "],#ess-admin-zvyr"); }
  function kandidat(el) {
    if (!el || el.nodeType !== 1 || SKIP[el.tagName] || !vZone(el)) return false;
    var z = zaznamy.get(el);
    if (z && z.plati != null) return true; // prvek s naším textem zůstává kandidátem, i kdyby v něm zbylo jen tučné písmo
    if (INLINE[el.tagName] && el.parentElement && kandidat(el.parentElement)) return false;
    if (jeKontaktniOdkaz(el) || el.closest("a[href^='tel:'],a[href^='mailto:']")) return false;
    var hasText = false;
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3 && /[A-Za-zÀ-ž0-9]/.test(n.nodeValue)) { hasText = true; break; }
    }
    if (!hasText) return false;
    return norm(textUzlu(obsahoveUzly(el))).length >= 2;
  }
  /* sloty obsahu: sousední textové uzly tvoří jeden slot (React dělí text na víc uzlů) */
  function sloty(nodes) {
    var out = [], posl = null;
    Array.prototype.forEach.call(nodes, function (n) {
      if (n.nodeType === 3) {
        if (posl) posl.uzly.push(n); else { posl = { t: "#", uzly: [n] }; out.push(posl); }
      } else {
        posl = null;
        out.push({ t: n.tagName === "B" ? "STRONG" : n.tagName, deti: n.tagName === "BR" ? [] : sloty(filtr(n.childNodes, jeObsah)) });
      }
    });
    return out;
  }
  function stejnyTvar(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i].t !== b[i].t) return false;
      if (a[i].t !== "#" && !stejnyTvar(a[i].deti, b[i].deti)) return false;
    }
    return true;
  }
  function prepis(a, b, uzly) { // stejný tvar: text se mění přímo v uzlech stránky, React o ně nepřijde
    for (var i = 0; i < a.length; i++) {
      if (a[i].t === "#") {
        var novy = b[i].uzly.map(function (n) { return n.nodeValue; }).join("");
        a[i].uzly.forEach(function (n, j) {
          var w = j ? "" : novy;
          uzly.push({ n: n, v: n.nodeValue, w: w });
          if (n.nodeValue !== w) n.nodeValue = w;
        });
      } else prepis(a[i].deti, b[i].deti, uzly);
    }
  }
  /* vrátí prvek do původní podoby; uzly, které mezitím přepsal React, nechá být */
  function vratZasah(el, z) {
    (z.nase || []).forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
    (z.skryte || []).forEach(function (s) {
      s.n.removeAttribute(SKRYTO);
      if (s.display) s.n.style.setProperty("display", s.display, s.dulezite); else s.n.style.removeProperty("display");
      if (!s.n.getAttribute("style")) s.n.removeAttribute("style");
    });
    (z.uzly || []).forEach(function (u) { if (u.n.nodeValue === u.w) u.n.nodeValue = u.v; });
    z.cil = z.plati = z.uzly = z.skryte = z.nase = null;
  }
  function nastavText(el, z, html) { // el je v původní podobě
    var doc = el.ownerDocument, puv = obsahoveUzly(el), frag = naUzly(html, doc);
    var a = sloty(puv), b = sloty(frag.childNodes);
    z.uzly = []; z.skryte = []; z.nase = [];
    if (stejnyTvar(a, b)) prepis(a, b, z.uzly);
    else { // jiná stavba: naše uzly se vloží před původní, původní zůstanou ve stránce prázdné nebo skryté
      z.nase = filtr(frag.childNodes, function () { return true; });
      z.nase.forEach(function (n) { if (n.nodeType === 1) n.setAttribute(VLOZENO, ""); });
      if (puv.length) el.insertBefore(frag, puv[0]); else el.appendChild(frag);
      puv.forEach(function (n) {
        if (n.nodeType === 3) { z.uzly.push({ n: n, v: n.nodeValue, w: "" }); n.nodeValue = ""; }
        else {
          z.skryte.push({ n: n, display: n.style.getPropertyValue("display"), dulezite: n.style.getPropertyPriority("display") });
          n.setAttribute(SKRYTO, "");
          n.style.setProperty("display", "none", "important");
        }
      });
    }
    z.cil = html;
    z.plati = aktualni(el);
    zasah = true;
  }
  function neporuseno(el, z) {
    var ok = function (n) { return n.parentNode && el.contains(n); };
    return (z.uzly || []).every(function (u) { return ok(u.n) && u.n.nodeValue === u.w; })
      && (z.skryte || []).every(function (s) { return ok(s.n) && s.n.hasAttribute(SKRYTO); })
      && (z.nase || []).every(ok);
  }
  function zapamatuj(el) {
    var z = zaznamy.get(el);
    if (z) {
      var ted = aktualni(el);
      if (z.plati != null ? (ted === z.plati && neporuseno(el, z)) : ted === z.html) return z;
      // React prvek mezitím přepsal (jiný jazyk, jiný stav): naše stopy pryč a jeho nový obsah je nový původní stav
      if (z.plati != null) vratZasah(el, z);
      zaznamy.delete(el);
    }
    var nodes = obsahoveUzly(el);
    z = { klic: "t" + fnv(norm(textUzlu(nodes))), html: serializuj(nodes).trim(), cil: null, plati: null, uzly: null, skryte: null, nase: null };
    zaznamy.set(el, z);
    return z;
  }
  function vsechnyKandidaty(root) {
    var out = [], all = (root || document).querySelectorAll("main,main *,header,header *,footer,footer *");
    for (var i = 0; i < all.length; i++) if (kandidat(all[i])) out.push(all[i]);
    return out;
  }
  function aplikujTexty(doc, texty) {
    var kand = vsechnyKandidaty(doc);
    kand.forEach(zapamatuj); // originály dřív, než se cokoli změní
    kand.forEach(function (el) {
      var z = zaznamy.get(el);
      if (!z) return;
      var cil = texty[z.klic];
      if (typeof cil === "string" && cil) {
        if (z.plati != null && z.cil === cil) return;
        if (z.plati != null) vratZasah(el, z);
        nastavText(el, z, cil);
      } else if (z.plati != null) vratZasah(el, z);
    });
  }

  /* ---------- kontakty ---------- */
  function cislice(s) { return String(s).replace(/[^0-9]/g, ""); }
  function idKontaktu(typ, hodnotaK) {
    if (typ === "tel") { var d = cislice(hodnotaK); if (d.length === 9) d = "420" + d; return "tel:" + d; }
    return "mail:" + String(hodnotaK).trim().toLowerCase();
  }
  function telVzor(id) { // libovolné mezery, volitelná předvolba
    var d = id.slice(4), narodni = d.length === 12 && d.indexOf("420") === 0 ? d.slice(3) : d;
    return new RegExp("(?:\\+?420[\\s\\u00a0]*)?" + narodni.split("").join("[\\s\\u00a0]*") + "(?![0-9])", "g");
  }
  function mailVzor(id) { return new RegExp(id.slice(5).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"); }
  function rozdelHref(href) { // → [typ, hodnota, zbytek za otazníkem]
    var typ = /^tel:/i.test(href) ? "tel" : "mail", telo = href.replace(/^(tel|mailto):/i, ""), i = telo.indexOf("?");
    var h = i < 0 ? telo : telo.slice(0, i);
    try { h = decodeURIComponent(h); } catch (e) { /* ponechat */ }
    return [typ, h, i < 0 ? "" : telo.slice(i)];
  }
  function puvodniHref(a) {
    var k = kontaktAttr.get(a), ted = a.getAttribute("href");
    if (k && ted === k.w) return k.v;
    if (k) kontaktAttr.delete(a); // React odkaz přepsal
    return ted;
  }
  function kontaktyNaStrance(doc) {
    doc = doc || document;
    var out = [];
    doc.querySelectorAll("a[href^='tel:'],a[href^='mailto:']").forEach(function (a) {
      var r = rozdelHref(puvodniHref(a)), id = idKontaktu(r[0], r[1]);
      out.push({ id: id, typ: r[0], puvodni: r[1], hodnota: (O.obsah && O.obsah.kontakty[id]) || r[1], el: a });
    });
    return out;
  }
  function textoveUzly(doc, fn) {
    var w = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT), n;
    while ((n = w.nextNode())) fn(n);
    doc.querySelectorAll("head script[type='application/ld+json']").forEach(function (s) { if (s.firstChild && s.firstChild.nodeType === 3) fn(s.firstChild); });
  }
  function vratKontakty(doc) { // texty zpět do znění bez našich kontaktů, ať se klíče textů počítají z původního stavu
    textoveUzly(doc, function (n) {
      var k = kontaktUzly.get(n);
      if (!k) return;
      if (n.nodeValue === k.w) n.nodeValue = k.v;
      kontaktUzly.delete(n);
    });
  }
  function aplikujKontakty(doc, kontakty) {
    doc.querySelectorAll("a[href^='tel:'],a[href^='mailto:']").forEach(function (a) {
      var puv = puvodniHref(a), r = rozdelHref(puv), nova = kontakty[idKontaktu(r[0], r[1])], cil = puv;
      if (typeof nova === "string" && r[0] === "tel" && TEL_RE.test(nova)) cil = "tel:" + nova.replace(/ /g, "");
      else if (typeof nova === "string" && r[0] === "mail" && MAIL_RE.test(nova)) cil = "mailto:" + nova + r[2];
      if (a.getAttribute("href") !== cil) a.setAttribute("href", cil);
      if (cil !== puv) { kontaktAttr.set(a, { v: puv, w: cil }); zasah = true; } else kontaktAttr.delete(a);
    });
    var vzory = Object.keys(kontakty).filter(function (id) {
      return typeof kontakty[id] === "string" && (id.indexOf("tel:") === 0 ? TEL_RE.test(kontakty[id]) : MAIL_RE.test(kontakty[id]));
    }).map(function (id) { return [id.indexOf("tel:") === 0 ? telVzor(id) : mailVzor(id), kontakty[id]]; });
    if (!vzory.length) return;
    textoveUzly(doc, function (n) {
      var p = n.parentNode;
      if (!p || p.nodeType !== 1) return;
      var ld = p.nodeName === "SCRIPT" && p.getAttribute("type") === "application/ld+json";
      if (SKIP[p.nodeName] && !ld) return;
      if (!ld && p.closest(BEZ) && !p.closest("a[href^='tel:'],a[href^='mailto:']")) return;
      var puv = n.nodeValue, v = puv;
      vzory.forEach(function (x) { v = v.replace(x[0], x[1]); });
      if (v === puv) return;
      n.nodeValue = v;
      kontaktUzly.set(n, { v: puv, w: v });
      zasah = true;
    });
  }

  /* ---------- fotky ---------- */
  function urlSouboru(id) { return API + "/soubor/" + id; }
  function klicPrvku(el) { var k = el && el.getAttribute ? el.getAttribute("data-foto") : null; return k && FOTKA_RE.test(k) ? k : null; }
  function klicFotky(co) { // prvek (nebo jeho potomek) s data-foto, případně adresa souboru /images/s/<klic>-<šířka>.webp
    if (co && co.nodeType === 1) { var el = co.closest("[data-foto]"); return el ? klicPrvku(el) : null; }
    var m = /\/images\/[sx]\/([a-z0-9][a-z0-9-]*?)-\d{3,4}\.(?:webp|jpe?g|png|avif)(?:[?#]|$)/i.exec(String(co || ""));
    return m ? m[1].toLowerCase() : null;
  }
  function cileFotky(el) { // [prvek, atribut], které nesou adresu fotky
    if (el.tagName === "A") return [[el, "href"]];
    var out = [];
    el.querySelectorAll("source").forEach(function (s) { if (s.hasAttribute("srcset")) out.push([s, "srcset"]); });
    (el.tagName === "IMG" ? [el] : filtr(el.querySelectorAll("img"), function () { return true; })).forEach(function (img) {
      out.push([img, "src"]);
      if (img.hasAttribute("srcset")) out.push([img, "srcset"]);
    });
    return out;
  }
  function puvodniAtribut(n, atr) {
    var k = fotoAttr.get(n), e = k && k[atr], ted = n.getAttribute(atr);
    return e && ted === e.w ? e.v : ted;
  }
  function nastavAtribut(n, atr, nova) { // nova = adresa souboru ze služby, nebo null = původní
    var k = fotoAttr.get(n) || {}, puv = puvodniAtribut(n, atr), cil = nova || puv;
    if (cil != null && n.getAttribute(atr) !== cil) n.setAttribute(atr, cil);
    if (cil !== puv) { k[atr] = { v: puv, w: cil }; zasah = true; } else delete k[atr];
    fotoAttr.set(n, k);
  }
  function aplikujFotky(doc, fotky) {
    doc.querySelectorAll("[data-foto]").forEach(function (el) {
      var klic = klicPrvku(el);
      if (!klic) return;
      var id = fotky[klic], nova = typeof id === "string" && SOUBOR_RE.test(id) ? urlSouboru(id) : null;
      cileFotky(el).forEach(function (c) { nastavAtribut(c[0], c[1], nova); });
    });
  }
  function absolutni(doc, u) { try { return new URL(u, doc.baseURI).href; } catch (e) { return u; } }
  function fotkyNaStrance(doc) { // každý prvek s data-foto zvlášť (táž fotka může být na stránce víckrát)
    doc = doc || document;
    var out = [];
    doc.querySelectorAll("[data-foto]").forEach(function (el) {
      var klic = klicPrvku(el);
      if (!klic) return;
      var c = cileFotky(el).filter(function (x) { return x[1] === "src" || x[1] === "href"; })[0] || cileFotky(el)[0];
      if (!c) return;
      var puv = absolutni(doc, String(puvodniAtribut(c[0], c[1]) || "").split(",")[0].trim().split(" ")[0]);
      var id = O.obsah && O.obsah.fotky[klic];
      out.push({ klic: klic, url: typeof id === "string" && SOUBOR_RE.test(id) ? urlSouboru(id) : puv, puvodni: puv, el: el });
    });
    return out;
  }

  /* ---------- veřejné rozhraní (stejné jako window.CIBObsah, navíc nacteno, urlFotky, sleduj, prestan) ---------- */
  function vysli(o) {
    try { document.dispatchEvent(new CustomEvent("ess:obsah", { detail: o })); } catch (e) { /* starý prohlížeč */ }
  }
  var O = {
    API: API,
    obsah: null,
    nacteno: false, // true = poslední nacti() dostalo odpověď služby
    nacti: function () {
      var ctl = typeof AbortController === "function" ? new AbortController() : null;
      var cas = ctl ? setTimeout(function () { ctl.abort(); }, 8000) : 0;
      return fetch(API + "/obsah", { credentials: "omit", referrerPolicy: "no-referrer", signal: ctl ? ctl.signal : undefined })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (o) { O.nacteno = true; return normalizuj(o); },
          function () { O.nacteno = false; return O.obsah; }) // služba neodpověděla: poslední známý obsah, jinak null
        .then(function (o) { clearTimeout(cas); if (o) O.obsah = o; vysli(o); return o; });
    },
    aplikuj: function (obsah, doc) {
      doc = doc || document;
      if (!obsah) return O.obsah; // služba ještě neodpověděla, není co propsat
      obsah = normalizuj(obsah);
      O.obsah = obsah;
      if (!doc.body) return obsah;
      var neco = Object.keys(obsah.kontakty).length || Object.keys(obsah.texty).length || Object.keys(obsah.fotky).length;
      if (!neco && !zasah) return obsah; // nic k propsání a nic k vrácení
      pracuji = true;
      try {
        vratKontakty(doc);
        aplikujTexty(doc, obsah.texty);
        aplikujKontakty(doc, obsah.kontakty);
        aplikujFotky(doc, obsah.fotky);
      } finally {
        pracuji = false;
        if (pozor) pozor.takeRecords(); // vlastní zásahy nemají spouštět další kolo
      }
      return obsah;
    },
    editovatelny: function (node) {
      var el = node && (node.nodeType === 3 ? node.parentElement : node);
      while (el && el !== el.ownerDocument.body) {
        if (kandidat(el)) { zapamatuj(el); return el; }
        if (!INLINE[el.tagName] && el.tagName !== "SPAN" && el.tagName !== "A" && el.tagName !== "I") return null;
        el = el.parentElement;
      }
      return null;
    },
    klicTextu: function (el) { return kandidat(el) ? zapamatuj(el).klic : null; },
    puvodniHtml: function (el) { return zapamatuj(el).html; },
    aktualniHtml: function (el) { return aktualni(el); },
    kandidati: function (doc) { return vsechnyKandidaty(doc); },
    kontaktyNaStrance: kontaktyNaStrance,
    idKontaktu: idKontaktu,
    fotkyNaStrance: fotkyNaStrance,
    klicFotky: klicFotky,
    urlSouboru: urlSouboru,
    /* adresa fotky pro místa, která web kreslí až později (velký náhled galerie): vyměněná, nebo ta původní */
    urlFotky: function (klic, puvodni) {
      var id = O.obsah && O.obsah.fotky[klic];
      return typeof id === "string" && SOUBOR_RE.test(id) ? urlSouboru(id) : puvodni;
    },
    /* volitelné: po zavolání hlídá nově vložené části stránky (velký náhled, později vykreslené sekce) a obsah
       do nich propíše sám. Bez zavolání skript nic nesleduje. */
    sleduj: function () {
      if (pozor || typeof MutationObserver !== "function") return;
      var cekam = 0;
      pozor = new MutationObserver(function () {
        if (pracuji || cekam) return;
        cekam = setTimeout(function () { cekam = 0; if (O.obsah) O.aplikuj(O.obsah); }, 80);
      });
      pozor.observe(document.documentElement, { childList: true, subtree: true });
    },
    prestan: function () { if (pozor) { pozor.disconnect(); pozor = null; } },
  };
  window.ESSObsah = O;
})();
