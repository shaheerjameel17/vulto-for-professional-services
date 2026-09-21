import { passkey } from "@better-auth/passkey";
import { WORKSPACE_ROLES } from "@vulto/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { organization } from "better-auth/plugins/organization";
import { defaultAc } from "better-auth/plugins/organization/access";
import { db } from "../db.js";
import { env } from "../env.js";
import { eq } from "drizzle-orm";
import {
  consumePasskeyRegistrationContext,
  resolvePasskeyRegistrationUser,
} from "./passkey-registration.js";
import * as schema from "./schema.js";

export const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;
export const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24;

const noOrganizationMutations = defaultAc.newRole({
  organization: [],
  member: [],
  invitation: [],
  team: [],
  ac: [],
});

const organizationRoles = Object.fromEntries(
  WORKSPACE_ROLES.map((role) => [role, noOrganizationMutations]),
);

const socialProviders =
  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          scope: ["openid", "email", "profile"],
        },
      }
    : {};

export const auth = betterAuth({
  appName: "Vulto",
  logger: { level: "error" },
  baseURL: env.API_ORIGIN,
  basePath: "/api/auth",
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    customSyntheticUser({ coreFields, additionalFields, id }) {
      return { ...coreFields, ...additionalFields, id, status: "active" };
    },
  },
  socialProviders,
  account: {
    accountLinking: {
      enabled: true,
      disableImplicitLinking: true,
      trustedProviders: ["google"],
      allowDifferentEmails: false,
      allowUnlinkingAll: false,
    },
  },
  user: {
    additionalFields: {
      status: {
        type: "string",
        required: true,
        defaultValue: "active",
        input: false,
      },
    },
  },
  session: {
    expiresIn: SESSION_EXPIRES_IN_SECONDS,
    updateAge: SESSION_UPDATE_AGE_SECONDS,
    cookieCache: { enabled: false },
  },
  trustedOrigins: [...env.AUTH_TRUSTED_ORIGINS],
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60, max: 3 },
      "/passkey/generate-authenticate-options": { window: 60, max: 10 },
      "/passkey/verify-authentication": { window: 60, max: 10 },
      "/passkey/generate-register-options": { window: 60, max: 5 },
      "/passkey/verify-registration": { window: 60, max: 5 },
    },
  },
  databaseHooks: {
    session: {
      create: {
        async before(nextSession) {
          const activeUser = await db.query.user.findFirst({
            columns: { id: true },
            where: (candidate, operators) =>
              operators.and(
                eq(candidate.id, nextSession.userId),
                eq(candidate.status, "active"),
              ),
          });
          if (!activeUser) {
            throw APIError.from("UNAUTHORIZED", {
              code: "AUTHENTICATION_UNAVAILABLE",
              message: "Authentication could not be completed",
            });
          }
        },
      },
    },
  },
  advanced: {
    ipAddress: { ipAddressHeaders: ["x-vulto-client-ip"] },
    useSecureCookies: env.API_ORIGIN.startsWith("https://"),
    disableCSRFCheck: false,
    disableOriginCheck: false,
    crossSubDomainCookies: { enabled: false },
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      secure: env.API_ORIGIN.startsWith("https://"),
      path: "/",
    },
    database: { generateId: "uuid" },
  },
  plugins: [
    organization({
      allowUserToCreateOrganization: false,
      creatorRole: "owner",
      roles: organizationRoles,
      schema: {
        organization: {
          additionalFields: {
            status: {
              type: "string",
              required: true,
              defaultValue: "active",
              input: false,
            },
          },
        },
        member: {
          additionalFields: {
            status: {
              type: "string",
              required: true,
              defaultValue: "pending",
              input: false,
            },
            projectionState: {
              type: "string",
              required: true,
              defaultValue: "pending",
              input: false,
            },
          },
        },
      },
    }),
    passkey({
      rpID: env.PASSKEY_RP_ID,
      rpName: "Vulto",
      origin: [...env.AUTH_TRUSTED_ORIGINS],
      registration: {
        requireSession: false,
        async resolveUser({ context }) {
          try {
            return await resolvePasskeyRegistrationUser(context);
          } catch {
            throw APIError.from("BAD_REQUEST", {
              code: "PASSKEY_REGISTRATION_UNAVAILABLE",
              message: "Passkey registration could not be completed",
            });
          }
        },
        async afterVerification({ context }) {
          try {
            return {
              userId: await consumePasskeyRegistrationContext(context),
            };
          } catch {
            throw APIError.from("BAD_REQUEST", {
              code: "PASSKEY_REGISTRATION_UNAVAILABLE",
              message: "Passkey registration could not be completed",
            });
          }
        },
      },
    }),
  ],
});
