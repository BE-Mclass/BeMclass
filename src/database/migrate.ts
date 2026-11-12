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

    console.log("Database migration completed successfully.");
  } finally {
    await connection.end();
  }
}

runMigrations().catch((err) => {
  console.error("Database migration failed:", err);
  process.exit(1);
});
