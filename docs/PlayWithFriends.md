# Playing with other people

Multiplayer needs a running OpenWars server that the other players can reach.
Single-player runs entirely in the browser; multiplayer does not.

## From a GitHub Codespace (quick, temporary)

1. In the Codespace terminal:

   ```bash
   npm run dev
   ```

2. Open the **Ports** tab, right-click port **9000** and choose
   **Port Visibility → Public**. (Private, the default, asks every visitor to
   sign in to GitHub as you.)
3. Copy the port's **Forwarded Address** (`https://<name>-9000.app.github.dev`)
   and send it to the people you want to play with.
4. Everyone opens that link and joins the same lobby: a public lobby from the
   Play page, or a private one you create and share.

Limits of this setup:

- The Codespace must stay running. GitHub stops an idle Codespace after
  30 minutes by default (Settings → Codespaces → Default idle timeout), and
  stopping it ends every game in progress.
- It runs the development server: fine for friends, not for a public launch.
- Public matches also contain AI nations and tribes; that is how the game's
  modes are set up, not a sign that nobody joined.

## A permanent server

For a game anyone can find at any time, deploy the Docker image built from
`Dockerfile` to a server with a public HTTPS hostname (see
`docs/PokiWebBuild.md`, "What multiplayer needs (backend)", for the settings).
