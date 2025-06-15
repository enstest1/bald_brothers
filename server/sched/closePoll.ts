import cron from "node-cron";
import { createClient } from "@supabase/supabase-js";
import { ChapterAgent } from "../../src/agents/chapterAgent";
const log = require("pino")();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

let isProcessingPollClosure = false;

// This function now ONLY creates a poll. It does not call the AI.
async function createNextPoll() {
  log.info("[Scheduler] Creating the next poll...");
  const { data: latestChapter } = await supabase
    .from("beats")
    .select("body")
    .order("authored_at", { ascending: false })
    .limit(1)
    .single();

  if (!latestChapter) {
    log.error("[Scheduler] CRITICAL: No chapter found to base the next poll on. Aborting poll creation.");
    return;
  }
  
  // Simple, deterministic poll generation.
  // We will assume the AI chapter ends with two choices on separate lines.
  const chapterLines = latestChapter.body.split('\n').filter((line: string) => line.trim() !== '');
  let choices = [
      "The brothers take a moment to reflect on their journey.",
      "An unexpected event throws their plans into chaos."
  ]; // Fallback choices
  
  if (chapterLines.length >= 2) {
      choices = [chapterLines[chapterLines.length - 2], chapterLines[chapterLines.length - 1]];
  }
  
  const question = "What happens next?";

  const { data: newPoll } = await supabase
    .from("polls")
    .insert({
        question,
        options: choices,
        closes_at: new Date(Date.now() + 120000) // 2 minutes for robust testing
    })
    .select("id")
    .single();
    
  if (newPoll) {
    log.info(`[Scheduler] New poll created with ID ${newPoll.id}`);
  } else {
    log.error("[Scheduler] Failed to insert new poll into database.");
  }
}

// Main scheduler logic
export async function closePollAndTally() {
  if (isProcessingPollClosure) {
    log.warn("[Scheduler] Cycle already running. Skipping.");
    return;
  }
  isProcessingPollClosure = true;
  log.info("--------------------");
  log.info("[Scheduler] Starting new cycle...");

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
        // THIS IS THE BOOTSTRAP LOGIC FOR A FRESH START
        const { count } = await supabase.from('polls').select('*', { count: 'exact', head: true });
        if (count === 0) {
            log.warn("[Scheduler] System appears to be empty. Creating genesis chapter and first poll.");
            const genesisBody = "In the age of myth, where legends were forged... two brothers stood at a crossroads.\n\nOption 1: They venture into the Whispering Woods.\nOption 2: They climb the Sun-Scorched Peaks.";
            await supabase.from("beats").insert({ arc_id: "1", body: genesisBody });
            await createNextPoll();
        } else {
            log.info("[Scheduler] No closed polls to process. Waiting for an open poll to finish.");
        }
    } else {
        // This is the normal loop for a running system
        log.info(`[Scheduler] Processing poll ID ${pollToProcess.id}`);
        await supabase.from('polls').update({ processed_at: new Date().toISOString() }).eq('id', pollToProcess.id);
        
        const { data: votes } = await supabase.from("votes").select("choice").eq("poll_id", pollToProcess.id);
        const voteCounts = (pollToProcess.options as string[]).map((option, index) => ({ option, count: votes?.filter((v: any) => v.choice === index).length || 0 }));
        const winner = voteCounts.reduce((a, b) => (b.count >= a.count ? b : a));
        log.info(`[Scheduler] Poll winner is "${winner.option}"`);

        const { data: latestChapter } = await supabase.from("beats").select("body").order("authored_at", { ascending: false }).limit(1).single();
        const prompt = `The story so far:\n"${latestChapter?.body}"\n\nThe community voted for this to happen next: "${winner.option}".\n\nWrite the next part of the story, making sure to end it with two new, distinct choices for the next poll, each on its own line.`;
        
        const result = await ChapterAgent.run(prompt);
        const newChapterBody = (result.success && result.output) ? result.output as string : 'The story is lost in the mists of time...';
        await supabase.from("beats").insert({ arc_id: "1", body: newChapterBody });
        log.info("[Scheduler] New chapter saved.");

        await createNextPoll();
    }
  } catch (e) {
    if(e instanceof Error) log.error(e, "[Scheduler] Unhandled error in main cycle.");
  } finally {
    isProcessingPollClosure = false;
    log.info("[Scheduler] Cycle finished.");
    log.info("--------------------");
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