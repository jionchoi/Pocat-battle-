# Cat Frame — setup and run

Everything needed to get the app running against a real database. Written for macOS.

---

## 1. Architecture in one paragraph

The mobile app talks to **one** thing: the Node API. Node is the only process with a
database connection. Supabase is used **purely as managed Postgres** — a connection string
consumed by Prisma. Supabase's auto-generated REST API, its client SDK, and Row Level
Security are deliberately unused, and the app never holds a database key of any kind.

That is not ceremony. **Every photo score is computed server-side**, from Vision signals
the client never sees. The client sends an image and a location and nothing else that
could influence a score — there is nothing to tamper with because the client computes
nothing that matters. See README section 2a.

---

## 2. What you need

| | Required? | Notes |
|---|---|---|
| Node 18+ | yes | you have v24.9.0 |
| A Postgres database | yes | Supabase project, or local Postgres |
| Xcode | for the iOS simulator | you have 26.4.1 |
| Google Cloud Vision key | **no** for local | `VISION_DEV_BYPASS=true` skips it |
| Redis | **no** for local | falls back to an in-process store |
| Supabase Storage keys | **no** | without them, cards show a no-photo state |
| Apple/Google IAP creds | **no** | shop buttons are disabled |

---

## 3. Environment variables

Live in `server/.env`. That file is gitignored; `server/.env.example` is the committed
template and must never contain real values.

### Mandatory — the server refuses to boot without these

| Var | What it is |
|---|---|
| `DATABASE_URL` | Postgres connection string. Supabase: the **pooled** URL, port `6543` |
| `JWT_ACCESS_SECRET` | ≥ 24 chars. `openssl rand -base64 48` |
| `JWT_REFRESH_SECRET` | ≥ 24 chars, **different** from the access secret |

The two secrets differ on purpose: a leaked access secret must not be able to mint refresh
tokens.

### Mandatory for migrations only

| Var | What it is |
|---|---|
| `DIRECT_URL` | Supabase **direct** URL, port `5432` |

Read by Prisma directly, not by the app's config. Migrations cannot run through pgbouncer,
so this must be the `5432` URL. **This is the most common way Supabase setup fails.**

### Has sane defaults — leave alone locally

`PORT` (4000) · `NODE_ENV` (development) · `ACCESS_TOKEN_TTL` (15m) ·
`REFRESH_TOKEN_TTL_DAYS` (30) · `VISION_PROVIDER` (google) · `APPLE_BUNDLE_ID`

### Optional — features stay off until set

| Var | Off means |
|---|---|
| `REDIS_URL` | in-process rate limiting. Correct for one instance; **production refuses to boot without it** |
| `GOOGLE_VISION_API_KEY` + `VISION_DEV_BYPASS=false` | with bypass on, every photo is accepted and scored from stubbed signals |
| `ANTHROPIC_API_KEY` + `CAPTION_LLM_ENABLED=true` | captions come from the built-in template engine instead of an LLM |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | photos aren't stored; cards show their no-photo state, but scoring still works |
| `PHOTO_CDN_BASE_URL` | photos serve from Supabase rather than an edge CDN |
| `GOOGLE_OAUTH_CLIENT_IDS` | Google sign-in stays disabled |
| `APPLE_SHARED_SECRET`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | purchases stay disabled |
| `EXPO_ACCESS_TOKEN` | push notifications don't send |
| `SENTRY_DSN` | no crash reporting |

**The service role key is server-side only.** It bypasses every Postgres policy. It must
never appear in the app, in `app.json`, or in a commit.

### Two production guards

`server/src/config.ts` refuses to boot when `NODE_ENV=production` and either:

- `VISION_DEV_BYPASS=true` — that would disable photo verification entirely
- `REDIS_URL` is empty — the submission rate limit would be per-instance, so spreading
  requests across the fleet would multiply the real allowance by the instance count

It also refuses to boot with `CAPTION_LLM_ENABLED=true` and no `ANTHROPIC_API_KEY`, rather
than silently falling back to templates in a build that was meant to have LLM captions.

---

## 4. Steps

### 4.1 Database

**Supabase.** Project Settings → Database → Connection string. Pick **Session pooler** —
one URL is enough locally:

```bash
cd server
./setup-db.sh --supabase \
  'postgresql://postgres.REF:PW@aws-0-REGION.pooler.supabase.com:5432/postgres'
```

**Do not use the "Direct connection" string** (`db.<ref>.supabase.co`). Supabase serves it
over IPv6 only unless the project has the IPv4 add-on, so on most home and office networks
it is unroutable — and Prisma reports that as `P1001 Can't reach database server`, which
reads like a firewall problem rather than a DNS one. `setup-db.sh` now detects this and
tells you, but it is worth knowing why.

Two things change between the direct and pooler strings, and missing either looks like a
password problem:

| | direct | session pooler |
|---|---|---|
| host | `db.<ref>.supabase.co` | `aws-0-<region>.pooler.supabase.com` |
| username | `postgres` | `postgres.<ref>` |

**Session, not Transaction.** Session mode (`5432`) is a drop-in for a direct connection,
so migrations work through it. Transaction mode (`6543`) is pgbouncer, and Prisma
migrations cannot run through it — that is the only reason the script takes a second URL
at all. For production you would use `6543` for the app and `5432` for migrations; locally
one process means one connection, so the session pooler alone is simpler and correct.

**Local Postgres** — identical code path, no signup:

```bash
cd server
./setup-db.sh --local 'your-postgres-password'
```

Either writes `.env`, migrates, and seeds. To do it by hand instead:

```bash
cd server
npx prisma generate
npx prisma migrate dev --name catframe_init
npm run db:seed
```

**The seed is optional now.** Dropping the battle system removed the ability rows that
capture used to hard-depend on, so a fresh database can score a photo immediately. The
seed opens a challenge so the Challenges tab is not empty, and drops a few map sightings
once at least one account exists. The rotation job would open a challenge within ten
minutes anyway — the seed just saves you the wait.

### 4.2 Run

Two terminals:

```bash
cd server && npm run dev     # API on :4000
npm start                     # then press "i" for the iOS simulator
```

`localhost:4000` resolves correctly from the iOS simulator. **On a physical phone it does
not** — `localhost` there means the phone. You do not need to edit anything for that: when
`extra.apiBaseUrl` points at a local address, the client swaps in whichever host the app
reached Metro on, keeping the port. A hard-coded LAN IP would go stale on the next DHCP
lease and fail as a timeout, which looks like a dead server rather than a wrong address.

The phone does have to be on the same Wi-Fi as your machine. If signup times out, that is
the first thing to check — followed by `ipconfig getifaddr en0` matching the IP in the
Expo QR screen.

### 4.3 Check it worked

```bash
curl http://localhost:4000/health
# {"ok":true,"service":"catframe",...}
```

Then in the app: sign up → the map should load → tap the camera button → point at anything
→ hold still until the countdown ring starts → wait or tap the shutter → the score reveal
should appear with a breakdown and caption suggestions.

---

## 5. What works right now

**Works end to end:** signup and login, session persistence and token refresh, the capture
loop (on-device detection → framing window → server-side scoring → reveal), the photo
album with offline cache, the Cat Dex with recurring-cat matching and per-player
nicknames, photo detail with caption/share/showcase/delete, the map with crowd-sourced
sightings, weekly challenges with entry and automatic judging, the community feed with
reactions, the two-layer scoring system (instant algorithmic score plus a smoothed
community engagement ratio that drives rank), leaderboards across four scopes and four
metrics, friends, and account deletion.

**Deliberately disabled** — visible in the UI rather than hidden, so it's obvious they exist:

- **Social sign-in.** Node verifies Google and Apple ID tokens already; the client needs
  `expo-auth-session` / `expo-apple-authentication` plus store credentials.
- **In-app purchases.** Receipt validation against Apple and Google is implemented
  server-side; the client needs an IAP module and configured products. A fake local grant
  would lie about what a player owns.
- **LLM captions.** `server/src/integrations/caption.ts` ships both paths: a template
  engine keyed on the detected pose (README phase 1) and an LLM writer (phase 2). Set
  `ANTHROPIC_API_KEY` and `CAPTION_LLM_ENABLED=true` to switch. The LLM path falls back to
  templates on any failure — a caption is never worth failing a capture over.
- **ML Kit detection.** `src/services/catDetection.ts` defines the interface the camera
  consumes and ships a working heuristic against `expo-camera`. Swapping in
  `react-native-vision-camera` + ML Kit changes no screens. Note the on-device detector
  only decides *when the framing window opens* — it never affects a score.
- **Satoshi font.** Not on Google Fonts. Download the four weights from
  fontshare.com/fonts/satoshi into `src/assets/fonts/` and uncomment the block in `App.tsx`.
  Until then the app falls back to the platform font.

---

## 6. Things that will trip you up

**Seeded sightings are in central London.** Re-run with your own centre:
`SEED_LAT=37.5665 SEED_LNG=126.9780 npm run db:seed`. Sightings only seed once an account
exists, so sign up first.

**Simulator location is fake.** In the Simulator: Features → Location → Custom Location.
Capture *requires* a location — without one the submission is rejected with
`location-required`, because a photo with no coordinates cannot be matched to a cat or
scored for rarity.

**The framing window needs a stable detection first.** Point the camera at something
textured and hold still; the heuristic detector needs ~12 consecutive frames before the
countdown opens. A blank wall will never trigger it.

**`prisma migrate` fails against Supabase.** Two different causes, and the error tells you
which:

- `P1001 Can't reach database server` — you used the direct (`db.<ref>.supabase.co`) host
  on an IPv4-only network. Switch to the session pooler.
- `P1000 Authentication failed` — wrong password, or you kept the plain `postgres` username
  on a pooler URL. The pooler needs `postgres.<ref>`.
- Anything about prepared statements — you used the `6543` transaction pooler for
  `DIRECT_URL`. Migrations need session mode.

**Everything 401s.** The access token is 15 minutes. The client refreshes automatically; if
refresh fails it signs you out to the auth stack rather than looping.

**Server won't boot.** It prints exactly which env var is wrong and why — the config is
validated once at startup rather than failing at 3am on a request.

---

## 7. Before you deploy

- [ ] Fresh `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`, different from each other and from local
- [ ] `VISION_DEV_BYPASS=false` and a real `GOOGLE_VISION_API_KEY` — the boot guard enforces this
- [ ] `REDIS_URL` set — the boot guard enforces this
- [ ] Node host in the **same region** as the database (see the region discussion; `us-west-1` for a US/Canada/Korea mix)
- [ ] `PHOTO_CDN_BASE_URL` set — the highest-impact change for perceived speed far from your region
- [ ] Recompute `COMMUNITY.priorVoteRate` from real traffic — it ships as a 0.12 guess, and every community score is measured against it
- [ ] Plan a `PhotoView` retention policy: one row per viewer per photo is correct but unbounded, and only the last 30 days feed the leaderboards
- [ ] Decide on the caption path: templates are free and instant, the LLM costs per capture
- [ ] Re-verify Google Cloud Vision pricing — the figures in `integrations/vision.ts` move
- [ ] Confirm the privacy copy covers cross-border data transfer if launching in Korea (PIPA)
- [ ] Confirm the App Store listing declares photo and precise-location use honestly
