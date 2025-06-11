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

router.post("/worlds/:id/arcs/:arcId/progress", async (req, res) => {
  try {
    log.info("Starting chapter generation for arc %s", req.params.arcId);
    
    // Run the chapter agent to generate new content
    const result = await ChapterAgent.run("Generate the next chapter in the Bald Brothers saga");
    
    if (!result.success) {
      log.error("Chapter generation failed: %o", result);
      return res.status(500).json({ error: "Chapter generation failed" });
    }

    const output = result.output as string;
    log.info("Chapter generated %d chars", output.length);
    
    // Save the chapter to Supabase
    const { data, error } = await supabase.from("beats").insert({
      arc_id: req.params.arcId,
      body: output,
      authored_at: new Date()
    });

    if (error) {
      log.error(error, "Failed to save chapter to Supabase");
      return res.status(500).json({ error: "Failed to save chapter" });
    }

    log.info("Chapter successfully saved to database");
    res.json({ ok: true, body: output });
  } catch (error) {
    log.error(error, "Error in chapter generation endpoint");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;