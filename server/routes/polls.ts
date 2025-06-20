import express from "express";
import { createClient } from "@supabase/supabase-js";
import { v4 as uuidv4 } from "uuid";
import { cloud } from "../../src/lib/cloudClient";
import { ChapterAgent } from "../../src/agents/chapterAgent";
import winston from 'winston';

const router = express.Router();

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// Winston logger configuration
const log = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf((info) => {
      const { timestamp, level, message, ...meta } = info as { timestamp: string; level: string; message: string };
      return `${timestamp} [${level.toUpperCase()}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
  ],
});

// Ensure poll durations are at least 30s in dev/test
const pollDuration = process.env.NODE_ENV === 'production' ? 24 * 60 * 60 * 1000 : 30 * 1000;

const FIRST_POLL = {
    question: "What path shall the brothers take first?",
    options: ["Venture into the Whispering Woods", "Climb the Sun-Scorched Peaks"],
    closes_at: new Date(Date.now() + 120000) // 2 minutes
};

// Get the currently open poll (SIMPLIFIED)
router.get("/open", async (req, res) => {
  try {
    const { data: openPoll, error } = await supabase
      .from("polls")
      .select("*")
      .gt("closes_at", new Date().toISOString())
      .order("closes_at", { ascending: true })
      .limit(1)
      .single();

    // It's normal for no poll to be found (e.g., between cycles).
    // The .single() method throws an error in this case, which we can ignore.
    if (error && error.code !== 'PGRST116') {
        throw error;
    }

    res.json({ poll: openPoll || null });
  } catch (error) {
    log.error(error instanceof Error ? error.message : String(error), "Error in /polls/open endpoint");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Vote on a poll
router.post("/:id/vote", async (req, res) => {
  try {
    const { choice } = req.body;
    const pollId = req.params.id;
    let clientId = req.cookies?.client_id;
    if (!clientId) {
      clientId = uuidv4();
      res.cookie("client_id", clientId, { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: true });
    }
    const { data: poll } = await supabase.from("polls").select("closes_at").eq("id", pollId).single();
    if (!poll || new Date(poll.closes_at) < new Date()) {
      return res.status(400).json({ error: "Poll is closed" });
    }
    await supabase.from("votes").upsert({ poll_id: pollId, client_id: clientId, choice: choice }, { onConflict: "poll_id,client_id" });
    res.json({ success: true });
  } catch (error) {
    log.error(error instanceof Error ? error.message : String(error), "Error recording vote");
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
        closes_at: closes_at || new Date(Date.now() + pollDuration)
      })
      .select()
      .single();
    if (error) {
      log.error((error as any)?.message || String(error), "Failed to create poll");
      return res.status(500).json({ error: "Failed to create poll" });
    }
    log.info("Poll created with ID %s and options %o", data.id, ["yes", "no"]);
    res.json({ poll: data });
  } catch (error) {
    log.error((error as any)?.message || String(error), "Error creating poll");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Close current poll and create next poll
router.post("/close-current", async (req, res) => {
  try {
    // Get the most recent open poll
    const { data: polls, error: pollError } = await supabase
      .from("polls")
      .select("*")
      .gt("closes_at", new Date().toISOString())
      .order("closes_at", { ascending: true })
      .limit(1);

    if (pollError) {
      log.error((pollError as Error).message || String(pollError), "Failed to fetch open polls");
      return res.status(500).json({ error: "Internal server error" });
    }

    if (!polls || polls.length === 0) {
      return res.status(404).json({ error: "No open poll found" });
    }

    const poll = polls[0];
    const isYesNoPoll = poll.options.length === 2 && poll.options[0] === "yes" && poll.options[1] === "no";

    // Get vote counts
    const { data: votes, error: voteError } = await supabase
      .from("votes")
      .select("choice")
      .eq("poll_id", poll.id);

    if (voteError) {
      log.error((voteError as Error).message || String(voteError), "Failed to fetch votes");
      return res.status(500).json({ error: "Internal server error" });
    }

    // Tally votes
    const voteCounts = votes.reduce((acc, vote) => {
      acc[vote.choice] = (acc[vote.choice] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);

    const totalVotes = Object.values(voteCounts).reduce((sum, count) => sum + count, 0);
    const winner = Object.entries(voteCounts).reduce((a, b) => (b[1] > (a[1] || 0) ? b : a))[0];

    // Generate chapter based on poll results
    try {
      await robustGenerateAndSaveChapter(poll, winner, totalVotes);
    } catch (chapterError) {
      log.error((chapterError as Error).message || String(chapterError), "Failed to generate chapter");
      return res.status(500).json({ error: "Failed to generate chapter" });
    }

    // Create next poll
    try {
      const { data: latestChapter } = await supabase
        .from("beats")
        .select("*")
        .order("authored_at", { ascending: false })
        .limit(1)
        .single();

      let pollQuestion, pollOptions;
      if (isYesNoPoll && !latestChapter) {
        // First poll was yes/no and no chapters exist yet
        pollQuestion = "Should the Bald Brothers begin their quest?";
        pollOptions = ["yes", "no"];
      } else {
        // Generate two different story options based on the latest chapter
        const options = await generateStoryOptions(latestChapter.body);
        pollQuestion = options.question;
        pollOptions = options.choices;
      }

      const { data: newPoll, error: newPollError } = await supabase
        .from("polls")
        .insert({
          question: pollQuestion,
          options: pollOptions,
          closes_at: new Date(Date.now() + pollDuration)
        })
        .select()
        .single();

      if (newPollError) {
        throw newPollError;
      }

      log.info("New poll created with ID %s and options %o", newPoll.id, pollOptions);
      res.json({ 
        poll_closed: poll.id,
        new_poll: newPoll,
        results: {
          total_votes: totalVotes,
          winner: poll.options[parseInt(winner)],
          vote_counts: voteCounts
        }
      });
    } catch (newPollError) {
      log.error((newPollError as Error).message || String(newPollError), "Failed to create new poll");
      res.status(500).json({ error: "Failed to create new poll" });
    }
  } catch (error) {
    log.error((error as Error).message || String(error), "Error in poll closure");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get poll results (vote counts per option)
router.get("/:id/results", async (req, res) => {
  /**
   * @api {get} /polls/:id/results Get poll results (vote counts per option)
   * @apiDescription Returns the number of votes for each option in the poll.
   * @apiParam {String} id Poll ID
   * @apiSuccess {Object[]} results Array of { option, count }
   * @apiError (500) InternalServerError Failed to fetch poll results
   */
  try {
    const pollId = req.params.id;
    log.info("Fetching results for poll %s", pollId);

    const { data: poll, error: pollError } = await supabase
      .from("polls")
      .select("options")
      .eq("id", pollId)
      .single();
    if (pollError || !poll) {
      log.error((pollError as any)?.message || String(pollError), "Poll not found: %s", pollId);
      return res.status(404).json({ error: "Poll not found" });
    }
    const options = poll.options;

    const { data: votes, error: voteError } = await supabase
      .from("votes")
      .select("choice")
      .eq("poll_id", pollId);
    if (voteError) {
      log.error((voteError as any)?.message || String(voteError), "Failed to fetch votes for poll %s", pollId);
      return res.status(500).json({ error: "Failed to fetch votes" });
    }

    const counts = options.map((opt: string, idx: number) => ({
      option: opt,
      count: votes.filter((v: { choice: number }) => v.choice === idx).length
    })); 
    log.info("Poll %s results: %o", pollId, counts);
    res.json({ results: counts });
  } catch (error) {
    log.error(`Error fetching poll results: ${error instanceof Error ? error.message : String(error)}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Helper function to generate story options
async function generateStoryOptions(chapterContent: string) {
  try {
    // Use the ChapterAgent to generate two different story options
    const result = await ChapterAgent.run(`Based on this chapter:
    "${chapterContent}"
    
    Generate two different story options for the next chapter. One should be a darker turn, and one should be more focused on the Bald Brothers' journey. Format the response as:
    {
      "question": "What path should the Bald Brothers take?",
      "choices": ["Option 1", "Option 2"]
    }`);

    if (!result.success) {
      throw new Error("Failed to generate story options");
    }

    // Parse the response
    const options = JSON.parse(result.output as string);
    return {
      question: options.question,
      choices: options.choices
    };
  } catch (error) {
    log.error((error as any)?.message || String(error), "Failed to generate story options");
    // Fallback options if generation fails
    return {
      question: "What path should the Bald Brothers take?",
      choices: [
        "Seek the ancient bald scrolls in the dark temple",
        "Train with the wise bald masters in the mountains"
      ]
    };
  }
}

// Helper to robustly generate and save a chapter after poll closes
async function robustGenerateAndSaveChapter(poll: any, winner: string, totalVotes: number) {
  let chapterBody = '';
  try {
    // Try to generate chapter using AI agent
    const chapterResponse = await fetch(`${process.env.API_URL}/api/worlds/1/arcs/1/progress`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.API_TOKEN}`
      },
      body: JSON.stringify({
        poll_result: {
          question: poll.question,
          winner: poll.options[parseInt(winner)],
          total_votes: totalVotes
        }
      })
    });
    if (chapterResponse.ok) {
      const chapterData = await chapterResponse.json() as unknown as { body?: string, output?: string };
      chapterBody = chapterData.body || chapterData.output || '';
    }
  } catch (err) {
    log.error((err as Error).message || String(err), 'Error during chapter generation');
  }
  // Fallback if chapterBody is empty
  if (!chapterBody || chapterBody.length < 10) {
    chapterBody = 'The Bald Brothers continue their journey, but the details are lost to legend. The story will resume with the next decision.';
    log.warn('Chapter generation failed, using fallback content.');
  }
  // Save the chapter (no title field)
  const { error } = await supabase.from('beats').insert({
    arc_id: '1',
    body: chapterBody,
    authored_at: new Date()
  });
  if (error) {
    log.error((error as Error).message || String(error), 'Failed to save chapter');
  } else {
    log.info('Chapter saved to database');
  }
}

export default router;