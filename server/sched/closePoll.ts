import cron from "node-cron";
import { createClient } from "@supabase/supabase-js";
import { cloud } from "../../src/lib/cloudClient";
const log = require("pino")();

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

export async function closePollAndTally() {
  try {
    log.info("Starting scheduled poll closure and tally");

    // Get the most recent open poll
    const { data: polls, error: pollError } = await supabase
      .from("polls")
      .select("*")
      .gt("closes_at", new Date().toISOString())
      .order("closes_at", { ascending: true })
      .limit(1);

    if (pollError) {
      log.error(pollError, "Failed to fetch open polls");
      return;
    }

    if (!polls || polls.length === 0) {
      log.info("No open polls to close");
      return;
    }

    const poll = polls[0];
    log.info("Closing poll %s: %s", poll.id, poll.question);

    // Get vote counts
    const { data: votes, error: voteError } = await supabase
      .from("votes")
      .select("choice")
      .eq("poll_id", poll.id);

    if (voteError) {
      log.error(voteError, "Failed to fetch votes for poll %s", poll.id);
      return;
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
      return;
    }

    const winner = yesVotes > noVotes ? "yes" : noVotes > yesVotes ? "no" : "tie";
    const result = {
      pollId: poll.id,
      question: poll.question,
      totalVotes,
      results: { yes: yesVotes, no: noVotes, winner }
    };

    log.info("Poll %s closed. Results: %o", poll.id, result.results);

    // Store poll results in Bootoshi Cloud for agent context
    try {
      await cloud("add", {
        agent_id: "poll",
        run_id: "weekly",
        memories: `Poll closed: "${poll.question}". Results: ${yesVotes} yes, ${noVotes} no (${totalVotes} total votes). Winner: ${winner}`,
        store_mode: "vector",
        metadata: { 
          ...result,
          ts: Date.now(),
          type: "poll_result"
        },
        skip_extraction: true
      });
      log.info("Poll results saved to Bootoshi Cloud");
    } catch (cloudError) {
      log.error(cloudError, "Failed to save poll results to Bootoshi Cloud");
    }

    // TODO: Create new poll for next week
    // This could be enhanced to automatically generate a new poll question
    // based on the story context or current events
    
  } catch (error) {
    log.error(error, "Error in scheduled poll closure");
  }
}

// Schedule the poll closure job to run every Saturday at 23:59 UTC
export function startPollScheduler() {
  // Run every Saturday at 23:59 UTC
  cron.schedule("59 23 * * 6", async () => {
    log.info("Triggered scheduled poll closure");
    await closePollAndTally();
  }, {
    timezone: "UTC"
  });

  log.info("Poll scheduler started - will close polls every Saturday at 23:59 UTC");
}

// Allow manual execution for testing
if (require.main === module) {
  log.info("Running poll closure manually");
  closePollAndTally().then(() => {
    log.info("Manual poll closure completed");
    process.exit(0);
  }).catch((error) => {
    log.error(error, "Manual poll closure failed");
    process.exit(1);
  });
}