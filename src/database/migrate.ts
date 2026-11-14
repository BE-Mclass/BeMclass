import "dotenv/config";
import fs from "fs";
import path from "path";
import { createConnection } from "mysql2/promise";

async function runMigrations(): Promise<void> {
  const host = process.env.DB_HOST ?? "localhost";
  const port = Number(process.env.DB_PORT ?? 3306);
  const user = process.env.DB_USER ?? "root";
  const password = process.env.DB_PASSWORD ?? "";
  const dbName = process.env.DB_NAME ?? "BeMclass";

  const connection = await createConnection({
    host,
    port,
    user,
    password,
    multipleStatements: true,
  });

  try {
    console.log(`Ensuring database '${dbName}' exists...`);
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
    );
    await connection.query(`USE \`${dbName}\`;`);

    const schemaPath = path.join(__dirname, "schema.sql");
    const schemaSql = fs.readFileSync(schemaPath, "utf8");

    console.log("Running database schema migrations...");
    await connection.query(schemaSql);

    // Ensure OAuth columns exist on existing users table (backward-compatible migration)
    const [googleIdCol] = await connection.query<any[]>(
      `SHOW COLUMNS FROM \`users\` LIKE 'google_id';`
    );
    if (Array.isArray(googleIdCol) && googleIdCol.length === 0) {
      await connection.query(
        `ALTER TABLE \`users\`
         ADD COLUMN \`google_id\` VARCHAR(191) NULL UNIQUE COMMENT 'Google OIDC subject identifier (for mobile student OAuth)' AFTER \`password_hash\`,
         ADD COLUMN \`oauth_provider\` ENUM('local', 'google') NOT NULL DEFAULT 'local' AFTER \`google_id\`;`
      );
      console.log("Added google_id and oauth_provider columns to users table.");
    }

    const [userPhoneCol] = await connection.query<any[]>(
      `SHOW COLUMNS FROM \`users\` LIKE 'phone';`
    );
    if (Array.isArray(userPhoneCol) && userPhoneCol.length === 0) {
      await connection.query(
        `ALTER TABLE \`users\`
         ADD COLUMN \`phone\` VARCHAR(30) NULL AFTER \`oauth_provider\`;`
      );
      console.log("Added phone column to users table.");
    }

    // Ensure profile columns exist on existing student_roster table (US-61, FSD §5.10)
    const [genderCol] = await connection.query<any[]>(
      `SHOW COLUMNS FROM \`student_roster\` LIKE 'gender';`
    );
    if (Array.isArray(genderCol) && genderCol.length === 0) {
      await connection.query(
        `ALTER TABLE \`student_roster\`
         ADD COLUMN \`gender\` ENUM('L', 'P') NOT NULL DEFAULT 'L' AFTER \`full_name\`,
         ADD COLUMN \`birth_date\` DATE NULL AFTER \`gender\`;`
      );
      console.log("Added gender and birth_date columns to student_roster table.");
    }

    const [guardianNameCol] = await connection.query<any[]>(
      `SHOW COLUMNS FROM \`student_roster\` LIKE 'guardian_name';`
    );
    if (Array.isArray(guardianNameCol) && guardianNameCol.length === 0) {
      await connection.query(
        `ALTER TABLE \`student_roster\`
         ADD COLUMN \`guardian_name\` VARCHAR(150) NULL AFTER \`attendance_number\`;`
      );
      console.log("Added guardian_name column to student_roster table.");
    }

    // Ensure homeroom_teacher_id FK exists on classes table
    const [homeroomFk] = await connection.query<any[]>(
      `SELECT CONSTRAINT_NAME
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'classes'
         AND COLUMN_NAME = 'homeroom_teacher_id'
         AND REFERENCED_TABLE_NAME = 'users';`
    );
    if (Array.isArray(homeroomFk) && homeroomFk.length === 0) {
      await connection.query(
        `ALTER TABLE \`classes\`
         ADD CONSTRAINT \`fk_classes_homeroom\` FOREIGN KEY (\`homeroom_teacher_id\`) REFERENCES \`users\`(\`id\`) ON DELETE SET NULL;`
      );
      console.log("Added fk_classes_homeroom constraint to classes table.");
    }

    // Ensure calendar columns exist on existing announcements table (backward-compatible migration)
    const [endDateCol] = await connection.query<any[]>(
      `SHOW COLUMNS FROM \`announcements\` LIKE 'end_date';`
    );
    if (Array.isArray(endDateCol) && endDateCol.length === 0) {
      await connection.query(
        `ALTER TABLE \`announcements\`
         ADD COLUMN \`end_date\` DATE NULL AFTER \`publish_date\`;`
      );
      console.log("Added end_date column to announcements table.");
    }

    const [classIdCol] = await connection.query<any[]>(
      `SHOW COLUMNS FROM \`announcements\` LIKE 'class_id';`
    );
    if (Array.isArray(classIdCol) && classIdCol.length === 0) {
      await connection.query(
        `ALTER TABLE \`announcements\`
         ADD COLUMN \`class_id\` BIGINT UNSIGNED NULL AFTER \`target_audience\`,
         ADD CONSTRAINT \`fk_announcements_class\` FOREIGN KEY (\`class_id\`) REFERENCES \`classes\`(\`id\`) ON DELETE SET NULL;`
      );
      console.log("Added class_id column to announcements table.");
    }

    const [deletedAtCol] = await connection.query<any[]>(
      `SHOW COLUMNS FROM \`announcements\` LIKE 'deleted_at';`
    );
    if (Array.isArray(deletedAtCol) && deletedAtCol.length === 0) {
      await connection.query(
        `ALTER TABLE \`announcements\`
         ADD COLUMN \`deleted_at\` DATETIME NULL AFTER \`published_at\`;`
      );
      console.log("Added deleted_at column to announcements table.");
    }

    // Seed default school settings and 7-day attendance schedules if empty
    await connection.query(
      `INSERT IGNORE INTO \`school_settings\` (\`id\`, \`school_name\`, \`latitude\`, \`longitude\`, \`radius_m\`, \`timezone\`)
       VALUES (1, 'MTs Al-Ma''arif', -7.982600, 112.630800, 15, 'Asia/Jakarta');`
    );
    await connection.query(
      `UPDATE \`school_settings\` SET \`radius_m\` = 15 WHERE \`id\` = 1 AND \`radius_m\` > 15;`
    );

    const defaultSchedules = [
      [1, 1, "06:00:00", "07:15:00", "12:00:00"], // Senin
      [2, 1, "06:00:00", "07:15:00", "12:00:00"], // Selasa
      [3, 1, "06:00:00", "07:15:00", "12:00:00"], // Rabu
      [4, 1, "06:00:00", "07:15:00", "12:00:00"], // Kamis
      [5, 1, "06:00:00", "07:15:00", "11:30:00"], // Jumat
      [6, 1, "06:00:00", "07:15:00", "12:00:00"], // Sabtu
      [7, 0, null, null, null],                     // Minggu (Libur)
    ];

    for (const [dayOfWeek, isSchoolDay, checkinOpen, lateAfter, checkinClose] of defaultSchedules) {
      await connection.query(
        `INSERT IGNORE INTO \`attendance_schedules\` (\`day_of_week\`, \`is_school_day\`, \`checkin_open\`, \`late_after\`, \`checkin_close\`)
         VALUES (?, ?, ?, ?, ?);`,
        [dayOfWeek, isSchoolDay, checkinOpen, lateAfter, checkinClose]
      );
    }

    console.log("Database migration completed successfully.");
  } finally {
    await connection.end();
  }
}

runMigrations().catch((err) => {
  console.error("Database migration failed:", err);
  process.exit(1);
});
