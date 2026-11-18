export const SANDBOX_REGISTRATION_WORKSPACE = "Sandbox 首开验收";
export const SANDBOX_REGISTER_ACCOUNT =
  "SELECT sandbox_registration.register_account(?, ?, ?, ?) AS user_id";

export function usesSandboxRegistration(bindings: Record<string, unknown>): boolean {
  return bindings.TECHLONG_PLATFORM_INGRESS === "alb-https-v1" &&
    bindings.TECHLONG_PLATFORM_PUBLIC_ORIGIN === "https://console.sandbox.techlong.cloud";
}
