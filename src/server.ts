import app from "./app";
import { database } from "./config/database";

const port = Number(process.env.PORT ?? 3000);

async function startServer(): Promise<void> {
  try {
    await database.query("SELECT 1");
    console.log("MySQL database connection established.");
    app.listen(port, () => {
      console.log(`Server is listening on port ${port}.`);
    });
  } catch (error) {
    console.error("Failed to connect to the MySQL database:", error);
    process.exitCode = 1;
  }
}

void startServer();
