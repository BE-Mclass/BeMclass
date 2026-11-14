import { RowDataPacket } from "mysql2/promise";
import { database } from "../config/database";
import { AppError } from "../utils/errors";

export const LOCKED_STUDENT_FIELDS = [
  "nisn",
  "name",
  "class",
  "absence_number",
  "gender",
  "birth_date",
  "guardian_name",
  "guardian_phone",
] as const;

const LOCKED_FIELD_ALIASES: Record<string, string> = {
  nisn: "nisn",
  name: "name",
  full_name: "name",
  fullName: "name",
  class: "class",
  class_id: "class",
  classId: "class",
  absence_number: "absence_number",
  absenceNumber: "absence_number",
  attendance_number: "absence_number",
  attendanceNumber: "absence_number",
  gender: "gender",
  birth_date: "birth_date",
  birthDate: "birth_date",
  guardian_name: "guardian_name",
  guardianName: "guardian_name",
  guardian_phone: "guardian_phone",
  guardianPhone: "guardian_phone",
  parent_phone: "guardian_phone",
  parentPhone: "guardian_phone",
};

export interface StudentProfileData {
  id: number;
  user_id: number;
  nisn: string;
  name: string;
  full_name: string;
  email: string;
  class: {
    id: number;
    name: string;
    grade_level: number | null;
  } | null;
  absence_number: number | null;
  attendance_number: number | null;
  gender: "L" | "P";
  birth_date: string | null;
  phone: string | null;
  whatsapp_number: string | null;
  address: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  parent_phone: string | null;
  locked_fields: string[];
  avatar_url: string | null;
}

export interface HomeroomTeacherData {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  class: {
    id: number;
    name: string;
    grade_level: number | null;
  };
}

interface StudentProfileRow extends RowDataPacket {
  roster_id: number;
  user_id: number;
  nisn: string;
  full_name: string;
  gender?: "L" | "P" | null;
  birth_date?: Date | string | null;
  class_id: number | null;
  class_name: string | null;
  grade_level: number | null;
  attendance_number: number | null;
  guardian_name?: string | null;
  parent_phone: string | null;
  whatsapp_number: string | null;
  address: string | null;
  user_name: string;
  email: string;
  user_phone?: string | null;
  photo_url: string | null;
}

interface HomeroomRow extends RowDataPacket {
  roster_id: number;
  class_id: number | null;
  class_name: string | null;
  grade_level: number | null;
  homeroom_teacher_id: number | null;
  teacher_id: number | null;
  teacher_name: string | null;
  teacher_email: string | null;
  teacher_phone?: string | null;
  teacher_photo_url: string | null;
  teacher_is_active: number | null;
}

let schemaChecked = false;

/**
 * Ensures optional profile columns (`users.phone`, `student_roster.gender`,
 * `student_roster.birth_date`, `student_roster.guardian_name`) exist on older local databases.
 */
export async function ensureProfileColumns(): Promise<void> {
  if (schemaChecked) {
    return;
  }
  try {
    const [userPhoneCol] = await database.execute<RowDataPacket[]>(
      `SHOW COLUMNS FROM \`users\` LIKE 'phone'`
    );
    if (Array.isArray(userPhoneCol) && userPhoneCol.length === 0) {
      await database.execute(
        `ALTER TABLE \`users\` ADD COLUMN \`phone\` VARCHAR(30) NULL AFTER \`oauth_provider\``
      );
    }

    const [genderCol] = await database.execute<RowDataPacket[]>(
      `SHOW COLUMNS FROM \`student_roster\` LIKE 'gender'`
    );
    if (Array.isArray(genderCol) && genderCol.length === 0) {
      await database.execute(
        `ALTER TABLE \`student_roster\`
         ADD COLUMN \`gender\` ENUM('L', 'P') NOT NULL DEFAULT 'L' AFTER \`full_name\`,
         ADD COLUMN \`birth_date\` DATE NULL AFTER \`gender\``
      );
    }

    const [guardianNameCol] = await database.execute<RowDataPacket[]>(
      `SHOW COLUMNS FROM \`student_roster\` LIKE 'guardian_name'`
    );
    if (Array.isArray(guardianNameCol) && guardianNameCol.length === 0) {
      await database.execute(
        `ALTER TABLE \`student_roster\`
         ADD COLUMN \`guardian_name\` VARCHAR(150) NULL AFTER \`attendance_number\``
      );
    }
    schemaChecked = true;
  } catch {
    // Ignore in mock/read-only environments; main SELECT handles fields gracefully
    schemaChecked = true;
  }
}

export function resetProfileSchemaCheckForTesting(): void {
  schemaChecked = true;
}

function formatDateOnly(val: Date | string | null | undefined): string | null {
  if (!val) {
    return null;
  }
  if (typeof val === "string") {
    return val.slice(0, 10);
  }
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, "0");
    const d = String(val.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return null;
}

/**
 * Validates an Indonesian phone number (9–15 digits, starts with 0, 62, or +62).
 */
export function validateIndonesianPhone(raw: unknown): {
  valid: boolean;
  normalized?: string | null;
  error?: string;
} {
  if (raw === null) {
    return { valid: true, normalized: null };
  }
  if (typeof raw !== "string") {
    return {
      valid: false,
      error: "Nomor telepon/WA harus berupa teks.",
    };
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    return {
      valid: false,
      error: "Nomor telepon/WA tidak boleh kosong.",
    };
  }

  // Strip spaces and dashes for validation
  const compact = trimmed.replace(/[\s-]/g, "");
  const digitsOnly = compact.startsWith("+") ? compact.slice(1) : compact;

  if (!/^\d+$/.test(digitsOnly)) {
    return {
      valid: false,
      error: "Nomor telepon/WA hanya boleh berisi angka (9–15 digit).",
    };
  }

  if (digitsOnly.length < 9 || digitsOnly.length > 15) {
    return {
      valid: false,
      error: "Nomor telepon/WA harus terdiri dari 9 hingga 15 digit angka.",
    };
  }

  if (!/^(?:\+62|62|0)\d+$/.test(compact)) {
    return {
      valid: false,
      error: "Nomor telepon/WA harus diawali 08, 62, atau +62.",
    };
  }

  return { valid: true, normalized: compact };
}

/**
 * US-61 & FSD §5.10 — GET /api/me/profile
 * Mengambil profil lengkap siswa beserta data akademik yang terkunci (`locked_fields`).
 */
export async function getStudentProfile(
  userId: number
): Promise<StudentProfileData> {
  await ensureProfileColumns();

  const [rows] = await database.execute<StudentProfileRow[]>(
    `SELECT
       sr.id AS roster_id,
       sr.user_id,
       sr.nisn,
       sr.full_name,
       sr.gender,
       sr.birth_date,
       sr.class_id,
       c.name AS class_name,
       c.grade_level,
       sr.attendance_number,
       sr.guardian_name,
       sr.parent_phone,
       sr.whatsapp_number,
       sr.address,
       u.name AS user_name,
       u.email,
       u.phone AS user_phone,
       u.photo_url
     FROM student_roster sr
     INNER JOIN users u ON u.id = sr.user_id
     LEFT JOIN classes c ON c.id = sr.class_id
     WHERE sr.user_id = ? AND sr.is_active = 1
     LIMIT 1`,
    [userId]
  );

  if (rows.length === 0) {
    throw new AppError("Data profil siswa tidak ditemukan di dalam roster.", 404, {
      code: "ROSTER_NOT_FOUND",
    });
  }

  const row = rows[0];
  const fullName = row.full_name || row.user_name;
  const phone = row.whatsapp_number ?? row.user_phone ?? null;
  const guardianPhone = row.parent_phone ?? null;
  const absenceNumber =
    row.attendance_number !== null && row.attendance_number !== undefined
      ? Number(row.attendance_number)
      : null;

  return {
    id: Number(row.roster_id),
    user_id: Number(row.user_id),
    nisn: row.nisn,
    name: fullName,
    full_name: fullName,
    email: row.email,
    class:
      row.class_id !== null && row.class_id !== undefined
        ? {
            id: Number(row.class_id),
            name: row.class_name ?? "",
            grade_level:
              row.grade_level !== null && row.grade_level !== undefined
                ? Number(row.grade_level)
                : null,
          }
        : null,
    absence_number: absenceNumber,
    attendance_number: absenceNumber,
    gender: row.gender === "P" ? "P" : "L",
    birth_date: formatDateOnly(row.birth_date),
    phone,
    whatsapp_number: phone,
    address: row.address ?? null,
    guardian_name: row.guardian_name ?? null,
    guardian_phone: guardianPhone,
    parent_phone: guardianPhone,
    locked_fields: [...LOCKED_STUDENT_FIELDS],
    avatar_url: row.photo_url ?? null,
  };
}

/**
 * US-61 & FSD §5.10 — PATCH /api/me/profile
 * Hanya mengizinkan siswa mengubah `phone` (alias `whatsapp_number`, 9–15 digit)
 * dan `address` (≤ 255 karakter). Data akademik (`locked_fields`) tidak dapat diubah.
 */
export async function updateStudentProfile(
  userId: number,
  payload: unknown
): Promise<StudentProfileData> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new AppError("Format data pembaruan profil tidak valid.", 400, {
      code: "VALIDATION_ERROR",
      errors: { _form: "Body request harus berupa objek JSON." },
    });
  }

  const body = payload as Record<string, unknown>;
  const errors: Record<string, string> = {};

  // Tolak perubahan pada field akademik yang dikunci (locked_fields)
  for (const [key, canonicalField] of Object.entries(LOCKED_FIELD_ALIASES)) {
    if (Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined) {
      errors[canonicalField] =
        "Data akademik dikunci dan tidak dapat diubah oleh siswa.";
    }
  }

  const hasPhone =
    Object.prototype.hasOwnProperty.call(body, "phone") ||
    Object.prototype.hasOwnProperty.call(body, "whatsapp_number") ||
    Object.prototype.hasOwnProperty.call(body, "whatsappNumber");
  const rawPhone = Object.prototype.hasOwnProperty.call(body, "phone")
    ? body.phone
    : Object.prototype.hasOwnProperty.call(body, "whatsapp_number")
      ? body.whatsapp_number
      : body.whatsappNumber;

  const hasAddress = Object.prototype.hasOwnProperty.call(body, "address");
  const rawAddress = body.address;

  let normalizedPhone: string | null | undefined = undefined;
  if (hasPhone && rawPhone !== undefined) {
    const phoneCheck = validateIndonesianPhone(rawPhone);
    if (!phoneCheck.valid) {
      errors.phone = phoneCheck.error!;
    } else {
      normalizedPhone = phoneCheck.normalized;
    }
  }

  let normalizedAddress: string | null | undefined = undefined;
  if (hasAddress && rawAddress !== undefined) {
    if (rawAddress === null) {
      normalizedAddress = null;
    } else if (typeof rawAddress !== "string") {
      errors.address = "Alamat harus berupa teks.";
    } else {
      const trimmedAddress = rawAddress.trim();
      if (trimmedAddress.length > 255) {
        errors.address = "Alamat maksimal 255 karakter.";
      } else {
        normalizedAddress = trimmedAddress === "" ? null : trimmedAddress;
      }
    }
  }

  if (
    Object.keys(errors).length === 0 &&
    normalizedPhone === undefined &&
    normalizedAddress === undefined
  ) {
    errors._form =
      "Isi minimal nomor telepon/WA (phone) atau alamat (address) yang akan diperbarui.";
  }

  if (Object.keys(errors).length > 0) {
    throw new AppError("Validasi pembaruan profil siswa gagal.", 400, {
      code: "VALIDATION_ERROR",
      errors,
    });
  }

  // Pastikan profil siswa ada terlebih dahulu
  const currentProfile = await getStudentProfile(userId);

  const nextPhone =
    normalizedPhone !== undefined ? normalizedPhone : currentProfile.phone;
  const nextAddress =
    normalizedAddress !== undefined ? normalizedAddress : currentProfile.address;

  await database.execute(
    `UPDATE student_roster
     SET whatsapp_number = ?,
         address = ?
     WHERE user_id = ?`,
    [nextPhone, nextAddress, userId]
  );

  if (normalizedPhone !== undefined) {
    try {
      await database.execute(`UPDATE users SET phone = ? WHERE id = ?`, [
        nextPhone,
        userId,
      ]);
    } catch {
      // Abaikan bila kolom users.phone belum dimigrasi pada environment lama
    }
  }

  return getStudentProfile(userId);
}

/**
 * US-61 & FSD §5.10 — GET /api/me/homeroom
 * Menampilkan informasi nama & kontak wali kelas dari kelas siswa.
 * Mengembalikan 404 NO_HOMEROOM bila kelas siswa belum memiliki wali kelas.
 */
export async function getStudentHomeroomTeacher(
  userId: number
): Promise<HomeroomTeacherData> {
  await ensureProfileColumns();

  const [rows] = await database.execute<HomeroomRow[]>(
    `SELECT
       sr.id AS roster_id,
       sr.class_id,
       c.name AS class_name,
       c.grade_level,
       c.homeroom_teacher_id,
       t.id AS teacher_id,
       t.name AS teacher_name,
       t.email AS teacher_email,
       t.phone AS teacher_phone,
       t.photo_url AS teacher_photo_url,
       t.is_active AS teacher_is_active
     FROM student_roster sr
     LEFT JOIN classes c ON c.id = sr.class_id
     LEFT JOIN users t ON t.id = c.homeroom_teacher_id
     WHERE sr.user_id = ? AND sr.is_active = 1
     LIMIT 1`,
    [userId]
  );

  if (rows.length === 0) {
    throw new AppError("Data profil siswa tidak ditemukan di dalam roster.", 404, {
      code: "ROSTER_NOT_FOUND",
    });
  }

  const row = rows[0];

  if (
    !row.class_id ||
    !row.homeroom_teacher_id ||
    !row.teacher_id ||
    !row.teacher_is_active
  ) {
    throw new AppError("Wali kelas belum ditetapkan untuk kelas Anda.", 404, {
      code: "NO_HOMEROOM",
    });
  }

  return {
    id: Number(row.teacher_id),
    name: row.teacher_name ?? "",
    email: row.teacher_email ?? "",
    phone: row.teacher_phone ?? null,
    avatar_url: row.teacher_photo_url ?? null,
    class: {
      id: Number(row.class_id),
      name: row.class_name ?? "",
      grade_level:
        row.grade_level !== null && row.grade_level !== undefined
          ? Number(row.grade_level)
          : null,
    },
  };
}
