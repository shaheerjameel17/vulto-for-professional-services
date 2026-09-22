import type { ReactNode } from "react";
import { Shell } from "../../components/Shell";
import { ShellBootstrapProvider } from "../../components/shell-bootstrap";

export default function ShellLayout({ children }: { children: ReactNode }) {
  return (
    <ShellBootstrapProvider>
      <Shell>{children}</Shell>
    </ShellBootstrapProvider>
  );
}
