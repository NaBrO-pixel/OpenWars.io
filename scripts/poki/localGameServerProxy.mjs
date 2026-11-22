// Local HTTPS stand-in for production nginx (nginx.conf), for testing a Poki
// web build's multiplayer against `npm run dev` (docs/PokiWebBuild.md).
//
// A page that names its game server (POKI_GAME_SERVER) always uses wss:// and
// https:// (ClientEnv.resolveServerOrigin), and the Vite dev server answers
// CORS preflights itself, so this proxy sits in front of the dev server's
// Node processes instead: /wN/... -> worker port 3001+N (prefix stripped, as
// nginx does), /api/create_game -> a worker, everything else -> the master
// (3000). WebSocket upgrades included.
//
//   openssl req -x509 -newkey rsa:2048 -nodes -days 7 -subj /CN=localhost \
//     -keyout /tmp/poki-key.pem -out /tmp/poki-cert.pem
//   node scripts/poki/localGameServerProxy.mjs /tmp/poki-key.pem /tmp/poki-cert.pem
//
// Listens on https://localhost:9443 (PORT to change). Local testing only.
import fs from "fs";
import http from "http";
import https from "https";
import net from "net";

const [keyPath, certPath] = process.argv.slice(2);
if (!keyPath || !certPath) {
  console.error("usage: localGameServerProxy.mjs <key.pem> <cert.pem>");
  process.exit(2);
}
const PORT = Number(process.env.PORT ?? 9443);

function route(url) {
  const m = url.match(/^\/w(\d+)(\/.*)?$/);
  if (m) return { port: 3001 + Number(m[1]), path: m[2] ?? "/" };
  if (url.startsWith("/api/create_game")) return { port: 3001, path: url };
  return { port: 3000, path: url };
}

const server = https.createServer(
  { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) },
  (req, res) => {
    const t = route(req.url);
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: t.port,
        path: t.path,
        method: req.method,
        headers: req.headers,
      },
      (r) => {
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
      },
    );
    upstream.on("error", (e) => {
      res.writeHead(502);
      res.end(String(e));
    });
    req.pipe(upstream);
  },
);

server.on("upgrade", (req, socket, head) => {
  const t = route(req.url);
  const upstream = net.connect(t.port, "127.0.0.1", () => {
    let raw = `${req.method} ${t.path} HTTP/1.1\r\n`;
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
    }
    upstream.write(raw + "\r\n");
    upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});

server.listen(PORT, "127.0.0.1", () =>
  console.log(`nginx stand-in on https://localhost:${PORT}`),
);
