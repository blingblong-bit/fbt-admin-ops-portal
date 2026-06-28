import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";
import { createHash, timingSafeEqual } from "node:crypto";

type GateSession = { unlocked?: boolean };

function getSessionConfig() {
  const password = process.env.SITE_SESSION_SECRET;
  if (!password) throw new Error("SITE_SESSION_SECRET is not set");
  return {
    password,
    name: "fbt-admin-gate",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "lax" as const,
      path: "/",
    },
  };
}

function safeEqual(input: string, expected: string): boolean {
  const a = createHash("sha256").update(input, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

export const checkUnlocked = createServerFn({ method: "GET" }).handler(async () => {
  const session = await useSession<GateSession>(getSessionConfig());
  return { unlocked: !!session.data.unlocked };
});

export const unlockSite = createServerFn({ method: "POST" })
  .inputValidator((data: { username: string; password: string }) => data)
  .handler(async ({ data }) => {
    const expectedUser = process.env.SITE_USERNAME;
    const expectedPass = process.env.SITE_PASSWORD;
    if (!expectedUser || !expectedPass) {
      throw new Error("Site credentials are not configured");
    }
    const userOk = safeEqual(data.username, expectedUser);
    const passOk = safeEqual(data.password, expectedPass);
    if (!userOk || !passOk) {
      return { ok: false as const };
    }
    const session = await useSession<GateSession>(getSessionConfig());
    await session.update({ unlocked: true });
    return { ok: true as const };
  });

export const lockSite = createServerFn({ method: "POST" }).handler(async () => {
  const session = await useSession<GateSession>(getSessionConfig());
  await session.clear();
  return { ok: true as const };
});
