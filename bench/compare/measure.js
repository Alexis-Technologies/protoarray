/**
 * The timing loop of the comparison and of the release-over-release runs:
 * a warm-up, then `rounds` rounds of `roundMs` each. A result is the median
 * of the rounds in calls a second, their slowest and fastest, and the spread
 * between those two as a percentage of the median: a difference inside it is
 * noise.
 */
const { performance } = require('node:perf_hooks');

const METHOD = { warmup: 500, rounds: 5, roundMs: 400 };

const measure = (fn, method = METHOD) => {
  for (let i = 0; i < method.warmup; i++) fn();
  const samples = [];
  for (let round = 0; round < method.rounds; round++) {
    let iterations = 0;
    const start = performance.now();
    while (performance.now() - start < method.roundMs) {
      fn();
      iterations++;
    }
    samples.push((iterations / (performance.now() - start)) * 1000);
  }
  samples.sort((a, b) => a - b);
  const median = Math.round(samples[Math.floor(samples.length / 2)]);
  const min = Math.round(samples[0]);
  const max = Math.round(samples[samples.length - 1]);
  return { median, min, max, spread: Math.round(((max - min) / median) * 100) };
};

module.exports = { METHOD, measure };
