"use server";

import { cookies } from "next/headers";

export type LoginState = {
  ok: boolean;
  message: string;
  user?: string;
};

export async function loginAction(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();

  if (!email || !password) {
    return { ok: false, message: "Missing email or password." };
  }

  if (password !== "demo") {
    return { ok: false, message: "Invalid password. Try: demo" };
  }

  const user = email.split("@")[0] || "agent";
  const cookieStore = await cookies();
  cookieStore.set("abl_session", user, {
    path: "/",
    sameSite: "lax",
    httpOnly: false,
  });

  return { ok: true, message: `Welcome ${user}.`, user };
}
