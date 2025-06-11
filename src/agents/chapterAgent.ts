import { FeatherAgent } from "feather-ai";
import { cloud } from "../lib/cloudClient";
const log = require("pino")();

export const ChapterAgent = new FeatherAgent({
  model: "openai/gpt-4o-mini",
  systemPrompt: `You are the Bald Brothers Scribe, a master storyteller tasked with continuing the epic saga of the Bald Brothers. Your role is to generate compelling, engaging chapters that build upon the existing lore and narrative threads.

Guidelines:
- Write in a dramatic, engaging narrative style
- Maintain consistency with previous chapters and established lore
- Each chapter should be 400+ characters and advance the story meaningfully
- Include vivid descriptions, character development, and plot progression
- End chapters on compelling notes that encourage readers to continue

You have access to tools to retrieve recent story context and save new chapters.`,
  tools: [
    {
      type: "function",
      function: {
        name: "get_recent",
        description: "Retrieve the last 3 chapters/memories from the story canon",
        parameters: {
          type: "object",
          properties: {},
          required: []
        }
      },
      execute: async () => {
        log.info("Fetching last 3 memories");
        return await cloud("query", { agent_id: "chapter", run_id: "canon", limit: 3 });
      }
    },
    {
      type: "function",
      function: {
        name: "save",
        description: "Save the new chapter content to long-term memory",
        parameters: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "The chapter content to save"
            }
          },
          required: ["content"]
        }
      },
      execute: async (args: Record<string, any>) => {
        const { content } = args as { content: string };
        log.info("Saving new chapter to mem0");
        return await cloud("add", {
          agent_id: "chapter",
          run_id: "canon",
          memories: content,
          store_mode: "vector",
          metadata: { ts: Date.now() },
          skip_extraction: true
        });
      }
    }
  ]
});