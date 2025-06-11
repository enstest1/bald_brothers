import React, { useState, useEffect } from 'react';

interface Poll {
  id: string;
  question: string;
  options: string[];
  closes_at: string;
}

interface PollApiResponse {
  poll: Poll | null;
}

interface VoteResponse {
  success: boolean;
  clientId: string;
}

export function Poll() {
  const [poll, setPoll] = useState<Poll | null>(null);
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [hasVoted, setHasVoted] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [voting, setVoting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch the current open poll
  useEffect(() => {
    fetchOpenPoll();
  }, []);

  const fetchOpenPoll = async () => {
    try {
      setLoading(true);
      const response = await fetch('/polls/open');
      const data = await response.json() as PollApiResponse;
      
      if (!response.ok) {
        throw new Error('Failed to fetch poll');
      }

      setPoll(data.poll);
      setError(null);
    } catch (err) {
      setError('Failed to load poll');
      console.error('Error fetching poll:', err);
    } finally {
      setLoading(false);
    }
  };

  const submitVote = async () => {
    if (!poll || selectedChoice === null) return;

    try {
      setVoting(true);
      const response = await fetch(`/polls/${poll.id}/vote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ choice: selectedChoice }),
      });

      const data = await response.json() as VoteResponse;

      if (!response.ok) {
        throw new Error('Failed to submit vote');
      }

      setHasVoted(true);
      setError(null);
    } catch (err) {
      setError('Failed to submit vote');
      console.error('Error submitting vote:', err);
    } finally {
      setVoting(false);
    }
  };

  const handleChoiceChange = (choice: number) => {
    setSelectedChoice(choice);
  };

  if (loading) {
    return (
      <div className="poll-container">
        <div className="loading">Loading poll...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="poll-container">
        <div className="error">{error}</div>
        <button onClick={fetchOpenPoll}>Retry</button>
      </div>
    );
  }

  if (!poll) {
    return (
      <div className="poll-container">
        <div className="no-poll">No active poll at this time.</div>
      </div>
    );
  }

  const isExpired = new Date(poll.closes_at) < new Date();

  if (hasVoted || isExpired) {
    return (
      <div className="poll-container">
        <h2>Poll</h2>
        <div className="poll-question">{poll.question}</div>
        <div className="poll-status">
          {hasVoted ? "Thanks for voting! " : ""}
          {isExpired ? "This poll has ended." : "Poll is still active."}
        </div>
        {!isExpired && (
          <div className="poll-info">
            Closes: {new Date(poll.closes_at).toLocaleString()}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="poll-container">
      <h2>Weekly Poll</h2>
      <div className="poll-question">{poll.question}</div>
      
      <div className="poll-options">
        <label className="poll-option">
          <input
            type="radio"
            name="poll-choice"
            value={0}
            checked={selectedChoice === 0}
            onChange={() => handleChoiceChange(0)}
          />
          <span className="option-text">Yes</span>
        </label>
        
        <label className="poll-option">
          <input
            type="radio"
            name="poll-choice"
            value={1}
            checked={selectedChoice === 1}
            onChange={() => handleChoiceChange(1)}
          />
          <span className="option-text">No</span>
        </label>
      </div>

      <button 
        onClick={submitVote}
        disabled={selectedChoice === null || voting}
        className="vote-button"
      >
        {voting ? 'Submitting...' : 'Submit Vote'}
      </button>

      <div className="poll-info">
        Closes: {new Date(poll.closes_at).toLocaleString()}
      </div>

    </div>
  );
}