import express from "express";
import cookieParser from "cookie-parser";
import "dotenv/config";
import chaptersRouter from "./server/routes/chapters";
import pollsRouter from "./server/routes/polls";
import { startPollScheduler } from "./server/sched/closePoll";
import { createClient } from "@supabase/supabase-js";
const log = require("pino")();

const app = express();
const PORT = process.env.PORT || 3000;

// NEW bootstrapStory function to fix the startup deadlock
async function bootstrapStory() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!
  );

  log.info("[INIT] Bootstrapping story engine...");

  // 1. Check if any chapters (beats) exist.
  const { count: chapterCount, error: countError } = await supabase
    .from("beats")
    .select('*', { count: 'exact', head: true });

  if (countError) {
    log.error(countError, "[INIT] Error checking for chapters.");
    return;
  }

  // If no chapters exist, create the very first one.
  if (chapterCount === 0) {
    log.info("[INIT] No chapters found. Creating genesis chapter...");
    const genesisBody = "In the age of myth, where legends were forged in the crucible of destiny, two brothers, known only by their gleaming crowns of flesh, stood at a crossroads. The world, vast and unknowing, awaited their first, fateful decision. This is the beginning of the Bald Brothers' saga.";
    const { error: insertError } = await supabase.from("beats").insert({
      arc_id: "1",
      body: genesisBody,
      authored_at: new Date()
    });
    if (insertError) {
      log.error(insertError, "[INIT] Failed to create genesis chapter.");
      return;
    }
    log.info("[INIT] Genesis chapter created.");
  } else {
    log.info(`[INIT] Found ${chapterCount} existing chapters. Bootstrap not needed.`);
  }

  // 2. Check if an open poll exists.
  const { data: openPoll } = await supabase
    .from("polls")
    .select("id")
    .gt("closes_at", new Date().toISOString())
    .limit(1)
    .single();

  // If no open poll exists, create the first two-choice poll.
  if (!openPoll) {
    log.info("[INIT] No open polls found. Creating an initial poll...");
    const { error: createPollError } = await supabase
      .from("polls")
      .insert({
        question: "What path shall the brothers take first?",
        options: ["Venture into the Whispering Woods", "Climb the Sun-Scorched Peaks"],
        closes_at: new Date(Date.now() + 30000) // 30 seconds for testing
      });
    if (createPollError) {
        log.error(createPollError, "[INIT] Failed to create initial poll.");
    } else {
        log.info("[INIT] Initial poll created successfully.");
    }
  }
}

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.static("public"));

const authenticateAPI = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.method === "GET" && req.path.startsWith("/polls")) {
    return next();
  }
  const token = req.headers.authorization?.replace("Bearer ", "") || req.headers["x-api-token"];
  const expectedToken = process.env.API_TOKEN;
  if (!expectedToken) {
    log.warn("API_TOKEN not configured - API endpoints are unprotected");
    return next();
  }
  if (!token || token !== expectedToken) {
    log.warn("Unauthorized API access attempt from %s", req.ip);
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
};

// Routes
app.use("/api", authenticateAPI as express.RequestHandler);
app.use("/api", chaptersRouter);
app.use("/polls", pollsRouter);

app.get("/health", (req, res) => res.json({ status: "ok" }));
app.get("/", (req, res) => res.sendFile("index.html", { root: "public" }));

app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  log.error(err, "Unhandled error in request");
  res.status(500).json({ error: "Internal server error" });
});

// Start server
app.listen(PORT, async () => {
  log.info("Bald Brothers Story Engine server started on port %d", PORT);
  log.info("Environment: %s", process.env.NODE_ENV || "development");
  
  // This is the only startup function we need.
  await bootstrapStory();
  
  startPollScheduler();
  
  const requiredEnvVars = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "OPENROUTER_API_KEY"];
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    log.warn("Missing required environment variables: %s", missingVars.join(", "));
  } else {
    log.info("All required environment variables are configured");
  }
});

export default app;