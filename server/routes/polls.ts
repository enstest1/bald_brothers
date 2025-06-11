import express from "express";
import { createClient } from "@supabase/supabase-js";
import { v4 as uuidv4 } from "uuid";
const log = require("pino")();

const router = express.Router();

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// Get the currently open poll
router.get("/open", async (req, res) => {
  try {
    const { data: polls, error } = await supabase
      .from("polls")
      .select("*")
      .gt("closes_at", new Date().toISOString())
      .order("closes_at", { ascending: true })
      .limit(1);

    if (error) {
      log.error(error, "Failed to fetch open polls");
      return res.status(500).json({ error: "Failed to fetch polls" });
    }

    if (!polls || polls.length === 0) {
      return res.json({ poll: null });
    }

    const poll = polls[0];
    log.info("Retrieved open poll %s", poll.id);
    res.json({ poll });
  } catch (error) {
    log.error(error, "Error fetching open polls");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Vote on a poll
router.post("/:id/vote", async (req, res) => {
  try {
    const { choice } = req.body;
    const pollId = req.params.id;
    
    // Get or create client_id from cookie
    let clientId = req.cookies?.client_id;
    if (!clientId) {
      clientId = uuidv4();
      res.cookie("client_id", clientId, { 
        maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
        httpOnly: true 
      });
    }

    log.info("Processing vote for poll %s, client %s, choice %d", pollId, clientId, choice);

    // Validate choice (0=yes, 1=no)
    if (choice !== 0 && choice !== 1) {
      return res.status(400).json({ error: "Invalid choice. Must be 0 (yes) or 1 (no)" });
    }

    // Check if poll exists and is still open
    const { data: poll, error: pollError } = await supabase
      .from("polls")
      .select("*")
      .eq("id", pollId)
      .single();

    if (pollError || !poll) {
      log.error(pollError, "Poll not found: %s", pollId);
      return res.status(404).json({ error: "Poll not found" });
    }

    if (new Date(poll.closes_at) < new Date()) {
      return res.status(400).json({ error: "Poll is closed" });
    }

    // Insert or update vote (upsert)
    const { data, error } = await supabase
      .from("votes")
      .upsert({
        poll_id: pollId,
        client_id: clientId,
        choice: choice
      }, {
        onConflict: "poll_id,client_id"
      });

    if (error) {
      if (error.message.includes("duplicate")) {
        log.warn("Poll duplicate client_id %s", clientId);
        // Try to update existing vote
        const { error: updateError } = await supabase
          .from("votes")
          .update({ choice })
          .eq("poll_id", pollId)
          .eq("client_id", clientId);
        
        if (updateError) {
          log.error(updateError, "Failed to update vote");
          return res.status(500).json({ error: "Failed to record vote" });
        }
      } else {
        log.error(error, "Failed to record vote");
        return res.status(500).json({ error: "Failed to record vote" });
      }
    }

    log.info("Vote recorded successfully for client %s", clientId);
    res.json({ success: true, clientId });
  } catch (error) {
    log.error(error, "Error recording vote");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create a new poll
router.post("/create", async (req, res) => {
  try {
    const { question, closes_at } = req.body;
    
    log.info("Creating new poll: %s", question);

    const { data, error } = await supabase
      .from("polls")
      .insert({
        question,
        options: ["yes", "no"],
        closes_at: closes_at || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // Default: 1 week from now
      })
      .select()
      .single();

    if (error) {
      log.error(error, "Failed to create poll");
      return res.status(500).json({ error: "Failed to create poll" });
    }

    log.info("Poll created with ID %s", data.id);
    res.json({ poll: data });
  } catch (error) {
    log.error(error, "Error creating poll");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Close current poll and tally results
router.post("/close-current", async (req, res) => {
  try {
    log.info("Closing current poll and tallying results");

    // Get the most recent open poll
    const { data: polls, error: pollError } = await supabase
      .from("polls")
      .select("*")
      .gt("closes_at", new Date().toISOString())
      .order("closes_at", { ascending: true })
      .limit(1);

    if (pollError || !polls || polls.length === 0) {
      log.info("No open polls to close");
      return res.json({ message: "No open polls to close" });
    }

    const poll = polls[0];
    
    // Get vote counts
    const { data: votes, error: voteError } = await supabase
      .from("votes")
      .select("choice")
      .eq("poll_id", poll.id);

    if (voteError) {
      log.error(voteError, "Failed to fetch votes for poll %s", poll.id);
      return res.status(500).json({ error: "Failed to tally votes" });
    }

    const yesVotes = votes?.filter(v => v.choice === 0).length || 0;
    const noVotes = votes?.filter(v => v.choice === 1).length || 0;
    const totalVotes = yesVotes + noVotes;
    
    // Update poll to close it
    const { error: closeError } = await supabase
      .from("polls")
      .update({ closes_at: new Date().toISOString() })
      .eq("id", poll.id);

    if (closeError) {
      log.error(closeError, "Failed to close poll %s", poll.id);
      return res.status(500).json({ error: "Failed to close poll" });
    }

    const result = {
      pollId: poll.id,
      question: poll.question,
      totalVotes,
      results: {
        yes: yesVotes,
        no: noVotes,
        winner: yesVotes > noVotes ? "yes" : noVotes > yesVotes ? "no" : "tie"
      }
    };

    log.info("Poll %s closed. Results: %o", poll.id, result.results);
    res.json(result);
  } catch (error) {
    log.error(error, "Error closing poll");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;