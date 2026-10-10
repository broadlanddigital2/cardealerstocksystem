import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <SignIn signUpUrl="/sign-up" />
    </div>
  );
}
