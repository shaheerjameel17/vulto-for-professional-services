import { AuthForm } from "../../components/auth/AuthForm";
import { AuthFrame } from "../../components/auth/AuthFrame";

export default function SignInPage() {
  return (
    <AuthFrame
      title="Welcome back"
      description="Sign in to reopen your Vulto workspace."
      alternate={{
        label: "New to Vulto?",
        href: "/sign-up",
        action: "Create an account",
      }}
    >
      <AuthForm mode="sign-in" />
    </AuthFrame>
  );
}
