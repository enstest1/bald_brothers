import cron from "node-cron";
import { createClient } from "@supabase/supabase-js";
import { ChapterAgent } from "../../src/agents/chapterAgent";
const log = require("pino")();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

let isProcessingPollClosure = false;

async function generateAndSaveChapter(prompt: string): Promise<boolean> {
  log.info("[Scheduler] Generating new chapter...");
  try {
    const result = await ChapterAgent.run(prompt);
    let chapterBody = (result.success && result.output) ? result.output as string : '';

    if (chapterBody.length < 20) {
      log.warn("[Scheduler] AI generation failed or output was too short. Using fallback.");
      chapterBody = 'The Bald Brothers continue their journey, but the details are lost to legend. The story will resume with the next decision.';
    }
    
    await supabase.from("beats").insert({ arc_id: "1", body: chapterBody });
    log.info("[Scheduler] Chapter saved successfully.");
    return true;
  } catch (error) {
    log.error(error, "[Scheduler] CRITICAL: Unhandled error during chapter generation. Saving fallback.");
    await supabase.from("beats").insert({ arc_id: "1", body: 'The Bald Brothers encountered an unspeakable terror, and the details are too grim to recount. The story will resume after they have recovered.' });
    return true; // Return true even on fallback to allow the next poll to be created
  }
}

async function createNextPoll(): Promise<void> {
    log.info("[Scheduler] Attempting to create the next poll...");
    
    const { data: latestChapter, error: chapterError } = await supabase
        .from("beats").select("body").order("authored_at", { ascending: false }).limit(1).single();
    
    if (chapterError || !latestChapter) {
        log.warn("[Scheduler] No chapters exist. Creating genesis chapter to start the story.");
        const genesisBody = "In the age of myth, where legends were forged in the crucible of destiny, two brothers, known only by their gleaming crowns of flesh, stood at a crossroads. The world, vast and unknowing, awaited their first, fateful decision. This is the beginning of the Bald Brothers' saga.";
        await supabase.from("beats").insert({ arc_id: "1", body: genesisBody });
        // Re-fetch after creation
        const { data: newChapter } = await supabase.from("beats").select("body").order("authored_at", { ascending: false }).limit(1).single();
        await createPollFromChapter(newChapter?.body || genesisBody);
    } else {
        await createPollFromChapter(latestChapter.body);
    }
}

async function createPollFromChapter(chapterBody: string) {
    let question = "What path should the Bald Brothers take?";
    let choices = ["Seek the ancient bald scrolls in the dark temple", "Train with the wise bald masters in the mountains"];
    
    try {
        const pollPrompt = `Based on this chapter:\n"${chapterBody}"\n\nGenerate a poll with two different story options for the next chapter. Each option should be a single sentence. Format the response as a JSON object with keys "question" and "choices" (an array of two strings). Example: {"question": "What happens next?", "choices": ["They enter the cave.", "They run away."]}`;
        const result = await ChapterAgent.run(pollPrompt);
        if(result.success && result.output) {
            const parsed = JSON.parse(result.output as string);
            question = parsed.question;
            choices = parsed.choices;
        }
    } catch (e) { log.error(e, "[Scheduler] Error parsing AI poll options, using fallback."); }

    const { data: newPoll } = await supabase.from("polls").insert({ question, options: choices, closes_at: new Date(Date.now() + 40000) }).select("id, question").single();
    if (newPoll) {
        log.info(`[Scheduler] New poll created with ID ${newPoll.id}: "${newPoll.question}"`);
    } else {
        log.error("[Scheduler] Failed to insert new poll into database.");
    }
}

export async function closePollAndTally() {
  if (isProcessingPollClosure) {
    log.warn("[Scheduler] Poll closure is already running. Skipping.");
    return;
  }
  isProcessingPollClosure = true;
  log.info("[Scheduler] Starting poll closure cycle...");

  try {
    const { data: pollToProcess, error: pollError } = await supabase
        .from('polls').select('*').lt('closes_at', new Date().toISOString()).is('processed_at', null).order('closes_at', { ascending: false }).limit(1).single();

    if (pollError || !pollToProcess) {
        const { count: openPollCount } = await supabase.from('polls').select('*', { count: 'exact', head: true }).gt('closes_at', new Date().toISOString());
        if (openPollCount === 0) {
            log.warn("[Scheduler] No open polls found. Creating a new one to unstick the system.");
            await createNextPoll();
        }
    } else {
        log.info(`[Scheduler] Found unprocessed poll to process: ID ${pollToProcess.id}`);
        await supabase.from('polls').update({ processed_at: new Date().toISOString() }).eq('id', pollToProcess.id);
        
        const { data: votes } = await supabase.from("votes").select("choice").eq("poll_id", pollToProcess.id);
        const voteCounts = (pollToProcess.options as string[]).map((option, index) => ({ option, count: votes?.filter(v => v.choice === index).length || 0 }));
        const winner = voteCounts.reduce((a, b) => (b.count >= a.count ? b : a));
        log.info(`[Scheduler] Poll winner is "${winner.option}" with ${winner.count} votes.`);

        const { data: latestChapter } = await supabase.from("beats").select("body").order("authored_at", { ascending: false }).limit(1).single();
        const prompt = `The last chapter was:\n"${latestChapter?.body}"\n\nThe community voted for the story to continue with the following direction: "${winner.option}".\n\nWrite the next chapter of the Bald Brothers saga incorporating this choice.`;
        
        if (await generateAndSaveChapter(prompt)) {
            await createNextPoll();
        } else {
            log.error("[Scheduler] Chapter saving failed, will not create a new poll this cycle.");
        }
    }
  } catch (error) {
    log.error(error, "[Scheduler] Unhandled error in closePollAndTally");
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