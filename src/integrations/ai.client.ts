import { createHash } from "crypto";
import { AppError } from "../utils/errors";

export type FaceRejectionReason =
  | "NO_FACE"
  | "MULTIPLE_FACES"
  | "LOW_QUALITY";

export type AiEmbedSampleResult =
  | {
      accepted: true;
      embedding: number[];
      dim: number;
      qualityScore: number;
      modelName: string;
      modelVersion: string;
    }
  | {
      accepted: false;
      reason: FaceRejectionReason;
      details?: string[];
    };

export interface AiVerifyResult {
  count: number;
  qualityPassed: boolean;
  qualityScore: number | null;
  qualityReasons: string[];
  similarities: number[];
  similarityMax: number | null;
  modelName: string;
  modelVersion: string;
}

export type FaceResultCode =
  | "match"
  | "no_match"
  | "no_face"
  | "multiple_faces"
  | "low_quality"
  | "error";

export interface AiVerifySampleResult {
  faceResult: FaceResultCode;
  similarityMax: number | null;
  modelName: string | null;
  modelVersion: string | null;
}

type MockEmbedHandler = (
  imageBuffer: Buffer,
  index: number
) => Promise<AiEmbedSampleResult>;

type MockVerifyHandler = (params: {
  imageBuffer: Buffer;
  references: number[][];
}) => Promise<AiVerifySampleResult>;

let customMockEmbedHandler: MockEmbedHandler | null = null;
let customMockVerifyHandler: MockVerifyHandler | null = null;

export function setAiEmbedHandlerForTesting(
  handler: MockEmbedHandler | null
): void {
  customMockEmbedHandler = handler;
}

export function setAiVerifyHandlerForTesting(
  handler: MockVerifyHandler | null
): void {
  customMockVerifyHandler = handler;
}

export function getFaceMatchThreshold(): number {
  const parsed = Number(process.env.FACE_MATCH_THRESHOLD ?? 0.6);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : 0.6;
}

export function computeCosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) {
    return 0;
  }
  return Number((dot / denom).toFixed(5));
}

function getAiBaseUrl(): string {
  return (process.env.AI_BASE_URL || "http://127.0.0.1:5000").replace(/\/+$/, "");
}

function getAiInternalToken(): string {
  return process.env.AI_INTERNAL_TOKEN || "dev-internal-token";
}

function getAiTimeoutMs(): number {
  const parsed = Number(process.env.AI_TIMEOUT_MS ?? 5000);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 5000;
}

/**
 * Menghasilkan vektor embedding deterministik 128-dimensi (L2-normalized) untuk mode dev/mock.
 */
export function buildDeterministicDevEmbedding(
  imageBuffer: Buffer,
  dim = 128
): number[] {
  const vector: number[] = [];
  let sumSq = 0;
  for (let i = 0; i < dim; i++) {
    const hash = createHash("sha256")
      .update(imageBuffer)
      .update(String(i))
      .digest();
    const val = (hash.readInt16LE(0) / 32768);
    vector.push(val);
    sumSq += val * val;
  }
  const norm = Math.sqrt(sumSq) || 1;
  return vector.map((v) => Number((v / norm).toFixed(6)));
}

/**
 * TRD §7.2 — Memanggil endpoint internal Flask `POST /v1/embed` untuk 1 sampel foto wajah.
 * Jika layanan Flask tidak aktif/timeout -> melempar 503 `AI_UNAVAILABLE` (FSD §5.3).
 */
export async function embedFaceSampleWithAi(params: {
  imageBuffer: Buffer;
  mimeType: string;
  sampleIndex: number;
  allowDevFallback?: boolean;
}): Promise<AiEmbedSampleResult> {
  if (customMockEmbedHandler) {
    return customMockEmbedHandler(params.imageBuffer, params.sampleIndex);
  }

  const useDevFallback =
    process.env.NODE_ENV !== "production" &&
    (params.allowDevFallback === true ||
      process.env.AI_DEV_FALLBACK === "true");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getAiTimeoutMs());

  try {
    const ext = params.mimeType === "image/png" ? "png" : "jpg";
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(params.imageBuffer)], {
      type: params.mimeType,
    });
    formData.append("image", blob, `sample_${params.sampleIndex}.${ext}`);

    const response = await fetch(`${getAiBaseUrl()}/v1/embed`, {
      method: "POST",
      headers: {
        "X-Internal-Token": getAiInternalToken(),
      },
      body: formData,
      signal: controller.signal,
    });

    if (response.status >= 500) {
      throw new AppError(
        "Layanan verifikasi wajah (AI) sedang tidak tersedia.",
        503,
        { code: "AI_UNAVAILABLE" }
      );
    }

    const body = (await response.json()) as Record<string, any>;

    // Tangani kode error eksplisit dari Flask bila dikembalikan sebagai 4xx
    const errCode = String(body?.error?.code ?? "").toUpperCase();
    if (errCode === "NO_FACE" || body?.count === 0) {
      return { accepted: false, reason: "NO_FACE" };
    }
    if (errCode === "MULTIPLE_FACES" || (typeof body?.count === "number" && body.count > 1)) {
      return { accepted: false, reason: "MULTIPLE_FACES" };
    }
    if (
      errCode === "LOW_QUALITY" ||
      body?.quality?.passed === false
    ) {
      return {
        accepted: false,
        reason: "LOW_QUALITY",
        details: Array.isArray(body?.quality?.reasons)
          ? body.quality.reasons
          : undefined,
      };
    }

    const embedding = body?.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      return { accepted: false, reason: "LOW_QUALITY" };
    }

    const dim = Number(body?.dim ?? embedding.length);
    const qualityScore =
      typeof body?.quality?.score === "number"
        ? body.quality.score
        : typeof body?.quality?.face_area_ratio === "number"
          ? Math.min(1, Number(body.quality.face_area_ratio))
          : 0.95;

    return {
      accepted: true,
      embedding: embedding.map(Number),
      dim,
      qualityScore,
      modelName: String(body?.model?.name ?? "arcface_r50"),
      modelVersion: String(body?.model?.version ?? "1.0"),
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    if (useDevFallback) {
      const devEmbedding = buildDeterministicDevEmbedding(params.imageBuffer, 128);
      return {
        accepted: true,
        embedding: devEmbedding,
        dim: devEmbedding.length,
        qualityScore: 0.98,
        modelName: "dev_mock_arcface",
        modelVersion: "1.0-dev",
      };
    }

    throw new AppError(
      "Layanan verifikasi wajah (AI) sedang tidak tersedia. Silakan coba beberapa saat lagi.",
      503,
      { code: "AI_UNAVAILABLE" }
    );
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * TRD §7.2 & BR-14 — Memanggil endpoint internal Flask `POST /v1/verify` untuk membandingkan
 * foto presensi masuk terhadap daftar vektor embedding referensi siswa.
 */
export async function verifyFaceWithAi(params: {
  imageBuffer: Buffer;
  mimeType: string;
  references: number[][];
  allowDevFallback?: boolean;
}): Promise<AiVerifySampleResult> {
  if (customMockVerifyHandler) {
    return customMockVerifyHandler({
      imageBuffer: params.imageBuffer,
      references: params.references,
    });
  }

  const threshold = getFaceMatchThreshold();
  const useDevFallback =
    process.env.NODE_ENV !== "production" &&
    (params.allowDevFallback === true ||
      process.env.AI_DEV_FALLBACK === "true");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getAiTimeoutMs());

  try {
    const ext = params.mimeType === "image/png" ? "png" : "jpg";
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(params.imageBuffer)], {
      type: params.mimeType,
    });
    formData.append("image", blob, `checkin.${ext}`);
    formData.append("references", JSON.stringify(params.references));

    const response = await fetch(`${getAiBaseUrl()}/v1/verify`, {
      method: "POST",
      headers: {
        "X-Internal-Token": getAiInternalToken(),
      },
      body: formData,
      signal: controller.signal,
    });

    if (response.status >= 500) {
      return {
        faceResult: "error",
        similarityMax: null,
        modelName: null,
        modelVersion: null,
      };
    }

    const body = (await response.json()) as Record<string, any>;
    const modelName = body?.model?.name ? String(body.model.name) : "arcface_r50";
    const modelVersion = body?.model?.version ? String(body.model.version) : "1.0";

    const errCode = String(body?.error?.code ?? "").toUpperCase();
    if (errCode === "NO_FACE" || body?.count === 0) {
      return {
        faceResult: "no_face",
        similarityMax: null,
        modelName,
        modelVersion,
      };
    }
    if (
      errCode === "MULTIPLE_FACES" ||
      (typeof body?.count === "number" && body.count > 1)
    ) {
      return {
        faceResult: "multiple_faces",
        similarityMax: null,
        modelName,
        modelVersion,
      };
    }
    if (errCode === "LOW_QUALITY" || body?.quality?.passed === false) {
      return {
        faceResult: "low_quality",
        similarityMax: null,
        modelName,
        modelVersion,
      };
    }

    let similarityMax: number | null =
      typeof body?.similarity_max === "number"
        ? Number(body.similarity_max.toFixed(5))
        : null;

    if (similarityMax === null && Array.isArray(body?.similarities) && body.similarities.length > 0) {
      similarityMax = Number(
        Math.max(...body.similarities.map(Number)).toFixed(5)
      );
    }

    if (similarityMax === null) {
      return {
        faceResult: "error",
        similarityMax: null,
        modelName,
        modelVersion,
      };
    }

    return {
      faceResult: similarityMax >= threshold ? "match" : "no_match",
      similarityMax,
      modelName,
      modelVersion,
    };
  } catch {
    if (useDevFallback) {
      const dim = params.references[0]?.length ?? 128;
      const probe = buildDeterministicDevEmbedding(params.imageBuffer, dim);
      const sims = params.references.map((ref) =>
        computeCosineSimilarity(probe, ref)
      );
      const maxSim = sims.length > 0 ? Math.max(...sims) : 0;
      const clampedSim = Number(Math.max(0, Math.min(1, maxSim)).toFixed(5));
      return {
        faceResult: clampedSim >= threshold ? "match" : "no_match",
        similarityMax: clampedSim,
        modelName: "dev_mock_arcface",
        modelVersion: "1.0-dev",
      };
    }

    return {
      faceResult: "error",
      similarityMax: null,
      modelName: null,
      modelVersion: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}
