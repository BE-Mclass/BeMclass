import { createPublicKey, JsonWebKeyInput } from "crypto";
import jwt from "jsonwebtoken";
import { AppError } from "./errors";

export interface VerifiedGoogleTokenPayload {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture: string | null;
}

type GoogleJwk = JsonWebKeyInput["key"] & { kid?: string; alg?: string };

interface GoogleCertsResponse {
  keys?: GoogleJwk[];
}

let cachedKeys: GoogleJwk[] = [];
let cacheExpiresAt = 0;

const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";
const ALLOWED_ISSUERS = new Set([
  "accounts.google.com",
  "https://accounts.google.com",
]);

function getAllowedClientIds(): string[] {
  const raw = process.env.GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_IDS ?? "";
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

async function getGoogleJwks(): Promise<GoogleJwk[]> {
  if (cachedKeys.length > 0 && Date.now() < cacheExpiresAt) {
    return cachedKeys;
  }

  const response = await fetch(GOOGLE_JWKS_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch Google JWKS: HTTP ${response.status}`);
  }

  const cacheControl = response.headers.get("cache-control") ?? "";
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSeconds = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;

  const data = (await response.json()) as GoogleCertsResponse;
  if (!Array.isArray(data.keys) || data.keys.length === 0) {
    throw new Error("Invalid Google JWKS payload");
  }

  cachedKeys = data.keys;
  cacheExpiresAt = Date.now() + maxAgeSeconds * 1000;
  return cachedKeys;
}

/**
 * Verifikasi Google OIDC id_token dari aplikasi mobile (Flutter)
 * sesuai BR-09B & TRD TD-18.
 */
export async function verifyGoogleIdToken(
  idToken: string
): Promise<VerifiedGoogleTokenPayload> {
  const trimmedToken = idToken.trim();
  if (!trimmedToken) {
    throw new AppError("Token Google (id_token) wajib disertakan.", 400, {
      code: "VALIDATION_ERROR",
      errors: { id_token: "Token Google wajib diisi." },
    });
  }

  const allowedClientIds = getAllowedClientIds();

  try {
    const decodedComplete = jwt.decode(trimmedToken, { complete: true });
    if (
      !decodedComplete ||
      typeof decodedComplete !== "object" ||
      !decodedComplete.header
    ) {
      throw new Error("Malformed JWT");
    }

    const kid = decodedComplete.header.kid;
    let verifiedClaims: Record<string, unknown> | null = null;

    if (kid) {
      const keys = await getGoogleJwks();
      const matchingJwk = keys.find((k) => k.kid === kid);
      if (matchingJwk) {
        const publicKey = createPublicKey({
          key: matchingJwk,
          format: "jwk",
        });

        const verifyOptions: jwt.VerifyOptions = {
          algorithms: ["RS256"],
          issuer: [
            "accounts.google.com",
            "https://accounts.google.com",
          ],
        };

        if (allowedClientIds.length > 0) {
          verifyOptions.audience =
            allowedClientIds.length === 1
              ? allowedClientIds[0]
              : (allowedClientIds as [string, ...string[]]);
        }

        verifiedClaims = jwt.verify(
          trimmedToken,
          publicKey,
          verifyOptions
        ) as Record<string, unknown>;
      }
    }

    // Fallback ke endpoint tokeninfo resmi Google jika kid tidak ditemukan di JWKS cache
    if (!verifiedClaims) {
      const url = `${GOOGLE_TOKENINFO_URL}?id_token=${encodeURIComponent(
        trimmedToken
      )}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error("Token rejected by Google tokeninfo");
      }
      verifiedClaims = (await res.json()) as Record<string, unknown>;

      const iss = String(verifiedClaims.iss ?? "");
      if (!ALLOWED_ISSUERS.has(iss)) {
        throw new Error("Invalid token issuer");
      }

      const exp = Number(verifiedClaims.exp ?? 0);
      if (!exp || exp * 1000 < Date.now()) {
        throw new Error("Token expired");
      }

      if (allowedClientIds.length > 0) {
        const aud = String(verifiedClaims.aud ?? "");
        const azp = String(verifiedClaims.azp ?? "");
        if (!allowedClientIds.includes(aud) && !allowedClientIds.includes(azp)) {
          throw new Error("Token audience mismatch");
        }
      }
    }

    const sub = typeof verifiedClaims.sub === "string" ? verifiedClaims.sub.trim() : "";
    const email =
      typeof verifiedClaims.email === "string"
        ? verifiedClaims.email.trim().toLowerCase()
        : "";
    const emailVerified =
      verifiedClaims.email_verified === true ||
      verifiedClaims.email_verified === "true";
    const name =
      typeof verifiedClaims.name === "string" && verifiedClaims.name.trim()
        ? verifiedClaims.name.trim()
        : email.split("@")[0] ?? "Siswa";
    const picture =
      typeof verifiedClaims.picture === "string" && verifiedClaims.picture.trim()
        ? verifiedClaims.picture.trim()
        : null;

    if (!sub || !email) {
      throw new Error("Missing sub or email claim");
    }

    if (!emailVerified) {
      throw new AppError(
        "Email pada akun Google Anda belum terverifikasi.",
        401,
        { code: "INVALID_OAUTH_TOKEN" }
      );
    }

    return {
      sub,
      email,
      emailVerified,
      name,
      picture,
    };
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(
      "Token Google OAuth tidak valid atau telah kedaluwarsa.",
      401,
      { code: "INVALID_OAUTH_TOKEN" }
    );
  }
}
