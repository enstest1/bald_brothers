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

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.static("public")); // Serve static files

// Security middleware for API endpoints
const authenticateAPI = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  // Skip authentication for GET requests to polls (public viewing)
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

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    version: "1.0.0"
  });
});

// Root endpoint
app.get("/", (req, res) => {
  res.sendFile("index.html", { root: "public" });
});

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  log.error(err, "Unhandled error in request");
  res.status(500).json({ error: "Internal server error" });
});

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function ensureFirstPoll() {
  log.info("[INIT] Checking for open polls on startup...");
  const { data: polls, error } = await supabase
    .from("polls")
    .select("*")
    .gt("closes_at", new Date().toISOString())
    .order("closes_at", { ascending: true })
    .limit(1);

  if (error) {
    log.error("[INIT] Error checking for open polls: %s", error.message || error);
    return;
  }

  if (!polls || polls.length === 0) {
    log.info("[INIT] No open polls found. Creating the first poll...");
    const pollDuration = 10 * 1000; // 10 seconds for testing
    const { data, error: createError } = await supabase
      .from("polls")
      .insert({
        question: "Should the Bald Brothers start a new adventure?",
        options: ["yes", "no"],
        closes_at: new Date(Date.now() + pollDuration)
      })
      .select()
      .single();
    if (createError) {
      log.error("[INIT] Failed to create first poll: %s", createError.message || createError);
    } else {
      log.info("[INIT] First poll created with ID %s", data.id);
    }
  } else {
    log.info("[INIT] Open poll already exists with ID %s", polls[0].id);
  }
}

// Start server
app.listen(PORT, async () => {
  log.info("Bald Brothers Story Engine server started on port %d", PORT);
  log.info("Environment: %s", process.env.NODE_ENV || "development");
  
  // Start the poll scheduler
  startPollScheduler();
  
  // Ensure the first poll exists
  await ensureFirstPoll();
  
  // Log configuration status
  const requiredEnvVars = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "OPENROUTER_API_KEY"];
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    log.warn("Missing required environment variables: %s", missingVars.join(", "));
    log.info("Please check your .env file against .env.example");
  } else {
    log.info("All required environment variables are configured");
  }
});

export default app;