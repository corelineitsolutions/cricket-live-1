#!/usr/bin/env node
/**
 * Manual integration smoke against a running local llama.cpp server.
 *
 * Usage (on the Ubuntu host):
 *   AI_LOCAL_MODEL_URL=http://127.0.0.1:8081 node scripts/ai-intent-smoke.mjs
 *
 * Measures classify latency for a few prompts. Does not start the model.
 */
const base = (process.env.AI_LOCAL_MODEL_URL || 'http://127.0.0.1:8081').replace(/\/+$/, '');
const intents = [
  'required_run_rate',
  'win_probability',
  'next_wicket',
  'player_history',
  'head_to_head',
  'out_of_domain',
  'project_next_overs',
  'project_score',
  'needs_match',
].join(', ');

const SYSTEM = `You classify cricket Ask questions for a live score app. Reply with ONLY one JSON object, no markdown, no thinking.
Schema: {"domain":"cricket"|"other","intent":"<name>","parameters":{},"needs_match":true|false,"confidence":0.0-1.0}
Allowed intent values: ${intents}.
Do NOT invent match ids or statistics.`;

const QUESTIONS = [
  { q: "What's the required run rate?", match: true },
  { q: 'Ab kitne run per over chahiye?', match: true },
  { q: 'Can they chase this?', match: true },
  { q: 'Who is likely to win?', match: true },
  { q: 'Agla wicket kab gir sakta hai?', match: true },
  { q: 'How many runs will they score in the next five overs?', match: true },
  { q: 'What did Virat Kohli score in the World Cup?', match: false },
  { q: 'Show the head-to-head record.', match: true },
  { q: 'What is the weather in Paris?', match: false },
];

async function health() {
  const res = await fetch(`${base}/health`);
  if (!res.ok) throw new Error(`health ${res.status}`);
  return res.text();
}

async function classify(question, matchSelected) {
  const started = Date.now();
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.AI_LOCAL_MODEL_NAME || 'qwen',
      temperature: 0,
      max_tokens: 120,
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `language=en\nmatch_selected=${matchSelected ? 'yes' : 'no'}\nquestion=${question}`,
        },
      ],
      chat_template_kwargs: { enable_thinking: false },
      reasoning_format: 'none',
    }),
  });
  const latencyMs = Date.now() - started;
  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content ?? '';
  return { latencyMs, status: res.status, content: String(content).slice(0, 400) };
}

const main = async () => {
  console.log(`base=${base}`);
  console.log(`health=${await health()}`);

  const latencies = [];
  for (const row of QUESTIONS) {
    const result = await classify(row.q, row.match);
    latencies.push(result.latencyMs);
    console.log(JSON.stringify({ question: row.q, ...result }));
  }

  // Two overlapping requests (respect -np 2 on llama-server).
  const pairStarted = Date.now();
  const [a, b] = await Promise.all([
    classify('Can they chase this?', true),
    classify('Who is likely to win?', true),
  ]);
  console.log(
    JSON.stringify({
      concurrentPairWallMs: Date.now() - pairStarted,
      a: a.latencyMs,
      b: b.latencyMs,
    }),
  );

  latencies.sort((x, y) => x - y);
  const avg = Math.round(latencies.reduce((s, n) => s + n, 0) / latencies.length);
  console.log(
    JSON.stringify({
      count: latencies.length,
      avgMs: avg,
      p50Ms: latencies[Math.floor(latencies.length / 2)],
      maxMs: latencies[latencies.length - 1],
    }),
  );
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
