"use strict";
// =====================================================================
//  TURNI — gestione dei turni del ristorante
//  Stessa impostazione dell'agenda: viste Anno / Mese / Giorno,
//  scorrimento col dito a sinistra e a destra, frecce della tastiera,
//  tema chiaro / grigio / scuro. Funziona anche offline.
//
//  I dati restano sempre anche su questo dispositivo; cloud.js li
//  sincronizza con Supabase (se configurato in config.js).
// =====================================================================

// ================== DATI ==================
const K_DATI = "turni-dati", K_IO = "turni-io", K_BOZZA = "turni-bozza", K_TEMA = "turni-tema";
const MODALITA_PROVA = !(window.CONFIG && CONFIG.SUPABASE_URL && CONFIG.SUPABASE_CHIAVE);

function leggi(chiave, base) {
  try { const v = JSON.parse(localStorage.getItem(chiave)); return v ?? base; }
  catch { return base; }
}
function scriviLocale(chiave, valore) {
  try { localStorage.setItem(chiave, JSON.stringify(valore)); } catch {}
}
const datiVuoti = () => ({ ristorante: null, profili: [], disponibilita: {}, chiusure: {}, prenotati: {}, turni: {}, bozze: {}, impostazioni: {} });

// D contiene tutto ciò che è del ristorante; io = id della persona che usa l'app
let D = Object.assign(datiVuoti(), leggi(K_DATI, {}));
let io = leggi(K_IO, null);
let ioReale = null;              // con l'app online: il tuo account (io può essere una persona di prova)
const salvaDati = () => scriviLocale(K_DATI, D);
const salvaIo = () => scriviLocale(K_IO, io);
const nuovoId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

const TABELLE = ["disponibilita", "chiusure", "prenotati", "turni", "bozze", "impostazioni"];
function chiaveRiga(tab, r) {
  if (tab === "disponibilita") return `${r.user_id}|${r.giorno}|${r.turno}`;
  if (tab === "chiusure") return r.id;
  if (tab === "impostazioni") return r.chiave;
  return `${r.giorno}|${r.turno}`;
}
// Ogni modifica passa da qui: si salva subito sul dispositivo e parte verso internet appena si può
function scriviRiga(tab, riga) {
  riga.aggiornato = new Date().toISOString();
  riga.ristorante_id = D.ristorante ? D.ristorante.id : null;
  const k = chiaveRiga(tab, riga);
  D[tab][k] = riga;
  salvaDati();
  if (!MODALITA_PROVA && typeof window.cloudAccoda === "function") window.cloudAccoda(tab, k, riga);
}

let vista = "mese";              // "anno", "mese" oppure "giorno"
let dataCorrente = new Date(); dataCorrente.setHours(0, 0, 0, 0);
let filtro = "tutto";            // "tutto", "ufficiali" (solo turni ufficiali), "miei" (solo i miei turni)

const $ = id => document.getElementById(id);
function esc(t) {
  return String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ================== DATE ==================
const pad = n => String(n).padStart(2, "0");
const chiaveData = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const stessoGiorno = (a, b) => chiaveData(a) === chiaveData(b);
const daChiave = k => { const [y, m, g] = k.split("-").map(Number); return new Date(y, m - 1, g); };
const oggiMezzanotte = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const piuGiorni = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const giorniTra = (a, b) => Math.round((b - a) / 864e5);
const dataBreve = k => daChiave(k).toLocaleDateString("it-IT", { day: "numeric", month: "short" });
const dataMedia = k => daChiave(k).toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" });
const dataLunga = k => daChiave(k).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
const passato = k => daChiave(k) < oggiMezzanotte();

// ================== FESTIVI (grigio chiaro, come nell'agenda) ==================
const FESTE_FISSE = ["01-01", "01-06", "04-25", "05-01", "06-02", "08-15", "11-01", "12-08", "12-25", "12-26"];
function pasqua(anno) {
  const a = anno % 19, b = Math.floor(anno / 100), c = anno % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mese = Math.floor((h + l - 7 * m + 114) / 31), giorno = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(anno, mese - 1, giorno);
}
function festivo(d) {
  if (d.getDay() === 0) return true;
  if (FESTE_FISSE.includes(chiaveData(d).slice(5))) return true;
  const p = pasqua(d.getFullYear());
  return stessoGiorno(d, p) || stessoGiorno(d, piuGiorni(p, 1));
}

// ================== PERSONE ==================
const TURNI = ["pranzo", "cena"];
const NOME_TURNO = { pranzo: "Pranzo", cena: "Cena" };
const COL_TURNO = { pranzo: "var(--pranzo)", cena: "var(--cena)" };

const mioProfilo = () => D.profili.find(p => p.id === io) || null;
const sonoAdmin = () => !!(mioProfilo() && mioProfilo().admin);
const profilo = id => D.profili.find(p => p.id === id);
const nomeDi = id => (profilo(id) ? profilo(id).nickname : "?");
// Il creatore del ristorante può provare l'app con persone finte
const sonoCreatore = () => MODALITA_PROVA || !!(D.ristorante && ioReale && D.ristorante.creato_da === ioReale);
const stoProvando = () => !MODALITA_PROVA && ioReale && io !== ioReale;
const esperto = p => !!(p && (p.admin || p.esperto));   // l'amministratore è sempre esperto
// Settore: sala o cucina (chi c'era prima di questa novità è in cucina)
const SETTORI = { sala: "Sala", cucina: "Cucina" };
const settoreDi = p => (p && p.settore === "sala" ? "sala" : "cucina");
let settoreVisto = null;   // il settore che stai guardando; all'apertura è sempre il tuo
// tutti (anche gli amministratori) vedono solo il proprio settore; per cambiarlo: Impostazioni → Il tuo profilo.
// L'altro settore si vede solo col filtro "Turni ufficiali di tutti".
const vistoSettore = () => settoreDi(mioProfilo());
const delSettore = id => !!profilo(id) && settoreDi(profilo(id)) === vistoSettore();
const iniziale = n => (n || "?").trim().charAt(0).toUpperCase();
const perNome = (a, b) => a.nickname.localeCompare(b.nickname, "it", { sensitivity: "base" });

// ================== DISPONIBILITÀ ==================
// "si" = ci sono, "no" = non ci sono, "" = niente segnato
const statoDi = (uid, g, t) => (D.disponibilita[`${uid}|${g}|${t}`] || {}).stato || "";
// Il fisso c'è sempre, tranne quando segna che non c'è; l'occasionale c'è solo se lo segna
function disponibile(p, g, t) {
  const s = statoDi(p.id, g, t);
  return p.tipo === "fisso" ? s !== "no" : s === "si";
}
function elenchi(g, t, tutti = false) {
  const disp = [], nonDisp = [], senza = [];
  D.profili.filter(p => tutti || settoreDi(p) === vistoSettore()).forEach(p => {
    const s = statoDi(p.id, g, t);
    if (s === "no") nonDisp.push(p);
    else if (disponibile(p, g, t)) disp.push(p);
    else senza.push(p);           // occasionale che non ha risposto
  });
  return { disp, nonDisp, senza };
}
function segnaRisposta(g, t, valore, uid = io) {
  const attuale = statoDi(uid, g, t);
  const p = profilo(uid);
  let nuovo;
  if (p && p.tipo === "fisso") {
    // il fisso c'è di base: "Ci sono" toglie il "non ci sono", "Non ci sono" si accende e si spegne
    if (valore === "si") { if (attuale !== "no") return; nuovo = ""; }
    else nuovo = attuale === "no" ? "" : "no";
  } else nuovo = attuale === valore ? "" : valore;
  // cambiando risposta l'orario riparte da "tutto il turno"
  scriviRiga("disponibilita", { user_id: uid, giorno: g, turno: t, stato: nuovo, dalle: "", alle: "" });
}
// Orario in cui ci sei: "" = inizio / fine turno
const orarioDi = (uid, g, t) => { const r = D.disponibilita[`${uid}|${g}|${t}`] || {}; return { dalle: r.dalle || "", alle: r.alle || "" }; };
const oraBreve = h => h.replace(/:00$/, "").replace(/^0(\d)/, "$1");
function testoOrario(o) {
  if (o.dalle && o.alle) return `${oraBreve(o.dalle)}–${oraBreve(o.alle)}`;
  if (o.dalle) return `dalle ${oraBreve(o.dalle)}`;
  if (o.alle) return `fino alle ${oraBreve(o.alle)}`;
  return "";
}
// Orari tra cui scegliere (ogni quarto d'ora)
function orariTurno(t) {
  const [da, a] = t === "pranzo" ? [10, 17] : [17, 25];
  const fuori = [];
  for (let h = da; h <= a; h++) for (const m of [0, 15, 30, 45]) { if (h === a && m) break; fuori.push(`${pad(h % 24)}:${pad(m)}`); }
  return fuori;
}
async function chiediOrario(g, t, uid = io) {
  const o = orarioDi(uid, g, t), ore = orariTurno(t);
  const opzioni = (vuoto, val) => `<option value="">${vuoto}</option>` + ore.map(h => `<option value="${h}" ${h === val ? "selected" : ""}>${h}</option>`).join("");
  const r = await finestra(`${NOME_TURNO[t]} · ${dataMedia(g)}`, `
    <p class="nota" style="margin-top:-8px">Se ci sei solo per una parte del turno, scegli da che ora o fino a che ora. Puoi cambiarne anche solo una.</p>
    <div class="due-campi">
      <label>Inizio<select id="or-dalle">${opzioni("Inizio turno", o.dalle)}</select></label>
      <label>Fine<select id="or-alle">${opzioni("Fine turno", o.alle)}</select></label>
    </div>
    <p class="acc-messaggio nota" id="or-msg"></p>
    ${bottoniOkAnnulla("Salva", `<button type="button" class="chip" data-azione="tutto" style="margin-right:auto">Tutto il turno</button>`)}`, (dlg, fatto) => {
    dlg.querySelector('[data-azione="annulla"]').onclick = () => fatto(undefined);
    dlg.querySelector('[data-azione="tutto"]').onclick = () => fatto({ dalle: "", alle: "" });
    dlg.querySelector("form").onsubmit = e => {
      e.preventDefault();
      const dalle = dlg.querySelector("#or-dalle").value, alle = dlg.querySelector("#or-alle").value;
      // per la cena le ore dopo mezzanotte (00:xx) vengono dopo le 23
      const ord = h => (t === "cena" && h < "12:00" ? "2" : "1") + h;
      if (dalle && alle && ord(alle) <= ord(dalle)) { const m = dlg.querySelector("#or-msg"); m.textContent = "La fine deve essere dopo l'inizio."; m.className = "acc-messaggio nota errore"; return; }
      fatto({ dalle, alle });
    };
  });
  if (!r) return;
  const p = profilo(uid);
  const st = statoDi(uid, g, t);
  const stato = p && p.tipo === "fisso" ? (st === "no" ? "" : st) : "si";
  scriviRiga("disponibilita", { user_id: uid, giorno: g, turno: t, stato, dalle: r.dalle, alle: r.alle });
  disegna();
}

// ================== CHIUSURE ==================
// Una chiusura: dal / al (facoltativo), turno ("tutto", "pranzo", "cena"),
// ripeti ("", "settimana", "mese", "anno"), saltate = giorni riaperti uno per uno
const chiusureAttive = () => Object.values(D.chiusure).filter(c => !c.eliminata);
function regolaCopre(c, d) {
  const k = chiaveData(d);
  if ((c.saltate || []).includes(k)) return false;
  if (c.ripeti && c.fino && k > c.fino) return false;      // la ripetizione finisce qui
  const dal = daChiave(c.dal);
  const durata = c.al ? Math.max(0, giorniTra(dal, daChiave(c.al))) : 0;
  if (d < dal) return false;
  if (!c.ripeti) return giorniTra(dal, d) <= durata;
  if (c.ripeti === "settimana") return durata >= 6 || giorniTra(dal, d) % 7 <= durata;
  // ogni mese / ogni anno: guarda l'inizio in questo periodo e in quello prima
  for (let n = 0; n <= 1; n++) {
    let s;
    if (c.ripeti === "mese") { s = new Date(d.getFullYear(), d.getMonth() - n, dal.getDate()); if (s.getDate() !== dal.getDate()) continue; }
    else { s = new Date(d.getFullYear() - n, dal.getMonth(), dal.getDate()); if (s.getMonth() !== dal.getMonth()) continue; }
    if (s < dal) continue;
    const diff = giorniTra(s, d);
    if (diff >= 0 && diff <= durata) return true;
  }
  return false;
}
const regoleSu = (d, t) => chiusureAttive().filter(c => (!t || c.turno === "tutto" || c.turno === t) && regolaCopre(c, d));
const chiusoTurno = (d, t) => regoleSu(d, t).length > 0;
const chiusoGiorno = d => TURNI.every(t => chiusoTurno(d, t));
const apertoQualcosa = d => TURNI.some(t => !chiusoTurno(d, t));

const NOMI_RIPETI = { "": "Non si ripete", settimana: "Ogni settimana", mese: "Ogni mese", anno: "Ogni anno" };
const NOMI_QUANDO = { tutto: "Tutto il giorno", pranzo: "Solo pranzo", cena: "Solo cena" };
function descriviChiusura(c) {
  const periodo = c.al && c.al !== c.dal ? `dal ${dataBreve(c.dal)} al ${dataBreve(c.al)}` : dataMedia(c.dal);
  const ripeti = c.ripeti === "settimana" ? `ogni ${daChiave(c.dal).toLocaleDateString("it-IT", { weekday: "long" })}` + (c.al && c.al !== c.dal ? ` (${giorniTra(daChiave(c.dal), daChiave(c.al)) + 1} giorni)` : "")
    : c.ripeti === "mese" ? `ogni mese dal giorno ${daChiave(c.dal).getDate()}` : "";
  if (c.ripeti === "anno") return [`${periodo.replace(/ \d{4}$/, "")} ogni anno`, NOMI_QUANDO[c.turno].toLowerCase(), `dal ${daChiave(c.dal).getFullYear()}${c.fino ? ` al ${daChiave(c.fino).getFullYear()}` : ""}`].join(" · ");
  if (c.ripeti) return [ripeti, NOMI_QUANDO[c.turno].toLowerCase(), `dal ${dataBreve(c.dal)}${c.fino ? ` al ${dataBreve(c.fino)}` : ""}`].join(" · ");
  return [periodo, NOMI_QUANDO[c.turno].toLowerCase()].join(" · ");
}

// ================== TURNI UFFICIALI E PRENOTATI ==================
const ufficiali = (g, t) => (D.turni[`${g}|${t}`] || {}).persone || [];
const haUfficiale = (g, t) => !!D.turni[`${g}|${t}`] && ufficiali(g, t).length > 0;
const prenotati = (g, t) => (D.prenotati[`${g}|${t}`] || {}).numero || 0;

// Bozza dell'amministratore: si vede solo su questo dispositivo finché non preme Fine
// Bozza dei turni: la vedono solo gli amministratori; diventa ufficiale con "Rendi ufficiale"
const bozzaAttiva = () => Object.fromEntries(Object.entries(D.bozze).filter(([, r]) => r.attiva).map(([k, r]) => [k, r.persone || []]));
const inBozza = (g, t) => { const r = D.bozze[`${g}|${t}`]; return r && r.attiva ? (r.persone || []) : ufficiali(g, t); };
const haBozza = (g, t) => !!(D.bozze[`${g}|${t}`] && D.bozze[`${g}|${t}`].attiva);
// (versione vecchia: la bozza era solo su questo dispositivo)
(() => { const vecchia = leggi(K_BOZZA, null); if (vecchia && Object.keys(vecchia).length && D.ristorante) setTimeout(() => {
  Object.entries(vecchia).forEach(([k, persone]) => { const [giorno, turno] = k.split("|"); scriviRiga("bozze", { giorno, turno, persone, attiva: true }); });
  try { localStorage.removeItem(K_BOZZA); } catch {}
}, 0); })();

// Ore di ogni turno (le decide l'amministratore nel resoconto)
const ORE_BASE = { pranzo: 3.5, cena: 4.5 };
const oreTurni = () => Object.assign({}, ORE_BASE, ((D.impostazioni.ore || {}).valore) || {});
const testoOre = n => `${String(Math.round(n * 10) / 10).replace(".", ",")} h`;

// Turni programmati in un mese (con la bozza, se serve): 1 per ogni pranzo o cena
function turniNelMese(uid, anno, mese, conBozza = false) {
  const pref = `${anno}-${pad(mese + 1)}-`;
  const chiavi = new Set(Object.keys(D.turni));
  const bozza = conBozza ? bozzaAttiva() : {};
  Object.keys(bozza).forEach(k => chiavi.add(k));
  let n = 0;
  chiavi.forEach(k => {
    if (!k.startsWith(pref)) return;
    const pers = bozza[k] ? bozza[k] : (D.turni[k] || {}).persone || [];
    if (pers.includes(uid)) n++;
  });
  return n;
}
const testoTurni = n => `${n} ${n === 1 ? "turno" : "turni"}`;
function oreNelMese(uid, anno, mese) {
  const pref = `${anno}-${pad(mese + 1)}-`, o = oreTurni();
  return Object.entries(D.turni).reduce((s, [k, r]) => s + (k.startsWith(pref) && (r.persone || []).includes(uid) ? o[r.turno] || 0 : 0), 0);
}

// =====================================================================
//  MENU FLOTTANTE (⋯, tasto destro, tenere premuto) — come nell'agenda
// =====================================================================
const menuEl = $("menu-flottante");
let vociMenu = [];
function mostraMenu(voci, { x, y, ancora } = {}) {
  vociMenu = voci;
  menuEl.innerHTML = voci.map((v, n) => {
    if (v === "-") return "<hr>";
    if (v.info) return `<div class="menu-info">${v.info}</div>`;
    return `<button type="button" data-n="${n}" class="${v.pericolo ? "pericolo" : ""}">${v.testo}</button>`;
  }).join("");
  menuEl.hidden = false;
  if (ancora) { const r = ancora.getBoundingClientRect(); x = r.right; y = r.bottom + 4; }
  const w = menuEl.offsetWidth, h = menuEl.offsetHeight;
  if (x + w > innerWidth - 8) x = innerWidth - w - 8;
  if (y + h > innerHeight - 8) y = Math.max(8, innerHeight - h - 8);
  menuEl.style.left = Math.max(8, x) + "px";
  menuEl.style.top = Math.max(8, y) + "px";
}
function chiudiMenu() { menuEl.hidden = true; }
menuEl.addEventListener("click", e => {
  const b = e.target.closest("button[data-n]");
  if (!b) return;
  e.stopPropagation();
  const voce = vociMenu[b.dataset.n];
  chiudiMenu();
  voce.azione();
});
document.addEventListener("click", e => { if (!e.target.closest(".menu-flottante")) chiudiMenu(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") chiudiMenu(); });
addEventListener("resize", chiudiMenu);
document.addEventListener("scroll", chiudiMenu, true);

function suMenuContestuale(el, apri) {
  let timer = null, aperto = false, inizio = null;
  el.addEventListener("contextmenu", e => { e.preventDefault(); if (aperto) return; apri({ x: e.clientX, y: e.clientY }); });
  el.addEventListener("pointerdown", e => {
    if (e.pointerType === "mouse") return;
    aperto = false; inizio = { x: e.clientX, y: e.clientY };
    timer = setTimeout(() => {
      aperto = true; timer = null;
      if (navigator.vibrate) navigator.vibrate(15);
      apri({ x: inizio.x, y: inizio.y });
    }, 500);
  });
  const annulla = () => { clearTimeout(timer); timer = null; };
  el.addEventListener("pointermove", e => { if (timer && inizio && Math.hypot(e.clientX - inizio.x, e.clientY - inizio.y) > 10) annulla(); });
  el.addEventListener("pointerup", annulla);
  el.addEventListener("pointercancel", annulla);
  el.addEventListener("click", e => { if (aperto) { e.stopPropagation(); e.preventDefault(); aperto = false; } }, true);
}

// =====================================================================
//  FINESTRELLE VELOCI
// =====================================================================
const dlgScelta = $("dlg-scelta");
function finestra(titolo, corpo, prepara) {
  return new Promise(risolvi => {
    let finito = false;
    const fatto = v => { if (finito) return; finito = true; risolvi(v); dlgScelta.close(); };
    dlgScelta.innerHTML = `<form method="dialog" novalidate><h2>${esc(titolo)}</h2>${corpo}</form>`;
    dlgScelta.onclose = () => { if (dlgScelta.open) return; if (!finito) { finito = true; risolvi(undefined); } };
    dlgScelta.querySelector("form").addEventListener("submit", e => e.preventDefault());
    prepara(dlgScelta, fatto);
    dlgScelta.showModal();
  });
}
const bottoniOkAnnulla = (ok = "Salva", extra = "") => `
  <div class="azioni">${extra}
    <button type="button" class="chip" data-azione="annulla">Annulla</button>
    <button type="submit" class="chip primario" data-azione="ok">${ok}</button>
  </div>`;
function avviso(titolo, testo) {
  return finestra(titolo, `<p style="margin-top:0;line-height:1.5">${testo}</p>
    <div class="azioni"><button type="submit" class="chip primario" data-azione="ok">OK</button></div>`,
  (d, fatto) => { d.querySelector("form").onsubmit = e => { e.preventDefault(); fatto(true); }; });
}

// =====================================================================
//  PEZZI CHE SI RIPETONO NELLE VISTE
// =====================================================================
// Pulsanti "Ci sono / Non ci sono" della persona che usa l'app
function bottoniRisposta(g, t, piccoli = false) {
  const p = mioProfilo();
  if (!p || passato(g) || chiusoTurno(daChiave(g), t)) return "";
  if (vistoSettore() !== settoreDi(p)) return "";   // nell'altro settore non ti segni (si cambia dal profilo)
  const s = statoDi(p.id, g, t), cl = piccoli ? " piccolo" : "";
  const ci = p.tipo === "fisso" ? s !== "no" : s === "si";   // il fisso c'è di base
  const or = testoOrario(orarioDi(p.id, g, t));
  const orario = !piccoli && ci ? `<button type="button" class="rb orario ${or ? "impostato" : ""}" data-orario data-g="${g}" data-t="${t}" title="Scegli da che ora a che ora ci sei">🕒 ${or || "Tutto il turno"} <span class="freccia-giu">▾</span></button>` : "";
  return `<div class="risposta">${orario}
    <button type="button" class="rb si${cl} ${ci ? "attivo" : ""}" data-risp="si" data-g="${g}" data-t="${t}">${piccoli && ci && or ? `Ci sono · ${esc(or)}` : "Ci sono"}</button>
    <button type="button" class="rb no${cl} ${s === "no" ? "attivo" : ""}" data-risp="no" data-g="${g}" data-t="${t}">Non ci sono</button></div>`;
}
// Colore di pranzo / cena per chi guarda: verde se ci sei, rosso se non ci sei,
// grigio se sei occasionale e non hai ancora risposto
function coloreMio(g, t) {
  const p = mioProfilo();
  if (!p) return COL_TURNO[t];
  if (statoDi(p.id, g, t) === "no") return "var(--no)";
  return disponibile(p, g, t) ? "var(--si)" : "var(--tenue)";
}
function nomiCorti(ids, max = 3) {
  const io1 = ids.includes(io) ? ["Tu"] : [];
  const altri = ids.filter(x => x !== io).map(nomeDi).sort((a, b) => a.localeCompare(b, "it"));
  const tutti = [...io1, ...altri];
  return tutti.slice(0, max).join(", ") + (tutti.length > max ? ` +${tutti.length - max}` : "");
}
function chipPersona(p, g, { ufficiale = false, t = null } = {}) {
  const d = daChiave(g);
  const n = turniNelMese(p.id, d.getFullYear(), d.getMonth());
  const or = t ? testoOrario(orarioDi(p.id, g, t)) : "";
  return `<span class="persona ${ufficiale ? "ufficiale" : ""} ${p.id === io ? "io" : ""}">${esc(p.nickname)}${or ? `<span class="orario-pers">${esc(or)}</span>` : ""}${sonoAdmin() && esperto(p) ? ` <span class="badge" title="Esperto (lo vedi solo tu)">E</span>` : ""}<span class="conta-turni" title="Turni programmati nel mese">${n}</span></span>`;
}

// =====================================================================
//  VISTE DEL CALENDARIO
// =====================================================================
// ---------- Anno ----------
function disegnaAnno() {
  const anno = dataCorrente.getFullYear();
  $("titolo").innerHTML = `<span class="t-grande">${anno}</span>`;
  const oggi = new Date();
  let html = "";
  for (let mese = 0; mese < 12; mese++) {
    const primo = new Date(anno, mese, 1);
    const vuoti = (primo.getDay() + 6) % 7;
    const giorniNelMese = new Date(anno, mese + 1, 0).getDate();
    let celle = ["L", "M", "M", "G", "V", "S", "D"].map(g => `<div class="intest">${g}</div>`).join("");
    celle += "<div></div>".repeat(vuoti);
    for (let g = 1; g <= giorniNelMese; g++) {
      const d = new Date(anno, mese, g), k = chiaveData(d);
      const mio = TURNI.some(t => ufficiali(k, t).includes(io));
      const classi = ["mini-giorno", festivo(d) ? "festivo" : "", d < oggiMezzanotte() ? "passato" : "", chiusoGiorno(d) ? "chiuso" : "", mio ? "mio" : "", stessoGiorno(d, oggi) ? "oggi" : ""].join(" ");
      celle += `<div class="${classi}" data-giorno="${k}">${g}</div>`;
    }
    html += `<div class="mini-mese"><h3 data-mese="${mese}">${primo.toLocaleDateString("it-IT", { month: "long" })}</h3><div class="mini-griglia">${celle}</div></div>`;
  }
  $("contenuto").innerHTML = `<section class="anno">${html}</section>`;
  $("contenuto").querySelectorAll(".mini-giorno").forEach(c => c.addEventListener("click", () => vaiAGiorno(daChiave(c.dataset.giorno))));
  $("contenuto").querySelectorAll(".mini-mese h3").forEach(h =>
    h.addEventListener("click", () => { dataCorrente = new Date(anno, Number(h.dataset.mese), 1); vista = "mese"; disegna(); }));
}

// ---------- Mese ----------
let giornoSelezionato = null;
function selezioneIniziale() {
  const oggi = new Date();
  return oggi.getFullYear() === dataCorrente.getFullYear() && oggi.getMonth() === dataCorrente.getMonth() ? chiaveData(oggi) : null;
}
function contenutoCella(d) {
  const k = chiaveData(d);
  if (chiusoGiorno(d)) {
    const nota = regoleSu(d).map(c => c.nota).find(Boolean);
    return `<div class="scritta-chiuso">Chiuso</div>${nota ? `<div class="etichetta chiusa"><span class="et-titolo">${esc(nota)}</span></div>` : ""}`;
  }
  let etichette = "", pillole = "";
  TURNI.forEach(t => {
    const sigla = t === "pranzo" ? "P" : "C";
    if (chiusoTurno(d, t)) {
      if (filtro !== "tutto") return;
      etichette += `<div class="etichetta chiusa"><span class="et-titolo">${NOME_TURNO[t]} chiuso</span></div>`;
      pillole += `<span class="pillola chiusa">${sigla}✕</span>`;
      return;
    }
    const tuttiU = ufficiali(k, t), mio = tuttiU.includes(io);
    const uff = filtro === "ufficiali" ? tuttiU : tuttiU.filter(delSettore);
    if (filtro === "miei") {
      if (!mio) return;
      etichette += `<div class="etichetta mio-turno" style="--col:${COL_TURNO[t]}"><span class="et-titolo">★ ${NOME_TURNO[t]} · sei di turno</span></div>`;
      pillole += `<span class="pillola mio-turno" style="--col:${COL_TURNO[t]}">★${sigla}</span>`;
      return;
    }
    if (filtro === "ufficiali" || filtro === "settore") {
      if (!uff.length) return;
      etichette += `<div class="etichetta ufficiale ${mio ? "mio-turno" : ""}" style="--col:${COL_TURNO[t]}"><span class="et-titolo">${mio ? "★ " : ""}${sigla} · ${esc(nomiCorti(uff, 4))}</span></div>`;
      pillole += `<span class="pillola ufficiale ${mio ? "mio-turno" : ""}" style="--col:${COL_TURNO[t]}">${mio ? "★" : ""}${sigla}${uff.length}</span>`;
      return;
    }
    // verde = ci sei, rosso = non ci sei (pieno se sei nel turno ufficiale)
    const col = coloreMio(k, t);
    const assente = mioProfilo() && statoDi(io, k, t) === "no" ? "assente" : "";
    const presente = !assente && mioProfilo() && disponibile(mioProfilo(), k, t) ? "presente" : "";
    if (sonoAdmin() && haBozza(k, t)) {
      const b = inBozza(k, t).filter(delSettore);
      etichette += `<div class="etichetta bozza" style="--col:${COL_TURNO[t]}"><span class="et-titolo">${sigla} · ✎ ${b.length ? esc(nomiCorti(b)) : "nessuno"}</span></div>`;
      pillole += `<span class="pillola bozza" style="--col:${COL_TURNO[t]}">${sigla}${b.length}</span>`;
    } else if (uff.length) {
      etichette += mio
        ? `<div class="etichetta mio-turno" style="--col:${col}"><span class="et-titolo">★ ${NOME_TURNO[t]} · sei di turno</span></div>`
        : `<div class="etichetta ufficiale ${assente} ${presente}" style="--col:${col}"><span class="et-titolo">${sigla} · ${esc(nomiCorti(uff))}</span></div>`;
      pillole += `<span class="pillola ufficiale ${mio ? "mio-turno" : `${assente} ${presente}`}" style="--col:${col}">${mio ? "★" + sigla : sigla + uff.length}</span>`;
    } else {
      const n = elenchi(k, t).disp.length;
      etichette += `<div class="etichetta ${assente} ${presente}" style="--col:${col}"><span class="et-titolo">${NOME_TURNO[t]} · ${assente ? "non ci sei" : n + " disp."}</span></div>`;
      pillole += `<span class="pillola ${assente} ${presente}" style="--col:${col}">${sigla}${assente ? "✕" : n}</span>`;
    }
  });
  // prenotati: in blu sotto la cena, così si vedono a colpo d'occhio
  const pren = TURNI.filter(t => !chiusoTurno(d, t) && prenotati(k, t) > 0);
  const testoPren = pren.map(t => (pren.length > 1 || t === "pranzo" ? (t === "pranzo" ? "P " : "C ") : "") + prenotati(k, t)).join(" · ");
  const righePren = pren.length ? `<div class="pren-cella" title="${pren.map(t => `${NOME_TURNO[t]}: ${prenotati(k, t)} prenotati`).join(" · ")}"><b>${testoPren}</b> <span>prenotati</span></div>` : "";
  return `<div class="pillole">${pillole}</div>${etichette}${righePren}`;
}
function disegnaMese() {
  const anno = dataCorrente.getFullYear(), mese = dataCorrente.getMonth();
  $("titolo").innerHTML = `<span class="t-grande">${dataCorrente.toLocaleDateString("it-IT", { month: "long" })}</span> <span class="t-piccolo">${anno}</span>`;
  if (giornoSelezionato) { const s = daChiave(giornoSelezionato); if (s.getFullYear() !== anno || s.getMonth() !== mese) giornoSelezionato = null; }
  if (giornoSelezionato === null) giornoSelezionato = selezioneIniziale();

  const primo = new Date(anno, mese, 1);
  const inizio = piuGiorni(primo, -((primo.getDay() + 6) % 7));
  const oggi = new Date();
  let celle = "";
  for (let n = 0; n < 42; n++) {
    const d = piuGiorni(inizio, n), k = chiaveData(d);
    const chiuso = chiusoGiorno(d), parziale = !chiuso && TURNI.some(t => chiusoTurno(d, t));
    const mio = TURNI.some(t => ufficiali(k, t).includes(io));
    const classi = ["cella", d.getMonth() !== mese ? "fuori" : "", festivo(d) ? "festivo" : "", d < oggiMezzanotte() ? "passato" : "",
      chiuso ? "chiuso" : "", parziale && filtro === "tutto" ? "chiuso-parziale" : "",
      mio ? "mio" : "",
      !selChiusure && k === giornoSelezionato ? "selezionato" : "", stessoGiorno(d, oggi) ? "oggi" : "",
      selChiusure && selChiusure.has(k) ? "sel-chiusura" : "", selChiusure ? "in-selezione" : ""].join(" ");
    celle += `<div class="${classi}" data-giorno="${k}"><div class="numero">${d.getDate()}</div>${contenutoCella(d)}</div>`;
  }
  $("contenuto").innerHTML = `
    <section class="mese">
      <div class="mese-cal">
        <div class="intestazione">${["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"].map(g => `<div>${g}</div>`).join("")}</div>
        <div class="griglia">${celle}</div>
      </div>
      <aside class="anteprima-giorno" id="anteprima-giorno"></aside>
    </section>`;
  $("contenuto").querySelectorAll(".cella").forEach(c => {
    c.addEventListener("click", () => {
      const k = c.dataset.giorno;
      if (selChiusure) { toccaGiornoChiusura(k, c); return; }
      if (k === giornoSelezionato) { vaiAGiorno(daChiave(k)); return; }   // secondo tocco: apre la giornata
      giornoSelezionato = k;
      $("contenuto").querySelectorAll(".cella.selezionato").forEach(x => x.classList.remove("selezionato"));
      c.classList.add("selezionato");
      disegnaAnteprima();
    });
    suMenuContestuale(c, pos => { if (!selChiusure) mostraMenu(vociGiorno(c.dataset.giorno), pos); });
  });
  disegnaAnteprima();
}

// Elenco del giorno selezionato, sotto (telefono/iPad) o di lato (schermi larghi)
function disegnaAnteprima() {
  const box = $("anteprima-giorno");
  if (!box) return;
  if (selChiusure) { disegnaElencoSelezione(box); return; }
  if (!giornoSelezionato) {
    box.innerHTML = `<div class="ant-vuota">Tocca un giorno per vedere chi c'è e segnare le tue presenze.<br>Toccalo di nuovo per aprire la giornata.</div>`;
    return;
  }
  const g = giornoSelezionato, d = daChiave(g);
  let corpo = "";
  if (chiusoGiorno(d)) {
    const nota = regoleSu(d).map(c => c.nota).find(Boolean);
    corpo = `<div class="ant-chiuso">Ristorante chiuso${nota ? ` · ${esc(nota)}` : ""}</div>`;
  } else {
    corpo = TURNI.map(t => {
      if (chiusoTurno(d, t)) return `<div class="ant-turno" style="--col:var(--chiuso)"><span class="ant-barra" style="background:var(--chiuso)"></span><span class="ant-testo"><span class="ant-tit">${NOME_TURNO[t]}</span><span class="ant-sotto">Chiuso</span></span><span></span></div>`;
      const uff = filtro === "ufficiali" ? ufficiali(g, t) : ufficiali(g, t).filter(delSettore), { disp } = elenchi(g, t);
      const sotto = uff.includes(io)
        ? `<span class="sei-di-turno">★ Sei di turno</span> ${uff.length > 1 ? `con ${esc(nomiCorti(uff.filter(x => x !== io), 5))}` : ""}`
        : uff.length
        ? `Turno: <b>${esc(nomiCorti(uff, 6))}</b>`
        : disp.length ? `${disp.length} disponibili: ${esc(nomiCorti(disp.map(p => p.id), 4))}` : "Nessuno disponibile";
      return `
        <div class="ant-turno" style="--col:${coloreMio(g, t)}">
          <span class="ant-barra"></span>
          <span class="ant-testo" data-apri-giorno><span class="ant-tit">${NOME_TURNO[t]}${prenotati(g, t) ? ` <span class="prenotati" style="font-size:13px;padding:1px 8px">${prenotati(g, t)} <small>prenotati</small></span>` : ""}</span><span class="ant-sotto">${sotto}</span></span>
          ${bottoniRisposta(g, t, true) || "<span></span>"}
        </div>`;
    }).join("");
  }
  box.innerHTML = `
    <button type="button" class="ant-testa" data-apri-giorno>
      <span class="ant-data">${esc(dataLunga(g))}</span>
      <span class="ant-apri">Apri la giornata ›</span>
    </button>
    <div class="ant-lista">${corpo}</div>`;
  box.querySelectorAll("[data-apri-giorno]").forEach(b => b.addEventListener("click", () => vaiAGiorno(d)));
}

// ---------- Giorno ----------
function disegnaGiorno() {
  const g = chiaveData(dataCorrente), d = dataCorrente;
  $("titolo").innerHTML = `<span class="t-piccolo">${d.toLocaleDateString("it-IT", { weekday: "short" })}</span> <span class="t-grande">${d.toLocaleDateString("it-IT", { day: "numeric", month: "long" })}</span>`;
  let html = `<div class="giorno-testa"><div class="dettaglio">${festivo(d) ? "Festivo · " : ""}${passato(g) ? "Giorno passato" : stessoGiorno(d, new Date()) ? "Oggi" : ""}</div>
    <button class="opzioni-btn" id="g-opzioni" aria-label="Altre opzioni" title="Chi non c'è e altre opzioni">⋯</button></div>`;

  const regole = regoleSu(d);
  const mp = mioProfilo();
  if (mp && vistoSettore() !== settoreDi(mp) && !passato(g) && !chiusoGiorno(d))
    html += `<div class="avviso-settore">Stai guardando la <b>${SETTORI[vistoSettore()].toLowerCase()}</b>: tu sei in ${SETTORI[settoreDi(mp)].toLowerCase()}, quindi qui non puoi segnarti. Per cambiare settore: <b>Impostazioni → Il tuo profilo</b>.</div>`;
  if (chiusoGiorno(d)) {
    const nota = regole.map(c => c.nota).find(Boolean);
    html += `<div class="banda-chiuso">Ristorante chiuso${nota ? ` <small>· ${esc(nota)}</small>` : ""}
      ${sonoAdmin() ? `<button type="button" class="chip" id="g-riapri">Riapri questo giorno</button>` : ""}</div>`;
  }
  html += TURNI.map(t => {
    if (chiusoTurno(d, t)) {
      if (chiusoGiorno(d)) return "";
      return `<div class="card-turno chiusa"><div class="card-testa"><h3>${NOME_TURNO[t]}</h3><span class="dettaglio">Chiuso</span></div></div>`;
    }
    const uff = ufficiali(g, t).filter(delSettore), { disp } = elenchi(g, t);
    const altroSettore = vistoSettore() === "sala" ? "cucina" : "sala";
    const uffAltro = ufficiali(g, t).filter(id => profilo(id) && settoreDi(profilo(id)) === altroSettore);
    const np = prenotati(g, t);
    const pren = sonoAdmin()
      ? `<button type="button" class="prenotati ${np ? "" : "vuoto"}" data-prenotati="${t}" title="Cambia i prenotati">${np ? `${np} <small>prenotati</small>` : "+ prenotati"}</button>`
      : np ? `<span class="prenotati">${np} <small>prenotati</small></span>` : "";
    const pUff = uff.map(profilo).filter(Boolean).sort(perNome);
    const espertiUff = pUff.filter(esperto).length;
    const altri = disp.filter(p => !uff.includes(p.id));
    return `
      <div class="card-turno ${uff.includes(io) ? "mio" : ""}" style="--col:${coloreMio(g, t)}">
        <div class="card-testa"><h3>${NOME_TURNO[t]}</h3>${uff.includes(io) ? `<span class="sei-di-turno grande">★ Sei di turno</span>` : ""}${pren}${bottoniRisposta(g, t)}</div>
        <div class="sez-tit riga-uff">${uff.length ? `Turno ufficiale ${SETTORI[vistoSettore()].toLowerCase()} · ${uff.length} ${uff.length === 1 ? "persona" : "persone"}${sonoAdmin() ? ` · ${espertiUff} esperti` : ""}` : "Turno ufficiale · non ancora fatto"}
          ${sonoAdmin() ? `<button type="button" class="mod-turni" data-modifica-turni>✏️ ${uff.length ? "Modifica" : "Crea"}</button>` : ""}</div>
        ${uff.length ? `<div class="persone">${pUff.map(p => chipPersona(p, g, { ufficiale: true, t })).join("")}</div>` : ""}
        ${filtro === "ufficiali" && uffAltro.length ? `<div class="altro-settore">In ${SETTORI[altroSettore].toLowerCase()}: ${esc(nomiCorti(uffAltro, 8))}</div>` : ""}
        ${filtro === "ufficiali" || filtro === "settore" ? "" : `<div class="sez-tit">${uff.length ? "Altri disponibili" : "Disponibili"} (${altri.length})</div>
        <div class="persone">${altri.length ? altri.sort(perNome).map(p => chipPersona(p, g, { t })).join("") : `<span class="vuoto-piccolo">${uff.length ? "Nessun altro" : "Nessuno ha detto che c'è"}</span>`}</div>`}
      </div>`;
  }).join("");
  $("contenuto").innerHTML = `<section class="giorno">${html}</section>`;
  $("g-opzioni").addEventListener("click", e => { e.stopPropagation(); mostraMenu(vociGiorno(g), { ancora: e.currentTarget }); });
  const r = $("g-riapri");
  if (r) r.addEventListener("click", () => riapriGiorno(g));
  $("contenuto").querySelectorAll("[data-prenotati]").forEach(b => b.addEventListener("click", () => chiediPrenotati(g)));
  $("contenuto").querySelectorAll("[data-modifica-turni]").forEach(b => b.addEventListener("click", () => apriCrea(g)));
}

// Tasto in alto a sinistra: guardi la sala o la cucina
function aggiornaSettore() {
  const b = $("btn-settore");
  if (!b) return;
  b.hidden = !mioProfilo();
  const puoCambiare = false;
  b.innerHTML = `<span class="set-nome">${SETTORI[vistoSettore()]}</span>${puoCambiare ? `<span class="set-cambia">⇄</span>` : ""}`;
  b.title = (puoCambiare ? `Stai guardando: ${SETTORI[vistoSettore()].toLowerCase()} · tocca per cambiare` : `Il tuo settore: ${SETTORI[vistoSettore()].toLowerCase()} · si cambia da Impostazioni → Il tuo profilo`) + (D.ristorante ? ` · ${D.ristorante.nome}` : "");
  b.classList.toggle("bloccato", !puoCambiare);
  b.classList.toggle("altro", vistoSettore() !== settoreDi(mioProfilo()));
}
$("btn-settore").addEventListener("click", () => {
  return;   // il settore si cambia solo dal profilo
  settoreVisto = vistoSettore() === "sala" ? "cucina" : "sala";
  aggiornaFiltro(); disegna(); aggiornaPannello();
});
function vaiAGiorno(d) { dataCorrente = new Date(d.getFullYear(), d.getMonth(), d.getDate()); vista = "giorno"; disegna(); }

// Pulsanti "Ci sono / Non ci sono" e orario, ovunque si trovino
$("contenuto").addEventListener("click", e => {
  const o = e.target.closest("[data-orario]");
  if (o) { e.stopPropagation(); chiediOrario(o.dataset.g, o.dataset.t); return; }
  const b = e.target.closest("[data-risp]");
  if (!b) return;
  e.stopPropagation();
  segnaRisposta(b.dataset.g, b.dataset.t, b.dataset.risp);
  disegna();
});

// =====================================================================
//  MENU ⋯ DEL GIORNO: chi non c'è + azioni dell'amministratore
// =====================================================================
function vociGiorno(g) {
  const d = daChiave(g);
  const voci = [];
  if (!chiusoGiorno(d)) {
    const righe = TURNI.filter(t => !chiusoTurno(d, t)).map(t => {
      const { nonDisp, senza } = elenchi(g, t);
      return `<b>${NOME_TURNO[t]} · non ci sono</b>${nonDisp.length ? nonDisp.sort(perNome).map(p => esc(p.nickname)).join(", ") : "nessuno"}` +
        (senza.length ? `<br><span style="color:var(--tenue)">Non hanno risposto: ${senza.sort(perNome).map(p => esc(p.nickname)).join(", ")}</span>` : "");
    }).join("");
    voci.push({ info: righe });
  } else voci.push({ info: "<b>Ristorante chiuso</b>Nessun turno in questo giorno." });
  voci.push("-");
  voci.push({ testo: "📅 Apri la giornata", azione: () => vaiAGiorno(d) });
  if (!sonoAdmin()) return voci;

  if (!chiusoGiorno(d)) {
    voci.push({ testo: TURNI.some(t => haUfficiale(g, t)) ? "✏️ Modifica i turni ufficiali" : "📋 Crea bozza o turni da qui", azione: () => apriCrea(g) });
    voci.push({ testo: "🔵 Prenotati", azione: () => chiediPrenotati(g) });
  }
  const regole = regoleSu(d);
  if (regole.length) {
    const q = nomiOccorrenza(d);
    regole.forEach(c => {
      voci.push("-");
      if (regole.length > 1) voci.push({ info: `<b>${esc(NOMI_QUANDO[c.turno])}${c.nota ? " · " + esc(c.nota) : ""}</b>` });
      if (c.ripeti) {
        const tutti = q[c.ripeti];
        voci.push({ testo: `✏️ Modifica solo ${q.questo}`, azione: () => modificaUnGiorno(c, g) });
        voci.push({ testo: `✏️ Modifica ${tutti}`, azione: () => modificaChiusura(c) });
        voci.push({ testo: `🟢 Apri solo ${q.questo}`, azione: () => apriUnGiorno(c, g) });
        voci.push({ testo: `🟢 Apri ${tutti}`, pericolo: true, azione: () => eliminaChiusura(c, `Aprire ${tutti}? La chiusura viene tolta del tutto.`) });
      } else if (c.al) {
        voci.push({ testo: "✏️ Modifica solo questo giorno", azione: () => modificaUnGiorno(c, g) });
        voci.push({ testo: "✏️ Modifica tutto il periodo", azione: () => modificaChiusura(c) });
        voci.push({ testo: "🟢 Apri solo questo giorno", azione: () => apriUnGiorno(c, g) });
        voci.push({ testo: "🟢 Apri tutto il periodo", pericolo: true, azione: () => eliminaChiusura(c) });
      } else {
        voci.push({ testo: "✏️ Modifica la chiusura", azione: () => modificaUnGiorno(c, g) });
        voci.push({ testo: "🟢 Apri questo giorno", azione: () => apriUnGiorno(c, g) });
      }
    });
  }
  if (!chiusoGiorno(d)) { voci.push("-"); voci.push({ testo: "🔴 Segna chiusura", azione: () => avviaSelezioneChiusure(g) }); }
  return voci;
}

// =====================================================================
//  CHIUSURE (solo amministratore)
// =====================================================================
// Come si chiamano "questo giorno" e "tutti" in base al giorno della settimana
function nomiOccorrenza(d) {
  const n = d.toLocaleDateString("it-IT", { weekday: "long" });
  const plurali = { domenica: "tutte le domeniche", sabato: "tutti i sabati" };
  return {
    questo: n === "domenica" ? "questa domenica" : `questo ${n}`,
    settimana: plurali[n] || `tutti i ${n}`,
    mese: `ogni mese (il ${d.getDate()})`,
    anno: `ogni anno (il ${d.toLocaleDateString("it-IT", { day: "numeric", month: "long" })})`,
  };
}
const turnoDaScelte = s => (s.pranzo && s.cena ? "tutto" : s.pranzo ? "pranzo" : s.cena ? "cena" : null);
const scelteDaTurno = t => ({ pranzo: t === "tutto" || t === "pranzo", cena: t === "tutto" || t === "cena" });
const chipTurni = sc => TURNI.map(t => `<button type="button" class="chip-turno ${sc[t] ? "attivo" : ""}" data-t="${t}">${NOME_TURNO[t]}</button>`).join("");
function collegaChipTurni(dlg, sc, dopo = () => {}) {
  dlg.querySelectorAll(".chip-turno[data-t]").forEach(b => b.onclick = () => {
    sc[b.dataset.t] = !sc[b.dataset.t]; b.classList.toggle("attivo", sc[b.dataset.t]); dopo();
  });
}

// Modifica TUTTE le volte di una chiusura (o tutto il periodo)
async function modificaChiusura(c) {
  if (!sonoAdmin() || !c) return;
  chiudiMenu();
  const sc = scelteDaTurno(c.turno);
  let rip = c.ripeti || "";
  const r = await finestra("Modifica chiusura", `
    <div class="campo"><span>Chiuso a</span><div class="rs-turni">${chipTurni(sc)}</div></div>
    <div class="campo"><span>Ripetizione</span>
      <div class="segmenti larghi rip-4" id="ch-rip">${Object.entries(NOMI_RIP_BREVI).map(([k, n]) => `<button type="button" class="seg ${k === rip ? "attivo" : ""}" data-rip="${k}">${n}</button>`).join("")}</div>
    </div>
    <div class="due-campi">
      <label id="ch-dal-l">Dal<input id="ch-dal" type="date" value="${esc(c.dal)}"></label>
      <label id="ch-al-l">Al (facoltativo)<input id="ch-al" type="date" value="${esc(c.ripeti ? (c.fino || "") : (c.al || ""))}"></label>
    </div>
    <p class="nota" id="ch-spiega" style="margin:0 0 14px"></p>
    <label>Nota (facoltativa)<input id="ch-nota" value="${esc(c.nota || "")}" maxlength="40" placeholder="Es. Ferie, riposo settimanale"></label>
    <p class="acc-messaggio nota" id="ch-msg"></p>
    ${bottoniOkAnnulla()}`, (dlg, fatto) => {
    const dal = dlg.querySelector("#ch-dal"), al = dlg.querySelector("#ch-al");
    const aggiorna = () => {
      dlg.querySelector("#ch-dal-l").firstChild.textContent = rip ? "Si ripete dal" : "Dal";
      dlg.querySelector("#ch-al-l").firstChild.textContent = rip ? "Fino al (vuoto = sempre)" : "Al (per più giorni di fila)";
      const t = turnoDaScelte(sc);
      dlg.querySelector("#ch-spiega").textContent = !dal.value ? "" : !t ? "Pranzo e cena aperti: la chiusura verrà tolta." :
        (rip ? spiegaRipetizione(rip, [dal.value]).replace(/, a partire da .*$/, ".") : "Solo " + (al.value && al.value > dal.value ? `dal ${dataBreve(dal.value)} al ${dataBreve(al.value)}` : dataBreve(dal.value)) + ".") +
        (rip && al.value ? ` Fino al ${dataBreve(al.value)}.` : "") + ((c.saltate || []).length ? ` I ${c.saltate.length} giorni aperti a parte restano aperti.` : "");
    };
    dlg.querySelectorAll("[data-rip]").forEach(b => b.onclick = () => {
      rip = b.dataset.rip; dlg.querySelectorAll("[data-rip]").forEach(x => x.classList.toggle("attivo", x === b)); aggiorna();
    });
    collegaChipTurni(dlg, sc, aggiorna);
    [dal, al].forEach(x => x.addEventListener("change", aggiorna));
    aggiorna();
    dlg.querySelector('[data-azione="annulla"]').onclick = () => fatto(undefined);
    dlg.querySelector("form").onsubmit = e => {
      e.preventDefault();
      if (!dal.value) return;
      if (al.value && al.value < dal.value) { const m = dlg.querySelector("#ch-msg"); m.textContent = "La data finale è prima di quella iniziale."; m.className = "acc-messaggio nota errore"; return; }
      fatto({ dal: dal.value, fine: al.value && al.value !== dal.value ? al.value : "", turno: turnoDaScelte(sc), nota: dlg.querySelector("#ch-nota").value.trim() });
    };
  });
  if (!r) return;
  if (!r.turno) { scriviRiga("chiusure", { ...c, eliminata: true }); }
  else scriviRiga("chiusure", {
    ...c, dal: r.dal, turno: r.turno, ripeti: rip, nota: r.nota,
    al: rip ? (c.ripeti ? c.al || null : null) : (r.fine || null),   // "al" = più giorni di fila (solo senza ripetizione)
    fino: rip ? (r.fine || null) : null,                              // "fino" = quando smette di ripetersi
    eliminata: false,
  });
  disegna(); aggiornaPannello();
}

// Modifica UNA SOLA volta: quel giorno esce dalla serie e diventa una chiusura a parte
async function modificaUnGiorno(c, g) {
  if (!sonoAdmin()) return;
  chiudiMenu();
  const d = daChiave(g);
  const sc = scelteDaTurno(c.turno);
  const singola = !c.ripeti && !c.al;
  const r = await finestra(`${d.toLocaleDateString("it-IT", { weekday: "long" }).replace(/^./, x => x.toUpperCase())} ${d.toLocaleDateString("it-IT", { day: "numeric", month: "long" })}`, `
    <p class="nota" style="margin-top:-8px">${singola ? "Cambi questa chiusura." : `Cambi solo questo giorno: ${esc(c.ripeti ? nomiOccorrenza(d)[c.ripeti] : "il resto del periodo")} ${c.ripeti ? "restano" : "resta"} come prima.`}</p>
    <div class="campo"><span>Chiuso a</span><div class="rs-turni">${chipTurni(sc)}</div>
      <p class="nota" id="ug-spiega" style="margin:2px 0 0"></p></div>
    <label>Nota (facoltativa)<input id="ug-nota" value="${esc(c.nota || "")}" maxlength="40"></label>
    ${bottoniOkAnnulla()}`, (dlg, fatto) => {
    const spiega = () => {
      const t = turnoDaScelte(sc);
      dlg.querySelector("#ug-spiega").textContent = !t ? "Pranzo e cena aperti: questo giorno torna aperto." : t === "tutto" ? "Chiuso tutto il giorno." : `Chiuso solo a ${NOME_TURNO[t].toLowerCase()}, aperto a ${t === "pranzo" ? "cena" : "pranzo"}.`;
    };
    collegaChipTurni(dlg, sc, spiega); spiega();
    dlg.querySelector('[data-azione="annulla"]').onclick = () => fatto(undefined);
    dlg.querySelector("form").onsubmit = e => { e.preventDefault(); fatto({ turno: turnoDaScelte(sc), nota: dlg.querySelector("#ug-nota").value.trim() }); };
  });
  if (!r) return;
  if (singola) {
    scriviRiga("chiusure", r.turno ? { ...c, turno: r.turno, nota: r.nota } : { ...c, eliminata: true });
  } else {
    scriviRiga("chiusure", { ...c, saltate: [...new Set([...(c.saltate || []), g])] });
    if (r.turno) scriviRiga("chiusure", { id: nuovoId(), dal: g, al: null, fino: null, turno: r.turno, ripeti: "", nota: r.nota, saltate: [], eliminata: false });
  }
  disegna(); aggiornaPannello();
}
function apriUnGiorno(c, g) {
  if (!sonoAdmin()) return;
  if (!c.ripeti && !c.al) scriviRiga("chiusure", { ...c, eliminata: true });
  else scriviRiga("chiusure", { ...c, saltate: [...new Set([...(c.saltate || []), g])] });
  disegna(); aggiornaPannello();
}
function riapriGiorno(g) {
  const regole = regoleSu(daChiave(g));
  if (!regole.length) return;
  if (!confirm(`Riaprire il ristorante ${dataLunga(g)}? Le altre chiusure restano come sono.`)) return;
  regole.forEach(c => {
    if (!c.ripeti && !c.al) scriviRiga("chiusure", { ...c, eliminata: true });          // chiusura di un giorno solo: si toglie
    else scriviRiga("chiusure", { ...c, saltate: [...(c.saltate || []), g] });
  });
  disegna(); aggiornaPannello();
}
function eliminaChiusura(c, domanda) {
  if (!confirm(domanda || (c.ripeti ? "Eliminare questa chiusura e tutte le sue ripetizioni?" : "Eliminare questa chiusura?"))) return;
  scriviRiga("chiusure", { ...c, eliminata: true });
  disegna(); aggiornaPannello();
}


// =====================================================================
//  SEGNA CHIUSURE TOCCANDO I GIORNI DEL MESE (solo amministratore)
//  1) tocchi i giorni  2) Avanti  3) per ogni giorno pranzo / cena,
//  ripetizione (una volta, ogni settimana, ogni mese, ogni anno), conferma
// =====================================================================
let selChiusure = null;   // Set dei giorni scelti, oppure null se non stai selezionando
const NOMI_RIP_BREVI = { "": "Una volta", settimana: "Ogni settimana", mese: "Ogni mese", anno: "Ogni anno" };
function avviaSelezioneChiusure(giorno = null) {
  if (!sonoAdmin()) return;
  chiudiMenu(); chiudiPannello();
  selChiusure = new Set();
  if (giorno && !passato(giorno) && !chiusoGiorno(daChiave(giorno))) selChiusure.add(giorno);
  if (giorno) dataCorrente = new Date(daChiave(giorno).getFullYear(), daChiave(giorno).getMonth(), 1);
  vista = "mese";
  disegna();
}
function esciSelezioneChiusure() { selChiusure = null; disegna(); }
function toccaGiornoChiusura(k, cella) {
  if (passato(k)) { segnalaBarra("I giorni passati non si possono chiudere"); return; }
  if (chiusoGiorno(daChiave(k))) { segnalaBarra("Questo giorno è già chiuso: per riaprirlo usa ⋯ sul giorno"); return; }
  selChiusure.has(k) ? selChiusure.delete(k) : selChiusure.add(k);
  cella.classList.toggle("sel-chiusura", selChiusure.has(k));
  aggiornaBarraSelezione();
  disegnaAnteprima();
}
let timerBarra = null;
function segnalaBarra(testo) {
  const s = $("bs-sotto");
  s.textContent = testo; s.classList.add("avviso");
  clearTimeout(timerBarra);
  timerBarra = setTimeout(() => { s.classList.remove("avviso"); aggiornaBarraSelezione(); }, 2200);
}
function aggiornaBarraSelezione() {
  const barra = $("barra-sel");
  barra.hidden = !selChiusure;
  document.body.classList.toggle("selezione-chiusure", !!selChiusure);
  if (!selChiusure) return;
  const n = selChiusure.size;
  $("bs-titolo").textContent = n ? `${n} ${n === 1 ? "giorno scelto" : "giorni scelti"}` : "Tocca i giorni da chiudere";
  if (!$("bs-sotto").classList.contains("avviso"))
    $("bs-sotto").textContent = n ? "Tocca ancora un giorno per toglierlo · scorri per cambiare mese" : "Scorri o usa le frecce per cambiare mese";
  $("bs-avanti").disabled = !n;
}
function disegnaElencoSelezione(box) {
  const giorni = [...selChiusure].sort();
  box.innerHTML = `
    <div class="ant-testa" style="cursor:default"><span class="ant-data">Giorni da chiudere</span><span class="ant-apri" style="color:var(--chiuso)">${giorni.length || ""}</span></div>
    ${giorni.length ? `<div class="ant-lista">${giorni.map(g => `
      <div class="ant-turno" style="grid-template-columns:4px 1fr auto">
        <span class="ant-barra" style="background:var(--chiuso)"></span>
        <span class="ant-testo"><span class="ant-tit" style="text-transform:capitalize">${esc(daChiave(g).toLocaleDateString("it-IT", { weekday: "long" }))}</span><span class="ant-sotto">${esc(daChiave(g).toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" }))}</span></span>
        <button type="button" class="rb piccolo" data-togli-sel="${g}">Togli</button>
      </div>`).join("")}</div>`
    : `<div class="ant-vuota">Tocca nel calendario i giorni in cui il ristorante è chiuso.<br>Poi premi Avanti per scegliere pranzo, cena e ripetizione.</div>`}`;
  box.querySelectorAll("[data-togli-sel]").forEach(b => b.onclick = () => { selChiusure.delete(b.dataset.togliSel); disegna(); });
}
function spiegaRipetizione(rip, giorni) {
  if (!rip) return giorni.length === 1 ? "Solo quel giorno." : "Solo quei giorni.";
  const ds = giorni.map(daChiave);
  const elenco = arr => arr.length > 1 ? arr.slice(0, -1).join(", ") + " e " + arr[arr.length - 1] : arr[0];
  if (rip === "settimana") {
    const gs = [...new Set(ds.map(d => (d.getDay() + 6) % 7))].sort();
    const nomi = gs.map(n => ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"][n]);
    return `Chiuso tutti i ${elenco(nomi)}, a partire da ${dataBreve(giorni[0])}.`;
  }
  if (rip === "mese") return `Chiuso ogni mese il giorno ${elenco([...new Set(ds.map(d => d.getDate()))].sort((a, b) => a - b).map(String))}.`;
  return `Chiuso ogni anno il ${elenco(ds.map(d => d.toLocaleDateString("it-IT", { day: "numeric", month: "long" })))}.`;
}
// Sposta il primo giorno della ripetizione alla prima volta utile dopo la data "dal"
// (es. hai toccato giovedì 26 ma vuoi la chiusura da gennaio: parte dal primo giovedì di gennaio)
function allineaInizio(g, rip, inizio) {
  if (!inizio) return g;
  const base = daChiave(g), s = daChiave(inizio);
  const a = n => rip === "settimana" ? piuGiorni(base, 7 * n) : rip === "mese" ? new Date(base.getFullYear(), base.getMonth() + n, base.getDate()) : new Date(base.getFullYear() + n, base.getMonth(), base.getDate());
  const ok = n => rip === "settimana" || a(n).getDate() === base.getDate();   // es. il 31 non c'è in tutti i mesi
  let n = 0;
  if (base < s) { while (n < 3000 && (a(n) < s || !ok(n))) n++; }
  else { while (n > -3000 && a(n - 1) >= s) n--; while (!ok(n)) n++; }
  return chiaveData(a(n));
}
async function confermaChiusure() {
  if (!selChiusure || !selChiusure.size) return;
  const giorni = [...selChiusure].sort();
  // per ogni giorno: pranzo e cena accesi (tranne se quel turno è già chiuso)
  const scelte = {};
  giorni.forEach(g => { const d = daChiave(g); scelte[g] = { pranzo: !chiusoTurno(d, "pranzo"), cena: !chiusoTurno(d, "cena") }; });
  const r = await finestra(giorni.length === 1 ? "Chiudere questo giorno?" : `Chiudere ${giorni.length} giorni?`, `
    <div class="lista-chiusure">${giorni.map(g => {
      const d = daChiave(g);
      return `<div class="riga-sel">
        <span class="rs-data"><b>${esc(d.toLocaleDateString("it-IT", { weekday: "long" }))}</b><small>${esc(d.toLocaleDateString("it-IT", { day: "numeric", month: "long" }))}</small></span>
        <span class="rs-turni">${TURNI.map(t => {
          const gia = chiusoTurno(d, t);
          return `<button type="button" class="chip-turno ${scelte[g][t] ? "attivo" : ""}" data-g="${g}" data-t="${t}" ${gia ? "disabled title=\"Già chiuso\"" : ""}>${NOME_TURNO[t]}${gia ? " ✕" : ""}</button>`;
        }).join("")}</span>
      </div>`; }).join("")}</div>
    <p class="nota" style="margin:6px 0 14px">Rosso = quel turno sarà chiuso. Toccalo per lasciarlo aperto.</p>
    <div class="campo"><span>Ripetizione</span>
      <div class="segmenti larghi rip-4" id="cc-rip">${Object.entries(NOMI_RIP_BREVI).map(([k, n]) => `<button type="button" class="seg ${k === "" ? "attivo" : ""}" data-rip="${k}">${n}</button>`).join("")}</div>
      <p class="nota" id="cc-spiega" style="margin:4px 0 0"></p>
    </div>
    <div class="due-campi" id="cc-periodo" hidden>
      <label>Si ripete dal<input id="cc-dal" type="date" value="${giorni[0]}"></label>
      <label>Fino al (vuoto = sempre)<input id="cc-fino" type="date"></label>
    </div>
    <label>Nota (facoltativa)<input id="cc-nota" maxlength="40" placeholder="Es. Ferie, riposo settimanale"></label>
    <div class="azioni">
      <button type="button" class="chip" data-azione="annulla">Indietro</button>
      <button type="submit" class="chip primario pericolo-pieno">Chiudi ${giorni.length === 1 ? "il giorno" : "i giorni"}</button>
    </div>`, (dlg, fatto) => {
    let rip = "";
    const ccDal = dlg.querySelector("#cc-dal"), ccFino = dlg.querySelector("#cc-fino");
    const spiega = () => {
      dlg.querySelector("#cc-periodo").hidden = !rip;
      let t = spiegaRipetizione(rip, giorni);
      if (rip) t = t.replace(/, a partire da .*$/, ".").replace(/\.$/, "") + (ccDal.value ? ` dal ${dataBreve(ccDal.value)}` : "") + (ccFino.value ? ` al ${dataBreve(ccFino.value)}` : ", senza fine") + ".";
      dlg.querySelector("#cc-spiega").textContent = t;
    };
    [ccDal, ccFino].forEach(x => x.addEventListener("change", spiega));
    dlg.querySelectorAll("[data-rip]").forEach(b => b.onclick = () => {
      rip = b.dataset.rip;
      dlg.querySelectorAll("[data-rip]").forEach(x => x.classList.toggle("attivo", x === b));
      spiega();
    });
    dlg.querySelectorAll(".chip-turno").forEach(b => b.onclick = () => {
      const s = scelte[b.dataset.g]; s[b.dataset.t] = !s[b.dataset.t];
      b.classList.toggle("attivo", s[b.dataset.t]);
    });
    spiega();
    dlg.querySelector('[data-azione="annulla"]').onclick = () => fatto(undefined);
    dlg.querySelector("form").onsubmit = e => {
      e.preventDefault();
      if (rip && ccFino.value && ccDal.value && ccFino.value < ccDal.value) { alert("La data “fino al” è prima di quella iniziale."); return; }
      fatto({ rip, inizio: rip ? ccDal.value || giorni[0] : "", fino: rip ? ccFino.value : "", nota: dlg.querySelector("#cc-nota").value.trim() });
    };
  });
  if (!r) return;   // "Indietro": la selezione resta, puoi aggiungere o togliere giorni
  let fatte = 0;
  giorni.forEach(g => {
    const s = scelte[g];
    const turno = s.pranzo && s.cena ? "tutto" : s.pranzo ? "pranzo" : s.cena ? "cena" : null;
    if (!turno) return;
    const dal = r.rip ? allineaInizio(g, r.rip, r.inizio) : g;
    scriviRiga("chiusure", { id: nuovoId(), dal, al: null, fino: r.fino || null, turno, ripeti: r.rip, nota: r.nota, saltate: [], eliminata: false });
    fatte++;
  });
  selChiusure = null;
  disegna(); aggiornaPannello();
  if (!fatte) avviso("Nessuna chiusura", "Avevi lasciato aperti sia pranzo sia cena in tutti i giorni.");
}
$("bs-annulla").addEventListener("click", esciSelezioneChiusure);
$("bs-avanti").addEventListener("click", confermaChiusure);
document.addEventListener("keydown", e => { if (e.key === "Escape" && selChiusure && !document.querySelector("dialog[open]")) esciSelezioneChiusure(); });

// =====================================================================
//  PRENOTATI (solo amministratore): numerino blu nella giornata
// =====================================================================
async function chiediPrenotati(g) {
  if (!sonoAdmin()) return;
  const d = daChiave(g), aperti = TURNI.filter(t => !chiusoTurno(d, t));
  const r = await finestra(`Prenotati · ${dataMedia(g)}`, `
    <div class="due-campi">${aperti.map(t => `<label>${NOME_TURNO[t]}<input id="pr-${t}" type="number" min="0" max="999" inputmode="numeric" value="${prenotati(g, t) || ""}" placeholder="0"></label>`).join("")}</div>
    ${bottoniOkAnnulla()}`, (dlg, fatto) => {
    dlg.querySelector('[data-azione="annulla"]').onclick = () => fatto(undefined);
    dlg.querySelector("form").onsubmit = e => {
      e.preventDefault();
      fatto(Object.fromEntries(aperti.map(t => [t, Math.max(0, parseInt(dlg.querySelector("#pr-" + t).value, 10) || 0)])));
    };
    setTimeout(() => dlg.querySelector("input")?.focus(), 30);
  });
  if (!r) return;
  Object.entries(r).forEach(([t, n]) => { if (n !== prenotati(g, t)) scriviRiga("prenotati", { giorno: g, turno: t, numero: n }); });
  disegna();
}

// =====================================================================
//  CREA TURNI UFFICIALI (solo amministratore)
//  Si scorre di giorno in giorno saltando le chiusure; si scelgono le
//  persone disponibili; con "Fine" tutti vedono i turni.
// =====================================================================
const dlgCrea = $("dlg-crea");
let creaGiorno = null;
function giornoApertoDa(d, verso) {
  let x = new Date(d);
  for (let n = 0; n < 400; n++) { if (apertoQualcosa(x)) return x; x = piuGiorni(x, verso); }
  return null;
}
function apriCrea(daGiorno) {
  if (!sonoAdmin()) return;
  chiudiMenu();
  let partenza;
  if (daGiorno) partenza = daChiave(daGiorno);
  else if (vista === "giorno") partenza = new Date(dataCorrente);
  else {
    const oggi = oggiMezzanotte();
    const inizioMese = vista === "mese" ? new Date(dataCorrente.getFullYear(), dataCorrente.getMonth(), 1) : oggi;
    partenza = inizioMese < oggi ? oggi : inizioMese;
  }
  const d = giornoApertoDa(partenza, 1);
  if (!d) { avviso("Nessun giorno aperto", "Non trovo giorni di apertura: controlla le chiusure."); return; }
  creaGiorno = chiaveData(d);
  disegnaCrea();
  dlgCrea.showModal();
}
function spostaCrea(verso) {
  const d = giornoApertoDa(piuGiorni(daChiave(creaGiorno), verso), verso);
  if (!d) return;
  creaGiorno = chiaveData(d);
  disegnaCrea();
  $("c-corpo").scrollTop = 0;
}
function rigaPersona(p, g, t, scelti, mese, avvisoNo = "") {
  const scelto = scelti.includes(p.id);
  const n = turniNelMese(p.id, mese.getFullYear(), mese.getMonth(), true);
  return `<button type="button" class="riga-pers ${scelto ? "scelto" : ""} ${avvisoNo ? "non-disp" : ""}" data-scegli="${p.id}" data-t="${t}">
    <span class="casella">${scelto ? "✓" : ""}</span>
    <span class="nome-p">${esc(p.nickname)}${testoOrario(orarioDi(p.id, g, t)) ? `<span class="orario-pers">${esc(testoOrario(orarioDi(p.id, g, t)))}</span>` : ""}<span class="conta-turni">${testoTurni(n)} nel mese</span></span>
    ${avvisoNo ? `<span class="avviso-no">${avvisoNo}</span>` : ""}
    ${esperto(p) ? `<span class="badge">Esperto</span>` : ""}
  </button>`;
}
function disegnaCrea() {
  const g = creaGiorno, d = daChiave(g);
  const nBozza = Object.keys(bozzaAttiva()).length;
  $("c-prev2").disabled = !giornoApertoDa(piuGiorni(d, -1), -1);
  $("c-data").innerHTML = `<span class="t-cap">${esc(d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" }))}</span><small>${d.getFullYear()} · ${nBozza ? `${nBozza} ${nBozza === 1 ? "turno" : "turni"} in bozza` : "nessuna modifica in bozza"}</small>`;
  $("c-corpo").innerHTML = `<div class="crea-settore"><span>Turni di: <b>${SETTORI[vistoSettore()].toLowerCase()}</b></span></div>` + TURNI.map(t => {
    if (chiusoTurno(d, t)) return `<div class="crea-sez chiusa"><div class="card-testa"><h3>${NOME_TURNO[t]}</h3><span class="dettaglio">Chiuso</span></div></div>`;
    const scelti = inBozza(g, t);
    const { disp, nonDisp, senza } = elenchi(g, t);
    const conta = p => turniNelMese(p.id, d.getFullYear(), d.getMonth(), true);
    // chi ha meno turni nel mese sta più in alto
    const ordina = arr => arr.sort((a, b) => conta(a) - conta(b) || perNome(a, b));
    const pScelti = scelti.filter(delSettore).map(profilo).filter(Boolean).sort(perNome);
    const liberi = ordina(disp.filter(p => !scelti.includes(p.id)));
    const altriNo = ordina(nonDisp.filter(p => !scelti.includes(p.id)));
    const altriSenza = ordina(senza.filter(p => !scelti.includes(p.id)));
    const np = prenotati(g, t);
    const avvisoDi = p => statoDi(p.id, g, t) === "no" ? "ha detto che non c'è" : (p.tipo === "occasionale" && statoDi(p.id, g, t) !== "si" ? "non ha risposto" : "");
    return `
      <div class="crea-sez" style="--col:${COL_TURNO[t]}">
        <div class="card-testa"><h3>${NOME_TURNO[t]}</h3>
          ${np ? `<span class="prenotati">${np} <small>prenotati</small></span>` : ""}
          <span class="crea-riassunto" style="margin-left:auto">${pScelti.length} ${pScelti.length === 1 ? "persona" : "persone"} · ${pScelti.filter(esperto).length} esperti</span>
        </div>
        ${pScelti.length ? `<div class="sez-tit">Scelti</div>${pScelti.map(p => rigaPersona(p, g, t, scelti, d, avvisoDi(p))).join("")}` : ""}
        <div class="sez-tit">Disponibili${liberi.length ? "" : " · nessun altro"}</div>
        ${liberi.map(p => rigaPersona(p, g, t, scelti, d)).join("")}
        ${altriSenza.length ? `<details><summary>Non hanno risposto (${altriSenza.length})</summary>${altriSenza.map(p => rigaPersona(p, g, t, scelti, d, "non ha risposto")).join("")}</details>` : ""}
        ${altriNo.length ? `<details><summary>Hanno detto che non ci sono (${altriNo.length})</summary>${altriNo.map(p => rigaPersona(p, g, t, scelti, d, "non c'è")).join("")}</details>` : ""}
      </div>`;
  }).join("") + `<p class="pan-nota">Il numero accanto al nome conta i turni del mese, compresi quelli in bozza. Premi <b>Fatto</b> per vedere il resoconto con le ore e scegliere se salvare la bozza o renderla ufficiale.</p>`;
}
$("c-corpo").addEventListener("click", e => {
  const cs = e.target.closest("[data-crea-settore]");
  if (cs) { settoreVisto = cs.dataset.creaSettore; aggiornaSettore(); disegnaCrea(); return; }
  const b = e.target.closest("[data-scegli]");
  if (!b) return;
  const g = creaGiorno, t = b.dataset.t, id = b.dataset.scegli;
  const scelti = [...inBozza(g, t)];
  const i = scelti.indexOf(id);
  if (i >= 0) scelti.splice(i, 1);
  else {
    if (statoDi(id, g, t) === "no" && !confirm(`${nomeDi(id)} ha detto che non c'è. Metterlo lo stesso nel turno?`)) return;
    scelti.push(id);
  }
  // se torna uguale al turno già ufficiale, non serve tenerlo in bozza
  const pubblicato = ufficiali(g, t);
  const uguale = scelti.length === pubblicato.length && scelti.every(x => pubblicato.includes(x));
  if (uguale) { if (haBozza(g, t)) scriviRiga("bozze", { giorno: g, turno: t, persone: [], attiva: false }); }
  else scriviRiga("bozze", { giorno: g, turno: t, persone: scelti, attiva: true });
  disegnaCrea();
});
$("c-prev").addEventListener("click", () => spostaCrea(-1));
$("c-next").addEventListener("click", () => spostaCrea(1));
$("c-chiudi").addEventListener("click", () => { dlgCrea.close(); });
dlgCrea.addEventListener("close", () => { disegna(); });
// (le frecce ← → della tastiera sono gestite più sotto, insieme a quelle del calendario)
$("c-fine").addEventListener("click", resoconto);
async function resoconto() {
  const bozza = bozzaAttiva();
  const chiavi = Object.keys(bozza);
  // mesi da mostrare: quelli della bozza (o quello che stai guardando)
  const mesi = [...new Set([...(creaGiorno ? [creaGiorno.slice(0, 7)] : []), ...chiavi.map(k => k.slice(0, 7))])].sort();
  let mese = creaGiorno ? creaGiorno.slice(0, 7) : mesi[0];
  const ore = oreTurni();
  const nomeMese = m => daChiave(m + "-01").toLocaleDateString("it-IT", { month: "long", year: "numeric" });
  const giorni = new Set(chiavi.map(k => k.split("|")[0]));
  const r = await finestra("Resoconto", `
    <p class="nota" style="margin-top:-8px">${chiavi.length ? `Bozza: <b>${chiavi.length} ${chiavi.length === 1 ? "turno cambiato" : "turni cambiati"}</b> in ${giorni.size} ${giorni.size === 1 ? "giorno" : "giorni"}. I numeri contano i turni ufficiali più la bozza.` : "Non ci sono modifiche in bozza: qui vedi i turni ufficiali."}</p>
    ${mesi.length > 1 ? `<div class="scelte stretta" id="rs-mesi" style="margin-bottom:10px">${mesi.map(m => `<button type="button" class="chip ${m === mese ? "attivo" : ""}" data-mese="${m}">${esc(nomeMese(m))}</button>`).join("")}</div>` : ""}
    <div class="due-campi">
      <label>Ore di un pranzo<input id="rs-ore-pranzo" type="number" min="0" max="24" step="0.5" inputmode="decimal" value="${ore.pranzo}"></label>
      <label>Ore di una cena<input id="rs-ore-cena" type="number" min="0" max="24" step="0.5" inputmode="decimal" value="${ore.cena}"></label>
    </div>
    <div id="rs-tabella"></div>
    <div class="azioni">
      ${chiavi.length ? `<button type="button" class="chip pericolo" data-azione="scarta">Scarta bozza</button>` : ""}
      <button type="button" class="chip" data-azione="annulla">Continua a modificare</button>
      ${chiavi.length ? `<button type="button" class="chip" data-azione="salva">Salva bozza</button>
      <button type="submit" class="chip primario">Rendi ufficiale</button>` : `<button type="button" class="chip primario" data-azione="chiudi">Chiudi</button>`}
    </div>`, (dlg, fatto) => {
    const leggiOre = () => ({ pranzo: Math.max(0, parseFloat(dlg.querySelector("#rs-ore-pranzo").value.replace(",", ".")) || 0), cena: Math.max(0, parseFloat(dlg.querySelector("#rs-ore-cena").value.replace(",", ".")) || 0) });
    const tabella = () => {
      const o = leggiOre(), [a, m] = mese.split("-").map(Number);
      const righe = D.profili.map(p => {
        const n = { pranzo: 0, cena: 0 }, prima = { pranzo: 0, cena: 0 };
        const chiaviMese = new Set([...Object.keys(D.turni), ...chiavi].filter(k => k.startsWith(mese)));
        chiaviMese.forEach(k => {
          const t = k.split("|")[1];
          if ((bozza[k] || (D.turni[k] || {}).persone || []).includes(p.id)) n[t]++;
          if (((D.turni[k] || {}).persone || []).includes(p.id)) prima[t]++;
        });
        const h = n.pranzo * o.pranzo + n.cena * o.cena, hPrima = prima.pranzo * o.pranzo + prima.cena * o.cena;
        return { p, n, h, diff: h - hPrima };
      }).sort((x, y) => settoreDi(x.p).localeCompare(settoreDi(y.p)) || y.h - x.h || perNome(x.p, y.p));
      const tot = righe.reduce((s, x) => s + x.h, 0);
      dlg.querySelector("#rs-tabella").innerHTML = `
        <table class="resoconto">
          <thead><tr><th>${esc(nomeMese(mese))}</th><th>Pranzi</th><th>Cene</th><th>Ore</th></tr></thead>
          <tbody>${righe.map(x => `<tr class="${x.p.id === io ? "io" : ""}">
            <td>${esc(x.p.nickname)} <span class="badge tipo">${SETTORI[settoreDi(x.p)]}</span>${sonoAdmin() && esperto(x.p) ? ` <span class="badge">E</span>` : ""}</td>
            <td>${x.n.pranzo}</td><td>${x.n.cena}</td>
            <td><b>${testoOre(x.h)}</b>${x.diff ? `<small class="${x.diff > 0 ? "piu" : "meno"}">${x.diff > 0 ? "+" : "−"}${testoOre(Math.abs(x.diff))}</small>` : ""}</td></tr>`).join("")}</tbody>
          <tfoot><tr><td>Totale</td><td>${righe.reduce((s, x) => s + x.n.pranzo, 0)}</td><td>${righe.reduce((s, x) => s + x.n.cena, 0)}</td><td><b>${testoOre(tot)}</b></td></tr></tfoot>
        </table>
        ${chiavi.length ? `<p class="nota" style="margin:6px 0 12px">+ / − = ore in più o in meno rispetto ai turni ufficiali di adesso.</p>` : ""}`;
    };
    dlg.querySelectorAll("#rs-ore-pranzo, #rs-ore-cena").forEach(x => x.addEventListener("input", tabella));
    dlg.querySelectorAll("[data-mese]").forEach(b => b.onclick = () => {
      mese = b.dataset.mese; dlg.querySelectorAll("[data-mese]").forEach(x => x.classList.toggle("attivo", x === b)); tabella();
    });
    tabella();
    const con = azione => () => fatto({ azione, ore: leggiOre() });
    dlg.querySelector('[data-azione="annulla"]').onclick = con("annulla");
    const b = (a) => dlg.querySelector(`[data-azione="${a}"]`);
    if (b("chiudi")) b("chiudi").onclick = con("chiudi");
    if (b("salva")) b("salva").onclick = con("salva");
    if (b("scarta")) b("scarta").onclick = () => { if (confirm("Buttare via tutta la bozza? I turni ufficiali restano come sono.")) fatto({ azione: "scarta", ore: leggiOre() }); };
    dlg.querySelector("form").onsubmit = e => { e.preventDefault(); if (chiavi.length) fatto({ azione: "ufficiale", ore: leggiOre() }); else fatto({ azione: "chiudi", ore: leggiOre() }); };
  });
  if (!r) return;
  // le ore si ricordano (le vede l'amministratore anche la prossima volta)
  if (sonoAdmin() && (r.ore.pranzo !== ore.pranzo || r.ore.cena !== ore.cena)) scriviRiga("impostazioni", { chiave: "ore", valore: r.ore });
  if (r.azione === "annulla") return;
  if (r.azione === "ufficiale") {
    chiavi.forEach(k => { const [giorno, turno] = k.split("|"); scriviRiga("turni", { giorno, turno, persone: bozza[k] }); scriviRiga("bozze", { giorno, turno, persone: [], attiva: false }); });
  } else if (r.azione === "scarta") {
    chiavi.forEach(k => { const [giorno, turno] = k.split("|"); scriviRiga("bozze", { giorno, turno, persone: [], attiva: false }); });
  }
  if (dlgCrea.open) dlgCrea.close();
  disegna();
  if (r.azione === "salva") avviso("Bozza salvata", "La bozza resta salvata (la vedono solo gli amministratori). Quando vuoi, apri <b>Crea bozza o turni</b>, premi <b>Fatto</b> e poi <b>Rendi ufficiale</b>.");
  if (r.azione === "ufficiale") avviso("Turni ufficiali", "Fatto! Ora tutti vedono i turni ufficiali.");
}
// scorrimento col dito anche dentro Crea turni
scorrimentoSu($("c-corpo"), verso => spostaCrea(verso), false);
scorrimentoTouchpad(dlgCrea, verso => { if (!dlgScelta.open) spostaCrea(verso); });
scorrimentoSu($("c-data"), verso => spostaCrea(verso), false);
$("c-prev2").addEventListener("click", () => spostaCrea(-1));
$("c-next2").addEventListener("click", () => spostaCrea(1));

// =====================================================================
//  PANNELLI LATERALI: miei turni, persone, chiusure
// =====================================================================
const pannello = $("pannello");
let sezioneAperta = null;
function apriPannello(nome) {
  if (sezioneAperta === nome) { chiudiPannello(); return; }
  sezioneAperta = nome;
  aggiornaPannello();
  pannello.classList.add("aperto");
  document.querySelectorAll(".rail-btn").forEach(b => b.classList.toggle("attivo", b.id === "btn-" + nome));
}
function chiudiPannello() {
  sezioneAperta = null;
  pannello.classList.remove("aperto");
  document.querySelectorAll(".rail-btn").forEach(b => b.classList.remove("attivo"));
}
const testaPannello = (titolo, classe = "") => `<div class="pan-testa ${classe}"><h2>${titolo}</h2><button class="icon-btn piccola" data-chiudi-pan aria-label="Chiudi">✕</button></div>`;
function aggiornaPannello() {
  if (!sezioneAperta) return;
  let html = "";
  const meseVisto = vista === "anno" ? oggiMezzanotte() : dataCorrente;
  const nomeMese = meseVisto.toLocaleDateString("it-IT", { month: "long" });
  if (sezioneAperta === "miei") {
    const oggi = chiaveData(oggiMezzanotte());
    const miei = Object.values(D.turni).filter(r => r.giorno >= oggi && (r.persone || []).includes(io))
      .sort((a, b) => (a.giorno + a.turno).localeCompare(b.giorno + (b.turno === "cena" ? "z" : "a")));
    html = testaPannello("I miei turni") + `<div class="pan-corpo">
      <p class="pan-nota">Questo mese hai <b>${testoTurni(turniNelMese(io, meseVisto.getFullYear(), meseVisto.getMonth()))}</b> (${esc(nomeMese)}).</p>
      ${miei.length ? miei.map(r => `
        <button type="button" class="riga-mio" data-vai="${r.giorno}" style="--col:${COL_TURNO[r.turno]}">
          <span class="ic"></span>
          <span class="tx"><b>${esc(dataLunga(r.giorno))}</b><span class="dettaglio">${NOME_TURNO[r.turno]} · con ${esc(nomiCorti(r.persone.filter(x => x !== io), 4) || "nessun altro")}</span></span>
        </button>`).join("") : `<div class="vuoto">Nessun turno ufficiale in programma.</div>`}</div>`;
  } else if (sezioneAperta === "persone") {
    const persone = [...D.profili].sort((a, b) => (settoreDi(a) === vistoSettore() ? 0 : 1) - (settoreDi(b) === vistoSettore() ? 0 : 1) || settoreDi(a).localeCompare(settoreDi(b)) || perNome(a, b));
    html = testaPannello("Persone") + `<div class="pan-corpo">
      <p class="pan-nota">Il numero a destra sono i turni di ${esc(nomeMese)}.${sonoAdmin() ? " Tocca una persona per segnarla esperta o non esperta (lo vedi solo tu) o per renderla amministratore." : ""}</p>
      ${persone.map(p => `
        <button type="button" class="riga-persona" data-persona="${p.id}">
          <span class="av">${esc(iniziale(p.nickname))}</span>
          <span class="tx"><b>${esc(p.nickname)}${p.id === io ? " (tu)" : ""}</b>
            <span class="etichette">
              ${p.admin ? `<span class="badge admin">Amministratore</span>` : ""}
              <span class="badge settore-${settoreDi(p)}">${SETTORI[settoreDi(p)]}</span>
              ${p.finto ? `<span class="badge tipo">Prova</span>` : ""}
              ${sonoAdmin() ? `<span class="badge ${esperto(p) ? "" : "tipo"}">${esperto(p) ? "Esperto" : "Non esperto"}</span>` : ""}
              <span class="badge tipo">${p.tipo === "fisso" ? "Fisso" : "Occasionale"}</span>
            </span></span>
          <span class="num">${turniNelMese(p.id, meseVisto.getFullYear(), meseVisto.getMonth())}<small>turni · ${testoOre(oreNelMese(p.id, meseVisto.getFullYear(), meseVisto.getMonth()))}</small></span>
        </button>`).join("")}</div>`;
  } else if (sezioneAperta === "chiusure") {
    const oggi = chiaveData(oggiMezzanotte());
    const elenco = chiusureAttive().sort((a, b) => a.dal.localeCompare(b.dal));
    const future = elenco.filter(c => c.ripeti || (c.al || c.dal) >= oggi), vecchie = elenco.filter(c => !future.includes(c));
    const riga = c => `
      <button type="button" class="riga-chiusura" data-chiusura="${c.id}">
        <span class="ic"></span>
        <span class="tx"><b>${esc(c.nota || (c.ripeti ? NOMI_RIPETI[c.ripeti] : "Chiusura"))}</b><span class="dettaglio">${esc(descriviChiusura(c))}${(c.saltate || []).length ? ` · ${c.saltate.length} ${c.saltate.length === 1 ? "giorno riaperto" : "giorni riaperti"}` : ""}</span></span>
        ${sonoAdmin() ? `<span class="freccina">⋯</span>` : ""}
      </button>`;
    html = testaPannello("Chiusure", "chiusure") + `<div class="pan-corpo">
      ${sonoAdmin() ? `<button class="pan-azione" id="pan-nuova-chiusura">+ Segna una chiusura</button>` : ""}
      <p class="pan-nota">I giorni chiusi sono in rosso nel calendario e vengono saltati quando si creano i turni.</p>
      ${future.length ? future.map(riga).join("") : `<div class="vuoto">Nessuna chiusura in programma.</div>`}
      ${vecchie.length ? `<div class="sezione-tit">Passate</div>${vecchie.map(riga).join("")}` : ""}</div>`;
  }
  pannello.innerHTML = html;
  pannello.querySelector("[data-chiudi-pan]").onclick = chiudiPannello;
  pannello.querySelectorAll("[data-vai]").forEach(b => b.onclick = () => { if (innerWidth <= 600) chiudiPannello(); vaiAGiorno(daChiave(b.dataset.vai)); });
  const nuova = pannello.querySelector("#pan-nuova-chiusura");
  if (nuova) nuova.onclick = () => avviaSelezioneChiusure(vista === "giorno" && !passato(chiaveData(dataCorrente)) ? chiaveData(dataCorrente) : null);
  pannello.querySelectorAll("[data-chiusura]").forEach(b => b.onclick = e => {
    const c = D.chiusure[b.dataset.chiusura];
    const voci = [{ testo: "📅 Vai al primo giorno", azione: () => vaiAGiorno(daChiave(c.dal)) }];
    if (sonoAdmin()) {
      voci.push({ testo: "✏️ Modifica", azione: () => modificaChiusura(c) });
      if ((c.saltate || []).length) voci.push({ testo: `↩️ Richiudi i giorni riaperti (${c.saltate.length})`, azione: () => { scriviRiga("chiusure", { ...c, saltate: [] }); disegna(); aggiornaPannello(); } });
      voci.push("-", { testo: "🗑️ Elimina", pericolo: true, azione: () => eliminaChiusura(c) });
    }
    mostraMenu(voci, { x: e.clientX, y: e.clientY });
    e.stopPropagation();
  });
  pannello.querySelectorAll("[data-persona]").forEach(b => b.onclick = e => {
    const p = profilo(b.dataset.persona);
    if (!sonoAdmin() || !p) return;
    e.stopPropagation();
    const voci = p.admin
      ? [{ info: `<b>${esc(p.nickname)} · amministratore</b>${p.id === creatore() ? "Ha creato il ristorante." : "È sempre esperto."}` }]
      : [{ info: `<b>${esc(p.nickname)}</b>Ora: ${p.esperto ? "esperto" : "non esperto"} · lo vedi solo tu` },
         { testo: p.esperto ? "Segna come non esperto" : "⭐ Segna come esperto", azione: () => impostaEsperto(p, !p.esperto) }];
    if (!p.admin) voci.push("-", { testo: "👑 Rendi amministratore", azione: () => impostaAdmin(p, true) });
    else if (p.id !== creatore() && p.id !== io) voci.push("-", { testo: "Togli da amministratore", pericolo: true, azione: () => impostaAdmin(p, false) });
    mostraMenu(voci, { x: e.clientX, y: e.clientY });
  });
}
async function impostaEsperto(p, valore) {
  if (MODALITA_PROVA) { p.esperto = valore; salvaDati(); }
  else {
    const errore = await window.cloudImpostaEsperto(p.id, valore);
    if (errore) { avviso("Non riuscito", esc(errore)); return; }
  }
  aggiornaPannello(); disegna();
}
$("btn-miei").addEventListener("click", () => apriPannello("miei"));
$("btn-persone").addEventListener("click", () => apriPannello("persone"));
$("btn-chiusure").addEventListener("click", () => apriPannello("chiusure"));

// =====================================================================
//  SEGNA UN PERIODO (es. ferie del fisso, settimana libera dell'occasionale)
// =====================================================================
async function segnaPeriodo() {
  chiudiMenu();
  const p = mioProfilo(); if (!p) return;
  const inizio = chiaveData(vista === "giorno" && !passato(chiaveData(dataCorrente)) ? dataCorrente : oggiMezzanotte());
  const scelte = p.tipo === "fisso"
    ? `<button type="button" data-v="no" class="attivo"><b>Non ci sono</b><small>Ferie, esami, impegni</small></button>
       <button type="button" data-v=""><b>Togli</b><small>Torni disponibile come sempre</small></button>`
    : `<button type="button" data-v="si" class="attivo"><b>Ci sono</b><small>Puoi lavorare</small></button>
       <button type="button" data-v="no"><b>Non ci sono</b><small>Non puoi lavorare</small></button>`;
  const r = await finestra("Segna più giorni", `
    <div class="due-campi">
      <label>Dal<input id="sp-dal" type="date" value="${inizio}" min="${chiaveData(oggiMezzanotte())}"></label>
      <label>Al<input id="sp-al" type="date" value="${inizio}" min="${chiaveData(oggiMezzanotte())}"></label>
    </div>
    <label>Turni<select id="sp-turni"><option value="tutti">Pranzo e cena</option><option value="pranzo">Solo pranzo</option><option value="cena">Solo cena</option></select></label>
    <div class="campo"><span>Cosa segni</span><div class="scelta-card" id="sp-stato">${scelte}</div></div>
    ${p.tipo === "occasionale" ? `<div class="campo"><span>Solo alcuni giorni della settimana (facoltativo)</span><div class="scelte stretta" id="sp-sett">${["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"].map((n, i) => `<button type="button" class="chip" data-gs="${(i + 1) % 7}">${n}</button>`).join("")}</div></div>` : ""}
    <p class="nota">I giorni chiusi vengono saltati.</p>
    ${bottoniOkAnnulla("Segna")}`, (dlg, fatto) => {
    let stato = p.tipo === "fisso" ? "no" : "si";
    const sett = new Set();
    dlg.querySelectorAll("#sp-stato [data-v]").forEach(b => b.onclick = () => {
      stato = b.dataset.v; dlg.querySelectorAll("#sp-stato [data-v]").forEach(x => x.classList.toggle("attivo", x === b));
    });
    dlg.querySelectorAll("[data-gs]").forEach(b => b.onclick = () => {
      const n = Number(b.dataset.gs); sett.has(n) ? sett.delete(n) : sett.add(n); b.classList.toggle("attivo", sett.has(n));
    });
    const dal = dlg.querySelector("#sp-dal"), al = dlg.querySelector("#sp-al");
    dal.addEventListener("change", () => { if (!al.value || al.value < dal.value) al.value = dal.value; });
    dlg.querySelector('[data-azione="annulla"]').onclick = () => fatto(undefined);
    dlg.querySelector("form").onsubmit = e => {
      e.preventDefault();
      if (!dal.value) return;
      fatto({ dal: dal.value, al: al.value && al.value >= dal.value ? al.value : dal.value, turni: dlg.querySelector("#sp-turni").value, stato, sett });
    };
  });
  if (!r) return;
  let d = daChiave(r.dal), n = 0;
  const fine = daChiave(r.al);
  while (d <= fine && n < 400) {
    const g = chiaveData(d);
    if (!passato(g) && (!r.sett.size || r.sett.has(d.getDay())))
      (r.turni === "tutti" ? TURNI : [r.turni]).forEach(t => {
        if (!chiusoTurno(d, t) && statoDi(p.id, g, t) !== r.stato) scriviRiga("disponibilita", { user_id: p.id, giorno: g, turno: t, stato: r.stato });
      });
    d = piuGiorni(d, 1); n++;
  }
  disegna();
}
$("btn-segna").addEventListener("click", segnaPeriodo);
$("btn-fab").addEventListener("click", () => (sonoAdmin() ? apriCrea() : segnaPeriodo()));
function aggiornaFab() {
  const fab = $("btn-fab");
  fab.hidden = !!selChiusure;
  if (sonoAdmin()) {
    const n = Object.keys(bozzaAttiva()).length;
    fab.classList.remove("esteso");
    fab.classList.add("admin-tondo");
    fab.innerHTML = `<span class="ic-fab">📋</span>${n ? `<span class="bozza-punto" title="Turni in bozza">${n}</span>` : ""}`;
    fab.title = n ? `Crea bozza o turni · ${n} in bozza` : "Crea bozza o turni";
    fab.setAttribute("aria-label", "Crea bozza o turni");
  } else {
    fab.classList.remove("esteso", "admin-tondo");
    fab.title = "Segna più giorni";
    fab.textContent = "+";
    fab.setAttribute("aria-label", "Segna più giorni");
  }
}

// =====================================================================
//  FILTRO: tutto / solo i miei turni / quando ci sono
// =====================================================================
const NOMI_FILTRO = { miei: "i miei turni", ufficiali: "turni ufficiali di sala e cucina", settore: "turni ufficiali" };
function aggiornaFiltro() {
  const attivo = filtro !== "tutto";
  $("btn-filtro").classList.toggle("filtro-attivo", attivo);
  const chip = $("chip-filtro");
  if (attivo) {
    chip.innerHTML = `Vedi solo: <b>${NOMI_FILTRO[filtro]}${filtro === "settore" ? " " + SETTORI[vistoSettore()].toLowerCase() : ""}</b> <button type="button" aria-label="Torna a Disponibilità">✕</button>`;
    chip.querySelector("button").onclick = () => { filtro = "tutto"; aggiornaFiltro(); disegna(); };
  }
  chip.hidden = !attivo;
}
function apriFiltro() {
  chiudiMenu();
  finestra("Cosa vuoi vedere?", `
    <div class="filtro-lista" id="f-lista"></div>
    <div class="azioni"><button type="button" class="chip primario" data-azione="ok">Fatto</button></div>`, (d, fatto) => {
    const voci = [["tutto", "Disponibilità", "var(--accento)"], ["ufficiali", "Turni ufficiali di tutti (sala e cucina)", "var(--cena)"], ["settore", `Turni ufficiali solo ${SETTORI[vistoSettore()].toLowerCase()}`, "var(--pranzo)"], ["miei", "Solo i miei turni", "var(--mio)"]];
    const disegnaVoci = () => {
      d.querySelector("#f-lista").innerHTML = voci.map(([k, n, c]) => `
        <button type="button" class="voce-filtro ${filtro === k ? "acceso" : ""}" data-f="${k}">
          <span class="pallino" style="background:${c}"></span><span>${n}</span><span class="spunta-f">${filtro === k ? "✓" : ""}</span></button>`).join("");
    };
    d.querySelector("#f-lista").addEventListener("click", e => {
      const b = e.target.closest("[data-f]"); if (!b) return;
      filtro = b.dataset.f; disegnaVoci(); aggiornaFiltro(); disegna();
    });
    d.querySelector('[data-azione="ok"]').onclick = () => fatto(true);
    d.querySelector("form").onsubmit = e => { e.preventDefault(); fatto(true); };
    disegnaVoci();
  });
}
$("btn-filtro").addEventListener("click", apriFiltro);

// =====================================================================
//  INGRESSO: crea ristorante (nome + password) o cerca ristorante,
//  poi tipologia (fisso/occasionale) e nickname.
//  Chi crea è amministratore; chi entra cercando NON lo è (può nominarlo un amministratore).
// =====================================================================
const dlgProfilo = $("dlg-profilo");
let sceltaProfilo = null;   // { modo: "cerca" | "crea", tipo, modifica, ristorante: {id, nome} }
function apriProfilo({ modifica = false, annullabile = false } = {}) {
  const p = modifica ? mioProfilo() : null;
  const provaConRistorante = MODALITA_PROVA && !!D.ristorante;
  sceltaProfilo = { modo: provaConRistorante ? "cerca" : (MODALITA_PROVA ? "crea" : "cerca"), tipo: p ? p.tipo : "", settore: p ? settoreDi(p) : "", modifica, ristorante: provaConRistorante ? { id: D.ristorante.id, nome: D.ristorante.nome } : null };
  $("p-intestazione").textContent = modifica ? "Il tuo profilo" : provaConRistorante ? "Nuova persona (prova)" : "Benvenuto in Turni";
  $("p-nota-prova").hidden = !MODALITA_PROVA || modifica;
  $("p-nick").value = p ? p.nickname : "";
  ["p-nome", "p-pass-nuova", "p-cerca-testo", "p-pass"].forEach(id => { $(id).value = ""; });
  $("p-risultati").innerHTML = "";
  $("p-ok").textContent = modifica ? "Salva" : "Entra";
  $("p-annulla").hidden = !annullabile && !modifica;
  messaggioProfilo("");
  aggiornaFormProfilo();
  if (!dlgProfilo.open) dlgProfilo.showModal();
}
function messaggioProfilo(t, tipo = "") { const el = $("p-msg"); el.textContent = t; el.className = "acc-messaggio nota " + tipo; }
function aggiornaFormProfilo() {
  const s = sceltaProfilo, provaConRistorante = MODALITA_PROVA && !!D.ristorante;
  $("p-modo-wrap").hidden = s.modifica || MODALITA_PROVA;
  document.querySelectorAll("#p-modo [data-v]").forEach(b => b.classList.toggle("attivo", b.dataset.v === s.modo));
  $("p-crea").hidden = s.modifica || s.modo !== "crea";
  $("p-cerca").hidden = s.modifica || s.modo !== "cerca";
  // in prova il ristorante c'è già: si chiede solo la password (per provare com'è)
  $("p-cerca-testo").closest("label").hidden = provaConRistorante;
  $("p-pass-wrap").hidden = !s.ristorante;
  if (provaConRistorante) $("p-pass-wrap").firstChild.textContent = `Password di «${D.ristorante.nome}»`;
  else $("p-pass-wrap").firstChild.textContent = "Password del ristorante";
  document.querySelectorAll("#p-tipo [data-v]").forEach(b => b.classList.toggle("attivo", b.dataset.v === s.tipo));
  document.querySelectorAll("#p-settore [data-v]").forEach(b => b.classList.toggle("attivo", b.dataset.v === s.settore));
  const p = mioProfilo();
  $("p-nota-ruolo").textContent = s.modifica ? (p && p.admin ? "Sei amministratore." : "Se serve, un amministratore può renderti amministratore.")
    : s.modo === "crea" ? "Chi crea il ristorante è l'amministratore."
    : "Entri come collaboratore: un amministratore potrà renderti amministratore.";
}
function disegnaRisultati(lista, testo) {
  const box = $("p-risultati");
  if (!testo || testo.length < 2) { box.innerHTML = ""; return; }
  box.innerHTML = lista.length ? lista.map(r => `
    <button type="button" data-rist="${esc(r.id)}" data-nome="${esc(r.nome)}" class="${sceltaProfilo.ristorante && sceltaProfilo.ristorante.id === r.id ? "attuale" : ""}">
      <span class="av-mini">${esc(iniziale(r.nome))}</span>${esc(r.nome)}${sceltaProfilo.ristorante && sceltaProfilo.ristorante.id === r.id ? `<span class="dove">✓ scelto</span>` : ""}</button>`).join("")
    : `<div class="nessun-risultato">Nessun ristorante con questo nome. Controlla come è scritto, oppure crealo.</div>`;
}
let timerCerca = null, ultimaRicerca = [];
$("p-cerca-testo").addEventListener("input", () => {
  const testo = $("p-cerca-testo").value.trim();
  sceltaProfilo.ristorante = null; aggiornaFormProfilo();
  clearTimeout(timerCerca);
  timerCerca = setTimeout(async () => {
    if (testo.length < 2) { disegnaRisultati([], testo); return; }
    if (MODALITA_PROVA) ultimaRicerca = D.ristorante && D.ristorante.nome.toLowerCase().includes(testo.toLowerCase()) ? [D.ristorante] : [];
    else {
      const r = await window.cloudCercaRistoranti(testo);
      if (typeof r === "string") { messaggioProfilo(r, "errore"); return; }
      messaggioProfilo(""); ultimaRicerca = r;
    }
    disegnaRisultati(ultimaRicerca, testo);
  }, 300);
});
$("p-risultati").addEventListener("click", e => {
  const b = e.target.closest("[data-rist]"); if (!b) return;
  sceltaProfilo.ristorante = { id: b.dataset.rist, nome: b.dataset.nome };
  disegnaRisultati(ultimaRicerca, $("p-cerca-testo").value.trim());
  aggiornaFormProfilo();
  setTimeout(() => $("p-pass").focus(), 30);
});
$("p-modo").addEventListener("click", e => { const b = e.target.closest("[data-v]"); if (!b) return; sceltaProfilo.modo = b.dataset.v; messaggioProfilo(""); aggiornaFormProfilo(); });
$("p-tipo").addEventListener("click", e => { const b = e.target.closest("[data-v]"); if (!b) return; sceltaProfilo.tipo = b.dataset.v; aggiornaFormProfilo(); });
$("p-settore").addEventListener("click", e => { const b = e.target.closest("[data-v]"); if (!b) return; sceltaProfilo.settore = b.dataset.v; aggiornaFormProfilo(); });
$("p-annulla").addEventListener("click", () => dlgProfilo.close());
dlgProfilo.addEventListener("cancel", e => { if (!mioProfilo()) e.preventDefault(); });   // senza profilo non si può chiudere
$("form-profilo").addEventListener("submit", async e => {
  e.preventDefault();
  const s = sceltaProfilo, nick = $("p-nick").value.trim().replace(/\s+/g, " ");
  if (!s.modifica && s.modo === "crea") {
    if ($("p-nome").value.trim().length < 2) return messaggioProfilo("Scrivi il nome del ristorante.", "errore");
    if ($("p-pass-nuova").value.length < 4) return messaggioProfilo("La password del ristorante deve avere almeno 4 caratteri.", "errore");
  }
  if (!s.modifica && s.modo === "cerca") {
    if (!s.ristorante) return messaggioProfilo("Cerca il ristorante e toccalo nell'elenco.", "errore");
    if (!$("p-pass").value) return messaggioProfilo("Scrivi la password del ristorante.", "errore");
  }
  if (!s.tipo) return messaggioProfilo("Scegli se sei fisso o occasionale.", "errore");
  if (!s.settore) return messaggioProfilo("Scegli se sei in sala o in cucina.", "errore");
  if (nick.length < 2) return messaggioProfilo("Scegli un nickname (almeno 2 lettere).", "errore");
  if (D.profili.some(p => p.nickname.toLowerCase() === nick.toLowerCase() && p.id !== (s.modifica ? io : null)))
    return messaggioProfilo("Questo nickname c'è già: scegline un altro.", "errore");

  if (MODALITA_PROVA) {
    if (s.modifica) { Object.assign(mioProfilo(), { nickname: nick, tipo: s.tipo, settore: s.settore }); }
    else {
      const id = nuovoId();
      if (s.modo === "crea") {
        D.ristorante = { id: "prova", nome: $("p-nome").value.trim(), password: $("p-pass-nuova").value, creato_da: id };
        D.profili.push({ id, nickname: nick, tipo: s.tipo, settore: s.settore, admin: true, esperto: true });
      } else {
        if (D.ristorante.password && $("p-pass").value !== D.ristorante.password) return messaggioProfilo("Password del ristorante sbagliata.", "errore");
        D.profili.push({ id, nickname: nick, tipo: s.tipo, settore: s.settore, admin: false, esperto: false });
      }
      io = id; salvaIo();
    }
    salvaDati();
  } else {
    $("p-ok").disabled = true;
    messaggioProfilo("Un attimo…");
    const errore = s.modifica ? await window.cloudModificaProfilo(nick, s.tipo, s.settore)
      : s.modo === "crea" ? await window.cloudCreaRistorante($("p-nome").value.trim(), $("p-pass-nuova").value, nick, s.tipo, s.settore)
      : await window.cloudUnisciti(s.ristorante.id, $("p-pass").value, nick, s.tipo, s.settore);
    $("p-ok").disabled = false;
    if (errore) return messaggioProfilo(errore, "errore");
  }
  dlgProfilo.close();
  avvioCompleto();
});

// Amministratori: un amministratore può nominarne altri (il creatore non si può togliere)
const creatore = () => D.ristorante && D.ristorante.creato_da;
async function impostaAdmin(p, valore) {
  if (!sonoAdmin()) return;
  if (!confirm(valore ? `Rendere ${p.nickname} amministratore? Potrà creare turni, chiusure, prenotati e nominare altri amministratori.` : `Togliere a ${p.nickname} il ruolo di amministratore?`)) return;
  if (MODALITA_PROVA) { p.admin = valore; if (valore) p.esperto = true; salvaDati(); }
  else {
    const errore = await window.cloudImpostaAdmin(p.id, valore);
    if (errore) { avviso("Non riuscito", esc(errore)); return; }
  }
  aggiornaPannello(); disegna();
}

// Prova: passare da una persona all'altra
function cambiaUtente() {
  dlgImp.close();
  if (!sonoCreatore()) return;
  // online: tu e le persone di prova; in modalità prova: tutti
  const scelta = MODALITA_PROVA ? [...D.profili].sort(perNome) : [profilo(ioReale), ...D.profili.filter(p => p.finto).sort(perNome)].filter(Boolean);
  finestra("Chi sta usando l'app?", `
    <p class="nota" style="margin-top:0">${MODALITA_PROVA ? "Così vedi cosa vede un amministratore, un fisso o un occasionale." : "Puoi usare l'app come una persona di prova: segni le sue presenze e vedi quello che vede lei. I colleghi veri non si possono impersonare."}</p>
    <div class="lista-scelta" id="cu-lista">${scelta.map(p => `
      <button type="button" data-id="${p.id}" class="${p.id === io ? "attuale" : ""}"><span class="av-mini">${esc(iniziale(p.nickname))}</span>${esc(p.nickname)}${p.id === ioReale ? " (tu)" : ""}
      <span class="dove">${p.admin ? "amministratore · " : ""}${p.tipo}</span></button>`).join("")}</div>
    ${!MODALITA_PROVA && scelta.length < 2 ? `<p class="nota">Non ci sono ancora persone di prova: aggiungile dalle impostazioni.</p>` : ""}
    <div class="azioni">${MODALITA_PROVA ? `<button type="button" class="chip" data-azione="nuovo">+ Nuova persona</button>` : ""}<button type="button" class="chip primario" data-azione="annulla">Chiudi</button></div>`,
  (d, fatto) => {
    d.querySelector("#cu-lista").onclick = e => { const b = e.target.closest("[data-id]"); if (b) { io = b.dataset.id; if (MODALITA_PROVA) salvaIo(); fatto(true); avvioCompleto(); } };
    const n = d.querySelector('[data-azione="nuovo"]'); if (n) n.onclick = () => { fatto(true); apriProfilo({ annullabile: true }); };
    d.querySelector('[data-azione="annulla"]').onclick = () => fatto(true);
  });
}
function aggiornaChipPersona() {
  const chip = $("chip-persona");
  chip.hidden = !stoProvando();
  if (chip.hidden) return;
  chip.innerHTML = `Stai provando come <b>${esc(nomeDi(io))}</b> <button type="button" aria-label="Torna a te">Torna a te ✕</button>`;
  chip.querySelector("button").onclick = () => { io = ioReale; avvioCompleto(); };
}
async function personeDiEsempio() {
  dlgImp.close();
  if (!MODALITA_PROVA) {
    const r = await window.cloudCreaPersoneProva();
    if (typeof r === "string") { avviso("Non riuscito", esc(r)); return; }
    avviso("Persone di prova", r ? `Ho aggiunto ${r} persone di prova fisse. Le trovi in <b>Persone</b>; con <b>Cambia persona (prova)</b> puoi usare l'app come una di loro.` : "Le persone di prova ci sono già.");
    return;
  }
  const nomi = ["Giulia", "Marco", "Sara", "Luca", "Chiara", "Davide"];
  const nuovi = nomi.filter(n => !D.profili.some(p => p.nickname === n)).map((n, i) => ({ id: nuovoId(), nickname: n, tipo: "fisso", admin: false, esperto: i < 3, finto: true }));
  D.profili.push(...nuovi);
  const oggi = oggiMezzanotte();
  nuovi.forEach(p => {
    for (let n = 0; n < 45; n++) {
      const g = chiaveData(piuGiorni(oggi, n));
      TURNI.forEach(t => {
        if (Math.random() < 0.15) D.disponibilita[`${p.id}|${g}|${t}`] = { user_id: p.id, giorno: g, turno: t, stato: "no", aggiornato: new Date().toISOString(), ristorante_id: "prova" };
      });
    }
  });
  salvaDati(); disegna(); aggiornaPannello();
  avviso("Fatto", `Ho aggiunto ${nuovi.length} persone di prova fisse, con qualche "non ci sono" a caso.`);
}
async function eliminaPersoneProva() {
  dlgImp.close();
  if (!confirm("Eliminare tutte le persone di prova? Vengono tolte anche dai turni e dalle bozze.")) return;
  if (stoProvando()) { io = ioReale; }
  const r = await window.cloudEliminaPersoneProva();
  if (typeof r === "string") { avviso("Non riuscito", esc(r)); return; }
  avvioCompleto();
  avviso("Fatto", r ? `Ho eliminato ${r} persone di prova.` : "Non c'erano persone di prova.");
}
function azzeraProva() {
  if (!confirm("Cancellare tutti i dati di prova su questo dispositivo?")) return;
  D = datiVuoti(); io = null;
  salvaDati(); salvaIo();
  dlgImp.close();
  avvioCompleto();
}

// =====================================================================
//  IMPOSTAZIONI E TEMA
// =====================================================================
const dlgImp = $("dlg-impostazioni");
document.querySelectorAll("[data-apri-impostazioni]").forEach(b => b.addEventListener("click", () => { chiudiMenu(); aggiornaImpostazioni(); dlgImp.showModal(); }));
$("imp-chiudi").addEventListener("click", () => dlgImp.close());
dlgImp.addEventListener("click", e => { if (e.target === dlgImp) dlgImp.close(); });
$("imp-profilo").addEventListener("click", () => { dlgImp.close(); apriProfilo({ modifica: true }); });
$("imp-cambia").addEventListener("click", cambiaUtente);
$("imp-esempio").addEventListener("click", personeDiEsempio);
$("imp-azzera").addEventListener("click", azzeraProva);
$("imp-pdf").addEventListener("click", () => { dlgImp.close(); scegliMesePDF(); });
$("imp-elimina-prova").addEventListener("click", eliminaPersoneProva);
$("imp-codici").addEventListener("click", async () => {
  dlgImp.close();
  const nome = D.ristorante ? D.ristorante.nome : "";
  const r = await finestra("Far entrare i colleghi", `
    <p style="margin-top:0;line-height:1.55">Di' ai colleghi di aprire l'app, creare il loro account e premere <b>Cerca ristorante</b>. Devono scrivere:</p>
    <div class="codice-grande" style="letter-spacing:0;font-size:22px">${esc(nome)}</div>
    <p style="line-height:1.55;margin-top:0">e la <b>password del ristorante</b>. Entrano come collaboratori; per renderli amministratori: <b>Persone</b> → tocca il nome → <b>Rendi amministratore</b>.</p>
    <label>Nuova password del ristorante (facoltativo)<input id="cp-pass" type="password" maxlength="40" placeholder="Lascia vuoto per non cambiarla" autocomplete="new-password"></label>
    <p class="acc-messaggio nota" id="cp-msg"></p>
    ${bottoniOkAnnulla("Fatto")}`, (dlg, fatto) => {
    dlg.querySelector('[data-azione="annulla"]').onclick = () => fatto(undefined);
    dlg.querySelector("form").onsubmit = async e => {
      e.preventDefault();
      const pw = dlg.querySelector("#cp-pass").value, msg = dlg.querySelector("#cp-msg");
      if (!pw) { fatto(true); return; }
      if (pw.length < 4) { msg.textContent = "Almeno 4 caratteri."; msg.className = "acc-messaggio nota errore"; return; }
      if (MODALITA_PROVA) { D.ristorante.password = pw; salvaDati(); }
      else {
        const errore = await window.cloudCambiaPassword(pw);
        if (errore) { msg.textContent = errore; msg.className = "acc-messaggio nota errore"; return; }
      }
      fatto("cambiata");
    };
  });
  if (r === "cambiata") avviso("Password cambiata", "Chi è già dentro resta dentro. I nuovi colleghi dovranno usare la password nuova.");
});
// PDF del mese: calendario da parete (lun → dom) con chi è di turno, sala e cucina.
// Si sceglie anno e mese, poi il file PDF si salva direttamente (niente stampa).
async function scegliMesePDF() {
  const base = vista === "anno" ? oggiMezzanotte() : dataCorrente;
  let anno = base.getFullYear(), mese = base.getMonth();
  const MESI = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];
  const r = await finestra("Scarica PDF del mese", `
    <div class="pdf-anno"><button type="button" class="freccia" data-anno="-1" aria-label="Anno prima">‹</button><b id="pdf-anno">${anno}</b><button type="button" class="freccia" data-anno="1" aria-label="Anno dopo">›</button></div>
    <div class="pdf-mesi" id="pdf-mesi">${MESI.map((m, i) => `<button type="button" class="chip ${i === mese ? "attivo" : ""}" data-mese="${i}">${m}</button>`).join("")}</div>
    <p class="nota">Calendario del mese intero con i turni ufficiali di sala e cucina e i prenotati.</p>
    ${bottoniOkAnnulla("Scarica PDF")}`, (dlg, fatto) => {
    dlg.querySelectorAll("[data-anno]").forEach(b => b.onclick = () => { anno += Number(b.dataset.anno); dlg.querySelector("#pdf-anno").textContent = anno; });
    dlg.querySelectorAll("[data-mese]").forEach(b => b.onclick = () => { mese = Number(b.dataset.mese); dlg.querySelectorAll("[data-mese]").forEach(x => x.classList.toggle("attivo", x === b)); });
    dlg.querySelector('[data-azione="annulla"]').onclick = () => fatto(undefined);
    dlg.querySelector("form").onsubmit = e => { e.preventDefault(); fatto({ anno, mese }); };
  });
  if (r) salvaPDFMese(r.anno, r.mese);
}
async function salvaPDFMese(anno, mese) {
  const nomi = ids => ids.map(nomeDi).sort((a, b) => a.localeCompare(b, "it"));
  const { byte, nomeFile } = window.creaCalendarioPDF({
    anno, mese, ristorante: D.ristorante ? D.ristorante.nome : "",
    dati: (g, t) => {
      const d = daChiave(g);
      if (chiusoTurno(d, t)) return { chiuso: true, sala: [], cucina: [], prenotati: 0 };
      const ids = ufficiali(g, t).filter(id => profilo(id));
      return { chiuso: false, prenotati: prenotati(g, t),
        sala: nomi(ids.filter(id => settoreDi(profilo(id)) === "sala")),
        cucina: nomi(ids.filter(id => settoreDi(profilo(id)) === "cucina")) };
    },
    notaChiusura: g => regoleSu(daChiave(g)).map(c => c.nota).find(Boolean) || "",
  });
  const file = new File([byte], nomeFile, { type: "application/pdf" });
  // App installata su iPhone/iPad: il download diretto non funziona, si apre il foglio "Salva su File"
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios && navigator.standalone && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: nomeFile }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url; a.download = nomeFile; a.style.display = "none";
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 5000);
}
function aggiornaImpostazioni() {
  const p = mioProfilo();
  $("imp-profilo-testo").textContent = p ? `${p.nickname} · ${SETTORI[settoreDi(p)].toLowerCase()} · ${p.tipo === "fisso" ? "fisso" : "occasionale"}${p.admin ? " · amministratore" : ""}` : "";
  $("btn-account").hidden = MODALITA_PROVA;
}

const TEMI = ["chiaro", "grigio", "scuro"];
function temaIniziale() {
  try { const t = localStorage.getItem(K_TEMA); if (TEMI.includes(t)) return t; } catch {}
  return matchMedia("(prefers-color-scheme: dark)").matches ? "scuro" : "chiaro";
}
function applicaTema(tema) {
  document.documentElement.dataset.tema = tema;
  document.querySelectorAll("#seg-tema [data-tema]").forEach(b => b.classList.toggle("attivo", b.dataset.tema === tema));
  const colori = { chiaro: "#eef0f6", grigio: "#535961", scuro: "#0e1013" };
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", colori[tema]);
}
$("seg-tema").addEventListener("click", e => {
  const b = e.target.closest("[data-tema]");
  if (!b) return;
  applicaTema(b.dataset.tema);
  try { localStorage.setItem(K_TEMA, b.dataset.tema); } catch {}
});
applicaTema(temaIniziale());

// =====================================================================
//  NAVIGAZIONE
// =====================================================================
function sposta(passo) {
  if (vista === "anno") dataCorrente = new Date(dataCorrente.getFullYear() + passo, 0, 1);
  else if (vista === "mese") dataCorrente = new Date(dataCorrente.getFullYear(), dataCorrente.getMonth() + passo, 1);
  else dataCorrente = piuGiorni(dataCorrente, passo);
  disegna();
}
$("btn-prev").addEventListener("click", () => sposta(-1));
$("btn-next").addEventListener("click", () => sposta(1));
document.addEventListener("keydown", e => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const el = document.activeElement;
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
  if (dlgCrea.open && !dlgScelta.open) { e.preventDefault(); spostaCrea(e.key === "ArrowLeft" ? -1 : 1); return; }
  if (document.querySelector("dialog[open]")) return;
  e.preventDefault();
  chiudiMenu();
  sposta(e.key === "ArrowLeft" ? -1 : 1);
});
$("btn-oggi").addEventListener("click", () => { dataCorrente = oggiMezzanotte(); disegna(); });
$("btn-anno").addEventListener("click", () => { selChiusure = null; vista = "anno"; disegna(); });
$("btn-mese").addEventListener("click", () => { vista = "mese"; disegna(); });
$("btn-giorno").addEventListener("click", () => { selChiusure = null; vista = "giorno"; disegna(); });

// =====================================================================
//  SCORRIMENTO COL DITO: a sinistra = avanti, a destra = indietro (come nell'agenda)
// =====================================================================
function scorrimentoSu(el, azione, conEffetto = true) {
  let x0 = 0, y0 = 0, attivo = false, orizzontale = false;
  el.addEventListener("touchstart", e => {
    if (e.touches.length !== 1) { attivo = false; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; attivo = true; orizzontale = false;
  }, { passive: true });
  el.addEventListener("touchmove", e => {
    if (!attivo) return;
    const dx = e.touches[0].clientX - x0, dy = e.touches[0].clientY - y0;
    if (!orizzontale) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { attivo = false; return; }
      if (Math.abs(dx) > 12) orizzontale = true;
    }
    if (orizzontale) {
      el.style.transition = "none";
      el.style.transform = `translateX(${dx * 0.4}px)`;
      el.style.opacity = String(1 - Math.min(Math.abs(dx) / 700, 0.35));
    }
  }, { passive: true });
  const fine = e => {
    if (!attivo) return;
    attivo = false;
    const dx = (e.changedTouches ? e.changedTouches[0].clientX : x0) - x0;
    el.style.transition = "transform .18s ease, opacity .18s ease";
    if (orizzontale && Math.abs(dx) > 60) {
      const verso = dx < 0 ? 1 : -1;
      el.style.transform = `translateX(${-verso * 30}%)`; el.style.opacity = "0";
      setTimeout(() => {
        azione(verso);
        el.style.transition = "none";
        el.style.transform = `translateX(${verso * 30}%)`;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          el.style.transition = "transform .22s cubic-bezier(.2,.8,.2,1), opacity .22s ease";
          el.style.transform = ""; el.style.opacity = "";
        }));
      }, 150);
    } else { el.style.transform = ""; el.style.opacity = ""; }
  };
  el.addEventListener("touchend", fine);
  el.addEventListener("touchcancel", fine);
}
scorrimentoSu($("contenuto"), sposta);
scorrimentoTouchpad($("contenuto"), verso => { if (!document.querySelector("dialog[open]")) sposta(verso); });

// Touchpad del computer: scorrere con due dita a sinistra / destra
function scorrimentoTouchpad(el, azione) {
  let somma = 0, bloccato = false, timerSblocco = null, timerAzzera = null;
  el.addEventListener("wheel", e => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.2) return;   // è uno scorrimento in verticale
    e.preventDefault();
    if (bloccato) {   // aspetta che il gesto finisca prima di spostarsi di nuovo
      clearTimeout(timerSblocco); timerSblocco = setTimeout(() => { bloccato = false; }, 260);
      return;
    }
    somma += e.deltaX;
    clearTimeout(timerAzzera); timerAzzera = setTimeout(() => { somma = 0; }, 220);
    if (Math.abs(somma) > 70) {
      azione(somma > 0 ? 1 : -1);
      somma = 0; bloccato = true;
      clearTimeout(timerSblocco); timerSblocco = setTimeout(() => { bloccato = false; }, 260);
    }
  }, { passive: false });
}

// =====================================================================
//  DISEGNO E AVVIO
// =====================================================================
function misuraTestata() {
  const h = document.querySelector(".topbar")?.offsetHeight || 0;
  document.documentElement.style.setProperty("--alt-testata", h + "px");
}
addEventListener("resize", misuraTestata);
if ("ResizeObserver" in window) new ResizeObserver(misuraTestata).observe(document.querySelector(".topbar"));

function disegna() {
  $("btn-anno").classList.toggle("attivo", vista === "anno");
  $("btn-mese").classList.toggle("attivo", vista === "mese");
  $("btn-giorno").classList.toggle("attivo", vista === "giorno");
  document.body.classList.toggle("admin", sonoAdmin());
  document.body.classList.toggle("prova", MODALITA_PROVA);
  document.body.classList.toggle("creatore", !MODALITA_PROVA && sonoCreatore());
  document.body.classList.toggle("ha-finti", D.profili.some(p => p.finto));
  aggiornaChipPersona();
  const nome = D.ristorante ? D.ristorante.nome : "";
  aggiornaSettore();
  document.title = nome ? `Turni · ${nome}` : "Turni";
  if (vista === "anno") disegnaAnno();
  else if (vista === "mese") disegnaMese();
  else disegnaGiorno();
  aggiornaFab();
  aggiornaBarraSelezione();
  misuraTestata();
}
// Chiamata da cloud.js quando arrivano dati nuovi da internet
let timerRidisegna = null;
function ridisegnaTutto() {
  clearTimeout(timerRidisegna);
  timerRidisegna = setTimeout(() => {
    try {
      if (!dlgScelta.open) disegna();
      aggiornaPannello();
      if (dlgCrea.open) disegnaCrea();
    } catch (e) { console.warn(e); }
  }, 60);
}
function avvioCompleto() {
  settoreVisto = mioProfilo() ? settoreDi(mioProfilo()) : null;
  // il profilo potrebbe non esserci più (es. dati di prova cancellati)
  if (!mioProfilo()) {
    if (MODALITA_PROVA) { if (io && !D.profili.length) { io = null; salvaIo(); } apriProfilo(); }
    disegna();
    return;
  }
  disegna();
  aggiornaPannello();
}

aggiornaFiltro();
disegna();
// In modalità prova si parte subito; con Supabase ci pensa cloud.js (accesso e profilo)
if (MODALITA_PROVA) avvioCompleto();
