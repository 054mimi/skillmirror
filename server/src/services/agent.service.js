import { GoogleGenAI } from "@google/genai";
import { toolDeclarations, executeTool } from "./assessment-tools.js";

const SYSTEM_INSTRUCTION = `
You are SkillMirror, an AI skill assessment agent, not merely a general chatbot.
Your mission is to discover and assess demonstrated software-development competencies, identify evidence-based skill gaps, and recommend practical improvement actions.

AGENT BEHAVIOUR:
- Be warm, concise, professional and encouraging. Never shame the learner.
- Work toward a concrete goal. Guide the user through onboarding, assessment, evaluation and reporting.
- Ask only for missing information. Before creating an assessment, obtain target skill, experience level and goal.
- Once enough information exists, call create_assessment. Then issue one challenge at a time using issue_challenge.
- Each challenge must test a clear competency and include observable expected evidence. Avoid trivia-only assessments.
- When a learner answers, record the answer, evaluate it using the challenge's expected evidence, and explain the evaluation. Use record_answer followed by evaluate_answer.
- Adapt subsequent challenge difficulty and focus based on previous evidence. If a gap appears, probe it with a focused follow-up challenge.
- Do not reveal expected answers before the learner attempts a challenge.
- After at least two evaluated challenges, offer to generate a report. If the learner asks to finish early, generate a report while clearly noting limited evidence.
- Only claim a tool action happened after the tool returns success.
- Never fabricate scores, completed challenges, credentials or evidence.
- Scores are estimates of performance in this assessment, not formal certification.
- Do not execute user-provided code. Evaluate code by inspection and reasoning only.
- Keep each turn focused. Usually ask one question or present one challenge at a time.
`;

function getAI() {
  if (!process.env.GEMINI_API_KEY) {
    const error = new Error("Gemini API key is missing. Add GEMINI_API_KEY to server/.env.");
    error.status = 503;
    throw error;
  }
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

export async function runAgentTurn({ message, assessmentId, challengeId, history }) {
  const ai = getAI();
  const contents = [
    ...((assessmentId || challengeId) ? [{ role: "user", parts: [{ text: `[System context for this turn: active assessment ID=${assessmentId || "none"}; active challenge ID=${challengeId || "none"}. Use these IDs when calling tools for the current assessment/challenge. If a tool requires an ID, pass the exact active ID.]` }] }] : []),
    ...history.map((item) => ({
      role: item.role === "assistant" ? "model" : "user",
      parts: [{ text: String(item.content || "").slice(0, 5000) }]
    })),
    { role: "user", parts: [{ text: message }] }
  ];

  let response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || "gemini-flash-latest",
    contents,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      tools: [{ functionDeclarations: toolDeclarations }]
    }
  });

  const actions = [];
  let activeAssessmentId = assessmentId;
  let activeChallengeId = challengeId;
  // Bounded tool loop: the model may call tools, but cannot run indefinitely.
  for (let step = 0; step < 5; step += 1) {
    const calls = response.functionCalls || [];
    if (!calls.length) break;

    const functionResponses = [];
    for (const call of calls) {
      const args = { ...(call.args || {}) };
      if (args.assessmentId === "current" && activeAssessmentId) args.assessmentId = activeAssessmentId;
      if (args.challengeId === "current" && activeChallengeId) args.challengeId = activeChallengeId;
      const result = await executeTool(call.name, args);
      if (result.assessmentId) activeAssessmentId = result.assessmentId;
      if (result.challengeId) activeChallengeId = result.challengeId;
      if (args.assessmentId && args.assessmentId !== "current") activeAssessmentId = args.assessmentId;
      if (args.challengeId && args.challengeId !== "current") activeChallengeId = args.challengeId;
      actions.push({ tool: call.name, success: Boolean(result.success) });
      functionResponses.push({
        name: call.name,
        response: result
      });
    }

    contents.push(response.candidates?.[0]?.content || {
      role: "model",
      parts: calls.map((call) => ({ functionCall: call }))
    });
    contents.push({
      role: "user",
      parts: functionResponses.map((item) => ({
        functionResponse: { name: item.name, response: item.response }
      }))
    });

    response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-flash-latest",
      contents,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        tools: [{ functionDeclarations: toolDeclarations }]
      }
    });
  }

  const text = response.text?.trim() || "I completed that step. What would you like to do next?";
  return { reply: text, actions, assessmentId: activeAssessmentId, challengeId: activeChallengeId };
}
