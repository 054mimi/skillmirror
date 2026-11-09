
import { toolDeclarations, executeTool } from "./assessment-tools.js";

const SYSTEM_INSTRUCTION = `
You are SkillMirror, an AI skill assessment agent, not merely a general chatbot.
Your mission is to discover and assess a learner's demonstrated skills and knowledge across ANY field or discipline, identify evidence-based strengths and gaps, and recommend practical improvement actions.

SCOPE:
- Do not restrict assessments to software development, technology, or other technical subjects.
- Accept skills and fields from academic, professional, vocational, creative, business, communication, language, scientific, and other legitimate domains.
- Examples include writing, accounting, biology, graphic design, project management, carpentry, public speaking, mathematics, teaching, and programming.
- Assess the specific skill the learner names. Do not redirect them to software development or assume they are a developer.
- Adapt challenge formats to the field: use explanations, scenarios, problem-solving, worked examples, planning tasks, critique, calculations, or practical demonstrations as appropriate.
- Define observable evidence that is relevant to the chosen field before evaluating an answer.
- If a skill requires physical observation, specialist equipment, real-world performance, or information the chat cannot access, explain that limitation and assess only what can fairly be demonstrated in the conversation. Never pretend to have observed practical performance.
- If a request falls outside a field you can assess reliably, be transparent and offer a narrower, assessable aspect rather than inventing expertise.
- Do not provide medical, legal, financial, or other regulated professional certification or diagnosis. You may assess general knowledge in those areas with clear limitations.
- Keep assessment criteria specific to the chosen field; never apply software-development criteria to unrelated subjects.

AGENT BEHAVIOUR:
- Be warm, concise, professional and encouraging. Never shame the learner.
- Guide the user through onboarding, assessment, evaluation and reporting. Use an optional learner goal to personalise the assessment, but never make it a condition for proceeding.
- Ask only for missing information. Before creating an assessment, obtain the target skill and experience level. The learner's goal is optional.
- Once enough information exists, call create_assessment. Then issue one challenge at a time using issue_challenge.
- Each challenge must test a clear competency and include observable expected evidence. Avoid trivia-only assessments.
- When a learner answers a challenge, record the learner's actual answer and evaluate it against the challenge's expected evidence. Explain the evaluation with specific evidence.
- IMPORTANT: A learner asking for help, a hint, clarification, an example, or an explanation is NOT submitting an assessment answer. Do NOT call record_answer or evaluate_answer for help requests. Switch into teaching mode, give a small progressive hint first, explain the relevant concept in plain language, and invite the learner to try the challenge again. If they explicitly ask for the full solution, show it and explain why it works, then offer a fresh similar practice question rather than pretending the revealed solution is independent assessment evidence.
- If an answer is very short or ambiguous (for example, "no error"), do not invent reasoning the learner did not provide. Ask one focused follow-up or use a gentle hint to uncover their understanding. Distinguish a syntax/runtime error from a logical or behavioural bug.
- Never interpret greetings, confusion, requests for help, or provider-error messages as challenge answers.
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

// Some Groq models return camelCase function names even though the
// registered tools use snake_case. Normalize them before sending the
// assistant tool-call message back to Groq or executing the tool.
const TOOL_NAME_ALIASES = {
  createAssessment: "create_assessment",
  issueChallenge: "issue_challenge",
  recordAnswer: "record_answer",
  evaluateAnswer: "evaluate_answer",
  generateReport: "generate_report"
};

function normalizeToolName(name) {
  return TOOL_NAME_ALIASES[name] || name;
}

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

async function createCompletion(messages, allowTools = true, signal) {
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
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
        : AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    if (signal?.aborted) throw error;

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
    const providerMessage = data.error?.message || `Groq API request failed (${response.status}).`;
    const error = new Error(response.status === 429
      ? "SkillMirror's AI service is temporarily rate-limited. Your conversation is still saved. Please wait a short while and send your message again."
      : providerMessage);
    error.status = response.status;
    error.retryAfter = response.headers.get("retry-after");
    error.isRateLimit = response.status === 429;
    throw error;
  }

  return data;
}

export async function runAgentTurn({
  message,
  assessmentId,
  challengeId,
  history = [],
  signal
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
  const challengeIdAtTurnStart = challengeId;
  let answerRecordedThisTurn = false;
  let finalMessage = null;

  // Preserve successful tool state if a later reasoning request is rate-limited.
  try {
  for (let step = 0; step < MAX_TOOL_ROUNDS; step += 1) {
    const data = await createCompletion(messages, true, signal);
    const assistantMessage = data.choices?.[0]?.message;

    if (!assistantMessage) {
      throw new Error("Groq returned an empty response.");
    }

    const calls = assistantMessage.tool_calls || [];

    if (calls.length === 0) {
      finalMessage = assistantMessage.content;
      break;
    }

    // Keep tool-call names identical to the registered declarations.
    // This also prevents Groq from rejecting the next request because
    // a prior assistant message referenced an undeclared camelCase name.
    const normalizedAssistantMessage = {
      ...assistantMessage,
      tool_calls: calls.map((call) => ({
        ...call,
        function: {
          ...call.function,
          name: normalizeToolName(call.function?.name)
        }
      }))
    };
    messages.push(normalizedAssistantMessage);

    for (const call of normalizedAssistantMessage.tool_calls) {
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

        // A challenge issued during this same turn cannot be answered
        // until the learner has received it and sent a separate message.
        if (
          (name === "record_answer" || name === "evaluate_answer") &&
          !challengeIdAtTurnStart
        ) {
          throw new Error(
            "Wait for the learner to receive the challenge and submit an answer before recording or evaluating it."
          );
        }

        // Always store the learner's actual current message as the answer.
        // Never trust answer text invented or paraphrased by the model.
        if (name === "record_answer") {
          const controlMessage = message.trim().toLowerCase();
          const isControlMessage = /^(skip|pause|stop|quit|finish|finish early|new assessment|start over|cancel)$/i.test(controlMessage);

          if (isControlMessage || !message.trim()) {
            throw new Error("The learner has not submitted an answer to the active challenge.");
          }

          args.answer = message.trim();
        }

        if (name === "evaluate_answer" && !answerRecordedThisTurn) {
          throw new Error(
            "An answer must be successfully recorded during this turn before it can be evaluated."
          );
        }

        const result = await executeTool(name, args);

        if (name === "record_answer" && result.success) {
          answerRecordedThisTurn = true;
        }

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
    const finalData = await createCompletion(messages, false, signal);
    finalMessage = finalData.choices?.[0]?.message?.content;
  }
  } catch (error) {
    if (!error.isRateLimit) throw error;
    finalMessage = error.message;
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
