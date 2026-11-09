import { useEffect, useRef, useState } from "react";
import { ArrowUp, Bot, BrainCircuit, ChevronRight, CircleHelp, Code2, Compass, FileText, Gauge, Menu, Plus, Sparkles, Target, UserRound, WandSparkles } from "lucide-react";

const starterMessages = [{
  role: "assistant",
  content: "Hey! I'm SkillMirror, your skill assessment agent. I help you discover what you can actually demonstrate, not just what you claim to know. To get started, what technical skill would you like us to assess?"
}];

export default function App() {
  const [messages, setMessages] = useState(starterMessages);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Checking connection…");
  const [assessmentId, setAssessmentId] = useState(null);
  const [challengeId, setChallengeId] = useState(null);
  const [actions, setActions] = useState([]);
  const endRef = useRef(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((data) => setStatus(data.aiConfigured ? "Agent online" : "API key needed"))
      .catch(() => setStatus("Backend offline"));
  }, []);

  useEffect(() => {
  endRef.current?.scrollIntoView({ behavior: "smooth" });
}, [messages, busy]);

  async function sendMessage(text = input) {
    const clean = text.trim();
    if (!clean || busy) return;

    const nextMessages = [...messages, { role: "user", content: clean }];
    setMessages(nextMessages);
    setInput("");
    setBusy(true);
    setActions([]);

    try {
      const response = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: clean,
          assessmentId,
          challengeId,
          history: messages.slice(-10)
        })
      });

      const responseText = await response.text();
      let data;

      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch {
        throw new Error(
          `Backend returned an invalid response (HTTP ${response.status}).`
        );
      }

      if (!response.ok) {
        throw new Error(
          data.error || `Request failed with status ${response.status}.`
        );
      }

      setMessages((current) => [
        ...current,
        { role: "assistant", content: data.reply }
      ]);
      if (data.assessmentId) setAssessmentId(data.assessmentId);
      if (data.challengeId) setChallengeId(data.challengeId);
      setActions(data.actions || []);
    } catch (error) {
      setMessages((current) => [...current, {
        role: "assistant",
        content: `I couldn't reach my reasoning service: ${error.message} Check that the backend is running and the API key is configured.`
      }]);
    } finally {
      setBusy(false);
    }
  }

  function resetSession() {
    setMessages(starterMessages);
    setAssessmentId(null);
    setChallengeId(null);
    setActions([]);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><BrainCircuit size={21} /></div>
          <div><strong>skillmirror</strong><span>AI SKILL AGENT</span></div>
        </div>
        <button className="new-session" onClick={resetSession}><Plus size={17} /> New assessment</button>
        <div className="side-label">WORKSPACE</div>
        <div className="side-link active"><Compass size={17} /> Assessment agent</div>
        <div className="side-link muted"><Gauge size={17} /> My skill reports <span className="soon">SOON</span></div>
        <div className="side-link muted"><Target size={17} /> Growth roadmap <span className="soon">SOON</span></div>
        <div className="side-bottom">
          <div className="agent-card">
            <div className="agent-card-icon"><Sparkles size={17} /></div>
            <strong>Your potential, made visible.</strong>
            <p>Real challenges. Evidence-based feedback. A clearer path forward.</p>
          </div>
          <div className="profile"><div className="avatar"><UserRound size={17} /></div><div><strong>Guest learner</strong><span>MVP session</span></div><Menu size={17} className="profile-menu" /></div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="crumb"><span>Workspace</span><ChevronRight size={14} /><strong>Assessment agent</strong></div>
          <div className="top-right"><span className={`status-dot ${status === "Agent online" ? "online" : ""}`} />{status}<span className="top-divider" /><span className="model-label">AI AGENT</span></div>
        </header>

        <section className="content">
          <div className="welcome">
            <div className="eyebrow"><span className="eyebrow-line" /> YOUR PERSONAL SKILL ASSESSMENT AGENT</div>
            <h1>See your skills.<br /><em>Prove your potential.</em></h1>
            <p className="welcome-copy">Go beyond self-assessment. Take practical challenges, demonstrate what you know, and uncover what to work on next.</p>
          </div>

          <div className="chat-layout">
            <section className="chat-panel">
              <div className="chat-header">
                <div className="chat-agent-icon"><Bot size={19} /></div>
                <div><strong>SkillMirror Agent</strong><span><i /> Ready to assess</span></div>
                <button className="icon-button" title="Start new session" onClick={resetSession}><Plus size={18} /></button>
              </div>
              <div className="messages">
                {messages.map((message, index) => (
                  <div className={`message-row ${message.role}`} key={index}>
                    {message.role === "assistant" && <div className="message-avatar"><Sparkles size={15} /></div>}
                    <div className="message-bubble">
                      <span className="message-author">{message.role === "assistant" ? "SKILLMIRROR" : "YOU"}</span>
                      <p>{message.content}</p>
                    </div>
                    {message.role === "user" && <div className="user-avatar"><UserRound size={15} /></div>}
                  </div>
                ))}
                {busy && <div className="message-row assistant"><div className="message-avatar"><Sparkles size={15} /></div><div className="typing"><span /><span /><span /> <small>Agent is thinking and choosing its next action</small></div></div>}
                <div ref={endRef} />
              </div>
              {actions.length > 0 && <div className="action-trace"><WandSparkles size={14} /><span>AGENT ACTIONS</span>{actions.map((a, i) => <small key={i}>{a.tool.replaceAll("_", " ")} {a.success ? "✓" : "!"}</small>)}</div>}
              <form className="composer" onSubmit={(e) => { e.preventDefault(); sendMessage(); }}>
                <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} placeholder="Tell the agent what you'd like to assess…" rows={2} disabled={busy} />
                <div className="composer-bottom"><span><CircleHelp size={13} /> Be specific. Your answers help the agent adapt.</span><button type="submit" disabled={!input.trim() || busy}><ArrowUp size={18} /></button></div>
              </form>
              <p className="privacy-note"><FileText size={12} /> Assessment feedback reflects evidence from this session, not a formal certification.</p>
            </section>

            <aside className="right-rail">
              <div className="rail-card">
                <div className="rail-title"><Code2 size={16} /> HOW IT WORKS</div>
                <div className="step"><b>01</b><div><strong>Discover</strong><p>Share your experience and goals.</p></div></div>
                <div className="step"><b>02</b><div><strong>Demonstrate</strong><p>Complete adaptive, practical challenges.</p></div></div>
                <div className="step"><b>03</b><div><strong>Understand</strong><p>Get feedback grounded in your answers.</p></div></div>
                <div className="step"><b>04</b><div><strong>Develop</strong><p>Get a focused improvement plan.</p></div></div>
              </div>
              <div className="rail-note"><div><Sparkles size={15} /> THE SKILLMIRROR PROMISE</div><p>We don't measure what you <em>say</em> you know. We look at what you can <em>show</em>.</p></div>
              <div className="domain-chip"><span /> INITIAL DOMAIN <strong>Software development</strong></div>
            </aside>
          </div>
          <footer>SKILLMIRROR MVP <span>·</span> BUILT TO REVEAL REAL-WORLD POTENTIAL</footer>
        </section>
      </main>
    </div>
  );
}
