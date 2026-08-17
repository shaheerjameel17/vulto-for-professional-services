import { Card, Text } from "@vulto/ui";
import Link from "next/link";
import type { ReactNode } from "react";

export function AuthFrame({
  title,
  description,
  alternate,
  children,
}: {
  title: string;
  description: string;
  alternate?: { label: string; href: string; action: string };
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg-subtle px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <Text variant="micro" className="text-brand-700">
            Vulto Roster
          </Text>
          <Text variant="h1" className="mt-2 text-text-primary">
            {title}
          </Text>
          <Text variant="body" className="mt-2 text-text-secondary">
            {description}
          </Text>
        </div>
        <Card>{children}</Card>
        {alternate ? (
          <Text variant="small" className="mt-4 text-center text-text-secondary">
            {alternate.label}{" "}
            <Link
              href={alternate.href}
              className="text-brand-700 underline-offset-4 hover:underline"
            >
              {alternate.action}
            </Link>
          </Text>
        ) : null}
      </div>
    </main>
  );
}
