import "dotenv/config";
import { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { database } from "../config/database";
import { hashPassword } from "../utils/password";

async function seedDatabase(): Promise<void> {
  console.log("Seeding initial data for M-Class...");

  const defaultPasswordHash = await hashPassword("Password123");

  // 1. Seed Admin ("Pak Hendra, pengelola sekolah" - Persona 2.1 PRD)
  await database.execute(
    `INSERT INTO users (name, email, password_hash, role, is_active)
     VALUES (?, ?, ?, 'admin', 1)
     ON DUPLICATE KEY UPDATE name = VALUES(name), role = 'admin', is_active = 1`,
    ["Pak Hendra", "admin@mclass.sch.id", defaultPasswordHash]
  );

  // 2. Seed Guru ("Bu Rina, Wali Kelas" - Persona 2.2 PRD)
  await database.execute(
    `INSERT INTO users (name, email, password_hash, role, is_active)
     VALUES (?, ?, ?, 'guru', 1)
     ON DUPLICATE KEY UPDATE name = VALUES(name), role = 'guru', is_active = 1`,
    ["Bu Rina", "rina.guru@mclass.sch.id", defaultPasswordHash]
  );

  const [guruRows] = await database.execute<RowDataPacket[]>(
    `SELECT id FROM users WHERE email = ? LIMIT 1`,
    ["rina.guru@mclass.sch.id"]
  );
  const guruId = (guruRows[0]?.id as number | undefined) ?? null;

  // 3. Seed Classes (7A, 8A, 9A)
  const classesToSeed = [
    { name: "7A", grade: 7 },
    { name: "8A", grade: 8 },
    { name: "9A", grade: 9 },
  ];

  for (const cls of classesToSeed) {
    await database.execute(
      `INSERT INTO classes (name, grade_level, homeroom_teacher_id)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE grade_level = VALUES(grade_level), homeroom_teacher_id = VALUES(homeroom_teacher_id)`,
      [cls.name, cls.grade, guruId]
    );
  }

  const [class8Rows] = await database.execute<RowDataPacket[]>(
    `SELECT id FROM classes WHERE name = '8A' LIMIT 1`
  );
  const class8AId = (class8Rows[0]?.id as number | undefined) ?? null;

  // 4. Seed Student Roster ("Dimas, kelas 8" - Persona 2.3 PRD + beberapa NISN roster untuk tes register)
  const rosterStudents = [
    {
      nisn: "0012345678",
      fullName: "Dimas Pratama",
      classId: class8AId,
      attendanceNumber: 1,
      parentPhone: "081234567801",
    },
    {
      nisn: "0012345679",
      fullName: "Siti Aminah",
      classId: class8AId,
      attendanceNumber: 2,
      parentPhone: "081234567802",
    },
    {
      nisn: "0012345680",
      fullName: "Budi Santoso",
      classId: class8AId,
      attendanceNumber: 3,
      parentPhone: "081234567803",
    },
  ];

  for (const student of rosterStudents) {
    await database.execute<ResultSetHeader>(
      `INSERT INTO student_roster (nisn, full_name, class_id, attendance_number, parent_phone, is_active)
       VALUES (?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         full_name = VALUES(full_name),
         class_id = VALUES(class_id),
         attendance_number = VALUES(attendance_number)`,
      [
        student.nisn,
        student.fullName,
        student.classId,
        student.attendanceNumber,
        student.parentPhone,
      ]
    );
  }

  console.log("==========================================");
  console.log("Seeding selesai! Akun siap digunakan:");
  console.log("1. [ADMIN WEB] Email: admin@mclass.sch.id     | Sandi: Password123");
  console.log("2. [GURU WEB]  Email: rina.guru@mclass.sch.id | Sandi: Password123");
  console.log("3. [ROSTER SISWA MOBILE - Siap Diregistrasi]:");
  console.log("   - NISN: 0012345678 (Dimas Pratama - Kelas 8A)");
  console.log("   - NISN: 0012345679 (Siti Aminah   - Kelas 8A)");
  console.log("   - NISN: 0012345680 (Budi Santoso  - Kelas 8A)");
  console.log("==========================================");

  await database.end();
}

seedDatabase().catch((err) => {
  console.error("Failed to seed database:", err);
  process.exit(1);
});
