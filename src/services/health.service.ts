import { database } from "../config/database";

export interface HealthCheckResult {
  success: boolean;
  status: "ok" | "degraded";
  db: "up" | "down";
  ai: "up" | "down";
  time: string;
  message: string;
}

/**
 * Mengecek konektivitas MySQL (`db: "up" | "down"`).
 */
export async function checkDatabaseHealth(): Promise<"up" | "down"> {
  try {
    await database.execute("SELECT 1");
    return "up";
  } catch {
    return "down";
  }
}

/**
 * Mengecek konektivitas layanan internal Flask AI (`ai: "up" | "down"` — FSD §5.11, TRD §7.2).
 */
export async function checkAiServiceHealth(): Promise<"up" | "down"> {
  const aiBaseUrl = (process.env.AI_BASE_URL || "http://127.0.0.1:5000").replace(
    /\/+$/,
    ""
  );
  const internalToken = process.env.AI_INTERNAL_TOKEN || "";
  const timeoutMs = Number(process.env.AI_HEALTH_TIMEOUT_MS ?? 1500);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {};
    if (internalToken) {
      headers["X-Internal-Token"] = internalToken;
    }

    const res = await fetch(`${aiBaseUrl}/health`, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    if (!res.ok) {
      return "down";
    }

    const body = (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (body && body.status && String(body.status).toLowerCase() !== "ok") {
      return "down";
    }
    return "up";
  } catch {
    return "down";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET /api/health (FSD §5.11, TRD §11, 05_DESIGN_SYSTEM §10)
 * Mengembalikan status kesehatan server, database MySQL, dan layanan Flask AI.
 */
export async function getSystemHealth(): Promise<HealthCheckResult> {
  const [db, ai] = await Promise.all([
    checkDatabaseHealth(),
    checkAiServiceHealth(),
  ]);

  const status = db === "up" ? "ok" : "degraded";

  return {
    success: status === "ok",
    status,
    db,
    ai,
    time: new Date().toISOString(),
    message: "M-Class Backend API is running.",
  };
}
