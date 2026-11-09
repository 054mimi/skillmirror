import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Bot, BrainCircuit, ChevronRight, CircleHelp, FileText, Menu, Plus, Search, Sparkles, Square, Trash2, UserRound, WandSparkles, Pencil, Paperclip, X } from "lucide-react";

const STORAGE_KEY = "skillmirror.conversations.v1";

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return `conversation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
const starterMessages = [{
  role: "assistant",
  content: "Hey! I'm SkillMirror, your skill assessment agent. I help you discover what you can actually demonstrate, not just what you claim to know. To get started, what technical skill would you like us to assess?"
}];

function createConversation() {
  return {
    id: createId(),
    title: "New assessment",
    messages: starterMessages,
    assessmentId: null,
    challengeId: null,
    actions: [],
    updatedAt: new Date().toISOString()
  };
}

function makeTitle(message) {
  const clean = message.replace(/\s+/g, " ").trim();
  return clean.length > 34 ? clean.slice(0, 34).trimEnd() + "…" : clean;
}

function loadConversations() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (Array.isArray(saved) && saved.length) return saved;
  } catch {
    // Ignore malformed local history and start with a clean workspace.
  }
  return [createConversation()];
}

export default function App() {
  const [conversations, setConversations] = useState(loadConversations);
  const [activeConversationId, setActiveConversationId] = useState(() => conversations[0]?.id);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Checking connection…");
  const [searchTerm, setSearchTerm] = useState("");\n  const [selectedFiles, setSelectedFiles] = useState([]);\n  const fileInputRef = useRef(null);
  const abortControllerRef = useRef(null);
  const endRef = useRef(null);

  const activeConversation = conversations.find((item) => item.id === activeConversationId) || conversations[0];
  const messages = activeConversation?.messages || starterMessages;
  const actions = activeConversation?.actions || [];

  const visibleConversations = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return [...conversations]
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .filter((item) => !query || item.title.toLowerCase().includes(query));
  }, [conversations, searchTerm]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  }, [conversations]);

  useEffect(() => {
    fetch("/api/health")
      .then((response) => response.json())
      .then((data) => setStatus(data.aiConfigured ? "Agent online" : "API key needed"))
      .catch(() => setStatus("Backend offline"));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  function updateConversation(id, updater) {
    setConversations((current) => current.map((item) =>
      item.id === id ? { ...updater(item), updatedAt: new Date().toISOString() } : item
    ));
  }

  function startNewConversation() {
    // Stop an in-flight response before switching conversations.
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setBusy(false);
    const fresh = createConversation();
    setConversations((current) => [fresh, ...current]);
    setActiveConversationId(fresh.id);
    setInput("");
  }

  function selectConversation(id) {
    if (id === activeConversationId) return;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setBusy(false);
    setActiveConversationId(id);
    setInput("");
  }

  function renameConversation(conversation) {
    const title = window.prompt("Rename this conversation", conversation.title);
    if (title?.trim()) {
      updateConversation(conversation.id, (item) => ({ ...item, title: title.trim().slice(0, 60) }));
    }
  }

  function deleteConversation(id) {
    const remaining = conversations.filter((item) => item.id !== id);
    if (!remaining.length) {
      const fresh = createConversation();
      setConversations([fresh]);
      setActiveConversationId(fresh.id);
      return;
    }
    if (id === activeConversationId) setActiveConversationId(remaining[0].id);
    setConversations(remaining);
  }

  async function sendMessage(text = input) {
    const clean = text.trim();
    if (!clean || busy || !activeConversation) return;

    const conversationId = activeConversation.id;
    const previous = activeConversation;
    updateConversation(conversationId, (item) => ({
      ...item,
      title: item.title === "New assessment" ? makeTitle(clean) : item.title,
      messages: [...item.messages, { role: "user", content: clean }],
      actions: []
    }));
    setInput("");
    setBusy(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          message: clean,
          assessmentId: previous.assessmentId,
          challengeId: previous.challengeId,
          history: previous.messages.slice(-10)
        })
      });

      const responseText = await response.text();
      let data;
      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch {
        throw new Error("Backend returned an invalid response (HTTP " + response.status + ").");
      }
      if (!response.ok) throw new Error(data.error || "Request failed with status " + response.status + ".");

      updateConversation(conversationId, (item) => ({
        ...item,
        messages: [...item.messages, { role: "assistant", content: data.reply }],
        assessmentId: data.assessmentId || item.assessmentId,
        challengeId: data.challengeId || item.challengeId,
        actions: data.actions || []
      }));
    } catch (error) {
      if (error.name === "AbortError") {
        updateConversation(conversationId, (item) => ({
          ...item,
          messages: [...item.messages, {
            role: "assistant",
            content: "Response stopped. Your conversation is saved — you can continue whenever you're ready."
          }]
        }));
      } else {
        updateConversation(conversationId, (item) => ({
          ...item,
          messages: [...item.messages, {
            role: "assistant",
            content: "I couldn't reach my reasoning service: " + error.message + " Check that the backend is running and the API key is configured."
          }]
        }));
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><BrainCircuit size={21} /></div>
          <div><strong>skillmirror</strong><span>AI SKILL AGENT</span></div>
        </div>
        <button className="new-session" onClick={startNewConversation}><Plus size={17} /> New chat</button>

        <div className="history-heading">
          <span className="side-label">YOUR CONVERSATIONS</span>
          <div className="history-search">
            <Search size={14} />
            <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search chats" aria-label="Search conversations" />
          </div>
        </div>
        <div className="conversation-list">
          {visibleConversations.map((conversation) => (
            <div className={"conversation-item " + (conversation.id === activeConversationId ? "selected" : "")} key={conversation.id}>
              <button className="conversation-select" onClick={() => selectConversation(conversation.id)} title={conversation.title}>
                <span className="conversation-title">{conversation.title}</span>
                <span className="conversation-date">{new Date(conversation.updatedAt).toLocaleDateString()}</span>
              </button>
              <div className="conversation-actions">
                <button title="Rename conversation" onClick={() => renameConversation(conversation)}><Pencil size={12} /></button>
                <button title="Delete conversation" onClick={() => deleteConversation(conversation.id)}><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
          {visibleConversations.length === 0 && <p className="empty-history">No matching conversations.</p>}
        </div>

        <div className="side-bottom">
          <div className="agent-card">
            <div className="agent-card-icon"><Sparkles size={17} /></div>
            <strong>Your potential, made visible.</strong>
            <p>Real challenges. Evidence-based feedback. A clearer path forward.</p>
          </div>
          <div className="profile"><div className="avatar"><UserRound size={17} /></div><div><strong>Guest learner</strong><span>Saved on this device</span></div><Menu size={17} className="profile-menu" /></div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="crumb"><span>Workspace</span><ChevronRight size={14} /><strong>Assessment agent</strong></div>
          <div className="top-right"><span className={"status-dot " + (status === "Agent online" ? "online" : "")} />{status}<span className="top-divider" /><span className="model-label">AI AGENT</span></div>
        </header>

        <section className="content">
          <div className="chat-layout">
            <section className="chat-panel">
              <div className="chat-header">
                <div className="chat-agent-icon"><Bot size={19} /></div>
                <div><strong>SkillMirror Agent</strong><span><i /> {busy ? "Working on your response" : "Ready to assess"}</span></div>
                <button className="icon-button" title="Start a new chat" onClick={startNewConversation}><Plus size={18} /></button>
              </div>
              <div className="messages">
                {messages.map((message, index) => (
                  <div className={"message-row " + message.role} key={index}>
                    {message.role === "assistant" && <div className="message-avatar"><Sparkles size={15} /></div>}
                    <div className="message-bubble"><span className="message-author">{message.role === "assistant" ? "SKILLMIRROR" : "YOU"}</span><p>{message.content}</p></div>
                    {message.role === "user" && <div className="user-avatar"><UserRound size={15} /></div>}
                  </div>
                ))}
                {busy && <div className="message-row assistant"><div className="message-avatar"><Sparkles size={15} /></div><div className="typing"><span /><span /><span /><small>Agent is thinking and choosing its next action</small></div></div>}
                <div ref={endRef} />
              </div>
              {actions.length > 0 && <div className="action-trace"><WandSparkles size={14} /><span>AGENT ACTIONS</span>{actions.map((action, index) => <small key={index}>{action.tool.replaceAll("_", " ")} {action.success ? "✓" : "!"}</small>)}</div>}
              {selectedFiles.length > 0 && <div className="attachment-preview">{selectedFiles.map((file, index) => <span key={index}><FileText size={13} />{file.name}<button type="button" onClick={() => setSelectedFiles((files) => files.filter((_, i) => i !== index))} aria-label={"Remove " + file.name}><X size={12} /></button></span>)}</div>}
              <form className="composer" onSubmit={(event) => { event.preventDefault(); sendMessage(); }}>
                <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !busy) { event.preventDefault(); sendMessage(); }
                }} placeholder="Message SkillMirror…" rows={2} aria-label="Message SkillMirror" />
                <input ref={fileInputRef} className="visually-hidden-file" type="file" multiple onChange={(event) => {
                  const files = Array.from(event.target.files || []);
                  setSelectedFiles((current) => [...current, ...files].slice(0, 5));
                  event.target.value = "";
                }} />
                <div className="composer-bottom">
                  <div className="composer-hints">
                    <button className="attach-button" type="button" onClick={() => fileInputRef.current?.click()} title="Choose files (agent file processing is not connected yet)" aria-label="Choose attachments"><Paperclip size={16} /></button>
                    <span><CircleHelp size={13} /> {busy ? "You can keep typing while SkillMirror responds." : "Be specific. Your answers help the agent adapt."}</span>
                  </div>
                  {busy ? <button className="stop-button" type="button" onClick={() => abortControllerRef.current?.abort()} title="Stop response" aria-label="Stop response"><Square size={13} fill="currentColor" /></button> : <button type="submit" disabled={!input.trim()} title="Send message"><ArrowUp size={18} /></button>}
                </div>
              </form>
              <p className="privacy-note"><FileText size={12} /> Assessment feedback reflects evidence from this session, not a formal certification.</p>
            </section>
          </div>
        </section>
        </main>
    </div>
  );
}
