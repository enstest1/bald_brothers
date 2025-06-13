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
  const [results, setResults] = useState<{ option: string; count: number }[] | null>(null);

  // Fetch the current open poll
  useEffect(() => {
    fetchOpenPoll();
  }, []);

  // Fetch poll results after voting or poll expiry
  useEffect(() => {
    if ((hasVoted || (poll && new Date(poll.closes_at) < new Date())) && poll) {
      fetch(`/polls/${poll.id}/results`)
        .then(r => r.json())
        .then((data: unknown) => {
          // Type guard for results
          if (data && typeof data === 'object' && 'results' in data && Array.isArray((data as any).results)) {
            setResults((data as { results: { option: string; count: number }[] }).results);
          } else {
            setResults(null);
          }
        })
        .catch(() => setResults(null));
    }
  }, [hasVoted, poll]);

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
      // Immediately fetch results after voting
      const resultsResponse = await fetch(`/polls/${poll.id}/results`);
      const resultsData = await resultsResponse.json();
      if (resultsData && resultsData.results) {
        setResults(resultsData.results);
      }
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
        <h2>Poll Results</h2>
        <div className="poll-question">{poll.question}</div>
        <div className="poll-status">
          {hasVoted ? "Thanks for voting! " : ""}
          {isExpired ? "This poll has ended." : "Poll is still active."}
        </div>
        {results && (
          <div className="poll-results">
            <div className="result-bar">
              <div className="yes-bar" style={{ width: `${(results[0].count / (results[0].count + results[1].count)) * 100}%` }}>
                Yes: {results[0].count} votes
              </div>
              <div className="no-bar" style={{ width: `${(results[1].count / (results[0].count + results[1].count)) * 100}%` }}>
                No: {results[1].count} votes
              </div>
            </div>
            <div className="total-votes">
              Total votes: {results[0].count + results[1].count}
            </div>
          </div>
        )}
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