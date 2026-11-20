# Turni — app per i turni del ristorante

Stessa impostazione dell'agenda: viste Anno / Mese / Giorno, scorrimento col dito a sinistra e a destra (o le frecce ← → della tastiera), tema chiaro / grigio / scuro, barra laterale su PC e iPad, barra in basso su iPhone. Funziona anche offline e si aggiorna quando torna internet.

## Provarla subito (modalità prova)

Finché `config.js` è vuoto, tutto resta sul tuo dispositivo e puoi fingere di essere più persone.

1. Apri la cartella in VS Code e avvia **Live Server** su `index.html` (oppure fai doppio clic su `index.html`).
2. Crea il ristorante: scegli fisso o occasionale e il nickname. Chi crea il ristorante è amministratore.
3. Rotellina → **Aggiungi persone di esempio**: arrivano 6 colleghi finti con disponibilità a caso.
4. Rotellina → **Cambia utente (prova)**: vedi l'app come un fisso, un occasionale o l'amministratore.

## Cosa fa

- **Accesso:** *Crea ristorante* (nome + password, diventi amministratore) oppure *Cerca ristorante* (nome + password, entri come collaboratore). Poi fisso / occasionale e nickname. Esperto / non esperto lo segna l'amministratore e lo vede solo lui.
- **Fisso:** segna solo quando NON c'è. **Occasionale:** segna "Ci sono" e "Non ci sono". Si segna dal giorno (o dall'elenco sotto il mese), oppure per più giorni con **Segna** / **+**.
- **Giorni aperti:** si vedono i disponibili di pranzo e cena. Con **⋯** sul giorno (o tenendo premuto / tasto destro nel mese) vedi chi ha detto che non c'è e chi non ha risposto.
- **Chiusure** (amministratore): giorno rosso, anche solo pranzo o solo cena, con ripetizione (ogni settimana / mese / anno). Puoi riaprire un singolo giorno da ⋯ → *Riapri solo questo giorno*.
- **Prenotati** (amministratore): numero blu con scritto "prenotati" dentro la giornata.
- **Crea turni ufficiali** (amministratore): si scorre di giorno in giorno saltando le chiusure, si scelgono i disponibili. Accanto al nome c'è il numero di turni del mese; chi ne ha meno sta più in alto. Finché non premi **Fine** è una bozza che vedi solo tu. Con **Fine → Pubblica** tutti vedono i turni.
- **Filtro** (tasto con le tre righe): *Solo i miei turni* oppure *Quando ci sono*.
- **Miei turni:** elenco dei tuoi prossimi turni ufficiali.

## Collegarla online (per usarla con i colleghi)

1. Su supabase.com crea un **nuovo progetto** chiamato `turni` (separato da `agenda`, regione Europa).
2. **SQL Editor** → incolla tutto `supabase-setup.sql` → **Run**.
3. **Project Settings → API**: copia *Project URL* e *Publishable key* dentro `config.js`.
4. Pubblica la cartella su Vercel come hai fatto con l'agenda.
5. **Authentication → URL Configuration** su Supabase: metti l'indirizzo del sito Vercel.

Il primo che entra sceglie **Crea ristorante** (nome + password del ristorante) e diventa amministratore.
Gli altri premono **Cerca ristorante**, scrivono il nome, lo toccano e mettono la password: entrano come collaboratori.
Un amministratore può nominare altri amministratori da **Persone** → tocca il nome → **Rendi amministratore**.
La password del ristorante si cambia da Impostazioni → **Far entrare i colleghi**.

## File

| File | Cosa contiene |
|---|---|
| `index.html` | La struttura delle schermate |
| `style.css` | Lo stile dell'agenda (uguale) |
| `turni.css` | Le aggiunte per i turni (pranzo arancio, cena viola, chiuso rosso, prenotati blu) |
| `app.js` | Tutto il funzionamento |
| `cloud.js` | Accesso e sincronizzazione con Supabase |
| `config.js` | Indirizzo e chiave di Supabase (vuoto = modalità prova) |
| `sw.js`, `manifest.json`, `icone/` | Installazione come app e uso offline |
| `supabase-setup.sql` | Tabelle e permessi del database |
