import { randomUUID } from 'node:crypto';
import { configureGoogle } from './google-settings.mjs';
import { launchKeyPicker } from './native-key-picker.mjs';
const active = operation => operation?.status === 'pending';
export class GoogleKeyPicker {
  constructor(config, launch = launchKeyPicker, save = configureGoogle) { this.config = config; this.launch = launch; this.save = save; this.operation = null; this.session = null; }
  start({ mode = 'load', anchor }) {
    // An operation owns its native process. Repeated clicks rejoin/focus it,
    // including a retry after the browser lost the original HTTP response.
    if (active(this.operation)) { this.session?.focus(); return this.get(); }
    if (mode !== 'load') throw new Error('Invalid key operation');
    const operation = this.operation = { id: randomUUID(), mode, status: 'pending', phase: 'starting', windowOpen: false, pid: null, windowId: null };
    try {
      this.session = this.launch(mode, state => {
        if (this.operation === operation && active(operation)) Object.assign(operation, state);
      }, anchor);
      operation.pid = this.session.pid || null;
      const session = this.session;
      void (async () => {
        try {
          const selected = await session.result;
          if (!selected || operation.cancelling) { operation.status = 'cancelled'; return; }
          operation.phase = 'saving'; operation.windowOpen = false;
          const file = selected;
          await this.save(this.config, { file });
          operation.status = 'done';
        } catch (error) { operation.status = operation.cancelling ? 'cancelled' : 'error'; if (!operation.cancelling) operation.error = error.message; }
        finally { operation.phase = 'closed'; operation.windowOpen = false; operation.pid = null; operation.windowId = null; delete operation.cancelling; if (this.session === session) this.session = null; }
      })();
    } catch (error) { operation.status = 'error'; operation.phase = 'closed'; operation.error = error.message; }
    return this.get();
  }
  get(id) { return !id || this.operation?.id === id ? (this.operation ? { ...this.operation } : null) : { id, status: 'error', error: 'File selection expired. Try again.' }; }
  focus(id) { if (id === this.operation?.id && active(this.operation)) this.session?.focus(); return this.get(id); }
  cancel(id) { if (id === this.operation?.id && active(this.operation) && this.operation.phase !== 'saving') { this.operation.cancelling = true; this.session?.cancel(); } return this.get(id); }
  close() { if (this.operation) this.cancel(this.operation.id); }
}
