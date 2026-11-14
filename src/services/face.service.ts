import path from "path";
import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { database } from "../config/database";
import {
  embedFaceSampleWithAi,
  FaceRejectionReason,
} from "../integrations/ai.client";
import { decryptEmbedding, encryptEmbedding } from "../utils/embedding-crypto";
import { AppError } from "../utils/errors";
import {
  ENROLL_MIN_SAMPLES,
  removeFaceReferencePhotoIfExists,
  saveFaceReferencePhoto,
  ValidatedFacePhoto,
} from "../utils/face-upload";
import { createSignedFileUrl } from "../utils/signed-url";

export interface FaceStatusResult {
  enrolled: boolean;
  enrolled_at: string | null;
  samples: number;
  consent_at: string | null;
  model: {
    name: string;
    version: string;
  } | null;
  reference_photo_url: string | null;
}

export interface FaceEnrollRejectedItem {
  index: number;
  reason: FaceRejectionReason;
  details?: string[];
}

export interface FaceEnrollResult {
  status: "enrolled";
  samples_accepted: number;
  rejected: FaceEnrollRejectedItem[];
  reference_photo_url: string | null;
}

interface RosterConsentRow extends RowDataPacket {
  id: number;
  nisn: string;
  full_name: string;
  biometric_consent_at?: Date | string | null;
}

interface FaceTemplateRow extends RowDataPacket {
  id: number;
  student_id: number;
  embedding: Buffer;
  embedding_dim: number;
  model_name: string;
  model_version: string;
  quality_score: number | string | null;
  photo_path: string | null;
  status: "active" | "revoked";
  created_at: Date | string;
}

let faceSchemaChecked = false;

export async function ensureFaceSchema(): Promise<void> {
  if (faceSchemaChecked) {
    return;
  }
  try {
    const [consentCol] = await database.execute<RowDataPacket[]>(
      `SHOW COLUMNS FROM \`student_roster\` LIKE 'biometric_consent_at'`
    );
    if (Array.isArray(consentCol) && consentCol.length === 0) {
      await database.execute(
        `ALTER TABLE \`student_roster\`
         ADD COLUMN \`biometric_consent_at\` DATETIME NULL AFTER \`address\``
      );
    }

    await database.execute(`
      CREATE TABLE IF NOT EXISTS face_templates (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        student_id BIGINT UNSIGNED NOT NULL COMMENT 'References student_roster(id)',
        embedding VARBINARY(8192) NOT NULL COMMENT 'AES-256-GCM(iv(12) | tag(16) | float32[] little-endian)',
        embedding_dim SMALLINT UNSIGNED NOT NULL,
        model_name VARCHAR(60) NOT NULL,
        model_version VARCHAR(30) NOT NULL,
        quality_score DECIMAL(5, 4) NULL,
        photo_path VARCHAR(255) NULL COMMENT 'Foto referensi (untuk tampilan hasil scan admin/guru)',
        status ENUM('active', 'revoked') NOT NULL DEFAULT 'active',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_ft_student_status (student_id, status),
        CONSTRAINT fk_ft_student FOREIGN KEY (student_id) REFERENCES student_roster(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    faceSchemaChecked = true;
  } catch {
    faceSchemaChecked = true;
  }
}

export function resetFaceSchemaCheckForTesting(): void {
  faceSchemaChecked = true;
}

function toIsoStringOrNull(val: Date | string | null | undefined): string | null {
  if (!val) {
    return null;
  }
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return val.toISOString();
  }
  if (typeof val === "string") {
    const parsed = new Date(val);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
    return val;
  }
  return null;
}

/**
 * US-10 & FSD §5.3 — GET /api/face/status
 * Menampilkan status enrollment wajah siswa yang sedang login.
 */
export async function getStudentFaceStatus(
  studentRosterId: number
): Promise<FaceStatusResult> {
  await ensureFaceSchema();

  const [rosterRows] = await database.execute<RosterConsentRow[]>(
    `SELECT id, nisn, full_name, biometric_consent_at
     FROM student_roster
     WHERE id = ?
     LIMIT 1`,
    [studentRosterId]
  );

  if (rosterRows.length === 0) {
    throw new AppError("Data profil roster siswa tidak ditemukan.", 404, {
      code: "ROSTER_NOT_FOUND",
    });
  }

  const consentAt = toIsoStringOrNull(rosterRows[0].biometric_consent_at);

  const [templateRows] = await database.execute<FaceTemplateRow[]>(
    `SELECT id, model_name, model_version, photo_path, created_at
     FROM face_templates
     WHERE student_id = ? AND status = 'active'
     ORDER BY id DESC`,
    [studentRosterId]
  );

  if (templateRows.length === 0) {
    return {
      enrolled: false,
      enrolled_at: null,
      samples: 0,
      consent_at: consentAt,
      model: null,
      reference_photo_url: null,
    };
  }

  const latest = templateRows[0];
  const rowWithPhoto = templateRows.find((r) => Boolean(r.photo_path));
  const referencePhotoUrl = rowWithPhoto?.photo_path
    ? createSignedFileUrl({
        category: "faces",
        filename: path.basename(rowWithPhoto.photo_path),
      })
    : null;

  return {
    enrolled: true,
    enrolled_at: toIsoStringOrNull(latest.created_at),
    samples: templateRows.length,
    consent_at: consentAt,
    model: {
      name: latest.model_name,
      version: latest.model_version,
    },
    reference_photo_url: referencePhotoUrl,
  };
}

/**
 * US-10, BR-20, TD-08 & FSD §5.3 — POST /api/face/enroll
 * Memproses 3–5 sampel foto wajah ke Flask AI (/v1/embed), mengenkripsi embedding
 * dengan AES-256-GCM, menyimpan 1 foto referensi terbaik, dan menggantikan template lama.
 */
export async function enrollStudentFace(params: {
  studentRosterId: number;
  photos: ValidatedFacePhoto[];
  allowDevFallback?: boolean;
}): Promise<FaceEnrollResult> {
  await ensureFaceSchema();

  const acceptedSamples: Array<{
    photoIndex: number;
    photo: ValidatedFacePhoto;
    embedding: number[];
    dim: number;
    qualityScore: number;
    modelName: string;
    modelVersion: string;
  }> = [];
  const rejected: FaceEnrollRejectedItem[] = [];

  for (let i = 0; i < params.photos.length; i++) {
    const photo = params.photos[i];
    const aiRes = await embedFaceSampleWithAi({
      imageBuffer: photo.buffer,
      mimeType: photo.mime,
      sampleIndex: i,
      allowDevFallback: params.allowDevFallback,
    });

    if (aiRes.accepted) {
      acceptedSamples.push({
        photoIndex: i,
        photo,
        embedding: aiRes.embedding,
        dim: aiRes.dim,
        qualityScore: aiRes.qualityScore,
        modelName: aiRes.modelName,
        modelVersion: aiRes.modelVersion,
      });
    } else {
      rejected.push({
        index: i,
        reason: aiRes.reason,
        ...(aiRes.details ? { details: aiRes.details } : {}),
      });
    }
  }

  // FSD §5.3 & BR-20: Gagal bila diterima < ENROLL_MIN_SAMPLES (3) -> 422 ENROLL_INSUFFICIENT_SAMPLES
  if (acceptedSamples.length < ENROLL_MIN_SAMPLES) {
    throw new AppError(
      `Sampel wajah yang memenuhi syarat kurang dari batas minimum (${acceptedSamples.length}/${ENROLL_MIN_SAMPLES} diterima). Pastikan wajah terlihat jelas dan sendirian di dalam frame.`,
      422,
      {
        code: "ENROLL_INSUFFICIENT_SAMPLES",
        details: {
          samples_accepted: acceptedSamples.length,
          min_required: ENROLL_MIN_SAMPLES,
          rejected,
        },
      }
    );
  }

  // TRD §9.6 (Minimisasi): Simpan hanya 1 foto referensi terbaik (qualityScore tertinggi)
  let bestSampleIdx = 0;
  for (let i = 1; i < acceptedSamples.length; i++) {
    if (
      acceptedSamples[i].qualityScore >
      acceptedSamples[bestSampleIdx].qualityScore
    ) {
      bestSampleIdx = i;
    }
  }
  const bestPhoto = acceptedSamples[bestSampleIdx].photo;
  const savedReferencePhoto = saveFaceReferencePhoto(
    bestPhoto.buffer,
    bestPhoto.ext
  );

  // BR-20: Enrollment ulang menggantikan template lama (revoke & hapus foto referensi lama)
  const [oldTemplates] = await database.execute<FaceTemplateRow[]>(
    `SELECT id, photo_path
     FROM face_templates
     WHERE student_id = ? AND status = 'active'`,
    [params.studentRosterId]
  );

  await database.execute(
    `UPDATE face_templates
     SET status = 'revoked', photo_path = NULL
     WHERE student_id = ? AND status = 'active'`,
    [params.studentRosterId]
  );

  for (const oldRow of oldTemplates) {
    if (oldRow.photo_path) {
      removeFaceReferencePhotoIfExists(oldRow.photo_path);
    }
  }

  // Simpan setiap sampel diterima dengan enkripsi AES-256-GCM (TD-08)
  for (let i = 0; i < acceptedSamples.length; i++) {
    const sample = acceptedSamples[i];
    const encryptedEmbedding = encryptEmbedding(sample.embedding);
    const photoPath =
      i === bestSampleIdx ? savedReferencePhoto.relativePath : null;

    await database.execute<ResultSetHeader>(
      `INSERT INTO face_templates
         (student_id, embedding, embedding_dim, model_name, model_version, quality_score, photo_path, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
      [
        params.studentRosterId,
        encryptedEmbedding,
        sample.dim,
        sample.modelName,
        sample.modelVersion,
        sample.qualityScore,
        photoPath,
      ]
    );
  }

  // Catat waktu persetujuan biometrik pada student_roster (TRD §9.6)
  await database.execute(
    `UPDATE student_roster
     SET biometric_consent_at = COALESCE(biometric_consent_at, NOW())
     WHERE id = ?`,
    [params.studentRosterId]
  );

  const referencePhotoUrl = createSignedFileUrl({
    category: "faces",
    filename: savedReferencePhoto.filename,
  });

  return {
    status: "enrolled",
    samples_accepted: acceptedSamples.length,
    rejected,
    reference_photo_url: referencePhotoUrl,
  };
}

/**
 * FSD §5.3 & US-70 AC3 (P1 Admin) — POST /api/students/:nisn/face/reset
 * Admin mereset seluruh template wajah aktif milik siswa berdasarkan NISN (atau ID roster).
 */
export async function resetStudentFaceEnrollment(
  nisnOrId: string
): Promise<{
  student_id: number;
  nisn: string;
  student_name: string;
  revoked_templates: number;
}> {
  await ensureFaceSchema();

  const cleaned = nisnOrId.trim();
  if (!cleaned) {
    throw new AppError("Parameter NISN siswa wajib diisi.", 400, {
      code: "VALIDATION_ERROR",
      errors: { nisn: "NISN siswa wajib diisi." },
    });
  }

  const [rosterRows] = await database.execute<RosterConsentRow[]>(
    `SELECT id, nisn, full_name
     FROM student_roster
     WHERE nisn = ? OR (id = ? AND ? REGEXP '^[0-9]+$' AND CHAR_LENGTH(?) < 10)
     LIMIT 1`,
    [cleaned, cleaned, cleaned, cleaned]
  );

  if (rosterRows.length === 0) {
    throw new AppError(
      "Siswa dengan NISN tersebut tidak ditemukan di dalam roster.",
      404,
      { code: "ROSTER_NOT_FOUND" }
    );
  }

  const student = rosterRows[0];

  const [activeTemplates] = await database.execute<FaceTemplateRow[]>(
    `SELECT id, photo_path
     FROM face_templates
     WHERE student_id = ? AND status = 'active'`,
    [student.id]
  );

  const [updateRes] = await database.execute<ResultSetHeader>(
    `UPDATE face_templates
     SET status = 'revoked', photo_path = NULL
     WHERE student_id = ? AND status = 'active'`,
    [student.id]
  );

  for (const row of activeTemplates) {
    if (row.photo_path) {
      removeFaceReferencePhotoIfExists(row.photo_path);
    }
  }

  await database.execute(
    `UPDATE student_roster
     SET biometric_consent_at = NULL
     WHERE id = ?`,
    [student.id]
  );

  return {
    student_id: Number(student.id),
    nisn: student.nisn,
    student_name: student.full_name,
    revoked_templates: Number(updateRes.affectedRows ?? activeTemplates.length),
  };
}

/**
 * Helper internal untuk modul Attendance (`POST /api/attendance/check-in`):
 * Mengambil dan mendekripsi seluruh vektor embedding referensi aktif milik siswa di memori.
 */
export async function getActiveStudentFaceEmbeddings(
  studentRosterId: number
): Promise<{
  embeddings: number[][];
  modelName: string | null;
  modelVersion: string | null;
  referencePhotoPath: string | null;
}> {
  await ensureFaceSchema();

  const [rows] = await database.execute<FaceTemplateRow[]>(
    `SELECT id, embedding, embedding_dim, model_name, model_version, photo_path
     FROM face_templates
     WHERE student_id = ? AND status = 'active'
     ORDER BY id ASC`,
    [studentRosterId]
  );

  if (rows.length === 0) {
    return {
      embeddings: [],
      modelName: null,
      modelVersion: null,
      referencePhotoPath: null,
    };
  }

  const embeddings = rows.map((r) => decryptEmbedding(r.embedding));
  const rowWithPhoto = rows.find((r) => Boolean(r.photo_path));

  return {
    embeddings,
    modelName: rows[0].model_name,
    modelVersion: rows[0].model_version,
    referencePhotoPath: rowWithPhoto?.photo_path ?? null,
  };
}
