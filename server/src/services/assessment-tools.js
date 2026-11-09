import { nanoid } from "nanoid";
import { readStore, writeStore } from "./storage.service.js";

export const toolDeclarations = [
  {
    name: "create_assessment",
    description: "Create a new skill assessment for the user. Use when the user has provided enough context to begin: target skill, experience level, and goal.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        learnerName: { type: "string" },
        skill: { type: "string" },
        experienceLevel: { type: "string", enum: ["beginner", "intermediate", "advanced", "unsure"] },
        goal: { type: "string" },
        competencies: { type: "array", items: { type: "string" } }
      },
      required: ["skill", "experienceLevel", "goal", "competencies"]
    }
  },
  {
    name: "issue_challenge",
    description: "Record and issue the next assessment challenge. The challenge should be specific, answerable, and aligned to one competency.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        assessmentId: { type: "string" },
        title: { type: "string" },
        competency: { type: "string" },
        difficulty: { type: "string", enum: ["foundational", "intermediate", "advanced"] },
        prompt: { type: "string" },
        expectedEvidence: { type: "array", items: { type: "string" } }
      },
      required: ["assessmentId", "title", "competency", "difficulty", "prompt", "expectedEvidence"]
    }
  },
  {
    name: "record_answer",
    description: "Save the learner's answer against the active challenge. Use after the learner submits an answer.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        assessmentId: { type: "string" },
        challengeId: { type: "string" },
        answer: { type: "string" }
      },
      required: ["assessmentId", "challengeId", "answer"]
    }
  },
  {
    name: "evaluate_answer",
    description: "Evaluate a recorded answer against the challenge's expected evidence. Give a fair score from 0 to 100 and evidence-based feedback. Do not infer skills not demonstrated.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        assessmentId: { type: "string" },
        challengeId: { type: "string" },
        score: { type: "number" },
        demonstrated: { type: "array", items: { type: "string" } },
        gaps: { type: "array", items: { type: "string" } },
        feedback: { type: "string" },
        followUpNeeded: { type: "boolean" }
      },
      required: ["assessmentId", "challengeId", "score", "demonstrated", "gaps", "feedback", "followUpNeeded"]
    }
  },
  {
    name: "generate_report",
    description: "Generate and save a report after at least two challenges have been evaluated, or when the user explicitly asks to finish early. Summarise evidence, strengths, gaps and practical next steps. Be transparent about limited evidence.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        assessmentId: { type: "string" },
        summary: { type: "string" },
        strengths: { type: "array", items: { type: "string" } },
        skillGaps: { type: "array", items: { type: "string" } },
        recommendations: { type: "array", items: { type: "string" } },
        overallLevel: { type: "string", enum: ["not enough evidence", "beginner", "developing", "competent", "strong"] }
      },
      required: ["assessmentId", "summary", "strengths", "skillGaps", "recommendations", "overallLevel"]
    }
  }
];

export async function executeTool(name, args) {
  const store = await readStore();

  if (name === "create_assessment") {
    const assessment = {
      id: nanoid(10),
      learnerName: args.learnerName || "Learner",
      skill: args.skill,
      experienceLevel: args.experienceLevel,
      goal: args.goal,
      competencies: args.competencies,
      challenges: [],
      createdAt: new Date().toISOString(),
      report: null
    };
    store.assessments.push(assessment);
    await writeStore(store);
    return { success: true, assessmentId: assessment.id, message: "Assessment created." };
  }

  const assessment = store.assessments.find((item) => item.id === args.assessmentId);
  if (!assessment) return { success: false, error: "Assessment not found." };

  if (name === "issue_challenge") {
    const challenge = {
      id: nanoid(8),
      title: args.title,
      competency: args.competency,
      difficulty: args.difficulty,
      prompt: args.prompt,
      expectedEvidence: args.expectedEvidence,
      answer: null,
      evaluation: null
    };
    assessment.challenges.push(challenge);
    await writeStore(store);
    return { success: true, challengeId: challenge.id, challenge };
  }

  if (name === "record_answer") {
    const challenge = assessment.challenges.find((item) => item.id === args.challengeId);
    if (!challenge) return { success: false, error: "Challenge not found." };
    challenge.answer = args.answer;
    await writeStore(store);
    return { success: true, message: "Answer recorded." };
  }

  if (name === "evaluate_answer") {
    const challenge = assessment.challenges.find((item) => item.id === args.challengeId);
    if (!challenge || !challenge.answer) return { success: false, error: "Challenge or answer not found." };
    challenge.evaluation = {
      score: Math.max(0, Math.min(100, Number(args.score))),
      demonstrated: args.demonstrated,
      gaps: args.gaps,
      feedback: args.feedback,
      followUpNeeded: Boolean(args.followUpNeeded),
      evaluatedAt: new Date().toISOString()
    };
    await writeStore(store);
    return { success: true, evaluation: challenge.evaluation };
  }

  if (name === "generate_report") {
    const evaluated = assessment.challenges.filter((item) => item.evaluation);
    if (evaluated.length < 2 && assessment.challenges.length > 0) {
      return { success: false, error: "At least two evaluated challenges are recommended before generating a report. You may finish early if the learner explicitly requests it." };
    }
    assessment.report = {
      summary: args.summary,
      strengths: args.strengths,
      skillGaps: args.skillGaps,
      recommendations: args.recommendations,
      overallLevel: args.overallLevel,
      basedOnChallenges: evaluated.length,
      generatedAt: new Date().toISOString()
    };
    await writeStore(store);
    return { success: true, report: assessment.report };
  }

  return { success: false, error: `Unknown tool: ${name}` };
}
