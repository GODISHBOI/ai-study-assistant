const KEY = "studymate_history";
const MAX_ITEMS = 50;

export function getHistory() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveToHistory(filename, notes) {
  const item = {
    id: Date.now(),
    filename,
    notes,
    date: new Date().toISOString(),
  };
  const updated = [item, ...getHistory()].slice(0, MAX_ITEMS);
  try {
    localStorage.setItem(KEY, JSON.stringify(updated));
  } catch {
    // storage full or blocked; ignore
  }
  return updated;
}

export function deleteFromHistory(id) {
  const updated = getHistory().filter((item) => item.id !== id);
  try {
    localStorage.setItem(KEY, JSON.stringify(updated));
  } catch {
    // ignore
  }
  return updated;
}

export function clearHistory() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  return [];
}