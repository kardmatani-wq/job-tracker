import { useState, useEffect, useRef, useCallback } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import Head from "next/head";

// ─── Constants ──────────────────────────────────────────────────────────────
const STAGES = ["Applied","Phone Screen","Interview","Final Round","Offer","Rejected"];
const STAGE_COLORS = {
  "Applied":      { bg:"#EEF2FF", text:"#4338CA", dot:"#6366F1" },
  "Phone Screen": { bg:"#FEF9C3", text:"#854D0E", dot:"#EAB308" },
  "Interview":    { bg:"#DCFCE7", text:"#166534", dot:"#22C55E" },
  "Final Round":  { bg:"#FCE7F3", text:"#9D174D", dot:"#EC4899" },
  "Offer":        { bg:"#D1FAE5", text:"#065F46", dot:"#10B981" },
  "Rejected":     { bg:"#F3F4F6", text:"#6B7280", dot:"#9CA3AF" },
};
const CHECKLIST_ITEMS = [
  "Job URL / JD saved",
  "Resume tailored",
  "Cover letter written",
  "Application submitted",
  "Follow-up scheduled",
];

// ─── Helpers ────────────────────────────────────────────────────────────────
function extractDocId(url) {
  const m = url?.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}
function todayDate() {
  const d = new Date();
  d.setHours(0,0,0,0);
  return d;
}
function isOverdue(app) {
  if (!app.followUpDate) return false;
  return new Date(app.followUpDate + "T00:00:00") < todayDate();
}

// ─── API Calls ──────────────────────────────────────────────────────────────
async function callClaude(messages, system, maxTokens = 2000) {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, system, max_tokens: maxTokens }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.text;
}
async function driveAction(action, params) {
  const res = await fetch("/api/drive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

// ─── UI Primitives ──────────────────────────────────────────────────────────
const s = {
  card: { background:"#fff", borderRadius:14, border:"1.5px solid #EAECF0" },
  label: { display:"block", fontSize:11, fontWeight:700, color:"#6B7280", marginBottom:5, letterSpacing:"0.05em", textTransform:"uppercase" },
  input: { width:"100%", border:"1.5px solid #E5E7EB", borderRadius:9, padding:"9px 13px", fontSize:14, color:"#111827", outline:"none", boxSizing:"border-box", fontFamily:"inherit", background:"#FAFAFA", transition:"border-color 0.15s" },
  textarea: { width:"100%", border:"1.5px solid #E5E7EB", borderRadius:9, padding:"9px 13px", fontSize:14, color:"#111827", outline:"none", boxSizing:"border-box", fontFamily:"inherit", background:"#FAFAFA", resize:"vertical", transition:"border-color 0.15s" },
};
function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      {label && <label style={s.label}>{label}</label>}
      {children}
      {hint && <p style={{ fontSize: 12, color: "#9CA3AF", marginTop: 5 }}>{hint}</p>}
    </div>
  );
}
function Inp({ label, hint, ...p }) {
  return <Field label={label} hint={hint}><input {...p} style={{ ...s.input, ...(p.style || {}) }} /></Field>;
}
function Txt({ label, hint, ...p }) {
  return <Field label={label} hint={hint}><textarea {...p} style={{ ...s.textarea, minHeight: 80, ...(p.style || {}) }} /></Field>;
}
function Sel({ label, options, ...p }) {
  return (
    <Field label={label}>
      <select {...p} style={{ ...s.input, ...(p.style || {}) }}>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </Field>
  );
}
function Btn({ children, variant = "primary", loading, ...p }) {
  const variants = {
    primary:   { background:"#111827", color:"#fff", border:"none" },
    accent:    { background:"#6366F1", color:"#fff", border:"none" },
    secondary: { background:"#F3F4F6", color:"#374151", border:"none" },
    ghost:     { background:"transparent", color:"#6B7280", border:"1.5px solid #E5E7EB" },
    danger:    { background:"#FEE2E2", color:"#DC2626", border:"none" },
    google:    { background:"#fff", color:"#374151", border:"1.5px solid #E5E7EB" },
  };
  const v = variants[variant] || variants.primary;
  return (
    <button {...p} disabled={p.disabled || loading} style={{ padding:"9px 18px", borderRadius:9, fontSize:13, fontWeight:600, cursor: p.disabled || loading ? "not-allowed" : "pointer", fontFamily:"inherit", display:"inline-flex", alignItems:"center", gap:7, opacity: p.disabled || loading ? 0.6 : 1, transition:"opacity 0.15s", ...v, ...(p.style || {}) }}>
      {loading && <span style={{ display:"inline-block", width:12, height:12, border:"2px solid currentColor", borderTopColor:"transparent", borderRadius:"50%", animation:"spin 0.7s linear infinite" }} />}
      {children}
    </button>
  );
}
function Badge({ status }) {
  const c = STAGE_COLORS[status] || STAGE_COLORS["Applied"];
  return (
    <span style={{ background:c.bg, color:c.text, padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700, display:"inline-flex", alignItems:"center", gap:5 }}>
      <span style={{ width:6, height:6, borderRadius:"50%", background:c.dot }} />{status}
    </span>
  );
}
function ScorePill({ score }) {
  if (score == null) return null;
  const color = score >= 80 ? "#065F46" : score >= 60 ? "#854D0E" : "#991B1B";
  const bg    = score >= 80 ? "#D1FAE5" : score >= 60 ? "#FEF9C3" : "#FEE2E2";
  return (
    <span style={{ background:bg, color, padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700, display:"inline-flex", alignItems:"center", gap:4 }}>
      ◎ {score}% match
    </span>
  );
}
function Modal({ title, subtitle, onClose, width = 640, children }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={onClose}>
      <div style={{ background:"#fff", borderRadius:18, width:"100%", maxWidth:width, maxHeight:"92vh", overflow:"auto", boxShadow:"0 32px 100px rgba(0,0,0,0.2)" }} onClick={e => e.stopPropagation()}>
        <div style={{ padding:"24px 28px 0", display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
          <div>
            <h2 style={{ margin:0, fontFamily:"'Fraunces',serif", fontSize:20, color:"#111827", fontWeight:700 }}>{title}</h2>
            {subtitle && <p style={{ margin:"3px 0 0", fontSize:13, color:"#9CA3AF" }}>{subtitle}</p>}
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", fontSize:24, cursor:"pointer", color:"#9CA3AF", lineHeight:1, padding:4 }}>×</button>
        </div>
        <div style={{ padding:28 }}>{children}</div>
      </div>
    </div>
  );
}

// ─── Settings ───────────────────────────────────────────────────────────────
function SettingsTab({ settings, onChange, driveConnected, onConnectDrive, onDisconnectDrive }) {
  const [local, setLocal] = useState(settings);
  const set = (k, v) => setLocal(prev => ({ ...prev, [k]: v }));
  return (
    <div style={{ maxWidth: 620 }}>
      {/* Google Drive connection */}
      <div style={{ ...s.card, padding:24, marginBottom:20 }}>
        <h3 style={{ fontFamily:"'Fraunces',serif", fontSize:17, color:"#111827", marginBottom:6 }}>Google Drive</h3>
        <p style={{ fontSize:13, color:"#6B7280", lineHeight:1.65, marginBottom:18 }}>
          Connect your Google account so the app can read your base resume and save tailored docs directly to your Drive folders.
        </p>
        {driveConnected ? (
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <span style={{ background:"#D1FAE5", color:"#065F46", padding:"6px 14px", borderRadius:20, fontSize:13, fontWeight:700 }}>✓ Google Drive connected</span>
            <Btn variant="ghost" onClick={onDisconnectDrive} style={{ fontSize:12 }}>Disconnect</Btn>
          </div>
        ) : (
          <Btn variant="google" onClick={onConnectDrive}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Sign in with Google
          </Btn>
        )}
      </div>
      {/* Base resume */}
      <div style={{ ...s.card, padding:24, marginBottom:20 }}>
        <h3 style={{ fontFamily:"'Fraunces',serif", fontSize:17, color:"#111827", marginBottom:6 }}>Base Resume</h3>
        <p style={{ fontSize:13, color:"#6B7280", lineHeight:1.65, marginBottom:18 }}>
          Your master Google Doc resume. The AI reads this and uses it as the template — preserving your formatting and structure — when tailoring for each job.
        </p>
        <Inp label="Base Resume Google Doc URL" value={local.baseResumeUrl || ""} onChange={e => set("baseResumeUrl", e.target.value)} placeholder="https://docs.google.com/document/d/..." />
        <Inp label="Resumes Folder ID" value={local.resumeFolderId || ""} onChange={e => set("resumeFolderId", e.target.value)} placeholder="e.g. 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms" hint="Open your Resumes folder in Drive → copy the ID from the URL after /folders/" />
        <Inp label="Cover Letters Folder ID" value={local.clFolderId || ""} onChange={e => set("clFolderId", e.target.value)} placeholder="e.g. 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms" hint="Open your Cover Letters folder in Drive → copy the ID from the URL after /folders/" />
      </div>
      {/* Personal details */}
      <div style={{ ...s.card, padding:24, marginBottom:24 }}>
        <h3 style={{ fontFamily:"'Fraunces',serif", fontSize:17, color:"#111827", marginBottom:6 }}>Your Details</h3>
        <p style={{ fontSize:13, color:"#6B7280", marginBottom:18 }}>Used to personalise your cover letters and documents.</p>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 16px" }}>
          <Inp label="Your Name" value={local.name || ""} onChange={e => set("name", e.target.value)} placeholder="Jane Smith" />
          <Inp label="City, State" value={local.location || ""} onChange={e => set("location", e.target.value)} placeholder="New York, NY" />
          <Inp label="Phone Number" value={local.phone || ""} onChange={e => set("phone", e.target.value)} placeholder="+1 (555) 000-0000" />
          <Inp label="Email Address" value={local.email || ""} onChange={e => set("email", e.target.value)} placeholder="jane@example.com" />
        </div>
        <Inp label="LinkedIn URL" value={local.linkedin || ""} onChange={e => set("linkedin", e.target.value)} placeholder="https://linkedin.com/in/janesmith" />
        <Inp label="Portfolio / Website URL" value={local.website || ""} onChange={e => set("website", e.target.value)} placeholder="https://janesmith.dev" hint="Optional — included in cover letters if provided." />
      </div>
      <Btn onClick={() => onChange(local)} variant="primary">Save Settings</Btn>
    </div>
  );
}

// ─── AI Pipeline ────────────────────────────────────────────────────────────
async function runAIPipeline({ jobDescription, company, role, settings, onStatus }) {
  const results = {
    tailoredResume:"", coverLetter:"", keywordScore:null,
    matchedKeywords:[], missingKeywords:[], resumeChanges:[],
    resumeDocUrl:"", clDocUrl:"", resumeDocId:"", clDocId:""
  };

  // 1. Read base resume
  onStatus("Reading your base resume from Google Drive…");
  let baseResumeContent = "";
  const baseDocId = extractDocId(settings.baseResumeUrl);
  if (baseDocId) {
    try {
      const r = await driveAction("readDoc", { docId: baseDocId });
      baseResumeContent = r.text;
    } catch (e) {
      baseResumeContent = "";
      console.warn("Could not read base resume:", e.message);
    }
  }

  // 2. Tailor resume
  onStatus("Tailoring your resume to the job…");
  results.tailoredResume = await callClaude(
    [{ role:"user", content:`You are an expert resume writer. Produce a tailored version of this resume for the role below.
Rules:
- Moderate edits: restructure bullets and reorder sections if it helps, but preserve the candidate's authentic voice
- Mirror keywords and phrases from the JD naturally — don't stuff them awkwardly
- Do NOT invent experience or qualifications
- Keep the same overall structure and sections as the base resume
- Return ONLY the resume text, no preamble or commentary

BASE RESUME:
${baseResumeContent || "No base resume provided — write a professional resume for a " + role + " candidate based on the job description."}

JOB DESCRIPTION:
${jobDescription}

COMPANY: ${company}
ROLE: ${role}`}],
    null, 2000
  );

  // 3. Keyword score
  onStatus("Calculating keyword match score…");
  try {
    const scoreText = await callClaude(
      [{ role:"user", content:`Compare this resume to the job description. Return ONLY valid JSON (no markdown, no preamble):
{"score": 78, "matched": ["keyword1","keyword2","keyword3"], "missing": ["keyword4","keyword5"]}

RESUME: ${results.tailoredResume.slice(0, 2000)}
JOB DESCRIPTION: ${jobDescription.slice(0, 1500)}`}],
      null, 400
    );
    const json = JSON.parse(scoreText.replace(/```json|```/g, "").trim());
    results.keywordScore    = json.score;
    results.matchedKeywords = json.matched || [];
    results.missingKeywords = json.missing || [];
  } catch { /* score is optional */ }

  // 4. Resume change summary
  onStatus("Summarising resume changes…");
  if (baseResumeContent) {
    try {
      const changesText = await callClaude(
        [{ role:"user", content:`You are a resume editor. Compare the BASE RESUME with the TAILORED RESUME and list the specific changes made.

Format your response as a JSON array of change objects. Each object should have:
- "section": which section was changed (e.g. "Summary", "Experience – Company Name", "Skills", "Education")
- "type": one of "added", "removed", "reworded", "reordered"
- "description": a concise 1-sentence description of the specific change

Return ONLY valid JSON array, no markdown, no preamble. Example:
[{"section":"Summary","type":"reworded","description":"Emphasised data-driven decision making to align with the JD."},{"section":"Skills","type":"added","description":"Added React and TypeScript to match required technical skills."}]

BASE RESUME:
${baseResumeContent.slice(0, 2500)}

TAILORED RESUME:
${results.tailoredResume.slice(0, 2500)}`}],
        null, 800
      );
      results.resumeChanges = JSON.parse(changesText.replace(/```json|```/g, "").trim());
    } catch {
      results.resumeChanges = [];
    }
  }

  // 5. Cover letter
  onStatus("Drafting your cover letter…");
  const personalDetails = [
    settings.phone   ? `Phone: ${settings.phone}` : "",
    settings.email   ? `Email: ${settings.email}` : "",
    settings.linkedin ? `LinkedIn: ${settings.linkedin}` : "",
    settings.website ? `Portfolio: ${settings.website}` : "",
    settings.location ? `Location: ${settings.location}` : "",
  ].filter(Boolean).join("\n");

  results.coverLetter = await callClaude(
    [{ role:"user", content:`Write a tailored, compelling cover letter for this application.
Guidelines:
- 3 focused paragraphs: (1) hook + why this company specifically, (2) what you bring that matches their needs, (3) confident close
- Warm, professional tone — no generic filler phrases like "I am writing to express my interest"
- Reference specific details from the job description
- Sign off with the candidate's name

Candidate: ${settings.name || "the applicant"}
${personalDetails ? "Personal details:\n" + personalDetails : ""}
Resume: ${results.tailoredResume.slice(0, 1500)}
Company: ${company}
Role: ${role}
Job Description: ${jobDescription}`}],
    null, 1500
  );

  // 6. Save resume to Drive (copy base resume to preserve formatting)
  if (settings.resumeFolderId) {
    onStatus("Saving tailored resume to Google Drive…");
    try {
      const docName = `${company}_${role}_Resume`.replace(/\s+/g, "_");
      const baseDocId = extractDocId(settings.baseResumeUrl);
      let r;
      if (baseDocId) {
        r = await driveAction("copyAndTailorDoc", {
          sourceDocId: baseDocId,
          title: docName,
          content: results.tailoredResume,
          folderId: settings.resumeFolderId,
        });
      } else {
        r = await driveAction("createDoc", {
          title: docName,
          content: results.tailoredResume,
          folderId: settings.resumeFolderId,
        });
      }
      results.resumeDocUrl = r.url;
      results.resumeDocId  = r.docId;
    } catch (e) { console.warn("Resume save failed:", e.message); }
  }

  // 7. Save cover letter to Drive
  if (settings.clFolderId) {
    onStatus("Saving cover letter to Google Drive…");
    try {
      const docName = `${company}_${role}_CoverLetter`.replace(/\s+/g, "_");
      const r = await driveAction("createDoc", {
        title: docName,
        content: results.coverLetter,
        folderId: settings.clFolderId,
      });
      results.clDocUrl = r.url;
      results.clDocId  = r.docId;
    } catch (e) { console.warn("Cover letter save failed:", e.message); }
  }

  return results;
}

// ─── Add Application Modal ──────────────────────────────────────────────────
function AddAppModal({ settings, onSave, onClose }) {
  const [step, setStep]       = useState("form");
  const [status, setStatus]   = useState("");
  const [scraping, setScraping] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [form, setForm] = useState({
    company:"", role:"", jobUrl:"", jobDescription:"",
    appliedDate: new Date().toISOString().split("T")[0],
    followUpDate:"", salary:"", notes:"", status:"Applied",
  });
  const [result, setResult] = useState(null);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function scrapeUrl() {
    if (!form.jobUrl) return;
    setScraping(true);
    try {
      const res = await fetch("/api/fetch-jd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: form.jobUrl }),
      });
      const data = await res.json();
      if (data.text && data.text.length > 50) {
        set("jobDescription", data.text);
        // Auto-extract company, role, salary from the fetched JD
        setExtracting(true);
        try {
          const extractText = await callClaude(
            [{ role:"user", content:`Extract the following information from this job posting. Return ONLY valid JSON (no markdown, no preamble):
{"company": "Acme Corp", "role": "Senior Product Manager", "salary": "$120k–$150k"}

If a field is not found, use an empty string "".
For salary, include the full range or value as written. If not mentioned, use "".

JOB POSTING:
${data.text.slice(0, 3000)}`}],
            null, 200
          );
          const extracted = JSON.parse(extractText.replace(/```json|```/g, "").trim());
          setForm(f => ({
            ...f,
            jobDescription: data.text,
            company: extracted.company || f.company,
            role:    extracted.role    || f.role,
            salary:  extracted.salary  || f.salary,
          }));
        } catch {
          // extraction failed silently — JD is still populated
        }
        setExtracting(false);
      } else {
        set("jobDescription", data.error || "Could not fetch — please paste the job description manually.");
      }
    } catch {
      set("jobDescription", "Could not fetch — please paste the job description manually.");
    }
    setScraping(false);
    setExtracting(false);
  }

  async function handleSubmit() {
    if (!form.company || !form.role) return alert("Company and Role are required.");
    if (!form.jobDescription)        return alert("Please add a job description.");
    setStep("processing");
    try {
      const aiResults = await runAIPipeline({
        jobDescription: form.jobDescription,
        company: form.company,
        role:    form.role,
        settings,
        onStatus: setStatus,
      });
      setResult(aiResults);
      setStep("done");
    } catch (e) {
      alert("Pipeline error: " + e.message);
      setStep("form");
    }
  }

  function saveApp() {
    const checklist = CHECKLIST_ITEMS.reduce((acc, _, i) => { acc[i] = i < 2; return acc; }, {});
    onSave({
      ...form,
      resumeLink:       result?.resumeDocUrl   || "",
      coverLetterLink:  result?.clDocUrl       || "",
      resumeDocId:      result?.resumeDocId    || "",
      clDocId:          result?.clDocId        || "",
      tailoredResume:   result?.tailoredResume || "",
      coverLetter:      result?.coverLetter    || "",
      keywordScore:     result?.keywordScore   ?? null,
      matchedKeywords:  result?.matchedKeywords || [],
      missingKeywords:  result?.missingKeywords || [],
      resumeChanges:    result?.resumeChanges  || [],
      checklist,
    });
    onClose();
  }

  if (step === "processing") return (
    <Modal title="Building your application…" onClose={() => {}} width={460}>
      <div style={{ textAlign:"center", padding:"28px 0 16px" }}>
        <div style={{ width:52, height:52, border:"3px solid #E5E7EB", borderTopColor:"#6366F1", borderRadius:"50%", animation:"spin 0.8s linear infinite", margin:"0 auto 20px" }} />
        <p style={{ fontSize:15, color:"#374151", fontWeight:600, marginBottom:8 }}>{status || "Processing…"}</p>
        <p style={{ fontSize:13, color:"#9CA3AF" }}>Usually takes 30–60 seconds</p>
      </div>
    </Modal>
  );

  if (step === "done" && result) return (
    <Modal title="Application ready! 🎉" subtitle={`${form.company} · ${form.role}`} onClose={onClose} width={620}>
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:20 }}>
        <ScorePill score={result.keywordScore} />
        {result.resumeDocUrl && (
          <a href={result.resumeDocUrl} target="_blank" rel="noreferrer" style={{ fontSize:12, color:"#4338CA", fontWeight:700, background:"#EEF2FF", padding:"4px 12px", borderRadius:20, display:"inline-flex", alignItems:"center", gap:4 }}>
            📄 Resume saved ↗
          </a>
        )}
        {result.clDocUrl && (
          <a href={result.clDocUrl} target="_blank" rel="noreferrer" style={{ fontSize:12, color:"#4338CA", fontWeight:700, background:"#EEF2FF", padding:"4px 12px", borderRadius:20, display:"inline-flex", alignItems:"center", gap:4 }}>
            ✉ Cover letter saved ↗
          </a>
        )}
      </div>

      {result.missingKeywords?.length > 0 && (
        <div style={{ background:"#FEF9C3", borderRadius:10, padding:"10px 14px", marginBottom:16, fontSize:13, color:"#854D0E" }}>
          <strong>Suggested keywords to review:</strong> {result.missingKeywords.slice(0, 6).join(", ")}
        </div>
      )}

      {/* Resume Changes Section */}
      {result.resumeChanges?.length > 0 && (
        <div style={{ ...s.card, padding:"14px 18px", marginBottom:16 }}>
          <div style={{ ...s.label, marginBottom:10 }}>Resume Changes Made</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {result.resumeChanges.map((change, i) => {
              const typeColors = {
                added:     { bg:"#D1FAE5", text:"#065F46" },
                removed:   { bg:"#FEE2E2", text:"#DC2626" },
                reworded:  { bg:"#EEF2FF", text:"#4338CA" },
                reordered: { bg:"#FEF9C3", text:"#854D0E" },
              };
              const tc = typeColors[change.type] || typeColors.reworded;
              return (
                <div key={i} style={{ display:"flex", gap:10, alignItems:"flex-start", fontSize:13 }}>
                  <span style={{ background:tc.bg, color:tc.text, padding:"2px 8px", borderRadius:6, fontSize:11, fontWeight:700, whiteSpace:"nowrap", flexShrink:0, marginTop:1 }}>
                    {change.type}
                  </span>
                  <div>
                    <span style={{ fontWeight:600, color:"#374151" }}>{change.section}: </span>
                    <span style={{ color:"#6B7280" }}>{change.description}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ background:"#F9FAFB", borderRadius:10, padding:16, marginBottom:20, maxHeight:200, overflow:"auto" }}>
        <div style={s.label}>Cover Letter Preview</div>
        <div style={{ fontSize:13, lineHeight:1.75, color:"#374151", whiteSpace:"pre-wrap", marginTop:8 }}>
          {result.coverLetter?.slice(0, 500)}…
        </div>
      </div>

      <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
        <Btn variant="ghost" onClick={onClose}>Discard</Btn>
        <Btn variant="primary" onClick={saveApp}>Save to Tracker</Btn>
      </div>
    </Modal>
  );

  return (
    <Modal title="New Application" onClose={onClose} width={620}>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 16px" }}>
        <Inp label="Company *" value={form.company} onChange={e => set("company", e.target.value)} placeholder="Google" />
        <Inp label="Role *" value={form.role} onChange={e => set("role", e.target.value)} placeholder="Product Manager" />
        <Inp label="Applied Date" type="date" value={form.appliedDate} onChange={e => set("appliedDate", e.target.value)} />
        <Inp label="Follow-up Date" type="date" value={form.followUpDate} onChange={e => set("followUpDate", e.target.value)} />
        <Inp label="Salary Range" value={form.salary} onChange={e => set("salary", e.target.value)} placeholder="$120k–$150k" />
        <Sel label="Status" value={form.status} onChange={e => set("status", e.target.value)} options={STAGES} />
      </div>
      <Field label="Job Posting URL" hint="Paste the URL and click Fetch — we'll extract the JD and auto-fill company, role & salary when available">
        <div style={{ display:"flex", gap:8 }}>
          <input value={form.jobUrl} onChange={e => set("jobUrl", e.target.value)} placeholder="https://..." style={{ ...s.input, flex:1 }} />
          <Btn variant="secondary" onClick={scrapeUrl} loading={scraping || extracting} disabled={!form.jobUrl}>
            {extracting ? "Extracting…" : "Fetch JD"}
          </Btn>
        </div>
      </Field>
      <Txt label="Job Description *" value={form.jobDescription} onChange={e => set("jobDescription", e.target.value)} placeholder="Paste the full job description here, or use Fetch JD above…" style={{ minHeight:140 }} />
      <Txt label="Notes" value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="Recruiter name, referral contact, salary details, why you're interested…" />
      <div style={{ background:"#EEF2FF", borderRadius:10, padding:"12px 16px", marginBottom:20, fontSize:13, color:"#4338CA" }}>
        ✦ Clicking <strong>Tailor & Save</strong> will: read your base resume, tailor it to this job, write a cover letter, score keyword match, and save both docs to your Google Drive automatically.
      </div>
      <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="accent" onClick={handleSubmit}>✦ Tailor & Save</Btn>
      </div>
    </Modal>
  );
}

// ─── Chat Editor ────────────────────────────────────────────────────────────
function ChatEditor({ app, docType, onClose, onUpdate }) {
  const [messages, setMessages]   = useState([]);
  const [input, setInput]         = useState("");
  const [loading, setLoading]     = useState(false);
  const [currentContent, setCurrentContent] = useState(
    docType === "resume" ? app.tailoredResume : app.coverLetter
  );
  const bottomRef = useRef(null);
  const docLabel  = docType === "resume" ? "Resume" : "Cover Letter";

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages]);

  async function send() {
    if (!input.trim() || loading) return;
    const userMsg = { role:"user", content: input };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput("");
    setLoading(true);
    try {
      const responseText = await callClaude(
        history,
        `You are an expert ${docType === "resume" ? "resume writer" : "cover letter writer"}. The user wants to edit their ${docLabel}.
Current content:
---
${currentContent}
---
When the user asks for edits, return the COMPLETE updated ${docLabel} text (not just the changed parts).
End your response with:
CHANGES: [brief description of what you changed]`,
        2000
      );
      const [updated, ...rest] = responseText.split(/CHANGES:/i);
      const updatedContent = updated.trim();
      setCurrentContent(updatedContent);
      setMessages(m => [...m, { role:"assistant", content: responseText }]);
      onUpdate(docType, updatedContent);
      const docId = docType === "resume" ? app.resumeDocId : app.clDocId;
      if (docId) {
        driveAction("updateDoc", { docId, content: updatedContent }).catch(() => {});
      }
    } catch (e) {
      setMessages(m => [...m, { role:"assistant", content:"Error: " + e.message }]);
    }
    setLoading(false);
  }

  return (
    <Modal title={`Edit ${docLabel} with AI`} subtitle={`${app.company} · ${app.role}`} onClose={onClose} width={780}>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>
        <div>
          <div style={s.label}>{docLabel} (live)</div>
          <div style={{ background:"#F9FAFB", borderRadius:10, padding:14, fontSize:13, lineHeight:1.8, color:"#374151", maxHeight:380, overflow:"auto", whiteSpace:"pre-wrap", fontFamily:"Georgia, serif", border:"1.5px solid #E5E7EB" }}>
            {currentContent || "No content."}
          </div>
          {(docType === "resume" ? app.resumeDocUrl : app.clDocUrl) && (
            <a href={docType === "resume" ? app.resumeDocUrl : app.clDocUrl} target="_blank" rel="noreferrer" style={{ display:"inline-flex", alignItems:"center", gap:5, marginTop:10, fontSize:12, color:"#6366F1", fontWeight:600 }}>
              Open in Google Drive ↗
            </a>
          )}
        </div>
        <div style={{ display:"flex", flexDirection:"column" }}>
          <div style={s.label}>Chat to Edit</div>
          <div style={{ background:"#F9FAFB", borderRadius:10, padding:12, flex:1, overflow:"auto", maxHeight:340, minHeight:280, display:"flex", flexDirection:"column", gap:10, border:"1.5px solid #E5E7EB" }}>
            {messages.length === 0 && (
              <div style={{ color:"#9CA3AF", fontSize:13, lineHeight:1.7, padding:"6px 0" }}>
                Tell me what to change, for example:<br/>
                <em style={{ color:"#6B7280" }}>"Make the opening stronger"</em><br/>
                <em style={{ color:"#6B7280" }}>"Emphasise my leadership experience"</em><br/>
                <em style={{ color:"#6B7280" }}>"Add more quantified results"</em><br/>
                <em style={{ color:"#6B7280" }}>"Make it more concise"</em>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", background: m.role === "user" ? "#6366F1" : "#fff", color: m.role === "user" ? "#fff" : "#374151", padding:"8px 12px", borderRadius:10, fontSize:13, maxWidth:"88%", lineHeight:1.55, border: m.role === "assistant" ? "1.5px solid #E5E7EB" : "none" }}>
                {m.role === "assistant" ? (m.content.split(/CHANGES:/i)[1]?.trim() || "Updated! See the document on the left.") : m.content}
              </div>
            ))}
            {loading && (
              <div style={{ alignSelf:"flex-start", background:"#fff", border:"1.5px solid #E5E7EB", padding:"8px 12px", borderRadius:10, fontSize:13, color:"#9CA3AF" }}>
                Updating…
              </div>
            )}
            <div ref={bottomRef} />
          </div>
          <div style={{ display:"flex", gap:8, marginTop:10 }}>
            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }}} placeholder="What should I change?" style={{ ...s.input, flex:1, fontSize:13 }} />
            <Btn variant="accent" onClick={send} loading={loading} disabled={!input.trim()}>Send</Btn>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ─── App Detail ─────────────────────────────────────────────────────────────
function AppDetail({ app, onClose, onEdit, onDelete, onOpenChat, onChecklistChange }) {
  const [checklist, setChecklist] = useState(app.checklist || {});
  const overdue    = isOverdue(app);
  const checkCount = Object.values(checklist).filter(Boolean).length;

  function toggleCheck(i, val) {
    const next = { ...checklist, [i]: val };
    setChecklist(next);
    onChecklistChange(app.id, next);
  }

  return (
    <Modal title={app.company} subtitle={app.role} onClose={onClose} width={620}>
      <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:20 }}>
        <Badge status={app.status} />
        <ScorePill score={app.keywordScore} />
        {overdue && <span style={{ fontSize:11, fontWeight:700, background:"#FEE2E2", color:"#DC2626", padding:"3px 10px", borderRadius:20 }}>⚠ Follow-up overdue</span>}
        {app.salary && <span style={{ fontSize:11, fontWeight:700, background:"#F3F4F6", color:"#374151", padding:"3px 10px", borderRadius:20 }}>💰 {app.salary}</span>}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:20 }}>
        {[["Applied", app.appliedDate || "—"], ["Follow-up", app.followUpDate || "—"]].map(([label, val]) => (
          <div key={label} style={{ background:"#F9FAFB", borderRadius:10, padding:"12px 16px" }}>
            <div style={{ fontSize:11, color:"#9CA3AF", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:3 }}>{label}</div>
            <div style={{ fontSize:15, fontWeight:600, color:"#111827" }}>{val}</div>
          </div>
        ))}
      </div>
      {/* Checklist */}
      <div style={{ ...s.card, padding:"16px 20px", marginBottom:16 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
          <div style={s.label}>Application Checklist</div>
          <div style={{ fontSize:12, color:"#9CA3AF", fontWeight:600 }}>{checkCount}/{CHECKLIST_ITEMS.length}</div>
        </div>
        <div style={{ height:4, background:"#F3F4F6", borderRadius:2, marginBottom:14, overflow:"hidden" }}>
          <div style={{ height:"100%", width:`${(checkCount/CHECKLIST_ITEMS.length)*100}%`, background:"#6366F1", borderRadius:2, transition:"width 0.3s" }} />
        </div>
        {CHECKLIST_ITEMS.map((item, i) => (
          <label key={i} style={{ display:"flex", alignItems:"center", gap:10, fontSize:13, color: checklist[i] ? "#6B7280" : "#111827", marginBottom:8, cursor:"pointer", textDecoration: checklist[i] ? "line-through" : "none" }}>
            <input type="checkbox" checked={!!checklist[i]} onChange={e => toggleCheck(i, e.target.checked)} style={{ width:15, height:15, accentColor:"#6366F1", cursor:"pointer" }} />
            {item}
          </label>
        ))}
      </div>
      {/* Keyword insights */}
      {(app.matchedKeywords?.length > 0 || app.missingKeywords?.length > 0) && (
        <div style={{ ...s.card, padding:"14px 18px", marginBottom:16 }}>
          <div style={{ ...s.label, marginBottom:10 }}>Keyword Insights</div>
          {app.matchedKeywords?.length > 0 && (
            <div style={{ marginBottom:8 }}>
              <span style={{ fontSize:11, color:"#065F46", fontWeight:700 }}>✓ Matched: </span>
              <span style={{ fontSize:12, color:"#374151" }}>{app.matchedKeywords.slice(0, 10).join(", ")}</span>
            </div>
          )}
          {app.missingKeywords?.length > 0 && (
            <div>
              <span style={{ fontSize:11, color:"#DC2626", fontWeight:700 }}>✗ To add: </span>
              <span style={{ fontSize:12, color:"#374151" }}>{app.missingKeywords.slice(0, 6).join(", ")}</span>
            </div>
          )}
        </div>
      )}
      {/* Resume Changes (persisted on the app) */}
      {app.resumeChanges?.length > 0 && (
        <div style={{ ...s.card, padding:"14px 18px", marginBottom:16 }}>
          <div style={{ ...s.label, marginBottom:10 }}>Resume Changes Made</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {app.resumeChanges.map((change, i) => {
              const typeColors = {
                added:     { bg:"#D1FAE5", text:"#065F46" },
                removed:   { bg:"#FEE2E2", text:"#DC2626" },
                reworded:  { bg:"#EEF2FF", text:"#4338CA" },
                reordered: { bg:"#FEF9C3", text:"#854D0E" },
              };
              const tc = typeColors[change.type] || typeColors.reworded;
              return (
                <div key={i} style={{ display:"flex", gap:10, alignItems:"flex-start", fontSize:13 }}>
                  <span style={{ background:tc.bg, color:tc.text, padding:"2px 8px", borderRadius:6, fontSize:11, fontWeight:700, whiteSpace:"nowrap", flexShrink:0, marginTop:1 }}>
                    {change.type}
                  </span>
                  <div>
                    <span style={{ fontWeight:600, color:"#374151" }}>{change.section}: </span>
                    <span style={{ color:"#6B7280" }}>{change.description}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {/* Drive docs */}
      {(app.resumeLink || app.coverLetterLink) && (
        <div style={{ display:"flex", gap:10, marginBottom:16, flexWrap:"wrap" }}>
          {app.resumeLink && (
            <div style={{ display:"flex", gap:6, alignItems:"center", background:"#EEF2FF", borderRadius:9, padding:"8px 14px" }}>
              <a href={app.resumeLink} target="_blank" rel="noreferrer" style={{ fontSize:13, color:"#4338CA", fontWeight:700 }}>📄 Resume ↗</a>
              <button onClick={() => onOpenChat("resume")} style={{ fontSize:11, color:"#6366F1", border:"1px solid #C7D2FE", borderRadius:6, background:"#fff", padding:"3px 9px", cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>Edit with AI</button>
            </div>
          )}
          {app.coverLetterLink && (
            <div style={{ display:"flex", gap:6, alignItems:"center", background:"#EEF2FF", borderRadius:9, padding:"8px 14px" }}>
              <a href={app.coverLetterLink} target="_blank" rel="noreferrer" style={{ fontSize:13, color:"#4338CA", fontWeight:700 }}>✉ Cover Letter ↗</a>
              <button onClick={() => onOpenChat("cover")} style={{ fontSize:11, color:"#6366F1", border:"1px solid #C7D2FE", borderRadius:6, background:"#fff", padding:"3px 9px", cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>Edit with AI</button>
            </div>
          )}
        </div>
      )}
      {app.notes && (
        <div style={{ background:"#F9FAFB", borderRadius:10, padding:"12px 16px", marginBottom:16, fontSize:13.5, lineHeight:1.7, color:"#374151", border:"1.5px solid #E5E7EB" }}>
          <div style={{ ...s.label, marginBottom:6 }}>Notes</div>
          {app.notes}
        </div>
      )}
      <div style={{ display:"flex", justifyContent:"space-between", gap:8, flexWrap:"wrap" }}>
        <Btn variant="danger" onClick={() => { if (window.confirm("Delete this application?")) { onDelete(app.id); onClose(); } }}>Delete</Btn>
        <div style={{ display:"flex", gap:8 }}>
          <Btn variant="ghost" onClick={() => onEdit(app)}>Edit</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ─── Edit Form ──────────────────────────────────────────────────────────────
function EditForm({ app, onSave, onClose }) {
  const [f, setF] = useState(app);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  return (
    <div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 16px" }}>
        <Inp label="Company"     value={f.company}     onChange={e => set("company", e.target.value)} />
        <Inp label="Role"        value={f.role}        onChange={e => set("role", e.target.value)} />
        <Inp label="Applied Date" type="date" value={f.appliedDate   || ""} onChange={e => set("appliedDate",   e.target.value)} />
        <Inp label="Follow-up Date" type="date" value={f.followUpDate || ""} onChange={e => set("followUpDate", e.target.value)} />
        <Inp label="Salary"      value={f.salary       || ""} onChange={e => set("salary",    e.target.value)} placeholder="$120k–$150k" />
        <Sel label="Status"      value={f.status}      onChange={e => set("status",    e.target.value)} options={STAGES} />
      </div>
      <Inp label="Resume Google Doc URL"      value={f.resumeLink      || ""} onChange={e => set("resumeLink",      e.target.value)} />
      <Inp label="Cover Letter Google Doc URL" value={f.coverLetterLink || ""} onChange={e => set("coverLetterLink", e.target.value)} />
      <Txt label="Notes" value={f.notes || ""} onChange={e => set("notes", e.target.value)} />
      <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:8 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn onClick={() => onSave(f)}>Save</Btn>
      </div>
    </div>
  );
}

// ─── Dashboard ──────────────────────────────────────────────────────────────
function Dashboard({ apps }) {
  const counts = STAGES.reduce((a, stage) => { a[stage] = apps.filter(x => x.status === stage).length; return a; }, {});
  const total       = apps.length;
  const responded   = apps.filter(a => !["Applied","Rejected"].includes(a.status)).length;
  const interviews  = apps.filter(a => ["Interview","Final Round","Offer"].includes(a.status)).length;
  const responseRate  = total > 0 ? Math.round(responded / total * 100) : 0;
  const interviewRate = responded > 0 ? Math.round(interviews / responded * 100) : 0;
  const overdueCount  = apps.filter(isOverdue).length;
  const scoresApps    = apps.filter(a => a.keywordScore != null);
  const avgScore      = scoresApps.length > 0 ? Math.round(scoresApps.reduce((s, a) => s + a.keywordScore, 0) / scoresApps.length) : null;
  const stats = [
    { label:"Total Applied",      value: total,              accent:"#6366F1" },
    { label:"Response Rate",      value: `${responseRate}%`,  accent:"#10B981" },
    { label:"Interview Rate",     value: `${interviewRate}%`, accent:"#F59E0B" },
    { label:"Avg Keyword Score",  value: avgScore ? `${avgScore}%` : "—", accent:"#8B5CF6" },
    { label:"Overdue Follow-ups", value: overdueCount, accent: overdueCount > 0 ? "#EF4444" : "#10B981" },
  ];
  return (
    <div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(160px, 1fr))", gap:14, marginBottom:28 }}>
        {stats.map(stat => (
          <div key={stat.label} style={{ ...s.card, padding:"20px 22px" }}>
            <div style={{ fontSize:30, fontWeight:800, color:stat.accent, fontFamily:"'Fraunces',serif", lineHeight:1 }}>{stat.value}</div>
            <div style={{ fontSize:12, color:"#6B7280", marginTop:6, fontWeight:500 }}>{stat.label}</div>
          </div>
        ))}
      </div>
      <div style={{ ...s.card, padding:24, marginBottom:24 }}>
        <h3 style={{ fontFamily:"'Fraunces',serif", fontSize:16, color:"#111827", marginBottom:18 }}>Pipeline</h3>
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {STAGES.map(stage => {
            const c   = STAGE_COLORS[stage];
            const pct = total > 0 ? (counts[stage] / total) * 100 : 0;
            return (
              <div key={stage} style={{ display:"flex", alignItems:"center", gap:12 }}>
                <div style={{ width:110, fontSize:12, fontWeight:600, color:"#374151", textAlign:"right", flexShrink:0 }}>{stage}</div>
                <div style={{ flex:1, background:"#F3F4F6", borderRadius:6, height:28, overflow:"hidden", position:"relative" }}>
                  <div style={{ width:`${Math.max(pct, counts[stage] > 0 ? 3 : 0)}%`, background:c.dot, height:"100%", borderRadius:6, transition:"width 0.6s ease" }} />
                  {counts[stage] > 0 && (
                    <span style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", fontSize:12, fontWeight:700, color:"#fff" }}>
                      {counts[stage]}
                    </span>
                  )}
                </div>
                <div style={{ width:24, fontSize:13, fontWeight:700, color:"#374151", flexShrink:0 }}>{counts[stage]}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ ...s.card, padding:24 }}>
        <h3 style={{ fontFamily:"'Fraunces',serif", fontSize:16, color:"#111827", marginBottom:16 }}>Recent Applications</h3>
        {apps.length === 0 ? (
          <p style={{ color:"#9CA3AF", fontSize:13 }}>No applications yet.</p>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {[...apps].sort((a, b) => new Date(b.appliedDate || 0) - new Date(a.appliedDate || 0)).slice(0, 6).map(app => (
              <div key={app.id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 16px", background:"#F9FAFB", borderRadius:10 }}>
                <div>
                  <div style={{ fontSize:14, fontWeight:600, color:"#111827" }}>
                    {app.company} <span style={{ color:"#9CA3AF", fontWeight:400 }}>· {app.role}</span>
                  </div>
                  {app.appliedDate && <div style={{ fontSize:12, color:"#9CA3AF", marginTop:2 }}>{app.appliedDate}</div>}
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <ScorePill score={app.keywordScore} />
                  <Badge status={app.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────
export default function JobTracker() {
  const { data: session } = useSession();
  const [apps, setApps]       = useState([]);
  const [settings, setSettings] = useState({
    baseResumeUrl:"", resumeFolderId:"", clFolderId:"",
    name:"", location:"", phone:"", email:"", linkedin:"", website:"",
  });

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const savedApps     = localStorage.getItem("jt_apps");
      const savedSettings = localStorage.getItem("jt_settings");
      if (savedApps)     setApps(JSON.parse(savedApps));
      if (savedSettings) setSettings(JSON.parse(savedSettings));
    } catch {}
  }, []);

  // Persist apps on change
  useEffect(() => {
    try { localStorage.setItem("jt_apps", JSON.stringify(apps)); } catch {}
  }, [apps]);

  const [tab, setTab]               = useState("tracker");
  const [showAdd, setShowAdd]       = useState(false);
  const [editApp, setEditApp]       = useState(null);
  const [detailApp, setDetailApp]   = useState(null);
  const [chatInfo, setChatInfo]     = useState(null);
  const [filterStatus, setFilterStatus] = useState("All");
  const [search, setSearch]         = useState("");
  const nextId = useRef(Math.max(0, ...apps.map(a => a.id || 0)) + 1);

  function saveSettings(s) {
    setSettings(s);
    try { localStorage.setItem("jt_settings", JSON.stringify(s)); } catch {}
    alert("Settings saved!");
  }

  function saveApp(data) {
    if (data.id) {
      setApps(prev => prev.map(a => a.id === data.id ? data : a));
    } else {
      setApps(prev => [...prev, { ...data, id: nextId.current++ }]);
    }
  }

  function deleteApp(id) { setApps(prev => prev.filter(a => a.id !== id)); }

  function updateChecklist(id, checklist) {
    setApps(prev => prev.map(a => a.id === id ? { ...a, checklist } : a));
  }

  const filtered = apps.filter(a => {
    const matchStage  = filterStatus === "All" || a.status === filterStatus;
    const matchSearch = !search || a.company?.toLowerCase().includes(search.toLowerCase()) || a.role?.toLowerCase().includes(search.toLowerCase());
    return matchStage && matchSearch;
  });

  const overdueCount = apps.filter(isOverdue).length;
  const counts = STAGES.reduce((acc, stage) => {
    acc[stage] = apps.filter(x => x.status === stage).length;
    return acc;
  }, {});

  return (
    <>
      <Head>
        <title>Job Tracker</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📋</text></svg>" />
      </Head>
      <div style={{ minHeight:"100vh", background:"#F7F7F9" }}>
        {/* Header */}
        <div style={{ background:"#0F0F1A", padding:"0 32px" }}>
          <div style={{ maxWidth:1100, margin:"0 auto" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", paddingTop:22, paddingBottom:16, flexWrap:"wrap", gap:12 }}>
              <div>
                <h1 style={{ margin:0, fontFamily:"'Fraunces',serif", fontSize:24, color:"#fff", fontWeight:700, letterSpacing:"-0.02em" }}>
                  Job Tracker
                  <span style={{ fontSize:12, color:"#6366F1", fontFamily:"'DM Sans',sans-serif", fontWeight:600, marginLeft:6, verticalAlign:"middle", background:"rgba(99,102,241,0.15)", padding:"2px 8px", borderRadius:20 }}>AI</span>
                </h1>
                <p style={{ margin:"3px 0 0", color:"#6B7280", fontSize:13 }}>
                  {apps.length} application{apps.length !== 1 ? "s" : ""}
                  {overdueCount > 0 && <span style={{ color:"#F87171", marginLeft:8 }}>· {overdueCount} follow-up{overdueCount !== 1 ? "s" : ""} overdue</span>}
                </p>
              </div>
              <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                {session ? (
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <span style={{ fontSize:12, color:"#6B7280" }}>{session.user?.name?.split(" ")[0]}</span>
                    <Btn variant="ghost" style={{ fontSize:12, padding:"6px 12px", color:"#6B7280", borderColor:"#2D2D44" }} onClick={() => signOut()}>Sign out</Btn>
                  </div>
                ) : (
                  <Btn variant="ghost" style={{ fontSize:12, padding:"6px 12px", color:"#9CA3AF", borderColor:"#2D2D44" }} onClick={() => signIn("google")}>
                    Connect Google Drive
                  </Btn>
                )}
                <Btn variant="accent" onClick={() => setShowAdd(true)}>+ New Application</Btn>
              </div>
            </div>
            {/* Tabs */}
            <div style={{ display:"flex", gap:2 }}>
              {[{id:"tracker",label:"Tracker"},{id:"dashboard",label:"Dashboard"},{id:"settings",label:"Settings"}].map(t => (
                <button key={t.id} onClick={() => setTab(t.id)} style={{ padding:"11px 18px", border:"none", background:"none", cursor:"pointer", fontSize:13, fontWeight:600, fontFamily:"inherit", color: tab === t.id ? "#fff" : "#6B7280", borderBottom: tab === t.id ? "2px solid #6366F1" : "2px solid transparent", transition:"all 0.15s" }}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Content */}
        <div style={{ maxWidth:1100, margin:"0 auto", padding:"28px 32px" }}>
          {tab === "settings" && (
            <SettingsTab settings={settings} onChange={saveSettings} driveConnected={!!session} onConnectDrive={() => signIn("google")} onDisconnectDrive={() => signOut()} />
          )}
          {tab === "dashboard" && <Dashboard apps={apps} />}
          {tab === "tracker" && (
            <>
              {!session && (
                <div style={{ background:"#FEF9C3", border:"1.5px solid #FDE68A", borderRadius:10, padding:"12px 18px", marginBottom:20, fontSize:13, color:"#854D0E", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:10 }}>
                  <span>⚡ Connect Google Drive to enable auto-saving tailored resumes and cover letters.</span>
                  <Btn variant="secondary" onClick={() => signIn("google")} style={{ fontSize:12, padding:"6px 14px" }}>Connect now</Btn>
                </div>
              )}
              {!settings.baseResumeUrl && (
                <div style={{ background:"#EEF2FF", border:"1.5px solid #C7D2FE", borderRadius:10, padding:"12px 18px", marginBottom:20, fontSize:13, color:"#4338CA", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:10 }}>
                  <span>📄 Add your base resume URL in Settings to enable AI tailoring.</span>
                  <Btn variant="secondary" onClick={() => setTab("settings")} style={{ fontSize:12, padding:"6px 14px" }}>Go to Settings</Btn>
                </div>
              )}
              {/* Filters */}
              <div style={{ display:"flex", gap:8, marginBottom:20, flexWrap:"wrap", alignItems:"center" }}>
                {["All", ...STAGES].map(stage => (
                  <button key={stage} onClick={() => setFilterStatus(stage)} style={{ padding:"6px 14px", borderRadius:20, cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:600, border: `1.5px solid ${filterStatus === stage ? "#6366F1" : "#E5E7EB"}`, background: filterStatus === stage ? "#EEF2FF" : "#fff", color: filterStatus === stage ? "#4338CA" : "#6B7280", transition:"all 0.15s" }}>
                    {stage}{stage !== "All" && counts[stage] > 0 ? ` (${counts[stage]})` : ""}
                  </button>
                ))}
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" style={{ ...s.input, width:180, marginLeft:"auto", fontSize:13, padding:"7px 12px" }} />
              </div>
              {/* Table */}
              {filtered.length === 0 ? (
                <div style={{ ...s.card, padding:"64px 0", textAlign:"center" }}>
                  <div style={{ fontSize:40, marginBottom:12 }}>📋</div>
                  <div style={{ fontSize:16, fontWeight:600, color:"#374151", marginBottom:6 }}>No applications yet</div>
                  <div style={{ fontSize:13, color:"#9CA3AF" }}>Click "New Application" to get started</div>
                </div>
              ) : (
                <div style={{ ...s.card, overflow:"hidden" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse" }}>
                    <thead>
                      <tr style={{ background:"#F9FAFB", borderBottom:"1.5px solid #F3F4F6" }}>
                        {["Company","Role","Status","Match","Applied","Follow-up","Progress","Docs",""].map(h => (
                          <th key={h} style={{ padding:"11px 16px", textAlign:"left", fontSize:11, fontWeight:700, color:"#9CA3AF", letterSpacing:"0.06em", textTransform:"uppercase", whiteSpace:"nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((app, i) => {
                        const od        = isOverdue(app);
                        const checkDone = app.checklist ? Object.values(app.checklist).filter(Boolean).length : 0;
                        return (
                          <tr key={app.id} style={{ borderBottom: i < filtered.length - 1 ? "1px solid #F3F4F6" : "none", background: od ? "#FFFBF0" : "transparent", cursor:"pointer" }}
                            onMouseEnter={e => e.currentTarget.style.background = od ? "#FFF5DC" : "#FAFAFA"}
                            onMouseLeave={e => e.currentTarget.style.background = od ? "#FFFBF0" : "transparent"}>
                            <td style={{ padding:"13px 16px", fontWeight:700, fontSize:14, color:"#111827" }} onClick={() => setDetailApp(app)}>{app.company}</td>
                            <td style={{ padding:"13px 16px", fontSize:13, color:"#6B7280" }} onClick={() => setDetailApp(app)}>{app.role}</td>
                            <td style={{ padding:"13px 16px" }} onClick={() => setDetailApp(app)}><Badge status={app.status} /></td>
                            <td style={{ padding:"13px 16px" }} onClick={() => setDetailApp(app)}><ScorePill score={app.keywordScore} /></td>
                            <td style={{ padding:"13px 16px", fontSize:12, color:"#9CA3AF" }} onClick={() => setDetailApp(app)}>{app.appliedDate || "—"}</td>
                            <td style={{ padding:"13px 16px", fontSize:12, color: od ? "#D97706" : "#9CA3AF", fontWeight: od ? 700 : 400 }} onClick={() => setDetailApp(app)}>
                              {app.followUpDate ? (od ? "⚠ " + app.followUpDate : app.followUpDate) : "—"}
                            </td>
                            <td style={{ padding:"13px 16px" }} onClick={() => setDetailApp(app)}>
                              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                                <div style={{ width:60, height:5, background:"#F3F4F6", borderRadius:3, overflow:"hidden" }}>
                                  <div style={{ height:"100%", width:`${(checkDone / CHECKLIST_ITEMS.length) * 100}%`, background:"#6366F1", borderRadius:3 }} />
                                </div>
                                <span style={{ fontSize:11, color:"#9CA3AF" }}>{checkDone}/{CHECKLIST_ITEMS.length}</span>
                              </div>
                            </td>
                            <td style={{ padding:"13px 16px" }}>
                              <div style={{ display:"flex", gap:5 }}>
                                {app.resumeLink      && <a href={app.resumeLink}      target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ fontSize:11, color:"#4338CA", fontWeight:700, background:"#EEF2FF", padding:"3px 8px", borderRadius:6 }}>CV</a>}
                                {app.coverLetterLink && <a href={app.coverLetterLink} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ fontSize:11, color:"#4338CA", fontWeight:700, background:"#EEF2FF", padding:"3px 8px", borderRadius:6 }}>CL</a>}
                              </div>
                            </td>
                            <td style={{ padding:"13px 16px" }}>
                              <div style={{ display:"flex", gap:6 }}>
                                <button onClick={() => setDetailApp(app)} style={{ padding:"5px 10px", fontSize:11, border:"1.5px solid #E5E7EB", borderRadius:7, background:"none", cursor:"pointer", fontFamily:"inherit", color:"#374151", fontWeight:600 }}>View</button>
                                <button onClick={e => { e.stopPropagation(); setEditApp(app); }} style={{ padding:"5px 10px", fontSize:11, border:"none", borderRadius:7, background:"#F3F4F6", cursor:"pointer", fontFamily:"inherit", color:"#374151", fontWeight:600 }}>Edit</button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Modals */}
      {showAdd && <AddAppModal settings={settings} onSave={saveApp} onClose={() => setShowAdd(false)} />}
      {editApp && (
        <Modal title="Edit Application" onClose={() => setEditApp(null)} width={580}>
          <EditForm app={editApp} onSave={a => { saveApp(a); setEditApp(null); }} onClose={() => setEditApp(null)} />
        </Modal>
      )}
      {detailApp && !editApp && !chatInfo && (
        <AppDetail
          app={detailApp}
          onClose={() => setDetailApp(null)}
          onEdit={a => { setDetailApp(null); setEditApp(a); }}
          onDelete={id => { deleteApp(id); setDetailApp(null); }}
          onOpenChat={docType => { setChatInfo({ app: detailApp, docType }); setDetailApp(null); }}
          onChecklistChange={updateChecklist}
        />
      )}
      {chatInfo && (
        <ChatEditor
          app={chatInfo.app}
          docType={chatInfo.docType}
          onClose={() => setChatInfo(null)}
          onUpdate={(docType, content) => {
            const key = docType === "resume" ? "tailoredResume" : "coverLetter";
            setApps(prev => prev.map(a => a.id === chatInfo.app.id ? { ...a, [key]: content } : a));
          }}
        />
      )}
    </>
  );
}
