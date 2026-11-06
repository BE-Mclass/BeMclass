import "dotenv/config";
import { createPool } from "mysql2/promise";

const user = process.env.DB_USER;

if (!user) {
  throw new Error("DB_USER must be set in the environment.");
}

export const database = createPool({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 3306),
  user,
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME ?? "BeMclass",
  waitForConnections: true,
  connectionLimit: 10,
});
