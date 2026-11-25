# Hosting OpenWars yourself (free)

This puts the whole game on one server: multiplayer, sign-in with Discord and
Google, and saved progress (levels, XP, games and wins). Everything here is
free.

What runs (`deploy/docker-compose.yml`):

| Part     | What it does                                                        |
| -------- | ------------------------------------------------------------------- |
| game     | The game itself: web page, lobbies, matches                         |
| accounts | Sign-in and saved progress (`src/accounts/`), in one database file  |
| caddy    | HTTPS, with free certificates from Let's Encrypt, renewed by itself |

Players who never sign in still keep their progress in that browser (a guest
account). Signing in later keeps it, and makes it follow them to any device.

You need:

1. a server that is always on (step 1),
2. a free web address pointing at it (step 2),
3. a Discord app and a Google app for sign-in (steps 4 and 5).

Replace `openwars.duckdns.org` below with your own address everywhere.

## 1. A server

Pick one.

### Option A: Oracle Cloud "Always Free" (recommended)

Free for good, always on, with its own fixed IP.

1. Sign up at <https://www.oracle.com/cloud/free/>. It asks for a card to
   check you are a real person; Always Free resources are not charged.
2. Create an instance (Compute → Instances → Create):
   - Image: **Ubuntu 24.04**.
   - Shape: **Ampere (VM.Standard.A1.Flex)**, 2–4 OCPUs and 12–24 GB memory,
     all within Always Free. If it says "out of capacity", try again later or
     in another availability domain.
   - Add your SSH key, and create it. Note its **public IP**.
3. Open the web ports. In the instance's subnet → **Security List** → **Add
   Ingress Rules**: source `0.0.0.0/0`, TCP, destination ports `80,443`.
4. SSH in (`ssh ubuntu@<public IP>`) and open the same ports on the server's
   own firewall:

   ```bash
   sudo iptables -I INPUT 6 -p tcp -m multiport --dports 80,443 -j ACCEPT
   ```

   ```bash
   sudo netfilter-persistent save
   ```

### Option B: your own computer (e.g. a Debian laptop)

Works if your internet provider lets you host (no CGNAT: your router's WAN IP
must equal what <https://whatismyip.com> shows).

1. Give the computer a fixed address on your network (router settings: DHCP
   reservation), keep it plugged in, and stop it sleeping with the lid
   closed: in `/etc/systemd/logind.conf` set `HandleLidSwitch=ignore`, then
   `sudo systemctl restart systemd-logind`.
2. In your router, **forward ports 80 and 443** (TCP) to that computer.

## 2. A free web address (DuckDNS)

1. Sign in at <https://www.duckdns.org> and create a subdomain, e.g.
   `openwars` → `openwars.duckdns.org`. Every name under it, like
   `api.openwars.duckdns.org`, points to the same place, which is what the
   accounts service needs.
2. Set its IP to your server's public IP (Option A), or, at home
   (Option B), keep it updated when your home IP changes:

   ```bash
   (crontab -l 2>/dev/null; echo "*/5 * * * * curl -s 'https://www.duckdns.org/update?domains=openwars&token=YOUR_DUCKDNS_TOKEN&ip=' >/dev/null") | crontab -
   ```

## 3. Install Docker and get the game

On the server:

```bash
curl -fsSL https://get.docker.com | sudo sh
```

```bash
sudo usermod -aG docker $USER && newgrp docker
```

```bash
git clone https://github.com/NaBrO-pixel/OpenWars.io.git && cd OpenWars.io
```

```bash
cp deploy/env.example deploy/.env
```

Edit `deploy/.env` (`nano deploy/.env`): set `DOMAIN`, and `API_KEY` to the
output of:

```bash
openssl rand -hex 32
```

## 4. Discord sign-in

1. Open <https://discord.com/developers/applications> → **New Application**,
   name it OpenWars.
2. **OAuth2** → **Redirects** → **Add Redirect**:
   `https://api.openwars.duckdns.org/auth/callback/discord`. Save.
3. Copy the **Client ID** and **Client Secret** (Reset Secret) into
   `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` in `deploy/.env`.

## 5. Google sign-in

1. Open <https://console.cloud.google.com/>, create a project "OpenWars".
2. **APIs & Services → OAuth consent screen** (Google Auth Platform):
   External; app name OpenWars; your email as support and developer contact.
   Under **Audience**, press **Publish app** so anyone can sign in (only the
   basic "email" and "openid" scopes are used, which need no review).
3. **Credentials → Create credentials → OAuth client ID** → Web application.
   Under **Authorized redirect URIs** add
   `https://api.openwars.duckdns.org/auth/callback/google`.
4. Copy the client ID and secret into `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET` in `deploy/.env`.

## 6. Start it

```bash
cd deploy && docker compose up -d --build
```

The first build takes 10–20 minutes. Then open
`https://openwars.duckdns.org`: play, and try **Sign in** → Discord or Google.
Caddy may need a minute to get the HTTPS certificates on first start.

See what is happening:

```bash
docker compose logs -f
```

## Day to day

- **Update** to the latest version on `main`:

  ```bash
  git pull && docker compose up -d --build
  ```

- **Back up** progress and accounts: everything is in `deploy/data/accounts`
  (copy the whole folder; `jwt-key.json` in it keeps everyone signed in).

  ```bash
  tar czf openwars-backup-$(date +%F).tgz data/accounts
  ```

- **Stop**: `docker compose down` (data is kept).

## Good to know

- `deploy/.env` holds your secrets. It is git-ignored; never share it.
- Without `DISCORD_*` or `GOOGLE_*` set, that sign-in button shows a "not set
  up" page. Guests still keep progress.
- Turnstile (Cloudflare's bot check on joins) is off unless you set
  `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`.
- XP rules follow the original game: a played game, minutes alive, placement
  and wins. Solo games pay a quarter, private lobbies half (with 4+ players).
- Not included yet: friends, clans, leaderboards, the store, custom
  usernames, prestige.
- Signing in on a browser that already has a guest account: a new
  Discord/Google account takes the guest's progress; an account you used
  before is simply signed in to (the guest progress stays with the guest).

## Local development

`npm run dev` starts the accounts service too (on port 8787, data in
`data/accounts/`), so guest progress works locally. To try Discord or Google
sign-in locally, set the `DISCORD_*` / `GOOGLE_*` variables and add
`http://localhost:8787/auth/callback/discord` (or `/google`) as a redirect in
the provider's settings.

## Tested setup

This guide's `deploy/` stack (game server, accounts service and Caddy) has
been run end to end from a fresh image build. In that run, two players hosted
and joined a private OpenWars lobby over HTTPS, played a match against 70 AI
nations, and the AI built its factories, airbases, aircraft and tanks.

Sign-in needs the accounts service reachable at `api.<DOMAIN>`. Hosting or
joining a lobby asks it for a guest session first, so if `api.<DOMAIN>`
doesn't resolve to your server, creating a lobby fails with "Invalid creator
token".
