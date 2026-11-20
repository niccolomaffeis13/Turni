"use strict";
// =====================================================================
//  CLOUD — accesso con email e sincronizzazione con i colleghi (Supabase)
//
//  Come funziona (come nell'agenda):
//  - Tutti i dati restano anche su questo dispositivo: l'app si apre e
//    si usa anche senza internet.
//  - Ogni modifica va in una "coda" e parte appena c'è connessione.
//  - Le modifiche dei colleghi arrivano in tempo reale.
//  - Ognuno può scrivere solo le sue disponibilità; chiusure, prenotati
//    e turni ufficiali li può scrivere solo l'amministratore (lo controlla
//    anche il database, non solo l'app).
// =====================================================================
(function () {
  if (MODALITA_PROVA) return;   // config.js vuoto: tutto resta sul dispositivo

  const K_CODA = "turni-coda";                 // modifiche fatte qui e non ancora inviate
  const COLONNE = {
    disponibilita: ["ristorante_id", "user_id", "giorno", "turno", "stato", "aggiornato"],
    chiusure: ["id", "ristorante_id", "dal", "al", "fino", "turno", "ripeti", "saltate", "nota", "eliminata", "aggiornato"],
    prenotati: ["ristorante_id", "giorno", "turno", "numero", "aggiornato"],
    turni: ["ristorante_id", "giorno", "turno", "persone", "aggiornato"],
    bozze: ["ristorante_id", "giorno", "turno", "persone", "attiva", "aggiornato"],
    impostazioni: ["ristorante_id", "chiave", "valore", "aggiornato"],
  };
  const CONFLITTO = { disponibilita: "user_id,giorno,turno", chiusure: "id", prenotati: "ristorante_id,giorno,turno", turni: "ristorante_id,giorno,turno", bozze: "ristorante_id,giorno,turno", impostazioni: "ristorante_id,chiave" };

  let sb = null, utente = null, canale = null, timerInvio = null, statoCloud = "spento";
  let coda = leggi(K_CODA, {});                // { "tabella|chiave": { tab, k, riga } }
  const salvaCoda = () => scriviLocale(K_CODA, coda);

  // -------------------------------------------------------------------
  //  Stato (pallino sulla rotellina)
  // -------------------------------------------------------------------
  const TESTI_STATO = {
    spento: "Non collegato",
    sincronizzo: "Sincronizzazione in corso…",
    ok: "Sincronizzato con i colleghi",
    offline: "Offline: le modifiche partiranno quando torna internet",
    errore: "Problema con la sincronizzazione: riprovo tra poco",
  };
  function impostaStato(s) {
    statoCloud = s;
    $("btn-account").dataset.stato = s;
    document.querySelectorAll("[data-stato-cloud]").forEach(el => { el.dataset.statoCloud = s; el.title = `Impostazioni · ${TESTI_STATO[s]}`; });
    $("acc-stato").textContent = TESTI_STATO[s];
    $("imp-account-testo").textContent = utente ? `${utente.email} · ${TESTI_STATO[s]}` : "Accedi per vedere i turni";
  }

  // -------------------------------------------------------------------
  //  Invio delle modifiche
  // -------------------------------------------------------------------
  window.cloudAccoda = function (tab, k, riga) {
    coda[`${tab}|${k}`] = { tab, k, riga };
    salvaCoda();
    clearTimeout(timerInvio);
    timerInvio = setTimeout(invia, 600);
  };
  const soloColonne = (tab, r) => Object.fromEntries(COLONNE[tab].map(c => [c, c === "al" || c === "fino" ? (r[c] || null) : r[c]]));

  let inviando = false;
  async function invia() {
    if (!sb || !utente || inviando) return;
    const voci = Object.entries(coda);
    if (!voci.length) { if (statoCloud !== "offline") impostaStato("ok"); return; }
    if (!navigator.onLine) { impostaStato("offline"); return; }
    inviando = true;
    impostaStato("sincronizzo");
    let errori = 0;
    try {
      for (const tab of Object.keys(COLONNE)) {
        const gruppo = voci.filter(([, v]) => v.tab === tab);
        if (!gruppo.length) continue;
        const righe = gruppo.map(([, v]) => soloColonne(tab, v.riga));
        const { error } = await sb.from(tab).upsert(righe, { onConflict: CONFLITTO[tab] });
        if (error) {
          console.warn("Invio non riuscito", tab, error);
          // permesso negato (es. non sei più amministratore): inutile riprovare all'infinito
          if (error.code === "42501" || /row-level security/i.test(error.message || "")) gruppo.forEach(([chiave]) => delete coda[chiave]);
          else errori++;
          continue;
        }
        // toglie dalla coda solo ciò che non è cambiato di nuovo nel frattempo
        gruppo.forEach(([chiave, v]) => { if (coda[chiave] && coda[chiave].riga.aggiornato === v.riga.aggiornato) delete coda[chiave]; });
      }
    } finally { inviando = false; salvaCoda(); }
    impostaStato(errori ? (navigator.onLine ? "errore" : "offline") : Object.keys(coda).length ? "sincronizzo" : "ok");
    if (Object.keys(coda).length && !errori) { clearTimeout(timerInvio); timerInvio = setTimeout(invia, 500); }
  }

  // -------------------------------------------------------------------
  //  Ricezione dei dati
  // -------------------------------------------------------------------
  // "esperto" non è nel profilo: arriva da una tabella che può leggere solo l'amministratore
  const profiloDaRiga = r => {
    const prima = D.profili.find(x => x.id === r.user_id);
    return { id: r.user_id, nickname: r.nickname, tipo: r.tipo, admin: !!r.admin, finto: !!r.finto, esperto: !!(prima && prima.esperto) };
  };
  // Supabase restituisce al massimo 1000 righe per volta: le chiede a pezzi
  async function tutte(tab, filtra = q => q) {
    const fuori = [];
    for (let da = 0; da < 100000; da += 1000) {
      const { data, error } = await filtra(sb.from(tab).select("*")).range(da, da + 999);
      if (error) throw error;
      fuori.push(...data);
      if (data.length < 1000) break;
    }
    return fuori;
  }
  function inCoda(tab, k, aggiornato) {
    const v = coda[`${tab}|${k}`];
    return v && (!aggiornato || v.riga.aggiornato >= aggiornato);
  }
  function applicaRiga(tab, r) {
    const k = chiaveRiga(tab, r);
    if (inCoda(tab, k, r.aggiornato)) return false;    // la nostra modifica è più nuova: resta quella
    D[tab][k] = r;
    return true;
  }

  async function scarica() {
    if (!sb || !utente || !D.ristorante) return;
    if (!navigator.onLine) { impostaStato("offline"); return; }
    impostaStato("sincronizzo");
    try {
      const da = chiaveData(piuGiorni(oggiMezzanotte(), -120));   // le disponibilità vecchie non servono
      const [profili, disp, chius, pren, turni, bozze, impost, info] = await Promise.all([
        tutte("profili"),
        tutte("disponibilita", q => q.gte("giorno", da)),
        tutte("chiusure"),
        tutte("prenotati", q => q.gte("giorno", da)),
        tutte("turni"),
        tutte("bozze", q => q.eq("attiva", true)),      // solo gli amministratori ne ricevono
        tutte("impostazioni"),
        sb.rpc("info_ristorante"),
      ]);
      D.profili = profili.map(profiloDaRiga);
      const ioAdmin = !!(profilo(utente.id) || {}).admin;   // il tuo account, anche se stai provando come un altro
      if (ioAdmin) {
        const esp = await tutte("esperti");
        D.profili.forEach(p => { p.esperto = esp.some(e => e.user_id === p.id && e.esperto); });
      } else D.profili.forEach(p => { p.esperto = false; });
      const nuovo = { disponibilita: disp, chiusure: chius, prenotati: pren, turni, bozze, impostazioni: impost };
      TABELLE.forEach(tab => {
        const oggetto = {};
        nuovo[tab].forEach(r => { oggetto[chiaveRiga(tab, r)] = r; });
        // le modifiche fatte qui e non ancora partite restano
        Object.values(coda).filter(v => v.tab === tab).forEach(v => {
          const remoto = oggetto[v.k];
          if (!remoto || remoto.aggiornato <= v.riga.aggiornato) oggetto[v.k] = v.riga;
        });
        D[tab] = oggetto;
      });
      if (info.data && info.data.nome) D.ristorante = { ...D.ristorante, nome: info.data.nome, creato_da: info.data.creato_da };
      salvaDati();
      if (!profilo(io)) io = utente.id;   // la persona di prova non c'è più: torni tu
      if (!profilo(utente.id)) {          // tolto dal ristorante?
        D = datiVuoti(); salvaDati(); io = null; salvaIo();
        await caricaProfilo();
        return;
      }
      ridisegnaTutto();
      await invia();
      if (statoCloud === "sincronizzo" && !Object.keys(coda).length) impostaStato("ok");
    } catch (e) {
      console.warn("Scaricamento non riuscito", e);
      impostaStato(navigator.onLine ? "errore" : "offline");
    }
  }

  function ascoltaTempoReale() {
    if (canale) sb.removeChannel(canale);
    const rid = D.ristorante.id;
    canale = sb.channel("turni-" + rid);
    ["disponibilita", "chiusure", "prenotati", "turni", "bozze", "impostazioni", "profili", "esperti"].forEach(tab => {
      canale.on("postgres_changes", { event: "*", schema: "public", table: tab, filter: `ristorante_id=eq.${rid}` }, payload => {
        const r = payload.new;
        if (!r || !Object.keys(r).length) return;
        if (tab === "esperti") {
          const p = profilo(r.user_id); if (p) p.esperto = !!r.esperto;
        } else if (tab === "profili") {
          const p = profiloDaRiga(r), i = D.profili.findIndex(x => x.id === p.id);
          const cambiatoIo = p.id === utente.id && i >= 0 && D.profili[i].admin !== p.admin;
          if (i >= 0) D.profili[i] = p; else D.profili.push(p);
          if (cambiatoIo) { salvaDati(); scarica(); return; }
        } else if (!applicaRiga(tab, r)) return;
        salvaDati();
        ridisegnaTutto();
      });
    });
    canale.subscribe();
  }

  // -------------------------------------------------------------------
  //  Profilo: crea ristorante, entra con codice, esperto, codici
  // -------------------------------------------------------------------
  function traduciErrore(e) {
    const m = (e && e.message) || String(e || "");
    if (/Invalid login credentials/i.test(m)) return "Email o password sbagliate.";
    if (/Email not confirmed/i.test(m)) return "Prima devi confermare l'email: apri il messaggio che ti è arrivato.";
    if (/already registered|already been registered/i.test(m)) return "Questa email è già registrata: usa “Accedi”.";
    if (/Password should be at least/i.test(m)) return "La password deve avere almeno 6 caratteri.";
    if (/rate limit|too many/i.test(m)) return "Troppi tentativi: aspetta qualche minuto e riprova.";
    if (/fetch|network|Failed to fetch/i.test(m)) return "Non riesco a collegarmi: controlla la connessione.";
    if (/profili_nickname/i.test(m)) return "Questo nickname c'è già nel ristorante: scegline un altro.";
    if (/ristoranti_nome|duplicate key/i.test(m)) return "Esiste già un ristorante con questo nome: scegline un altro.";
    return m.replace(/^.*?ERRORE:\s*/i, "");
  }
  async function caricaProfilo() {
    const { data, error } = await sb.from("profili").select("*").eq("user_id", utente.id).maybeSingle();
    if (error) {
      console.warn(error);
      if (mioProfilo()) { impostaStato("errore"); return; }   // offline ma con i dati salvati: si continua
      impostaStato("errore");
      return;
    }
    if (!data) {
      // primo accesso: tipologia, ruolo e nickname
      if (D.ristorante) { D = datiVuoti(); salvaDati(); }
      io = utente.id; salvaIo();
      disegna();
      apriProfilo();
      return;
    }
    if (D.ristorante && D.ristorante.id !== data.ristorante_id) { D = datiVuoti(); coda = {}; salvaCoda(); }
    io = utente.id; ioReale = utente.id; salvaIo();
    D.ristorante = { ...(D.ristorante || {}), id: data.ristorante_id };
    const p = profiloDaRiga(data), i = D.profili.findIndex(x => x.id === p.id);
    if (i >= 0) D.profili[i] = p; else D.profili.push(p);
    salvaDati();
    avvioCompleto();
    ascoltaTempoReale();
    await scarica();
  }
  async function dopoProfilo(r) {
    if (r.error) return traduciErrore(r.error);
    await caricaProfilo();
    return null;
  }
  window.cloudCreaRistorante = async (nome, password, nick, tipo) => {
    if (!navigator.onLine) return "Serve internet per creare il ristorante.";
    return dopoProfilo(await sb.rpc("crea_ristorante", { p_nome: nome, p_password: password, p_nickname: nick, p_tipo: tipo }));
  };
  window.cloudCercaRistoranti = async testo => {
    if (!navigator.onLine) return "Serve internet per cercare il ristorante.";
    const { data, error } = await sb.rpc("cerca_ristoranti", { p_testo: testo });
    return error ? traduciErrore(error) : (data || []);
  };
  window.cloudUnisciti = async (idRistorante, password, nick, tipo) => {
    if (!navigator.onLine) return "Serve internet per entrare nel ristorante.";
    return dopoProfilo(await sb.rpc("unisciti", { p_ristorante: idRistorante, p_password: password, p_nickname: nick, p_tipo: tipo }));
  };
  window.cloudImpostaAdmin = async (uid, valore) => {
    if (!navigator.onLine) return "Serve internet per cambiare gli amministratori.";
    const r = await sb.rpc("imposta_admin", { p_user: uid, p_admin: valore });
    if (r.error) return traduciErrore(r.error);
    const p = profilo(uid); if (p) { p.admin = valore; salvaDati(); }
    return null;
  };
  window.cloudCreaPersoneProva = async () => {
    if (!navigator.onLine) return "Serve internet per creare le persone di prova.";
    const r = await sb.rpc("crea_persone_prova");
    if (r.error) return traduciErrore(r.error);
    await scarica();
    return r.data || 0;
  };
  window.cloudEliminaPersoneProva = async () => {
    if (!navigator.onLine) return "Serve internet per eliminare le persone di prova.";
    const r = await sb.rpc("elimina_persone_prova");
    if (r.error) return traduciErrore(r.error);
    await scarica();
    return r.data || 0;
  };
  window.cloudCambiaPassword = async pw => {
    if (!navigator.onLine) return "Serve internet per cambiare la password.";
    const r = await sb.rpc("cambia_password_ristorante", { p_password: pw });
    return r.error ? traduciErrore(r.error) : null;
  };
  window.cloudModificaProfilo = async (nick, tipo) => {
    if (!navigator.onLine) return "Serve internet per cambiare il profilo.";
    const r = await sb.rpc("modifica_profilo", { p_nickname: nick, p_tipo: tipo });
    if (r.error) return traduciErrore(r.error);
    Object.assign(mioProfilo(), { nickname: nick, tipo }); salvaDati();
    return null;
  };
  window.cloudImpostaEsperto = async (uid, valore) => {
    if (!navigator.onLine) return "Serve internet per cambiare esperto / non esperto.";
    const r = await sb.rpc("imposta_esperto", { p_user: uid, p_esperto: valore });
    if (r.error) return traduciErrore(r.error);
    const p = profilo(uid); if (p) { p.esperto = valore; salvaDati(); }
    return null;
  };

  // -------------------------------------------------------------------
  //  Accesso / registrazione
  // -------------------------------------------------------------------
  const dlgAccesso = $("dlg-accesso");
  dlgAccesso.addEventListener("cancel", e => { if (!utente) e.preventDefault(); });
  function messaggioAccesso(testo, tipo = "") { const el = $("acc-messaggio"); el.textContent = testo; el.className = "nota acc-messaggio " + tipo; }
  function mostraAccesso() {
    const dentro = !!utente;
    $("acc-fuori").hidden = dentro;
    $("acc-dentro").hidden = !dentro;
    if (dentro) { $("acc-email-attuale").textContent = utente.email; impostaStato(statoCloud); }
    messaggioAccesso(sb ? "" : "Non riesco a raggiungere il servizio online (sei offline?). Riprova quando torna internet.", sb ? "" : "errore");
    if (!dlgAccesso.open) dlgAccesso.showModal();
  }
  async function accedi(registrati) {
    if (!sb) return;
    const email = $("acc-email").value.trim(), password = $("acc-password").value;
    if (!email || !password) { messaggioAccesso("Scrivi email e password.", "errore"); return; }
    messaggioAccesso(registrati ? "Creo l'account…" : "Accesso in corso…");
    const r = registrati
      ? await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin.startsWith("http") ? location.href.split("#")[0] : undefined } })
      : await sb.auth.signInWithPassword({ email, password });
    if (r.error) { messaggioAccesso(traduciErrore(r.error), "errore"); return; }
    if (registrati && !r.data.session) { messaggioAccesso("Account creato! Ti è arrivata un'email: apri il link per confermare, poi torna qui e premi “Accedi”.", "ok"); return; }
    $("acc-password").value = "";
    dlgAccesso.close();
  }
  $("form-accesso").addEventListener("submit", e => { e.preventDefault(); accedi(false); });
  $("acc-registrati").addEventListener("click", () => accedi(true));
  $("acc-chiudi").addEventListener("click", () => dlgAccesso.close());
  $("acc-sincronizza").addEventListener("click", async () => { await invia(); await scarica(); });
  $("acc-esci").addEventListener("click", async () => {
    if (Object.keys(coda).length && !confirm("Alcune modifiche non sono ancora partite (sei offline?). Se esci le perdi. Uscire lo stesso?")) return;
    if (!Object.keys(coda).length && !confirm("Uscire dall'account?")) return;
    await invia();
    await sb.auth.signOut();
    dlgAccesso.close();
  });
  $("acc-password-dimenticata").addEventListener("click", async () => {
    const email = $("acc-email").value.trim();
    if (!email) { messaggioAccesso("Scrivi prima la tua email qui sopra.", "errore"); return; }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin.startsWith("http") ? location.href.split("#")[0] : undefined });
    messaggioAccesso(error ? traduciErrore(error) : "Ti ho mandato un'email per scegliere una nuova password.", error ? "errore" : "ok");
  });
  $("btn-account").addEventListener("click", () => { $("dlg-impostazioni").close(); mostraAccesso(); });

  // -------------------------------------------------------------------
  //  Avvio
  // -------------------------------------------------------------------
  function avvia() {
    // con i dati salvati l'app si vede subito, anche offline
    if (io) ioReale = io;
    if (mioProfilo()) avvioCompleto();
    if (!window.supabase || !window.supabase.createClient) {
      impostaStato(navigator.onLine ? "errore" : "offline");
      if (!mioProfilo()) mostraAccesso();
      return;
    }
    sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_CHIAVE, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    sb.auth.onAuthStateChange(async (evento, sessione) => {
      const prima = utente && utente.id;
      utente = sessione ? sessione.user : null;
      if (evento === "PASSWORD_RECOVERY") {
        const nuova = prompt("Scrivi la nuova password (almeno 6 caratteri):");
        if (nuova) { const { error } = await sb.auth.updateUser({ password: nuova }); alert(error ? traduciErrore(error) : "Password cambiata!"); }
      }
      if (utente && utente.id !== prima) setTimeout(caricaProfilo, 0);   // fuori dal callback, come consiglia Supabase
      if (!utente) {
        if (canale) { sb.removeChannel(canale); canale = null; }
        if (prima) { D = datiVuoti(); salvaDati(); io = null; salvaIo(); coda = {}; salvaCoda(); disegna(); }
        impostaStato("spento");
      }
    });
    sb.auth.getSession().then(({ data }) => { if (!data.session) mostraAccesso(); });
    // quando torna internet o riapri l'app, si rimette in pari
    addEventListener("online", () => { if (utente) scarica(); });
    addEventListener("offline", () => { if (utente) impostaStato("offline"); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden && utente && D.ristorante) scarica(); });
    setInterval(() => { if (utente && Object.keys(coda).length) invia(); }, 30000);
  }
  impostaStato("spento");
  avvia();
})();
