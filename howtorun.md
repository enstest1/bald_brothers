# How to Run the Bald Brothers Story Engine - Complete Beginner's Guide

This guide will walk you through **every single step** to get your AI-powered story engine running on a website, even if you've never done this before.

## 📋 What You'll Need

Before starting, make sure you have:
- A computer with internet access
- About 2 hours of time
- A credit card for some paid services (most have free tiers)
- Basic ability to copy/paste and follow instructions

---

## 🎯 Step 1: Get the Code

### 1.1 Install Git (if you don't have it)
- **Windows**: Download from [git-scm.com](https://git-scm.com/download/win)
- **Mac**: Open Terminal and type `git --version` (it will install automatically)
- **Linux**: Run `sudo apt install git` or `sudo yum install git`

### 1.2 Download This Project
```bash
# Open your terminal/command prompt and run:
git clone https://github.com/your-username/bald_brothers.git
cd bald_brothers
```

---

## 🔧 Step 2: Install Node.js

### 2.1 Download Node.js
1. Go to [nodejs.org](https://nodejs.org)
2. Download the **LTS version** (the green button)
3. Install it with default settings
4. Restart your computer

### 2.2 Verify Installation
```bash
# Open terminal and check:
node --version
npm --version
# You should see version numbers like v18.17.0
```

---

## 🗄️ Step 3: Set Up Your Database (Supabase)

Supabase is like a smart database that stores your story content and poll votes.

### 3.1 Create Supabase Account
1. Go to [supabase.com](https://supabase.com)
2. Click **"Start your project"**
3. Sign up with GitHub, Google, or email
4. **Free tier is perfect for starting!**

### 3.2 Create a New Project
1. Click **"New Project"**
2. Choose your organization (or create one)
3. Fill out:
   - **Name**: `bald-brothers-story`
   - **Database Password**: Create a strong password and **SAVE IT**
   - **Region**: Choose closest to you
4. Click **"Create new project"**
5. **Wait 2-3 minutes** for setup to complete

### 3.3 Get Your Supabase Credentials
1. In your project dashboard, click **"Settings"** (gear icon)
2. Click **"API"** in the left sidebar
3. **Copy and save these two values:**
   - **Project URL**: Starts with `https://...supabase.co`
   - **anon public key**: Long string starting with `eyJhbGciOiJI...`

### 3.4 Create Database Tables
1. Click **"SQL Editor"** in the left sidebar
2. Click **"New query"**
3. Copy and paste this code:

```sql
-- Create polls table
CREATE TABLE polls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question text NOT NULL,
  options text[] NOT NULL DEFAULT ARRAY['yes','no'],
  closes_at timestamptz NOT NULL
);

-- Create votes table  
CREATE TABLE votes (
  poll_id uuid REFERENCES polls(id),
  client_id uuid NOT NULL,
  choice int NOT NULL CHECK (choice IN (0, 1)),
  PRIMARY KEY (poll_id, client_id)
);

-- Create story beats table
CREATE TABLE beats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  arc_id text NOT NULL,
  body text NOT NULL,
  authored_at timestamptz DEFAULT now()
);

-- Insert a test poll
INSERT INTO polls (question, closes_at) 
VALUES ('Should the Bald Brothers start a new adventure?', NOW() + INTERVAL '7 days');
```

4. Click **"Run"** button
5. You should see **"Success. No rows returned"**

---

## 🤖 Step 4: Set Up AI Services

### 4.1 Get OpenRouter API Key (for AI)
OpenRouter gives you access to GPT-4 and other AI models.

1. Go to [openrouter.ai](https://openrouter.ai)
2. Click **"Sign In"** and create account
3. Add $5-10 credit (this will last months for testing)
4. Go to **"Keys"** section
5. Click **"Create Key"**
6. Name it `bald-brothers` and copy the key (starts with `sk-or-v1-`)

### 4.2 Get Bootoshi Cloud Access
This stores your story's long-term memory.

1. Contact the Bootoshi team or check documentation for access
2. You'll need:
   - **CLOUD_URL**: Usually `https://api.baldbros.xyz`
   - **CLOUD_PASSWORD**: Provided by Bootoshi team

---

## ⚙️ Step 5: Configure Your Environment

### 5.1 Create Environment File
```bash
# In your project folder, copy the example file:
cp .env.example .env
```

### 5.2 Edit Environment File
Open `.env` file in any text editor and fill in your values:

```bash
# Bootoshi Cloud (get from Bootoshi team)
CLOUD_URL=https://api.baldbros.xyz
CLOUD_PASSWORD=your_bootoshi_password_here

# Supabase (from Step 3.3)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...your-long-key-here

# OpenRouter (from Step 4.1)
OPENROUTER_API_KEY=sk-or-v1-your-openrouter-key-here

# Server settings
PORT=3000
NODE_ENV=development
API_TOKEN=make-up-a-secure-random-password-here
```

**Important**: Replace ALL the placeholder values with your real credentials!

---

## 🏗️ Step 6: Build and Test Locally

### 6.1 Install Dependencies
```bash
# In your project folder:
npm install
```
This downloads all the code libraries needed (will take 2-3 minutes).

### 6.2 Build the Project
```bash
npm run build
```
This compiles your TypeScript code into JavaScript.

### 6.3 Test It Works
```bash
# Start the server:
npm run dev
```

You should see:
```
Bald Brothers Story Engine server started on port 3000
Environment: development
All required environment variables are configured
```

### 6.4 Test in Browser
1. Open your browser
2. Go to `http://localhost:3000`
3. You should see the API documentation
4. Try `http://localhost:3000/polls/open` to see if polls work

---

## 🌍 Step 7: Deploy to the Internet

We'll use Render.com (free tier available).

### 7.1 Create Render Account
1. Go to [render.com](https://render.com)
2. Sign up with GitHub (recommended)
3. Connect your GitHub account

### 7.2 Push Code to GitHub
```bash
# Create a new repository on GitHub.com first, then:
git add .
git commit -m "Initial story engine setup"
git remote add origin https://github.com/YOUR-USERNAME/bald-brothers-story.git
git push -u origin main
```

### 7.3 Deploy on Render
1. In Render dashboard, click **"New +"**
2. Choose **"Web Service"**
3. Connect your GitHub repository
4. Fill out deployment settings:
   - **Name**: `bald-brothers-story`
   - **Environment**: `Node`
   - **Build Command**: `npm run build`
   - **Start Command**: `npm start`
   - **Plan**: Choose **Free** for testing

### 7.4 Add Environment Variables
1. In your Render service settings, scroll to **"Environment Variables"**
2. Add each variable from your `.env` file:
   - `CLOUD_URL` = `https://api.baldbros.xyz`
   - `CLOUD_PASSWORD` = `your-bootoshi-password`
   - `SUPABASE_URL` = `https://your-project.supabase.co`
   - `SUPABASE_ANON_KEY` = `eyJhbGciOiJI...`
   - `OPENROUTER_API_KEY` = `sk-or-v1-...`
   - `NODE_ENV` = `production`
   - `API_TOKEN` = `your-secure-token`

3. Click **"Save Changes"**

### 7.5 Deploy
1. Click **"Manual Deploy"** → **"Deploy latest commit"**
2. Wait 5-10 minutes for deployment
3. Your site will be live at something like `https://bald-brothers-story.onrender.com`

### ⚠️ Node.js Version for Render Deployment

Render may use a very new Node.js version by default, which can cause compatibility issues. To ensure compatibility, specify Node.js 18.x:

**Option A: Add a .node-version file**
1. In your project root, create a file named `.node-version` with this content:
   ```
   18.20.2
   ```

**Option B: Add to package.json**
1. Add this to your `package.json`:
   ```json
   "engines": {
     "node": "18.x"
   }
   ```

After making these changes, commit and push to GitHub before deploying to Render.

---

## 🔄 Step 8: Set Up Automation (GitHub Actions)

This makes your story engine generate chapters automatically every day.

### 8.1 Add GitHub Secrets
1. Go to your GitHub repository
2. Click **"Settings"** tab
3. Click **"Secrets and variables"** → **"Actions"**
4. Click **"New repository secret"** and add:
   - **Name**: `API_URL`, **Value**: `https://your-app.onrender.com` (your Render URL)
   - **Name**: `API_TOKEN`, **Value**: Same token you used in environment variables

### 8.2 Enable GitHub Actions
1. In your repository, click **"Actions"** tab
2. Click **"I understand my workflows and want to enable them"**
3. Your workflows are now active!

### 8.3 Test Manual Trigger
1. Go to **"Actions"** tab
2. Click **"Daily Chapter"** workflow
3. Click **"Run workflow"** → **"Run workflow"**
4. Watch it run and generate a test chapter!

---

## 🎉 Step 9: Create Your First Poll and Chapter

### 9.1 Create a Poll
```bash
# Use curl or a tool like Postman:
curl -X POST https://your-app.onrender.com/polls/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-token" \
  -d '{
    "question": "Should the Bald Brothers embark on their first quest?",
    "closes_at": "2024-01-20T23:59:59Z"
  }'
```

### 9.2 Generate Your First Chapter
```bash
curl -X POST https://your-app.onrender.com/api/worlds/1/arcs/1/progress \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-token"
```

### 9.3 Check It Worked
Visit `https://your-app.onrender.com/polls/open` to see your poll!

---

## 🔧 Step 10: Add a Simple Web Interface

### 10.1 Create a Simple HTML Page
Create `public/index.html` in your project:

```html
<!DOCTYPE html>
<html>
<head>
    <title>Bald Brothers Story Engine</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .poll { background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0; }
        button { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; }
        button:hover { background: #0056b3; }
        .chapter { background: #fff; border: 1px solid #ddd; padding: 20px; border-radius: 8px; margin: 20px 0; }
    </style>
</head>
<body>
    <h1>🧔 Bald Brothers Story Engine</h1>
    
    <div id="current-poll" class="poll">
        <h2>Loading current poll...</h2>
    </div>
    
    <button onclick="generateChapter()">Generate New Chapter</button>
    
    <div id="latest-chapter" class="chapter">
        <h2>Latest Chapter</h2>
        <p>Click "Generate New Chapter" to create content!</p>
    </div>

    <script>
        // Load current poll
        fetch('/polls/open')
            .then(r => r.json())
            .then(data => {
                const pollDiv = document.getElementById('current-poll');
                if (data.poll) {
                    pollDiv.innerHTML = `
                        <h2>Current Poll</h2>
                        <p><strong>${data.poll.question}</strong></p>
                        <button onclick="vote(0)">Yes</button>
                        <button onclick="vote(1)">No</button>
                        <p><small>Closes: ${new Date(data.poll.closes_at).toLocaleString()}</small></p>
                    `;
                } else {
                    pollDiv.innerHTML = '<h2>No active poll</h2>';
                }
            });

        // Vote function
        async function vote(choice) {
            const polls = await fetch('/polls/open').then(r => r.json());
            if (polls.poll) {
                fetch(`/polls/${polls.poll.id}/vote`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ choice })
                }).then(() => alert('Vote submitted!'));
            }
        }

        // Generate chapter function
        async function generateChapter() {
            document.getElementById('latest-chapter').innerHTML = '<h2>Generating chapter...</h2>';
            
            try {
                const response = await fetch('/api/worlds/1/arcs/1/progress', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + prompt('Enter API token:')
                    }
                });
                
                const data = await response.json();
                
                document.getElementById('latest-chapter').innerHTML = `
                    <h2>Latest Chapter</h2>
                    <p>${data.body}</p>
                `;
            } catch (error) {
                document.getElementById('latest-chapter').innerHTML = `
                    <h2>Error</h2>
                    <p>Failed to generate chapter: ${error.message}</p>
                `;
            }
        }
    </script>
</body>
</html>
```

### 10.2 Update Server to Serve Static Files
Your `server.ts` already includes:
```typescript
app.use(express.static("public")); // Serve static files
```

### 10.3 Deploy Update
```bash
git add .
git commit -m "Add simple web interface"
git push
```

Render will automatically redeploy. Visit your site to see the interface!

---

## ✅ Step 11: Verify Everything Works

### 11.1 Test Checklist
- [ ] Website loads at your Render URL
- [ ] Polls display correctly
- [ ] Voting works (check Supabase data)
- [ ] Chapter generation works (may take 30 seconds)
- [ ] GitHub Actions run daily at 9 AM UTC
- [ ] GitHub Actions close polls weekly on Saturday

### 11.2 Monitor Your System
1. **Render Logs**: Check your Render dashboard for any errors
2. **GitHub Actions**: Monitor the Actions tab for successful runs
3. **Supabase**: Check your database tables for new data
4. **OpenRouter Usage**: Monitor your credit usage

---

## 🚨 Troubleshooting Common Issues

### "Environment variable not set"
- Double-check your `.env` file has all variables
- Make sure Render environment variables are saved
- Restart your Render service

### "Agent failed to generate chapter"
- Check your OpenRouter API key is valid and has credit
- Verify Bootoshi Cloud credentials
- Check Render logs for specific error messages

### "Database connection failed"
- Verify Supabase URL and key are correct
- Check if your Supabase project is still active
- Make sure tables were created correctly

### "GitHub Actions not running"
- Check repository secrets are set correctly
- Verify workflows are enabled in Actions tab
- Make sure your Render app is responding to requests

---

## 🎯 Next Steps

Congratulations! You now have a fully functional AI story engine. Here's what you can do next:

### Immediate Improvements
1. **Customize the story prompt** in `src/agents/chapterAgent.ts`
2. **Add more poll questions** to keep community engaged
3. **Style your web interface** with better CSS
4. **Set up monitoring** with webhook notifications

### Advanced Features
1. **Add user authentication** for more personalized experiences
2. **Create a mobile app** for easier poll participation
3. **Add story analytics** to track engagement
4. **Export stories** to PDF or ePub formats

### Community Building
1. **Share your story URL** with friends
2. **Create social media accounts** for updates
3. **Set up Discord/Telegram** for community discussion
4. **Add newsletter signup** for chapter notifications

---

## 💡 Tips for Success

1. **Start simple**: Get the basic version working before adding features
2. **Monitor costs**: Check OpenRouter usage regularly
3. **Backup regularly**: Export your Supabase data weekly
4. **Engage community**: Polls drive engagement - make them interesting!
5. **Be patient**: AI generation takes time, set expectations correctly

---

## 📞 Getting Help

If you get stuck:

1. **Check the logs** first (Render dashboard, GitHub Actions, browser console)
2. **Re-read this guide** - you might have missed a step
3. **Google the exact error message**
4. **Create an issue** on the GitHub repository
5. **Ask in relevant Discord/Telegram groups**

Remember: Every expert was once a beginner. Take your time, follow each step carefully, and you'll have an amazing AI-powered story engine running in no time!

---

**🎉 You did it! Your Bald Brothers Story Engine is now live on the internet, automatically generating chapters and engaging your community with polls. Welcome to the future of interactive storytelling!**