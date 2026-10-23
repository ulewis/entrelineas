/** One translation at a time. Preserve finals; coalesce obsolete interim requests. */
export class TranslationQueue {
  constructor({ translate, onResult, onError = () => {}, now = () => performance.now(), delay = 140 }) {
    Object.assign(this, { translate, onResult, onError, now, delay });
    this.pending = new Map();
    this.busy = false;
    this.generation = 0;
    this.timer = null;
  }
  enqueue(task) {
    const current = this.pending.get(task.id);
    if (current && current.revision > task.revision) return;
    const queuedAt = current?.queuedAt ?? this.now();
    this.pending.set(task.id, { ...task, queuedAt, generation: this.generation });
    clearTimeout(this.timer);
    // Don't let continuous interim changes postpone translation indefinitely.
    if (task.final || this.busy || this.pending.size > 1) this.pump();
    else {
      const remaining = Math.max(0, this.delay - (this.now() - queuedAt));
      this.timer = setTimeout(() => this.pump(), remaining);
    }
  }
  async pump() {
    if (this.busy || !this.pending.size) return;
    clearTimeout(this.timer);
    const tasks = [...this.pending.values()];
    const task = tasks.find(item => item.final) || tasks[0];
    this.pending.delete(task.id);
    this.busy = true;
    try {
      const text = await this.translate(task.text);
      if (task.generation === this.generation) {
        this.onResult({ ...task, text: String(text), elapsed: this.now() - task.receivedAt });
      }
    } catch (error) {
      if (task.generation === this.generation) this.onError(error, task);
    } finally {
      this.busy = false;
      this.pump();
    }
  }
  reset() {
    this.generation += 1;
    this.pending.clear();
    clearTimeout(this.timer);
  }
}

export class Transcript {
  constructor(limit = 250) {
    this.limit = limit;
    this.rows = new Map();
  }
  update(id, text, final, receivedAt) {
    text = String(text).trim();
    if (!text) return null;
    let row = this.rows.get(id);
    if (row?.en === text && row.final === final) return null;
    if (row?.final && !final) return null;
    if (!row) {
      row = { id, en: '', es: '', revision: 0, translatedRevision: 0, final: false, translatedFinal: false, error: '' };
      this.rows.set(id, row);
    }
    Object.assign(row, { en: text, final, receivedAt, revision: row.revision + 1, error: '' });
    while (this.rows.size > this.limit) this.rows.delete(this.rows.keys().next().value);
    return row;
  }
  apply(result) {
    const row = this.rows.get(result.id);
    if (!row || result.revision < row.translatedRevision) return null;
    Object.assign(row, { es: result.text, translatedRevision: result.revision, translatedFinal: result.final, elapsed: result.elapsed, error: '' });
    return row;
  }
  exportText() {
    return [...this.rows.values()].map(row => `EN: ${row.en}\nES: ${row.es || '[Traducción pendiente]'}`).join('\n\n');
  }
  clear() { this.rows.clear(); }
}
