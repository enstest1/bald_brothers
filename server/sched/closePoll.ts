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
    let chapterBody = "";

    if (result.success && result.output && (result.output as string).length > 20) {
      chapterBody = result.output as string;
      log.info("[Scheduler] AI chapter generation successful.");
    } else {
      log.warn("[Scheduler] AI generation failed or output was too short. Using fallback.");
      chapterBody = 'The Bald Brothers continue their journey, but the details are lost to legend. The story will resume with the next decision.';
    }
    
    const { error } = await supabase.from("beats").insert({
      arc_id: "1",
      body: chapterBody,
      authored_at: new Date(),
    });

    if (error) {
      log.error(error, "[Scheduler] Failed to save chapter to database.");
      return false;
    }

    log.info("[Scheduler] Chapter saved successfully.");
    return true;

  } catch (error) {
    log.error(error, "[Scheduler] Unhandled error during chapter generation.");
    const { error: fallbackError } = await supabase.from("beats").insert({
      arc_id: "1",
      body: 'The Bald Brothers continue their journey, but the details are lost to legend. The story will resume with the next decision.',
      authored_at: new Date(),
    });
    if (fallbackError) {
      log.error(fallbackError, "[Scheduler] CRITICAL: Failed to save even the fallback chapter.");
      return false;
    }
    log.info("[Scheduler] Fallback chapter saved successfully after an error.");
    return true;
  }
}

async function createNextPoll(): Promise<void> {
    log.info("[Scheduler] Creating the next poll...");
    
    const { data: latestChapter, error: chapterError } = await supabase
        .from("beats")
        .select("body")
        .order("authored_at", { ascending: false })
        .limit(1)
        .single();
    
    if (chapterError || !latestChapter) {
        log.error(chapterError || new Error("No latest chapter found"), "[Scheduler] Could not create next poll.");
        return;
    }

    let question = "What path should the Bald Brothers take?";
    let choices = ["Seek the ancient bald scrolls in the dark temple", "Train with the wise bald masters in the mountains"];
    
    try {
        const prompt = `Based on this chapter:\n"${latestChapter.body}"\n\nGenerate a poll with two different story options for the next chapter. Each option should be a single sentence. Format the response as a JSON object with keys "question" and "choices" (an array of two strings). Example: {"question": "What happens next?", "choices": ["They enter the cave.", "They run away."]}`;
        const result = await ChapterAgent.run(prompt);
        if(result.success && result.output) {
            const parsed = JSON.parse(result.output as string);
            question = parsed.question;
            choices = parsed.choices;
            log.info("[Scheduler] Successfully generated AI poll options.");
        } else {
            log.warn("[Scheduler] Failed to generate AI poll options, using fallback.");
        }
    } catch (e) {
        if (e instanceof Error) {
            log.error(e, "[Scheduler] Error parsing AI poll options, using fallback.");
        } else {
            log.error("[Scheduler] An unknown error occurred while parsing poll options.");
        }
    }

    const { data: newPoll, error: newPollError } = await supabase
        .from("polls")
        .insert({
            question,
            options: choices,
            closes_at: new Date(Date.now() + 30000)
        })
        .select("id, question")
        .single();
        
    if (newPollError) {
        log.error(newPollError, "[Scheduler] Failed to insert new poll into database.");
    } else {
        log.info(`[Scheduler] New poll created with ID ${newPoll.id}: "${newPoll.question}"`);
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
        .from('polls')
        .select('*')
        .lt('closes_at', new Date().toISOString())
        .order('closes_at', { ascending: false })
        .limit(1)
        .single();

    if (pollError || !pollToProcess) {
        log.info("[Scheduler] No closed poll found to process.");
        const { count: openPollCount } = await supabase.from('polls').select('*', { count: 'exact', head: true }).gt('closes_at', new Date().toISOString());
        if (openPollCount === 0) {
            log.warn("[Scheduler] No open polls found. Creating a new one to unstick the system.");
            await createNextPoll();
        }
        return;
    }

    const { count: postPollChapterCount } = await supabase.from('beats').select('*', { count: 'exact', head: true }).gt('authored_at', pollToProcess.closes_at);
    if ((postPollChapterCount ?? 0) > 0) {
        log.info(`[Scheduler] Poll ${pollToProcess.id} has already been processed. Nothing to do.`);
        return;
    }
    
    log.info(`[Scheduler] Processing poll ID ${pollToProcess.id}`);

    const { data: votes } = await supabase.from("votes").select("choice").eq("poll_id", pollToProcess.id);
    const voteCounts = (pollToProcess.options as string[]).map((option, index) => ({
      option,
      count: votes?.filter(v => v.choice === index).length || 0
    }));
    const winner = voteCounts.reduce((a, b) => (b.count >= a.count ? b : a));
    log.info(`[Scheduler] Poll winner is "${winner.option}" with ${winner.count} votes.`);

    const { data: latestChapter } = await supabase.from("beats").select("body").order("authored_at", { ascending: false }).limit(1).single();
    const prompt = `The last chapter was:\n"${latestChapter?.body}"\n\nThe community voted for the story to continue with the following direction: "${winner.option}".\n\nWrite the next chapter of the Bald Brothers saga incorporating this choice.`;
    
    const chapterSaved = await generateAndSaveChapter(prompt);
    
    if (chapterSaved) {
        await createNextPoll();
    } else {
        log.error("[Scheduler] Chapter saving failed, will not create a new poll this cycle.");
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