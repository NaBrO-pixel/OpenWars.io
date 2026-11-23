// Session tokens. The game's client and server check them with the public
// key published at /.well-known/jwks.json (EdDSA, as ServerEnv expects).
import { base64urlToUuid, uuidToBase64url } from "@openfront/shared/Base64";
import {
  exportJWK,
  generateKeyPair,
  importJWK,
  type JWK,
  jwtVerify,
  SignJWT,
} from "jose";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// How long a session token lasts. The client refreshes it (POST
// /auth/refresh) a few minutes before it runs out.
export const JWT_LIFETIME_SECONDS = 60 * 60;
// How long a sign-in lasts without being used.
export const SESSION_LIFETIME_MS = 180 * 24 * 60 * 60 * 1000;

type SigningKey = Awaited<ReturnType<typeof importJWK>>;

export class Tokens {
  private constructor(
    private readonly privateKey: SigningKey,
    private readonly publicKey: SigningKey,
    readonly publicJwk: JWK,
    private readonly issuer: string,
    private readonly audience: string,
  ) {}

  // Loads the signing key from dataDir, creating it on first start. Keep the
  // file: losing it signs everyone out (nothing else is lost).
  static async load(
    dataDir: string | null,
    issuer: string,
    audience: string,
  ): Promise<Tokens> {
    const file = dataDir === null ? null : path.join(dataDir, "jwt-key.json");
    let pair: { privateJwk: JWK; publicJwk: JWK };
    if (file !== null && fs.existsSync(file)) {
      pair = JSON.parse(fs.readFileSync(file, "utf8"));
    } else {
      const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
        crv: "Ed25519",
        extractable: true,
      });
      const kid = randomUUID();
      pair = {
        privateJwk: { ...(await exportJWK(privateKey)), kid, alg: "EdDSA" },
        publicJwk: { ...(await exportJWK(publicKey)), kid, alg: "EdDSA" },
      };
      if (file !== null) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(pair), { mode: 0o600 });
      }
    }
    return new Tokens(
      await importJWK(pair.privateJwk, "EdDSA"),
      await importJWK(pair.publicJwk, "EdDSA"),
      { ...pair.publicJwk, use: "sig" },
      issuer,
      audience,
    );
  }

  async sign(userId: string, provider: string | undefined): Promise<string> {
    const jwt = new SignJWT(provider === undefined ? {} : { provider })
      .setProtectedHeader({ alg: "EdDSA", kid: this.publicJwk.kid })
      .setJti(randomUUID())
      .setSubject(uuidToBase64url(userId))
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setIssuedAt()
      .setExpirationTime(`${JWT_LIFETIME_SECONDS}s`);
    return jwt.sign(this.privateKey);
  }

  // The user id (UUID) a valid token was issued to, or null.
  async verify(token: string): Promise<string | null> {
    try {
      const { payload } = await jwtVerify(token, this.publicKey, {
        algorithms: ["EdDSA"],
        issuer: this.issuer,
        audience: this.audience,
      });
      if (typeof payload.sub !== "string") return null;
      return base64urlToUuid(payload.sub);
    } catch {
      return null;
    }
  }
}

// A new refresh-cookie value, and the hash the database keeps of it (a leaked
// database copy then cannot be used to sign in).
export function newSessionToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashSessionToken(token) };
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}
