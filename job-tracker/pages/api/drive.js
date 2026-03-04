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

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) return res.status(401).json({ error: "Not authenticated with Google" });

  const { action, docId, folderId, title, content, sourceDocId } = req.body;
  const { drive, docs } = getDriveClient(session.accessToken);

  try {
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

    if (action === "copyAndTailorDoc") {
      const copyRes = await drive.files.copy({
        fileId: sourceDocId,
        requestBody: {
          name: title,
          parents: folderId ? [folderId] : [],
        },
        fields: "id,webViewLink",
      });
      const newDocId = copyRes.data.id;
      const url = copyRes.data.webViewLink;

      const docRes = await docs.documents.get({ documentId: newDocId });
      const docLength = docRes.data.body?.content?.reduce((acc, el) => {
        if (el.endIndex) return Math.max(acc, el.endIndex);
        return acc;
      }, 1) || 1;

      const requests = [];
      if (docLength > 2) {
        requests.push({
          deleteContentRange: {
            range: { startIndex: 1, endIndex: docLength - 1 },
          },
        });
      }
      if (content && content.trim()) {
        requests.push({
          insertText: {
            location: { index: 1 },
            text: content.trim(),
          },
        });
      }
      if (requests.length > 0) {
        await docs.documents.batchUpdate({
          documentId: newDocId,
          requestBody: { requests },
        });
      }
      return res.status(200).json({ docId: newDocId, url });
    }

    if (action === "createDoc") {
      const createRes = await drive.files.create({
        requestBody: {
          name: title,
          mimeType: "application/vnd.google-apps.document",
          parents: folderId ? [folderId] : [],
        },
        fields: "id,webViewLink",
      });
      const newDocId = createRes.data.id;
      const url = createRes.data.webViewLink;

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
      if (requests.length > 0) {
        await docs.documents.batchUpdate({
          documentId: newDocId,
          requestBody: { requests },
        });
      }
      return res.status(200).json({ docId: newDocId, url });
    }

    if (action === "updateDoc") {
      const docRes = await docs.documents.get({ documentId: docId });
      const docLength = docRes.data.body?.content?.reduce((acc, el) => {
        if (el.endIndex) return Math.max(acc, el.endIndex);
        return acc;
      }, 1) || 1;

      const requests = [];
      if (docLength > 2) {
        requests.push({
          deleteContentRange: {
            range: { startIndex: 1, endIndex: docLength - 1 },
          },
        });
      }
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
      if (requests.length > 0) {
        await docs.documents.batchUpdate({
          documentId: docId,
          requestBody: { requests },
        });
      }
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: "Unknown action" });
  } catch (error) {
    console.error("Drive API error:", error);
    res.status(500).json({ error: error.message || "Google Drive error" });
  }
}
