import "dotenv/config";
import express from "express";
import cors from "cors";
import agentRoutes from "./src/routes/agent.routes.js";
import { ensureDataFile } from "./src/services/storage.service.js";

const app = express();
const PORT = process.env.PORT || 5000;

await ensureDataFile();

app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:5173" }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "SkillMirror API",
    aiConfigured: Boolean(process.env.GROQ_API_KEY)
  });
});

app.use("/api/agent", agentRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

app.listen(PORT, () => {
  console.log(`SkillMirror API running at http://localhost:${PORT}`);
});
