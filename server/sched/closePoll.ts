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
    // Use the ChapterAgent to generate two different story options
    const result = await ChapterAgent.run(`Based on this chapter:\n"${chapterContent}"\n\nGenerate two different story options for the next chapter. One should be a darker turn, and one should be more focused on the Bald Brothers' journey. Format the response as:{\n  \"question\": \"What path should the Bald Brothers take?\",\n  \"choices\": [\"Option 1\", \"Option 2\"]\n}`);
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

/**
 * Closes the current poll, tallies votes, stores results, triggers chapter generation,
 * and creates the next poll. This ensures a continuous poll-chapter branching loop.
 * All major steps are logged for robust observability.
 */
export async function closePollAndTally() {
  try {
    log.info("[Scheduler] Triggered scheduled poll closure (every 10s)");

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

    if (!polls || polls.length === 0) {
      log.info("[Scheduler] No open polls to close");
      return;
    }

    const poll = polls[0];
    const pollType = (poll.options.length === 2 && poll.options[0] === "yes" && poll.options[1] === "no") ? "yes/no" : "two-choice";
    log.info(`[Scheduler] Closing poll ${poll.id} (${pollType}): ${poll.question}`);

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

    // Only generate a chapter after a two-choice poll
    if (pollType === "two-choice") {
      try {
        log.info(`[Scheduler] Triggering chapter generation for poll ${poll.id}, winning option: ${winner.option}`);
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
        const chapterData: any = await chapterResponse.json();
        const chapterPreview = typeof chapterData.body === 'string' ? chapterData.body.slice(0, 100) : '[no body]';
        log.info(`[Scheduler] Chapter generated for poll ${poll.id}, winning option: ${winner.option} | Chapter: ${chapterPreview}`);
      } catch (chapterError) {
        log.error((chapterError as any)?.message || String(chapterError), "Failed to trigger chapter generation after poll closure");
      }
    } else {
      log.info(`[Scheduler] Skipping chapter generation for yes/no poll ${poll.id}`);
    }

    // Create the next poll based on the current poll type
    try {
      let pollOptions;
      let pollQuestion;

      if (pollType === "yes/no") {
        // After yes/no, create a two-choice poll
        const { data: latestChapter, error: chapterError } = await supabase
          .from("beats")
          .select("*")
          .order("authored_at", { ascending: false })
          .limit(1)
          .single();

        if (chapterError || !latestChapter) {
          pollQuestion = "What path should the Bald Brothers take?";
          pollOptions = ["Seek the ancient bald scrolls in the dark temple", "Train with the wise bald masters in the mountains"];
          log.info("[Scheduler] No chapter found, using default story options poll");
        } else {
          const options = await generateStoryOptions(latestChapter.body);
          pollQuestion = options.question;
          pollOptions = options.choices;
          log.info("[Scheduler] Generated new story options poll from latest chapter");
        }
      } else {
        // After two-choice, create a yes/no poll
        pollQuestion = "Should the Bald Brothers continue their quest?";
        pollOptions = ["yes", "no"];
        log.info("[Scheduler] Creating new yes/no poll");
      }

      // Always use 10s poll duration for now (testing)
      const pollDuration = 10 * 1000;
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
      const nextPollType = (pollOptions.length === 2 && pollOptions[0] === "yes" && pollOptions[1] === "no") ? "yes/no" : "two-choice";
      log.info(`[Scheduler] New poll created with ID ${newPoll.id} (${nextPollType}) and options ${JSON.stringify(pollOptions)}`);
    } catch (newPollError) {
      log.error((newPollError as any)?.message || String(newPollError), "Failed to create new poll");
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