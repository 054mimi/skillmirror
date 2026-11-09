# SkillMirror MVP

An AI-powered skill assessment agent. The React interface is the communication surface; the backend agent plans assessment actions and invokes tools to create challenges, evaluate evidence, identify gaps, and build an improvement plan.

## Requirements
- Node.js 20+ (Node.js 22+ recommended)
- npm
- A Gemini API key from Google AI Studio

## Setup
1. Open this folder in VS Code.
2. In the project root, run `npm install`.
3. Run `npm install` in `server` and `client`:
   ```bash
   cd server && npm install
   cd ../client && npm install
   ```
4. Copy `server/.env.example` to `server/.env` and add your Gemini API key.
5. From the project root, run `npm run dev`.
6. Open the Vite URL printed in the terminal (normally http://localhost:5173).

## Environment
`GEMINI_API_KEY` must stay in `server/.env`. Never put it in a `VITE_` variable or frontend code.
`GEMINI_MODEL` defaults to `gemini-flash-latest` and can be changed if your AI Studio project exposes a different model.

## Current MVP workflow
- Start an assessment by telling SkillMirror your name, target skill, experience level and goal.
- The agent uses tools to create assessment challenges, record answers, evaluate evidence and produce a report.
- Assessment state is saved locally in `server/data/assessments.json`.

## Important
- This is an MVP, not a certification system. Results describe demonstrated evidence in this assessment only.
- The agent's tool loop is bounded to prevent runaway API calls.
- Local JSON persistence is suitable for a demo, not concurrent production use.
- Gemini's free-tier availability and limits vary by model and account. Check current limits in Google AI Studio.
