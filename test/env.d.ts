import type { Bindings } from '../src/index.js';

// Types `env` from `cloudflare:workers` inside tests.
declare global {
  namespace Cloudflare {
    interface Env extends Bindings {}
  }
}
