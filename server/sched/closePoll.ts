import cron from "node-cron";
import { createClient, PostgrestError } from "@supabase/supabase-js";
import { ChapterAgent } from "../../src/agents/chapterAgent";
const log = require("pino")();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

let isProcessingPollClosure = false;

// --- Helper Functions ---

async function generateAndSaveChapter(prompt: string): Promise<boolean> {
  log.info("[Scheduler] Generating new chapter...");
  try {
    const result = await ChapterAgent.run(prompt);
    const chapterBody = (result.success && result.output) ? result.output as string : '';

    if (chapterBody.length < 20) {
      throw new Error("AI output was too short or failed.");
    }
    
    const { error } = await supabase.from("beats").insert({ arc_id: "1", body: chapterBody });
    if (error) throw error;

    log.info("[Scheduler] Chapter saved successfully.");
    return true;
  } catch (error) {
    log.error(error, "[Scheduler] Error during chapter generation. Saving fallback chapter.");
    const fallbackBody = 'The Bald Brothers continue their journey, but the details are lost to legend. The story will resume with the next decision.';
    await supabase.from("beats").insert({ arc_id: "1", body: fallbackBody });
    return true; // Still return true to allow the loop to continue.
  }
}

async function createTwoChoicePoll(): Promise<void> {
    log.info("[Scheduler] Creating a new two-choice poll...");
    
    const { data: latestChapter, error: chapterError } = await supabase
        .from("beats").select("body").order("authored_at", { ascending: false }).limit(1).single();
    
    if (chapterError || !latestChapter) {
        log.error(chapterError || new Error("No chapter found to base poll on."), "[Scheduler] CRITICAL: Cannot create next poll.");
        return;
    }

    let question = "What path should the Bald Brothers take?";
    let choices = ["Seek the ancient bald scrolls in the dark temple", "Train with the wise bald masters in the mountains"];
    
    try {
        const pollPrompt = `Based on this chapter:\n"${latestChapter.body}"\n\nGenerate a poll with two different, exciting story options for the next chapter. Format the response as a JSON object with keys "question" and "choices" (an array of two strings).`;
        const result = await ChapterAgent.run(pollPrompt);
        if(result.success && result.output) {
            const parsed = JSON.parse(result.output as string);
            question = parsed.question;
            choices = parsed.choices;
        }
    } catch (e) { log.error(e, "[Scheduler] Error generating AI poll options, using fallback."); }

    const { data: newPoll } = await supabase.from("polls").insert({ question, options: choices, closes_at: new Date(Date.now() + 40000) }).select("id").single();
    if (newPoll) {
        log.info(`[Scheduler] New two-choice poll created with ID ${newPoll.id}`);
    } else {
        log.error("[Scheduler] Failed to insert new poll into database.");
    }
}

// --- Main Scheduler Logic ---

export async function closePollAndTally() {
  if (isProcessingPollClosure) {
    log.warn("[Scheduler] Poll closure is already running. Skipping.");
    return;
  }
  isProcessingPollClosure = true;
  log.info("[Scheduler] Starting poll closure cycle...");

  try {
    const { data: poll, error } = await supabase
        .from('polls')
        .select('*')
        .lt('closes_at', new Date().toISOString())
        .is('processed_at', null)
        .order('closes_at', { ascending: false })
        .limit(1)
        .single();

    if (error || !poll) {
        log.info("[Scheduler] No unprocessed closed polls found. Cycle finished.");
        return;
    }
    
    log.info(`[Scheduler] Found unprocessed poll to process: ID ${poll.id}`);
    await supabase.from('polls').update({ processed_at: new Date().toISOString() }).eq('id', poll.id);
    log.info(`[Scheduler] Poll ${poll.id} has been marked as processed.`);

    const { data: votes } = await supabase.from("votes").select("choice").eq("poll_id", poll.id);
    const voteCounts = (poll.options as string[]).map((option, index) => ({ option, count: votes?.filter(v => v.choice === index).length || 0 }));
    const winner = voteCounts.reduce((a, b) => (b.count >= a.count ? b : a));
    log.info(`[Scheduler] Poll winner is "${winner.option}" with ${winner.count} votes.`);

    // Check if this was the initial "Yes/No" poll
    const isKickoffPoll = poll.question.includes("begin their epic saga");

    if (isKickoffPoll && winner.option.toLowerCase().startsWith('no')) {
      log.info("[Scheduler] Community voted 'No' to starting the saga. No chapter will be generated. A new kickoff poll will be created.");
      await supabase.from("polls").insert({
        question: "The brothers hesitate... Are they ready to begin their epic saga now?",
        options: ["Yes, the time is now!", "No, let them ponder longer."],
        closes_at: new Date(Date.now() + 2 * 60 * 1000) // 2 minutes
      });
    } else {
      // This is either a "Yes" on the kickoff, or a regular two-choice poll.
      const { data: latestChapter } = await supabase.from("beats").select("body").order("authored_at", { ascending: false }).limit(1).single();
      const prompt = `The last chapter was:\n"${latestChapter?.body}"\n\nThe community voted for the story to continue with the following direction: "${winner.option}".\n\nWrite the next chapter of the Bald Brothers saga incorporating this choice.`;
      
      if (await generateAndSaveChapter(prompt)) {
          // After ANY chapter is generated, we create a two-choice poll.
          await createTwoChoicePoll();
      } else {
          log.error("[Scheduler] Chapter saving failed, will not create a new poll this cycle.");
      }
    }

  } catch (e) {
    if (e instanceof Error) log.error(e, "[Scheduler] Unhandled error in closePollAndTally");
  } finally {
    isProcessingPollClosure = false;
    log.info("[Scheduler] Finished poll closure cycle.");
  }
}

export function startPollScheduler() {
  const cronIntervalSeconds = 35;
  log.info(`[Scheduler] Initializing. Polling interval: ${cronIntervalSeconds} seconds.`);
  cron.schedule(`*/${cronIntervalSeconds} * * * * *`, closePollAndTally);
  log.info("[Scheduler] Poll scheduler started.");
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