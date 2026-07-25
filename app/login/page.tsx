import type { Metadata } from "next";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { AuthCard } from "@/components/auth/AuthCard";

export const metadata: Metadata = { title: "登录" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getChatGPTUser();
  return <AuthCard mode="login" user={user} />;
}
