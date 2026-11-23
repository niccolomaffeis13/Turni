"use strict";
// =====================================================================
//  PDF DEL MESE — calendario "da parete" (lun → dom), in bianco e nero.
//  Il file PDF viene creato qui dentro, senza stampa e senza librerie:
//  funziona anche offline e si salva direttamente come file.
// =====================================================================
(function () {
  // Larghezze delle lettere dei caratteri standard dei PDF (Helvetica), codici 32–255
  const LARG_N = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,761,556,500,222,556,333,1000,556,556,333,1000,667,333,1000,500,611,500,500,222,222,333,333,350,556,1000,333,1000,500,333,944,500,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500];
const LARG_B = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,761,556,500,278,556,500,1000,556,556,333,1000,667,333,1000,500,611,500,500,278,278,500,500,350,556,1000,333,1000,556,333,944,500,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556];

  // Testo → byte del PDF (codifica WinAnsi: lettere accentate italiane comprese)
  const SPECIALI = { "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97 };
  function winAnsi(t) {
    let s = "";
    for (const ch of String(t)) {
      const c = ch.codePointAt(0);
      if (SPECIALI[ch]) s += String.fromCharCode(SPECIALI[ch]);
      else if (c >= 32 && c < 127) s += ch;
      else if (c >= 160 && c <= 255) s += ch;
      else s += "?";
    }
    return s;
  }
  const esc = s => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  function larghezza(testo, corpo, grassetto) {
    const L = grassetto ? LARG_B : LARG_N; let w = 0;
    for (const ch of winAnsi(testo)) { const c = ch.charCodeAt(0); w += (c >= 32 ? L[c - 32] : 500) || 500; }
    return w * corpo / 1000;
  }
  // Va a capo con le parole; se non ci sta, l'ultima riga finisce con "…"
  function aCapo(testo, larg, corpo, grassetto, maxRighe) {
    const parole = String(testo).split(" "), righe = [];
    let riga = "";
    for (const p of parole) {
      const prova = riga ? riga + " " + p : p;
      if (larghezza(prova, corpo, grassetto) <= larg || !riga) riga = prova;
      else { righe.push(riga); riga = p; }
    }
    if (riga) righe.push(riga);
    if (righe.length > maxRighe) {
      const tenute = righe.slice(0, maxRighe);
      let ultima = tenute[maxRighe - 1];
      while (ultima && larghezza(ultima + "…", corpo, grassetto) > larg) ultima = ultima.slice(0, -1);
      tenute[maxRighe - 1] = ultima.replace(/[ ,]+$/, "") + "…";
      return tenute;
    }
    return righe;
  }

  // ---------- un piccolo "disegnatore" di pagina ----------
  function Pagina() {
    const cmd = [];
    const num = n => (Math.round(n * 100) / 100).toString();
    return {
      testo(x, y, t, corpo = 8, grassetto = false) { cmd.push(`BT /${grassetto ? "F2" : "F1"} ${num(corpo)} Tf ${num(x)} ${num(y)} Td (${esc(winAnsi(t))}) Tj ET`); },
      testoDestra(x, y, t, corpo, grassetto) { this.testo(x - larghezza(t, corpo, grassetto), y, t, corpo, grassetto); },
      testoCentro(x, y, t, corpo, grassetto) { this.testo(x - larghezza(t, corpo, grassetto) / 2, y, t, corpo, grassetto); },
      riquadro(x, y, w, h, grigio = null, spessore = 0.6) {
        if (grigio !== null) cmd.push(`${num(grigio)} g ${num(x)} ${num(y)} ${num(w)} ${num(h)} re f 0 g`);
        cmd.push(`${num(spessore)} w ${num(x)} ${num(y)} ${num(w)} ${num(h)} re S`);
      },
      linea(x1, y1, x2, y2, spessore = 0.4) { cmd.push(`${num(spessore)} w ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`); },
      contenuto: () => cmd.join("\n"),
    };
  }
  // ---------- file PDF (una pagina A4 orizzontale) ----------
  function filePDF(contenuto, W, H, titolo) {
    const oggetti = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [5 0 R] /Count 1 >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents 6 0 R >>`,
      `<< /Length ${contenuto.length} >>\nstream\n${contenuto}\nendstream`,
      `<< /Title (${esc(winAnsi(titolo))}) /Producer (Turni) >>`,
    ];
    let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
    const posizioni = [];
    oggetti.forEach((o, i) => { posizioni.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = pdf.length;
    pdf += `xref\n0 ${oggetti.length + 1}\n0000000000 65535 f \n`;
    posizioni.forEach(p => { pdf += String(p).padStart(10, "0") + " 00000 n \n"; });
    pdf += `trailer\n<< /Size ${oggetti.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const byte = new Uint8Array(pdf.length);
    for (let i = 0; i < pdf.length; i++) byte[i] = pdf.charCodeAt(i) & 255;
    return byte;
  }

  // ---------- il calendario del mese ----------
  // dati(giorno, turno) → { chiuso, sala: [nomi], cucina: [nomi], prenotati }
  window.creaCalendarioPDF = function ({ anno, mese, ristorante, dati, notaChiusura }) {
    const W = 842, H = 595, M = 22;                       // A4 orizzontale
    const pg = Pagina();
    const nomeMese = new Date(anno, mese, 1).toLocaleDateString("it-IT", { month: "long", year: "numeric" });
    const titolo = `Turni ${ristorante ? "· " + ristorante + " " : ""}· ${nomeMese.charAt(0).toUpperCase() + nomeMese.slice(1)}`;
    pg.testo(M, H - M - 14, titolo, 17, true);
    pg.testoDestra(W - M, H - M - 12, "S = sala · C = cucina · solo turni ufficiali", 7.5, false);

    const primo = new Date(anno, mese, 1);
    const vuoti = (primo.getDay() + 6) % 7;
    const giorniMese = new Date(anno, mese + 1, 0).getDate();
    const settimane = Math.ceil((vuoti + giorniMese) / 7);
    const topGriglia = H - M - 28, altTesta = 15, basso = M + 10;
    const colW = (W - 2 * M) / 7, rigaH = (topGriglia - altTesta - basso) / settimane;

    // intestazione giorni
    ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"].forEach((n, i) => {
      pg.riquadro(M + i * colW, topGriglia - altTesta, colW, altTesta, 0.88);
      pg.testoCentro(M + i * colW + colW / 2, topGriglia - altTesta + 4.5, n, 8.5, true);
    });

    const corpo = 6.9, interl = 8.1, pad = 4;
    for (let cella = 0; cella < settimane * 7; cella++) {
      const col = cella % 7, riga = Math.floor(cella / 7);
      const x = M + col * colW, yTop = topGriglia - altTesta - riga * rigaH, y = yTop - rigaH;
      const n = cella - vuoti + 1;
      if (n < 1 || n > giorniMese) { pg.riquadro(x, y, colW, rigaH, 0.95); continue; }
      pg.riquadro(x, y, colW, rigaH);
      const g = `${anno}-${String(mese + 1).padStart(2, "0")}-${String(n).padStart(2, "0")}`;
      pg.testo(x + pad, yTop - 12, String(n), 11, true);
      const turni = ["pranzo", "cena"].map(t => ({ t, ...dati(g, t) }));
      // prenotati in alto a destra
      const pren = turni.filter(v => !v.chiuso && v.prenotati).map(v => `${v.t === "pranzo" ? "P" : "C"} ${v.prenotati}`);
      if (pren.length) pg.testoDestra(x + colW - pad, yTop - 10.5, `Pren. ${pren.join(" · ")}`, 6.8, false);

      if (turni.every(v => v.chiuso)) {
        pg.testoCentro(x + colW / 2, y + rigaH / 2 - 2, "CHIUSO", 11, true);
        const nota = notaChiusura(g);
        if (nota) pg.testoCentro(x + colW / 2, y + rigaH / 2 - 12, nota.slice(0, 26), 6.8, false);
        continue;
      }
      let cy = yTop - 22;
      const minY = y + 3;
      const larg = colW - 2 * pad;
      for (const v of turni) {
        if (cy < minY + interl) break;
        if (v.chiuso) { pg.testo(x + pad, cy, `${v.t === "pranzo" ? "PRANZO" : "CENA"}: chiuso`, corpo, true); cy -= interl + 1.5; continue; }
        pg.testo(x + pad, cy, v.t === "pranzo" ? "PRANZO" : "CENA", corpo - 0.4, true);
        cy -= interl;
        if (!v.sala.length && !v.cucina.length) { pg.testo(x + pad + 2, cy, "—", corpo, false); cy -= interl + 1.5; continue; }
        for (const [sigla, nomi] of [["S", v.sala], ["C", v.cucina]]) {
          if (!nomi.length) continue;
          const spazio = Math.max(1, Math.floor((cy - minY) / interl) + 1);
          const etichettaW = larghezza(sigla + "  ", corpo, true);
          const righe = aCapo(nomi.join(", "), larg - etichettaW, corpo, false, Math.min(3, spazio));
          pg.testo(x + pad, cy, sigla, corpo, true);
          righe.forEach((r, i) => { pg.testo(x + pad + etichettaW, cy - i * interl, r, corpo, false); });
          cy -= righe.length * interl;
          if (cy < minY) break;
        }
        cy -= 2.5;
      }
    }
    pg.testo(M, M - 4, `Creato il ${new Date().toLocaleDateString("it-IT")} · i turni possono cambiare: controlla sempre l'app`, 6.5, false);
    return { byte: filePDF(pg.contenuto(), W, H, titolo), nomeFile: `Turni ${nomeMese}.pdf` };
  };
})();
