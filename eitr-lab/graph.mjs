import { eitrAtSegment } from './simulator.mjs';

// UI-independent graph interpretation. Curves are sampled through the engine's
// exact segment evaluator; no regeneration formula is implemented here.
export function graphData(result, windowEnd, maxSegments = 400) {
  if (!result || !Array.isArray(result.segments) || !Array.isArray(result.casts)) {
    throw new TypeError('Invalid simulation result');
  }
  if (!Number.isFinite(windowEnd) || windowEnd < 0) throw new RangeError('Invalid graph window');
  const end = Math.min(windowEnd, result.duration);
  const visible = result.segments.filter(segment => segment.start < end);
  const stride = Math.max(1, Math.ceil(visible.length / maxSegments));
  const sampled = visible.filter((_, index) => index % stride === 0 || index === visible.length - 1);
  const segments = sampled.map(segment => {
    const stop = Math.min(segment.end, end);
    const intervals = segment.kind === 'recovery' ? 8 : 1;
    return { kind: segment.kind, points: Array.from({ length: intervals + 1 }, (_, i) => {
      const time = i === 0 ? segment.start : i === intervals ? stop :
        segment.start + (stop - segment.start) * i / intervals;
      return { time, eitr: eitrAtSegment(segment, time) };
    }) };
  });
  const casts = result.casts.filter(cast => cast.start <= end);
  const castStride = Math.max(1, Math.ceil(casts.length / 80));
  return { end, segments, casts: casts.filter((_, i) => i % castStride === 0),
    simplified: stride > 1 || castStride > 1 };
}
