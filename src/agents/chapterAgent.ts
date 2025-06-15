import { FeatherAgent } from "feather-ai";
import { createClient } from "@supabase/supabase-js";
const log = require("pino")();

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

export const ChapterAgent = new FeatherAgent({
  model: "openai/gpt-4o-mini",
  // max_tokens is not a valid property for FeatherAgent config; control token usage in prompt or agent config if supported
  systemPrompt: `You are the Bald Brothers Scribe, a master storyteller tasked with continuing the epic saga of the Bald Brothers. Your role is to generate compelling, engaging chapters that build upon the existing lore and narrative threads.

Guidelines:
- Write in a dramatic, engaging narrative style
- Maintain consistency with previous chapters and established lore
- When "yes" is selected in a poll, write a longer chapter (4-5 paragraphs, 800+ characters)
- When "no" is selected, write a shorter chapter (2-3 paragraphs, 400+ characters)
- Include vivid descriptions, character development, and plot progression
- End chapters on compelling notes that encourage readers to continue
- Consider the poll results when deciding the story direction
- For two-choice polls, incorporate the winning choice into the story naturally
- Always maintain the mystical and humorous tone of the Bald Brothers universe

You have access to tools to retrieve recent story context and save new chapters.`,
  tools: [
    {
      type: "function",
      function: {
        name: "get_recent",
        description: "Retrieve the last 3 chapters from the story",
        parameters: {
          type: "object",
          properties: {},
          required: []
        }
      },
      execute: async () => {
        log.info("Fetching last 3 chapters");
        const { data: chapters, error } = await supabase
          .from("beats")
          .select("*")
          .order("authored_at", { ascending: false })
          .limit(3);
        
        if (error) {
          log.error((error as Error).message || String(error), "Failed to fetch recent chapters");
          return [];
        }
        
        return chapters || [];
      }
    },
    {
      type: "function",
      function: {
        name: "get_poll_results",
        description: "Get the results of the most recent poll",
        parameters: {
          type: "object",
          properties: {},
          required: []
        }
      },
      execute: async () => {
        log.info("Fetching recent poll results");
        const { data: polls, error } = await supabase
          .from("polls")
          .select("*")
          .order("closes_at", { ascending: false })
          .limit(1);
        
        if (error) {
          log.error((error as Error).message || String(error), "Failed to fetch poll results");
          return null;
        }
        
        return polls?.[0] || null;
      }
    },
    {
      type: "function",
      function: {
        name: "save_chapter",
        description: "Save the generated chapter to the database",
        parameters: {
          type: "object",
          properties: {
            body: {
              type: "string",
              description: "The chapter content"
            }
          },
          required: ["body"]
        }
      },
      execute: async (args: Record<string, any>) => {
        const { body } = args as { body: string };
        log.info("Saving new chapter via agent tool");
        const { data, error } = await supabase
          .from("beats")
          .insert({
            arc_id: "1", // Main story arc
            body,
            authored_at: new Date()
          })
          .select()
          .single();
        if (error) {
          log.error((error as Error).message || String(error), "Failed to save chapter");
          throw error;
        }
        return data;
      }
    }
  ]
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