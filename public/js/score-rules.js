(() => {
  const statusFor = (scoreA, scoreB, rules) => {
    const touchScore = Math.max(1, Number(rules?.touchScore) || 11);
    const maxScore = Math.max(1, Number(rules?.maxScore) || 15);
    const high = Math.max(scoreA, scoreB);
    const diff = Math.abs(scoreA - scoreB);
    return high >= maxScore || (high >= touchScore && diff >= 2 && scoreA !== scoreB) ? 'FINISHED' : 'PLAYING';
  };

  const maxAllowedScore = (opponentScore, rules) => {
    const touchScore = Math.max(1, Number(rules?.touchScore) || 11);
    const maxScore = Math.max(1, Number(rules?.maxScore) || 15);
    if (opponentScore >= touchScore - 1) return Math.min(opponentScore + 2, maxScore);
    return Math.min(touchScore, maxScore);
  };

  const clampScores = (scoreA, scoreB, rules) => {
    let nextA = Math.min(Math.max(0, scoreA), maxAllowedScore(scoreB, rules));
    let nextB = Math.min(Math.max(0, scoreB), maxAllowedScore(nextA, rules));
    nextA = Math.min(nextA, maxAllowedScore(nextB, rules));
    return [nextA, nextB];
  };

  window.VodichScoreRules = Object.freeze({
    clampScores,
    statusFor,
  });
})();
