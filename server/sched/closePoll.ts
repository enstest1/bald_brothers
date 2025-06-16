import cron from "node-cron";
import { createClient } from "@supabase/supabase-js";
import { ChapterAgent } from "../../src/agents/chapterAgent";
const log = require("pino")();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// Define the hardcoded genesis chapter body here so the scheduler knows the story's true beginning.
const GENESIS_CHAPTER_BODY = "In the age of myth, where legends were forged in the crucible of destiny, two brothers, known only by their gleaming crowns of flesh, stood at a crossroads. The world, vast and unknowing, awaited their first, fateful decision.";

let isProcessingPollClosure = false;

async function createNextPoll(newChapterBody: string) {
    log.info("[Scheduler] Creating the next poll based on new chapter...");
    const chapterLines = newChapterBody.split('\n').filter(line => line.trim() !== '');
    let choices = ["The adventure continues...", "But danger lurks nearby."]; 
    if (chapterLines.length >= 2) {
        choices = [chapterLines[chapterLines.length - 2], chapterLines[chapterLines.length - 1]];
    }
    
    await supabase.from("polls").insert({
        question: "What happens next?",
        options: choices,
        closes_at: new Date(Date.now() + 120000) // 2 minutes for testing
    });
    log.info("[Scheduler] Next poll has been created.");
}

export async function closePollAndTally() {
  if (isProcessingPollClosure) {
    log.warn("[Scheduler] Cycle already running. Skipping.");
    return;
  }
  isProcessingPollClosure = true;
  log.info("--- [Scheduler] Starting Cycle ---");

  try {
    const { data: pollToProcess, error } = await supabase
        .from('polls')
        .select('*')
        .lt('closes_at', new Date().toISOString())
        .is('processed_at', null)
        .order('closes_at', { ascending: false })
        .limit(1)
        .single();

    if (error || !pollToProcess) {
        log.info("[Scheduler] No closed polls to process. Ending cycle.");
    } else {
        log.info(`[Scheduler] Processing poll ID ${pollToProcess.id}`);
        await supabase.from('polls').update({ processed_at: new Date().toISOString() }).eq('id', pollToProcess.id);
        
        const { data: votes } = await supabase.from("votes").select("choice").eq("poll_id", pollToProcess.id);
        const voteCounts = (pollToProcess.options as string[]).map((option, index) => ({ option, count: votes?.filter(v => v.choice === index).length || 0 }));
        const winner = voteCounts.reduce((a, b) => (b.count >= a.count ? b : a));
        log.info(`[Scheduler] Poll winner is "${winner.option}"`);

        const { data: latestChapter } = await supabase.from("beats").select("body").order("authored_at", { ascending: false }).limit(1).single();
        
        // If no chapter exists in the database, use the Genesis Chapter as context. Otherwise, use the latest one.
        const storyContext = latestChapter?.body || GENESIS_CHAPTER_BODY;

        const prompt = `The story so far:\n"${storyContext}"\n\nThe community voted for this to happen next: "${winner.option}".\n\nWrite the next chapter of the story, making sure it ends with two new, distinct choices for the next poll, each on its own line.`;
        
        const result = await ChapterAgent.run(prompt);
        const newChapterBody = (result.success && result.output) ? result.output as string : 'The story is lost in the mists of time...';
        await supabase.from("beats").insert({ arc_id: "1", body: newChapterBody });
        log.info("[Scheduler] New chapter saved.");

        await createNextPoll(newChapterBody);
    }
  } catch (e) {
    if(e instanceof Error) log.error(e, "[Scheduler] Unhandled error.");
  } finally {
    isProcessingPollClosure = false;
    log.info("--- [Scheduler] Cycle Finished ---");
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
    log.error(error instanceof Error ? error.message : String(error), "Manual poll closure failed");
    process.exit(1);
  });
}

// Ensure poll durations are at least 30s in dev/test
const pollDuration = process.env.NODE_ENV === 'production' ? 24 * 60 * 60 * 1000 : 30 * 1000;