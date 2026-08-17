import { AuthFrame } from "../../components/auth/AuthFrame";
import { AuthReadyClient } from "./auth-ready-client";

export default function AuthReadyPage() {
  return (
    <AuthFrame
      title="Account ready"
      description="Authentication succeeded. Workspace onboarding is a separate step."
    >
      <AuthReadyClient />
    </AuthFrame>
  );
}
