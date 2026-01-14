# Gestionale Ticket FIXLAB

Il gestionale salva i dati direttamente nel browser (localStorage/IndexedDB). Per evitare cancellazioni automatiche o perdite quando si svuota la cache:

- Usa il pulsante **"💾 Blocca dati nel browser"** nella barra "Backup e Export" per richiedere storage persistente (quando supportato dal browser).
- Il gestionale salva automaticamente un backup locale con timestamp e consente di scaricare/ripristinare l’ultimo backup dalla sezione Backup.
- Scarica un backup JSON o i CSV (Ticket/Magazzino/Clienti) e conservali in una cartella del progetto o su cloud (Drive, Dropbox, ecc.).
- Puoi anche salvare direttamente un file locale con **"📂 Salva in cartella"**: scegli una directory e il backup verrà scritto lì (feature supportata dai browser basati su Chromium).

## DeepSeek AI configuration

The AI diagnosis panel calls the DeepSeek API directly from the client. Configure one of the following environment variables (for example on Railway) before building:

- `VITE_DEEPSEEK_API_KEY`: your DeepSeek API key. Only `VITE_` variables are bundled in the client; remember to rebuild after changing it.
- `VITE_DEEPSEEK_API_URL`: base URL for the API (defaults to `https://api.deepseek.com`). Make sure the endpoint is reachable via HTTPS from your deployment domain and allows CORS requests from the app origin.

Copy `.env.example` to `.env` and set the values locally if you want to test AI calls during development. Only the `VITE_*` variables are read at build time to avoid leaking server-only secrets.

Copy `.env.example` to `.env` and set the values locally if you want to test AI calls during development. Non-`VITE_` names are injected into the client bundle automatically to support hosting providers that reserve the `VITE_` prefix.
