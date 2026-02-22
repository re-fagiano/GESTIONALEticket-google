# Gestionale Ticket FIXLAB

Il gestionale salva i dati direttamente nel browser (localStorage/IndexedDB). Per evitare cancellazioni automatiche o perdite quando si svuota la cache:

- Usa il pulsante **"💾 Blocca dati nel browser"** nella barra "Backup e Export" per richiedere storage persistente (quando supportato dal browser).
- Il gestionale salva automaticamente un backup locale con timestamp e consente di scaricare/ripristinare l’ultimo backup dalla sezione Backup.
- Scarica un backup JSON o i CSV (Ticket/Magazzino/Clienti) e conservali in una cartella del progetto o su cloud (Drive, Dropbox, ecc.).
- Puoi anche salvare direttamente un file locale con **"📂 Salva in cartella"**: scegli una directory e il backup verrà scritto lì (feature supportata dai browser basati su Chromium).

## Formato import/export magazzino

L'importazione del magazzino accetta file **CSV** o **Excel (.xlsx)** con intestazioni **esattamente** in questo ordine:

1. POSIZIONE
2. CODICE
3. DESCRIZIONE
4. PREZZO AL PUBBLICO
5. QUANTITA

Le righe vuote vengono ignorate. Tutti i campi sono obbligatori tranne **POSIZIONE**. Il gestionale verifica i codici duplicati nel file e somma le quantità se un codice è già presente nel magazzino. I numeri possono usare la virgola come separatore decimale (es. `12,50`).

Per estendere il formato con nuove colonne (es. fornitore, categoria, data di scadenza), aggiungi le nuove intestazioni e aggiorna il parser in `src/utils/inventoryImport.js` mantenendo la validazione dell'ordine delle colonne.

## DeepSeek AI configuration

The frontend calls only the internal proxy endpoint `/api/deepseek`.
Configure DeepSeek credentials only on the backend environment:

- `DEEPSEEK_API_KEY`: required server-side API key used by `server.js`.
- `DEEPSEEK_API_URL`: optional base URL (default `https://api.deepseek.com`).

Copy `.env.example` to `.env` and set backend values locally when testing. Do not expose DeepSeek keys with `VITE_*` variables.

## Modalità memoria MBI e deploy su Railway/"Highway"

La modalità **MBI (Mirror Backup Incrementale)** nel pannello Impostazioni aggiunge:
- snapshot ridondante locale su IndexedDB;
- pulsante **Sincronizza MBI ora** per inviare subito lo snapshot al backend remoto (`/api/import`).

Per avere persistenza stabile in cloud (Railway):
1. configura un volume persistente e imposta `DB_PATH` (es. `/data/gestionale.db`);
2. imposta `API_TOKEN` in variabili ambiente per autenticare il backend;
3. esponi l'app via dominio Railway e usa il token dalla sezione Impostazioni del frontend;
4. (consigliato) pianifica un job periodico che richiama backup JSON e lo salva su Google Drive.

Google Drive come storage remoto:
- usare Drive come **backup snapshot** (JSON), non come database primario;
- mantenere una cartella per ambiente (`prod`, `staging`) e retention (es. ultimi 30 file).
