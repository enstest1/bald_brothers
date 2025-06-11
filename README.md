# Bald Brothers Story Engine

A sophisticated story generation system that automatically creates daily chapters using AI agents, manages long-term narrative memory, and runs community polls to guide story direction.

## Features

- 🤖 **Automated Daily Chapters**: Generate compelling story content every day using Feather AI + OpenRouter
- 📚 **Long-term Memory**: Persist and retrieve narrative context through Bootoshi Cloud (mem0)
- 🗳️ **Community Polls**: Weekly binary polls that influence story direction
- ⏰ **Scheduled Automation**: GitHub Actions handle daily generation and weekly poll closure
- 🚀 **Deployable Anywhere**: Works on Render, Fly, VPS, or any hosting platform

## Architecture

```
┌─── GitHub Actions ───┐    ┌─── Express Server ───┐    ┌─── External APIs ───┐
│  Daily Chapter       │───▶│  /api/progress        │───▶│  Bootoshi Cloud     │
│  Weekly Poll Close   │    │  /polls/*             │    │  OpenRouter/OpenAI  │
└──────────────────────┘    │  Poll Management      │    │  Supabase           │
                            └───────────────────────┘    └─────────────────────┘
```

## Quick Start

### 1. Environment Setup

```bash
# Copy environment template
cp .env.example .env

# Edit .env with your credentials
nano .env
```

Required environment variables:
- `CLOUD_URL`: Bootoshi Cloud endpoint (https://api.baldbros.xyz)
- `CLOUD_PASSWORD`: Your Bootoshi Cloud password
- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_ANON_KEY`: Supabase anonymous public key
- `OPENROUTER_API_KEY`: OpenRouter API key for AI model access

### 2. Database Setup (Supabase)

Create these tables in your Supabase database:

```sql
-- Polls table
CREATE TABLE polls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question text NOT NULL,
  options text[] NOT NULL DEFAULT ARRAY['yes','no'],
  closes_at timestamptz NOT NULL
);

-- Votes table  
CREATE TABLE votes (
  poll_id uuid REFERENCES polls(id),
  client_id uuid NOT NULL,
  choice int NOT NULL CHECK (choice IN (0, 1)),
  PRIMARY KEY (poll_id, client_id)
);

-- Story beats table
CREATE TABLE beats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  arc_id text NOT NULL,
  body text NOT NULL,
  authored_at timestamptz DEFAULT now()
);
```

### 3. Installation & Development

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Start development server
npm run dev

# Or run with file watching
npm run dev:watch
```

### 4. Testing

```bash
# Test chapter agent
npm run test:agents

# Test full integration
npm run dev:all
```

## API Endpoints

### Story Generation
- `POST /api/worlds/:id/arcs/:arcId/progress` - Generate new chapter

### Poll Management
- `GET /polls/open` - Get current open poll
- `POST /polls/:id/vote` - Submit vote (choice: 0=yes, 1=no)
- `POST /polls/create` - Create new poll
- `POST /polls/close-current` - Close current poll and tally results

### System
- `GET /health` - Health check
- `GET /` - API documentation

## Deployment

### GitHub Actions Setup

1. Add repository secrets:
   - `API_URL`: Your deployed server URL
   - `API_TOKEN`: Secure token for API authentication

2. The workflows will automatically:
   - Generate chapters daily at 9:00 AM UTC
   - Close polls weekly on Saturday at 23:59 UTC

### Render Deployment

```bash
# Build command
npm run build

# Start command  
npm start

# Environment variables
# Add all variables from .env.example
```

### Docker Deployment

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

## File Structure

```
story-engine/
├── src/
│   ├── agents/
│   │   └── chapterAgent.ts        # AI agent for story generation
│   ├── lib/
│   │   └── cloudClient.ts         # Bootoshi Cloud integration
│   └── components/
│       └── Poll.tsx               # React poll UI component
├── server/
│   ├── routes/
│   │   ├── chapters.ts            # Chapter generation endpoints
│   │   └── polls.ts               # Poll management endpoints
│   └── sched/
│       └── closePoll.ts           # Scheduled poll closure
├── .github/
│   └── workflows/
│       ├── daily-chapter.yml      # Daily chapter GitHub Action
│       └── weekly-close.yml       # Weekly poll closure Action
├── server.ts                      # Main server entry point
└── tsconfig.json                  # TypeScript configuration
```

## Development Workflow

1. **Chapter Generation**: The `ChapterAgent` uses tools to fetch recent story context and save new chapters
2. **Memory Persistence**: All story content is stored in both Supabase and Bootoshi Cloud for different access patterns
3. **Poll Lifecycle**: Community polls run weekly, with results fed back into story context
4. **Automated Scheduling**: GitHub Actions ensure consistent daily content generation

## Logging

The system uses `pino` for structured JSON logging:

```typescript
log.info("[agent] fetched %d memories", list.length);
log.warn("Poll duplicate client_id %s", client_id);  
log.error(err, "Bootoshi Cloud failure");
log.info("Chapter length=%d saved", output.length);
```

## Security

- API endpoints are protected with token authentication
- Poll voting uses secure UUID-based client identification
- Environment variables keep all credentials secure
- CORS and other security headers should be added for production

## Troubleshooting

### Common Issues

**Build Errors**
```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
npm run build
```

**Agent Not Generating Chapters**
- Check `OPENROUTER_API_KEY` is set correctly
- Verify `CLOUD_URL` and `CLOUD_PASSWORD` are working
- Check logs with `npm run dev` for specific errors

**Poll Voting Not Working**
- Ensure Supabase tables are created correctly
- Check `SUPABASE_URL` and `SUPABASE_ANON_KEY` are valid
- Verify cookie-parser middleware is working

### Environment Variables Checklist

```bash
# Required for basic functionality
✓ CLOUD_URL=https://api.baldbros.xyz
✓ CLOUD_PASSWORD=your_password
✓ SUPABASE_URL=https://xxx.supabase.co
✓ SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
✓ OPENROUTER_API_KEY=sk-or-v1-xxx

# Optional but recommended
○ OPENPIPE_API_KEY=your_openpipe_key
○ API_TOKEN=secure_random_token
○ PORT=3000
○ NODE_ENV=production
```

## Performance Notes

- **Chapter Generation**: Typically takes 10-30 seconds depending on model and context length
- **Memory Storage**: Bootoshi Cloud handles vector storage efficiently, no local caching needed
- **Poll Queries**: Supabase handles concurrent voting well, but consider connection pooling for high traffic
- **Scheduled Jobs**: GitHub Actions have a 5-minute execution limit, perfect for our use case

## Advanced Configuration

### Custom System Prompts

Edit `src/agents/chapterAgent.ts` to customize the storytelling style:

```typescript
systemPrompt: `You are the Bald Brothers Scribe...
- Custom instruction 1
- Custom instruction 2
- Maintain consistency with existing lore`
```

### Poll Question Templates

Create dynamic poll questions by modifying `weekly-close.yml`:

```yaml
- name: Create next week's poll
  run: |
    questions=(
      "Should the story take a darker turn?"
      "Should new characters be introduced?"
      "Should the brothers face their greatest challenge yet?"
    )
    question=${questions[$RANDOM % ${#questions[@]}]}
    # Use $question in API call
```

### Monitoring & Alerts

Set up webhook notifications for failures:

```yaml
- name: Notify on failure
  if: failure()
  run: |
    curl -X POST "${{ secrets.DISCORD_WEBHOOK }}" \
      -H "Content-Type: application/json" \
      -d '{"content": "⚠️ Story generation failed!"}'
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Test your changes with `npm run test:agents`
4. Commit your changes (`git commit -m 'Add amazing feature'`)
5. Push to the branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

### Development Guidelines

- Follow the existing TypeScript patterns
- Add appropriate logging statements using `pino`
- Test all API endpoints manually before submitting
- Ensure environment variables are documented in `.env.example`
- Update README.md if adding new features

## Roadmap

### Planned Features

- [ ] **Multi-language support** for international communities
- [ ] **Story analytics dashboard** showing engagement metrics
- [ ] **Character relationship tracking** via knowledge graphs
- [ ] **Community story suggestions** via additional poll types
- [ ] **Mobile app** for easier poll participation
- [ ] **Story export** to PDF/ePub formats

### Technical Improvements

- [ ] **Rate limiting** for API endpoints
- [ ] **Caching layer** for frequently accessed polls
- [ ] **Backup/restore** functionality for story data
- [ ] **A/B testing** for different agent prompts
- [ ] **Metrics collection** and monitoring dashboard

## License

MIT License - Built with ❤️ for the Bald Brothers community

---

**Need help?** Open an issue or contact the maintainers. Happy storytelling! 📚✨