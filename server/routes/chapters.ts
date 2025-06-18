import express from "express";
import { createClient } from "@supabase/supabase-js";
import { ChapterAgent } from "../../src/agents/chapterAgent";
const log = require("pino")();

// Create two separate routers
const publicChaptersRouter = express.Router();
const protectedChaptersRouter = express.Router();

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// This is our hardcoded first chapter, which acts as the genesis block.
const GENESIS_CHAPTER = {
  title: "Chapter 1: The Quest Begins",
  body: "In the age of myth, where legends were forged in the crucible of destiny, two brothers, known only by their gleaming crowns of flesh, stood at a crossroads. The world, vast and unknowing, awaited their first, fateful decision."
};

// This endpoint is for generating new chapters and should be protected.
protectedChaptersRouter.post("/worlds/:id/arcs/:arcId/progress", async (req, res) => {
  try {
    log.info("Starting chapter generation for arc %s", req.params.arcId);
    
    // For simplicity in testing, we'll use a hardcoded response here too.
    const hardcodedBody = "A new chapter unfolds, born from a direct call to the progress endpoint.";
    
    const { data, error } = await supabase.from("beats").insert({
      arc_id: req.params.arcId,
      body: hardcodedBody,
      authored_at: new Date()
    }).select().single();

    if (error) {
      log.error(error, "Failed to save chapter to Supabase");
      return res.status(500).json({ error: "Failed to save chapter" });
    }

    log.info("Chapter successfully saved to database with ID %s", data.id);
    res.json({ ok: true, body: hardcodedBody, id: data.id });
  } catch (error) {
    log.error(error, "Error in chapter generation endpoint");
    res.status(500).json({ error: "Internal server error" });
  }
});

// This endpoint gets the latest chapter and should be public.
publicChaptersRouter.get("/latest", async (req, res) => {
  try {
    const { data: chapters, error } = await supabase
      .from("beats")
      .select("id, body")
      .order("authored_at", { ascending: false })
      .limit(1);

    if (error) {
      log.error(error, "Failed to fetch latest chapter, serving genesis.");
      return res.status(200).json(GENESIS_CHAPTER);
    }
    
    if (!chapters || chapters.length === 0) {
      log.info("No chapters found in DB, serving genesis chapter.");
      return res.status(200).json(GENESIS_CHAPTER);
    }
    
    const { count } = await supabase.from("beats").select('*', { count: 'exact', head: true });
    const chapterNumber = (count ?? 0);
    
    res.json({ title: `Chapter ${chapterNumber}: The Saga Continues`, body: chapters[0].body });
  } catch (err) {
    log.error(err, "Unhandled error fetching latest chapter, serving genesis as fallback.");
    res.status(200).json(GENESIS_CHAPTER);
  }
});

// Export both routers
export { publicChaptersRouter, protectedChaptersRouter };