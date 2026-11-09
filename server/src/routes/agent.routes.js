import { Router } from "express";
import { runAgentTurn } from "../services/agent.service.js";

const router = Router();

router.post("/chat", async (req, res, next) => {
  // Propagate a browser-side Stop action to the active model request.
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    const { message, assessmentId, challengeId, history = [] } = req.body ?? {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "A message is required." });
    }
    if (message.length > 6000) {
      return res.status(400).json({ error: "Message is too long." });
    }

    const result = await runAgentTurn({
      message: message.trim(),
      assessmentId: assessmentId || null,
      challengeId: challengeId || null,
      history: Array.isArray(history) ? history.slice(-12) : [],
      signal: controller.signal
    });

    if (!controller.signal.aborted) res.json(result);
  } catch (error) {
    if (controller.signal.aborted) return;
    next(error);
  }
});

export default router;
