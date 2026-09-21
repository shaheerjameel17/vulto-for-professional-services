import { fileURLToPath } from "node:url";

/**
 * Runtime configuration for the API, resolved once and loudly.
 *
 * # Why this file exists rather than `process.env.X ?? "some default"`
 *
 * It replaces a default that was silently wrong. `db.ts` previously read:
 *
 *     process.env.DATABASE_URL ?? "postgres://vulto:vulto@localhost:5432/vulto"
 *
 * On a laptop that default is **correct** — compose port-maps Postgres to the
 * host, and the API runs on the host, so `localhost:5432` is the database. In a
 * Codespace it is **wrong**: the API runs inside the workspace container, where
 * `localhost` is the workspace container itself and Postgres is the sibling
 * host `postgres`. The connection was refused at 127.0.0.1:5432.
 *
 * The default did not cause that failure. It caused it to be *invisible* until
 * an environment came along where the guess was wrong — the configuration was
 * never reaching the process on the laptop either, and nobody could tell.
 *
 * **A default that happens to be right in one environment is not a default. It
 * is an undetected failure with a local alibi.** Same shape as F74: a fallback
 * that turned a real problem into a plausible-looking wrong answer.
 *
 * # Precedence, and why this order
 *
 *   1. The real environment — what the container or shell already set.
 *   2. `.env` at the repository root, for local development.
 *   3. Nothing. Fail, with the variable named.
 *
 * `process.loadEnvFile` fills gaps and never overwrites, verified rather than
 * assumed. That ordering matters: a `.env` copied from `.env.example` says
 * `localhost`, and if it overrode the container's value it would reintroduce
 * exactly the bug this file exists to remove.
 */

/** Repository root, three levels up from `services/api/src/`. */
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

try {
  process.loadEnvFile(`${repoRoot}.env`);
} catch {
  /*
   * No .env is the normal case in a container, which sets real environment
   * variables instead. Only a missing file is tolerated here — a malformed one
   * would also land here, which is acceptable because anything it was meant to
   * provide will be caught by `required` below, naming the variable.
   */
}

function required(name: string): string {
  const value = process.env[name];
  if (value && value.length > 0) return value;

  throw new Error(
    `${name} is not set.\n\n` +
      `  In a container it comes from the compose environment.\n` +
      `  Locally, copy .env.example to .env at the repository root.\n\n` +
      `  Refusing to guess: the previous default was "localhost", which is ` +
      `correct on a laptop and wrong inside a container, and guessing wrong ` +
      `reports as a database that will not connect.`,
  );
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

function optionalValue(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function commaSeparated(name: string, fallback: string): readonly string[] {
  return optional(name, fallback)
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

const googleClientId = optionalValue("GOOGLE_CLIENT_ID");
const googleClientSecret = optionalValue("GOOGLE_CLIENT_SECRET");

if (
  (googleClientId && !googleClientSecret) ||
  (!googleClientId && googleClientSecret)
) {
  throw new Error(
    "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must either both be set or both be absent",
  );
}

if (process.env.NODE_ENV === "production" && (!googleClientId || !googleClientSecret)) {
  throw new Error(
    "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required in production because Google sign-in is MVP scope",
  );
}

const webOrigin = optional("WEB_ORIGIN", "http://localhost:3100");
const apiOrigin = optional("API_ORIGIN", "http://localhost:3101");
const tlsCertPath = optionalValue("API_TLS_CERT_PATH");
const tlsKeyPath = optionalValue("API_TLS_KEY_PATH");

if ((tlsCertPath && !tlsKeyPath) || (!tlsCertPath && tlsKeyPath)) {
  throw new Error(
    "API_TLS_CERT_PATH and API_TLS_KEY_PATH must either both be set or both be absent",
  );
}

export const env = {
  /** No default. See `required`. */
  DATABASE_URL: required("DATABASE_URL"),

  /*
   * These carry defaults deliberately: each is a local binding or a display
   * concern, wrong in a way that is immediately visible rather than a wrong
   * answer that looks like a right one.
   */
  API_PORT: Number(optional("API_PORT", "3101")),
  API_HOST: optional("API_HOST", "127.0.0.1"),
  WEB_ORIGIN: webOrigin,
  API_ORIGIN: apiOrigin,
  AUTH_TRUSTED_ORIGINS: commaSeparated("AUTH_TRUSTED_ORIGINS", webOrigin),
  BETTER_AUTH_SECRET: required("BETTER_AUTH_SECRET"),
  GOOGLE_CLIENT_ID: googleClientId,
  GOOGLE_CLIENT_SECRET: googleClientSecret,
  PASSKEY_RP_ID: optional("PASSKEY_RP_ID", new URL(webOrigin).hostname),
  API_TLS_CERT_PATH: tlsCertPath,
  API_TLS_KEY_PATH: tlsKeyPath,
  LOG_LEVEL: optional("LOG_LEVEL", "info"),
} as const;
