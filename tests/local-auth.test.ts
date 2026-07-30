import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  isOpaqueToken,
  validatePassword,
  verifyPassword,
} from "../lib/auth/security.ts";
import {
  safeReturnTo,
  validateLoginInput,
  validateRegistrationInput,
} from "../lib/auth/validation.ts";

test("password hashing uses a unique salt and rejects the wrong password", async () => {
  const first = await hashPassword("long-enough-password", 1_000);
  const second = await hashPassword("long-enough-password", 1_000);

  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.hash, second.hash);
  assert.equal(
    await verifyPassword("long-enough-password", first),
    true,
  );
  assert.equal(await verifyPassword("wrong-password", first), false);
  assert.equal(validatePassword("short"), "密码至少需要 12 个字符。");
});

test("opaque authentication tokens are random and stored by digest", async () => {
  const first = createOpaqueToken();
  const second = createOpaqueToken();
  assert.equal(isOpaqueToken(first), true);
  assert.notEqual(first, second);
  assert.notEqual(await hashOpaqueToken(first), first);
  assert.equal(
    await hashOpaqueToken(first),
    await hashOpaqueToken(first),
  );
});

test("authentication validation prevents open redirects and weak registration", () => {
  assert.equal(safeReturnTo("https://evil.example/steal"), "/dashboard");
  assert.equal(safeReturnTo("//evil.example/steal"), "/dashboard");
  assert.equal(safeReturnTo("/admin?tab=users"), "/admin?tab=users");

  const invalid = validateRegistrationInput({
    email: "not-an-email",
    name: "A",
    workspaceName: "",
    password: "short",
    passwordConfirmation: "different",
  });
  assert.equal(invalid.data, null);
  assert.ok(invalid.errors.email);
  assert.ok(invalid.errors.password);

  const login = validateLoginInput({
    email: "  OWNER@EXAMPLE.COM ",
    password: "a-password",
    returnTo: "/admin",
  });
  assert.equal(login.errors, null);
  assert.equal(login.data?.email, "owner@example.com");
  assert.equal(login.data?.returnTo, "/admin");
});

test("local-auth migration and routes keep secrets server-side", async () => {
  const root = new URL("../", import.meta.url);
  const [migration, session, loginRoute, registrationRoute] = await Promise.all([
    readFile(
      new URL("db/postgres-migrations/0001_local_auth.sql", root),
      "utf8",
    ),
    readFile(new URL("lib/auth/session.ts", root), "utf8"),
    readFile(new URL("app/api/auth/login/route.ts", root), "utf8"),
    readFile(new URL("app/api/auth/register/route.ts", root), "utf8"),
  ]);

  assert.match(migration, /CREATE TABLE IF NOT EXISTS user_credentials/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS auth_sessions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS auth_invitations/);
  assert.match(session, /HttpOnly/);
  assert.match(session, /SameSite=Lax/);
  assert.match(session, /Secure/);
  assert.match(loginRoute, /loginWithPassword/);
  assert.match(registrationRoute, /acceptInvitation/);
  assert.doesNotMatch(
    `${loginRoute}\n${registrationRoute}`,
    /NEXT_PUBLIC_.*PASSWORD|NEXT_PUBLIC_.*SECRET/,
  );
});
