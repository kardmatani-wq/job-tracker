import { google } from "googleapis";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";

function getDriveClient(accessToken) {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    return {
          drive: google.drive({ version: "v3", auth }),
          docs:  google.docs({ version: "v1", auth }),
    };
}

// ─── Helper: build batchUpdate requests for plain text insertion ──────────────
function buildInsertRequests(content) {
    const requests = [];
    const paragraphs = content.split("\n");
    let insertIndex = 1;
    for (let i = 0; i < paragraphs.length; i++) {
          const line = paragraphs[i];
          if (i === paragraphs.length - 1 && line === "") continue;
          requests.push({
                  insertText: {
                            location: { index: insertIndex },
                            text: line + (i < paragraphs.length - 1 ? "\n" : ""),
                  },
          });
          insertIndex += line.length + (i < paragraphs.length - 1 ? 1 : 0);
    }
    return requests;
}

// ─── Helper: get current doc length ───────────────────────────────────────────
async function getDocLength(docs, documentId) {
    const docRes = await docs.documents.get({ documentId });
    return docRes.data.body?.content?.reduce((acc, el) => {
          if (el.endIndex) return Math.max(acc, el.endIndex);
          return acc;
    }, 1) || 1;
}

export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
    if (!session?.accessToken) return res.status(401).json({ error: "Not authenticated with Google" });

  const { action, docId, folderId, title, content, sourceDocId, coverLetterData } = req.body;
    const { drive, docs } = getDriveClient(session.accessToken);

  try {
        // ── Read a Google Doc ────────────────────────────────────────────────────
      if (action === "readDoc") {
              const docRes = await docs.documents.get({ documentId: docId });
              const body = docRes.data.body?.content || [];
              let text = "";
              for (const el of body) {
                        if (el.paragraph) {
                                    for (const pe of el.paragraph.elements || []) {
                                                  if (pe.textRun?.content) text += pe.textRun.content;
                                    }
                        }
              }
              return res.status(200).json({ text: text.trim() });
      }

      // ── Copy base resume + replace content ────────────────────────────────────
      if (action === "copyAndTailorDoc") {
              // Try to copy the source doc; fall back to creating a fresh Google Doc
          // (copy fails if source is a .docx upload rather than a native Google Doc)
          let newDocId, url;
              try {
                        const copyRes = await drive.files.copy({
                                    fileId: sourceDocId,
                                    requestBody: { name: title, parents: folderId ? [folderId] : [] },
                                    fields: "id,webViewLink",
                        });
                        newDocId = copyRes.data.id;
                        url = copyRes.data.webViewLink;
              } catch (copyErr) {
                        // Source is not a native Google Doc (e.g. .docx) — create a fresh one
                const createRes = await drive.files.create({
                            requestBody: { name: title, mimeType: "application/vnd.google-apps.document", parents: folderId ? [folderId] : [] },
                            fields: "id,webViewLink",
                });
                        newDocId = createRes.data.id;
                        url = createRes.data.webViewLink;
              }

          // Step 1: delete all existing content (separate batchUpdate call)
          const docLength = await getDocLength(docs, newDocId);
              if (docLength > 2) {
                        await docs.documents.batchUpdate({
                                    documentId: newDocId,
                                    requestBody: {
                                                  requests: [{ deleteContentRange: { range: { startIndex: 1, endIndex: docLength - 1 } } }],
                                    },
                        });
              }

          // Step 2: insert the tailored content (separate batchUpdate call)
          if (content && content.trim()) {
                    await docs.documents.batchUpdate({
                                documentId: newDocId,
                                requestBody: {
                                              requests: [{ insertText: { location: { index: 1 }, text: content.trim() } }],
                                },
                    });
          }

          return res.status(200).json({ docId: newDocId, url });
      }

      // ── Create a plain text doc (resume fallback / generic) ───────────────────
      if (action === "createDoc") {
              const createRes = await drive.files.create({
                        requestBody: { name: title, mimeType: "application/vnd.google-apps.document", parents: folderId ? [folderId] : [] },
                        fields: "id,webViewLink",
              });
              const newDocId = createRes.data.id;
              const url = createRes.data.webViewLink;
              const requests = buildInsertRequests(content);
              if (requests.length > 0) {
                        await docs.documents.batchUpdate({ documentId: newDocId, requestBody: { requests } });
              }
              return res.status(200).json({ docId: newDocId, url });
      }

      // ── Create a professionally formatted cover letter doc ────────────────────
      if (action === "createCoverLetterDoc") {
              const d = coverLetterData || {};
              const today = d.date || new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

          const lines = [];
              lines.push({ text: d.senderName || "", bold: true, fontSize: 12 });
              if (d.senderLocation) lines.push({ text: d.senderLocation, bold: false, fontSize: 11 });
              const contactParts = [d.senderPhone, d.senderEmail, d.senderLinkedin, d.senderWebsite].filter(Boolean);
              if (contactParts.length > 0) lines.push({ text: contactParts.join(" | "), bold: false, fontSize: 11 });
              lines.push({ text: "", bold: false, fontSize: 11 });
              lines.push({ text: today, bold: false, fontSize: 11 });
              lines.push({ text: "", bold: false, fontSize: 11 });
              lines.push({ text: d.company || "", bold: true, fontSize: 11 });
              lines.push({ text: d.role || "", bold: false, fontSize: 11, italic: true });
              lines.push({ text: "", bold: false, fontSize: 11 });
              lines.push({ text: "Dear Hiring Manager,", bold: false, fontSize: 11 });
              lines.push({ text: "", bold: false, fontSize: 11 });
              const bodyParagraphs = (d.body || "").split(/\n\n+/).map(p => p.replace(/\n/g, " ").trim()).filter(Boolean);
              for (let i = 0; i < bodyParagraphs.length; i++) {
                        lines.push({ text: bodyParagraphs[i], bold: false, fontSize: 11 });
                        if (i < bodyParagraphs.length - 1) lines.push({ text: "", bold: false, fontSize: 11 });
              }
              lines.push({ text: "", bold: false, fontSize: 11 });
              lines.push({ text: "Warmly,", bold: false, fontSize: 11 });
              lines.push({ text: d.senderName || "", bold: false, fontSize: 11 });

          const createRes = await drive.files.create({
                    requestBody: { name: title, mimeType: "application/vnd.google-apps.document", parents: folderId ? [folderId] : [] },
                    fields: "id,webViewLink",
          });
              const newDocId = createRes.data.id;
              const url = createRes.data.webViewLink;

          const requests = [];
              let insertIndex = 1;
              const lineRanges = [];
              for (let i = 0; i < lines.length; i++) {
                        const line = lines[i];
                        const isLast = i === lines.length - 1;
                        const textWithNewline = line.text + (isLast ? "" : "\n");
                        requests.push({ insertText: { location: { index: insertIndex }, text: textWithNewline } });
                        lineRanges.push({ startIndex: insertIndex, endIndex: insertIndex + line.text.length, bold: !!line.bold, italic: !!line.italic, fontSize: line.fontSize || 11 });
                        insertIndex += textWithNewline.length;
              }
              if (requests.length > 0) {
                        await docs.documents.batchUpdate({ documentId: newDocId, requestBody: { requests } });
              }

          const formatRequests = [];
              for (const lr of lineRanges) {
                        if (lr.startIndex >= lr.endIndex) continue;
                        formatRequests.push({
                                    updateTextStyle: {
                                                  range: { startIndex: lr.startIndex, endIndex: lr.endIndex },
                                                  textStyle: { bold: lr.bold, italic: lr.italic || false, fontSize: { magnitude: lr.fontSize, unit: "PT" }, weightedFontFamily: { fontFamily: "Garamond", weight: 400 } },
                                                  fields: "bold,italic,fontSize,weightedFontFamily",
                                    },
                        });
              }
              for (let i = 0; i < lineRanges.length; i++) {
                        const lr = lineRanges[i];
                        formatRequests.push({
                                    updateParagraphStyle: {
                                                  range: { startIndex: lr.startIndex, endIndex: Math.max(lr.startIndex + 1, lr.endIndex) },
                                                  paragraphStyle: { lineSpacing: 115, spaceAbove: { magnitude: 0, unit: "PT" }, spaceBelow: { magnitude: 0, unit: "PT" }, indentStart: { magnitude: 0, unit: "PT" }, indentEnd: { magnitude: 0, unit: "PT" } },
                                                  fields: "lineSpacing,spaceAbove,spaceBelow,indentStart,indentEnd",
                                    },
                        });
              }
              formatRequests.push({
                        updateDocumentStyle: {
                                    documentStyle: { marginTop: { magnitude: 72, unit: "PT" }, marginBottom: { magnitude: 72, unit: "PT" }, marginLeft: { magnitude: 72, unit: "PT" }, marginRight: { magnitude: 72, unit: "PT" } },
                                    fields: "marginTop,marginBottom,marginLeft,marginRight",
                        },
              });
              if (formatRequests.length > 0) {
                        await docs.documents.batchUpdate({ documentId: newDocId, requestBody: { requests: formatRequests } });
              }
              return res.status(200).json({ docId: newDocId, url });
      }

      // ── Update an existing doc (plain text replacement) ───────────────────────
      if (action === "updateDoc") {
              const docLength = await getDocLength(docs, docId);
              if (docLength > 2) {
                        await docs.documents.batchUpdate({
                                    documentId: docId,
                                    requestBody: { requests: [{ deleteContentRange: { range: { startIndex: 1, endIndex: docLength - 1 } } }] },
                        });
              }
              const insertRequests = buildInsertRequests(content);
              if (insertRequests.length > 0) {
                        await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests: insertRequests } });
              }
              return res.status(200).json({ success: true });
      }

      return res.status(400).json({ error: "Unknown action" });
  } catch (error) {
        console.error("Drive API error:", error);
        res.status(500).json({ error: error.message || "Google Drive error" });
  }
}
