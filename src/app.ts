import cors from "cors";
import express from "express";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware";
import authRouter from "./routes/auth.routes";
import rosterRouter from "./routes/roster.routes";

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "M-Class Backend API is running.",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/auth", authRouter);
app.use("/api/roster", rosterRouter);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
