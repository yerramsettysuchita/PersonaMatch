# PersonaMatch evaluation

Generated 2026-10-02T22:38:43.849Z by `npm run eval` over 9 profiles and 9 dates.

## 1. Citation verification

A citation verifies when its section exists and its quote appears verbatim in that section. Only verified citations (and the claims they support) are stored.

| Profile | Proposed | Verified | Rate |
| --- | ---: | ---: | ---: |
| Aditya Sharma | 10 | 10 | 100.0% |
| Ananya Reddy | 9 | 9 | 100.0% |
| Divya Nair | 9 | 9 | 100.0% |
| Karthik Varma | 10 | 10 | 100.0% |
| Meghana Rao | 13 | 13 | 100.0% |
| Rohan Mehta | 11 | 11 | 100.0% |
| Sneha Iyer | 8 | 8 | 100.0% |
| Vikram Rao | 10 | 10 | 100.0% |
| Yerramsetty Sai Venkata Suchita | n/a | n/a | not recorded (ingested before stats existed) |
| **Overall** | **80** | **80** | **100.0%** |

## 2. Where claims come from

Across 82 stored claims (needs, hobbies, interests, values): **69.5% Instagram**, **30.5% LinkedIn**.

| Category | Instagram | LinkedIn |
| --- | ---: | ---: |
| needs | 13 | 2 |
| hobbies | 27 | 1 |
| interests | 6 | 12 |
| values | 11 | 10 |

## 3. Date scores and second-date agreement

18 verdicts from 9 dates: mean **6.72**, median **8.00**, std dev **2.40**, range 2–9.

| Score | Count |
| --- | ---: |
| 0–2 | 2 |
| 3–4 | 2 |
| 5–6 | 0 |
| 7–8 | 12 |
| 9–10 | 2 |

Second date: both yes **77.8%**, both no **22.2%**, sides agree **100.0%**, disagree **0.0%**.

## 4. Position bias

Who opens each date is random. Mean score given by the person who spoke first vs second:

| Spoke first | Spoke second | Difference |
| ---: | ---: | ---: |
| 6.89 (n=9) | 6.56 (n=9) | 0.33 |

## 5. Consistency (re-running the same pair)

5 random dated pairs, each re-simulated 1 more time with the same two personas (not stored). Variance is the sample variance of each person's score across the original + re-runs.

| Pair | Person A scores | Person B scores | Var A | Var B | Second-date votes stable |
| --- | --- | --- | ---: | ---: | --- |
| Rohan Mehta × Meghana Rao | 8, 9 | 7, 9 | 0.50 | 2.00 | yes |
| Vikram Rao × Rohan Mehta | 3, 3 | 3, 3 | 0.00 | 0.00 | yes |
| Ananya Reddy × Karthik Varma | 8, 8 | 8, 9 | 0.00 | 0.50 | yes |
| Karthik Varma × Aditya Sharma | 7, 9.5 | 8, 9.5 | 3.13 | 1.13 | yes |
| Vikram Rao × Aditya Sharma | 2, 3 | 2, 3 | 0.50 | 0.50 | yes |

Mean score variance across re-runs: **0.82** (std dev ≈ 0.91 points on a 0–10 scale).
