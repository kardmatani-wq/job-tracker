import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { messages, system, max_tokens = 2000 } = req.body;

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens,
      ...(system ? { system } : {}),
      messages,
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    res.status(200).json({ text, content: response.content });
  } catch (error) {
    console.error("Claude API error:", error);
    res.status(500).json({ error: error.message || "Claude API error" });
  }
}
