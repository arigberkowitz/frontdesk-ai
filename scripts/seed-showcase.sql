-- Showcase seed: makes the DEMO workspace look like a busy, established
-- multi-month account (~30k calls scale) for sales demos and screenshots.
--
-- ⚠ Run ONLY against a client that is clearly a demo tenant (e.g. "Fade
-- Factory"). Never run against a real customer — their dashboard must always
-- show only what their AI actually did.
--
-- Usage: replace :client_id, then paste into the Neon SQL editor.
--   1) Bulk historical calls spread over 180 days (booked/answered/lead mix)
--   2) Matching appointments for a realistic booking rate
--
-- Volume knobs: 30000 calls ≈ a 3-location shop over 6 months.

WITH params AS (
  SELECT '00000000-0000-0000-0000-000000000000'::uuid AS client_id, 30000 AS n
)
INSERT INTO calls (client_id, retell_call_id, direction, from_number, start_at, end_at,
                   duration_sec, outcome, sentiment, is_after_hours, summary)
SELECT
  p.client_id,
  'demo_' || gs::text,
  'inbound',
  '+1305555' || lpad((1000 + (random() * 8999))::int::text, 4, '0'),
  ts,
  ts + (interval '1 second' * dur),
  dur,
  CASE WHEN r < 0.42 THEN 'booked'
       WHEN r < 0.62 THEN 'faq_answered'
       WHEN r < 0.82 THEN 'lead'
       WHEN r < 0.90 THEN 'escalated'
       ELSE 'faq_answered' END::call_outcome,
  CASE WHEN r < 0.55 THEN 'positive' WHEN r < 0.9 THEN 'neutral' ELSE 'negative' END::call_sentiment,
  (extract(hour FROM ts) < 8 OR extract(hour FROM ts) > 18),
  'Demo call — seeded for showcase.'
FROM params p,
LATERAL generate_series(1, p.n) gs,
LATERAL (SELECT now() - (random() * interval '180 days') AS ts,
                (45 + random() * 300)::int AS dur,
                random() AS r) x;

-- Appointments for ~each booked call in the last 60 days (keeps table sane).
WITH params AS (
  SELECT '00000000-0000-0000-0000-000000000000'::uuid AS client_id
)
INSERT INTO appointments (client_id, call_id, customer_name, customer_phone, start_at, end_at, status)
SELECT c.client_id, c.id,
       (ARRAY['Alex','Jordan','Maria','Sam','Dana','Luis','Kim','Tay'])[1 + (random()*7)::int],
       c.from_number,
       c.start_at + interval '2 days',
       c.start_at + interval '2 days' + interval '45 minutes',
       'confirmed'
FROM calls c, params p
WHERE c.client_id = p.client_id
  AND c.retell_call_id LIKE 'demo_%'
  AND c.outcome = 'booked'
  AND c.start_at > now() - interval '60 days';
