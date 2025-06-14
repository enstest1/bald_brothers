import cron from "node-cron";
import { createClient } from "@supabase/supabase-js";
import winston from 'winston';
import { cloud } from "../../src/lib/cloudClient";
import { ChapterAgent } from "../../src/agents/chapterAgent";

/**
 * Winston logger configuration for consistent, robust logging.
 */
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

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

/**
 * Helper to generate story poll options based on the latest chapter content.
 * Falls back to a default question if generation fails or no chapter exists.
 * @param {string} chapterContent - The latest chapter body
 * @returns {Promise<{question: string, choices: string[]}>}
 */
async function generateStoryOptions(chapterContent: string) {
  try {
    // Use the ChapterAgent to generate two concise story options
    const result = await ChapterAgent.run(`Based on this chapter:\n"${chapterContent}"\n\nGenerate two different story options for the next chapter. Each option should be a single sentence, no more than 150 characters. Format the response as:{\n  \"question\": \"What path should the Bald Brothers take?\",\n  \"choices\": [\"Option 1\", \"Option 2\"]\n}`);
    if (!result.success) throw new Error("Failed to generate story options");
    const options = JSON.parse(result.output as string);
    return { question: options.question, choices: options.choices };
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

// Helper to save a chapter with validation and fallback
async function saveChapterWithValidation(chapterData: { body?: string, title?: string }) {
  let body = chapterData?.body;
  let title = chapterData?.title || 'Untitled Chapter';
  if (!body || typeof body !== 'string' || body.trim().length < 10) {
    // Fallback content
    body = 'The Bald Brothers continue their journey, but the details are lost to legend. The story will resume with the next decision.';
    title = 'A Lost Chapter';
    log.warn('[Scheduler] Chapter generation failed, using fallback content.');
  }
  const { error } = await supabase.from('beats').insert({ arc_id: '1', body, title, authored_at: new Date() });
  if (error) {
    log.error((error as any)?.message || String(error), 'Failed to save chapter');
  } else {
    log.info(`[Scheduler] Chapter saved: ${title}`);
  }
}

/**
 * Closes the current poll, tallies votes, stores results, triggers chapter generation,
 * and creates the next poll. This ensures a continuous poll-chapter branching loop.
 * All major steps are logged for robust observability.
 */
export async function closePollAndTally() {
  try {
    log.info("[Scheduler] Triggered scheduled poll closure (every 10s)");

    // Check if any chapters exist
    const { data: chapters, error: chaptersError } = await supabase
      .from("beats")
      .select("*")
      .order("authored_at", { ascending: false })
      .limit(1);
    if (chaptersError) {
      log.error((chaptersError as any)?.message || String(chaptersError), "Failed to fetch chapters");
      return;
    }
    const hasChapters = chapters && chapters.length > 0;

    // Get the most recent open poll
    const { data: polls, error: pollError } = await supabase
      .from("polls")
      .select("*")
      .gt("closes_at", new Date().toISOString())
      .order("closes_at", { ascending: true })
      .limit(1);
    if (pollError) {
      log.error((pollError as any)?.message || String(pollError), "Failed to fetch open polls");
      return;
    }

    // If no open poll exists
    if (!polls || polls.length === 0) {
      if (!hasChapters) {
        // No chapters yet: create the initial yes/no poll
        log.info("[Scheduler] No chapters found, creating initial yes/no poll");
        const { data: newPoll, error: newPollError } = await supabase
          .from("polls")
          .insert({
            question: "Should the Bald Brothers begin their quest?",
            options: ["yes", "no"],
            closes_at: new Date(Date.now() + 30000) // 30 seconds
          })
          .select()
          .single();
        if (newPollError) {
          log.error((newPollError as any)?.message || String(newPollError), "Failed to create initial yes/no poll");
        } else {
          log.info(`[Scheduler] Initial yes/no poll created with ID ${newPoll.id}`);
        }
        return;
      } else {
        // Chapters exist, create a two-choice poll
        log.info("[Scheduler] No open poll, creating new two-choice poll");
        const latestChapter = chapters[0];
        let pollQuestion, pollOptions;
        try {
          const options = await generateStoryOptions(latestChapter.body);
          pollQuestion = options.question;
          pollOptions = options.choices;
        } catch (err) {
          pollQuestion = "What path should the Bald Brothers take?";
          pollOptions = ["Seek the ancient bald scrolls in the dark temple", "Train with the wise bald masters in the mountains"];
        }
        const { data: newPoll, error: newPollError } = await supabase
          .from("polls")
          .insert({
            question: pollQuestion,
            options: pollOptions,
            closes_at: new Date(Date.now() + 30000) // 30 seconds
          })
          .select()
          .single();
        if (newPollError) {
          log.error((newPollError as any)?.message || String(newPollError), "Failed to create two-choice poll");
        } else {
          log.info(`[Scheduler] New two-choice poll created with ID ${newPoll.id} and options ${JSON.stringify(pollOptions)}`);
        }
        return;
      }
    }

    // There is an open poll to close
    const poll = polls[0];
    const isYesNoPoll = poll.options.length === 2 && poll.options[0] === "yes" && poll.options[1] === "no";
    log.info(`[Scheduler] Closing poll ${poll.id} (${isYesNoPoll ? 'yes/no' : 'two-choice'}): ${poll.question}`);

    // Get vote counts for each option
    const { data: votes, error: voteError } = await supabase
      .from("votes")
      .select("choice")
      .eq("poll_id", poll.id);
    if (voteError) {
      log.error((voteError as any)?.message || String(voteError), `Failed to fetch votes for poll ${poll.id}`);
      return;
    }
    const options: string[] = poll.options;
    const counts = options.map((opt: string, idx: number) => ({
      option: opt,
      count: votes.filter((v: { choice: number }) => v.choice === idx).length
    }));
    const totalVotes = votes.length;
    const winner = counts.reduce((max, curr) => curr.count > max.count ? curr : max, counts[0]);
    log.info(`[Scheduler] Poll ${poll.id} closed. Results: ${JSON.stringify(counts)} | Winner: ${winner.option}`);

    // Close the poll in the DB
    const { error: closeError } = await supabase
      .from("polls")
      .update({ closes_at: new Date().toISOString() })
      .eq("id", poll.id);
    if (closeError) {
      log.error((closeError as any)?.message || String(closeError), `Failed to close poll ${poll.id}`);
      return;
    }

    // Store poll results in Bootoshi Cloud for agent context
    try {
      await cloud("add", {
        agent_id: "poll",
        run_id: "weekly",
        memories: `Poll closed: \"${poll.question}\". Results: ${JSON.stringify(counts)}. Winner: ${winner.option}`,
        store_mode: "vector",
        metadata: {
          pollId: poll.id,
          question: poll.question,
          totalVotes,
          results: counts,
          winner: winner.option,
          ts: Date.now(),
          type: "poll_result"
        },
        skip_extraction: true
      });
      log.info("[Scheduler] Poll results saved to Bootoshi Cloud");
    } catch (cloudError) {
      log.error((cloudError as any)?.message || String(cloudError), "Failed to save poll results to Bootoshi Cloud");
    }

    // If this was the initial yes/no poll and there are no chapters, generate the first chapter and then a two-choice poll
    if (isYesNoPoll && !hasChapters) {
      log.info(`[Scheduler] Generating first chapter after initial yes/no poll (poll ID: ${poll.id})`);
      try {
        const chapterResponse = await fetch(`${process.env.API_URL}/api/worlds/1/arcs/1/progress`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.API_TOKEN}`
          }
        });
        if (!chapterResponse.ok) {
          throw new Error(`Chapter generation failed: ${chapterResponse.statusText}`);
        }
        const chapterData = await chapterResponse.json() as unknown as { body?: string, title?: string };
        await saveChapterWithValidation(chapterData);
      } catch (chapterError) {
        log.error((chapterError as any)?.message || String(chapterError), "Failed to generate first chapter after yes/no poll");
        // Fallback: save a default chapter
        await saveChapterWithValidation({ body: '', title: '' });
      }
      // Now create the first two-choice poll
      const { data: latestChapter, error: chapterError } = await supabase
        .from("beats")
        .select("*")
        .order("authored_at", { ascending: false })
        .limit(1)
        .single();
      let pollQuestion, pollOptions;
      if (chapterError || !latestChapter) {
        pollQuestion = "What path should the Bald Brothers take?";
        pollOptions = ["Seek the ancient bald scrolls in the dark temple", "Train with the wise bald masters in the mountains"];
      } else {
        const options = await generateStoryOptions(latestChapter.body);
        pollQuestion = options.question;
        pollOptions = options.choices;
      }
      const { data: newPoll, error: newPollError } = await supabase
        .from("polls")
        .insert({
          question: pollQuestion,
          options: pollOptions,
          closes_at: new Date(Date.now() + 30000) // 30 seconds
        })
        .select()
        .single();
      if (newPollError) {
        log.error((newPollError as any)?.message || String(newPollError), "Failed to create first two-choice poll");
      } else {
        log.info(`[Scheduler] First two-choice poll created with ID ${newPoll.id} and options ${JSON.stringify(pollOptions)}`);
      }
      return;
    }

    // If this is a two-choice poll, generate a chapter and then another two-choice poll
    if (!isYesNoPoll) {
      log.info(`[Scheduler] Generating chapter after two-choice poll (poll ID: ${poll.id})`);
      let chapterSaved = false;
      try {
        const chapterResponse = await fetch(`${process.env.API_URL}/api/worlds/1/arcs/1/progress`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.API_TOKEN}`
          }
        });
        if (!chapterResponse.ok) {
          throw new Error(`Chapter generation failed: ${chapterResponse.statusText}`);
        }
        const chapterData = await chapterResponse.json() as unknown as { body?: string, title?: string };
        await saveChapterWithValidation(chapterData);
        // Confirm chapter is saved in DB
        const { data: latestChapter, error: chapterError } = await supabase
          .from("beats")
          .select("*")
          .order("authored_at", { ascending: false })
          .limit(1)
          .single();
        if (!chapterError && latestChapter && latestChapter.body === chapterData.body) {
          chapterSaved = true;
        } else {
          log.error("[Scheduler] Chapter not found in DB after generation");
        }
      } catch (chapterError) {
        log.error((chapterError as any)?.message || String(chapterError), "Failed to generate or save chapter");
        // Fallback: save a default chapter
        await saveChapterWithValidation({ body: '', title: '' });
      }
      if (!chapterSaved) {
        log.error("[Scheduler] Aborting poll creation: chapter not confirmed saved.");
        return;
      }
      // Now create the next two-choice poll
      let pollQuestion, pollOptions;
      try {
        const { data: latestChapter } = await supabase
          .from("beats")
          .select("*")
          .order("authored_at", { ascending: false })
          .limit(1)
          .single();
        if (!latestChapter) throw new Error("No latest chapter found");
        const options = await generateStoryOptions(latestChapter.body);
        pollQuestion = options.question;
        pollOptions = options.choices;
      } catch (err) {
        pollQuestion = "What path should the Bald Brothers take?";
        pollOptions = ["Seek the ancient bald scrolls in the dark temple", "Train with the wise bald masters in the mountains"];
      }
      const { data: newPoll, error: newPollError } = await supabase
        .from("polls")
        .insert({
          question: pollQuestion,
          options: pollOptions,
          closes_at: new Date(Date.now() + 30000) // 30 seconds
        })
        .select()
        .single();
      if (newPollError) {
        log.error((newPollError as any)?.message || String(newPollError), "Failed to create next two-choice poll");
      } else {
        log.info(`[Scheduler] Next two-choice poll created with ID ${newPoll.id} and options ${JSON.stringify(pollOptions)}`);
      }
      return;
    }

    // If this was a yes/no poll but chapters already exist, do nothing (should not happen)
    if (isYesNoPoll && hasChapters) {
      log.warn(`[Scheduler] Closed a yes/no poll but chapters already exist. No further action taken.`);
      return;
    }
  } catch (error) {
    log.error((error as any)?.message || String(error), "Error in scheduled poll closure");
  }
}

/**
 * Starts the poll scheduler to close polls and create new ones every 10 seconds (testing mode).
 * This ensures the poll-chapter loop is always running.
 */
export function startPollScheduler() {
  log.info("🤖🦾 [AI DEBUG] If you see this, the AI overlords have hijacked your poll scheduler! Polls will close every 10 seconds. Resistance is futile. [session:" + Date.now() + "]");
  cron.schedule("*/10 * * * * *", async () => {
    log.info("[Scheduler] Triggered scheduled poll closure (every 10s)");
    const startTime = Date.now();
    await closePollAndTally();
    const endTime = Date.now();
    log.info(`[Scheduler] Poll closure and next poll creation completed in ${endTime - startTime}ms`);
    // Add a small delay to avoid race conditions
    await new Promise(resolve => setTimeout(resolve, 60000)); // 60 seconds delay
  });
  log.info("[Scheduler] Poll scheduler started - will close polls every 10 seconds (testing mode)");
}

// Allow manual execution for testing
if (require.main === module) {
  log.info("Running poll closure manually");
  closePollAndTally().then(() => {
    log.info("Manual poll closure completed");
    process.exit(0);
  }).catch((error) => {
    log.error((error as any)?.message || String(error), "Manual poll closure failed");
    process.exit(1);
  });
}

// Ensure poll durations are at least 30s in dev/test
const pollDuration = process.env.NODE_ENV === 'production' ? 24 * 60 * 60 * 1000 : 30 * 1000;