import { optimizeThreshold } from './simulator.mjs';

self.onmessage = event => {
  try {
    self.postMessage({ ok: true, result: optimizeThreshold(event.data.input, event.data.options) });
  } catch (error) {
    self.postMessage({ ok: false, error: error.message });
  }
};
