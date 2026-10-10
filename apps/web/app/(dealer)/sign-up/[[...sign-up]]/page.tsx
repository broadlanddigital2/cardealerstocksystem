import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <SignUp signInUrl="/sign-in" />
    </div>
  );
}
