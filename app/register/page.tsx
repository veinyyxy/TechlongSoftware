import type { Metadata } from "next";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { AuthCard } from "@/components/auth/AuthCard";

export const metadata: Metadata = { title: "注册" };
export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const user = await getChatGPTUser();
  return <AuthCard mode="register" user={user} />;
}
