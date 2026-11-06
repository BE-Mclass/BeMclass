import { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { database } from "../config/database";
import { AppError } from "../utils/errors";

const NISN_REGEX = /^\d{10}$/;

export interface CreateRosterInput {
  nisn: string;
  fullName: string;
  classId?: number | null;
  attendanceNumber?: number | null;
  parentPhone?: string | null;
  whatsappNumber?: string | null;
  address?: string | null;
}

export async function listStudentRoster(filters?: {
  classId?: number;
  search?: string;
}) {
  let sql = `
    SELECT
      sr.id, sr.nisn, sr.full_name, sr.class_id,
      c.name AS class_name, c.grade_level,
      sr.attendance_number, sr.parent_phone, sr.whatsapp_number, sr.address,
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
  const nisn = (input.nisn ?? "").trim();
  const fullName = (input.fullName ?? "").trim();

  const errors: Record<string, string> = {};
  if (!nisn || !NISN_REGEX.test(nisn)) {
    errors.nisn = "NISN wajib berupa 10 digit angka.";
  }
  if (!fullName) {
    errors.full_name = "Nama lengkap siswa wajib diisi.";
  }

  if (Object.keys(errors).length > 0) {
    throw new AppError("Validasi data roster gagal.", 400, {
      code: "VALIDATION_ERROR",
      errors,
    });
  }

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
      input.classId ?? null,
      input.attendanceNumber ?? null,
      input.parentPhone ?? null,
      input.whatsappNumber ?? null,
      input.address ?? null,
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
  input: Partial<CreateRosterInput> & { isActive?: boolean }
) {
  const [existingRows] = await database.execute<RowDataPacket[]>(
    `SELECT * FROM student_roster WHERE id = ? LIMIT 1`,
    [id]
  );
  if (existingRows.length === 0) {
    throw new AppError("Data roster siswa tidak ditemukan.", 404);
  }
  const current = existingRows[0];

  const nisn = input.nisn !== undefined ? input.nisn.trim() : current.nisn;
  const fullName =
    input.fullName !== undefined ? input.fullName.trim() : current.full_name;

  if (!NISN_REGEX.test(nisn)) {
    throw new AppError("NISN wajib berupa 10 digit angka.", 400, {
      errors: { nisn: "NISN wajib berupa 10 digit angka." },
    });
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
      input.classId !== undefined ? input.classId : current.class_id,
      input.attendanceNumber !== undefined
        ? input.attendanceNumber
        : current.attendance_number,
      input.parentPhone !== undefined ? input.parentPhone : current.parent_phone,
      input.whatsappNumber !== undefined
        ? input.whatsappNumber
        : current.whatsapp_number,
      input.address !== undefined ? input.address : current.address,
      input.isActive !== undefined
        ? input.isActive
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
