# Bald Brothers Story Engine - Development Log

## Project Overview
The Bald Brothers Story Engine is a sophisticated story generation system that automatically creates daily chapters using AI agents, manages long-term narrative memory, and runs community polls to guide story direction.

## Environment Setup
- Node.js version: 18.x (required)
- Key dependencies:
  - Express
  - Supabase
  - OpenRouter AI
  - Feather AI
  - Winston for logging

## Recent Changes and Fixes

### 2024-06-14: Scheduler, Poll, and Chapter Generation Robustness
- Fixed aggressive backend poll scheduler (was running every 10s with an artificial 60s delay, causing server overload and unresponsiveness).
- Removed unnecessary setTimeout delay in the cron callback.
- Set scheduler interval to 35 seconds for dev/test to prevent overlapping executions and reduce server load.
- Added a lock (`isProcessingPollClosure`) to prevent concurrent executions of `closePollAndTally`.
- Improved logging for scheduler events and poll closure.
- Fixed database insert errors by removing the `title` field from chapter inserts (matches `beats` table schema).
- Ensured fallback chapter body is always set if AI agent fails or returns empty output.
- Now, after every poll closes, a chapter is always generated and saved, and the server remains responsive.
- Frontend and backend are now in sync: after voting, a new chapter is always saved and displayed.
- Error about the `title` column is resolved, and the story engine works as intended.
- **What worked:** The lock and longer scheduler interval stopped server overload. Removing the `title` field fixed DB errors. Fallback logic ensures the story always continues, even if the AI fails.

### 1. Poll System Enhancements
- Added vote count display for poll options
- Implemented dynamic poll options based on user votes
- Enhanced poll closure mechanism
- Added vote validation and duplicate prevention
- Improved poll voting UX: after voting, users see results and a thank you message, then auto-refresh for next poll
- Switched backend poll logging from pino to Winston for consistency and advanced logging features

### 2. Chapter Generation Improvements
- Extended chapter length for better story development
- Enhanced AI prompt engineering for more coherent narratives
- Implemented better error handling for AI generation failures
- Added logging for chapter generation process

### 3. System Stability
- Fixed Node.js version compatibility issues
- Resolved dependency conflicts
- Enhanced error handling across all endpoints
- Improved logging system implementation

## How to Run the Project

### Local Development
1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up environment variables:
   - Copy `.env.example` to `.env`
   - Fill in all required credentials
4. Build the project:
   ```bash
   npm run build
   ```
5. Start development server:
   ```bash
   npm run dev
   ```

### Production Deployment
1. Ensure all environment variables are set in Render dashboard
2. Deploy latest commit through Render dashboard
3. Monitor deployment logs for any issues
4. Verify all endpoints are working after deployment

## Known Issues and Solutions

### 1. Port Conflicts
- Issue: EADDRINUSE error when starting server
- Solution: Use `npx kill-port 3000` to clear the port before starting

### 2. Node Version Mismatch
- Issue: Compatibility problems with Node.js versions
- Solution: Ensure using Node.js 18.x as specified in package.json

### 3. Environment Variables
- Issue: Missing or incorrect environment variables
- Solution: Double-check all required variables in .env file:
  ```
  CLOUD_URL
  CLOUD_PASSWORD
  SUPABASE_URL
  SUPABASE_ANON_KEY
  OPENROUTER_API_KEY
  API_TOKEN
  ```

## Next Steps

### Immediate Tasks
1. Implement comprehensive error monitoring
2. Add automated testing suite
3. Enhance logging system
4. Implement rate limiting for API endpoints

### Future Enhancements
1. Add user authentication system
2. Implement story analytics
3. Create admin dashboard
4. Add more interactive features

## Deployment Checklist
- [ ] Verify all environment variables
- [ ] Run build process locally
- [ ] Test all endpoints
- [ ] Check logging system
- [ ] Verify poll system
- [ ] Test chapter generation
- [ ] Monitor initial deployment

## Troubleshooting Guide

### Common Issues
1. Server won't start
   - Check port availability
   - Verify Node.js version
   - Check environment variables

2. Poll system not working
   - Verify Supabase connection
   - Check poll closure schedule
   - Validate vote counting logic

3. Chapter generation fails
   - Check OpenRouter API key
   - Verify AI model availability
   - Check memory system connection

### Debug Commands
```bash
# Check server status
npm run dev

# Clear port if needed
npx kill-port 3000

# Rebuild project
npm run build

# Check logs
npm run dev:watch
```

## Maintenance Notes
- Regular dependency updates needed
- Monitor API rate limits
- Check Supabase connection health
- Verify GitHub Actions schedules

## Security Considerations
- Keep API keys secure
- Regular security audits
- Monitor for suspicious activity
- Implement rate limiting
- Secure all endpoints

## Performance Optimization
- Implement caching where appropriate
- Optimize database queries
- Monitor memory usage
- Regular performance testing

## Documentation Updates
- Keep API documentation current
- Update deployment procedures
- Maintain troubleshooting guide
- Document new features

## Contact Information
For issues and support:
- GitHub Issues
- Project maintainers
- Technical documentation

## Poll & Story System Status (Testing)
- Poll timer (10s in all modes for now): Working
- Voting and result display: Working (but needs UI/UX polish)
- Poll closes and tallies votes: Working
- Next chapter generated after poll: IMPLEMENTED
- Two new story options per chapter: IMPLEMENTED
- Full story branching loop: IMPLEMENTED

### Next Steps
- Polish UI/UX for voting/results
- Add more advanced story analytics and admin controls
- Continue to monitor and optimize story branching and user experience

---
Last Updated: [Current Date]
Maintainer: [Your Name]
