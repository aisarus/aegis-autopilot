'use strict';

const AUTOMATIC_THRESHOLDS = Object.freeze({
  wait: 0.65,
  continue: 0.68,
  review: 0.72,
  enqueue: 0.76,
  send_next: 0.76
});

const AUTOMATIC_ACTIONS = new Set(Object.keys(AUTOMATIC_THRESHOLDS));
const DEFAULT_PENDING_MAX_AGE_MS = 10 * 60 * 1000;

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function automaticDecisionAllowed({
  decision,
  autopilotEnabled,
  chatId,
  turnsUsed = 0,
  maxTurns = 0,
  queueCount = 0
} = {}) {
  if (!decision || !autopilotEnabled || !chatId || decision.targetChatId !== chatId) return false;
  if (!AUTOMATIC_ACTIONS.has(decision.action)) return false;

  const limit = Math.max(0, finiteNumber(maxTurns));
  const used = Math.max(0, finiteNumber(turnsUsed));
  if (limit > 0 && used >= limit) return false;

  const confidence = Math.min(1, Math.max(0, finiteNumber(decision.confidence)));
  if (confidence < AUTOMATIC_THRESHOLDS[decision.action]) return false;

  if (decision.action === 'enqueue' && !String(decision.prompt || '').trim()) return false;
  if (decision.action === 'send_next' && Math.max(0, finiteNumber(queueCount)) < 1) return false;
  return true;
}

function pendingDecisionMatches({
  decision,
  currentResponseHash,
  nowMs = Date.now(),
  maxAgeMs = DEFAULT_PENDING_MAX_AGE_MS
} = {}) {
  const expectedHash = String(currentResponseHash || '').trim();
  const decisionHash = String(decision?.sourceResponseHash || '').trim();
  if (!decision || !expectedHash || !decisionHash || decisionHash !== expectedHash) return false;

  const createdAtMs = Date.parse(String(decision.createdAt || ''));
  if (!Number.isFinite(createdAtMs)) return false;
  const ageMs = finiteNumber(nowMs) - createdAtMs;
  return ageMs >= 0 && ageMs <= Math.max(0, finiteNumber(maxAgeMs, DEFAULT_PENDING_MAX_AGE_MS));
}

module.exports = {
  AUTOMATIC_THRESHOLDS,
  DEFAULT_PENDING_MAX_AGE_MS,
  automaticDecisionAllowed,
  pendingDecisionMatches
};
