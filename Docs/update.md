<script>
    const pollSection = document.getElementById('poll-section');
    const storySection = document.getElementById('story-section');
    const storyHeading = document.getElementById('story-heading');
    const chapterContent = document.getElementById('chapter-content');
    const currentPollDiv = document.getElementById('current-poll');

    let currentPoll = null;
    let pollInterval;

    // --- Core Functions ---

    async function fetchLatestChapter() {
        try {
            const response = await fetch('/api/beats/latest');
            const data = await response.json();
            if (!response.ok) {
                if(response.status === 404) {
                    storyHeading.textContent = 'The Story Begins...';
                    chapterContent.innerHTML = `<p>${data.body}</p>`;
                } else {
                   throw new Error(data.error || 'Failed to load chapter');
                }
            } else {
                storyHeading.textContent = data.title;
                chapterContent.innerHTML = `<p>${data.body.replace(/\n/g, '<br>')}</p>`;
                if (data.body && data.body.includes('The Bald Brothers continue their journey, but the details are lost to legend.')) {
                    chapterContent.innerHTML += '<p style="color:orange;"><em>(AI is recharging. This is a fallback chapter.)</em></p>';
                }
            }
            storySection.style.display = 'block';
        } catch (error) {
            console.error('Error fetching chapter:', error);
            storyHeading.textContent = 'Error Loading Story';
            chapterContent.innerHTML = '<p>Could not load the latest chapter. Please refresh the page.</p>';
        }
    }

    async function fetchOpenPoll() {
        try {
            const response = await fetch('/polls/open');
            const data = await response.json();
            
            if (data.poll) {
                if (pollInterval) clearInterval(pollInterval); // Stop polling once we find a poll
                currentPoll = data.poll;
                displayPoll(currentPoll);
            } else {
                // If no poll is active, keep trying every 5 seconds
                currentPollDiv.innerHTML = '<h2>Searching for the next path...</h2>';
                if (!pollInterval) {
                   pollInterval = setInterval(fetchOpenPoll, 5000);
                }
            }
        } catch (error) {
            console.error('Error loading poll:', error);
            currentPollDiv.innerHTML = '<h2>Error loading poll. Retrying...</h2>';
        }
    }

    function displayPoll(poll) {
        currentPollDiv.innerHTML = `
            <h2>Current Poll</h2>
            <p><strong>${poll.question}</strong></p>
            <div class="poll-options">
              ${poll.options.map((option, index) => `
                <button onclick="vote(${index})">${option}</button>
              `).join('')}
            </div>
            <p><small>A new path will be chosen soon...</small></p>
        `;
    }

    async function vote(choiceIndex) {
        if (!currentPoll) return;

        currentPollDiv.innerHTML = `
            <h2>Thank you for voting!</h2>
            <p>The Bald Brothers' destiny is being forged...</p>
            <p>Generating next chapter...</p>
            <div id="next-chapter-countdown">Next chapter in 10 seconds...</div>
        `;

        try {
            await fetch(`/polls/${currentPoll.id}/vote`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ choice: choiceIndex })
            });

            // Wait for backend to process and start a new cycle
            setTimeout(() => {
                location.reload(); // Simple solution: reload the page to get the new state
            }, 10000); // 10 seconds

        } catch (error) {
            console.error('Error submitting vote:', error);
            alert('Failed to submit vote. Please try again.');
            loadPoll(); // Re-load the poll on failure
        }
    }

    // --- Initial Load ---

    function initialize() {
        storyHeading.textContent = 'Loading The Saga...';
        currentPollDiv.innerHTML = '<h2>Loading...</h2>';
        
        fetchLatestChapter();
        fetchOpenPoll();
    }
    
    // Remove the old countdown logic from the body
    const initialCountdownDiv = document.getElementById('countdown');
    if(initialCountdownDiv) initialCountdownDiv.style.display = 'none';

    initialize();
</script>