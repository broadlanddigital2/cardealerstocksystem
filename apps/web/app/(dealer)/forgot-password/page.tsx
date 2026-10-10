import { redirect } from "next/navigation";

// Sign-in is by emailed 6-digit code; old password links land on sign-in.
export default function Page() {
  redirect("/sign-in");
}
