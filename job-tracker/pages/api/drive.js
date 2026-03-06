import { google } from "googleapis";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";

function getDriveClient(accessToken) {
      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: accessToken });
      return {
              drive: google.drive({ version: "v3", auth }),
              docs: google.docs({ version: "v1", auth }),
      };
}

// ─── Helper: get current doc length ───────────────────────────────────────────
async function getDocLength(docs, documentId) {
      const docRes = await docs.documents.get({ documentId });
      return docRes.data.body?.content?.reduce((acc, el) => {
              if (el.endIndex) return Math.max(acc, el.endIndex);
              return acc;
      }, 1) || 1;
}

// ─── Helper: extract all paragraph text strings from a doc ───────────────────
async function getDocParagraphs(docs, documentId) {
      const docRes = await docs.documents.get({ documentId });
      const body = docRes.data.body?.content || [];
      const paragraphs = [];
      for (const el of body) {
              if (el.paragraph) {
                        let text = "";
                        for (const pe of el.paragraph.elements || []) {
                                    if (pe.textRun?.content) text += pe.textRun.content;
                        }
                        // Strip trailing newline for matching purposes
                const trimmed = text.replace(/\n$/, "").trim();
                        if (trimmed.length > 0) paragraphs.push(trimmed);
              }
              // Handle table cells too
        if (el.table) {
                  for (const row of el.table.tableRows || []) {
                              for (const cell of row.tableCells || []) {
                                            for (const cellEl of cell.content || []) {
                                                            if (cellEl.paragraph) {
                                                                              let text = "";
                                                                              for (const pe of cellEl.paragraph.elements || []) {
                                                                                                  if (pe.textRun?.content) text += pe.textRun.content;
                                                                              }
                                                                              const trimmed = text.replace(/\n$/, "").trim();
                                                                              if (trimmed.length > 0) paragraphs.push(trimmed);
                                                            }
                                            }
                              }
                  }
        }
      }
      return paragraphs;
}

export default async function handler(req, res) {
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
      if (!session?.accessToken) return res.status(401).json({ error: "Not authenticated with Google" });

  const { action, docId, folderId, title, content, sourceDocId, replacements, coverLetterData } = req.body;
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

        // ── Read a Google Doc and return all paragraphs ──────────────────────────
        if (action === "readDocParagraphs") {
                  const paragraphs = await getDocParagraphs(docs, docId);
                  return res.status(200).json({ paragraphs });
        }

        // ── Copy base resume and replace text using replaceAllText (preserves formatting) ──
        if (action === "copyAndTailorDoc") {
                  // Step 1: Copy the source doc to preserve all formatting
            let newDocId, url;
                  const copyRes = await drive.files.copy({
                              fileId: sourceDocId,
                              requestBody: { name: title, parents: folderId ? [folderId] : [] },
                              fields: "id,webViewLink",
                  });
                  newDocId = copyRes.data.id;
                  url = copyRes.data.webViewLink;

            // Step 2: Apply text replacements using replaceAllText
            // replacements is an array of { oldText, newText } pairs
            if (replacements && replacements.length > 0) {
                        const requests = replacements
                          .filter(r => r.oldText && r.newText && r.oldText.trim() !== r.newText.trim())
                          .map(r => ({
                                          replaceAllText: {
                                                            containsText: { text: r.oldText, matchCase: true },
                                                            replaceText: r.newText,
                                          },
                          }));
                        if (requests.length > 0) {
                                      await docs.documents.batchUpdate({
                                                      documentId: newDocId,
                                                      requestBody: { requests },
                                      });
                        }
            }

            return res.status(200).json({ docId: newDocId, url });
        }

        // ── Create a plain text doc (cover letter fallback / generic) ─────────────
        if (action === "createDoc") {
                  const createRes = await drive.files.create({
                              requestBody: { name: title, mimeType: "application/vnd.google-apps.document", parents: folderId ? [folderId] : [] },
                              fields: "id,webViewLink",
                  });
                  const newDocId = createRes.data.id;
                  const url = createRes.data.webViewLink;
                  if (content && content.trim()) {
                              await docs.documents.batchUpdate({
                                            documentId: newDocId,
                                            requestBody: { requests: [{ insertText: { location: { index: 1 }, text: content.trim() } }] },
                              });
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

        // ── Update an existing doc using replaceAllText (preserves formatting) ────
        if (action === "updateDoc") {
                  if (replacements && replacements.length > 0) {
                              const requests = replacements
                                .filter(r => r.oldText && r.newText && r.oldText.trim() !== r.newText.trim())
                                .map(r => ({
                                                replaceAllText: {
                                                                  containsText: { text: r.oldText, matchCase: true },
                                                                  replaceText: r.newText,
                                                },
                                }));
                              if (requests.length > 0) {
                                            await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests } });
                              }
                  }
                  return res.status(200).json({ success: true });
        }

        return res.status(400).json({ error: "Unknown action" });

  } catch (error) {
          console.error("Drive API error:", error);
          res.status(500).json({ error: error.message || "Google Drive error" });
  }
}
