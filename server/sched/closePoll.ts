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

// Add a lock to prevent concurrent executions
let isProcessingPollClosure = false;

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
async function saveChapterWithValidation(chapterData: { body?: string }) {
  let body = chapterData?.body;
  if (!body || typeof body !== 'string' || body.trim().length < 10) {
    // Fallback content
    body = 'The Bald Brothers continue their journey, but the details are lost to legend. The story will resume with the next decision.';
    log.warn('[Scheduler] Chapter generation failed, using fallback content.');
  }
  const { error } = await supabase.from('beats').insert({
    arc_id: '1',
    body,
    authored_at: new Date()
  });
  if (error) {
    log.error((error as any)?.message || String(error), 'Failed to save chapter');
    return false; // Indicate failure
  }
  log.info(`[Scheduler] Chapter saved successfully.`);
  return true; // Indicate success
}

/**
 * Closes the current poll, tallies votes, stores results, triggers chapter generation,
 * and creates the next poll. This ensures a continuous poll-chapter branching loop.
 * All major steps are logged for robust observability.
 */
export async function closePollAndTally() {
  if (isProcessingPollClosure) {
    log.info("[Scheduler] Poll closure is already running. Skipping.");
    return;
  }
  isProcessingPollClosure = true;
  log.info("[Scheduler] Starting poll closure process...");

  try {
    const { data: openPoll, error: pollError } = await supabase
      .from("polls")
      .select("*")
      .gt("closes_at", new Date().toISOString())
      .order("closes_at", { ascending: true })
      .limit(1)
      .single();

    if (pollError || !openPoll) {
      log.warn("[Scheduler] No open poll found to close.");
      // Create a new poll if none exist
      await createNextPoll();
      return;
    }

    // A poll is open, let's close it
    log.info(`[Scheduler] Closing poll ${openPoll.id}: "${openPoll.question}"`);

    // Tally votes
    const { data: votes, error: voteError } = await supabase.from("votes").select("choice").eq("poll_id", openPoll.id);
    if (voteError) throw new Error(`Failed to fetch votes: ${voteError.message}`);
    
    const voteCounts = (openPoll.options as string[]).map((option, index) => ({
      option,
      count: votes.filter(v => v.choice === index).length
    }));
    
    const winner = voteCounts.reduce((a, b) => (b.count > a.count ? b : a), { count: -1, option: voteCounts[0]?.option || 'Default' });
    log.info(`[Scheduler] Poll ${openPoll.id} closed. Winner: ${winner.option} with ${winner.count} votes.`);

    // Mark poll as closed in DB
    await supabase.from("polls").update({ closes_at: new Date().toISOString() }).eq("id", openPoll.id);
    
    // Generate and save the next chapter based on the poll result
    log.info(`[Scheduler] Generating chapter based on poll winner: "${winner.option}"`);
    const chapterResponse = await fetch(`${process.env.API_URL}/api/worlds/1/arcs/1/progress`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.API_TOKEN}`
        }
    });

    if (!chapterResponse.ok) {
        log.error(`[Scheduler] Chapter generation API call failed with status ${chapterResponse.status}.`);
        // Save a fallback chapter
        await saveChapterWithValidation({ body: '' });
    } else {
        const chapterData = await chapterResponse.json();
        log.info(`[Scheduler] Chapter generation successful.`);
        // The endpoint now saves the chapter, so no extra save is needed here.
    }
    
    // Create the next poll
    await createNextPoll();

  } catch (error) {
    log.error(error, "[Scheduler] Unhandled error in closePollAndTally");
  } finally {
    isProcessingPollClosure = false;
    log.info("[Scheduler] Finished poll closure process.");
  }
}

// ADD this new helper function inside server/sched/closePoll.ts
async function createNextPoll() {
  log.info("[Scheduler] Creating the next poll...");
  const { data: latestChapter } = await supabase
    .from("beats")
    .select("body")
    .order("authored_at", { ascending: false })
    .limit(1)
    .single();

  if (!latestChapter) {
    log.warn("[Scheduler] No chapters exist. Cannot create a story-based poll.");
    return;
  }
  
  const options = await generateStoryOptions(latestChapter.body);
  const { data: newPoll, error: newPollError } = await supabase
    .from("polls")
    .insert({
      question: options.question,
      options: options.choices,
      closes_at: new Date(Date.now() + 30000) // 30s for testing
    })
    .select()
    .single();

  if (newPollError) {
    log.error(newPollError, "[Scheduler] Failed to create the next poll.");
  } else {
    log.info(`[Scheduler] New poll created with ID ${newPoll.id}: "${newPoll.question}"`);
  }
}

/**
 * Starts the poll scheduler to close polls and create new ones every 35 seconds (testing mode).
 * This ensures the poll-chapter loop is always running.
 */
export function startPollScheduler() {
  // Set scheduler interval to 35 seconds for dev/test
  const cronIntervalSeconds = 35;
  log.info(`[Scheduler] Initializing. Will attempt to run poll closure tasks every ${cronIntervalSeconds} seconds.`);

  // Run the scheduler every 35 seconds
  cron.schedule(`*/${cronIntervalSeconds} * * * * *`, async () => {
    log.info(`[Scheduler] Cron tick: Triggered poll closure task.`);
    const startTime = Date.now();
    await closePollAndTally(); // This now has the lock mechanism
    const endTime = Date.now();
    log.info(`[Scheduler] Cron task: closePollAndTally execution took ${endTime - startTime}ms`);
    // REMOVED: await new Promise(resolve => setTimeout(resolve, 60000));
  });
  log.info(`[Scheduler] Poll scheduler started. Cron interval: every ${cronIntervalSeconds} seconds.`);
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