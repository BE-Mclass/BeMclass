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
    `INSERT INTO users (name, email, password_hash, phone, role, is_active)
     VALUES (?, ?, ?, ?, 'guru', 1)
     ON DUPLICATE KEY UPDATE name = VALUES(name), phone = VALUES(phone), role = 'guru', is_active = 1`,
    ["Bu Rina", "rina.guru@mclass.sch.id", defaultPasswordHash, "081234560001"]
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
      gender: "L",
      birthDate: "2012-05-14",
      classId: class8AId,
      attendanceNumber: 1,
      guardianName: "H. Agus Pratama",
      parentPhone: "081234567801",
      whatsappNumber: "081298765401",
      address: "Jl. Soekarno Hatta No. 12, Malang",
    },
    {
      nisn: "0012345679",
      fullName: "Siti Aminah",
      gender: "P",
      birthDate: "2012-08-21",
      classId: class8AId,
      attendanceNumber: 2,
      guardianName: "Hj. Nurhayati",
      parentPhone: "081234567802",
      whatsappNumber: "081298765402",
      address: "Jl. Veteran No. 45, Malang",
    },
    {
      nisn: "0012345680",
      fullName: "Budi Santoso",
      gender: "L",
      birthDate: "2012-03-05",
      classId: class8AId,
      attendanceNumber: 3,
      guardianName: "H. Budi Santoso Sr.",
      parentPhone: "081234567803",
      whatsappNumber: "081298765403",
      address: "Jl. Ijen Besar No. 8, Malang",
    },
  ];

  for (const student of rosterStudents) {
    await database.execute<ResultSetHeader>(
      `INSERT INTO student_roster
         (nisn, full_name, gender, birth_date, class_id, attendance_number, guardian_name, parent_phone, whatsapp_number, address, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         full_name = VALUES(full_name),
         gender = VALUES(gender),
         birth_date = VALUES(birth_date),
         class_id = VALUES(class_id),
         attendance_number = VALUES(attendance_number),
         guardian_name = VALUES(guardian_name),
         parent_phone = VALUES(parent_phone)`,
      [
        student.nisn,
        student.fullName,
        student.gender,
        student.birthDate,
        student.classId,
        student.attendanceNumber,
        student.guardianName,
        student.parentPhone,
        student.whatsappNumber,
        student.address,
      ]
    );
  }

  // 5. Seed Default School Settings & 7-Day Attendance Schedules
  await database.execute(
    `INSERT INTO school_settings (id, school_name, latitude, longitude, radius_m, timezone)
     VALUES (1, 'MTs Al-Ma''arif', -7.982600, 112.630800, 15, 'Asia/Jakarta')
     ON DUPLICATE KEY UPDATE radius_m = LEAST(radius_m, 15)`
  );

  const schedules = [
    [1, 1, "06:00:00", "07:15:00", "12:00:00"], // Senin
    [2, 1, "06:00:00", "07:15:00", "12:00:00"], // Selasa
    [3, 1, "06:00:00", "07:15:00", "12:00:00"], // Rabu
    [4, 1, "06:00:00", "07:15:00", "12:00:00"], // Kamis
    [5, 1, "06:00:00", "07:15:00", "11:30:00"], // Jumat
    [6, 1, "06:00:00", "07:15:00", "12:00:00"], // Sabtu
    [7, 0, null, null, null],                     // Minggu (Libur)
  ];

  for (const [dayOfWeek, isSchoolDay, checkinOpen, lateAfter, checkinClose] of schedules) {
    await database.execute(
      `INSERT INTO attendance_schedules (day_of_week, is_school_day, checkin_open, late_after, checkin_close)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         is_school_day = VALUES(is_school_day),
         checkin_open = VALUES(checkin_open),
         late_after = VALUES(late_after),
         checkin_close = VALUES(checkin_close)`,
      [dayOfWeek, isSchoolDay, checkinOpen, lateAfter, checkinClose]
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
