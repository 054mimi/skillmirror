
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
- Adapt subsequent challenge difficulty and focus based on previous evidence.
- Do not reveal expected answers before the learner attempts a challenge.
- After at least two evaluated challenges, offer to generate a report. If the learner asks to finish early, generate a report while clearly noting limited evidence.
- Only claim a tool action happened after the tool returns success.
- Never fabricate scores, completed challenges, credentials or evidence.
- Scores are estimates of performance in this assessment, not formal certification.
- Do not execute user-provided code. Evaluate code by inspection and reasoning only.
- Keep each turn focused. Usually ask one question or present one challenge at a time.
- Ask only for information necessary to conduct a meaningful assessment.
- Obtain the target skill and experience level before creating an assessment.
- The learner's goal or reason for assessment is OPTIONAL.
- If the learner provides a goal, use it to personalise the assessment.
- If the learner declines to provide a goal, acknowledge their choice and proceed without it.
- Never ask again for information the learner has explicitly declined to provide.
- Let the learner pause, redirect or change the conversation within the product's scope.
- The learner controls their assessment experience. Guide them; do not pressure or command them.
- Respect user instructions unless they conflict with safety requirements or the product's legitimate boundaries.
`;

const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
const API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MAX_TOOL_ROUNDS = 5;
const REQUEST_TIMEOUT_MS = 45000;

function getGroqKey() {
  const key = process.env.GROQ_API_KEY;

  if (!key) {
    const error = new Error(
      "Groq API key is missing. Add GROQ_API_KEY to server/.env."
    );
    error.status = 503;
    throw error;
  }

  return key;
}

// Convert the existing assessment tool declarations into
// the OpenAI-compatible format expected by Groq.
const groqTools = toolDeclarations.map((tool) => ({
  type: "function",
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.parametersJsonSchema
  }
}));

async function createCompletion(messages, allowTools = true) {
  const payload = {
    model: MODEL,
    messages,
    max_completion_tokens: 2048
  };

  if (allowTools) {
    payload.tools = groqTools;
    payload.tool_choice = "auto";
    payload.parallel_tool_calls = false;
  }

  let response;

  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getGroqKey()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      const timeoutError = new Error(
        "Groq took too long to respond. Please try again."
      );
      timeoutError.status = 504;
      throw timeoutError;
    }

    throw error;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      data.error?.message || `Groq API request failed (${response.status}).`;

    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return data;
}

export async function runAgentTurn({
  message,
  assessmentId,
  challengeId,
  history = []
}) {
  const activeContext =
    assessmentId || challengeId
      ? `\n\nACTIVE SESSION CONTEXT:
Assessment ID: ${assessmentId || "none"}
Challenge ID: ${challengeId || "none"}
Use these exact IDs when calling tools for the active assessment or challenge.`
      : "";

  const messages = [
    {
      role: "system",
      content: SYSTEM_INSTRUCTION + activeContext
    },
    ...history.map((item) => ({
      role: item.role === "assistant" ? "assistant" : "user",
      content: String(item.content || "").slice(0, 5000)
    })),
    {
      role: "user",
      content: message
    }
  ];

  const actions = [];
  let activeAssessmentId = assessmentId;
  let activeChallengeId = challengeId;
  let finalMessage = null;

  // Run a bounded tool-calling loop.
  for (let step = 0; step < MAX_TOOL_ROUNDS; step += 1) {
    const data = await createCompletion(messages);
    const assistantMessage = data.choices?.[0]?.message;

    if (!assistantMessage) {
      throw new Error("Groq returned an empty response.");
    }

    const calls = assistantMessage.tool_calls || [];

    if (calls.length === 0) {
      finalMessage = assistantMessage.content;
      break;
    }

    // Preserve the assistant's original tool-call message.
    messages.push(assistantMessage);

    for (const call of calls) {
      const name = call.function?.name;
      let args = {};

      try {
        args = JSON.parse(call.function?.arguments || "{}");

        if (
          args.assessmentId === "current" &&
          activeAssessmentId
        ) {
          args.assessmentId = activeAssessmentId;
        }

        if (
          args.challengeId === "current" &&
          activeChallengeId
        ) {
          args.challengeId = activeChallengeId;
        }

        const result = await executeTool(name, args);

        if (result.assessmentId) {
          activeAssessmentId = result.assessmentId;
        }

        if (result.challengeId) {
          activeChallengeId = result.challengeId;
        }

        if (args.assessmentId && args.assessmentId !== "current") {
          activeAssessmentId = args.assessmentId;
        }

        if (args.challengeId && args.challengeId !== "current") {
          activeChallengeId = args.challengeId;
        }

        actions.push({
          tool: name,
          success: Boolean(result.success)
        });

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result)
        });
      } catch (error) {
        actions.push({
          tool: name || "unknown",
          success: false
        });

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            success: false,
            error: error.message || "Tool execution failed."
          })
        });
      }
    }
  }

  // If the tool-call limit was reached, request a final response
  // without allowing the model to start another tool cycle.
  if (finalMessage === null) {
    const finalData = await createCompletion(messages, false);
    finalMessage = finalData.choices?.[0]?.message?.content;
  }

  return {
    reply:
      typeof finalMessage === "string" && finalMessage.trim()
        ? finalMessage.trim()
        : "I've completed the available steps. What would you like to do next?",
    actions,
    assessmentId: activeAssessmentId,
    challengeId: activeChallengeId
  };
}
