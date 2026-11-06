import "dotenv/config";
import { database } from "../config/database";
import { hashPassword } from "../utils/password";

/**
 * Helper CLI untuk Operator (PRD US-04 AC3):
 * - Membuat hash Argon2id:
 *   npm run cli:user -- hash <password>
 * - Menambah/update akun admin atau guru langsung ke database:
 *   npm run cli:user -- upsert <role:admin|guru> "<nama>" <email> <password>
 * - Menonaktifkan akun (otomatis menolak semua sesi aktif):
 *   npm run cli:user -- deactivate <email>
 */
async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;

  if (command === "hash") {
    const plain = args[0];
    if (!plain) {
      console.error("Gunakan: npm run cli:user -- hash <password>");
      process.exit(1);
    }
    const hashed = await hashPassword(plain);
    console.log("Argon2id Hash:");
    console.log(hashed);
    process.exit(0);
  }

  if (command === "upsert") {
    const [role, name, email, password] = args;
    if (!role || !["admin", "guru"].includes(role) || !name || !email || !password) {
      console.error(
        'Gunakan: npm run cli:user -- upsert <admin|guru> "<Nama>" <email> <password>'
      );
      process.exit(1);
    }

    const passwordHash = await hashPassword(password);
    await database.execute(
      `INSERT INTO users (name, email, password_hash, role, is_active)
       VALUES (?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         password_hash = VALUES(password_hash),
         role = VALUES(role),
         is_active = 1`,
      [name.trim(), email.trim().toLowerCase(), passwordHash, role]
    );
    console.log(`Akun ${role} (${email}) berhasil disimpan/diperbarui.`);
    await database.end();
    process.exit(0);
  }

  if (command === "deactivate") {
    const [email] = args;
    if (!email) {
      console.error("Gunakan: npm run cli:user -- deactivate <email>");
      process.exit(1);
    }

    await database.execute(
      `UPDATE users SET is_active = 0 WHERE LOWER(email) = ?`,
      [email.trim().toLowerCase()]
    );
    console.log(`Akun ${email} berhasil dinonaktifkan.`);
    await database.end();
    process.exit(0);
  }

  console.log("Perintah yang tersedia:");
  console.log("  npm run cli:user -- hash <password>");
  console.log('  npm run cli:user -- upsert <admin|guru> "<Nama>" <email> <password>');
  console.log("  npm run cli:user -- deactivate <email>");
  await database.end();
}

main().catch((err) => {
  console.error("Error CLI:", err);
  process.exit(1);
});
