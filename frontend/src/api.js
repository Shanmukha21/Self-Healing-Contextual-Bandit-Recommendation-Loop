const API_BASE_URL = "http://127.0.0.1:8000";

/**
 * Get status of database connection and Vowpal Wabbit loop.
 */
export async function fetchStatus() {
  const response = await fetch(`${API_BASE_URL}/status`);
  if (!response.ok) {
    throw new Error("Failed to fetch system status");
  }
  return response.json();
}

/**
 * Get a recommendation from the bandit loop based on context.
 */
export async function fetchRecommendation(context) {
  const response = await fetch(`${API_BASE_URL}/recommend`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ context }),
  });
  if (!response.ok) {
    throw new Error("Failed to fetch recommendation");
  }
  return response.json();
}

/**
 * Log reward (feedback) for a given recommendation.
 */
export async function submitReward(logId, reward) {
  const response = await fetch(`${API_BASE_URL}/reward`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ log_id: logId, reward }),
  });
  if (!response.ok) {
    throw new Error("Failed to submit reward");
  }
  return response.json();
}

/**
 * Retrieve the current PMF distribution for a specific context.
 */
export async function fetchPMF(context) {
  const response = await fetch(`${API_BASE_URL}/model/pmf`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ context }),
  });
  if (!response.ok) {
    throw new Error("Failed to fetch model PMF");
  }
  return response.json();
}

/**
 * Get chronological list of rewards and running averages.
 */
export async function fetchHistory() {
  const response = await fetch(`${API_BASE_URL}/history`);
  if (!response.ok) {
    throw new Error("Failed to fetch reward history");
  }
  return response.json();
}

/**
 * Clear MongoDB logs and re-initialize Vowpal Wabbit workspace.
 */
export async function resetLoop() {
  const response = await fetch(`${API_BASE_URL}/reset`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error("Failed to reset learning loop");
  }
  return response.json();
}
