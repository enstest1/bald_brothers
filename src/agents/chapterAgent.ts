import { FeatherAgent } from "feather-ai";
import { createClient } from "@supabase/supabase-js";
const log = require("pino")();

export const ChapterAgent = new FeatherAgent({
  model: "openai/gpt-4o-mini",
  // max_tokens is included to control costs; remove if not supported by FeatherAgent
  max_tokens: 4096,
  systemPrompt: `You are the Bald Brothers Scribe, a master storyteller tasked with continuing the epic saga of the Bald Brothers. Your role is to generate a compelling, engaging chapter that builds upon the existing lore and narrative threads.

Guidelines:
- Write in a dramatic, engaging narrative style.
- Maintain consistency with previous chapters and established lore.
- For two-choice polls, incorporate the winning choice into the story naturally.
- Always maintain the mystical and humorous tone of the Bald Brothers universe.
- Your output should be ONLY the body of the chapter. Do NOT include a title or any other text.`
  // No tools: the agent's only job is to generate text.
});

/**
 * Ensures the agent always returns a valid chapter body and title.
 * If generation fails, returns fallback content.
 */
export async function safeGenerateChapter(prompt: string): Promise<{ title: string, body: string }> {
  try {
    const result = await ChapterAgent.run(prompt);
    if (result.success && result.output && typeof result.output === 'string' && result.output.length > 20) {
      // Try to parse for title/body if possible
      let title = 'New Chapter';
      let body = result.output;
      // Simple parse: if output contains a title line
      const match = result.output.match(/^(Chapter [^:]+: [^\n]+)\n([\s\S]*)/);
      if (match) {
        title = match[1].trim();
        body = match[2].trim();
      }
      return { title, body };
    }
    throw new Error('Invalid or empty output from agent');
  } catch (err) {
    // Fallback content
    return {
      title: 'A Lost Chapter',
      body: 'The Bald Brothers continue their journey, but the details are lost to legend. The story will resume with the next decision.'
    };
  }
}