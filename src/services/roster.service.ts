import { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { database } from "../config/database";
import { AppError } from "../utils/errors";

const NISN_REGEX = /^\d{10}$/;

export interface CreateRosterInput {
  nisn?: unknown;
  fullName?: unknown;
  gender?: unknown;
  birthDate?: unknown;
  classId?: unknown;
  attendanceNumber?: unknown;
  guardianName?: unknown;
  parentPhone?: unknown;
  whatsappNumber?: unknown;
  address?: unknown;
}

function addValidationError(
  errors: Record<string, string>,
  field: string,
  message: string
): void {
  errors[field] = message;
}

function parseOptionalInteger(
  value: unknown,
  field: string,
  errors: Record<string, string>,
  minimum: number,
  maximum: number
): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    value === null ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return null;
  }
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value.trim())
        ? Number(value)
        : Number.NaN;
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum
  ) {
    addValidationError(errors, field, "Nilai harus berupa bilangan bulat yang valid.");
    return undefined;
  }
  return parsed;
}

function parseOptionalText(
  value: unknown,
  field: string,
  errors: Record<string, string>,
  maximumLength: number
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    addValidationError(errors, field, "Nilai harus berupa teks.");
    return undefined;
  }
  const text = value.trim();
  if (text.length > maximumLength) {
    addValidationError(errors, field, `Maksimal ${maximumLength} karakter.`);
    return undefined;
  }
  return text || null;
}

async function validateClassId(classId: number | null): Promise<void> {
  if (classId === null) {
    return;
  }
  const [rows] = await database.execute<RowDataPacket[]>(
    `SELECT id FROM classes WHERE id = ? LIMIT 1`,
    [classId]
  );
  if (rows.length === 0) {
    throw new AppError("Kelas tidak ditemukan.", 422, {
      code: "CLASS_NOT_FOUND",
      errors: { class_id: "Pilih kelas yang terdaftar." },
    });
  }
}

export async function listStudentRoster(filters?: {
  classId?: number;
  search?: string;
}) {
  let sql = `
    SELECT
      sr.id, sr.nisn, sr.full_name, sr.gender, sr.birth_date, sr.class_id,
      c.name AS class_name, c.grade_level,
      sr.attendance_number, sr.guardian_name, sr.parent_phone, sr.whatsapp_number, sr.address,
      sr.user_id, u.email AS registered_email,
      sr.is_active, sr.created_at, sr.updated_at
    FROM student_roster sr
    LEFT JOIN classes c ON c.id = sr.class_id
    LEFT JOIN users u ON u.id = sr.user_id
    WHERE 1=1
  `;
  const params: Array<string | number> = [];

  if (filters?.classId) {
    sql += ` AND sr.class_id = ?`;
    params.push(filters.classId);
  }

  if (filters?.search) {
    sql += ` AND (sr.nisn LIKE ? OR sr.full_name LIKE ?)`;
    const term = `%${filters.search.trim()}%`;
    params.push(term, term);
  }

  sql += ` ORDER BY c.name ASC, sr.attendance_number ASC, sr.full_name ASC`;

  const [rows] = await database.execute<RowDataPacket[]>(sql, params);
  return rows;
}

export async function createStudentRoster(input: CreateRosterInput) {
  const errors: Record<string, string> = {};
  const nisn = typeof input.nisn === "string" ? input.nisn.trim() : "";
  const fullName = typeof input.fullName === "string" ? input.fullName.trim() : "";
  if (!NISN_REGEX.test(nisn)) {
    errors.nisn = "NISN wajib berupa 10 digit angka.";
  }
  if (!fullName) {
    errors.full_name = "Nama lengkap siswa wajib diisi.";
  } else if (fullName.length > 150) {
    errors.full_name = "Nama lengkap maksimal 150 karakter.";
  }

  const classId = parseOptionalInteger(
    input.classId,
    "class_id",
    errors,
    1,
    Number.MAX_SAFE_INTEGER
  );
  const attendanceNumber = parseOptionalInteger(
    input.attendanceNumber,
    "attendance_number",
    errors,
    0,
    65535
  );
  const parentPhone = parseOptionalText(
    input.parentPhone,
    "parent_phone",
    errors,
    30
  );
  const whatsappNumber = parseOptionalText(
    input.whatsappNumber,
    "whatsapp_number",
    errors,
    30
  );
  const address = parseOptionalText(input.address, "address", errors, 65535);

  if (Object.keys(errors).length > 0) {
    throw new AppError("Validasi data roster gagal.", 400, {
      code: "VALIDATION_ERROR",
      errors,
    });
  }

  await validateClassId(classId ?? null);

  const [existing] = await database.execute<RowDataPacket[]>(
    `SELECT id FROM student_roster WHERE nisn = ? LIMIT 1`,
    [nisn]
  );
  if (existing.length > 0) {
    throw new AppError("NISN sudah ada di dalam roster.", 409, {
      code: "NISN_EXISTS",
      errors: { nisn: "NISN sudah ada di dalam roster." },
    });
  }

  const [result] = await database.execute<ResultSetHeader>(
    `INSERT INTO student_roster
      (nisn, full_name, class_id, attendance_number, parent_phone, whatsapp_number, address, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      nisn,
      fullName,
      classId ?? null,
      attendanceNumber ?? null,
      parentPhone ?? null,
      whatsappNumber ?? null,
      address ?? null,
    ]
  );

  const [rows] = await database.execute<RowDataPacket[]>(
    `SELECT * FROM student_roster WHERE id = ? LIMIT 1`,
    [result.insertId]
  );
  return rows[0];
}

export async function updateStudentRoster(
  id: number,
  input: Partial<CreateRosterInput> & { isActive?: unknown }
) {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new AppError("ID roster siswa tidak valid.", 400, {
      code: "INVALID_ID",
      errors: { id: "ID harus berupa bilangan bulat positif." },
    });
  }
  if (!Object.values(input).some((value) => value !== undefined)) {
    throw new AppError("Tidak ada perubahan data roster yang dikirim.", 400, {
      code: "VALIDATION_ERROR",
      errors: { _form: "Isi minimal satu data yang akan diperbarui." },
    });
  }

  const [existingRows] = await database.execute<RowDataPacket[]>(
    `SELECT * FROM student_roster WHERE id = ? LIMIT 1`,
    [id]
  );
  if (existingRows.length === 0) {
    throw new AppError("Data roster siswa tidak ditemukan.", 404);
  }
  const current = existingRows[0];

  const errors: Record<string, string> = {};
  const nisn = input.nisn !== undefined
    ? typeof input.nisn === "string"
      ? input.nisn.trim()
      : ""
    : current.nisn;
  const fullName = input.fullName !== undefined
    ? typeof input.fullName === "string"
      ? input.fullName.trim()
      : ""
    : current.full_name;
  if (!NISN_REGEX.test(nisn)) {
    errors.nisn = "NISN wajib berupa 10 digit angka.";
  }
  if (!fullName) {
    errors.full_name = "Nama lengkap siswa wajib diisi.";
  } else if (fullName.length > 150) {
    errors.full_name = "Nama lengkap maksimal 150 karakter.";
  }

  const classId = parseOptionalInteger(
    input.classId,
    "class_id",
    errors,
    1,
    Number.MAX_SAFE_INTEGER
  );
  const attendanceNumber = parseOptionalInteger(
    input.attendanceNumber,
    "attendance_number",
    errors,
    0,
    65535
  );
  const parentPhone = parseOptionalText(
    input.parentPhone,
    "parent_phone",
    errors,
    30
  );
  const whatsappNumber = parseOptionalText(
    input.whatsappNumber,
    "whatsapp_number",
    errors,
    30
  );
  const address = parseOptionalText(input.address, "address", errors, 65535);
  if (
    input.isActive !== undefined &&
    typeof input.isActive !== "boolean" &&
    input.isActive !== 0 &&
    input.isActive !== 1
  ) {
    errors.is_active = "Status aktif harus berupa boolean.";
  }
  if (Object.keys(errors).length > 0) {
    throw new AppError("Validasi data roster gagal.", 400, {
      code: "VALIDATION_ERROR",
      errors,
    });
  }

  if (classId !== undefined) {
    await validateClassId(classId);
  }

  if (nisn !== current.nisn) {
    const [dup] = await database.execute<RowDataPacket[]>(
      `SELECT id FROM student_roster WHERE nisn = ? AND id != ? LIMIT 1`,
      [nisn, id]
    );
    if (dup.length > 0) {
      throw new AppError("NISN sudah dipakai oleh siswa lain di roster.", 409);
    }
  }

  await database.execute(
    `UPDATE student_roster
     SET nisn = ?,
         full_name = ?,
         class_id = ?,
         attendance_number = ?,
         parent_phone = ?,
         whatsapp_number = ?,
         address = ?,
         is_active = ?
     WHERE id = ?`,
    [
      nisn,
      fullName,
      classId !== undefined ? classId : current.class_id,
      attendanceNumber !== undefined
        ? attendanceNumber
        : current.attendance_number,
      parentPhone !== undefined ? parentPhone : current.parent_phone,
      whatsappNumber !== undefined
        ? whatsappNumber
        : current.whatsapp_number,
      address !== undefined ? address : current.address,
      input.isActive !== undefined
        ? Boolean(input.isActive)
          ? 1
          : 0
        : current.is_active,
      id,
    ]
  );

  const [updated] = await database.execute<RowDataPacket[]>(
    `SELECT * FROM student_roster WHERE id = ? LIMIT 1`,
    [id]
  );
  return updated[0];
}

export async function deleteStudentRoster(id: number): Promise<void> {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new AppError("ID roster siswa tidak valid.", 400, {
      code: "INVALID_ID",
      errors: { id: "ID harus berupa bilangan bulat positif." },
    });
  }
  const [existingRows] = await database.execute<RowDataPacket[]>(
    `SELECT id, user_id FROM student_roster WHERE id = ? LIMIT 1`,
    [id]
  );
  if (existingRows.length === 0) {
    throw new AppError("Data roster siswa tidak ditemukan.", 404);
  }

  const userId = existingRows[0].user_id as number | null;
  await database.execute(`DELETE FROM student_roster WHERE id = ?`, [id]);

  // Jika sudah punya akun siswa terkait, hapus/nonaktifkan juga akunnya agar sesinya dicabut
  if (userId) {
    await database.execute(`DELETE FROM users WHERE id = ? AND role = 'siswa'`, [
      userId,
    ]);
  }
}
