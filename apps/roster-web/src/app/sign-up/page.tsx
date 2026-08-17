import { AuthForm } from "../../components/auth/AuthForm";
import { AuthFrame } from "../../components/auth/AuthFrame";

export default function SignUpPage() {
  return (
    <AuthFrame
      title="Create your account"
      description="Start with a passkey, Google, or a strong password."
      alternate={{
        label: "Already have an account?",
        href: "/sign-in",
        action: "Sign in",
      }}
    >
      <AuthForm mode="sign-up" />
    </AuthFrame>
  );
}
