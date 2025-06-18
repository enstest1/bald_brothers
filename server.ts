import express from "express";
import cookieParser from "cookie-parser";
import "dotenv/config";
import { publicChaptersRouter, protectedChaptersRouter } from "./server/routes/chapters";
import pollsRouter from "./server/routes/polls";
import { startPollScheduler } from "./server/sched/closePoll";
import { createClient } from "@supabase/supabase-js";
import { GENESIS_CHAPTER_BODY, FIRST_POLL } from "./src/lib/constants";
const log = require("pino")();

const app = express();
const PORT = process.env.PORT || 3000;

// --- Database Bootstrap Logic ---
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function bootstrapDatabase() {
  log.info("[Bootstrap] Checking if database needs to be initialized...");
  
  const { count: chapterCount } = await supabase.from('beats').select('*', { count: 'exact', head: true });
  if (chapterCount === 0) {
    log.info("[Bootstrap] No chapters found. Inserting genesis chapter.");
    await supabase.from('beats').insert({
      arc_id: '1',
      body: GENESIS_CHAPTER_BODY,
      authored_at: new Date(0)
    });
  }

  const { count: pollCount } = await supabase.from('polls').select('*', { count: 'exact', head: true });
  if (pollCount === 0) {
    log.info("[Bootstrap] No polls found. Inserting first poll.");
    await supabase.from("polls").insert(FIRST_POLL);
  }
  log.info("[Bootstrap] Database check complete.");
}
// --- End of Bootstrap Logic ---

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
app.use("/api", protectedChaptersRouter);
app.use("/beats", publicChaptersRouter);
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
  
  await bootstrapDatabase(); // Run the bootstrap logic on startup
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