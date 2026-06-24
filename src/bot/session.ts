interface PendingSession {
  promptMessageIds: number[];
  limitDurationMs?: number;
  tradeMode?: 'market' | 'limit';
}

const sessions = new Map<number, PendingSession>();

export function getSession(chatId: number): PendingSession {
  let session = sessions.get(chatId);
  if (!session) {
    session = { promptMessageIds: [] };
    sessions.set(chatId, session);
  }
  return session;
}

export function addPromptMessage(chatId: number, messageId: number): void {
  getSession(chatId).promptMessageIds.push(messageId);
}

export function setLimitDuration(chatId: number, durationMs: number): void {
  const session = getSession(chatId);
  session.limitDurationMs = durationMs;
  session.tradeMode = 'limit';
}

export function setTradeMode(chatId: number, mode: 'market' | 'limit'): void {
  getSession(chatId).tradeMode = mode;
}

export function getLimitDuration(chatId: number): number | undefined {
  return getSession(chatId).limitDurationMs;
}

export function getTradeMode(chatId: number): 'market' | 'limit' | undefined {
  return getSession(chatId).tradeMode;
}

export function clearSession(chatId: number): void {
  sessions.delete(chatId);
}

export function takePromptMessageIds(chatId: number): number[] {
  const session = sessions.get(chatId);
  if (!session) return [];
  const ids = [...session.promptMessageIds];
  session.promptMessageIds = [];
  return ids;
}
