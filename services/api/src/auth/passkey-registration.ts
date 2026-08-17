import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull, sql as drizzleSql } from "drizzle-orm";
import type { PasskeyRegistrationInput } from "@vulto/schema";
import { db } from "../db.js";
import { env } from "../env.js";
import { passkeyRegistrationContext, rateLimit, user } from "./schema.js";

const CONTEXT_TTL_MS = 5 * 60 * 1_000;
const RATE_LIMIT_WINDOW_MS = 60 * 1_000;
const RATE_LIMIT_MAX = 3;

export class PasskeyRegistrationUnavailableError extends Error {
  constructor() {
    super("Passkey registration could not be started");
  }
}

export class PasskeyRegistrationRateLimitError extends Error {
  constructor() {
    super("Too many passkey registration attempts");
  }
}

function mac(value: string): Buffer {
  return createHmac("sha256", env.BETTER_AUTH_SECRET).update(value).digest();
}

function signContextId(contextId: string): string {
  return `${contextId}.${mac(contextId).toString("base64url")}`;
}

function readContextId(token: string | null | undefined): string {
  if (!token) throw new PasskeyRegistrationUnavailableError();
  const [contextId, encodedMac, remainder] = token.split(".");
  if (!contextId || !encodedMac || remainder) {
    throw new PasskeyRegistrationUnavailableError();
  }

  const provided = Buffer.from(encodedMac, "base64url");
  const expected = mac(contextId);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new PasskeyRegistrationUnavailableError();
  }

  return contextId;
}

function rateLimitKey(clientAddress: string): string {
  return `passkey-registration:${createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(clientAddress)
    .digest("hex")}`;
}

export async function enforcePasskeyRegistrationRateLimit(
  clientAddress: string,
): Promise<void> {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const key = rateLimitKey(clientAddress);

  const [row] = await db
    .insert(rateLimit)
    .values({ key, count: 1, lastRequest: now })
    .onConflictDoUpdate({
      target: rateLimit.key,
      set: {
        count: drizzleSql<number>`case when ${rateLimit.lastRequest} < ${windowStart} then 1 else ${rateLimit.count} + 1 end`,
        lastRequest: drizzleSql<number>`case when ${rateLimit.lastRequest} < ${windowStart} then ${now} else ${rateLimit.lastRequest} end`,
      },
    })
    .returning({ count: rateLimit.count });

  if (!row || row.count > RATE_LIMIT_MAX) {
    throw new PasskeyRegistrationRateLimitError();
  }
}

export async function issuePasskeyRegistrationContext(
  input: PasskeyRegistrationInput,
): Promise<{ context: string; expiresAt: string }> {
  const existing = await db.query.user.findFirst({
    columns: { id: true },
    where: eq(user.email, input.email),
  });
  if (existing) throw new PasskeyRegistrationUnavailableError();

  const id = randomUUID();
  const userId = randomUUID();
  const expiresAt = new Date(Date.now() + CONTEXT_TTL_MS);

  await db.insert(passkeyRegistrationContext).values({
    id,
    userId,
    name: input.name,
    email: input.email,
    expiresAt,
  });

  return { context: signContextId(id), expiresAt: expiresAt.toISOString() };
}

export async function resolvePasskeyRegistrationUser(
  token: string | null | undefined,
): Promise<{ id: string; name: string; displayName: string }> {
  const id = readContextId(token);
  const context = await db.query.passkeyRegistrationContext.findFirst({
    where: and(
      eq(passkeyRegistrationContext.id, id),
      isNull(passkeyRegistrationContext.consumedAt),
      gt(passkeyRegistrationContext.expiresAt, new Date()),
    ),
  });
  if (!context) throw new PasskeyRegistrationUnavailableError();

  return {
    id: context.userId,
    name: context.email,
    displayName: context.name,
  };
}

export async function consumePasskeyRegistrationContext(
  token: string | null | undefined,
): Promise<string> {
  const id = readContextId(token);

  return db.transaction(async (transaction) => {
    const [context] = await transaction
      .update(passkeyRegistrationContext)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(passkeyRegistrationContext.id, id),
          isNull(passkeyRegistrationContext.consumedAt),
          gt(passkeyRegistrationContext.expiresAt, new Date()),
        ),
      )
      .returning();
    if (!context) throw new PasskeyRegistrationUnavailableError();

    await transaction.insert(user).values({
      id: context.userId,
      name: context.name,
      email: context.email,
      emailVerified: false,
      status: "active",
    });

    return context.userId;
  });
}
