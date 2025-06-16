import express from "express";
import { createClient } from "@supabase/supabase-js";
import { ChapterAgent } from "../../src/agents/chapterAgent";
const log = require("pino")();

const router = express.Router();

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

const GENESIS_CHAPTER = {
  title: "Chapter 1: The Quest Begins",
  body: "In the age of myth, where legends were forged in the crucible of destiny, two brothers, known only by their gleaming crowns of flesh, stood at a crossroads. The world, vast and unknowing, awaited their first, fateful decision. This is the beginning of the Bald Brothers' saga."
};

router.post("/worlds/:id/arcs/:arcId/progress", async (req, res) => {
  try {
    log.info("Starting chapter generation for arc %s", req.params.arcId);

    // Fetch context for the agent
    const { data: previousChapters } = await supabase
      .from("beats")
      .select("body")
      .order("authored_at", { ascending: false })
      .limit(3);

    const { data: lastPollResult } = await supabase
      .from("polls")
      .select("question, options")
      .order("closes_at", { ascending: false })
      .limit(1);

    const prompt = `
      Continue the story based on the context.
      Previous Chapters: ${JSON.stringify(previousChapters)}
      Last Poll: ${JSON.stringify(lastPollResult)}
      Generate the next chapter in the Bald Brothers saga.
    `;
    
    const result = await ChapterAgent.run(prompt);
    
    if (!result.success || !result.output || (result.output as string).length < 20) {
      log.error("Chapter generation failed: %o", result);
      return res.status(500).json({ error: "Chapter generation failed" });
    }

    const output = result.output as string;
    log.info("Chapter generated %d chars", output.length);
    
    const { data, error } = await supabase.from("beats").insert({
      arc_id: req.params.arcId,
      body: output,
      authored_at: new Date()
    }).select().single();

    if (error) {
      log.error(error, "Failed to save chapter to Supabase");
      return res.status(500).json({ error: "Failed to save chapter" });
    }

    log.info("Chapter successfully saved to database with ID %s", data.id);
    res.json({ ok: true, body: output, id: data.id });
  } catch (error) {
    log.error(error, "Error in chapter generation endpoint");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Add endpoint to get the latest chapter
router.get("/beats/latest", async (req, res) => {
  try {
    const { data: chapters, error } = await supabase
      .from("beats")
      .select("id, body, authored_at")
      .order("authored_at", { ascending: false })
      .limit(1);

    if (error) {
      log.error(error, "Failed to fetch latest chapter, serving genesis.");
      return res.json(GENESIS_CHAPTER);
    }
    
    if (!chapters || chapters.length === 0) {
      return res.json(GENESIS_CHAPTER);
    }
    
    const { count } = await supabase.from("beats").select('*', { count: 'exact', head: true });
    
    // Add 1 to the count to account for the un-stored genesis chapter
    const chapterNumber = (count ?? 0) + 1;
    
    res.json({ title: `Chapter ${chapterNumber}: The Saga Continues`, body: chapters[0].body });
  } catch (err) {
    log.error(err, "Error fetching latest chapter");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;