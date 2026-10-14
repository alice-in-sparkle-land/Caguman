# Caguman · Sổ chi tiêu chuyến đi

A shared trip ledger for phones: trips, members, expenses split equally, "who pays whom", and recorded payments. It works offline and syncs between phones through your own Cloudflare Worker and D1 database, using one shared PIN.

- **App:** `public/caguman.html`, one self-contained file with no external fonts or scripts. It also works as a saved file opened in Chrome; enter the site address under Cài đặt → Đồng bộ.
- **Server:** `worker.js` serves the page and the sync API at `/api/*`.
- **Address after setup:** `https://caguman.<your-account>.workers.dev`

## Set up the site (about 15 minutes)

1. **Create the database.** In Cloudflare, go to Storage & Databases → D1 SQL Database → Create, and name it `caguman-db`. Copy its **Database ID**.
2. **Paste the ID.** In this repository, open `wrangler.jsonc` and replace `PASTE-YOUR-DATABASE-ID-HERE` with the ID. Keep the quotes, then commit.
3. **Create the Worker.** Go to Workers & Pages → Create → Import a repository, and pick `caguman`. Keep the deploy command `npx wrangler deploy`. The Worker name must be `caguman`, the same as `"name"` in `wrangler.jsonc`.
4. **Set the PIN.** Go to Worker → Settings → **Runtime variables and secrets** → Add. Choose type **Secret**, name it `PIN`, and enter 4 digits.
   - Don't use the "Variables and secrets" under **Build**; the running Worker can't see those.
5. **Check it works.** Open `https://caguman.<your-account>.workers.dev/api/ping`.
   - `"error":"pin"` means everything is working.
   - `"error":"setup"` names what's missing (the database or the PIN).
6. **Connect each phone.** Open the address on each phone, go to Cài đặt → Đồng bộ, enter the PIN and tap **Kết nối**. Each phone handles its first connection as follows:
   - If the cloud is empty, this phone uploads its data.
   - If the phone has no data, it downloads the cloud copy.
   - If both have data, it asks whether to **merge both** or **use the cloud copy**.

Notes:
- The database link lives in `wrangler.jsonc`, so every deploy from GitHub keeps it. Secrets survive deploys.
- Don't reuse another tool's Worker, database or PIN.

## Edit and build

The source is in `src/`: `data.js`, `scene.js`, `sync.js`, `app.js`, `io.js`, `app.css` and `shell.html`. To rebuild the page:

```
python3 build.py        # writes public/caguman.html
```

If the page changes in a way that matters offline, bump `CACHE` in `public/sw.js`.

## Tests

```
node test/server.mjs 8787 &                 # real worker.js + fake D1
python3 test/t_core.py                      # 86 checks: maths, forms, import/export, old files, injection, Back gesture, storage/history blocked, crash → Lite mode, memory, 360 px
python3 test/t_sync.py                      # 43 checks: 2–3 phones, conflicts, offline, slow saves, delete races, Replace/Erase spreading, 12,000 records, PIN lockout, foreign/corrupt data
python3 test/t_visual.py                    # offline reopen + screenshots of every theme × time of day
BASE=http://localhost:8788 python3 test/t_wrangler.py   # against `wrangler dev` (PIN in .dev.vars, never committed)
```

## Data and privacy

- **On the phone:** everything is stored under the localStorage keys `cgm.*`.
- **Never synced or backed up:** the PIN, theme, Lite mode, current trip and backup counters stay on each phone.
- **Backups:** `caguman-backup-YYYYMMDD-HHMM.json`. Import offers **Merge** or **Replace**. Files from the old "Sổ chi tiêu chuyến đi" (`trip-ledger`) import into a trip called "Chuyến đi (sổ cũ)"; several old files merge without duplicates.
