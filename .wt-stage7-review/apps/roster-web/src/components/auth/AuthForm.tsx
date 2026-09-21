"use client";

import { Button, InlineAlert, Input, Text } from "@vulto/ui";
import { KeyRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { apiOrigin, authClient } from "../../lib/auth-client";

type Mode = "sign-in" | "sign-up";

const GENERIC_ERROR = "Vulto could not verify those details. Check them and try again.";

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState<"password" | "passkey" | "google">();

  function finish() {
    router.push("/auth-ready");
    router.refresh();
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setPending("password");

    try {
      if (mode === "sign-up") {
        const created = await authClient.signUp.email({ name, email, password });
        if (created.error) throw new Error(created.error.message);
      }

      const signedIn = await authClient.signIn.email({ email, password });
      if (signedIn.error) throw new Error(signedIn.error.message);
      finish();
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setPending(undefined);
    }
  }

  async function usePasskey() {
    setError(undefined);
    setPending("passkey");

    try {
      if (mode === "sign-up") {
        const response = await fetch(
          `${apiOrigin}/api/auth/passkey/registration-context`,
          {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name, email }),
          },
        );
        if (!response.ok) throw new Error("context unavailable");
        const context = (await response.json()) as { context?: string };
        if (!context.context) throw new Error("context unavailable");

        const registered = await authClient.passkey.addPasskey({
          context: context.context,
          name: "Primary passkey",
        });
        if (registered.error) throw new Error(registered.error.message);
      }

      const signedIn = await authClient.signIn.passkey();
      if (signedIn.error) throw new Error(signedIn.error.message);
      finish();
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setPending(undefined);
    }
  }

  async function useGoogle() {
    setError(undefined);
    setPending("google");
    const result = await authClient.signIn.social({
      provider: "google",
      callbackURL: `${window.location.origin}/auth-ready`,
    });
    if (result?.error) {
      setError(GENERIC_ERROR);
      setPending(undefined);
    }
  }

  const passkeyDisabled =
    pending !== undefined || (mode === "sign-up" && (!name.trim() || !email.trim()));

  return (
    <div className="flex flex-col gap-4">
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      <form className="flex flex-col gap-3" onSubmit={submitPassword}>
        {mode === "sign-up" ? (
          <Input
            label="Name"
            name="name"
            autoComplete="name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        ) : null}
        <Input
          label="Work email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Input
          label="Password"
          name="password"
          type="password"
          autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
          minLength={12}
          maxLength={128}
          required
          helperText={mode === "sign-up" ? "Use at least 12 characters." : undefined}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={pending === "password"}
          disabled={pending !== undefined}
        >
          {mode === "sign-up" ? "Create account" : "Sign in"}
        </Button>
      </form>

      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-border-default" />
        <Text variant="micro" className="text-text-tertiary">
          Or
        </Text>
        <span className="h-px flex-1 bg-border-default" />
      </div>

      <div className="flex flex-col gap-2">
        <Button
          size="lg"
          icon={KeyRound}
          loading={pending === "passkey"}
          disabled={passkeyDisabled}
          onClick={usePasskey}
        >
          {mode === "sign-up" ? "Create account with passkey" : "Use passkey"}
        </Button>
        <Button
          size="lg"
          loading={pending === "google"}
          disabled={pending !== undefined}
          onClick={useGoogle}
        >
          Continue with Google
        </Button>
      </div>

      {mode === "sign-in" ? (
        <Text variant="small" className="text-center text-text-secondary">
          Account recovery is tracked separately. Contact your workspace administrator
          if you cannot sign in.
        </Text>
      ) : (
        <Text variant="small" className="text-center text-text-secondary">
          Invitations and email verification arrive with workspace onboarding.
        </Text>
      )}

      <Link href="/" className="sr-only">
        Return to prototype
      </Link>
    </div>
  );
}
